// Login con GitHub para todo el portal (núcleo que usa worker/index.mjs).
// Solo entra quien pertenece a ALLOWED_ORG o está en ALLOWED_USERS.
//
// Variables de entorno (secrets de Wrangler: wrangler secret put <NOMBRE>, o .dev.vars en local):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  OAuth App de GitHub (callback: https://<dominio>/auth/callback)
//   SESSION_SECRET                          32+ caracteres aleatorios para firmar la cookie
//   ALLOWED_ORG                             p. ej. vanttec (requiere que la org permita la OAuth App)
//   ALLOWED_USERS                           opcional, logins separados por coma (respaldo si la org restringe apps)
import { canAccess } from "../access.config.js";
import { COOKIE, sign, verify, cookies } from "./sesion.mjs";
import { HttpError, respuesta, leerCuerpo, exigirMismoOrigen, ERROR_TOKEN, ERROR_AMBOS, ERROR_TOKENS_NO_DISPONIBLES, CABECERAS_401_BEARER } from "./api-comun.mjs";
import { limitarCanje } from "./limite-canje.mjs";
import {
  canjear,
  resolverBearer,
  listarDispositivos,
  revocarDispositivo,
  revocarTodos,
  revocarPropio,
  nombreValido,
  plataformaValida,
  codigoBienFormado,
  verifierBienFormado,
} from "./dispositivos-core.mjs";
import { esc, RUTA_PAGINA, RUTA_REVOCAR, RE_ID, ESTILOS, tokenCsrf, csrfValido, leerFormulario, htmlDispositivos } from "./dispositivos-paginas.mjs";

const SESSION_DAYS = 7;
const NO_STORE = { "Cache-Control": "private, no-store" };
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

const setCookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Las respuestas del login llevan sus propias cabeceras de seguridad.
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

// title y message son HTML fijo del login; todo dato externo (login, org, dispositivos) pasa antes por esc().
// Opciones: `formularios` añade form-action 'self' a la CSP (no hereda de default-src), `estilos` es CSS fijo que se
// suma al de base, `headers` son cabeceras extra (p. ej. Allow en un 405) y `referrerPolicy` sustituye a no-referrer
// (un solo valor): solo para una página con formulario, porque con no-referrer el navegador envía `Origin: null`.
function page(status, title, message, { formularios = false, estilos = "", headers = {}, referrerPolicy = SECURITY_HEADERS["Referrer-Policy"] } = {}) {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:radial-gradient(120% 80% at 50% -10%,#01165c,#010c3d 45%,#01052a);color:#eef3fb}main{max-width:420px;padding:24px;text-align:center}a{color:#49c1d2}ol{text-align:left}${estilos}</style>
<main><h1>${title}</h1><div>${message}</div></main></html>`;
  return new Response(html, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Referrer-Policy": referrerPolicy,
      "content-type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'${formularios ? "; form-action 'self'" : ""}`,
      ...headers,
    },
  });
}

// Solo rutas del mismo sitio. Los navegadores tratan "\" como "/", así que "/\evil.com" sería "//evil.com".
const safeTarget = (back) => (typeof back === "string" && /^\/(?![/\\])[^\s\\]*$/.test(back) ? back : "/");

async function gh(path, token) {
  return fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "docs-site-lab" },
  });
}

// Devuelve "si", "no" o "incierto". Solo "si" deja entrar. "no" es una negativa concluyente (y revoca los tokens de
// dispositivo del login): GitHub contestó que no es miembro. "incierto" es todo lo demás (5xx, límite de tasa, un 403
// de la membresía, o que falte ALLOWED_ORG): no se entra, pero tampoco se revoca nada.
async function comprobarAcceso(login, token, env) {
  const users = (env.ALLOWED_USERS || "").split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
  if (users.includes(login.toLowerCase())) return "si";
  const org = env.ALLOWED_ORG;
  // Sin organización configurada (puede ser un error del operador) nadie pierde sus tokens por no estar en la lista.
  if (!org) return "incierto";
  // Si la org aprobó la OAuth App, esto ve también a los miembros con membresía privada.
  const res = await gh(`/user/memberships/orgs/${encodeURIComponent(org)}`, token);
  if (res.ok && (await res.json()).state === "active") return "si";
  // Si la org restringe apps de terceros, solo se pueden ver los miembros con membresía pública.
  const pub = await fetch(`https://api.github.com/orgs/${encodeURIComponent(org)}/public_members/${encodeURIComponent(login)}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "docs-site-lab" },
  });
  if (pub.status === 204) return "si";
  // Concluyente solo si la membresía responde 200 (no activa) o 404, y además el miembro público responde exactamente
  // 404. Un 403 de la membresía nunca lo es: GitHub lo usa también para el límite de tasa y para la organización que
  // restringe la OAuth App, y no se intenta distinguirlos. Tampoco lo es un 5xx, 429 o 401.
  return (res.status === 200 || res.status === 404) && pub.status === 404 ? "no" : "incierto";
}

// ---------- Dispositivos: API con Bearer ----------

// GET /auth/app/dispositivos y POST /auth/app/revocar: solo con token de dispositivo y siempre JSON. Credencial
// primero, método después. La revocación no lee el cuerpo ni la query: un token solo se revoca a sí mismo.
async function manejarApiDispositivos(request, env, path, bearer) {
  if (bearer.estado !== "ok") return respuesta(401, { error: "Token requerido" }, CABECERAS_401_BEARER);
  const lista = path === "/auth/app/dispositivos";
  const metodo = lista ? "GET" : "POST";
  if (request.method !== metodo) return respuesta(405, { error: "Método no permitido" }, { allow: metodo });
  try {
    if (lista) {
      const iso = (ms) => new Date(ms).toISOString();
      const dispositivos = (await listarDispositivos(env.DB, bearer.login)).map((d) => ({
        id: d.id,
        nombre: d.nombre,
        plataforma: d.plataforma,
        creado: iso(d.creado),
        ultimoUso: d.ultimoUso === null ? null : iso(d.ultimoUso),
        expira: iso(d.expira),
        actual: d.id === bearer.id,
      }));
      return respuesta(200, { login: bearer.login, dispositivos });
    }
    // Regla del lote A con Bearer: Origin puede faltar, pero si viene tiene que ser el propio.
    exigirMismoOrigen(request);
    // "revocado" y "ya-revocado" dejan el dispositivo fuera (idempotente). Si no se pudo identificar el token de la
    // petición no se borró nada: el token sigue vivo y la app no puede creer que cerró sesión.
    if ((await revocarPropio(request, env)) === "no-identificado") return respuesta(503, { error: ERROR_TOKENS_NO_DISPONIBLES });
    return respuesta(200, { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return respuesta(e.status, { error: e.message }, e.headers);
    // Fallo de D1: sin detalles al cliente y sin registrar nada de la petición. Si era el borrado, el token sigue vivo.
    return respuesta(503, { error: ERROR_TOKENS_NO_DISPONIBLES });
  }
}

// ---------- Dispositivos: página del navegador ----------

const MAX_FORMULARIO = 1024;
const VOLVER_DISPOSITIVOS = `<p><a href="${RUTA_PAGINA}">Volver a Dispositivos</a></p>`;
const paginaDisp = (status, title, message, headers) => page(status, title, message, { formularios: true, estilos: ESTILOS, headers });
const errorDisp = (status, title, texto, headers) => paginaDisp(status, title, `<p>${texto}</p>${VOLVER_DISPOSITIVOS}`, headers);
const noDisponible = () => errorDisp(503, "Dispositivos no disponibles", "Inténtalo de nuevo en un momento.");

// GET /auth/dispositivos (lista) y POST /auth/dispositivos/revocar (formulario): solo con la cookie de sesión.
// El login del borrado sale de la sesión, nunca del formulario.
async function manejarPaginaDispositivos(request, env, path, valorCookie) {
  const sesion = await verify(valorCookie, env.SESSION_SECRET).catch(() => null);
  const login = sesion && typeof sesion.login === "string" && sesion.login ? sesion.login : null;
  if (!login) return redirect(`/auth/login?next=${encodeURIComponent(RUTA_PAGINA)}`);

  if (path === RUTA_PAGINA) {
    if (request.method !== "GET") return errorDisp(405, "Método no permitido", "Esta página solo se puede abrir.", { Allow: "GET" });
    if (!env.DB) return noDisponible();
    try {
      const dispositivos = await listarDispositivos(env.DB, login);
      // Única página con formulario: same-origin para que el POST de «Revocar» lleve el Origin real (decisión 9).
      const html = htmlDispositivos(dispositivos, await tokenCsrf(env.SESSION_SECRET, valorCookie));
      return page(200, "Dispositivos", html, { formularios: true, estilos: ESTILOS, referrerPolicy: "same-origin" });
    } catch {
      return noDisponible();
    }
  }

  if (request.method !== "POST") return errorDisp(405, "Método no permitido", "La revocación se envía desde la página de dispositivos.", { Allow: "POST" });
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return errorDisp(403, "Solicitud no permitida", "La revocación se envía desde la página de dispositivos.");
  if (!/^application\/x-www-form-urlencoded\s*(;|$)/i.test(request.headers.get("content-type") || "")) {
    return errorDisp(415, "Formato no admitido", "La revocación se envía desde la página de dispositivos.");
  }
  let campos;
  try {
    campos = await leerFormulario(request, MAX_FORMULARIO);
  } catch {
    return errorDisp(400, "Solicitud inválida", "No se pudo leer el formulario.");
  }
  if (!campos) return errorDisp(413, "Solicitud demasiado grande", "La revocación se envía desde la página de dispositivos.");
  if (!(await csrfValido(env.SESSION_SECRET, valorCookie, campos.get("csrf")))) {
    return errorDisp(403, "El formulario caducó", "Vuelve a la página de dispositivos e inténtalo de nuevo.");
  }
  const id = campos.get("id");
  if (typeof id !== "string" || !RE_ID.test(id)) return errorDisp(400, "Dispositivo inválido", "Vuelve a la página de dispositivos e inténtalo de nuevo.");
  if (!env.DB) return noDisponible();
  try {
    // El resultado no se mira: un id de otro login y uno inexistente reciben la misma respuesta que un borrado.
    await revocarDispositivo(env.DB, login, id);
  } catch {
    return noDisponible();
  }
  return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, Location: RUTA_PAGINA } });
}

// Rutas pensadas para un navegador: con un token de dispositivo válido responden 400 JSON (ni OAuth, ni cookies, ni HTML).
const RUTAS_NAVEGADOR = new Set(["/auth/login", "/auth/callback", "/auth/logout", "/auth/signed-out", RUTA_PAGINA, RUTA_REVOCAR]);

// POST /auth/app/canje {code, verifier, nombre?, plataforma?} → {token, expira, login}. Única ruta pública de los tokens
// de dispositivo: no mira cookie, Bearer ni Origin; la protegen el código de un solo uso, PKCE y el límite por IP.
// El token solo aparece en el cuerpo de la respuesta 200. Nada de lo que llega (código, verifier) se registra ni se devuelve.
const MAX_CANJE = 2048;
const ERROR_CODIGO = "Código inválido o caducado";
const CANJE_NO_DISPONIBLE = "Canje no disponible";

async function manejarCanje(request, env) {
  if (request.method !== "POST") return respuesta(405, { error: "Método no permitido" }, { allow: "POST" });
  try {
    // Validación barata primero: nada de lo que se rechaza aquí toca D1 ni cuenta para el límite.
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") || "")) throw new HttpError(415, "Se requiere application/json");
    const body = await leerCuerpo(request, MAX_CANJE);
    // Los datos opcionales se validan antes de tocar el código (no lo consumen) y no sustituyen a los del consentimiento.
    if ((body.nombre !== undefined && nombreValido(body.nombre) === null) || (body.plataforma !== undefined && !plataformaValida(body.plataforma))) {
      throw new HttpError(400, "Datos inválidos");
    }
    if (!codigoBienFormado(body.code) || !verifierBienFormado(body.verifier)) throw new HttpError(400, ERROR_CODIGO);
    if (!env.DB) throw new HttpError(503, CANJE_NO_DISPONIBLE);
    // Límite por cubo de IP, solo para peticiones que podrían consumir un código. Solo CF-Connecting-IP (la pone
    // Cloudflare); X-Forwarded-For lo escribe el cliente.
    const limite = await limitarCanje(env.DB, request.headers.get("cf-connecting-ip"));
    if (!limite.permitido) throw new HttpError(429, "Demasiadas peticiones; espera un momento", { "retry-after": String(limite.espera) });
    const emitido = await canjear(env.DB, { code: body.code, verifier: body.verifier });
    if (!emitido) throw new HttpError(400, ERROR_CODIGO);
    return respuesta(200, { token: emitido.token, expira: new Date(emitido.expira).toISOString(), login: emitido.login });
  } catch (e) {
    if (e instanceof HttpError) return respuesta(e.status, { error: e.message }, e.headers);
    // Fallo de D1 u otro error interno: sin detalles al cliente y sin registrar nada de la petición.
    return respuesta(503, { error: CANJE_NO_DISPONIBLE });
  }
}

// continuar(extraHeaders) sirve el contenido ya autenticado (env.ASSETS.fetch en el Worker).
export async function manejarLogin(request, env, { continuar, restringidos } = {}) {
  const url = new URL(request.url);
  // Se ignora la barra final: /auth/login/ es /auth/login.
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET } = env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    return page(503, "Login sin configurar", `Faltan GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET o SESSION_SECRET (32+ caracteres) en la configuración.`);
  }
  if (path === "/auth/app/canje") return manejarCanje(request, env);

  // Token de dispositivo: con `Authorization: Bearer` la petición se autentica solo con el token y las respuestas de
  // error son JSON en cualquier ruta (nunca una redirección ni un asset). Otros esquemas siguen el flujo de cookie.
  const bearer = await resolverBearer(request, env);
  if (bearer.estado === "ambos") return respuesta(400, { error: ERROR_AMBOS });
  if (bearer.estado === "no-disponible") return respuesta(503, { error: ERROR_TOKENS_NO_DISPONIBLES });
  if (bearer.estado === "invalido") return respuesta(401, { error: ERROR_TOKEN }, CABECERAS_401_BEARER);
  const conBearer = bearer.estado === "ok";
  if (path === "/auth/app/dispositivos" || path === "/auth/app/revocar") return manejarApiDispositivos(request, env, path, bearer);
  // /auth/logout con Bearer no revoca el token ni finge cerrar sesión: para eso está POST /auth/app/revocar.
  if (conBearer && RUTAS_NAVEGADOR.has(path)) return respuesta(400, { error: "Ruta solo para navegador" });
  const jar = cookies(request);

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
    const acceso = user.login ? await comprobarAcceso(user.login, token, env) : "incierto";
    if (acceso !== "si") {
      // Quien pierde el acceso pierde también sus tokens de dispositivo. Solo con una negativa concluyente, y si el
      // borrado falla (sin binding o D1 caído) la respuesta es el mismo 403, sin detalles.
      if (acceso === "no" && env.DB) {
        try {
          await revocarTodos(env.DB, user.login);
        } catch {}
      }
      const org = env.ALLOWED_ORG || "";
      const who = esc(user.login || "?");
      if (!org) return page(403, "Sin acceso", `<p>@${who} no está en la lista de acceso.</p><p><a href="/auth/login">Reintentar</a></p>`);
      return page(
        403,
        "Sin acceso",
        `<p>No se pudo confirmar que @${who} pertenece a ${esc(org)}. Probablemente tu membresía es privada:</p><ol><li>Abre <a href="https://github.com/orgs/${encodeURIComponent(org)}/people">la página de miembros de la org</a>.</li><li>Búscate con tu usuario.</li><li>En tu fila, cambia la visibilidad de "Private" a "Public".</li><li>Vuelve a intentarlo: <a href="/auth/login">iniciar sesión</a>.</li></ol><p>O pide a un admin que apruebe la app.</p>`,
      );
    }
    const session = await sign({ login: user.login, exp: Date.now() + SESSION_DAYS * 864e5 }, SESSION_SECRET);
    return redirect(safeTarget(back), [setCookie(COOKIE, session, SESSION_DAYS * 86400), setCookie("oauth_state", "", 0)]);
  }

  if (path === "/auth/logout") return redirect("/auth/signed-out", [setCookie(COOKIE, "", 0)]);
  if (path === "/auth/signed-out") return page(200, "Sesión cerrada", '<a href="/auth/login">Entrar de nuevo</a>');
  if (path === RUTA_PAGINA || path === RUTA_REVOCAR) return manejarPaginaDispositivos(request, env, path, jar[COOKIE]);

  const session = conBearer ? { login: bearer.login } : await verify(jar[COOKIE], SESSION_SECRET).catch(() => null);
  const noStore = { headers: { "Cache-Control": "private, no-store" } };
  if (!session) {
    if (path === "/auth/me") return Response.json({ login: null }, { status: 401, ...noStore });
    // Un fetch no puede seguir el OAuth de GitHub: la API responde 401 JSON en vez de redirigir.
    if (path === "/api" || path.startsWith("/api/")) return Response.json({ error: "Sesión requerida" }, { status: 401, ...noStore });
    return redirect(`/auth/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (path === "/auth/me") return Response.json({ login: session.login }, noStore);
  if (!canAccess(session.login, url.pathname, restringidos)) {
    if (conBearer) return respuesta(403, { error: "Sin acceso a este proyecto" });
    return page(403, "Este proyecto es privado", `<p>@${esc(session.login)} no tiene acceso a este proyecto.</p><p>Pide acceso a quien administra el portal.</p><p><a href="/">Volver al portal</a></p>`);
  }
  return continuar(NO_STORE);
}
