// Ayudantes de los tests del lote 1B-1 (revocación y página de dispositivos). Amplían los del lote A sin tocarlos.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ORIGIN, pedir } from "./tokens-app.mjs";

export * from "./tokens-app.mjs";

export const PAGINA = "/auth/dispositivos";
export const REVOCAR = "/auth/dispositivos/revocar";
export const API_LISTA = "/auth/app/dispositivos";
export const API_REVOCAR = "/auth/app/revocar";
export const FORM = { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN };
export const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Filas de la tabla de tokens tal cual están en D1 (sin pasar por el core).
export const filasTokens = (env) => env.DB.sqlite.prepare("SELECT id, hash, login, nombre, plataforma FROM tokens ORDER BY creado, id").all().map((f) => ({ ...f }));
export const codigos = (env) => env.DB.sqlite.prepare("SELECT hash, expira FROM codigos_app").all().map((f) => ({ ...f }));

// Pide la página y devuelve también el documento ya interpretado y una entrada por formulario de revocación.
export async function pagina(env, cookie, extra = {}) {
  const res = await pedir(PAGINA, { env, cookie, ...extra });
  const html = await res.clone().text();
  const doc = new JSDOM(html).window.document;
  const filas = [...doc.querySelectorAll(`form[action="${REVOCAR}"]`)].map((form) => ({
    form,
    fila: form.closest("li"),
    id: form.querySelector('input[name="id"]')?.value,
    csrf: form.querySelector('input[name="csrf"]')?.value,
    boton: form.querySelector("button"),
  }));
  return { res, html, doc, filas };
}

// Igual que pagina(), pero exige 200 y n formularios de revocación: los tests que usan filas[i] fallan con un mensaje claro.
export async function paginaCon(env, cookie, n) {
  const p = await pagina(env, cookie);
  assert.equal(p.res.status, 200, "GET /auth/dispositivos con sesión debe responder 200");
  assert.equal(p.filas.length, n, `la página debe traer ${n} formulario(s) de revocación (action=${REVOCAR})`);
  for (const f of p.filas) assert.ok(f.id && f.csrf, "cada formulario lleva los campos ocultos id y csrf");
  return p;
}

// Envía el formulario de revocación como lo haría el navegador (urlencoded, con Origin propio).
export function enviarRevocar(env, { cookie, campos = {}, headers = FORM, method = "POST", ...extra } = {}) {
  const body = method === "GET" ? undefined : new URLSearchParams(campos).toString();
  return pedir(REVOCAR, { env, method, cookie, headers, body, ...extra });
}

// Valor de la cabecera `Origin` que un navegador pone en el POST de un formulario (navegación, modo distinto de
// "cors", método distinto de GET/HEAD), según la Referrer-Policy del documento que lo envía. Es el paso «append a
// request `Origin` header» de Fetch (https://fetch.spec.whatwg.org/#append-a-request-origin-header):
//   no-referrer → `null`; same-origin → `null` salvo destino del mismo origen; no-referrer-when-downgrade, strict-origin
//   y strict-origin-when-cross-origin → `null` solo al bajar de https a http; el resto → el origen serializado.
// Sin cabecera se usa la política por omisión (strict-origin-when-cross-origin). Con varios valores vale el último.
export function origenDeNavegador(referrerPolicy, origenPagina, urlDestino) {
  const politica = (referrerPolicy ?? "").split(",").map((p) => p.trim().toLowerCase()).filter(Boolean).at(-1) ?? "strict-origin-when-cross-origin";
  const pagina = new URL(origenPagina);
  const destino = new URL(urlDestino);
  if (politica === "no-referrer") return "null";
  if (politica === "same-origin") return destino.origin === pagina.origin ? pagina.origin : "null";
  if (["no-referrer-when-downgrade", "strict-origin", "strict-origin-when-cross-origin"].includes(politica)) {
    return pagina.protocol === "https:" && destino.protocol !== "https:" ? "null" : pagina.origin;
  }
  return pagina.origin;
}

// Simula GitHub para /auth/callback. `miembro` y `publico` son los estados HTTP de las dos comprobaciones de acceso.
export function mockGitHub({ login, miembro = 404, publico = 404 }) {
  const vistas = [];
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    vistas.push(url);
    if (url.includes("/login/oauth/access_token")) return Response.json({ access_token: "gho_prueba" });
    if (url.endsWith("/user")) return Response.json({ login });
    if (url.includes("/user/memberships/orgs/")) return miembro === 200 ? Response.json({ state: "active" }) : new Response("{}", { status: miembro });
    if (url.includes("/public_members/")) return new Response(null, { status: publico });
    return new Response(null, { status: 404 });
  };
  return vistas;
}

export const callback = (env) =>
  pedir("/auth/callback?state=S&code=C", { env, cookie: `oauth_state=${encodeURIComponent(JSON.stringify({ state: "S", back: "/" }))}` });
