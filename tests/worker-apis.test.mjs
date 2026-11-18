// M2a: las APIs del portal (comentarios y archivos sobre R2) en el Worker de Cloudflare, probadas sin cuenta.
// El almacén es D1 (tests/fixtures/d1-sqlite.mjs, node:sqlite con la API del binding); R2 es un bucket falso en memoria
// con la forma de la API de Workers (put/get/delete). Ninguna API sale a la red: cualquier fetch hace fallar el test.
// Hardware responde en el Worker desde M2b (render en el navegador; ver tests/m2b-hardware-cliente.test.mjs).
// Los fallos del almacén a mitad de una subida se prueban en el core (tests/hardware-archivos.test.mjs).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEMO, ID_DEMO } from "./fixtures/acceso-demo.mjs";
import PROYECTOS_REALES from "../projects.json" with { type: "json" };
import { createHmac } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";

const root = new URL("../", import.meta.url);
const raiz = fileURLToPath(root);
const leer = (rel) => readFileSync(new URL(rel, root), "utf8");
const existe = (rel) => existsSync(new URL(rel, root));

// El portal no tiene proyectos restringidos: los tests inyectan la tabla de prueba (tests/fixtures/acceso-demo.mjs).
const cargarWorker = async () => (await import("../worker/index.mjs")).crearWorker({
  restringidos: DEMO,
  // El proyecto de prueba existe solo aquí, con cyuxSz de editor de electrónica, para que el 403 venga de canAccess.
  proyectos: [...PROYECTOS_REALES, { id: ID_DEMO, disciplinas: { electronica: { plantilla: "electronica", editores: ["cyuxSz", "ana"] } } }],
});
const cargarR2 = async () => import("../lib/almacen-r2.mjs");

const SECRET = "w".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const EDITOR = "cyuxSz"; // editor de uuv/electronica en projects.json y único con acceso a restringido-demo (tabla de prueba)
const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const ID2 = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const ID3 = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const MB = 1024 * 1024;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const PDF = new TextEncoder().encode("%PDF-1.4\n%prueba\n");
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const realFetch = globalThis.fetch;

// Sin red: el almacén es el binding D1 y los archivos van a R2; un fetch saliente es un error.
beforeEach(() => {
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Bucket R2 falso con la forma de R2Bucket: put(key, value, { httpMetadata }), get(key) → R2ObjectBody | null, delete(key).
function fakeR2() {
  const objetos = new Map();
  const puts = [];
  return {
    objetos,
    puts,
    async put(key, value, opciones = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      puts.push({ key, opciones, longitud: bytes.length });
      objetos.set(key, { bytes, httpMetadata: { ...(opciones.httpMetadata ?? {}) } });
      return { key, size: bytes.length };
    },
    async get(key) {
      const o = objetos.get(key);
      if (!o) return null;
      return { key, size: o.bytes.length, httpMetadata: o.httpMetadata, body: new Response(o.bytes).body };
    },
    async delete(key) {
      objetos.delete(key);
    },
  };
}

function crearEnv(extra = {}) {
  const llamadas = [];
  const ASSETS = {
    async fetch(req) {
      llamadas.push(req);
      return new Response("<h1>asset</h1>", { headers: { "content-type": "text/html" } });
    },
  };
  const ARCHIVOS = fakeR2();
  const env = {
    GITHUB_CLIENT_ID: "cid",
    GITHUB_CLIENT_SECRET: "csecret",
    SESSION_SECRET: SECRET,
    ALLOWED_ORG: "vanttec",
    ALLOWED_USERS: "",
    DB: crearD1(),
    ASSETS,
    ARCHIVOS,
    ...extra,
  };
  return { env, llamadas, r2: ARCHIVOS };
}

function sesion(login, secret = SECRET) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${mac}`)}`;
}

async function pedir(path, { login, method = "GET", headers = {}, env, body, origin = ORIGIN } = {}) {
  const worker = await cargarWorker();
  const h = { ...headers };
  if (login) h.cookie = sesion(login);
  if (method !== "GET" && origin && !("origin" in h)) h.origin = origin;
  const req = new Request(`${ORIGIN}${path}`, { method, headers: h, body });
  return worker.fetch(req, env ?? crearEnv().env, { waitUntil() {}, passThroughOnException() {} });
}

const qs = (o) => new URLSearchParams(o).toString();

// Subida directa (modo Cloudflare): cuerpo binario + metadatos en la query.
function subir(env, { login = EDITOR, proyecto = "uuv", disciplina = "electronica", id = ID, nombre = "placa.png", bytes = PNG, ct = "application/octet-stream", largo = bytes.length, origin = ORIGIN, conLargo = true } = {}) {
  const headers = { "content-type": ct };
  if (conLargo) headers["content-length"] = String(largo);
  return pedir(`/api/archivos/?${qs({ proyecto, disciplina, id, nombre })}`, { env, login, method: "POST", headers, body: bytes, origin });
}
const getArchivo = (env, id, login = "ana", proyecto = "uuv") => pedir(`/api/archivos/?${qs({ proyecto, id })}`, { env, login });
const borrar = (env, id, login = EDITOR, proyecto = "uuv", origin = ORIGIN) =>
  pedir("/api/archivos/", { env, login, method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ proyecto, id }), origin });

// ---------- Rutas ----------

test("rutas: /api/comentarios, /api/archivos con y sin barra llegan a su API (ya no 501)", async () => {
  const { env, llamadas } = crearEnv();
  for (const path of ["/api/comentarios/?pagina=%2Fuuv%2Farquitectura%2F", "/api/comentarios?pagina=%2Fuuv%2Farquitectura%2F"]) {
    const res = await pedir(path, { env, login: "ana" });
    assert.equal(res.status, 200, path);
    assert.deepEqual((await res.json()).comentarios, [], path);
  }
  for (const path of ["/api/archivos/?proyecto=uuv&lista=1", "/api/archivos?proyecto=uuv&lista=1"]) {
    const res = await pedir(path, { env, login: "ana" });
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), { archivos: [] }, path);
  }
  assert.equal(llamadas.length, 0, "las APIs no pasan por ASSETS");
});

test("rutas: /api/hardware con y sin barra llega a hardware-core (M2b: ya no 501)", async () => {
  const { env, llamadas } = crearEnv();
  for (const path of ["/api/hardware/?proyecto=uuv&disciplina=electronica", "/api/hardware?proyecto=uuv&disciplina=electronica"]) {
    const res = await pedir(path, { env, login: "ana" });
    assert.equal(res.status, 200, path);
    const j = await res.json();
    assert.equal(j.editable, false, path);
    assert.deepEqual(j.paginas, [], path);
  }
  assert.equal(llamadas.length, 0);
});

test("rutas: /api desconocidas responden 404 JSON con las cabeceras globales y sin tocar ASSETS", async () => {
  const { env, llamadas } = crearEnv();
  for (const path of ["/api", "/api/", "/api/otra", "/api/comentarios/x", "/api/archivos/x/", "/api/COMENTARIOS/", "/api/comentarios%2F"]) {
    const res = await pedir(path, { env, login: "ana" });
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/, path);
    assert.equal(typeof (await res.json()).error, "string", path);
    assert.equal(res.headers.get("x-frame-options"), "DENY", path);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, path);
  }
  assert.equal(llamadas.length, 0);
});

test("rutas: método no permitido → 405 con Allow, como en Vercel", async () => {
  const { env } = crearEnv();
  const c = await pedir("/api/comentarios/", { env, login: "ana", method: "PUT", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(c.status, 405);
  assert.equal(c.headers.get("allow"), "GET, POST, PATCH, DELETE");
  const a = await pedir("/api/archivos/", { env, login: "ana", method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(a.status, 405);
  assert.equal(a.headers.get("allow"), "GET, POST, DELETE");
});

test("rutas: sin sesión → 401 en las APIs (también la subida directa), sin escribir en R2", async () => {
  const { env, r2 } = crearEnv();
  assert.equal((await pedir("/api/comentarios/?pagina=%2Fuuv%2Farquitectura%2F", { env })).status, 401);
  assert.equal((await subir(env, { login: null })).status, 401);
  assert.equal(r2.puts.length, 0);
});

test("worker: no lee process.env (variables solo de env)", async () => {
  const antes = { s: process.env.SESSION_SECRET };
  delete process.env.SESSION_SECRET;
  try {
    const { env } = crearEnv();
    const res = await pedir("/api/archivos/?proyecto=uuv&lista=1", { env, login: "ana" });
    assert.equal(res.status, 200);
  } finally {
    if (antes.s !== undefined) process.env.SESSION_SECRET = antes.s;
  }
});

// ---------- Comentarios ----------

test("comentarios: crear y leer contra D1 desde el Worker", async () => {
  const { env } = crearEnv();
  const nuevo = await pedir("/api/comentarios", { env, login: "ana", method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pagina: "/uuv/arquitectura/", tipo: "duda", texto: "hola desde el Worker" }) });
  assert.equal(nuevo.status, 201);
  const res = await pedir("/api/comentarios/?pagina=%2Fuuv%2Farquitectura%2F", { env, login: "ana" });
  assert.equal(res.status, 200);
  const { comentarios } = await res.json();
  assert.equal(comentarios.length, 1);
  assert.equal(comentarios[0].texto, "hola desde el Worker");
});

test("comentarios: escritura desde otro origen → 403; proyecto restringido aplica canAccess", async () => {
  const { env } = crearEnv();
  const ajeno = await pedir("/api/comentarios/", { env, login: "ana", method: "POST", origin: "https://evil.example", headers: { "content-type": "application/json" }, body: JSON.stringify({ pagina: "/uuv/arquitectura/", tipo: "duda", texto: "x" }) });
  assert.equal(ajeno.status, 403);
  assert.equal((await pedir("/api/comentarios/?pagina=%2Frestringido-demo%2Farquitectura%2F", { env, login: "ana" })).status, 403);
  assert.equal((await pedir("/api/comentarios/?pagina=%2Frestringido-demo%2Farquitectura%2F", { env, login: EDITOR })).status, 200);
});

test("comentarios: sin binding DB → 503 (con sesión), aunque queden variables KV_REST_* viejas", async () => {
  const { env } = crearEnv({ DB: undefined, KV_REST_API_URL: "https://almacen-viejo.prueba", KV_REST_API_TOKEN: "tok" });
  const res = await pedir("/api/comentarios/?pagina=%2Fuuv%2Farquitectura%2F", { env, login: "ana" });
  assert.equal(res.status, 503);
});

// ---------- Archivos sobre R2 ----------

test("archivos: capacidades → { subida: 'directa' } en el Worker; sin binding ARCHIVOS → 503", async () => {
  const { env } = crearEnv();
  const res = await pedir("/api/archivos/?capacidades=1", { env, login: "ana" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { subida: "directa" });
  const sin = crearEnv({ ARCHIVOS: undefined }).env;
  assert.equal((await pedir("/api/archivos/?capacidades=1", { env: sin, login: "ana" })).status, 503);
  assert.equal((await subir(sin)).status, 503);
});

test("archivos: subir PNG y PDF, leerlos con las cabeceras de hoy y borrarlos", async () => {
  const { env, r2 } = crearEnv();
  const png = await subir(env, { id: ID, nombre: "placa.png", bytes: PNG });
  assert.equal(png.status, 201);
  assert.equal((await png.json()).id, ID);
  const pdf = await subir(env, { id: ID2, nombre: "esquema v2.pdf", bytes: PDF });
  assert.equal(pdf.status, 201);

  // Clave R2 única por intento (<id>-<uuid>-<nombre>) para que dos subidas del mismo id no se pisen, y Content-Type de la lista blanca, no del cliente.
  const clavePng = [...r2.objetos.keys()].find((k) => new RegExp(`^hw/uuv/electronica/${ID}-[0-9a-f-]{36}-placa\.png$`).test(k));
  assert.ok(clavePng, [...r2.objetos.keys()].join(", "));
  assert.equal(r2.objetos.get(clavePng).httpMetadata.contentType, "image/png");
  assert.ok([...r2.objetos.keys()].some((k) => new RegExp(`^hw/uuv/electronica/${ID2}-[0-9a-f-]{36}-esquema-v2\.pdf$`).test(k)));

  const lista = await (await pedir("/api/archivos/?proyecto=uuv&lista=1", { env, login: "ana" })).json();
  assert.deepEqual(lista.archivos.map((a) => a.id).sort(), [ID, ID2].sort());
  assert.ok(lista.archivos.every((a) => !("blobUrl" in a) && !("clave" in a)), "la clave de R2 no sale al cliente");

  const g = await getArchivo(env, ID);
  assert.equal(g.status, 200);
  assert.deepEqual(new Uint8Array(await g.arrayBuffer()), PNG);
  assert.equal(g.headers.get("content-type"), "image/png");
  assert.equal(g.headers.get("x-content-type-options"), "nosniff");
  assert.match(g.headers.get("content-disposition") ?? "", /^inline; filename="placa\.png"/);
  assert.match(g.headers.get("cache-control") ?? "", /no-store/);

  const gp = await getArchivo(env, ID2);
  assert.equal(gp.headers.get("content-type"), "application/pdf");
  assert.match(gp.headers.get("content-disposition") ?? "", /^inline; filename="esquema-v2\.pdf"/);

  assert.equal((await borrar(env, ID)).status, 200);
  assert.ok(!r2.objetos.has(clavePng), "borra el objeto de R2");
  assert.equal((await getArchivo(env, ID)).status, 404);
  // Un id borrado no se puede reutilizar (lápida, como hoy).
  assert.equal((await subir(env, { id: ID })).status, 409);
});

test("archivos: SVG se sirve como adjunto con la CSP sandbox propia (el Worker no la pisa con la global)", async () => {
  const { env } = crearEnv();
  assert.equal((await subir(env, { id: ID3, nombre: "logo.svg", bytes: SVG })).status, 201);
  const g = await getArchivo(env, ID3);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("content-type"), "image/svg+xml");
  assert.match(g.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(g.headers.get("content-security-policy"), "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(g.headers.get("x-content-type-options"), "nosniff");
});

test("archivos: no editor → 403; proyecto restringido → 403 sin revelar; nada llega a R2", async () => {
  const { env, r2 } = crearEnv();
  assert.equal((await subir(env, { login: "ana" })).status, 403);
  assert.equal((await subir(env, { login: "ana", proyecto: "restringido-demo" })).status, 403);
  assert.equal((await pedir("/api/archivos/?proyecto=restringido-demo&lista=1", { env, login: "ana" })).status, 403);
  assert.equal((await pedir("/api/archivos/?proyecto=restringido-demo&lista=1", { env, login: EDITOR })).status, 200);
  assert.equal(r2.puts.length, 0);
});

test("archivos: tipo no permitido, tamaño mayor que el máximo o cuerpo distinto del declarado → rechazo sin escribir", async () => {
  const { env, r2 } = crearEnv();
  assert.equal((await subir(env, { nombre: "virus.exe" })).status, 400);
  assert.equal((await subir(env, { nombre: "sin-extension" })).status, 400);
  // Imagen: máximo 10 MB. El rechazo es por la cabecera, antes de leer el cuerpo.
  assert.equal((await subir(env, { nombre: "enorme.png", largo: 10 * MB + 1 })).status, 413);
  // Resto: máximo 50 MB (por debajo de los 100 MB de Workers Free).
  assert.equal((await subir(env, { nombre: "enorme.pdf", largo: 50 * MB + 1 })).status, 413);
  // Declara menos bytes de los que manda: no se guarda nada.
  const mentira = await subir(env, { id: ID2, largo: 3 });
  assert.ok([400, 413].includes(mentira.status), `cuerpo mayor que Content-Length → ${mentira.status}`);
  // Sin Content-Length → 411.
  assert.equal((await subir(env, { id: ID2, conLargo: false })).status, 411);
  assert.equal((await subir(env, { id: ID2, largo: 0, bytes: new Uint8Array() })).status, 400);
  assert.equal(r2.objetos.size, 0, [...r2.objetos.keys()].join(", "));
  const lista = await (await pedir("/api/archivos/?proyecto=uuv&lista=1", { env, login: "ana" })).json();
  assert.deepEqual(lista.archivos, []);
});

test("archivos: la subida exige mismo origen, octet-stream e id/disciplina válidos", async () => {
  const { env, r2 } = crearEnv();
  assert.equal((await subir(env, { origin: "https://evil.example" })).status, 403);
  assert.equal((await subir(env, { origin: null })).status, 403);
  assert.equal((await subir(env, { ct: "multipart/form-data; boundary=x" })).status, 415);
  assert.equal((await subir(env, { ct: "text/plain" })).status, 415);
  assert.equal((await subir(env, { id: "no-es-uuid" })).status, 400);
  assert.equal((await subir(env, { disciplina: "quimica" })).status, 404);
  assert.equal(r2.puts.length, 0);
  // El borrado también exige mismo origen.
  assert.equal((await subir(env)).status, 201);
  assert.equal((await borrar(env, ID, EDITOR, "uuv", "https://evil.example")).status, 403);
  assert.equal((await borrar(env, ID, "ana")).status, 403, "no editor no borra");
  assert.equal(r2.objetos.size, 1);
});

test("archivos: no hay token ni callback de subida firmada: esos cuerpos se rechazan sin escribir en R2", async () => {
  const { env, r2 } = crearEnv();
  const token = await pedir("/api/archivos/", { env, login: EDITOR, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "blob.generate-client-token", payload: { pathname: `hw/uuv/electronica/${ID}-placa.png`, multipart: false, clientPayload: JSON.stringify({ proyecto: "uuv", disciplina: "electronica", nombre: "placa.png", tamano: 10 }) } }) });
  assert.ok(token.status >= 400 && token.status < 500, `token → ${token.status}`);
  const cb = await pedir("/api/archivos/", { env, login: EDITOR, method: "POST", headers: { "content-type": "application/json", "x-vercel-signature": "x" }, body: JSON.stringify({ type: "blob.upload-completed", payload: {} }) });
  assert.ok(cb.status >= 400 && cb.status < 500, `callback → ${cb.status}`);
  assert.equal(r2.puts.length, 0);
});

// ---------- Adaptador R2 ----------

test("almacen-r2: subir/leer/borrar sobre el binding con la interfaz que espera archivos-core", async () => {
  const { crearAlmacenR2 } = await cargarR2();
  assert.equal(typeof crearAlmacenR2, "function");
  const bucket = fakeR2();
  const a = crearAlmacenR2(bucket);
  assert.equal(typeof a.subir, "function");
  assert.equal(typeof a.leer, "function");
  assert.equal(typeof a.borrar, "function");
  assert.equal(a.handleUpload, undefined, "sin handleUpload: el core usa la subida directa");
  await a.subir("hw/uuv/electronica/x-a.png", new Response(PNG).body, { longitud: PNG.length, contentType: "image/png" });
  assert.equal(bucket.objetos.get("hw/uuv/electronica/x-a.png").httpMetadata.contentType, "image/png");
  const o = await a.leer("hw/uuv/electronica/x-a.png");
  assert.equal(o.size, PNG.length);
  assert.equal(o.contentType, "image/png");
  assert.deepEqual(new Uint8Array(await new Response(o.stream).arrayBuffer()), PNG);
  assert.equal(await a.leer("no/existe"), null);
  await a.borrar("hw/uuv/electronica/x-a.png");
  assert.equal(bucket.objetos.size, 0);
});

// ---------- Sin Vercel ni Upstash ----------

test("archivos-core: solo R2; BLOB_READ_WRITE_TOKEN no activa ningún almacén y capacidades nunca dice 'blob'", async () => {
  const { crearHandler } = await import("../lib/archivos-core.mjs");
  const proyectos = [{ id: "uuv", disciplinas: { electronica: { editores: [EDITOR] } } }];
  const conToken = crearHandler({ env: { SESSION_SECRET: SECRET, BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_falso" }, redis: fakeRedis(), proyectos });
  const cap = await conToken(new Request(`${ORIGIN}/api/archivos/?capacidades=1`, { headers: { cookie: sesion("ana") } }));
  assert.equal(cap.status, 503, "sin almacén R2 inyectado no hay archivos, haya o no token de Blob");
  const r2 = (await cargarR2()).crearAlmacenR2(fakeR2());
  const conR2 = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: fakeRedis(), blob: r2, proyectos });
  const ok = await conR2(new Request(`${ORIGIN}/api/archivos/?capacidades=1`, { headers: { cookie: sesion("ana") } }));
  assert.deepEqual(await ok.json(), { subida: "directa" });
});

test("cores: sin @vercel/*, sin cliente Upstash (clienteRedis, /pipeline, KV_REST_*, UPSTASH_*) ni subida de Blob", async () => {
  for (const f of ["lib/api-comun.mjs", "lib/comentarios-core.mjs", "lib/hardware-core.mjs", "lib/archivos-core.mjs", "lib/almacen-r2.mjs", "lib/login-core.mjs", "worker/index.mjs"]) {
    const src = leer(f);
    assert.doesNotMatch(src, /@vercel\//, `${f} importa @vercel/*`);
    assert.doesNotMatch(src, /\bclienteRedis\b|\/pipeline|KV_REST_API|UPSTASH_REDIS/, `${f} conserva el cliente de Upstash`);
    assert.doesNotMatch(src, /handleUpload|blob\.generate-client-token|blob\.upload-completed|BLOB_READ_WRITE_TOKEN|x-vercel-signature/, `${f} conserva la subida de Vercel Blob`);
  }
  const comun = await import("../lib/api-comun.mjs");
  assert.equal(comun.clienteRedis, undefined, "api-comun ya no exporta clienteRedis");
  const com = await import("../lib/comentarios-core.mjs");
  assert.equal(com.clienteRedis, undefined, "comentarios-core ya no reexporta clienteRedis");
});

// ---------- Cliente del navegador ----------

test("cliente: sube siempre directo al Worker (urlSubidaDirecta), sin upload() de @vercel/blob/client ni modo 'blob'", () => {
  const src = leer("src/scripts/hardware-editor.ts");
  assert.match(src, /urlSubidaDirecta\(/, "modo directo con la URL de src/lib/hardware-editor.ts");
  assert.doesNotMatch(src, /@vercel\/blob/, "sin el SDK de Vercel Blob");
  assert.doesNotMatch(src, /\bupload\s*\(/, "sin upload() del SDK");
  assert.doesNotMatch(src, /["']blob["']/, "sin el modo de subida 'blob'");
  assert.doesNotMatch(leer("src/lib/hardware-editor.ts"), /\brutaBlob\b/, "sin el pathname de Blob (rutaBlob)");
});

test("cliente: urlSubidaDirecta arma /api/archivos/?proyecto&disciplina&id&nombre (nombre saneado y codificado)", async () => {
  const lib = await import("../src/lib/hardware-editor.ts");
  assert.equal(typeof lib.urlSubidaDirecta, "function");
  const u = new URL(lib.urlSubidaDirecta("uuv", "electronica", ID, "../mi foto&x=1.png"), ORIGIN);
  assert.equal(u.pathname, "/api/archivos/");
  assert.equal(u.searchParams.get("proyecto"), "uuv");
  assert.equal(u.searchParams.get("disciplina"), "electronica");
  assert.equal(u.searchParams.get("id"), ID);
  assert.equal(u.searchParams.get("nombre"), "mi-foto-x-1.png");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["disciplina", "id", "nombre", "proyecto"]);
});

// ---------- Configuración ----------

function jsonc(texto) {
  let out = "";
  for (let i = 0, cad = false; i < texto.length; i++) {
    const c = texto[i];
    if (cad) {
      out += c;
      if (c === "\\") out += texto[++i];
      else if (c === '"') cad = false;
    } else if (c === '"') {
      cad = true;
      out += c;
    } else if (c === "/" && texto[i + 1] === "/") {
      while (i < texto.length && texto[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && texto[i + 1] === "*") {
      i = texto.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

test("wrangler.jsonc: binding R2 ARCHIVOS → docs-hardware; .dev.vars.example sin valores y sin Upstash", () => {
  const c = jsonc(leer("wrangler.jsonc"));
  assert.deepEqual(c.r2_buckets, [{ binding: "ARCHIVOS", bucket_name: "docs-hardware" }]);
  assert.ok(!c.vars || !Object.keys(c.vars).some((k) => /KV_REST|TOKEN|SECRET/.test(k)), "las credenciales no van en vars");
  const ej = leer(".dev.vars.example").split(/\r?\n/);
  for (const k of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET", "ALLOWED_ORG", "ALLOWED_USERS"]) assert.ok(ej.includes(`${k}=`), `${k}= sin valor`);
  assert.ok(!ej.some((l) => /^(KV_REST_API|UPSTASH_|BLOB_READ_WRITE)/.test(l)), ".dev.vars.example ya no lista credenciales de Upstash ni de Blob");
});

test("README: la sección de Cloudflare describe R2 (ARCHIVOS) y hardware, sin Upstash", () => {
  const md = leer("README.md");
  const i = md.indexOf("## Cloudflare");
  assert.ok(i >= 0);
  const fin = md.indexOf("\n## ", i + 1);
  const sec = md.slice(i, fin === -1 ? undefined : fin);
  assert.match(sec, /ARCHIVOS/);
  assert.match(sec, /docs-hardware/);
  assert.doesNotMatch(sec, /KV_REST_API_URL|upstash/i, "Upstash ya no se documenta");
  assert.match(sec, /hardware/i);
  assert.doesNotMatch(sec, /`\/api\/\*` responde 501 hasta M2/, "la frase de M1 ya no es cierta");
});

// ---------- Medición de CPU del render ----------

test("tools/medir-render.mjs mide el render de satteri e indica el umbral de 10 ms", () => {
  assert.ok(existe("tools/medir-render.mjs"), "falta tools/medir-render.mjs");
  const r = spawnSync(process.execPath, ["tools/medir-render.mjs", "--iteraciones", "3"], { cwd: raiz, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /p50/i);
  assert.match(r.stdout, /10 ms/);
  assert.match(r.stdout, /KB|KiB/);
});

// ---------- Empaquetado real con wrangler ----------

test("wrangler: el Worker se empaqueta (deploy --dry-run) sin satteri ni process.env", { timeout: 180_000 }, () => {
  const bin = join(raiz, "node_modules", "wrangler", "bin", "wrangler.js");
  if (!existsSync(bin)) return assert.fail("falta wrangler en node_modules");
  const tmp = mkdtempSync(join(tmpdir(), "worker-m2-"));
  try {
    // Config temporal sin assets (dist/ puede no existir en CI); mismo main, flags y R2.
    const c = jsonc(leer("wrangler.jsonc"));
    const conf = { name: c.name, main: join(raiz, c.main), compatibility_date: c.compatibility_date, compatibility_flags: c.compatibility_flags, r2_buckets: c.r2_buckets };
    writeFileSync(join(tmp, "wrangler.json"), JSON.stringify(conf));
    const r = spawnSync(process.execPath, [bin, "deploy", "--dry-run", "--outdir", join(tmp, "out"), "-c", join(tmp, "wrangler.json")], { cwd: raiz, encoding: "utf8", timeout: 170_000, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const js = readFileSync(join(tmp, "out", "index.js"), "utf8");
    assert.doesNotMatch(js, /satteri|markdownToMdast|markdownToHtml/, "satteri no puede entrar en el Worker");
    assert.match(js, /hw:lock:/, "M2b: hardware-core sí va en el bundle");
    assert.doesNotMatch(js, /from\s*["']node:(?!crypto|buffer)/, "sin otros módulos de Node en el bundle");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

