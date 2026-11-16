// M2c (herramienta para M4): tools/migrar-upstash-d1.mjs copia los datos de Upstash a D1 generando SQL para
// `wrangler d1 execute docs-site --remote --file=…`. Se prueba con el Redis en memoria como origen y el D1 de prueba
// como destino (ida y vuelta: lo que se lee por clienteD1 es lo que había en Redis).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeRedis } from "./fixtures/redis-memoria.mjs";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";
import { clienteRedis } from "../lib/api-comun.mjs";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const herramienta = () => import("../tools/migrar-upstash-d1.mjs");
const T0 = Date.parse("2026-11-16T10:00:00Z");
const GRANDE = "# Página grande\n" + "texto con 'comillas', ; -- y ✓ 🚀\n".repeat(8000); // ~300 KB

async function sembrar(redis) {
  const com = { id: "c1", padre: null, autor: "ana", tipo: "duda", texto: "¿'hola'?\n-- no es comentario SQL; DROP TABLE x;", creado: "2026-11-01T00:00:00.000Z" };
  await redis.exec([
    ["HSET", "com:/uuv/arquitectura/", "c1", JSON.stringify(com), "c2", JSON.stringify({ ...com, id: "c2", texto: "🚀 segunda" })],
    ["SADD", "com:idx:uuv", "/uuv/arquitectura/", "/uuv/potencia/"],
    ["SET", "hw:uuv:electronica:indice", JSON.stringify([{ slug: "pcb", titulo: "PCB" }])],
    ["HSET", "hw:pag:uuv:electronica:pcb", "titulo", "PCB", "md", GRANDE, "autor", "edi", "actualizado", "2026-11-02T00:00:00.000Z", "version", 3],
    ["LPUSH", "hw:rev:uuv:electronica:pcb", JSON.stringify({ version: 1, md: "uno" }), JSON.stringify({ version: 2, md: "dos" })],
    ["SET", "hw:version:uuv:electronica:vieja", 7],
    ["HSET", "hw:papelera:uuv:electronica", "vieja:1", JSON.stringify({ version: 7, revisiones: [] })],
    ["HSET", "hw:arch:uuv", "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90", JSON.stringify({ nombre: "placa.png", blobUrl: "hw/uuv/electronica/x-placa.png" })],
    ["SADD", "hw:arch:borrados:uuv", "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c"],
    ["SET", "hw:temporal", "caduca", "EX", 3600],
    // Efímeros: no se copian.
    ["INCR", "com:rl:ana"],
    ["EXPIRE", "com:rl:ana", 60],
    ["INCR", "hw:rl:edi"],
    ["SET", "hw:lock:uuv:electronica:pcb", "dueno", "NX", "EX", 10],
    // Fuera de los prefijos del portal: no se toca.
    ["SET", "otra-app:clave", "x"],
  ]);
}

const COPIADAS = [
  "com:/uuv/arquitectura/",
  "com:idx:uuv",
  "hw:uuv:electronica:indice",
  "hw:pag:uuv:electronica:pcb",
  "hw:rev:uuv:electronica:pcb",
  "hw:version:uuv:electronica:vieja",
  "hw:papelera:uuv:electronica",
  "hw:arch:uuv",
  "hw:arch:borrados:uuv",
  "hw:temporal",
];
const OMITIDAS = ["com:rl:ana", "hw:rl:edi", "hw:lock:uuv:electronica:pcb", "otra-app:clave"];

async function leerComo(almacen, clave, tipo) {
  const cmd = { string: ["GET", clave], hash: ["HGETALL", clave], set: ["SMEMBERS", clave], list: ["LRANGE", clave, 0, -1] }[tipo];
  const [r] = await almacen.exec([cmd]);
  return tipo === "set" ? [...r].sort() : r;
}

async function preparar() {
  let t = T0;
  const redis = fakeRedis();
  redis.reloj.ahora = () => t;
  await sembrar(redis);
  const { generarSQL } = await herramienta();
  const salida = await generarSQL(redis, { ahora: () => t });
  return { redis, salida, reloj: () => t };
}

test("generarSQL: ida y vuelta — D1 devuelve lo mismo que Redis para cada clave del portal", async () => {
  const { redis, salida, reloj } = await preparar();
  const { clienteD1 } = await import("../lib/almacen-d1.mjs");
  const db = crearD1();
  await db.exec(salida.sql);
  const d1 = clienteD1(db, { ahora: reloj });
  for (const clave of COPIADAS) {
    const [tipo] = await redis.exec([["TYPE", clave]]);
    assert.deepEqual(await leerComo(d1, clave, tipo), await leerComo(redis, clave, tipo), clave);
  }
  const [ttl] = await d1.exec([["TTL", "hw:temporal"]]);
  assert.ok(ttl > 3500 && ttl <= 3600, `conserva la caducidad: ${ttl}`);
  for (const clave of OMITIDAS) assert.deepEqual(await d1.exec([["EXISTS", clave]]), [0], `no se copia ${clave}`);
  assert.equal(salida.resumen.claves, COPIADAS.length);
  assert.ok(salida.resumen.omitidas >= 3, "cuenta los efímeros omitidos");
});

test("generarSQL: aplicarlo dos veces deja el mismo estado (idempotente)", async () => {
  const { redis, salida, reloj } = await preparar();
  const { clienteD1 } = await import("../lib/almacen-d1.mjs");
  const db = crearD1();
  await db.exec(salida.sql);
  await db.exec(salida.sql);
  const d1 = clienteD1(db, { ahora: reloj });
  for (const clave of COPIADAS) {
    const [tipo] = await redis.exec([["TYPE", clave]]);
    assert.deepEqual(await leerComo(d1, clave, tipo), await leerComo(redis, clave, tipo), clave);
  }
});

test("generarSQL: SQL apto para `wrangler d1 execute --file` (una sentencia por línea, ≤ 100 KB, sin transacciones)", async () => {
  const { salida } = await preparar();
  const lineas = salida.sql.split("\n").filter((l) => l.trim() !== "");
  assert.ok(lineas.length > 0);
  for (const l of lineas) {
    assert.ok(Buffer.byteLength(l, "utf8") <= 100_000, `sentencia de ${Buffer.byteLength(l, "utf8")} bytes`);
    assert.match(l, /^(INSERT|DELETE|UPDATE)\s/i, l.slice(0, 80));
    assert.match(l, /;\s*$/);
  }
  assert.doesNotMatch(salida.sql, /\b(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|PRAGMA|ATTACH)\b/i);
});

test("generarSQL: lee Redis con SCAN por cursor y solo las claves com:* y hw:*", async () => {
  const redis = fakeRedis();
  await sembrar(redis);
  redis.comandos.length = 0;
  const { generarSQL } = await herramienta();
  await generarSQL(redis);
  const scans = redis.comandos.filter((c) => String(c[0]).toUpperCase() === "SCAN");
  assert.ok(scans.length >= 1, "usa SCAN");
  assert.ok(!redis.comandos.some((c) => /^(KEYS|FLUSHALL|FLUSHDB|DEL|SET|HSET|EVAL)$/i.test(String(c[0]))), "solo lee del origen");
  assert.ok(!redis.comandos.some((c) => c[1] === "otra-app:clave" && String(c[0]).toUpperCase() !== "SCAN"), "no lee claves ajenas");
});

// ---------- CLI contra el Upstash simulado ----------

function arrancarUpstash(token) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["tools/upstash-local.mjs", "--token", token, "--puerto", "0"], { cwd: raiz });
    p.stdout.setEncoding("utf8");
    p.stdout.once("data", (d) => resolve({ p, url: d.trim().split(/\s+/)[0] }));
    p.once("error", reject);
    setTimeout(() => reject(new Error("upstash-local no arrancó")), 10_000).unref();
  });
}

test("CLI: lee Upstash por variables de entorno, escribe el .sql y no imprime secretos", async () => {
  const TOKEN = "tok-secreto-9f8e7d";
  const { p, url } = await arrancarUpstash(TOKEN);
  const dir = mkdtempSync(join(tmpdir(), "migrar-d1-"));
  try {
    await sembrar(clienteRedis({ KV_REST_API_URL: url, KV_REST_API_TOKEN: TOKEN }));
    const destino = join(dir, "datos.sql");
    const r = spawnSync(process.execPath, ["tools/migrar-upstash-d1.mjs", "--salida", destino], {
      cwd: raiz,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, KV_REST_API_URL: url, KV_REST_API_TOKEN: TOKEN },
    });
    assert.equal(r.status, 0, r.stderr);
    const salida = r.stdout + r.stderr;
    assert.ok(!salida.includes(TOKEN), "no imprime el token");
    assert.match(salida, /wrangler d1 execute docs-site --remote --file/, "indica el siguiente paso");
    assert.ok(existsSync(destino));
    const db = crearD1();
    await db.exec(readFileSync(destino, "utf8"));
    const { clienteD1 } = await import("../lib/almacen-d1.mjs");
    const [md] = await clienteD1(db).exec([["HGET", "hw:pag:uuv:electronica:pcb", "md"]]);
    assert.equal(md, GRANDE);
  } finally {
    p.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: sin credenciales o sin --salida sale con error y no escribe nada", () => {
  const dir = mkdtempSync(join(tmpdir(), "migrar-d1-"));
  try {
    const destino = join(dir, "datos.sql");
    const env = { ...process.env };
    for (const k of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete env[k];
    const sinCred = spawnSync(process.execPath, ["tools/migrar-upstash-d1.mjs", "--salida", destino], { cwd: raiz, encoding: "utf8", env, timeout: 30_000 });
    assert.notEqual(sinCred.status, 0);
    assert.ok(!existsSync(destino));
    const sinSalida = spawnSync(process.execPath, ["tools/migrar-upstash-d1.mjs"], { cwd: raiz, encoding: "utf8", env: { ...env, KV_REST_API_URL: "http://127.0.0.1:9", KV_REST_API_TOKEN: "x" }, timeout: 30_000 });
    assert.notEqual(sinSalida.status, 0);
    assert.ok(!(sinSalida.stdout + sinSalida.stderr).includes("KV_REST_API_TOKEN=x"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
