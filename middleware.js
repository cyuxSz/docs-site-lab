// Login con GitHub para todo el portal (Routing Middleware de Vercel, corre antes de servir cada archivo).
// Solo entra quien pertenece a ALLOWED_ORG o está en ALLOWED_USERS.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  OAuth App de GitHub (callback: https://<dominio>/auth/callback)
//   SESSION_SECRET                          32+ caracteres aleatorios para firmar la cookie
//   ALLOWED_ORG                             p. ej. vanttec (requiere que la org permita la OAuth App)
//   ALLOWED_USERS                           opcional, logins separados por coma (respaldo si la org restringe apps)
//   PRODUCTION_HOST                         opcional; por defecto VERCEL_PROJECT_PRODUCTION_URL (p. ej. docs-site-lab.vercel.app)
//   PREVIEW_HOST_SUFFIX                     sufijo de los Preview de tu equipo, p. ej. -cyuxsz.vercel.app (Vercel recorta el
//                                           nombre del proyecto en esas URLs, así que no basta con el prefijo)
//
// Los Preview tienen otro dominio y GitHub solo acepta el callback de producción: el preview manda a producción
// a iniciar sesión y recibe de vuelta un pase firmado de 60 s (/auth/handoff) que canjea por su propia cookie.
import { next } from "@vercel/functions";

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
};

const COOKIE = "docs_session";
const SESSION_DAYS = 7;
const HANDOFF_MS = 60_000;
const PROD_HOST = process.env.PRODUCTION_HOST || process.env.VERCEL_PROJECT_PRODUCTION_URL || "";
const enc = new TextEncoder();

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url").toString("utf8");

async function hmac(value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(process.env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(payload) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}

async function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!safeEqual(mac, await hmac(body))) return null;
  const payload = JSON.parse(fromB64url(body));
  return payload.exp > Date.now() ? payload : null;
}

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Las respuestas del login no pasan por las cabeceras de vercel.json. no-referrer evita que el pase de
// /auth/handoff (va en la URL) salga en el Referer.
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function redirect(location, extraCookies = []) {
  const headers = new Headers({ ...SECURITY_HEADERS, Location: location });
  for (const c of extraCookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function page(status, title, message) {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0a1420;color:#e4ecf4}main{max-width:420px;padding:24px;text-align:center}a{color:#3cc3d2}</style>
<main><h1>${title}</h1><p>${message}</p></main></html>`;
  return new Response(html, {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
  });
}

// Solo se entrega el pase a previews del mismo equipo de Vercel: https://<algo><PREVIEW_HOST_SUFFIX>.
// Sin el sufijo configurado, ningún preview recibe pase (falla cerrado).
function isPreviewOrigin(origin) {
  const suffix = process.env.PREVIEW_HOST_SUFFIX || "";
  if (!PROD_HOST || !origin || !/^-[a-z0-9-]+\.vercel\.app$/.test(suffix)) return false;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.origin === origin && !u.port && u.hostname.endsWith(suffix) && u.hostname.length > suffix.length;
  } catch {
    return false;
  }
}

const safeTarget = (back) => (back && back.startsWith("/") && !back.startsWith("//") ? back : "/");

async function gh(path, token) {
  return fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "docs-site-lab" },
  });
}

async function isAllowed(login, token) {
  const users = (process.env.ALLOWED_USERS || "").split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (users.includes(login.toLowerCase())) return true;
  const org = process.env.ALLOWED_ORG;
  if (!org) return false;
  // Si la org aprobó la OAuth App, esto ve también a los miembros con membresía privada.
  const res = await gh(`/user/memberships/orgs/${encodeURIComponent(org)}`, token);
  if (res.ok && (await res.json()).state === "active") return true;
  // Si la org restringe apps de terceros, solo se pueden ver los miembros con membresía pública.
  const pub = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/public_members/${encodeURIComponent(login)}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "docs-site-lab" },
  });
  return pub.status === 204;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  // vercel.json usa trailingSlash: /auth/login llega como /auth/login/.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET } = process.env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    return page(503, "Login sin configurar", "Faltan GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET o SESSION_SECRET (32+ caracteres) en Vercel.");
  }
  const jar = cookies(request);

  if (path === "/auth/login") {
    const back = safeTarget(url.searchParams.get("next"));
    if (process.env.VERCEL_ENV === "preview" && PROD_HOST && url.host !== PROD_HOST) {
      const prod = new URL(`https://${PROD_HOST}/auth/login`);
      prod.searchParams.set("next", back);
      prod.searchParams.set("preview", url.origin);
      return redirect(prod.toString());
    }
    const preview = url.searchParams.get("preview");
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const auth = new URL("https://github.com/login/oauth/authorize");
    auth.searchParams.set("client_id", GITHUB_CLIENT_ID);
    auth.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
    auth.searchParams.set("scope", "read:org");
    auth.searchParams.set("state", state);
    const pending = JSON.stringify({ state, back, preview: isPreviewOrigin(preview) ? preview : null });
    return redirect(auth.toString(), [setCookie("oauth_state", pending, 600)]);
  }

  if (path === "/auth/callback") {
    let pending = {};
    try {
      pending = JSON.parse(jar.oauth_state || "{}");
    } catch {}
    const { state, back, preview } = pending;
    if (!state || url.searchParams.get("state") !== state) return page(400, "Sesión expirada", 'Vuelve a <a href="/auth/login">iniciar sesión</a>.');
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET, code: url.searchParams.get("code"), redirect_uri: `${url.origin}/auth/callback` }),
    });
    const { access_token: token } = await tokenRes.json();
    if (!token) return page(401, "No se pudo iniciar sesión", 'GitHub no devolvió un token. <a href="/auth/login">Reintentar</a>.');
    const user = await (await gh("/user", token)).json();
    if (!user.login || !(await isAllowed(user.login, token))) {
      return page(403, "Sin acceso", `No se pudo confirmar que @${user.login || "?"} pertenece a ${process.env.ALLOWED_ORG || "la lista de acceso"}. Si sí perteneces, haz pública tu membresía en <a href="https://github.com/orgs/${process.env.ALLOWED_ORG}/people">la página de miembros de la org</a> o pide a un admin que apruebe la app, y <a href="/auth/login">vuelve a intentar</a>.`);
    }
    const session = await sign({ login: user.login, exp: Date.now() + SESSION_DAYS * 864e5 });
    const done = [setCookie(COOKIE, session, SESSION_DAYS * 86400), setCookie("oauth_state", "", 0)];
    if (isPreviewOrigin(preview)) {
      const pass = await sign({ login: user.login, aud: preview, exp: Date.now() + HANDOFF_MS });
      const handoff = new URL(`${preview}/auth/handoff`);
      handoff.searchParams.set("t", pass);
      handoff.searchParams.set("next", safeTarget(back));
      return redirect(handoff.toString(), done);
    }
    return redirect(safeTarget(back), done);
  }

  if (path === "/auth/handoff") {
    const pass = await verify(url.searchParams.get("t")).catch(() => null);
    if (!pass || pass.aud !== url.origin) return page(400, "Pase inválido", 'El pase expiró o no es para este sitio. <a href="/auth/login">Reintentar</a>.');
    const session = await sign({ login: pass.login, exp: Date.now() + SESSION_DAYS * 864e5 });
    return redirect(safeTarget(url.searchParams.get("next")), [setCookie(COOKIE, session, SESSION_DAYS * 86400)]);
  }

  if (path === "/auth/logout") return redirect("/auth/signed-out", [setCookie(COOKIE, "", 0)]);
  if (path === "/auth/signed-out") return page(200, "Sesión cerrada", '<a href="/auth/login">Entrar de nuevo</a>');

  const verified = await verify(jar[COOKIE]).catch(() => null);
  // Un pase de preview (lleva aud) no sirve como cookie de sesión.
  const session = verified && !verified.aud ? verified : null;
  if (!session) {
    if (path === "/auth/me") return Response.json({ login: null }, { status: 401 });
    return redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (path === "/auth/me") return Response.json({ login: session.login });
  return next({ headers: { "Cache-Control": "private, no-store" } });
}
