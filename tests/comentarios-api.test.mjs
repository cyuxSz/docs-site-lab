// Lote 7a: API de comentarios por página (api/comentarios.js → lib/comentarios-core.mjs) sobre Upstash Redis (REST).
// El cliente Redis se inyecta: aquí es un fake en memoria con la misma forma que el real (exec(comandos) → resultados
// crudos de /pipeline de Upstash; HGETALL devuelve [campo, valor, ...]).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/comentarios/`;
const PROYECTOS = [{ id: "uuv" }, { id: "proyecto-x" }];
const PAG = "/uuv/arquitectura/";
const T0 = Date.parse("2026-10-30T12:00:00Z");
const realFetch = globalThis.fetch;

const core = () => import("../lib/comentarios-core.mjs");

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[k];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function cookieDe(login, { exp = Date.now() + 864e5, secret = SECRET } = {}) {
  const body = Buffer.from(JSON.stringify({ login, exp })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

// Redis en memoria con los comandos que una implementación simple necesita.
function fakeRedis() {
  const data = new Map();
  const ttl = new Map();
  const hash = (k) => {
    if (!data.has(k)) data.set(k, new Map());
    return data.get(k);
  };
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case "HGETALL": return data.has(a[0]) ? [...data.get(a[0])].flat() : [];
      case "HGET": return data.get(a[0])?.get(a[1]) ?? null;
      case "HMGET": return a.slice(1).map((f) => data.get(a[0])?.get(f) ?? null);
      case "HEXISTS": return data.get(a[0])?.has(a[1]) ? 1 : 0;
      case "HLEN": return data.get(a[0])?.size ?? 0;
      case "HKEYS": return [...(data.get(a[0])?.keys() ?? [])];
      case "HVALS": return [...(data.get(a[0])?.values() ?? [])];
      case "HSET": { const h = hash(a[0]); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return n; }
      case "HSETNX": { const h = hash(a[0]); if (h.has(a[1])) return 0; h.set(a[1], String(a[2])); return 1; }
      case "HDEL": { const h = data.get(a[0]); let n = 0; for (const f of a.slice(1)) if (h?.delete(f)) n++; if (h instanceof Map && h.size === 0) data.delete(a[0]); return n; }
      case "SADD": { if (!(data.get(a[0]) instanceof Set)) data.set(a[0], new Set()); let n = 0; for (const m of a.slice(1)) if (!data.get(a[0]).has(String(m))) { data.get(a[0]).add(String(m)); n++; } return n; }
      case "SREM": { const s = data.get(a[0]); let n = 0; for (const m of a.slice(1)) if (s instanceof Set && s.delete(String(m))) n++; if (s instanceof Set && s.size === 0) data.delete(a[0]); return n; }
      case "SMEMBERS": return data.get(a[0]) instanceof Set ? [...data.get(a[0])] : [];
      case "INCR": { const v = Number(data.get(a[0]) ?? 0) + 1; data.set(a[0], String(v)); return v; }
      case "GET": return typeof data.get(a[0]) === "string" ? data.get(a[0]) : null;
      case "SET": data.set(a[0], String(a[1])); return "OK";
      case "DEL": { let n = 0; for (const k of a) if (data.delete(k)) n++; return n; }
      case "EXPIRE": if (!data.has(a[0])) return 0; if (String(a[2] ?? "").toUpperCase() === "NX" && ttl.has(a[0])) return 0; ttl.set(a[0], Number(a[1])); return 1;
      case "TTL": return data.has(a[0]) ? (ttl.get(a[0]) ?? -1) : -2;
      default: throw new Error(`fake: comando no soportado ${cmd}`);
    }
  };
  return { data, comandos: [], async exec(cmds) { this.comandos.push(...cmds); return cmds.map(run); } };
}

let n = 0;
async function montar({ redis = fakeRedis(), env = {}, ahora = () => T0 } = {}) {
  const { crearHandler } = await core();
  const handler = crearHandler({
    env: { SESSION_SECRET: SECRET, ...env },
    redis,
    proyectos: PROYECTOS,
    ahora,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
  return { handler, redis };
}

function req(method, { login, cookie, body, pagina, origin = ORIGIN, ct = "application/json" } = {}) {
  const headers = {};
  if (login) headers.cookie = cookieDe(login);
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    if (ct) headers["content-type"] = ct;
    if (origin) headers.origin = origin;
  }
  const url = pagina !== undefined ? `${URL_API}?pagina=${encodeURIComponent(pagina)}` : URL_API;
  return new Request(url, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

const listar = async (h, login = "ana", pagina = PAG) => (await (await h(req("GET", { login, pagina }))).json()).comentarios;
async function crear(h, login, extra = {}) {
  const res = await h(req("POST", { login, body: { pagina: PAG, tipo: "duda", texto: "¿Por qué el PID ignora x/y?", ...extra } }));
  return { res, json: await res.json() };
}

function cabecerasJson(res, que) {
  assert.match(res.headers.get("content-type") ?? "", /application\/json/, `${que}: content-type`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${que}: cache-control`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${que}: nosniff`);
}

// ---------- Identidad y configuración ----------

test("401: sin cookie, alterada, caducada, de otro secreto o mal formada", async () => {
  const { handler } = await montar();
  const cookies = [undefined, "docs_session=a.b", cookieDe("ana", { exp: Date.now() - 1 }), cookieDe("ana", { secret: "x".repeat(40) }), "docs_session=%E0%A4%A", `${cookieDe("ana")}x`];
  for (const cookie of cookies) {
    for (const method of ["GET", "POST"]) {
      const res = await handler(req(method, { cookie, pagina: PAG, body: method === "POST" ? { pagina: PAG, tipo: "duda", texto: "hola" } : undefined }));
      assert.equal(res.status, 401, `${method} ${cookie}`);
      cabecerasJson(res, "401");
      assert.equal(typeof (await res.json()).error, "string");
    }
  }
});

test("503 'Comentarios no configurados' si no hay almacén (sin variables de Upstash) y sesión válida", async () => {
  const { crearHandler } = await core();
  for (const redis of [undefined, null]) {
    const handler = crearHandler({ env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS });
    const res = await handler(req("GET", { login: "ana", pagina: PAG }));
    assert.equal(res.status, 503, `redis=${redis}`);
    cabecerasJson(res, "503");
    assert.match((await res.json()).error, /Comentarios no configurados/);
  }
});

test("clienteRedis: null sin variables; acepta KV_REST_API_* o UPSTASH_REDIS_REST_* y usa /pipeline con Bearer", async () => {
  const { clienteRedis } = await core();
  assert.equal(clienteRedis({}), null);
  assert.equal(clienteRedis({ KV_REST_API_URL: "https://x.upstash.io" }), null, "sin token no hay cliente");
  for (const [url, tok] of [["KV_REST_API_URL", "KV_REST_API_TOKEN"], ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]]) {
    const llamadas = [];
    globalThis.fetch = async (input, init = {}) => {
      llamadas.push({ url: String(input instanceof Request ? input.url : input), init });
      return Response.json([{ result: [] }, { result: "OK" }]);
    };
    const c = clienteRedis({ [url]: "https://x.upstash.io", [tok]: "TOKEN-SECRETO" });
    assert.ok(c, url);
    assert.deepEqual(await c.exec([["HGETALL", "k"], ["SET", "a", "1"]]), [[], "OK"]);
    assert.equal(llamadas.length, 1, "una sola llamada REST por exec");
    assert.equal(llamadas[0].url, "https://x.upstash.io/pipeline");
    assert.equal(llamadas[0].init.method, "POST");
    assert.equal(new Headers(llamadas[0].init.headers).get("authorization"), "Bearer TOKEN-SECRETO");
    assert.deepEqual(JSON.parse(llamadas[0].init.body), [["HGETALL", "k"], ["SET", "a", "1"]]);
  }
});

test("clienteRedis: un error de Upstash lanza sin incluir el token; la API responde 503 genérico", async () => {
  const { clienteRedis, crearHandler } = await core();
  const env = { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "TOKEN-SECRETO" };
  for (const respuesta of [() => new Response("boom TOKEN-SECRETO", { status: 500 }), () => Response.json([{ error: "WRONGTYPE TOKEN-SECRETO" }])]) {
    globalThis.fetch = async () => respuesta();
    const err = await clienteRedis(env).exec([["HGETALL", "k"]]).then(() => null, (e) => e);
    assert.ok(err instanceof Error, "debe lanzar");
    assert.ok(!String(err.message).includes("TOKEN-SECRETO"), "el error no filtra el token");
    const handler = crearHandler({ env: { SESSION_SECRET: SECRET, ...env }, proyectos: PROYECTOS });
    const res = await handler(req("GET", { login: "ana", pagina: PAG }));
    assert.equal(res.status, 503);
    const txt = await res.text();
    assert.ok(!txt.includes("TOKEN-SECRETO") && !txt.includes("WRONGTYPE") && !txt.includes("boom"), "sin detalles internos");
  }
});

test("con variables KV_* el handler construye el cliente desde env y lista (200)", async () => {
  const { crearHandler } = await core();
  globalThis.fetch = async (input, init = {}) => Response.json(JSON.parse(init.body).map(() => ({ result: [] })));
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET, KV_REST_API_URL: "https://x.upstash.io", KV_REST_API_TOKEN: "t" }, proyectos: PROYECTOS });
  const res = await handler(req("GET", { login: "ana", pagina: PAG }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { yo: "ana", comentarios: [] });
});

// ---------- Validación ----------

test("validación de pagina: solo rutas internas /<proyecto existente>/<ruta>/ sin .., espacios ni puntos", async () => {
  const { handler } = await montar();
  const malas = ["", "uuv/a/", "/uuv/", "/uuv", "/uuv/a", "/noexiste/a/", "/uuv/../proyecto-x/a/", "/uuv/a/../b/", "/uuv//a/", "/uuv/a b/", "/uuv/a.md/", "/uuv/%2e%2e/a/", "//evil.com/a/", "https://evil.com/uuv/a/", "/uuv/a\\b/", `/uuv/${"a".repeat(300)}/`, "/UUV/a/"];
  for (const pagina of malas) {
    const g = await handler(req("GET", { login: "ana", pagina }));
    assert.equal(g.status, 400, `GET ${JSON.stringify(pagina)}`);
    cabecerasJson(g, "400");
    const p = await handler(req("POST", { login: `v${pagina.length}${Math.random()}`, body: { pagina, tipo: "duda", texto: "hola" } }));
    assert.equal(p.status, 400, `POST ${JSON.stringify(pagina)}`);
  }
  assert.equal((await handler(req("GET", { login: "ana" }))).status, 400, "sin ?pagina");
  for (const pagina of ["/uuv/arquitectura/", "/uuv/INSTRUCTIONS/", "/uuv/packages/control/", "/uuv/a_b-c/"]) {
    assert.equal((await handler(req("GET", { login: "ana", pagina }))).status, 200, pagina);
  }
});

test("validación de tipo (lista blanca) y texto (1–2000, sin caracteres de control)", async () => {
  const { TIPOS } = await core();
  assert.deepEqual([...TIPOS], ["duda", "aclaracion", "sugerencia", "bug"]);
  const { handler } = await montar();
  const malos = [
    { tipo: "otro" }, { tipo: "" }, { tipo: undefined }, { tipo: ["duda"] }, { tipo: "__proto__" },
    { texto: "" }, { texto: "   \n  " }, { texto: "a".repeat(2001) }, { texto: 123 }, { texto: null },
    { texto: "hola\u0000" }, { texto: "hola\u001b[31m" }, { texto: "hola\u007f" },
  ];
  let u = 0;
  for (const m of malos) {
    const { res } = await crear(handler, `u${++u}`, m);
    assert.equal(res.status, 400, JSON.stringify(m));
  }
  for (const tipo of TIPOS) assert.equal((await crear(handler, `u${++u}`, { tipo })).res.status, 201, tipo);
  assert.equal((await crear(handler, "ana", { texto: "a".repeat(2000) })).res.status, 201, "2000 caracteres es válido");
  const { json } = await crear(handler, "ana", { texto: "línea 1\nlínea 2\t<b>x</b>" });
  assert.equal(json.comentario.texto, "línea 1\nlínea 2\t<b>x</b>", "saltos de línea permitidos; el HTML se guarda como texto");
});

test("cuerpo: JSON inválido → 400; más de 16 KB → 413; sin escribir nada", async () => {
  const { handler, redis } = await montar();
  assert.equal((await handler(req("POST", { login: "ana", body: "{no es json" }))).status, 400);
  assert.equal((await handler(req("POST", { login: "ana", body: "[]" }))).status, 400);
  const grande = JSON.stringify({ pagina: PAG, tipo: "duda", texto: "a".repeat(17 * 1024) });
  assert.equal((await handler(req("POST", { login: "ana", body: grande }))).status, 413);
  assert.deepEqual(await listar(handler), []);
  assert.ok(!redis.comandos.some(([c]) => /^HSET/i.test(c)), "no se escribió en Redis");
});

// ---------- Creación, identidad del autor y lectura ----------

test("POST crea con autor de la sesión e id del servidor; el body no puede fijar autor, id ni fechas", async () => {
  const { handler } = await montar();
  const { res, json } = await crear(handler, "ana", { autor: "mallory", id: "mio", creado: "2000-01-01", resuelto: true, borrado: true });
  assert.equal(res.status, 201);
  cabecerasJson(res, "201");
  const c = json.comentario;
  assert.equal(c.autor, "ana");
  assert.match(c.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(c.id, "mio");
  assert.equal(c.creado, new Date(T0).toISOString());
  assert.equal(c.padre, null);
  assert.equal(c.resuelto, false);
  assert.equal(c.borrado, false);
  assert.equal(c.editado, null);
  assert.equal(c.tipo, "duda");
});

test("GET devuelve {yo, comentarios} en orden de creación, solo de esa página", async () => {
  let t = T0;
  const { handler } = await montar({ ahora: () => (t += 1000) });
  await crear(handler, "ana", { texto: "primero" });
  await crear(handler, "beto", { texto: "segundo" });
  await handler(req("POST", { login: "ana", body: { pagina: "/uuv/otra/", tipo: "bug", texto: "otra página" } }));
  const res = await handler(req("GET", { login: "Carla", pagina: PAG }));
  assert.equal(res.status, 200);
  cabecerasJson(res, "GET");
  const json = await res.json();
  assert.equal(json.yo, "Carla");
  assert.deepEqual(json.comentarios.map((c) => c.texto), ["primero", "segundo"]);
  for (const k of ["id", "padre", "autor", "tipo", "texto", "creado", "editado", "resuelto", "resueltoPor", "borrado"]) assert.ok(k in json.comentarios[0], k);
});

// ---------- Autorización ----------

test("proyecto restringido: sin acceso → 403 al leer y escribir; con acceso → permitido", async () => {
  const { handler } = await montar();
  const pagina = "/proyecto-x/arquitectura/";
  assert.equal((await handler(req("GET", { login: "otro", pagina }))).status, 403);
  assert.equal((await handler(req("POST", { login: "otro", body: { pagina, tipo: "duda", texto: "hola" } }))).status, 403);
  assert.equal((await handler(req("GET", { login: "CyuxSZ", pagina }))).status, 200);
  const c = await handler(req("POST", { login: "cyuxSz", body: { pagina, tipo: "duda", texto: "hola" } }));
  assert.equal(c.status, 201);
  const { id } = (await c.json()).comentario;
  for (const body of [{ pagina, id, texto: "x" }, { pagina, id, resuelto: true }]) assert.equal((await handler(req("PATCH", { login: "otro", body }))).status, 403);
  assert.equal((await handler(req("DELETE", { login: "otro", body: { pagina, id } }))).status, 403);
});

test("editar: solo el autor (sin distinguir mayúsculas); marca 'editado'; ajeno → 403; id inexistente → 404; id inválido → 400", async () => {
  let t = T0;
  const { handler } = await montar({ ahora: () => (t += 1000) });
  const { json } = await crear(handler, "ana");
  const id = json.comentario.id;
  const ajeno = await handler(req("PATCH", { login: "beto", body: { pagina: PAG, id, texto: "hackeado" } }));
  assert.equal(ajeno.status, 403);
  assert.equal((await listar(handler))[0].texto, "¿Por qué el PID ignora x/y?");
  const ok = await handler(req("PATCH", { login: "ANA", body: { pagina: PAG, id, texto: "Texto corregido" } }));
  assert.equal(ok.status, 200);
  const [c] = await listar(handler);
  assert.equal(c.texto, "Texto corregido");
  assert.ok(c.editado && c.editado > c.creado, "registra la fecha de edición");
  assert.equal(c.autor, "ana", "el autor no cambia");
  assert.equal((await handler(req("PATCH", { login: "ana", body: { pagina: PAG, id, texto: "" } }))).status, 400);
  assert.equal((await handler(req("PATCH", { login: "ana", body: { pagina: PAG, id: "00000000-0000-4000-8000-999999999999", texto: "x" } }))).status, 404);
  assert.equal((await handler(req("PATCH", { login: "ana", body: { pagina: PAG, id: "../x", texto: "x" } }))).status, 400);
  assert.equal((await handler(req("PATCH", { login: "ana", body: { pagina: "/uuv/otra/", id, texto: "x" } }))).status, 404, "el id es de otra página");
});

test("resolver: cualquiera con acceso marca/desmarca un comentario raíz y queda quién; en una respuesta → 400", async () => {
  const { handler } = await montar();
  const raiz = (await crear(handler, "ana")).json.comentario.id;
  const r = await handler(req("PATCH", { login: "beto", body: { pagina: PAG, id: raiz, resuelto: true } }));
  assert.equal(r.status, 200);
  let [c] = await listar(handler);
  assert.equal(c.resuelto, true);
  assert.equal(c.resueltoPor, "beto");
  assert.equal(c.texto, "¿Por qué el PID ignora x/y?", "resolver no toca el texto");
  await handler(req("PATCH", { login: "ana", body: { pagina: PAG, id: raiz, resuelto: false } }));
  [c] = await listar(handler);
  assert.equal(c.resuelto, false);
  assert.equal(c.resueltoPor, null);
  assert.equal((await handler(req("PATCH", { login: "ana", body: { pagina: PAG, id: raiz, resuelto: "si" } }))).status, 400);
  const resp = (await crear(handler, "beto", { padre: raiz, texto: "respuesta" })).json.comentario.id;
  assert.equal((await handler(req("PATCH", { login: "beto", body: { pagina: PAG, id: resp, resuelto: true } }))).status, 400);
});

// ---------- Hilos y borrado ----------

test("hilos de 1 nivel: responder a un raíz sí; a una respuesta, a un padre inexistente o de otra página → 400", async () => {
  const { handler } = await montar();
  const raiz = (await crear(handler, "ana")).json.comentario.id;
  const { res, json } = await crear(handler, "beto", { padre: raiz, texto: "Porque el control solo usa z" });
  assert.equal(res.status, 201);
  assert.equal(json.comentario.padre, raiz);
  assert.equal((await crear(handler, "ana", { padre: json.comentario.id })).res.status, 400, "no hay respuestas a respuestas");
  assert.equal((await crear(handler, "ana", { padre: "00000000-0000-4000-8000-999999999999" })).res.status, 400);
  assert.equal((await crear(handler, "ana", { padre: 42 })).res.status, 400);
  const otra = await (await handler(req("POST", { login: "ana", body: { pagina: "/uuv/otra/", tipo: "duda", texto: "x" } }))).json();
  assert.equal((await crear(handler, "ana", { padre: otra.comentario.id })).res.status, 400);
});

test("borrar: solo el autor; sin respuestas desaparece; con respuestas queda 'borrado' sin texto ni autor y el hilo sigue", async () => {
  const { handler } = await montar();
  const solo = (await crear(handler, "ana", { texto: "solo" })).json.comentario.id;
  const raiz = (await crear(handler, "ana", { texto: "con hilo" })).json.comentario.id;
  const resp = (await crear(handler, "beto", { padre: raiz, texto: "respuesta" })).json.comentario.id;

  assert.equal((await handler(req("DELETE", { login: "beto", body: { pagina: PAG, id: solo } }))).status, 403);
  assert.equal((await listar(handler)).length, 3);

  assert.equal((await handler(req("DELETE", { login: "ana", body: { pagina: PAG, id: solo } }))).status, 200);
  assert.ok(!(await listar(handler)).some((c) => c.id === solo), "sin respuestas se elimina");

  assert.equal((await handler(req("DELETE", { login: "Ana", body: { pagina: PAG, id: raiz } }))).status, 200);
  const lista = await listar(handler);
  const r = lista.find((c) => c.id === raiz);
  assert.ok(r, "el raíz con respuestas se conserva");
  assert.equal(r.borrado, true);
  assert.equal(r.texto, "");
  assert.equal(r.autor, null);
  assert.equal(lista.find((c) => c.id === resp)?.texto, "respuesta", "la respuesta sigue");

  assert.equal((await handler(req("PATCH", { login: "ana", body: { pagina: PAG, id: raiz, texto: "revivir" } }))).status, 403, "un borrado no se edita");
  assert.equal((await handler(req("DELETE", { login: "beto", body: { pagina: PAG, id: resp } }))).status, 200);
  assert.ok(!(await listar(handler)).some((c) => c.id === resp));
  assert.equal((await handler(req("DELETE", { login: "ana", body: { pagina: PAG, id: "00000000-0000-4000-8000-999999999999" } }))).status, 404);
});

// ---------- CSRF y abuso ----------

test("CSRF: POST/PATCH/DELETE exigen Content-Type JSON (415) y Origin igual al host (403); nada se escribe", async () => {
  const { handler } = await montar();
  const id = (await crear(handler, "ana")).json.comentario.id;
  const cuerpos = { POST: { pagina: PAG, tipo: "duda", texto: "csrf" }, PATCH: { pagina: PAG, id, texto: "csrf" }, DELETE: { pagina: PAG, id } };
  for (const [method, body] of Object.entries(cuerpos)) {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", null]) {
      assert.equal((await handler(req(method, { login: "ana", body, ct }))).status, 415, `${method} ${ct}`);
    }
    for (const origin of ["https://evil.example", "https://docs.example.evil.com", "null", "http://docs.example", null]) {
      const res = await handler(req(method, { login: "ana", body, origin }));
      assert.equal(res.status, 403, `${method} origin=${origin}`);
      cabecerasJson(res, "403");
    }
  }
  const lista = await listar(handler);
  assert.equal(lista.length, 1, "ninguna escritura rechazada llegó a Redis");
  assert.ok(!lista.some((c) => c.texto === "csrf"));
  const conCharset = await handler(req("POST", { login: "ana", body: { pagina: PAG, tipo: "duda", texto: "ok" }, ct: "application/json; charset=utf-8" }));
  assert.equal(conCharset.status, 201, "application/json con charset es válido");
});

test("límite: 10 escrituras por minuto por usuario → la 11.ª es 429 con Retry-After; GET no cuenta; otro usuario sigue", async () => {
  const { handler, redis } = await montar();
  for (let i = 0; i < 20; i++) await handler(req("GET", { login: "ana", pagina: PAG }));
  for (let i = 0; i < 10; i++) assert.equal((await crear(handler, "ana", { texto: `c${i}` })).res.status, 201, `escritura ${i + 1}`);
  const res = (await crear(handler, "ana", { texto: "sobra" })).res;
  assert.equal(res.status, 429);
  cabecerasJson(res, "429");
  assert.ok(Number(res.headers.get("retry-after")) > 0, "Retry-After en segundos");
  const id = (await listar(handler))[0].id;
  assert.equal((await handler(req("PATCH", { login: "ANA", body: { pagina: PAG, id, texto: "x" } }))).status, 429, "cuenta por login sin mayúsculas y para cualquier escritura");
  assert.equal((await crear(handler, "beto")).res.status, 201);
  assert.ok(redis.comandos.some(([c]) => /^EXPIRE$/i.test(c)), "la ventana caduca (EXPIRE)");
  assert.ok(!(await listar(handler)).some((c) => c.texto === "sobra"));
});

test("métodos no soportados → 405 JSON con Allow", async () => {
  const { handler } = await montar();
  const res = await handler(req("PUT", { login: "ana", body: { pagina: PAG } }));
  assert.equal(res.status, 405);
  cabecerasJson(res, "405");
  assert.match(res.headers.get("allow") ?? "", /GET.*POST.*PATCH.*DELETE/);
});

// ---------- Vercel Function ----------

test("api/comentarios.js exporta GET/POST/PATCH/DELETE que delegan en el core (sin sesión → 401)", async () => {
  const api = await import("../api/comentarios.js");
  for (const m of ["GET", "POST", "PATCH", "DELETE"]) assert.equal(typeof api[m], "function", m);
  const res = await api.GET(new Request(`${URL_API}?pagina=${encodeURIComponent(PAG)}`));
  assert.equal(res.status, 401);
  cabecerasJson(res, "api 401");
});

test("503: con SESSION_SECRET ausente o corto no acepta ninguna cookie (misma política que el middleware)", async () => {
  for (const secreto of [undefined, "abc"]) {
    const { handler } = await montar({ env: { SESSION_SECRET: secreto } });
    const res = await handler(req("GET", { cookie: cookieDe("ana", { secret: secreto ?? "" }), pagina: PAG }));
    assert.equal(res.status, 503, `secreto ${secreto}`);
    cabecerasJson(res, "503");
  }
});

// ---------- Auditoría de seguridad: resolver hilos es una decisión intencional ----------

test("resolver (decisión del equipo): cualquier usuario autenticado con acceso resuelve hilos ajenos, pero no edita su texto", async () => {
  const { handler } = await montar();
  const raiz = (await crear(handler, "ana")).json.comentario.id;
  const r = await handler(req("PATCH", { login: "carol", body: { pagina: PAG, id: raiz, resuelto: true } }));
  assert.equal(r.status, 200, "un tercero (ni autor ni quien respondió) puede resolver");
  let [c] = await listar(handler);
  assert.equal(c.resuelto, true);
  assert.equal(c.resueltoPor, "carol");
  assert.equal((await handler(req("PATCH", { login: "dani", body: { pagina: PAG, id: raiz, resuelto: false } }))).status, 200, "y otro puede reabrirlo");
  [c] = await listar(handler);
  assert.equal(c.resuelto, false);
  assert.equal((await handler(req("PATCH", { login: "carol", body: { pagina: PAG, id: raiz, texto: "hackeado" } }))).status, 403, "editar sigue siendo solo del autor");
});

test("comentarios-core.mjs: la rama PATCH de 'resuelto' documenta que sin chequeo de autor es intencional", () => {
  const src = readFileSync(new URL("../lib/comentarios-core.mjs", import.meta.url), "utf8");
  const i = src.indexOf("actual.resuelto = resuelto;");
  assert.ok(i > 0, "la asignación de resuelto sigue en su sitio");
  const antes = src.slice(src.lastIndexOf("} else {", i), i);
  assert.match(antes, /\/\/[^\n]*intencional/i, "comentario en español que diga que es intencional");
  assert.match(antes, /\/\/[^\n]*(cualquier usuario|cualquiera)[^\n]*/i, "y que cualquier usuario autenticado puede resolver");
  assert.doesNotMatch(antes, /esAutor/, "el comportamiento no cambia: sin chequeo de autor");
});
