// Login con GitHub para todo el portal (Routing Middleware de Vercel, corre antes de servir cada archivo).
// Solo entra quien pertenece a ALLOWED_ORG o está en ALLOWED_USERS.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  OAuth App de GitHub (callback: https://<dominio>/auth/callback)
//   SESSION_SECRET                          32+ caracteres aleatorios para firmar la cookie
//   ALLOWED_ORG                             p. ej. vanttec (requiere que la org permita la OAuth App)
//   ALLOWED_USERS                           opcional, logins separados por coma (respaldo si la org restringe apps)
import { next } from "@vercel/functions";

export const config = {
  matcher: ["/((?!favicon.ico).*)"],
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
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function redirect(location, extraCookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const c of extraCookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

function page(status, title, message) {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0a1420;color:#e4ecf4}main{max-width:420px;padding:24px;text-align:center}a{color:#3cc3d2}</style>
<main><h1>${title}</h1><p>${message}</p></main></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

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
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const back = url.searchParams.get("next") || "/";
    const auth = new URL("https://github.com/login/oauth/authorize");
    auth.searchParams.set("client_id", GITHUB_CLIENT_ID);
    auth.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
    auth.searchParams.set("scope", "read:org");
    auth.searchParams.set("state", state);
    return redirect(auth.toString(), [setCookie("oauth_state", `${state}|${back}`, 600)]);
  }

  if (path === "/auth/callback") {
    const [state, back = "/"] = (jar.oauth_state || "").split("|");
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
    const target = back.startsWith("/") && !back.startsWith("//") ? back : "/";
    return redirect(target, [setCookie(COOKIE, session, SESSION_DAYS * 86400), setCookie("oauth_state", "", 0)]);
  }

  if (path === "/auth/logout") return redirect("/auth/signed-out", [setCookie(COOKIE, "", 0)]);
  if (path === "/auth/signed-out") return page(200, "Sesión cerrada", '<a href="/auth/login">Entrar de nuevo</a>');

  const session = await verify(jar[COOKIE]).catch(() => null);
  if (!session) {
    if (path === "/auth/me") return Response.json({ login: null }, { status: 401 });
    return redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (path === "/auth/me") return Response.json({ login: session.login });
  return next({ headers: { "Cache-Control": "private, no-store" } });
}
