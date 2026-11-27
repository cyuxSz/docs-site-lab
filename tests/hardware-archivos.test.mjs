// Lote 1a (migrado en el lote "quitar Vercel"): archivos de hardware en lib/archivos-core.mjs con subida directa.
// El navegador sube el cuerpo binario al Worker y el core lo escribe en el almacén de objetos (R2 en producción). Aquí el
// almacén de objetos es un doble con la interfaz de lib/almacen-r2.mjs ({ subir, leer, borrar }) y los metadatos van al
// almacén en memoria (tests/fixtures/almacen-memoria.mjs), que se puede intervenir para simular fallos a mitad de subida.
// El recorrido completo por el Worker con D1 y un bucket R2 falso está en tests/worker-apis.test.mjs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";
import { DEMO } from "./fixtures/acceso-demo.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/archivos/`;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const EDITOR = "edi";
const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const ID2 = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const MB = 1024 * 1024;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

const PROYECTOS = [
  { id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] }, mecanica: { plantilla: "mecanica", editores: ["meca"] } } },
  { id: "restringido-demo", disciplinas: { electronica: { plantilla: "electronica", editores: ["cyuxSz", "ana"] } } },
  { id: "usv" },
];

const core = () => import("../lib/archivos-core.mjs");

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function cookieDe(login, { exp = Date.now() + 864e5, secret = SECRET } = {}) {
  const body = Buffer.from(JSON.stringify({ login, exp })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

// Almacén de objetos falso con la interfaz de lib/almacen-r2.mjs. Registra lo que se lee y se borra.
function fakeNube() {
  return {
    objetos: new Map(),
    leidos: [],
    borrados: [],
    async subir(clave, stream, { contentType } = {}) {
      const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      this.objetos.set(clave, { bytes, contentType });
    },
    async leer(clave) {
      this.leidos.push(clave);
      const o = this.objetos.get(clave);
      if (!o) return null;
      return { stream: new Response(o.bytes).body, contentType: o.contentType, size: o.bytes.length };
    },
    async borrar(clave) {
      this.borrados.push(clave);
      this.objetos.delete(clave);
    },
  };
}

async function montar({ redis = fakeRedis(), nube = fakeNube(), env = {} } = {}) {
  const { crearHandler } = await core();
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET, ...env }, redis, blob: nube, proyectos: PROYECTOS, restringidos: DEMO, ahora: () => T0 });
  return { handler, redis, nube };
}

function req(method, { login, cookie, body, query = {}, origin = ORIGIN, ct = "application/json", headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (login) headers.cookie = cookieDe(login);
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    if (ct) headers["content-type"] = ct;
    if (origin) headers.origin = origin;
  }
  const qs = new URLSearchParams(query).toString();
  const cuerpo = body === undefined ? undefined : body instanceof Uint8Array || typeof body === "string" ? body : JSON.stringify(body);
  return new Request(qs ? `${URL_API}?${qs}` : URL_API, { method, headers, body: cuerpo });
}

// Subida directa: POST octet-stream con proyecto, disciplina, id y nombre en la query.
function pedirSubida(h, { login = EDITOR, proyecto = "uuv", disciplina = "electronica", id = ID, nombre = "placa.png", bytes = PNG, origin = ORIGIN } = {}) {
  return h(req("POST", { login, origin, ct: "application/octet-stream", headers: { "content-length": String(bytes.length) }, body: bytes, query: { proyecto, disciplina, id, nombre } }));
}

// Sube un archivo completo y devuelve su id y la clave en el almacén de objetos.
async function subir(m, opciones = {}) {
  const antes = new Set(m.nube.objetos.keys());
  const res = await pedirSubida(m.handler, opciones);
  assert.equal(res.status, 201, `subida de ${opciones.nombre ?? "placa.png"}`);
  const [clave] = [...m.nube.objetos.keys()].filter((k) => !antes.has(k));
  return { id: opciones.id ?? ID, clave };
}

const getArchivo = (h, id, login = "ana", proyecto = "uuv") => h(req("GET", { login, query: { proyecto, id } }));
const listar = (h, login = "ana", proyecto = "uuv") => h(req("GET", { login, query: { proyecto, lista: "1" } }));

// ---------- Nombres y tipos ----------

test("sanearNombre: quita rutas (../, \\), caracteres raros y deja un nombre seguro con la extensión", async () => {
  const { sanearNombre } = await core();
  assert.equal(sanearNombre("../../etc/passwd.png"), "passwd.png");
  assert.equal(sanearNombre("..\\..\\windows\\x.step"), "x.step");
  for (const raw of ["../../etc/passwd.png", "..\\..\\x.step", "mi placa (v2).kicad_pcb", "....png", ".oculto.pdf", "a\u0000b\r\n.csv", "a/../../b.stl", "%2e%2e%2fx.png", "x".repeat(300) + ".glb", "señal ñ.pdf"]) {
    const s = sanearNombre(raw);
    assert.equal(typeof s, "string", raw);
    assert.ok(s.length >= 1 && s.length <= 100, `${raw} → longitud ${s.length}`);
    assert.match(s, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, `${JSON.stringify(raw)} → ${s}`);
    assert.ok(!s.includes(".."), `${raw} → ${s} sin ..`);
    assert.ok(sanearNombre(s) === s, `idempotente: ${s}`);
  }
  assert.match(sanearNombre("mi placa (v2).kicad_pcb"), /\.kicad_pcb$/);
  assert.match(sanearNombre("x".repeat(300) + ".glb"), /\.glb$/, "al recortar conserva la extensión");
});

test("lista blanca de tipos: extensión → Content-Type, tamaño máximo (imágenes 10 MB, diagramas 20/10 MB, xml 1 MB, resto 50 MB) e inline", async () => {
  const { TIPOS } = await core();
  const esperadas = ["png", "jpg", "jpeg", "webp", "svg", "pdf", "kicad_sch", "kicad_pcb", "kicad_pro", "step", "stp", "stl", "glb", "3mf", "sldprt", "sldasm", "slddrw", "zip", "csv", "excalidraw", "drawio", "xml"];
  assert.deepEqual(Object.keys(TIPOS).sort(), [...esperadas].sort());
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) assert.equal(TIPOS[ext].max, 10 * MB, ext);
  // C1: fuentes de diagrama, siempre como adjunto octet-stream.
  assert.equal(TIPOS.excalidraw.max, 20 * MB, "excalidraw");
  assert.equal(TIPOS.drawio.max, 10 * MB, "drawio");
  for (const ext of ["excalidraw", "drawio"]) assert.equal(TIPOS[ext].mime, "application/octet-stream", ext);
  // E2 (D2): exportación XML de la biblioteca, adjunto octet-stream de 1 MB máx.
  assert.equal(TIPOS.xml.max, 1 * MB, "xml");
  assert.equal(TIPOS.xml.mime, "application/octet-stream", "xml");
  for (const ext of esperadas.filter((e) => !["png", "jpg", "jpeg", "webp", "svg", "excalidraw", "drawio", "xml"].includes(e))) assert.equal(TIPOS[ext].max, 50 * MB, ext);
  for (const ext of ["png", "jpg", "jpeg", "webp", "pdf"]) assert.equal(TIPOS[ext].inline, true, `${ext} inline`);
  for (const ext of esperadas.filter((e) => !["png", "jpg", "jpeg", "webp", "pdf"].includes(e))) assert.equal(TIPOS[ext].inline, false, `${ext} attachment`);
  assert.equal(TIPOS.png.mime, "image/png");
  assert.equal(TIPOS.jpg.mime, "image/jpeg");
  assert.equal(TIPOS.svg.mime, "image/svg+xml");
  assert.equal(TIPOS.pdf.mime, "application/pdf");
  for (const ext of esperadas) assert.doesNotMatch(TIPOS[ext].mime, /html|javascript|ecmascript/i, `${ext}: ${TIPOS[ext].mime}`);
});

// ---------- Token de subida (client upload) ----------

// ---------- Subida directa: permisos y validación ----------

test("subida: 401 sin sesión, 403 no editor, 403 editor de otra disciplina, 403 proyecto restringido, 404 disciplina no configurada; nada se escribe", async () => {
  const m = await montar();
  assert.equal((await pedirSubida(m.handler, { login: null })).status, 401);
  assert.equal((await pedirSubida(m.handler, { login: "ana" })).status, 403, "no editor");
  assert.equal((await pedirSubida(m.handler, { login: "meca" })).status, 403, "editor de otra disciplina");
  assert.equal((await pedirSubida(m.handler, { login: "otro", proyecto: "restringido-demo" })).status, 403, "restringido");
  assert.equal((await pedirSubida(m.handler, { disciplina: "inexistente" })).status, 404);
  assert.equal(m.nube.objetos.size, 0);
  assert.ok(!m.redis.data.has("hw:arch:uuv"), "sin metadatos");
});

test("subida: id no uuid → 400; el nombre se sanea y la clave es hw/<proy>/<disc>/<uuid>-<intento>-<nombre saneado>", async () => {
  const m = await montar();
  for (const id of ["../x", "123", ""]) assert.equal((await pedirSubida(m.handler, { id })).status, 400, id);
  const res = await pedirSubida(m.handler, { nombre: "../../otro-proyecto/mi placa.png" });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).nombre, "mi-placa.png");
  const [clave] = [...m.nube.objetos.keys()];
  assert.match(clave, new RegExp(`^hw/uuv/electronica/${ID}-[0-9a-f-]{36}-mi-placa\\.png$`));
});

test("subida: tipo fuera de la lista blanca → 400; tamaño declarado mayor al máximo → 413; solo octet-stream y mismo origen", async () => {
  const m = await montar();
  assert.equal((await pedirSubida(m.handler, { nombre: "x.html" })).status, 400);
  assert.equal((await pedirSubida(m.handler, { nombre: "x.exe" })).status, 400);
  const grande = await m.handler(req("POST", { login: EDITOR, ct: "application/octet-stream", headers: { "content-length": String(10 * MB + 1) }, body: PNG, query: { proyecto: "uuv", disciplina: "electronica", id: ID, nombre: "a.png" } }));
  assert.equal(grande.status, 413);
  const json = await m.handler(req("POST", { login: EDITOR, body: { type: "blob.generate-client-token", payload: {} } }));
  assert.equal(json.status, 415, "un cuerpo JSON (petición de token) no es una subida");
  assert.equal((await pedirSubida(m.handler, { origin: "https://evil.example" })).status, 403);
  assert.equal((await pedirSubida(m.handler, { origin: null })).status, 403);
  assert.equal(m.nube.objetos.size, 0);
});

test("sin sesión no hay excepción para callbacks firmados: POST sin cookie → 401 y no se escribe nada", async () => {
  const m = await montar();
  const res = await m.handler(req("POST", { origin: null, headers: { "x-vercel-signature": "firma" }, body: { type: "blob.upload-completed", payload: { blob: { url: "https://x/y", pathname: `hw/uuv/electronica/${ID}-placa.png` }, tokenPayload: "{}" } } }));
  assert.equal(res.status, 401);
  assert.ok(!m.redis.data.has("hw:arch:uuv"));
});

// ---------- Lectura: lista y proxy ----------

test("lista: GET ?proyecto&lista=1 devuelve metadatos sin la clave del almacén; 401 sin sesión; 403 restringido", async () => {
  const m = await montar();
  const { clave } = await subir(m);
  const res = await listar(m.handler);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  const texto = await res.text();
  assert.ok(!texto.includes(clave) && !texto.includes("blobUrl"), "nunca expone la clave del objeto");
  const { archivos } = JSON.parse(texto);
  assert.deepEqual(Object.keys(archivos[0]).sort(), ["disciplina", "fecha", "id", "nombre", "subidoPor", "tamano", "tipo"]);
  assert.equal((await m.handler(req("GET", { query: { proyecto: "uuv", lista: "1" } }))).status, 401);
  assert.equal((await listar(m.handler, "ana", "restringido-demo")).status, 403);
});

test("proxy: GET ?proyecto&id sirve los bytes con Content-Type de la lista blanca, nosniff e inline (png); nunca la clave del objeto", async () => {
  const m = await montar();
  const bytes = new Uint8Array([137, 80, 78, 71, 9, 9]);
  const { clave } = await subir(m, { bytes });
  // El almacén dice text/html: el proxy no le hace caso.
  m.nube.objetos.get(clave).contentType = "text/html";
  const res = await getArchivo(m.handler, ID);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("location"), null);
  for (const [k, v] of res.headers) assert.ok(!v.includes(clave), `cabecera ${k} expone la clave`);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
  assert.deepEqual(m.nube.leidos, [clave]);
});

test("proxy: svg va como attachment con CSP sandbox; CAD y otros como attachment", async () => {
  const m = await montar();
  await subir(m, { nombre: "logo.svg", id: ID, bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  const svg = await getArchivo(m.handler, ID);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(svg.headers.get("content-security-policy"), "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(svg.headers.get("x-content-type-options"), "nosniff");

  await subir(m, { nombre: "casco.step", id: ID2, bytes: new Uint8Array([1, 2, 3]) });
  const step = await getArchivo(m.handler, ID2);
  assert.equal(step.status, 200);
  assert.match(step.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.match(step.headers.get("content-disposition") ?? "", /casco\.step/);
});

test("proxy: Content-Disposition con el nombre saneado (sin comillas, CR/LF, / ni ..)", async () => {
  const m = await montar();
  await subir(m, { nombre: '../a"b\r\nSet-Cookie: x=1.pdf', bytes: new Uint8Array([37, 80, 68, 70]) });
  const res = await getArchivo(m.handler, ID);
  assert.equal(res.status, 200);
  const cd = res.headers.get("content-disposition") ?? "";
  assert.match(cd, /^inline;/, "pdf inline");
  assert.ok(!/[\r\n]|\.\.|\//.test(cd), cd);
  assert.equal((cd.match(/"/g) ?? []).length % 2, 0, "comillas balanceadas");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("proxy: 401 sin sesión, 403 proyecto restringido, 400 id no uuid, 404 id inexistente; no lee el almacén", async () => {
  const m = await montar();
  await subir(m);
  assert.equal((await m.handler(req("GET", { query: { proyecto: "uuv", id: ID } }))).status, 401);
  assert.equal((await getArchivo(m.handler, ID, "ana", "restringido-demo")).status, 403);
  for (const id of ["../x", "123", ""]) assert.equal((await getArchivo(m.handler, id)).status, 400, id);
  assert.equal((await getArchivo(m.handler, ID2)).status, 404);
  assert.equal(m.nube.leidos.length, 0);
});

test("proyecto restringido (tabla inyectada): el login autorizado sube, lista y lee; sin acceso → 403 en los tres", async () => {
  const m = await montar();
  // "ana" es editora de restringido-demo/electronica pero no está en la tabla: su 403 al subir solo puede venir de canAccess.
  // En lectura (lista / proxy) no hay chequeo de editor, así que el 403 de "otro" también viene de canAccess.
  assert.equal((await pedirSubida(m.handler, { login: "ana", proyecto: "restringido-demo" })).status, 403, "subida: editora sin acceso");
  assert.equal(m.nube.objetos.size, 0, "nada se escribió sin acceso");
  assert.equal((await listar(m.handler, "otro", "restringido-demo")).status, 403, "lista sin acceso");
  assert.equal((await getArchivo(m.handler, ID, "otro", "restringido-demo")).status, 403, "proxy sin acceso");
  assert.equal((await getArchivo(m.handler, ID, "cyuxSz", "restringido-demo")).status, 404, "proxy con acceso: pasa el 403 y llega al 404 de id inexistente");
  assert.equal((await pedirSubida(m.handler, { login: "CyuxSZ", proyecto: "restringido-demo" })).status, 201, "subida con acceso");
  assert.equal((await listar(m.handler, "cyuxSz", "restringido-demo")).status, 200, "lista con acceso");
  assert.equal((await getArchivo(m.handler, ID, "cyuxSz", "restringido-demo")).status, 200, "proxy con acceso");
});

test("sin acceso al proyecto el 403 va antes del 404 de disciplina", async () => {
  const m = await montar();
  const res = await pedirSubida(m.handler, { login: "ana", proyecto: "restringido-demo", disciplina: "inexistente" });
  assert.equal(res.status, 403);
});

// ---------- Borrado ----------

test("DELETE {proyecto, id}: solo editores de la disciplina del archivo; borra el objeto y los metadatos", async () => {
  const m = await montar();
  const { clave } = await subir(m);
  const del = (login, body = { proyecto: "uuv", id: ID }, extra = {}) => m.handler(req("DELETE", { login, body, ...extra }));
  assert.equal((await del(null)).status, 401);
  assert.equal((await del("ana")).status, 403);
  assert.equal((await del("meca")).status, 403, "editor de otra disciplina");
  assert.equal((await del(EDITOR, { proyecto: "uuv", id: ID }, { origin: "https://evil.example" })).status, 403);
  assert.equal(m.nube.borrados.length, 0);
  const res = await del(EDITOR);
  assert.equal(res.status, 200);
  assert.deepEqual(m.nube.borrados, [clave]);
  assert.ok(!(m.redis.data.get("hw:arch:uuv")?.has(ID)), "metadatos borrados");
  assert.equal((await del(EDITOR)).status, 404);
  assert.equal((await pedirSubida(m.handler, { id: ID })).status, 409, "un id borrado no se reutiliza (lápida)");
});

// ---------- Configuración ----------

test("503 si no hay almacén de objetos o de metadatos", async () => {
  const { crearHandler } = await core();
  const sinNube = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: fakeRedis(), blob: null, proyectos: PROYECTOS, restringidos: DEMO });
  assert.equal((await sinNube(req("GET", { login: "ana", query: { proyecto: "uuv", id: ID } }))).status, 503);
  const sinMeta = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: null, blob: fakeNube(), proyectos: PROYECTOS, restringidos: DEMO });
  assert.equal((await sinMeta(req("GET", { login: "ana", query: { proyecto: "uuv", lista: "1" } }))).status, 503);
  const sinNada = crearHandler({ env: { SESSION_SECRET: SECRET }, proyectos: PROYECTOS, restringidos: DEMO });
  assert.equal((await sinNada(req("GET", { login: "ana", query: { proyecto: "uuv", lista: "1" } }))).status, 503, "sin inyección no hay almacén por defecto");
});

// ---------- Unicidad de id y carreras ----------

test("un editor de mecanica no puede pisar el id de un archivo de electronica (409) y los metadatos no cambian", async () => {
  const m = await montar();
  await subir(m);
  const antes = m.redis.data.get("hw:arch:uuv").get(ID);
  const res = await pedirSubida(m.handler, { login: "meca", disciplina: "mecanica", id: ID });
  assert.equal(res.status, 409);
  assert.equal(m.redis.data.get("hw:arch:uuv").get(ID), antes);
  assert.equal(m.nube.objetos.size, 1, "el intento rechazado no deja objeto");
});

test("carrera de dos subidas del mismo id: el perdedor (EVAL=0) no borra el objeto del ganador", async () => {
  const m = await montar();
  const GANADOR = new Uint8Array([137, 80, 78, 71, 1, 1, 1, 1]);
  const { clave } = await subir(m, { bytes: GANADOR });
  // El perdedor pasa el HEXISTS (lo hizo antes de que el ganador insertara) y su EVAL devuelve 0.
  const orig = m.redis.exec.bind(m.redis);
  m.redis.exec = async (cmds) => cmds.map((c) => (["HEXISTS", "SISMEMBER", "EVAL"].includes(c[0]) ? 0 : null));
  let perdedor;
  try {
    perdedor = await pedirSubida(m.handler, { bytes: PNG });
  } finally {
    m.redis.exec = orig;
  }
  assert.equal(perdedor.status, 409);
  assert.deepEqual([...m.nube.objetos.keys()], [clave], "solo queda el objeto del ganador");
  const g = await getArchivo(m.handler, ID);
  assert.equal(g.status, 200);
  assert.deepEqual(new Uint8Array(await g.arrayBuffer()), GANADOR);
});

test("lápida + inserción en un único EVAL: sin SISMEMBER/HSETNX sueltos al insertar", async () => {
  const m = await montar();
  m.redis.comandos.length = 0;
  await subir(m);
  assert.ok(m.redis.comandos.some((c) => c[0] === "EVAL"), "inserta con EVAL");
  assert.ok(!m.redis.comandos.some((c) => String(c[0]).toUpperCase() === "HSETNX"), "sin HSETNX suelto");
});

test("si el EVAL aplica la inserción pero la respuesta se pierde, el objeto se conserva y se puede leer", async () => {
  const m = await montar();
  const orig = m.redis.exec.bind(m.redis);
  m.redis.exec = async (cmds) => {
    const res = await orig(cmds);
    if (cmds[0][0] === "EVAL") throw new TypeError("respuesta perdida");
    return res;
  };
  let r;
  try {
    r = await pedirSubida(m.handler);
  } finally {
    m.redis.exec = orig;
  }
  assert.equal(r.status, 201, "la re-lectura confirma que el meta apunta al objeto");
  assert.equal(m.nube.objetos.size, 1);
  const g = await getArchivo(m.handler, ID);
  assert.equal(g.status, 200);
  assert.deepEqual(new Uint8Array(await g.arrayBuffer()), PNG);
});

test("si el EVAL lanza y la re-lectura también falla, se conserva el objeto y responde 503", async () => {
  const m = await montar();
  const orig = m.redis.exec.bind(m.redis);
  let fallar = false;
  m.redis.exec = async (cmds) => {
    if (cmds[0][0] === "EVAL") fallar = true;
    if (fallar) throw new TypeError("sin red");
    return orig(cmds);
  };
  const r = await pedirSubida(m.handler);
  assert.equal(r.status, 503);
  assert.equal(m.nube.objetos.size, 1, "huérfano posible, pero no se pierde el dato");
});

test("si el EVAL lanza sin haberse aplicado, se borra el objeto", async () => {
  const m = await montar();
  const orig = m.redis.exec.bind(m.redis);
  m.redis.exec = async (cmds) => {
    if (cmds[0][0] === "EVAL") throw new TypeError("timeout");
    return orig(cmds);
  };
  await pedirSubida(m.handler);
  assert.equal(m.nube.objetos.size, 0);
});
