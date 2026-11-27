// Lote 1B-2, criterio 12: el tope de 5 códigos vivos por login se aplica en la misma escritura que crea el código
// (hilo de CodeRabbit sobre lib/login-core.mjs). Antes era una lectura (contarCodigosVivos) y luego crearCodigo, así que
// dos POST simultáneos con 4 códigos vivos dejaban 6. Ver .factory/spec.md, criterio 12.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { T0, crearEnv, sesion, peticionApp, consentir, enviarAutorizar, autorizar, filasCodigos, pkce, cargarCore } from "./fixtures/tokens-1b2.mjs";

const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const MAX = 5;
const LEE_CODIGOS = /^\s*SELECT\b[\s\S]*\bFROM\s+codigos_app\b/i;
// La sentencia condicional esperada: INSERT … SELECT …, … WHERE (SELECT count(*) FROM codigos_app WHERE lower(login) = ? AND expira > ?) < ?|5
const INSERT_CONDICIONAL = /^\s*INSERT\s+INTO\s+codigos_app\b(?![\s\S]*\bVALUES\b)[\s\S]*\bSELECT\b[\s\S]*\bWHERE\s*\(\s*SELECT\s+count\(\*\)\s+FROM\s+codigos_app\s+WHERE\s+lower\(login\)\s*=\s*\?\s+AND\s+expira\s*>\s*\?\s*\)\s*<\s*(\?|\d+)\s*$/i;
const esInsertCodigo = (sql) => /^\s*INSERT\s+INTO\s+codigos_app\b/i.test(sql);

// Intercala las lecturas de codigos_app como lo haría D1 con dos peticiones a la vez: las dos primeras lecturas
// esperan a que lleguen ambas (o 50 ms de reloj real, si solo llega una) y entonces se ejecutan, antes de que
// ninguna de las dos peticiones escriba. Las sentencias siguen siendo las del D1 de prueba (batch las acepta).
function intercalarLecturas(db, esperar = 2) {
  let llegados = 0;
  const parados = [];
  const soltar = () => parados.splice(0).forEach((r) => r());
  const barrera = () => {
    if (llegados >= esperar) return Promise.resolve();
    llegados++;
    if (llegados >= esperar) {
      soltar();
      return Promise.resolve();
    }
    return new Promise((r) => {
      parados.push(r);
      setTimeout(soltar, 50);
    });
  };
  const envolver = (st) => {
    const bind = st.bind.bind(st);
    st.bind = (...v) => envolver(bind(...v));
    for (const m of ["first", "all", "raw"]) {
      const original = st[m].bind(st);
      st[m] = async (...a) => {
        await barrera();
        return original(...a);
      };
    }
    return st;
  };
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => (LEE_CODIGOS.test(sql) ? envolver(prepare(sql)) : prepare(sql));
  return db;
}

// Deja `n` códigos vivos de `login` pasando por autorizar, un segundo entre cada uno.
async function llenar(env, login, n) {
  for (let i = 0; i < n; i++) {
    await autorizar(env, sesion(login), peticionApp().params);
    mock.timers.tick(1000);
  }
  assert.equal(filasCodigos(env).filter((f) => f.login === login).length, n);
}

const datos = () => ({ login: "ana", challenge: pkce().challenge, nombre: "PC de Ana", plataforma: "windows" });

// ---------- (a) concurrencia ----------

test("tope atómico: con 4 códigos vivos, dos «Autorizar» simultáneos crean uno solo; el otro da 429 con Retry-After", async () => {
  const { env } = crearEnv();
  await llenar(env, "ana", MAX - 1);
  const cookie = sesion("ana");
  const a = await consentir(env, cookie, peticionApp().params);
  const b = await consentir(env, cookie, peticionApp().params);
  intercalarLecturas(env.DB);

  const respuestas = await Promise.all([enviarAutorizar(env, { cookie, campos: a.campos }), enviarAutorizar(env, { cookie, campos: b.campos })]);
  const estados = respuestas.map((r) => r.status).sort();
  assert.equal(filasCodigos(env).length, MAX, `nunca más de ${MAX} códigos vivos por login (hay ${filasCodigos(env).length})`);
  assert.deepEqual(estados, [200, 429], `uno emite y el otro choca con el tope (estados: ${estados})`);
  const perdedora = respuestas.find((r) => r.status === 429);
  const espera = Number(perdedora.headers.get("retry-after"));
  assert.ok(Number.isInteger(espera) && espera >= 1 && espera <= 60, `Retry-After: ${perdedora.headers.get("retry-after")}`);
  assert.ok(!/vanttec-docs:/i.test(await perdedora.text()), "la respuesta 429 no lleva enlace a la app");
});

test("tope atómico: crearCodigo con maxVivos — de dos llamadas simultáneas con 4 vivos, una devuelve el código y la otra null", async () => {
  const { env } = crearEnv();
  const { crearCodigo } = await cargarCore();
  for (let i = 0; i < MAX - 1; i++) await crearCodigo(env.DB, datos());
  intercalarLecturas(env.DB);

  const res = await Promise.all([crearCodigo(env.DB, { ...datos(), maxVivos: MAX }), crearCodigo(env.DB, { ...datos(), maxVivos: MAX })]);
  assert.equal(filasCodigos(env).length, MAX, `nunca más de ${MAX} (hay ${filasCodigos(env).length})`);
  assert.equal(res.filter((c) => c === null).length, 1, `una de las dos no inserta y devuelve null (devolvió ${JSON.stringify(res.map((c) => (c === null ? null : typeof c)))})`);
  assert.equal(res.filter((c) => typeof c === "string" && /^[A-Za-z0-9_-]{43}$/.test(c)).length, 1, "la otra devuelve el código");
});

test("tope atómico: crearCodigo con maxVivos cuenta sin distinguir mayúsculas, ignora caducados y no afecta a otros logins; sin maxVivos, como siempre", async () => {
  const { env } = crearEnv();
  const { crearCodigo } = await cargarCore();
  for (let i = 0; i < MAX; i++) await crearCodigo(env.DB, datos());
  assert.equal(await crearCodigo(env.DB, { ...datos(), login: "Ana", maxVivos: MAX }), null, "«Ana» y «ana» comparten el tope");
  assert.equal(filasCodigos(env).length, MAX, "con el tope lleno no se inserta nada");
  assert.match((await crearCodigo(env.DB, { ...datos(), login: "beto", maxVivos: MAX })) ?? "", /^[A-Za-z0-9_-]{43}$/, "otro login no comparte el tope");
  mock.timers.tick(61_000);
  assert.match((await crearCodigo(env.DB, { ...datos(), maxVivos: MAX })) ?? "", /^[A-Za-z0-9_-]{43}$/, "los caducados no cuentan");
  // Sin maxVivos el contrato del 1A no cambia: siempre inserta y devuelve el código.
  for (let i = 0; i < MAX + 1; i++) assert.match(await crearCodigo(env.DB, datos()), /^[A-Za-z0-9_-]{43}$/);
  for (const malo of [0, -1, 1.5, "5", NaN, Infinity, null]) {
    await assert.rejects(() => crearCodigo(env.DB, { ...datos(), maxVivos: malo }), `maxVivos ${String(malo)} se rechaza`);
  }
});

// ---------- (b) una sola sentencia condicional ----------

test("tope atómico: crearCodigo con maxVivos inserta con una sola sentencia condicional INSERT … SELECT … WHERE (SELECT count(*) …) < tope, en el batch de la purga", async () => {
  const { env } = crearEnv();
  const { crearCodigo } = await cargarCore();
  const antes = { sql: env.DB.stats.sql.length, batch: env.DB.stats.batch, sueltas: env.DB.stats.sueltas };
  await crearCodigo(env.DB, { ...datos(), maxVivos: MAX });
  const sql = env.DB.stats.sql.slice(antes.sql);
  const inserts = sql.filter(esInsertCodigo);
  assert.equal(inserts.length, 1, `un solo INSERT en codigos_app: ${JSON.stringify(sql)}`);
  assert.match(inserts[0], INSERT_CONDICIONAL, "el INSERT lleva la condición del tope en la misma sentencia");
  assert.ok(!sql.some((s) => LEE_CODIGOS.test(s)), `ninguna lectura separada de codigos_app: ${JSON.stringify(sql)}`);
  assert.equal(env.DB.stats.batch - antes.batch, 1, "purga e inserción siguen en un único batch");
  assert.equal(env.DB.stats.sueltas - antes.sueltas, 0, "sin sentencias sueltas al crear");
});

test("tope atómico: «Autorizar» no lee codigos_app antes de insertar; con el tope lleno lo intenta igual y solo después lee la primera caducidad", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const { campos } = await consentir(env, cookie, peticionApp().params);
  let desde = env.DB.stats.sql.length;
  assert.equal((await enviarAutorizar(env, { cookie, campos })).status, 200);
  let sql = env.DB.stats.sql.slice(desde);
  let i = sql.findIndex(esInsertCodigo);
  assert.ok(i >= 0, `se inserta el código: ${JSON.stringify(sql)}`);
  assert.match(sql[i], INSERT_CONDICIONAL, "el tope va dentro del INSERT");
  assert.ok(!sql.slice(0, i).some((s) => LEE_CODIGOS.test(s)), `ninguna lectura de codigos_app decide el tope antes del INSERT: ${JSON.stringify(sql.slice(0, i))}`);

  await llenar(env, "ana", MAX - 1);
  assert.equal(filasCodigos(env).length, MAX);
  const lleno = await consentir(env, cookie, peticionApp().params);
  desde = env.DB.stats.sql.length;
  const res = await enviarAutorizar(env, { cookie, campos: lleno.campos });
  assert.equal(res.status, 429);
  const espera = Number(res.headers.get("retry-after"));
  assert.ok(Number.isInteger(espera) && espera >= 1 && espera <= 60, `Retry-After: ${res.headers.get("retry-after")}`);
  sql = env.DB.stats.sql.slice(desde);
  i = sql.findIndex(esInsertCodigo);
  assert.ok(i >= 0, `con el tope lleno se intenta el INSERT condicional (que no inserta): ${JSON.stringify(sql)}`);
  assert.match(sql[i], INSERT_CONDICIONAL);
  assert.ok(!sql.slice(0, i).some((s) => LEE_CODIGOS.test(s)), "la lectura de la primera caducidad, si la hay, va después del INSERT");
  assert.equal(filasCodigos(env).length, MAX, "no se creó nada");
});
