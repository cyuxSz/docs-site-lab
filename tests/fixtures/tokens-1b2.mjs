// Ayudantes de los tests del lote 1B-2 (consentimiento /auth/app/iniciar y emisión /auth/app/autorizar).
// Amplían los de los lotes 1A y 1B-1 sin tocarlos.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { JSDOM } from "jsdom";
import { pedir, pkce, FORM } from "./tokens-1b.mjs";

export * from "./tokens-1b.mjs";

export const INICIAR = "/auth/app/iniciar";
export const AUTORIZAR = "/auth/app/autorizar";
export const ESQUEMA = "vanttec-docs:";
export const RE_CODIGO = /^[A-Za-z0-9_-]{43}$/;
export const CAMPOS = ["challenge", "csrf", "nombre", "plataforma", "state"];

// Lo que genera la app antes de abrir el navegador: verifier (se lo queda), challenge S256 y state.
export function peticionApp(extra = {}) {
  const { verifier, challenge } = pkce();
  return { verifier, params: { challenge, state: randomBytes(32).toString("base64url"), nombre: "PC de Ana", plataforma: "windows", ...extra } };
}

// `params` puede ser un objeto o una lista de pares (para repetir o desordenar parámetros).
export const urlIniciar = (params, path = INICIAR) => `${path}?${new URLSearchParams(params)}`;

// Filas de codigos_app tal cual están en D1.
export const filasCodigos = (env) => env.DB.sqlite.prepare("SELECT hash, login, challenge, nombre, plataforma, expira FROM codigos_app ORDER BY expira, hash").all().map((f) => ({ ...f }));

// Pide la página de consentimiento y devuelve el documento, el formulario y sus campos (name → value).
export async function consentimiento(env, cookie, params, { path = INICIAR, ...extra } = {}) {
  const res = await pedir(urlIniciar(params, path), { env, cookie, ...extra });
  const html = await res.clone().text();
  const doc = new JSDOM(html).window.document;
  const form = doc.querySelector(`form[action="${AUTORIZAR}"]`);
  const campos = Object.fromEntries([...(form?.querySelectorAll("input") ?? [])].map((i) => [i.getAttribute("name"), i.value]));
  return { res, html, doc, form, campos, boton: form?.querySelector("button") ?? null };
}

// Igual, pero exige 200 y el formulario: los tests que lo usan fallan con un mensaje claro mientras la ruta no exista.
export async function consentir(env, cookie, params, opciones) {
  const c = await consentimiento(env, cookie, params, opciones);
  assert.equal(c.res.status, 200, "GET /auth/app/iniciar con sesión y parámetros válidos debe responder 200");
  assert.ok(c.form, `la página de consentimiento debe traer un formulario con action=${AUTORIZAR}`);
  assert.ok(c.campos.csrf, "el formulario lleva el campo oculto csrf");
  return c;
}

// Envía el formulario de consentimiento como lo haría el navegador (urlencoded, con Origin propio).
// `campos` puede ser un objeto, una lista de pares o el cuerpo ya codificado.
export function enviarAutorizar(env, { cookie, campos = {}, headers = FORM, method = "POST", path = AUTORIZAR, ...extra } = {}) {
  const body = method === "GET" ? undefined : typeof campos === "string" ? campos : new URLSearchParams(campos).toString();
  return pedir(path, { env, method, cookie, headers, body, ...extra });
}

// Interpreta la página «Listo»: el enlace al esquema propio, su destino y el <meta http-equiv="refresh">.
export async function leerListo(res) {
  const html = await res.clone().text();
  const doc = new JSDOM(html).window.document;
  const enlaces = [...doc.querySelectorAll("a[href]")].filter((a) => /^vanttec-docs:/i.test(a.getAttribute("href")));
  const enlace = enlaces[0] ?? null;
  const href = enlace?.getAttribute("href") ?? null;
  const destino = href ? new URL(href) : null;
  const meta = doc.querySelector('meta[http-equiv="refresh" i]');
  return { html, doc, enlaces, enlace, href, destino, meta, code: destino?.searchParams.get("code") ?? null, state: destino?.searchParams.get("state") ?? null };
}

// Flujo completo en el navegador: consentimiento + «Autorizar». Devuelve el código del enlace de la página «Listo».
export async function autorizar(env, cookie, params) {
  const c = await consentir(env, cookie, params);
  const res = await enviarAutorizar(env, { cookie, campos: c.campos });
  assert.equal(res.status, 200, "POST /auth/app/autorizar con el formulario del consentimiento debe responder 200");
  const listo = await leerListo(res);
  assert.ok(listo.enlace, "la página «Listo» debe traer el enlace vanttec-docs://auth?code=…&state=…");
  assert.match(listo.code ?? "", RE_CODIGO, "el enlace lleva un código de 43 caracteres base64url");
  return { ...listo, res, campos: c.campos };
}

// Directivas de una CSP como objeto { nombre: valor }.
export const directivasCsp = (res) =>
  Object.fromEntries((res.headers.get("content-security-policy") ?? "").split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v.join(" ")]));

// Un D1 que falla siempre, con un mensaje que no debe llegar al cliente.
export const d1Roto = () => ({
  prepare() {
    throw new Error("D1_ERROR: tabla secreta codigos_app");
  },
  batch() {
    throw new Error("D1_ERROR: tabla secreta codigos_app");
  },
});
