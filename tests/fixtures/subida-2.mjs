// Ayudantes de los tests del lote G2 (emisión de tokens de subida en /auth/dispositivos). Amplían los de 1B-2 y G1
// sin tocarlos. La `sesion` de este archivo es la de 1B-2 (con `iat` = ahora): crear un token exige un login reciente.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { pedir, PAGINA, REVOCAR, FORM } from "./tokens-1b2.mjs";

export * from "./tokens-1b2.mjs";
export { RE_TOKEN_SUBIDA, CODIGO_ALCANCE, insertarToken, filaToken, cuantosTokens, esDenegada } from "./subida.mjs";

export const CREAR = "/auth/dispositivos/token";
export const TITULO_SECCION = "Tokens de subida";
export const MAX_SUBIDA = 5;
export const RE_VTS = /vts_[A-Za-z0-9_-]{43}/g;

export const texto = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

// Filas de tokens de subida tal cual están en D1 (sin pasar por el core), de la más antigua a la más nueva.
export const filasSubida = (env, login) =>
  env.DB.sqlite
    .prepare("SELECT id, hash, login, nombre, plataforma, tipo, alcance, creado, ultimo_uso, expira FROM tokens WHERE tipo = 'subida' AND (? IS NULL OR lower(login) = lower(?)) ORDER BY creado, id")
    .all(login ?? null, login ?? null)
    .map((f) => ({ ...f }));

const revocables = (raiz) =>
  [...(raiz?.querySelectorAll(`form[action="${REVOCAR}"]`) ?? [])].map((form) => ({
    form,
    fila: form.closest("li"),
    id: form.querySelector('input[name="id"]')?.value,
    csrf: form.querySelector('input[name="csrf"]')?.value,
    boton: form.querySelector("button"),
  }));

// Pide /auth/dispositivos y separa la sección «Tokens de subida» del resto. `seccion` es el <section> cuyo <h2> dice
// «Tokens de subida» (null si no aparece); `crear` es el formulario de creación y `campos` sus campos (name → value);
// `tokens` son las filas revocables de la sección y `dispositivos` las de fuera.
export async function paginaSubida(env, cookie, extra = {}) {
  const res = await pedir(PAGINA, { env, cookie, ...extra });
  const html = await res.clone().text();
  const doc = new JSDOM(html).window.document;
  const h2 = [...doc.querySelectorAll("h2")].find((h) => texto(h) === TITULO_SECCION) ?? null;
  const seccion = h2?.closest("section") ?? null;
  const crear = doc.querySelector(`form[action="${CREAR}"]`);
  const campos = Object.fromEntries([...(crear?.querySelectorAll("input") ?? [])].map((i) => [i.getAttribute("name"), i.value]));
  const tokens = revocables(seccion);
  const dispositivos = revocables(doc).filter((f) => !seccion || !seccion.contains(f.form));
  return { res, html, doc, h2, seccion, crear, campos, tokens, dispositivos };
}

// Envía el formulario de creación como lo haría el navegador (urlencoded, con Origin propio).
// `campos` puede ser un objeto, una lista de pares o el cuerpo ya codificado.
export function enviarCrear(env, { cookie, campos = {}, headers = FORM, method = "POST", path = CREAR, ...extra } = {}) {
  const body = method === "GET" || method === "HEAD" ? undefined : typeof campos === "string" ? campos : new URLSearchParams(campos).toString();
  return pedir(path, { env, method, cookie, headers, body, ...extra });
}

// Interpreta la respuesta de la creación: el token (el único `vts_…` del HTML) y el control que lo muestra.
export async function leerCreado(res) {
  const html = await res.clone().text();
  const doc = new JSDOM(html).window.document;
  const vistos = html.match(RE_VTS) ?? [];
  const control = doc.querySelector("textarea[readonly]");
  return { html, doc, vistos, control, token: vistos[0] ?? null };
}

// Flujo completo en el navegador: abrir la página, escribir el nombre y pulsar «Crear token». Devuelve el token en
// claro (único sitio donde aparece) y la respuesta ya interpretada.
export async function crearToken(env, cookie, nombre = "CLI de prueba") {
  const p = await paginaSubida(env, cookie);
  assert.equal(p.res.status, 200, "GET /auth/dispositivos con sesión debe responder 200");
  assert.ok(p.crear, `la página debe traer el formulario de creación (action=${CREAR})`);
  assert.ok(p.campos.csrf, "el formulario de creación lleva el campo oculto csrf");
  const res = await enviarCrear(env, { cookie, campos: { ...p.campos, nombre } });
  assert.equal(res.status, 200, "POST /auth/dispositivos/token con el formulario de la página debe responder 200");
  const creado = await leerCreado(res);
  assert.equal(creado.vistos.length, 1, "la respuesta trae el token exactamente una vez");
  return { ...creado, res, campos: { ...p.campos, nombre } };
}
