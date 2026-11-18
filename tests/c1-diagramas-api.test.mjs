// C1: los diagramas se guardan como archivos normales de /api/archivos (fuente .excalidraw/.drawio + .svg) en el Worker
// de Cloudflare (R2 + D1 de prueba), y la página se actualiza con PUT /api/hardware. Solo los editores de la
// disciplina pueden subir o guardar; cualquier lector con acceso al proyecto ve el SVG (con la CSP sandbox de siempre)
// y descarga la fuente como adjunto (nunca en línea).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";

const SECRET = "c".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const EDITOR = "cyuxSz"; // editor de uuv/electronica (y mecanica) en projects.json
const LECTOR = "ana";
const ID_F = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const ID_S = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const MB = 1024 * 1024;
const EXCALIDRAW = new TextEncoder().encode(JSON.stringify({ type: "excalidraw", version: 2, source: "docs", elements: [], appState: {}, files: {} }));
const DRAWIO = new TextEncoder().encode('<mxfile><diagram id="a" name="P">x</diagram></mxfile>');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const realFetch = globalThis.fetch;
// Sin red: el almacén es el binding D1 (tests/fixtures/d1-sqlite.mjs); un fetch saliente es un error.
let db;
beforeEach(() => {
  db = crearD1();
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeR2() {
  const objetos = new Map();
  return {
    objetos,
    async put(key, value, opciones = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objetos.set(key, { bytes, httpMetadata: { ...(opciones.httpMetadata ?? {}) } });
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
const crearEnv = () => ({
  SESSION_SECRET: SECRET,
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "cs",
  ALLOWED_ORG: "vanttec",
  ALLOWED_USERS: "",
  DB: db,
  ASSETS: { fetch: async () => new Response("<h1>x</h1>", { headers: { "content-type": "text/html" } }) },
  ARCHIVOS: fakeR2(),
});
function sesion(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
async function pedir(env, path, { login, method = "GET", headers = {}, body } = {}) {
  const worker = (await import("../worker/index.mjs")).default;
  const h = { ...headers };
  if (login) h.cookie = sesion(login);
  if (method !== "GET") h.origin = ORIGIN;
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body }), env, { waitUntil() {}, passThroughOnException() {} });
}
const qs = (o) => new URLSearchParams(o).toString();
const subir = (env, { login = EDITOR, id, nombre, bytes, disciplina = "electronica", largo = bytes.length }) =>
  pedir(env, `/api/archivos/?${qs({ proyecto: "uuv", disciplina, id, nombre })}`, {
    login,
    method: "POST",
    headers: { "content-type": "application/octet-stream", "content-length": String(largo) },
    body: bytes,
  });

// ---------- Tipos de archivo ----------

test("TIPOS: .excalidraw y .drawio permitidos, nunca en línea, con tamaño máximo razonable; .svg sigue igual", async () => {
  const { TIPOS } = await import("../lib/archivos-nombre.mjs");
  for (const ext of ["excalidraw", "drawio"]) {
    assert.ok(Object.hasOwn(TIPOS, ext), ext);
    assert.equal(TIPOS[ext].inline, false, `${ext} se descarga como adjunto`);
    assert.equal(TIPOS[ext].mime, "application/octet-stream", `${ext}: el navegador nunca lo interpreta`);
    assert.ok(TIPOS[ext].max >= 1 * MB && TIPOS[ext].max <= 20 * MB, `${ext}: entre 1 y 20 MB`);
  }
  assert.deepEqual(TIPOS.svg, { mime: "image/svg+xml", max: 10 * MB, inline: false });
});

test("validarArchivo del cliente acepta las fuentes de diagrama (misma lista blanca que el servidor)", async () => {
  const { validarArchivo } = await import("../src/lib/hardware-editor.ts");
  assert.deepEqual(validarArchivo({ name: "cableado.excalidraw", size: 900 }), { ok: true, tipo: "excalidraw", imagen: false });
  assert.deepEqual(validarArchivo({ name: "bloques.drawio", size: 600 }), { ok: true, tipo: "drawio", imagen: false });
});

// ---------- Guardar: subida de fuente + SVG y permisos ----------

test("editor de la disciplina sube .excalidraw, .drawio y .svg (201); el lector no (403) y sin sesión 401", async () => {
  const env = crearEnv();
  assert.equal((await subir(env, { id: ID_F, nombre: "cableado.excalidraw", bytes: EXCALIDRAW })).status, 201);
  assert.equal((await subir(env, { id: ID_S, nombre: "cableado.svg", bytes: SVG })).status, 201);
  assert.equal((await subir(env, { id: "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c", nombre: "bloques.drawio", bytes: DRAWIO })).status, 201);
  const otro = "1b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3d";
  assert.equal((await subir(env, { login: LECTOR, id: otro, nombre: "x.drawio", bytes: DRAWIO })).status, 403);
  assert.equal((await subir(env, { login: LECTOR, id: otro, nombre: "x.excalidraw", bytes: EXCALIDRAW })).status, 403);
  assert.equal((await subir(env, { login: null, id: otro, nombre: "x.drawio", bytes: DRAWIO })).status, 401);
});

// En projects.json cyuxSz edita electrónica Y mecánica, así que el caso "editor de otra disciplina" usa un fixture
// propio (mismo core, D1 y almacén R2 que el Worker) con un editor distinto por disciplina.
test("editor de otra disciplina no sube fuentes de diagrama (403) y no toca R2", async () => {
  const { crearHandler } = await import("../lib/archivos-core.mjs");
  const { crearAlmacenR2 } = await import("../lib/almacen-r2.mjs");
  const { clienteD1 } = await import("../lib/almacen-d1.mjs");
  const env = crearEnv();
  const proyectos = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: ["eli"] }, mecanica: { plantilla: "mecanica", editores: ["meca"] } } }];
  const handler = crearHandler({ env, proyectos, redis: clienteD1(env.DB), blob: crearAlmacenR2(env.ARCHIVOS) });
  const subirComo = (login, disciplina, id, nombre, bytes) =>
    handler(
      new Request(`${ORIGIN}/api/archivos/?${qs({ proyecto: "uuv", disciplina, id, nombre })}`, {
        method: "POST",
        headers: { cookie: sesion(login), origin: ORIGIN, "content-type": "application/octet-stream", "content-length": String(bytes.length) },
        body: bytes,
      }),
    );
  assert.equal((await subirComo("eli", "mecanica", ID_F, "x.drawio", DRAWIO)).status, 403, "editor de electrónica no escribe en mecánica");
  assert.equal((await subirComo("meca", "electronica", ID_S, "x.excalidraw", EXCALIDRAW)).status, 403, "editor de mecánica no escribe en electrónica");
  assert.equal(env.ARCHIVOS.objetos.size, 0);
  assert.equal((await subirComo("eli", "electronica", ID_F, "x.drawio", DRAWIO)).status, 201, "control: el fixture sí deja al editor de su disciplina");
});

test("tamaño: una fuente de diagrama por encima del máximo se rechaza con 413 sin tocar R2", async () => {
  const env = crearEnv();
  const { TIPOS } = await import("../lib/archivos-nombre.mjs");
  const r = await subir(env, { id: ID_F, nombre: "enorme.drawio", bytes: DRAWIO, largo: TIPOS.drawio.max + 1 });
  assert.equal(r.status, 413);
  assert.equal(env.ARCHIVOS.objetos.size, 0);
});

test("lectura: el lector ve el SVG con CSP sandbox y descarga la fuente como adjunto octet-stream", async () => {
  const env = crearEnv();
  await subir(env, { id: ID_F, nombre: "cableado.excalidraw", bytes: EXCALIDRAW });
  await subir(env, { id: ID_S, nombre: "cableado.svg", bytes: SVG });
  const svg = await pedir(env, `/api/archivos/?${qs({ proyecto: "uuv", id: ID_S })}`, { login: LECTOR });
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-security-policy"), /^sandbox; default-src 'none'/);
  assert.equal(svg.headers.get("x-content-type-options"), "nosniff");
  const fuente = await pedir(env, `/api/archivos/?${qs({ proyecto: "uuv", id: ID_F })}`, { login: LECTOR });
  assert.equal(fuente.status, 200);
  assert.equal(fuente.headers.get("content-type"), "application/octet-stream");
  assert.match(fuente.headers.get("content-disposition"), /^attachment; filename="cableado\.excalidraw"/);
  assert.deepEqual(JSON.parse(await fuente.text()).type, "excalidraw", "el editor puede recuperar la fuente para editarla");
});

test("página: solo el editor puede guardar el Markdown con el bloque del diagrama (PUT /api/hardware)", async () => {
  const env = crearEnv();
  const hw = (login, method, body) => pedir(env, method === "GET" ? `/api/hardware/?${qs(body)}` : "/api/hardware/", { login, method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const ini = await hw(EDITOR, "POST", { proyecto: "uuv", disciplina: "electronica", accion: "inicializar" });
  assert.ok([200, 201].includes(ini.status), `inicializar: ${ini.status}`);
  const { paginas } = await (await hw(EDITOR, "GET", { proyecto: "uuv", disciplina: "electronica" })).json();
  const slug = paginas[0].slug;
  const { pagina } = await (await hw(EDITOR, "GET", { proyecto: "uuv", disciplina: "electronica", pagina: slug })).json();
  const md = `${pagina.md}\n\`\`\`diagrama\neditor: excalidraw\nfuente: ${ID_F}\nsvg: ${ID_S}\n\`\`\`\n`;
  assert.equal((await hw(LECTOR, "PUT", { proyecto: "uuv", disciplina: "electronica", pagina: slug, md, version: pagina.version })).status, 403);
  const ok = await hw(EDITOR, "PUT", { proyecto: "uuv", disciplina: "electronica", pagina: slug, md, version: pagina.version });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).pagina.md, md, "el bloque se guarda tal cual");
  const lectura = await (await hw(LECTOR, "GET", { proyecto: "uuv", disciplina: "electronica", pagina: slug })).json();
  assert.equal(lectura.editable, false, "el lector recibe editable=false: la interfaz no muestra Editar diagrama");
});
