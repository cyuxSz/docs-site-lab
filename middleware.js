// Login con GitHub para todo el portal (Routing Middleware de Vercel, corre antes de servir cada archivo).
// Solo entra quien pertenece a ALLOWED_ORG o está en ALLOWED_USERS.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  OAuth App de GitHub (callback: https://<dominio>/auth/callback)
//   SESSION_SECRET                          32+ caracteres aleatorios para firmar la cookie
//   ALLOWED_ORG                             p. ej. vanttec (requiere que la org permita la OAuth App)
//   ALLOWED_USERS                           opcional, logins separados por coma (respaldo si la org restringe apps)
//   PREVIEW_TRUST_VERCEL_AUTH               "1" para dejar pasar los Preview sin login de GitHub. Solo si Vercel → Settings →
//                                           Deployment Protection tiene activado Vercel Authentication (el valor por defecto).
//
// Los Preview tienen otro dominio y la OAuth App solo acepta el callback de producción. Un pase firmado de producción
// al preview obligaba a aceptar cualquier *.vercel.app parecido (cualquiera puede registrar ese nombre), así que los
// Preview se protegen con el login de Vercel y, si no se confía en él, responden 403.
import { next } from "@vercel/functions";
import { canAccess } from "./access.config.js";

export const config = {
  matcher: ["/((?!favicon\\.ico$).*)"],
};

const COOKIE = "docs_session";
const SESSION_DAYS = 7;
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
    if (i <= 0) continue;
    // Una cookie con un % mal formado no debe tumbar el middleware.
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Las respuestas del login no pasan por las cabeceras de vercel.json.
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

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// title y message son HTML fijo del middleware; todo dato externo (login, org) pasa antes por esc().
function page(status, title, message) {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:radial-gradient(120% 80% at 50% -10%,#01165c,#010c3d 45%,#01052a);color:#eef3fb}main{max-width:420px;padding:24px;text-align:center}a{color:#49c1d2}ol{text-align:left}</style>
<main><h1>${title}</h1><div>${message}</div></main></html>`;
  return new Response(html, {
    status,
    headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
  });
}

// Solo rutas del mismo sitio. Los navegadores tratan "\" como "/", así que "/\evil.com" sería "//evil.com".
const safeTarget = (back) => (typeof back === "string" && /^\/(?![/\\])[^\s\\]*$/.test(back) ? back : "/");

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

  if (process.env.VERCEL_ENV === "preview") {
    if (process.env.PREVIEW_TRUST_VERCEL_AUTH === "1") return next({ headers: { "Cache-Control": "private, no-store" } });
    return page(403, "Preview sin login", "Los Preview se protegen con el login de Vercel. Activa Vercel Authentication y PREVIEW_TRUST_VERCEL_AUTH=1, o revisa el cambio en producción.");
  }

  if (path === "/auth/login") {
    const back = safeTarget(url.searchParams.get("next"));
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const auth = new URL("https://github.com/login/oauth/authorize");
    auth.searchParams.set("client_id", GITHUB_CLIENT_ID);
    auth.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
    auth.searchParams.set("scope", "read:org");
    auth.searchParams.set("state", state);
    const pending = JSON.stringify({ state, back });
    return redirect(auth.toString(), [setCookie("oauth_state", pending, 600)]);
  }

  if (path === "/auth/callback") {
    let pending = {};
    try {
      pending = JSON.parse(jar.oauth_state || "{}");
    } catch {}
    const { state, back } = pending;
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
      const org = process.env.ALLOWED_ORG || "";
      const who = esc(user.login || "?");
      if (!org) return page(403, "Sin acceso", `<p>@${who} no está en la lista de acceso.</p><p><a href="/auth/login">Reintentar</a></p>`);
      return page(
        403,
        "Sin acceso",
        `<p>No se pudo confirmar que @${who} pertenece a ${esc(org)}. Probablemente tu membresía es privada:</p><ol><li>Abre <a href="https://github.com/orgs/${encodeURIComponent(org)}/people">la página de miembros de la org</a>.</li><li>Búscate con tu usuario.</li><li>En tu fila, cambia la visibilidad de "Private" a "Public".</li><li>Vuelve a intentarlo: <a href="/auth/login">iniciar sesión</a>.</li></ol><p>O pide a un admin que apruebe la app.</p>`,
      );
    }
    const session = await sign({ login: user.login, exp: Date.now() + SESSION_DAYS * 864e5 });
    return redirect(safeTarget(back), [setCookie(COOKIE, session, SESSION_DAYS * 86400), setCookie("oauth_state", "", 0)]);
  }

  if (path === "/auth/logout") return redirect("/auth/signed-out", [setCookie(COOKIE, "", 0)]);
  if (path === "/auth/signed-out") return page(200, "Sesión cerrada", '<a href="/auth/login">Entrar de nuevo</a>');

  const session = await verify(jar[COOKIE]).catch(() => null);
  const noStore = { headers: { "Cache-Control": "private, no-store" } };
  if (!session) {
    if (path === "/auth/me") return Response.json({ login: null }, { status: 401, ...noStore });
    return redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (path === "/auth/me") return Response.json({ login: session.login }, noStore);
  if (!canAccess(session.login, url.pathname)) {
    return page(403, "Este proyecto es privado", `<p>@${esc(session.login)} no tiene acceso a este proyecto.</p><p><a href="/">Volver al portal</a></p>`);
  }
  return next({ headers: { "Cache-Control": "private, no-store" } });
}
