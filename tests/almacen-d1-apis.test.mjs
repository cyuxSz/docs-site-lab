// M2c: la misma batería de comentarios, hardware y archivos contra el Redis en memoria y contra D1 (clienteD1 sobre
// node:sqlite con la API de D1). Los cores no cambian: solo cambia el almacén inyectado. Al final, el Worker usa D1
// (env.DB) como único almacén: sin binding, 503.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";
import electronica from "../plantillas/electronica.json" with { type: "json" };

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const T0 = Date.parse("2026-11-16T10:00:00Z");
const EDITOR = "edi";
const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const PAG = "/uuv/arquitectura/";
const PROYECTOS = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] } } }];
const PLANTILLAS = { electronica };
const SLUG = electronica[0].slug;

const BACKENDS = {
  "memoria": async () => {
    let t = T0;
    const almacen = fakeRedis();
    almacen.reloj.ahora = () => t;
    return { almacen, ahora: () => t, avanzar: (ms) => (t += ms) };
  },
  d1: async () => {
    const { clienteD1 } = await import("../lib/almacen-d1.mjs");
    let t = T0;
    const db = crearD1();
    return { db, almacen: clienteD1(db, { ahora: () => t }), ahora: () => t, avanzar: (ms) => (t += ms) };
  },
};

function cookieDe(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}

function req(ruta, method, { login, body, query = {}, headers = {} } = {}) {
  const h = { ...headers };
  if (login) h.cookie = cookieDe(login);
  if (method !== "GET") {
    h.origin ??= ORIGIN;
    if (!(body instanceof Uint8Array)) h["content-type"] ??= "application/json";
  }
  const qs = new URLSearchParams(query).toString();
  const cuerpo = body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body);
  return new Request(`${ORIGIN}${ruta}${qs ? `?${qs}` : ""}`, { method, headers: h, body: cuerpo });
}

async function comentarios(b) {
  const { crearHandler } = await import("../lib/comentarios-core.mjs");
  return crearHandler({ env: { SESSION_SECRET: SECRET }, redis: b.almacen, proyectos: PROYECTOS, ahora: b.ahora });
}
async function hardware(b, almacen = b.almacen) {
  const { crearHandler } = await import("../lib/hardware-core.mjs");
  return crearHandler({ env: { SESSION_SECRET: SECRET }, redis: almacen, proyectos: PROYECTOS, plantillas: PLANTILLAS, ahora: b.ahora });
}
function nubeMemoria() {
  const objetos = new Map();
  return {
    objetos,
    async subir(clave, stream) {
      objetos.set(clave, new Uint8Array(await new Response(stream).arrayBuffer()));
    },
    async leer(clave) {
      const o = objetos.get(clave);
      return o ? { stream: new Response(o).body, contentType: "image/png", size: o.length } : null;
    },
    async borrar(clave) {
      objetos.delete(clave);
    },
  };
}
async function archivos(b, nube) {
  const { crearHandler } = await import("../lib/archivos-core.mjs");
  return crearHandler({ env: { SESSION_SECRET: SECRET }, redis: b.almacen, blob: nube, proyectos: PROYECTOS, ahora: b.ahora });
}

const BASE = { proyecto: "uuv", disciplina: "electronica" };
const json = async (res) => ({ status: res.status, body: await res.json(), headers: res.headers });

for (const [nombre, crear] of Object.entries(BACKENDS)) {
  // ---------- Comentarios ----------
  test(`[${nombre}] comentarios: crear, responder, editar, resolver, lápida al borrar con respuestas y limpieza del índice`, async () => {
    const b = await crear();
    const h = await comentarios(b);
    const raiz = await json(await h(req("/api/comentarios/", "POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "¿Qué 'regulador' usa?\nGracias" } })));
    assert.equal(raiz.status, 201);
    b.avanzar(1000);
    const resp = await json(await h(req("/api/comentarios/", "POST", { login: "beto", body: { pagina: PAG, tipo: "aclaracion", texto: "El de 5 V 🚀", padre: raiz.body.comentario.id } })));
    assert.equal(resp.status, 201);

    let lista = await json(await h(req("/api/comentarios/", "GET", { login: "ana", query: { pagina: PAG } })));
    assert.deepEqual(lista.body.comentarios.map((c) => c.texto), ["¿Qué 'regulador' usa?\nGracias", "El de 5 V 🚀"]);

    assert.equal((await h(req("/api/comentarios/", "PATCH", { login: "ana", body: { pagina: PAG, id: raiz.body.comentario.id, texto: "Editado" } }))).status, 200);
    assert.equal((await h(req("/api/comentarios/", "PATCH", { login: "beto", body: { pagina: PAG, id: raiz.body.comentario.id, texto: "No es mío" } }))).status, 403);

    const proyecto = await json(await h(req("/api/comentarios/", "GET", { login: "ana", query: { proyecto: "uuv" } })));
    assert.deepEqual(proyecto.body.paginas.map((p) => [p.pagina, p.abiertos]), [[PAG, 1]]);

    assert.equal((await h(req("/api/comentarios/", "PATCH", { login: "beto", body: { pagina: PAG, id: raiz.body.comentario.id, resuelto: true } }))).status, 200);
    assert.deepEqual((await json(await h(req("/api/comentarios/", "GET", { login: "ana", query: { proyecto: "uuv" } })))).body.paginas, []);

    // Borrar la raíz con respuestas deja una lápida.
    assert.equal((await h(req("/api/comentarios/", "DELETE", { login: "ana", body: { pagina: PAG, id: raiz.body.comentario.id } }))).status, 200);
    lista = await json(await h(req("/api/comentarios/", "GET", { login: "ana", query: { pagina: PAG } })));
    const lapida = lista.body.comentarios.find((c) => c.id === raiz.body.comentario.id);
    assert.deepEqual([lapida.borrado, lapida.texto, lapida.autor], [true, "", null]);

    // Borrar la respuesta la quita del todo; la lápida se queda (ya no tiene autor).
    assert.equal((await h(req("/api/comentarios/", "DELETE", { login: "beto", body: { pagina: PAG, id: resp.body.comentario.id } }))).status, 200);
    lista = await json(await h(req("/api/comentarios/", "GET", { login: "ana", query: { pagina: PAG } })));
    assert.deepEqual(lista.body.comentarios.map((c) => [c.id, c.borrado]), [[raiz.body.comentario.id, true]]);

    // Una página que se queda sin comentarios sale del índice del proyecto (HDEL + HLEN → SREM).
    const PAG2 = "/uuv/potencia/";
    const solo = await json(await h(req("/api/comentarios/", "POST", { login: "ana", body: { pagina: PAG2, tipo: "bug", texto: "solo" } })));
    let [miembros] = await b.almacen.exec([["SMEMBERS", "com:idx:uuv"]]);
    assert.deepEqual([...miembros].sort(), [PAG, PAG2].sort());
    assert.equal((await h(req("/api/comentarios/", "DELETE", { login: "ana", body: { pagina: PAG2, id: solo.body.comentario.id } }))).status, 200);
    assert.deepEqual((await json(await h(req("/api/comentarios/", "GET", { login: "ana", query: { pagina: PAG2 } })))).body.comentarios, []);
    [miembros] = await b.almacen.exec([["SMEMBERS", "com:idx:uuv"]]);
    assert.deepEqual(miembros, [PAG]);
  });

  test(`[${nombre}] límite de tasa: la escritura 11 da 429 con Retry-After y la ventana caduca`, async () => {
    const b = await crear();
    const h = await comentarios(b);
    const escribir = () => h(req("/api/comentarios/", "POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "hola" } }));
    for (let i = 0; i < 10; i++) assert.equal((await escribir()).status, 201, `escritura ${i + 1}`);
    b.avanzar(30_000);
    const r = await escribir();
    assert.equal(r.status, 429);
    const espera = Number(r.headers.get("retry-after"));
    assert.ok(espera >= 1 && espera <= 30, `Retry-After ${espera}`);
    b.avanzar(31_000);
    assert.equal((await escribir()).status, 201, "pasada la ventana se puede volver a escribir");
  });

  // ---------- Hardware ----------
  test(`[${nombre}] hardware: inicializar, editar con versión, 409 por versión vieja, revisiones y restaurar`, async () => {
    const b = await crear();
    const h = await hardware(b);
    assert.equal((await h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "inicializar" } }))).status, 201);
    const indice = await json(await h(req("/api/hardware/", "GET", { login: "ana", query: BASE })));
    assert.deepEqual(indice.body.paginas.map((p) => p.slug), electronica.map((p) => p.slug));
    assert.equal(indice.body.actualizado, new Date(T0).toISOString());

    let p = await json(await h(req("/api/hardware/", "GET", { login: "ana", query: { ...BASE, pagina: SLUG } })));
    assert.equal(p.body.pagina.version, 1);
    const md = "# Nuevo\n\nCon 'comillas', ; y -- y emoji ✓\n";
    const v2 = await json(await h(req("/api/hardware/", "PUT", { login: EDITOR, body: { ...BASE, pagina: SLUG, md, version: 1, titulo: "Nuevo título" } })));
    assert.equal(v2.status, 200);
    assert.equal(v2.body.pagina.version, 2);

    const viejo = await json(await h(req("/api/hardware/", "PUT", { login: EDITOR, body: { ...BASE, pagina: SLUG, md: "pisar", version: 1 } })));
    assert.equal(viejo.status, 409);
    assert.equal(viejo.body.version, 2);

    p = await json(await h(req("/api/hardware/", "GET", { login: "ana", query: { ...BASE, pagina: SLUG } })));
    assert.equal(p.body.pagina.md, md);
    assert.equal((await json(await h(req("/api/hardware/", "GET", { login: "ana", query: BASE })))).body.paginas[0].titulo, "Nuevo título");

    const revs = await json(await h(req("/api/hardware/", "GET", { login: "ana", query: { ...BASE, pagina: SLUG, revisiones: "1" } })));
    assert.deepEqual(revs.body.revisiones.map((r) => r.version), [1]);
    const rest = await json(await h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "restaurar", pagina: SLUG, revision: 0, version: 2 } })));
    assert.equal(rest.status, 200);
    assert.equal(rest.body.pagina.version, 3);
    assert.equal(rest.body.pagina.md, electronica[0].md);
  });

  test(`[${nombre}] hardware: candado ocupado → 409 y, al caducar el lease, se puede guardar`, async () => {
    const b = await crear();
    const h = await hardware(b);
    await h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "inicializar" } }));
    await b.almacen.exec([["SET", `hw:lock:uuv:electronica:${SLUG}`, "otra-peticion", "NX", "EX", 10]]);
    const ocupado = await h(req("/api/hardware/", "PUT", { login: EDITOR, body: { ...BASE, pagina: SLUG, md: "x", version: 1 } }));
    assert.equal(ocupado.status, 409);
    b.avanzar(11_000);
    const libre = await h(req("/api/hardware/", "PUT", { login: EDITOR, body: { ...BASE, pagina: SLUG, md: "x", version: 1 } }));
    assert.equal(libre.status, 200);
    const [lock] = await b.almacen.exec([["GET", `hw:lock:uuv:electronica:${SLUG}`]]);
    assert.equal(lock, null, "el candado se libera al terminar");
  });

  test(`[${nombre}] hardware: fencing — si otro toma el candado a mitad de la escritura, 409 y nada cambia`, async () => {
    const b = await crear();
    let robar = false;
    const espia = {
      async exec(cmds) {
        if (robar && cmds.some((c) => c[0] === "EVAL" && String(c[1]).includes("FENCED"))) {
          robar = false;
          await b.almacen.exec([["SET", `hw:lock:uuv:electronica:${SLUG}`, "de-otro", "EX", 10]]);
        }
        return b.almacen.exec(cmds);
      },
    };
    const h = await hardware(b, espia);
    await h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "inicializar" } }));
    robar = true;
    const r = await h(req("/api/hardware/", "PUT", { login: EDITOR, body: { ...BASE, pagina: SLUG, md: "no debe quedar", version: 1 } }));
    assert.equal(r.status, 409);
    const p = await json(await h(req("/api/hardware/", "GET", { login: "ana", query: { ...BASE, pagina: SLUG } })));
    assert.equal(p.body.pagina.version, 1);
    assert.equal(p.body.pagina.md, electronica[0].md);
    const [revs] = await b.almacen.exec([["LLEN", `hw:rev:uuv:electronica:${SLUG}`]]);
    assert.equal(revs, 0);
  });

  test(`[${nombre}] hardware: borrar va a la papelera con revisiones y el slug recreado no reutiliza versiones`, async () => {
    const b = await crear();
    const h = await hardware(b);
    await h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "inicializar" } }));
    await h(req("/api/hardware/", "PUT", { login: EDITOR, body: { ...BASE, pagina: SLUG, md: "v2", version: 1 } }));
    assert.equal((await h(req("/api/hardware/", "DELETE", { login: EDITOR, body: { ...BASE, pagina: SLUG, version: 2 } }))).status, 200);
    assert.equal((await h(req("/api/hardware/", "GET", { login: "ana", query: { ...BASE, pagina: SLUG } }))).status, 404);
    const [flat] = await b.almacen.exec([["HGETALL", "hw:papelera:uuv:electronica"]]);
    assert.equal(flat.length, 2);
    const entrada = JSON.parse(flat[1]);
    assert.deepEqual([entrada.version, entrada.md, entrada.revisiones.length], [2, "v2", 1]);
    const [existe] = await b.almacen.exec([["EXISTS", `hw:rev:uuv:electronica:${SLUG}`]]);
    assert.equal(existe, 0);
    const nueva = await json(await h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "crear", pagina: SLUG, titulo: "Otra vez" } })));
    assert.equal(nueva.status, 201);
    assert.equal(nueva.body.pagina.version, 3, "suelo de versión: 2 + 1");
  });

  // ---------- Archivos ----------
  const subir = (h, id = ID) =>
    h(req("/api/archivos/", "POST", { login: EDITOR, body: PNG, query: { ...BASE, id, nombre: "placa.png" }, headers: { "content-type": "application/octet-stream", "content-length": String(PNG.length) } }));

  test(`[${nombre}] archivos: carrera de dos subidas con el mismo id → una 201 y otra 409, sin objetos huérfanos`, async () => {
    const b = await crear();
    const nube = nubeMemoria();
    const h = await archivos(b, nube);
    const estados = (await Promise.all([subir(h), subir(h)])).map((r) => r.status).sort();
    assert.deepEqual(estados, [201, 409]);
    assert.equal(nube.objetos.size, 1, "el perdedor borra su objeto");
    const lista = await json(await h(req("/api/archivos/", "GET", { login: "ana", query: { proyecto: "uuv", lista: "1" } })));
    assert.deepEqual(lista.body.archivos.map((a) => a.id), [ID]);
    const leido = await h(req("/api/archivos/", "GET", { login: "ana", query: { proyecto: "uuv", id: ID } }));
    assert.equal(leido.status, 200);
    assert.deepEqual(new Uint8Array(await leido.arrayBuffer()), PNG);
  });

  test(`[${nombre}] archivos: borrar deja lápida y el mismo id no se puede volver a subir`, async () => {
    const b = await crear();
    const nube = nubeMemoria();
    const h = await archivos(b, nube);
    assert.equal((await subir(h)).status, 201);
    assert.equal((await h(req("/api/archivos/", "DELETE", { login: EDITOR, body: { proyecto: "uuv", id: ID } }))).status, 200);
    assert.equal(nube.objetos.size, 0);
    assert.equal((await subir(h)).status, 409, "lápida");
    assert.equal(nube.objetos.size, 0);
    assert.equal((await h(req("/api/archivos/", "GET", { login: "ana", query: { proyecto: "uuv", id: ID } }))).status, 404);
  });
}

// ---------- Presupuesto de consultas por petición (D1 Free: 50 por invocación) ----------

async function sentenciasDe(b, fn) {
  const antes = b.db.stats.sentenciasEnBatch + b.db.stats.sueltas;
  const res = await fn();
  return { res, n: b.db.stats.sentenciasEnBatch + b.db.stats.sueltas - antes };
}

test("[d1] listar 100 páginas con comentarios del proyecto cabe en ≤ 50 sentencias", async () => {
  const b = await BACKENDS.d1();
  const h = await comentarios(b);
  const cmds = [];
  for (let i = 0; i < 100; i++) {
    const pagina = `/uuv/p${String(i).padStart(3, "0")}/`;
    const c = { id: crypto.randomUUID(), padre: null, autor: "ana", tipo: "duda", texto: `t${i}`, creado: new Date(T0 + i).toISOString(), resuelto: false, borrado: false };
    cmds.push(["HSET", `com:${pagina}`, c.id, JSON.stringify(c)], ["SADD", "com:idx:uuv", pagina]);
  }
  for (let i = 0; i < cmds.length; i += 40) await b.almacen.exec(cmds.slice(i, i + 40));
  const { res, n } = await sentenciasDe(b, () => h(req("/api/comentarios/", "GET", { login: "ana", query: { proyecto: "uuv" } })));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).paginas.length, 100);
  assert.ok(n <= 50, `${n} sentencias`);
});

test("[d1] inicializar 10 páginas de plantilla y borrar una página con 50 revisiones caben en ≤ 50 sentencias cada uno", async () => {
  const b = await BACKENDS.d1();
  const h = await hardware(b);
  const ini = await sentenciasDe(b, () => h(req("/api/hardware/", "POST", { login: EDITOR, body: { ...BASE, accion: "inicializar" } })));
  assert.equal(ini.res.status, 201);
  assert.ok(ini.n <= 50, `inicializar: ${ini.n} sentencias`);
  const revs = Array.from({ length: 50 }, (_, i) => ["LPUSH", `hw:rev:uuv:electronica:${SLUG}`, JSON.stringify({ titulo: "t", md: "x".repeat(100), version: i + 1 })]);
  await b.almacen.exec(revs);
  const del = await sentenciasDe(b, () => h(req("/api/hardware/", "DELETE", { login: EDITOR, body: { ...BASE, pagina: SLUG, version: 1 } })));
  assert.equal(del.res.status, 200);
  assert.ok(del.n <= 50, `borrar: ${del.n} sentencias`);
});

// ---------- Worker: D1 si existe env.DB; si no, Upstash ----------

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function envWorker(extra = {}) {
  return {
    GITHUB_CLIENT_ID: "cid",
    GITHUB_CLIENT_SECRET: "csecret",
    SESSION_SECRET: SECRET,
    ALLOWED_ORG: "vanttec",
    ALLOWED_USERS: "",
    ASSETS: { fetch: async () => new Response("<h1>asset</h1>", { headers: { "content-type": "text/html" } }) },
    ...extra,
  };
}
const worker = async () => (await import("../worker/index.mjs")).default;
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("Worker: con env.DB y sin Upstash, los comentarios funcionan sobre D1 (sin fetch a la red)", async () => {
  const llamadas = [];
  globalThis.fetch = async (u) => {
    llamadas.push(String(u?.url ?? u));
    throw new Error("sin red");
  };
  const DB = crearD1();
  const w = await worker();
  const env = envWorker({ DB });
  const post = await w.fetch(req("/api/comentarios/", "POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "desde D1" } }), env, ctx);
  assert.equal(post.status, 201);
  // Otro objeto env con la misma base (reinicio de wrangler dev con la D1 local persistida): los datos siguen ahí.
  const get = await w.fetch(req("/api/comentarios/", "GET", { login: "ana", query: { pagina: PAG } }), envWorker({ DB }), ctx);
  assert.equal(get.status, 200);
  assert.deepEqual((await get.json()).comentarios.map((c) => c.texto), ["desde D1"]);
  assert.deepEqual(llamadas, []);
});

test("Worker: con env.DB usa D1 y no llama a la red aunque queden variables viejas KV_REST_*", async () => {
  const llamadas = [];
  globalThis.fetch = async (u) => {
    llamadas.push(String(u?.url ?? u));
    throw new Error("no debe llamar a la red");
  };
  const w = await worker();
  const env = envWorker({ DB: crearD1(), KV_REST_API_URL: "https://almacen-viejo.prueba", KV_REST_API_TOKEN: "tok" });
  const res = await w.fetch(req("/api/hardware/", "GET", { login: "ana", query: BASE }), env, ctx);
  assert.equal(res.status, 200);
  assert.deepEqual(llamadas, []);
});

test("Worker: sin env.DB las APIs responden 503 aunque haya KV_REST_*/UPSTASH_* (D1 es el único almacén)", async () => {
  const llamadas = [];
  globalThis.fetch = async (u) => {
    llamadas.push(String(u?.url ?? u));
    throw new Error("no debe llamar a la red");
  };
  const w = await worker();
  const viejas = { KV_REST_API_URL: "https://almacen-viejo.prueba", KV_REST_API_TOKEN: "tok", UPSTASH_REDIS_REST_URL: "https://almacen-viejo.prueba", UPSTASH_REDIS_REST_TOKEN: "tok" };
  const post = await w.fetch(req("/api/comentarios/", "POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "sin D1" } }), envWorker(viejas), ctx);
  assert.equal(post.status, 503, "sin D1 no se escribe en ningún otro almacén");
  for (const [ruta, query] of [["/api/comentarios/", { pagina: PAG }], ["/api/hardware/", BASE], ["/api/archivos/", { proyecto: "uuv", lista: "1" }]]) {
    const r = await w.fetch(req(ruta, "GET", { login: "ana", query }), envWorker(viejas), ctx);
    assert.equal(r.status, 503, ruta);
  }
  assert.deepEqual(llamadas, [], "ninguna petición a un almacén externo");
  const sinNada = await w.fetch(req("/api/comentarios/", "GET", { login: "ana", query: { pagina: PAG } }), envWorker(), ctx);
  assert.equal(sinNada.status, 503);
});
