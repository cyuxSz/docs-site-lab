// Ayudantes de los tests de tokens de dispositivo (lote A: almacén + canje + Bearer).
// Todo pasa por el Worker (crearWorker().fetch) con D1 de prueba (node:sqlite + migrations/*.sql) y R2 en memoria.
// El reloj se controla con mock.timers de node:test (solo Date), así que el código bajo prueba debe leer Date.now()
// en el momento de usarlo, sin guardar la referencia al cargar el módulo.
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { DEMO, ID_DEMO } from "./acceso-demo.mjs";
import { crearD1 } from "./d1-sqlite.mjs";
import PROYECTOS_REALES from "../../projects.json" with { type: "json" };

export const SECRET = "w".repeat(40);
export const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
export const EDITOR = "cyuxSz"; // editor de uuv/electronica y único con acceso a restringido-demo
export const T0 = Date.parse("2026-11-21T12:00:00Z");
export const DIA = 864e5;
export const TREINTA_DIAS = 30 * DIA;
export const RE_TOKEN = /^vtd_[A-Za-z0-9_-]{43}$/;
export const PAG = "/uuv/arquitectura/";

export const cargarWorker = async () =>
  (await import("../../worker/index.mjs")).crearWorker({
    restringidos: DEMO,
    proyectos: [...PROYECTOS_REALES, { id: ID_DEMO, disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR, "ana"] } } }],
  });
// Import dinámico: mientras el módulo no exista, fallan solo los tests que lo usan (ERR_MODULE_NOT_FOUND).
export const cargarCore = async () => import("../../lib/dispositivos-core.mjs");

function fakeR2() {
  const objetos = new Map();
  return {
    objetos,
    async put(key, value, opciones = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objetos.set(key, { bytes, httpMetadata: { ...(opciones.httpMetadata ?? {}) } });
      return { key, size: bytes.length };
    },
    async get(key) {
      const o = objetos.get(key);
      return o ? { key, size: o.bytes.length, httpMetadata: o.httpMetadata, body: new Response(o.bytes).body } : null;
    },
    async delete(key) {
      objetos.delete(key);
    },
  };
}

export function crearEnv(extra = {}) {
  const llamadas = [];
  const ASSETS = {
    async fetch(req) {
      llamadas.push(req);
      return new Response("<h1>asset</h1>", { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  };
  const env = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, ALLOWED_ORG: "vanttec", ALLOWED_USERS: "", DB: crearD1(), ASSETS, ARCHIVOS: fakeR2(), ...extra };
  return { env, llamadas };
}

// Misma firma que sign() de lib/sesion.mjs.
export function sesion(login, secret = SECRET) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + DIA })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

export const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
export const tokenFalso = () => `vtd_${randomBytes(32).toString("base64url")}`;

// PKCE S256 (RFC 7636): verifier de 43 caracteres base64url y su challenge.
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

// Ninguna respuesta del Worker lleva CORS: se comprueba en todas las que pasan por pedir().
export function sinCors(res, que = "") {
  for (const [k] of res.headers) assert.ok(!k.toLowerCase().startsWith("access-control-"), `${que}: no debe haber ${k}`);
}

export async function pedir(path, { env, method = "GET", headers = {}, body, cookie, bearer, autorizacion } = {}) {
  const worker = await cargarWorker();
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (bearer !== undefined) h.authorization = `Bearer ${bearer}`;
  if (autorizacion !== undefined) h.authorization = autorizacion;
  const req = new Request(`${ORIGIN}${path}`, { method, headers: h, body });
  const res = await worker.fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
  sinCors(res, `${method} ${path}`);
  return res;
}

let nIp = 0;
// Cada llamada sale de una IP distinta salvo que se fije una: el límite de tasa del canje es por CF-Connecting-IP.
export function canje(env, cuerpo, { ip, headers = {}, path = "/auth/app/canje", method = "POST", ct = "application/json" } = {}) {
  const h = { "cf-connecting-ip": ip ?? `198.51.100.${(nIp++ % 250) + 1}`, ...headers };
  if (ct) h["content-type"] = ct;
  const body = method === "GET" || method === "HEAD" ? undefined : typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
  return pedir(path, { env, method, headers: h, body });
}

// Crea un código como lo hará /auth/app/autorizar (lote B) y devuelve también el verifier que solo conoce la app.
export async function nuevoCodigo(env, { login = "ana", nombre = "PC de Ana", plataforma = "windows" } = {}) {
  const { crearCodigo } = await cargarCore();
  const { verifier, challenge } = pkce();
  const code = await crearCodigo(env.DB, { login, challenge, nombre, plataforma });
  return { code, verifier, challenge };
}

// Flujo completo: código + canje. Devuelve el token en claro (único sitio donde aparece).
export async function emitir(env, opciones = {}) {
  const { code, verifier } = await nuevoCodigo(env, opciones);
  const res = await canje(env, { code, verifier });
  assert.equal(res.status, 200, "el canje de un código recién creado debe responder 200");
  const json = await res.json();
  assert.match(json.token, RE_TOKEN);
  return { ...json, code, verifier };
}

export async function dispositivos(env, login) {
  const { listarDispositivos } = await cargarCore();
  return listarDispositivos(env.DB, login);
}

// Vuelca todas las tablas de D1 como texto, para comprobar qué se guarda y qué no.
export function volcado(env) {
  const db = env.DB.sqlite;
  const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  return tablas.map((t) => `${t}:${JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())}`).join("\n");
}

// Captura todo lo que se escriba por console.* mientras corre fn.
export async function conConsola(fn) {
  const niveles = ["log", "info", "warn", "error", "debug", "trace"];
  const originales = Object.fromEntries(niveles.map((n) => [n, console[n]]));
  const lineas = [];
  for (const n of niveles) console[n] = (...a) => lineas.push(a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.stack}` : JSON.stringify(x))).join(" "));
  try {
    await fn();
  } finally {
    for (const n of niveles) console[n] = originales[n];
  }
  return lineas.join("\n");
}
