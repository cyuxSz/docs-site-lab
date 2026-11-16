// Lote "QoL de comentarios", parte API: índice de páginas con comentarios por proyecto (set com:idx:<proyecto>) y
// GET /api/comentarios/?proyecto=<id> con los hilos raíz abiertos de todo el proyecto (panel y contador de la SideNav).
// Mismo estilo que comentarios-api.test.mjs: Redis en memoria inyectado (exec(comandos) → resultados crudos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DEMO } from "./fixtures/acceso-demo.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/comentarios/`;
const PROYECTOS = [{ id: "uuv" }, { id: "restringido-demo" }];
const PAG = "/uuv/arquitectura/";
const PAG2 = "/uuv/packages/uuv_control/";
const T0 = Date.parse("2026-10-30T12:00:00Z");

const core = () => import("../lib/comentarios-core.mjs");

function cookieDe(login, { exp = Date.now() + 864e5, secret = SECRET } = {}) {
  const body = Buffer.from(JSON.stringify({ login, exp })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

// Redis en memoria: hashes, contadores y sets. Guarda cada lote de exec para comprobar cuántas llamadas hace la API.
function fakeRedis() {
  const data = new Map();
  const ttl = new Map();
  const hash = (k) => {
    if (!(data.get(k) instanceof Map)) data.set(k, new Map());
    return data.get(k);
  };
  const set = (k) => {
    if (!(data.get(k) instanceof Set)) data.set(k, new Set());
    return data.get(k);
  };
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case "HGETALL": return data.get(a[0]) instanceof Map ? [...data.get(a[0])].flat() : [];
      case "HGET": return data.get(a[0])?.get?.(a[1]) ?? null;
      case "HLEN": return data.get(a[0]) instanceof Map ? data.get(a[0]).size : 0;
      case "HSET": { const h = hash(a[0]); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return n; }
      case "HDEL": { const h = data.get(a[0]); let n = 0; for (const f of a.slice(1)) if (h?.delete?.(f)) n++; if (h instanceof Map && h.size === 0) data.delete(a[0]); return n; }
      case "SADD": { const s = set(a[0]); let n = 0; for (const m of a.slice(1)) if (!s.has(String(m))) { s.add(String(m)); n++; } return n; }
      case "SREM": { const s = data.get(a[0]); let n = 0; for (const m of a.slice(1)) if (s instanceof Set && s.delete(String(m))) n++; if (s instanceof Set && s.size === 0) data.delete(a[0]); return n; }
      case "SMEMBERS": return data.get(a[0]) instanceof Set ? [...data.get(a[0])] : [];
      case "SCARD": return data.get(a[0]) instanceof Set ? data.get(a[0]).size : 0;
      case "SISMEMBER": return data.get(a[0]) instanceof Set && data.get(a[0]).has(String(a[1])) ? 1 : 0;
      case "INCR": { const v = Number(data.get(a[0]) ?? 0) + 1; data.set(a[0], String(v)); return v; }
      case "EXPIRE": if (!data.has(a[0])) return 0; if (String(a[2] ?? "").toUpperCase() === "NX" && ttl.has(a[0])) return 0; ttl.set(a[0], Number(a[1])); return 1;
      case "TTL": return data.has(a[0]) ? (ttl.get(a[0]) ?? -1) : -2;
      default: throw new Error(`fake: comando no soportado ${cmd}`);
    }
  };
  return {
    data,
    comandos: [],
    lotes: [],
    async exec(cmds) {
      this.comandos.push(...cmds);
      this.lotes.push(cmds);
      return cmds.map(run);
    },
  };
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
async function montar({ redis = fakeRedis(), ahora = () => T0 } = {}) {
  const { crearHandler } = await core();
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS, restringidos: DEMO, ahora, uuid });
  return { handler, redis };
}

function escribir(method, { login, body, origin = ORIGIN, ct = "application/json" }) {
  const headers = { "content-type": ct, origin };
  if (login) headers.cookie = cookieDe(login);
  return new Request(URL_API, { method, headers, body: JSON.stringify(body) });
}
function leer({ login, qs }) {
  const headers = {};
  if (login) headers.cookie = cookieDe(login);
  return new Request(`${URL_API}?${qs}`, { headers });
}
const porProyecto = (h, login, id) => h(leer({ login, qs: `proyecto=${encodeURIComponent(id)}` }));
async function crear(h, login, pagina, extra = {}) {
  const res = await h(escribir("POST", { login, body: { pagina, tipo: "duda", texto: "¿Por qué el PID ignora x/y?", ...extra } }));
  return { res, json: await res.json() };
}
const idx = (redis, id) => [...(redis.data.get(`com:idx:${id}`) ?? [])].sort();

// Siembra un comentario directamente en el almacén (para límites y datos raros).
function sembrar(redis, pagina, c) {
  const id = c.id ?? uuid();
  const com = { id, padre: null, autor: "ana", tipo: "duda", texto: "x", creado: new Date(T0).toISOString(), editado: null, resuelto: false, resueltoPor: null, borrado: false, ...c };
  if (!(redis.data.get(`com:${pagina}`) instanceof Map)) redis.data.set(`com:${pagina}`, new Map());
  redis.data.get(`com:${pagina}`).set(id, JSON.stringify(com));
  const proyecto = pagina.split("/")[1];
  if (!(redis.data.get(`com:idx:${proyecto}`) instanceof Set)) redis.data.set(`com:idx:${proyecto}`, new Set());
  redis.data.get(`com:idx:${proyecto}`).add(pagina);
  return id;
}

function cabecerasJson(res, que) {
  assert.match(res.headers.get("content-type") ?? "", /application\/json/, `${que}: content-type`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${que}: cache-control`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${que}: nosniff`);
}

// ---------- 1. Índice de páginas por proyecto ----------

test("índice: un POST (raíz o respuesta) agrega la página a com:idx:<proyecto> con SADD en el mismo exec que el HSET", async () => {
  const { handler, redis } = await montar();
  const { res, json } = await crear(handler, "ana", PAG);
  assert.equal(res.status, 201);
  assert.deepEqual(idx(redis, "uuv"), [PAG]);
  const lote = redis.lotes.find((l) => l.some(([c]) => /^HSET$/i.test(c)));
  assert.ok(lote?.some(([c, k, m]) => /^SADD$/i.test(c) && k === "com:idx:uuv" && m === PAG), "SADD va en el mismo pipeline que el HSET (sin ventana de inconsistencia)");
  assert.equal((await crear(handler, "beto", PAG, { padre: json.comentario.id })).res.status, 201);
  assert.equal((await crear(handler, "beto", PAG2)).res.status, 201);
  assert.deepEqual(idx(redis, "uuv"), [PAG, PAG2].sort());
});

test("índice: escrituras rechazadas (400, 403, 415, CSRF) no tocan el índice", async () => {
  const { handler, redis } = await montar();
  assert.equal((await crear(handler, "ana", PAG, { tipo: "otro" })).res.status, 400);
  assert.equal((await crear(handler, "ana", "/restringido-demo/secreto/")).res.status, 403, "restringido sin acceso");
  assert.equal((await handler(escribir("POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "x" }, ct: "text/plain" }))).status, 415);
  assert.equal((await handler(escribir("POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "x" }, origin: "https://evil.example" }))).status, 403);
  assert.deepEqual(idx(redis, "uuv"), []);
  assert.deepEqual(idx(redis, "restringido-demo"), []);
  assert.ok(!redis.comandos.some(([c]) => /^SADD$/i.test(c)));
});

test("índice: al borrar el último comentario de una página sale del índice (SREM); si quedan comentarios, sigue", async () => {
  const { handler, redis } = await montar();
  const a = (await crear(handler, "ana", PAG)).json.comentario.id;
  const b = (await crear(handler, "ana", PAG)).json.comentario.id;
  const c = (await crear(handler, "ana", PAG2)).json.comentario.id;
  assert.equal((await handler(escribir("DELETE", { login: "ana", body: { pagina: PAG, id: a } }))).status, 200);
  assert.deepEqual(idx(redis, "uuv"), [PAG, PAG2].sort(), "queda b en PAG");
  assert.equal((await handler(escribir("DELETE", { login: "ana", body: { pagina: PAG, id: b } }))).status, 200);
  assert.equal((await handler(escribir("DELETE", { login: "ana", body: { pagina: PAG2, id: c } }))).status, 200);
  assert.deepEqual(idx(redis, "uuv"), [], "sin comentarios no queda ninguna página indexada");
  assert.ok(redis.comandos.some(([c]) => /^SREM$/i.test(c)));
});

// ---------- 2. Validación y acceso ----------

test("GET ?proyecto: 401 sin sesión, antes de validar nada", async () => {
  const { handler, redis } = await montar();
  for (const id of ["uuv", "no-existe", "restringido-demo"]) {
    const res = await porProyecto(handler, null, id);
    assert.equal(res.status, 401, id);
    cabecerasJson(res, "401");
  }
  assert.equal(redis.comandos.length, 0);
});

test("GET ?proyecto: 400 con id que no está en projects.json (exacto), vacío, con / o ..; o con pagina y proyecto a la vez", async () => {
  const { handler, redis } = await montar();
  for (const id of ["", "UUV", "uuv/", "../uuv", "uuv/arquitectura", "no-existe", "uuv ", "*", "uuv\u0000", "a".repeat(300)]) {
    const res = await porProyecto(handler, "ana", id);
    assert.equal(res.status, 400, JSON.stringify(id));
    cabecerasJson(res, "400");
    assert.equal(typeof (await res.json()).error, "string");
  }
  const ambos = await handler(leer({ login: "ana", qs: `proyecto=uuv&pagina=${encodeURIComponent(PAG)}` }));
  assert.equal(ambos.status, 400, "proyecto y pagina son excluyentes");
  assert.equal(redis.comandos.length, 0, "nada se lee del almacén con parámetros inválidos");
});

test("GET ?proyecto: restringido sin acceso → 403 sin datos ni lecturas; con acceso (sin mayúsculas) → 200", async () => {
  const { handler, redis } = await montar();
  sembrar(redis, "/restringido-demo/secreto/", { texto: "dato confidencial", autor: "cyuxSz" });
  redis.comandos.length = 0;
  const res = await porProyecto(handler, "ana", "restringido-demo");
  assert.equal(res.status, 403);
  cabecerasJson(res, "403");
  const cuerpo = await res.text();
  assert.doesNotMatch(cuerpo, /confidencial|secreto|cyuxSz/);
  assert.ok(!redis.comandos.some(([c]) => /^(SMEMBERS|HGETALL|SSCAN|SCAN)$/i.test(c)), "no consulta el almacén antes de comprobar acceso");
  const ok = await porProyecto(handler, "CYUXSZ", "restringido-demo");
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).paginas[0]?.pagina, "/restringido-demo/secreto/");
});

test("GET ?proyecto=uuv nunca devuelve páginas de otro proyecto aunque el índice esté manipulado", async () => {
  const { handler, redis } = await montar();
  sembrar(redis, "/restringido-demo/secreto/", { texto: "dato confidencial" });
  sembrar(redis, PAG, { texto: "visible" });
  for (const intruso of ["/restringido-demo/secreto/", "/uuv/../restringido-demo/secreto/", "uuv/x/", "/uuv/", "/uuv/a b/"]) redis.data.get("com:idx:uuv").add(intruso);
  const res = await porProyecto(handler, "ana", "uuv");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.paginas.map((p) => p.pagina), [PAG]);
  assert.doesNotMatch(JSON.stringify(body), /confidencial/);
  assert.ok(!redis.comandos.some(([c, k]) => /^HGETALL$/i.test(c) && !String(k).startsWith("com:/uuv/")), "solo lee hashes de rutas válidas del proyecto");
});

// ---------- 3. Forma de la respuesta ----------

test("GET ?proyecto: solo hilos raíz no resueltos ni borrados, agrupados por página, con campos mínimos y orden estable", async () => {
  const { handler, redis } = await montar();
  const t = (min) => new Date(T0 + min * 60_000).toISOString();
  const r1 = sembrar(redis, PAG, { autor: "ana", tipo: "duda", texto: "primero", creado: t(1) });
  sembrar(redis, PAG, { padre: r1, autor: "beto", texto: "respuesta", creado: t(2) });
  sembrar(redis, PAG, { autor: "beto", texto: "resuelto", resuelto: true, resueltoPor: "ana", creado: t(3) });
  const borrado = sembrar(redis, PAG, { autor: null, texto: "", borrado: true, creado: t(4) });
  sembrar(redis, PAG, { padre: borrado, autor: "carla", texto: "huérfano visible en la página", creado: t(5) });
  const r0 = sembrar(redis, PAG, { autor: "carla", tipo: "sugerencia", texto: "cero", creado: t(0), editado: t(9) });
  const r4 = sembrar(redis, PAG2, { autor: "beto", tipo: "bug", texto: "falla", creado: t(6) });
  sembrar(redis, "/uuv/solo-resueltos/", { resuelto: true, resueltoPor: "ana" });

  const res = await porProyecto(handler, "ana", "uuv");
  assert.equal(res.status, 200);
  cabecerasJson(res, "200");
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["paginas", "proyecto", "truncado", "yo"]);
  assert.equal(body.yo, "ana");
  assert.equal(body.proyecto, "uuv");
  assert.equal(body.truncado, false);
  assert.deepEqual(body.paginas.map((p) => p.pagina), [PAG, PAG2].sort(), "páginas en orden alfabético; sin hilos abiertos no aparecen");
  const a = body.paginas.find((p) => p.pagina === PAG);
  assert.deepEqual(Object.keys(a).sort(), ["abiertos", "hilos", "pagina"]);
  assert.equal(a.abiertos, 2);
  assert.deepEqual(a.hilos.map((h) => h.id), [r0, r1], "hilos por fecha de creación ascendente");
  for (const h of a.hilos) assert.deepEqual(Object.keys(h).sort(), ["autor", "creado", "extracto", "id", "menciones", "tipo"], "sin texto completo, padre, editado ni resueltoPor");
  assert.deepEqual(a.hilos[1], { id: r1, tipo: "duda", autor: "ana", creado: t(1), extracto: "primero", menciones: [] });
  assert.equal(body.paginas.find((p) => p.pagina === PAG2).hilos[0].id, r4);
});

test("extracto: hasta 140 caracteres (139 + «…» si se corta) sin partir emojis; texto corto, igual", async () => {
  const { handler, redis } = await montar();
  sembrar(redis, PAG, { id: "00000000-0000-4000-8000-a00000000001", texto: "😀".repeat(500), creado: new Date(T0).toISOString() });
  sembrar(redis, PAG, { id: "00000000-0000-4000-8000-a00000000002", texto: "a".repeat(140), creado: new Date(T0 + 1).toISOString() });
  sembrar(redis, PAG, { id: "00000000-0000-4000-8000-a00000000003", texto: "línea 1\nlínea 2", creado: new Date(T0 + 2).toISOString() });
  const [h1, h2, h3] = (await (await porProyecto(handler, "ana", "uuv")).json()).paginas[0].hilos;
  assert.equal([...h1.extracto].length, 140);
  assert.ok(h1.extracto.endsWith("…"));
  assert.doesNotMatch(h1.extracto, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/, "sin sustitutos sueltos");
  assert.equal(h2.extracto, "a".repeat(140), "140 exactos no se cortan");
  assert.equal(h3.extracto, "línea 1\nlínea 2", "el texto va crudo, sin HTML");
});

test("menciones del hilo: @login válidos del raíz y de sus respuestas no borradas, en minúsculas, sin repetir, máx. 10", async () => {
  const { handler, redis } = await montar();
  const r = sembrar(redis, PAG, { texto: "@Ana mira esto con @beto y @ana; correo x@y.com y @-malo", creado: new Date(T0).toISOString() });
  sembrar(redis, PAG, { padre: r, autor: "beto", texto: "cc (@Carla-2)", creado: new Date(T0 + 1).toISOString() });
  sembrar(redis, PAG, { padre: r, autor: null, texto: "", borrado: true, creado: new Date(T0 + 2).toISOString() });
  const muchos = Array.from({ length: 12 }, (_, i) => `@user${i}`).join(" ");
  sembrar(redis, PAG2, { texto: muchos });
  const body = await (await porProyecto(handler, "ana", "uuv")).json();
  assert.deepEqual(body.paginas.find((p) => p.pagina === PAG).hilos[0].menciones, ["ana", "beto", "carla-2"]);
  const m = body.paginas.find((p) => p.pagina === PAG2).hilos[0].menciones;
  assert.equal(m.length, 10);
  assert.deepEqual(m, Array.from({ length: 10 }, (_, i) => `user${i}`));
});

// ---------- 4. Límites ----------

test("límites: lee como máximo 100 páginas (orden alfabético) en un solo exec de HGETALL y marca truncado", async () => {
  const { handler, redis } = await montar();
  const paginas = Array.from({ length: 120 }, (_, i) => `/uuv/p${String(i).padStart(3, "0")}/`);
  for (const p of paginas) sembrar(redis, p, {});
  redis.lotes.length = 0;
  redis.comandos.length = 0;
  const body = await (await porProyecto(handler, "ana", "uuv")).json();
  assert.equal(body.truncado, true);
  assert.equal(body.paginas.length, 100);
  assert.deepEqual(body.paginas.map((p) => p.pagina), paginas.slice(0, 100));
  assert.ok(redis.comandos.filter(([c]) => /^HGETALL$/i.test(c)).length <= 100);
  assert.ok(redis.lotes.length <= 2, `a lo sumo 2 llamadas al almacén (índice + hashes), hubo ${redis.lotes.length}`);
  assert.ok(!redis.comandos.some(([c]) => /^(INCR|EXPIRE|SADD|SREM|HSET|HDEL)$/i.test(c)), "leer no escribe ni gasta el límite de escritura");
});

test("límites: como máximo 200 hilos en total → truncado; abiertos sigue contando todos los de la página", async () => {
  const { handler, redis } = await montar();
  for (const p of ["/uuv/a/", "/uuv/b/", "/uuv/c/"]) for (let i = 0; i < 90; i++) sembrar(redis, p, { creado: new Date(T0 + i * 1000).toISOString() });
  const body = await (await porProyecto(handler, "ana", "uuv")).json();
  assert.equal(body.truncado, true);
  assert.equal(body.paginas.reduce((s, p) => s + p.hilos.length, 0), 200);
  for (const p of body.paginas) assert.equal(p.abiertos, 90, p.pagina);
  const bytes = Buffer.byteLength(JSON.stringify(body));
  assert.ok(bytes < 256 * 1024, `respuesta acotada (${bytes} bytes)`);
});

test("datos corruptos en el almacén (JSON inválido, sin id, tipo raro) se ignoran sin 500", async () => {
  const { handler, redis } = await montar();
  const ok = sembrar(redis, PAG, { texto: "bueno" });
  redis.data.get(`com:${PAG}`).set("roto", "{no es json");
  redis.data.get(`com:${PAG}`).set("nulo", "null");
  redis.data.get(`com:${PAG}`).set("sin-id", JSON.stringify({ padre: null, texto: "x", creado: "2026-10-30T00:00:00Z" }));
  redis.data.get(`com:${PAG}`).set("texto-no-string", JSON.stringify({ id: "00000000-0000-4000-8000-b00000000001", padre: null, autor: "ana", tipo: "duda", texto: { a: 1 }, creado: "2026-10-30T00:00:00Z" }));
  redis.data.get("com:idx:uuv").add("/uuv/vacia/");
  const res = await porProyecto(handler, "ana", "uuv");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.paginas.map((p) => p.pagina), [PAG]);
  assert.ok(body.paginas[0].hilos.some((h) => h.id === ok));
  for (const h of body.paginas[0].hilos) assert.equal(typeof h.extracto, "string");
});

test("el GET por página (?pagina=) sigue igual: {yo, comentarios}", async () => {
  const { handler } = await montar();
  await crear(handler, "ana", PAG);
  const res = await handler(leer({ login: "ana", qs: `pagina=${encodeURIComponent(PAG)}` }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["comentarios", "yo"]);
  assert.equal(body.comentarios.length, 1);
});

test("autocuración: un GET ?pagina= con comentarios no borrados añade la página al índice (sin gastar rate limit); sin ellos, no", async () => {
  const { handler, redis } = await montar();
  // Comentarios previos al índice: hash sin entrada en com:idx.
  redis.data.set(`com:${PAG}`, new Map([["a", JSON.stringify({ id: "a", padre: null, autor: "ana", tipo: "duda", texto: "x", creado: new Date(T0).toISOString(), resuelto: false, borrado: false })]]));
  redis.data.set(`com:${PAG2}`, new Map([["b", JSON.stringify({ id: "b", padre: null, autor: null, tipo: "duda", texto: "", creado: new Date(T0).toISOString(), resuelto: false, borrado: true })]]));
  assert.deepEqual(idx(redis, "uuv"), []);
  assert.equal((await handler(leer({ login: "ana", qs: `pagina=${encodeURIComponent(PAG)}` }))).status, 200);
  assert.deepEqual(idx(redis, "uuv"), [PAG]);
  assert.equal((await handler(leer({ login: "ana", qs: `pagina=${encodeURIComponent(PAG2)}` }))).status, 200);
  assert.deepEqual(idx(redis, "uuv"), [PAG], "solo borrados: no entra");
  assert.ok(!redis.comandos.some(([c]) => /^(INCR|EXPIRE)$/i.test(c)), "no gasta el límite de escritura");
  const body = await (await porProyecto(handler, "ana", "uuv")).json();
  assert.deepEqual(body.paginas.map((p) => p.pagina), [PAG], "el panel ya lo ve");
});
