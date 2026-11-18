// M2c: adaptador clienteD1(db) con el protocolo de comandos de los cores: { exec(comandos) → resultados }.
// Se prueba contra un D1 de prueba (node:sqlite con la API de D1, tests/fixtures/d1-sqlite.mjs) y en paridad con el
// almacén en memoria (tests/fixtures/almacen-memoria.mjs): misma secuencia de comandos → mismos resultados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";
import { crearD1, archivosMigracion } from "./fixtures/d1-sqlite.mjs";

const raiz = new URL("../", import.meta.url);
const leer = (p) => readFileSync(new URL(p, raiz), "utf8");
const existe = (p) => existsSync(new URL(p, raiz));
const cargar = () => import("../lib/almacen-d1.mjs");

// Los scripts EVAL que usan los cores (texto exacto). El adaptador los reconoce por su texto y falla cerrado ante otro.
const LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const FENCING_PARTES = [
  "for i=1,#KEYS do if redis.call('get', KEYS[i]) ~= ARGV[i] then return 'FENCED' end end ",
  "local p=#KEYS+1 local n=tonumber(ARGV[p]) p=p+1 ",
  "for c=1,n do local k=tonumber(ARGV[p]) p=p+1 local a={} for j=1,k do a[j]=ARGV[p] p=p+1 end redis.call(unpack(a)) end ",
  "return 'APLICADO'",
];
const FENCING = FENCING_PARTES.join("");
const INSERTAR = "if redis.call('sismember', KEYS[2], ARGV[1]) == 1 then return 0 end return redis.call('hsetnx', KEYS[1], ARGV[1], ARGV[2])";
const fencing = (candados, cmds) => ["EVAL", FENCING, candados.length, ...candados.map((c) => c[0]), ...candados.map((c) => c[1]), cmds.length, ...cmds.flatMap((c) => [c.length, ...c])];

const T0 = Date.parse("2026-11-16T10:00:00Z");

async function d1({ ahora } = {}) {
  const { clienteD1 } = await cargar();
  const db = crearD1();
  let t = T0;
  const reloj = ahora ?? (() => t);
  const almacen = clienteD1(db, { ahora: reloj });
  return { db, almacen, avanzar: (ms) => (t += ms) };
}

// Redis en memoria y D1 con el mismo reloj.
async function pareja() {
  const { clienteD1 } = await cargar();
  let t = T0;
  const redis = fakeRedis();
  redis.reloj.ahora = () => t;
  const db = crearD1();
  return { redis, db, d1: clienteD1(db, { ahora: () => t }), avanzar: (ms) => (t += ms) };
}

const normalizar = (cmd, r) => (String(cmd[0]).toUpperCase() === "SMEMBERS" && Array.isArray(r) ? [...r].sort() : r);

async function compararSecuencia(pasos) {
  const p = await pareja();
  for (const [i, paso] of pasos.entries()) {
    if (typeof paso === "number") {
      p.avanzar(paso);
      continue;
    }
    const esperado = await p.redis.exec(paso);
    const obtenido = await p.d1.exec(paso);
    assert.deepEqual(
      obtenido.map((r, j) => normalizar(paso[j], r)),
      esperado.map((r, j) => normalizar(paso[j], r)),
      `paso ${i}: ${JSON.stringify(paso).slice(0, 160)}`,
    );
  }
  return p;
}

// ---------- Esquema, binding y despliegue ----------

test("migrations/0001_*.sql existe, es la única 0001 y no borra tablas", () => {
  const archivos = archivosMigracion();
  assert.ok(archivos.length >= 1, "falta migrations/0001_*.sql");
  assert.match(archivos[0], /^0001_[\w-]+\.sql$/);
  assert.equal(archivos.filter((f) => f.startsWith("0001_")).length, 1);
  const sql = leer(`migrations/${archivos[0]}`);
  assert.match(sql, /CREATE TABLE/i);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, "la migración inicial no borra nada");
  assert.doesNotMatch(sql, /\bBEGIN\b|\bCOMMIT\b/i, "wrangler d1 migrations ya la envuelve en una transacción");
  // Se aplica sobre un SQLite vacío sin error (crearD1 la aplica).
  crearD1().cerrar();
});

function jsonc(texto) {
  let out = "";
  let cad = false;
  for (let i = 0; i < texto.length; i++) {
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

test("wrangler.jsonc: binding D1 DB → docs-site con migrations/, sin database_id inventado; R2 intacto", () => {
  const c = jsonc(leer("wrangler.jsonc"));
  assert.ok(Array.isArray(c.d1_databases) && c.d1_databases.length === 1, "falta d1_databases");
  const [d] = c.d1_databases;
  assert.equal(d.binding, "DB");
  assert.equal(d.database_name, "docs-site");
  assert.ok(d.migrations_dir === undefined || d.migrations_dir === "migrations", "las migraciones viven en migrations/");
  // Hasta M0 no hay base remota: o se omite (wrangler 4 lo acepta) o es un id real con forma de UUID que pega Luis.
  assert.ok(d.database_id === undefined || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d.database_id), "database_id: omitido o UUID real");
  assert.deepEqual(c.r2_buckets, [{ binding: "ARCHIVOS", bucket_name: "docs-hardware" }]);
});

test("deploy-cloudflare.yml aplica las migraciones remotas antes del deploy, con la misma condición", () => {
  const w = leer(".github/workflows/deploy-cloudflare.yml");
  const iMig = w.search(/command:\s*d1 migrations apply docs-site --remote\s*$/m);
  const iDep = w.search(/command:\s*deploy\s*$/m);
  assert.ok(iMig >= 0, "falta el paso `d1 migrations apply docs-site --remote`");
  assert.ok(iDep > iMig, "las migraciones van antes del deploy");
  const paso = w.slice(w.lastIndexOf("- name:", iMig), iMig);
  assert.match(paso, /if:\s*steps\.cf\.outputs\.listo\s*==\s*'true'/, "solo con los secrets de Cloudflare");
  assert.match(paso, /uses:\s*cloudflare\/wrangler-action@[0-9a-f]{40}/, "misma acción fijada por SHA");
});

test("README (## Cloudflare): D1, migraciones locales, cómo rellenar database_id y binding DB, sin Upstash", () => {
  const md = leer("README.md");
  const i = md.indexOf("## Cloudflare");
  const fin = md.indexOf("\n## ", i + 1);
  const sec = md.slice(i, fin === -1 ? undefined : fin);
  assert.match(sec, /D1/);
  assert.match(sec, /wrangler d1 migrations apply docs-site --local/);
  assert.match(sec, /wrangler d1 create docs-site/);
  assert.match(sec, /database_id/);
  assert.match(sec, /`DB`/, "documenta el binding DB (D1)");
  assert.doesNotMatch(sec, /migrar-upstash-d1/, "la copia desde Upstash ya no se documenta");
  assert.doesNotMatch(sec, /KV_REST_API_URL|upstash/i, "Upstash ya no se documenta");
});

// ---------- API del adaptador ----------

test("clienteD1: sin binding devuelve null; con binding expone exec", async () => {
  const { clienteD1 } = await cargar();
  assert.equal(clienteD1(undefined), null);
  assert.equal(clienteD1(null), null);
  const db = crearD1();
  const c = clienteD1(db);
  assert.equal(typeof c.exec, "function");
  assert.deepEqual(await c.exec([]), []);
});

test("lib/almacen-d1.mjs no importa node:* ni paquetes (corre en workerd)", () => {
  const src = leer("lib/almacen-d1.mjs");
  for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) assert.match(m[1], /^\.\.?\//, `import no relativo: ${m[1]}`);
  assert.doesNotMatch(src, /\bimport\(\s*["'](?!\.)/, "sin import() dinámico de paquetes");
  assert.doesNotMatch(src, /process\.env/);
});

// ---------- Paridad con el Redis en memoria ----------

test("paridad: strings, SET NX/EX, GET, EXISTS, DEL entre tipos", async () => {
  await compararSecuencia([
    [["GET", "a"], ["EXISTS", "a"], ["SET", "a", "1"], ["GET", "a"], ["SET", "a", 2], ["GET", "a"]],
    [["SET", "a", "x", "NX", "EX", 10], ["SET", "b", "y", "NX", "EX", 10], ["GET", "b"], ["TTL", "b"], ["TTL", "a"], ["TTL", "nada"]],
    [["HSET", "h", "f", "v"], ["SADD", "s", "m"], ["LPUSH", "l", "e"], ["EXISTS", "a", "h", "s", "l", "nada", "a"]],
    [["DEL", "a", "h", "s", "l", "nada"], ["EXISTS", "a", "h", "s", "l"], ["GET", "a"], ["HGETALL", "h"], ["SMEMBERS", "s"], ["LRANGE", "l", 0, -1]],
    [["SET", "c", "con 'comillas' y\nsalto y emoji 🚀 y ; -- fin"], ["GET", "c"]],
  ]);
});

test("paridad: hashes (HSET cuenta campos nuevos, orden de inserción, HDEL vacía la clave)", async () => {
  await compararSecuencia([
    [["HSET", "h", "titulo", "T", "md", "# x", "version", 1], ["HSET", "h", "version", 2, "autor", "ana"], ["HGETALL", "h"]],
    [["HGET", "h", "version"], ["HGET", "h", "nada"], ["HGET", "nada", "f"], ["HEXISTS", "h", "md"], ["HEXISTS", "h", "zz"], ["HLEN", "h"], ["HLEN", "nada"]],
    [["HDEL", "h", "md", "zz"], ["HLEN", "h"], ["HGETALL", "h"]],
    [["HDEL", "h", "titulo", "version", "autor"], ["EXISTS", "h"], ["HGETALL", "h"], ["HLEN", "h"]],
    [["HSET", "h2", "b", "1"], ["HSET", "h2", "a", "2"], ["HSET", "h2", "b", "3"], ["HGETALL", "h2"]],
  ]);
});

test("paridad: conjuntos (SADD/SREM cuentan, SISMEMBER, SREM vacía la clave)", async () => {
  await compararSecuencia([
    [["SADD", "s", "/uuv/a/"], ["SADD", "s", "/uuv/a/"], ["SADD", "s", "/uuv/b/", "/uuv/c/"], ["SMEMBERS", "s"]],
    [["SISMEMBER", "s", "/uuv/b/"], ["SISMEMBER", "s", "x"], ["SISMEMBER", "nada", "x"], ["SMEMBERS", "nada"]],
    [["SREM", "s", "/uuv/a/", "x"], ["SMEMBERS", "s"], ["SREM", "s", "/uuv/b/", "/uuv/c/"], ["EXISTS", "s"], ["SMEMBERS", "s"]],
  ]);
});

test("paridad: listas (LPUSH al frente, LRANGE/LINDEX con negativos, LTRIM, LLEN)", async () => {
  const pasos = [[["LPUSH", "l", "r1"], ["LPUSH", "l", "r2"], ["LPUSH", "l", "r3", "r4"], ["LRANGE", "l", 0, -1], ["LLEN", "l"]]];
  pasos.push([["LRANGE", "l", 1, 2], ["LRANGE", "l", 0, 0], ["LRANGE", "l", 5, 9], ["LRANGE", "l", -2, -1], ["LRANGE", "nada", 0, 4]]);
  pasos.push([["LINDEX", "l", 0], ["LINDEX", "l", 3], ["LINDEX", "l", -1], ["LINDEX", "l", 9], ["LINDEX", "nada", 0]]);
  const muchos = Array.from({ length: 55 }, (_, i) => ["LPUSH", "r", `rev-${i}`]);
  pasos.push([...muchos, ["LTRIM", "r", 0, 49], ["LLEN", "r"], ["LINDEX", "r", 0], ["LINDEX", "r", 49], ["LRANGE", "r", 45, 60]]);
  pasos.push([["LTRIM", "l", 5, 9], ["EXISTS", "l"], ["LLEN", "l"], ["LTRIM", "nada", 0, 1]]);
  await compararSecuencia(pasos);
});

test("paridad: límite de tasa INCR + EXPIRE NX + TTL y su caducidad", async () => {
  const k = "hw:rl:edi";
  const ventana = [["INCR", k], ["EXPIRE", k, 60, "NX"], ["TTL", k]];
  await compararSecuencia([ventana, ventana, 20_000, ventana, [["EXPIRE", "nada", 60, "NX"], ["TTL", k]], 41_000, ventana, [["GET", k]], 30_000, ventana]);
});

test("paridad: caducidad (SET EX) — la clave caducada no existe para ningún comando y SET NX la reocupa", async () => {
  await compararSecuencia([
    [["SET", "lock", "yo", "NX", "EX", 10], ["TTL", "lock"], ["SET", "lock", "otro", "NX", "EX", 10], ["GET", "lock"]],
    9_000,
    [["GET", "lock"], ["TTL", "lock"], ["EXISTS", "lock"]],
    2_000,
    [["GET", "lock"], ["TTL", "lock"], ["EXISTS", "lock"], ["DEL", "lock"]],
    [["SET", "lock", "otro", "NX", "EX", 10], ["GET", "lock"], ["SET", "lock", "sin-ex"], ["TTL", "lock"]],
    [["INCR", "n"], ["EXPIRE", "n", 5]],
    6_000,
    [["INCR", "n"], ["TTL", "n"]],
  ]);
});

test("tipos: los valores vuelven como texto (como Upstash) y los contadores como número", async () => {
  const { almacen } = await d1();
  const [, , , g, hg, inc, hl, ll] = await almacen.exec([
    ["SET", "v", 5],
    ["HSET", "h", "version", 7],
    ["LPUSH", "l", 3],
    ["GET", "v"],
    ["HGET", "h", "version"],
    ["INCR", "c"],
    ["HLEN", "h"],
    ["LLEN", "l"],
  ]);
  assert.equal(g, "5");
  assert.equal(hg, "7");
  assert.equal(inc, 1);
  assert.equal(hl, 1);
  assert.equal(ll, 1);
});

test("valores grandes (página de 200 KB + revisiones) se guardan y leen enteros", async () => {
  const { almacen } = await d1();
  const md = "# Grande\n" + "línea con acentos y ✓\n".repeat(9000);
  await almacen.exec([["HSET", "hw:pag:uuv:electronica:pcb", "md", md, "version", 1]]);
  const [leido] = await almacen.exec([["HGET", "hw:pag:uuv:electronica:pcb", "md"]]);
  assert.equal(leido, md);
});

// ---------- EVAL ----------

test("guardia: los scripts reconocidos son exactamente los de los cores", () => {
  assert.ok(leer("lib/hardware-core.mjs").includes(`const LIBERAR = "${LIBERAR}"`), "LIBERAR cambió en hardware-core: actualiza el adaptador D1");
  const hw = leer("lib/hardware-core.mjs");
  for (const parte of FENCING_PARTES) assert.ok(hw.includes(JSON.stringify(parte)), "FENCING cambió en hardware-core: actualiza el adaptador D1");
  assert.ok(leer("lib/archivos-core.mjs").includes(INSERTAR), "INSERTAR_SI_NO_BORRADO cambió en archivos-core");
});

test("EVAL LIBERAR (compare-and-del): solo borra si el valor coincide", async () => {
  await compararSecuencia([
    [["SET", "lk", "dueno", "NX", "EX", 10], ["EVAL", LIBERAR, 1, "lk", "otro"], ["GET", "lk"]],
    [["EVAL", LIBERAR, 1, "lk", "dueno"], ["GET", "lk"], ["EVAL", LIBERAR, 1, "lk", "dueno"]],
    [["SET", "lk", "dueno", "NX", "EX", 10]],
    11_000,
    [["EVAL", LIBERAR, 1, "lk", "dueno"], ["SET", "lk", "nuevo", "NX", "EX", 10], ["GET", "lk"]],
  ]);
});

test("EVAL INSERTAR_SI_NO_BORRADO: inserta una vez, nunca pisa y respeta la lápida", async () => {
  await compararSecuencia([
    [["EVAL", INSERTAR, 2, "hw:arch:uuv", "hw:arch:borrados:uuv", "id1", '{"n":1}'], ["EVAL", INSERTAR, 2, "hw:arch:uuv", "hw:arch:borrados:uuv", "id1", '{"n":2}'], ["HGET", "hw:arch:uuv", "id1"]],
    [["SADD", "hw:arch:borrados:uuv", "id2"], ["EVAL", INSERTAR, 2, "hw:arch:uuv", "hw:arch:borrados:uuv", "id2", '{"n":3}'], ["HEXISTS", "hw:arch:uuv", "id2"]],
    [["SADD", "hw:arch:borrados:uuv", "id1"], ["HDEL", "hw:arch:uuv", "id1"], ["EVAL", INSERTAR, 2, "hw:arch:uuv", "hw:arch:borrados:uuv", "id1", '{"n":4}'], ["HGETALL", "hw:arch:uuv"]],
  ]);
});

test("EVAL FENCING: con todos los candados aplica los comandos (incluidos números) y devuelve APLICADO", async () => {
  const cmds = [
    ["LPUSH", "hw:rev:p", '{"version":1}'],
    ["LTRIM", "hw:rev:p", 0, 49],
    ["HSET", "hw:pag:p", "titulo", "T", "md", "# T\n", "version", 2],
    ["SET", "hw:idx", '[{"slug":"p"}]'],
    ["SET", "hw:version:p", 3],
    ["DEL", "hw:viejo"],
  ];
  await compararSecuencia([
    [["SET", "hw:viejo", "x"], ["SET", "lk:i", "a", "NX", "EX", 10], ["SET", "lk:p", "b", "NX", "EX", 10]],
    [fencing([["lk:i", "a"], ["lk:p", "b"]], cmds)],
    [["LRANGE", "hw:rev:p", 0, -1], ["HGETALL", "hw:pag:p"], ["GET", "hw:idx"], ["GET", "hw:version:p"], ["EXISTS", "hw:viejo"]],
  ]);
});

test("EVAL FENCING: candado ajeno o caducado → FENCED y no se aplica nada", async () => {
  const cmds = [["HSET", "hw:pag:p", "md", "nuevo"], ["SET", "hw:idx", "nuevo"]];
  const p = await compararSecuencia([
    [["HSET", "hw:pag:p", "md", "viejo"], ["SET", "lk:i", "a", "NX", "EX", 10], ["SET", "lk:p", "de-otro", "NX", "EX", 10]],
    [fencing([["lk:i", "a"], ["lk:p", "b"]], cmds)],
    [["HGET", "hw:pag:p", "md"], ["GET", "hw:idx"]],
    11_000,
    [fencing([["lk:i", "a"]], cmds)],
    [["HGET", "hw:pag:p", "md"], ["GET", "hw:idx"]],
  ]);
  assert.equal((await p.d1.exec([["HGET", "hw:pag:p", "md"]]))[0], "viejo");
});

test("EVAL: script desconocido o alterado, o comando no permitido dentro del fencing → error y nada aplicado", async () => {
  const casos = [
    ["EVAL", "return redis.call('flushall')", 0],
    ["EVAL", LIBERAR + " ", 1, "lk", "a"],
    ["EVAL", INSERTAR.replace("hsetnx", "hset"), 2, "h", "b", "id", "{}"],
    fencing([["lk", "a"]], [["FLUSHALL"]]),
    fencing([["lk", "a"]], [["EVAL", LIBERAR, 1, "lk", "a"]]),
    fencing([["lk", "a"]], [["HSET", "h", "f", "v"], ["CONFIG", "SET", "x", "y"]]),
  ];
  for (const caso of casos) {
    const { almacen } = await d1();
    await almacen.exec([["SET", "lk", "a", "NX", "EX", 10]]);
    const err = await almacen.exec([["SET", "antes", "1"], caso]).then(() => null, (e) => e);
    assert.ok(err instanceof Error, `debe fallar: ${String(caso[1]).slice(0, 50)}`);
    const [antes, h] = await almacen.exec([["GET", "antes"], ["HGETALL", "h"]]);
    assert.equal(antes, null, "el exec entero se deshace");
    assert.deepEqual(h, []);
  }
});

// ---------- Batch, atomicidad, errores y límites de D1 ----------

test("cada exec es un único db.batch y nunca hay sentencias sueltas fuera de batch", async () => {
  const { db, almacen } = await d1();
  const antes = db.stats.batch;
  await almacen.exec([["INCR", "k"], ["EXPIRE", "k", 60, "NX"], ["TTL", "k"]]);
  assert.equal(db.stats.batch - antes, 1);
  await almacen.exec([["HSET", "h", "a", "1"], ["SADD", "s", "x"], ["HGETALL", "h"], ["SMEMBERS", "s"], ["LPUSH", "l", "x"], ["LRANGE", "l", 0, -1]]);
  assert.equal(db.stats.batch - antes, 2);
  await almacen.exec([["SET", "lk", "a", "NX", "EX", 10]]);
  await almacen.exec([fencing([["lk", "a"]], [["SET", "x", "1"]])]);
  await almacen.exec([["EVAL", LIBERAR, 1, "lk", "a"]]);
  assert.equal(db.stats.batch - antes, 5);
  assert.equal(db.stats.sueltas, 0, "todas las sentencias van dentro de un batch");
});

test("un comando desconocido deshace todo el exec (transaccional)", async () => {
  const { almacen } = await d1();
  const err = await almacen.exec([["SET", "a", "1"], ["HSET", "h", "f", "v"], ["FLUSHALL"]]).then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.deepEqual(await almacen.exec([["GET", "a"], ["HGETALL", "h"]]), [null, []]);
});

test("errores de D1 salen con mensaje fijo, sin SQL ni detalle del motor", async () => {
  const { clienteD1 } = await cargar();
  const roto = {
    prepare() {
      return { bind() { return this; }, async all() { throw new Error("D1_ERROR: SQLITE_BUSY detalle-secreto SELECT * FROM kv"); }, async run() { throw new Error("detalle-secreto"); }, async first() { throw new Error("detalle-secreto"); } };
    },
    async batch() {
      throw new Error("D1_ERROR: detalle-secreto INSERT INTO hash");
    },
  };
  const err = await clienteD1(roto).exec([["GET", "k"]]).then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.doesNotMatch(err.message, /detalle-secreto|SELECT|INSERT|SQLITE/i);
});

test("límite de consultas de D1 Free: 100 lecturas HGETALL en un exec no generan 100 sentencias", async () => {
  const { db, almacen } = await d1();
  const cmds = [];
  for (let i = 0; i < 100; i++) cmds.push(["HSET", `com:/uuv/p${i}/`, `id${i}`, `{"i":${i}}`]);
  await almacen.exec(cmds.slice(0, 50));
  await almacen.exec(cmds.slice(50));
  const antes = db.stats.sentenciasEnBatch;
  const r = await almacen.exec(cmds.map((c) => ["HGETALL", c[1]]));
  assert.equal(r.length, 100);
  assert.deepEqual(r[37], ["id37", '{"i":37}']);
  assert.ok(db.stats.sentenciasEnBatch - antes <= 10, `lecturas agrupadas: ${db.stats.sentenciasEnBatch - antes} sentencias`);
});

test("concurrencia: dos SET NX simultáneos sobre el mismo candado → exactamente un OK", async () => {
  const { almacen } = await d1();
  const rs = await Promise.all([almacen.exec([["SET", "lk", "a", "NX", "EX", 10]]), almacen.exec([["SET", "lk", "b", "NX", "EX", 10]])]);
  assert.deepEqual(rs.map(([r]) => r).sort(), ["OK", null].sort());
});

test("sin reloj inyectado usa la hora real (TTL en segundos dentro de la ventana)", async () => {
  const { clienteD1 } = await cargar();
  const almacen = clienteD1(crearD1());
  const [, ttl] = await almacen.exec([["SET", "k", "v", "EX", 10], ["TTL", "k"]]);
  assert.ok(ttl > 0 && ttl <= 10, `TTL ${ttl}`);
});

test("archivos del lote: lib/almacen-d1.mjs y migraciones existen", () => {
  assert.ok(existe("lib/almacen-d1.mjs"));
  assert.ok(existe("migrations"));
});
