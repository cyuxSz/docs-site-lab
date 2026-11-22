// Lote A de «tokens de dispositivo», vuelta de arreglos: el límite de tasa de la ruta pública POST /auth/app/canje
// no debe dejar que un cliente anónimo gaste escrituras ni almacenamiento de D1. Ver .factory/spec.md, criterio 10.
//   10a  lo que falla la validación barata se rechaza sin tocar D1 (y no cuenta para el límite)
//   10b  el cubo del límite es la IPv4 completa, el /64 de una IPv6 o un cubo común si la IP falta o no se entiende
//   10c  superado el límite, las peticiones siguientes de la ventana no escriben
//   10d  las claves canje:rl:* caducadas se purgan de forma oportunista y acotada, por el índice claves_exp
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { T0, crearEnv, pkce, pedir, canje, nuevoCodigo, dispositivos, volcado } from "./fixtures/tokens-app.mjs";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";
import { clienteD1 } from "../lib/almacen-d1.mjs";
import { limitar, HttpError } from "../lib/api-comun.mjs";

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

const ERROR_CODIGO = { error: "Código inválido o caducado" };
const VENTANA_MS = 60_000;

// Petición bien formada con un código que no existe: pasa la validación barata, cuenta para el límite y responde 400.
const bienFormado = () => ({ code: pkce().verifier, verifier: pkce().verifier });

// Las filas del límite del canje viven en la tabla `claves` del almacén: k = canje:rl:<cubo>, v = contador, exp en ms.
const filasLimite = (env) => env.DB.sqlite.prepare("SELECT k, v, exp FROM claves WHERE k LIKE 'canje:rl:%' ORDER BY k").all();
const caducadas = (env, ahora) => filasLimite(env).filter((f) => f.exp !== null && Number(f.exp) <= ahora).length;
// Filas modificadas en la base desde que se abrió (INSERT, UPDATE y DELETE que de verdad cambian algo).
const cambios = (env) => Number(env.DB.sqlite.prepare("SELECT total_changes() AS n").get().n);
const meter = (env, k, exp, v = "3") => env.DB.sqlite.prepare("INSERT INTO claves (k, tipo, v, exp) VALUES (?, 'string', ?, ?)").run(k, v, exp);

// Cuenta todo lo que llega al binding: sentencias ejecutadas (sueltas o en batch), batches y exec.
function espiar(env) {
  let nExec = 0;
  const exec = env.DB.exec.bind(env.DB);
  env.DB.exec = async (...a) => {
    nExec++;
    return exec(...a);
  };
  return () => env.DB.stats.sql.length + env.DB.stats.batch + nExec;
}

// ---------- 10a: validación barata antes de D1 ----------

test("canje: lo que falla la validación barata se rechaza sin tocar D1 (ni lectura ni escritura) y no cuenta para el límite", async () => {
  const { env } = crearEnv();
  const ip = "203.0.113.50";
  const { code, verifier } = await nuevoCodigo(env);
  const toques = espiar(env);
  const casos = [
    // [qué, cuerpo, opciones de canje(), estado esperado, ¿error del código?]
    ["sin Content-Type", { code, verifier }, { ct: null }, 415],
    ["text/plain", { code, verifier }, { ct: "text/plain" }, 415],
    ["formulario", `code=${code}&verifier=${verifier}`, { ct: "application/x-www-form-urlencoded" }, 415],
    ["GET", { code, verifier }, { method: "GET" }, 405],
    ["PUT", { code, verifier }, { method: "PUT" }, 405],
    ["DELETE", { code, verifier }, { method: "DELETE" }, 405],
    ["OPTIONS", { code, verifier }, { method: "OPTIONS" }, 405],
    ["cuerpo de más de 2 KB", { code, verifier, relleno: "x".repeat(3000) }, {}, 413],
    ["JSON roto", "{", {}, 400],
    ["cuerpo vacío", "", {}, 400],
    ["JSON que no es objeto (lista)", "[]", {}, 400],
    ["JSON que no es objeto (null)", "null", {}, 400],
    ["sin verifier", { code }, {}, 400, true],
    ["sin code", { verifier }, {}, 400, true],
    ["code que no es string", { code: 7, verifier }, {}, 400, true],
    ["code en lista", { code: [code], verifier }, {}, 400, true],
    ["code corto", { code: code.slice(1), verifier }, {}, 400, true],
    ["code con carácter ajeno", { code: `${code.slice(0, 42)}+`, verifier }, {}, 400, true],
    ["verifier corto", { code, verifier: verifier.slice(0, 42) }, {}, 400, true],
    ["verifier largo", { code, verifier: "a".repeat(129) }, {}, 400, true],
    ["verifier con carácter ajeno", { code, verifier: `${verifier.slice(0, 42)}/` }, {}, 400, true],
    ["nombre largo", { code, verifier, nombre: "x".repeat(61) }, {}, 400, false],
    ["nombre que no es string", { code, verifier, nombre: 5 }, {}, 400, false],
    ["plataforma desconocida", { code, verifier, plataforma: "beos" }, {}, 400, false],
    ["nombre inválido con code mal formado", { code: "corto", verifier, nombre: "" }, {}, 400],
  ];
  assert.ok(casos.length > 10, "más peticiones mal formadas que el límite de 10 por minuto");
  const antes = { toques: toques(), cambios: cambios(env), volcado: volcado(env) };
  for (const [que, cuerpo, opciones, estado, esDelCodigo] of casos) {
    const res = await canje(env, cuerpo, { ip, ...opciones });
    assert.equal(toques(), antes.toques, `${que}: se rechaza antes de tocar D1 (ni prepare().run/all/first, ni batch, ni exec)`);
    assert.equal(cambios(env), antes.cambios, `${que}: no escribe en D1`);
    assert.equal(res.status, estado, `${que}: no cuenta para el límite, así que nunca es un 429`);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/, que);
    if (estado === 405) assert.equal(res.headers.get("allow"), "POST", que);
    if (esDelCodigo === true) assert.deepEqual(await res.json(), ERROR_CODIGO, que);
    if (esDelCodigo === false) assert.notDeepEqual(await res.json(), ERROR_CODIGO, `${que}: es un error de datos, no del código`);
  }
  assert.equal(volcado(env), antes.volcado, "la base queda exactamente igual");
  assert.deepEqual(filasLimite(env), [], "ninguna petición mal formada deja una fila de límite");

  // Ninguna consumió el código ni gastó el cupo de esa IP: el canje legítimo entra a la primera.
  const ok = await canje(env, { code, verifier }, { ip });
  assert.equal(ok.status, 200, "el canje legítimo de la misma IP no está limitado");
  const filas = filasLimite(env);
  assert.equal(filas.length, 1);
  assert.equal(Number(filas[0].v), 1, "solo cuenta la petición que pasó la validación");
});

// ---------- 10b: cubo del límite ----------

test("canje: las IPv6 se agrupan por /64 (dos direcciones del mismo prefijo comparten contador); IPv4 usa la dirección completa", async () => {
  const { env } = crearEnv();
  // Diez formas y direcciones distintas del mismo 2001:db8:1:2::/64.
  const mismo64 = [
    "2001:db8:1:2::1",
    "2001:db8:1:2::2",
    "2001:0db8:0001:0002:0000:0000:0000:0003",
    "2001:DB8:1:2:FFFF:FFFF:FFFF:FFFF",
    "2001:db8:1:2:0:0:0:5",
    "2001:db8:1:2:a:b:c:d",
    "2001:db8:1:2:0::6",
    "2001:db8:1:2::",
    "2001:db8:01:02:1234::",
    "2001:db8:1:2:9999:8888:7777:6666",
  ];
  for (const ip of mismo64) {
    const res = await canje(env, bienFormado(), { ip });
    assert.equal(res.status, 400, ip);
  }
  let filas = filasLimite(env);
  assert.equal(filas.length, 1, `un solo contador para todo el /64, no uno por dirección: ${JSON.stringify(filas.map((f) => f.k))}`);
  assert.equal(Number(filas[0].v), 10);

  const { code, verifier } = await nuevoCodigo(env);
  const limitado = await canje(env, { code, verifier }, { ip: "2001:db8:1:2:dead:beef:0:1" });
  assert.equal(limitado.status, 429, "la undécima petición del /64, desde una dirección que aún no se había usado");
  assert.ok(Number(limitado.headers.get("retry-after")) > 0);
  assert.ok(!volcado(env).toLowerCase().includes("dead:beef"), "la parte de interfaz de la dirección no se guarda");

  // Otros /64 tienen su propio contador. «::» se expande antes de cortar el prefijo.
  for (const ip of ["2001:db8:1:3::1", "2001:db8:1::2:1", "2001:db8:1:0:9::", "2001:db8:1:20::1"]) {
    const res = await canje(env, bienFormado(), { ip });
    assert.equal(res.status, 400, `${ip} está en otro /64`);
  }
  filas = filasLimite(env);
  // 2001:db8:1:2::/64, 2001:db8:1:3::/64, 2001:db8:1:0::/64 (dos direcciones) y 2001:db8:1:20::/64.
  assert.equal(filas.length, 4, JSON.stringify(filas.map((f) => f.k)));
  assert.deepEqual(filas.map((f) => Number(f.v)).sort((a, b) => a - b), [1, 1, 2, 10]);

  // El prefijo todo ceros también es un /64.
  for (const ip of ["::1", "::2", "0:0:0:0:1:2:3:4"]) assert.equal((await canje(env, bienFormado(), { ip })).status, 400, ip);
  assert.equal(filasLimite(env).length, 5);

  // IPv4: cada dirección es su propio cubo, también dentro de la misma /24.
  for (const ip of ["203.0.113.9", "203.0.113.10", "203.0.113.109"]) assert.equal((await canje(env, bienFormado(), { ip })).status, 400, ip);
  assert.equal(filasLimite(env).length, 8);

  // El código del /64 limitado sigue vivo.
  assert.equal((await canje(env, { code, verifier }, { ip: "192.0.2.44" })).status, 200);
});

test("canje: una IP ausente o ilegible cae en un único cubo común y la cabecera nunca se guarda tal cual", async () => {
  const { env } = crearEnv();
  const largo = "f".repeat(300);
  const ilegibles = [
    undefined, // sin cabecera
    "",
    "no-es-una-ip",
    "1.2.3",
    "256.1.1.1",
    "1.2.3.4.5",
    "2001:db8::1::2",
    "12345::1",
    "2001:db8:1:2:3:4:5:6:7",
    "g::1",
    largo,
    "203.0.113.7, 198.51.100.1",
  ];
  const pedirCon = (ip, cuerpo) =>
    pedir("/auth/app/canje", {
      env,
      method: "POST",
      headers: { "content-type": "application/json", ...(ip === undefined ? {} : { "cf-connecting-ip": ip }), "x-forwarded-for": "192.0.2.77" },
      body: JSON.stringify(cuerpo),
    });
  for (const ip of ilegibles.slice(0, 10)) {
    const res = await pedirCon(ip, bienFormado());
    assert.equal(res.status, 400, `IP ${JSON.stringify(ip)}`);
  }
  const filas = filasLimite(env);
  assert.equal(filas.length, 1, `todas comparten un cubo: ${JSON.stringify(filas.map((f) => f.k.slice(0, 60)))}`);
  assert.equal(Number(filas[0].v), 10);
  for (const ip of ilegibles.slice(10)) {
    const res = await pedirCon(ip, bienFormado());
    assert.equal(res.status, 429, `el cubo común ya está lleno: ${JSON.stringify(ip).slice(0, 40)}`);
  }
  const todo = volcado(env);
  for (const texto of ["no-es-una-ip", largo, "198.51.100.1", "192.0.2.77"]) assert.ok(!todo.includes(texto), `el valor de la cabecera no llega a D1: ${texto.slice(0, 30)}`);
  // Una IP legible no comparte ese cubo.
  assert.equal((await canje(env, bienFormado(), { ip: "203.0.113.200" })).status, 400);
});

// ---------- 10c: superado el límite, no se escribe ----------

test("canje: superado el límite, las peticiones siguientes de la ventana no escriben en D1 ni alargan la ventana", async () => {
  const { env } = crearEnv();
  const ip = "203.0.113.60";
  for (let i = 0; i < 10; i++) assert.equal((await canje(env, bienFormado(), { ip })).status, 400, `intento ${i + 1}`);
  // Una clave caducada de otro cubo: rechazar por límite tampoco debe purgar (es una escritura).
  meter(env, "canje:rl:192.0.2.1", T0 - 1);
  const { code, verifier } = await nuevoCodigo(env);
  const antes = { cambios: cambios(env), volcado: volcado(env) };

  for (let i = 0; i < 25; i++) {
    const res = await canje(env, i % 2 ? bienFormado() : { code, verifier }, { ip });
    assert.equal(res.status, 429, `petición ${i + 11}`);
    const espera = Number(res.headers.get("retry-after"));
    assert.ok(espera >= 1 && espera <= 60, `Retry-After dentro de la ventana: ${espera}`);
    assert.equal(cambios(env), antes.cambios, `petición ${i + 11}: ya limitada, no modifica ninguna fila de D1 (como mucho lee)`);
  }
  assert.equal(volcado(env), antes.volcado, "contador, caducidad y resto de la base intactos");

  // La ventana es fija desde la primera petición contada: los 429 no la mueven.
  mock.timers.setTime(T0 + 30_000);
  const medio = await canje(env, bienFormado(), { ip });
  assert.equal(medio.status, 429);
  const espera = Number(medio.headers.get("retry-after"));
  assert.ok(espera >= 1 && espera <= 30, `a los 30 s quedan como mucho 30 s: ${espera}`);
  assert.equal(cambios(env), antes.cambios);

  // Pasada la ventana el contador vuelve a empezar (10 más y de nuevo 429) y el código nunca se consumió.
  mock.timers.setTime(T0 + VENTANA_MS + 1000);
  for (let i = 0; i < 10; i++) assert.equal((await canje(env, bienFormado(), { ip })).status, 400, `ventana nueva, intento ${i + 1}`);
  assert.equal((await canje(env, bienFormado(), { ip })).status, 429);
  const fila = filasLimite(env).find((f) => Number(f.v) === 10);
  assert.ok(fila, "la fila del cubo se reutiliza con el contador reiniciado");
  assert.equal(Number(fila.exp), T0 + VENTANA_MS + 1000 + VENTANA_MS, "y con la caducidad de la ventana nueva");
  assert.equal((await canje(env, { code: (await nuevoCodigo(env)).code, verifier: pkce().verifier }, { ip: "203.0.113.61" })).status, 400);
});

test("canje: el contador sigue siendo atómico (15 peticiones simultáneas de una IP → exactamente 10 pasan)", async () => {
  const { env } = crearEnv();
  const ip = "203.0.113.70";
  const res = await Promise.all(Array.from({ length: 15 }, () => canje(env, bienFormado(), { ip })));
  const estados = res.map((r) => r.status).sort();
  assert.deepEqual(estados, [...Array(10).fill(400), ...Array(5).fill(429)]);
});

test("canje: si D1 falla en el límite, 503 sin canjear (falla cerrado)", async () => {
  const { env } = crearEnv();
  const { code, verifier } = await nuevoCodigo(env);
  const { prepare, batch } = env.DB;
  env.DB.prepare = (sql) => {
    if (/\bclaves\b/i.test(sql)) throw new Error("D1 caído: detalle interno");
    return prepare.call(env.DB, sql);
  };
  env.DB.batch = async () => {
    throw new Error("D1 caído: detalle interno");
  };
  const res = await canje(env, { code, verifier }, { ip: "203.0.113.80" });
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("detalle interno"));
  assert.deepEqual(await dispositivos(env, "ana"), [], "sin límite no hay canje");
  env.DB.prepare = prepare;
  env.DB.batch = batch;
  assert.equal((await canje(env, { code, verifier }, { ip: "203.0.113.80" })).status, 200, "el código no se consumió");
});

// ---------- 10d: purga oportunista y acotada ----------

test("canje: las claves canje:rl:* caducadas se purgan de forma oportunista y acotada, usando el índice claves_exp", async () => {
  const { env } = crearEnv();
  // Tres cubos reales y 120 más como los dejaría un barrido de direcciones (misma forma de fila que escribe el canje).
  for (const ip of ["198.18.0.1", "198.18.0.2", "2001:db8:aa:bb::1"]) assert.equal((await canje(env, bienFormado(), { ip })).status, 400);
  const reales = filasLimite(env);
  assert.equal(reales.length, 3);
  for (const f of reales) assert.equal(Number(f.exp), T0 + VENTANA_MS, "la clave caduca al cerrar su ventana");
  for (let i = 0; i < 120; i++) meter(env, `canje:rl:198.19.${i >> 4}.${i & 15}`, T0 + VENTANA_MS, "1");
  // Lo que la purga no debe tocar: claves caducadas de otros prefijos y claves del canje aún vivas.
  meter(env, "com:rl:ana", T0 + VENTANA_MS);
  meter(env, "hw:rl:ana", T0 + VENTANA_MS);
  meter(env, "canje:rl:192.0.2.200", T0 + 3_600_000, "4");

  const ahora = T0 + VENTANA_MS + 1000;
  mock.timers.setTime(ahora);
  assert.equal(caducadas(env, ahora), 123);
  env.DB.stats.sql.length = 0;

  // Una sola petición contada purga algo, pero no todo de golpe (acotada: entre 1 y 50 claves).
  assert.equal((await canje(env, bienFormado(), { ip: "198.20.0.0" })).status, 400);
  const tras1 = caducadas(env, ahora);
  assert.ok(tras1 < 123, `la petición purga claves caducadas del canje (quedan ${tras1} de 123)`);
  assert.ok(tras1 >= 123 - 50, `la purga está acotada a 50 claves por petición (borró ${123 - tras1})`);

  // Con el tráfico normal las caducadas desaparecen: no se acumulan sin fin.
  for (let i = 1; i <= 123 && caducadas(env, ahora) > 0; i++) {
    assert.equal((await canje(env, bienFormado(), { ip: `198.20.${i >> 8}.${i & 255}` })).status, 400);
  }
  assert.equal(caducadas(env, ahora), 0, "tras como mucho una petición por clave caducada no queda ninguna");

  const claves = new Set(env.DB.sqlite.prepare("SELECT k FROM claves").all().map((f) => f.k));
  assert.ok(claves.has("com:rl:ana") && claves.has("hw:rl:ana"), "las claves de otros prefijos no se tocan, aunque estén caducadas");
  assert.ok(claves.has("canje:rl:192.0.2.200"), "una clave del canje todavía viva no se purga");
  assert.equal(Number(filasLimite(env).find((f) => f.k === "canje:rl:192.0.2.200").v), 4);

  // Plan de consulta de lo que el canje ejecutó: la purga entra por claves_exp y nada recorre la tabla entera.
  const sentencias = [...new Set(env.DB.stats.sql)];
  const plan = (sql) => env.DB.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((f) => f.detail);
  const borrados = sentencias.filter((s) => /^\s*DELETE\s+FROM\s+claves\b/i.test(s));
  assert.ok(borrados.some((s) => plan(s).some((d) => /USING (COVERING )?INDEX claves_exp\b/.test(d))), `la purga usa el índice claves_exp: ${JSON.stringify(borrados.map((s) => [s, plan(s)]))}`);
  for (const s of sentencias) {
    for (const d of plan(s)) assert.ok(!/\bSCAN claves\b(?! USING)/.test(d), `sin recorrido completo de claves: ${s} → ${d}`);
  }
});

// ---------- Sin cambios para los límites por login ----------

test("limitar (com, hw): mismo comportamiento de siempre, sin purga ni cubos del canje", async () => {
  const db = crearD1();
  const env = { DB: db };
  meter(env, "canje:rl:192.0.2.1", T0 - 1);
  meter(env, "com:rl:otro", T0 - 1);
  const almacen = clienteD1(db);
  for (const prefijo of ["com", "hw"]) {
    for (let i = 0; i < 10; i++) await limitar(almacen, prefijo, "Ana");
    for (let i = 0; i < 2; i++) {
      await assert.rejects(
        () => limitar(almacen, prefijo, "Ana"),
        (e) => e instanceof HttpError && e.status === 429 && Number(e.headers["retry-after"]) === 60,
      );
    }
    const fila = db.sqlite.prepare("SELECT v, exp FROM claves WHERE k = ?").get(`${prefijo}:rl:ana`);
    assert.equal(Number(fila.v), 12, "la clave es <prefijo>:rl:<login en minúsculas> y cuenta todas las llamadas");
    assert.equal(Number(fila.exp), T0 + VENTANA_MS);
  }
  const claves = db.sqlite.prepare("SELECT k FROM claves ORDER BY k").all().map((f) => f.k);
  assert.deepEqual(claves, ["canje:rl:192.0.2.1", "com:rl:ana", "com:rl:otro", "hw:rl:ana"], "limitar no purga claves ajenas");
});
