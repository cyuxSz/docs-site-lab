// Lote A de «tokens de dispositivo»: almacén (migrations/0002_tokens.sql + lib/dispositivos-core.mjs) y canje
// público POST /auth/app/canje {code, verifier} → {token, expira, login}. Los códigos los creará /auth/app/autorizar
// (lote B); aquí se crean con crearCodigo(). Ver .factory/spec.md, criterios 1 a 4 y 8.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { T0, TREINTA_DIAS, RE_TOKEN, crearEnv, cargarCore, pkce, pedir, canje, nuevoCodigo, emitir, dispositivos, volcado, conConsola, sha256hex, sesion } from "./fixtures/tokens-app.mjs";

const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  // Nada de esto sale a la red.
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const ERROR_CODIGO = { error: "Código inválido o caducado" };

// ---------- Criterio 2: canje correcto ----------

test("canje: código + verifier correctos → 200 {token, expira, login}, sin cookie ni Origin", async () => {
  for (const path of ["/auth/app/canje", "/auth/app/canje/"]) {
    const { env, llamadas } = crearEnv();
    const { code, verifier } = await nuevoCodigo(env, { login: "ana" });
    const res = await canje(env, { code, verifier }, { path });
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("set-cookie"), null, "el canje no emite cookies");
    const json = await res.json();
    assert.deepEqual(Object.keys(json).sort(), ["expira", "login", "token"]);
    assert.match(json.token, RE_TOKEN, "token opaco: vtd_ + 32 bytes en base64url");
    assert.equal(json.login, "ana");
    assert.equal(typeof json.expira, "string", "expira es una fecha ISO 8601");
    assert.equal(Date.parse(json.expira), T0 + TREINTA_DIAS, "caduca a los 30 días exactos de emitirse");
    assert.equal(llamadas.length, 0, "el canje no toca ASSETS");
  }
});

test("canje: cada token es distinto y el código no vale como token", async () => {
  const { env } = crearEnv();
  const a = await emitir(env);
  const b = await emitir(env);
  assert.notEqual(a.token, b.token);
  assert.notEqual(a.token.slice(4), a.code);
  const res = await pedir("/auth/me", { env, bearer: a.code });
  assert.equal(res.status, 401);
});

test("canje: es público, pero el resto del portal sigue exigiendo sesión", async () => {
  const { env } = crearEnv();
  const sin = await pedir("/auth/app/otra-cosa", { env });
  assert.equal(sin.status, 302, "solo /auth/app/canje es público");
  const api = await pedir("/api/comentarios/?pagina=%2Fuuv%2Farquitectura%2F", { env });
  assert.equal(api.status, 401);
});

// ---------- Criterio 1: almacén ----------

test("almacén: se guarda el SHA-256 del token, nunca el token ni el código en claro", async () => {
  const { env } = crearEnv();
  const { token, code, verifier } = await emitir(env);
  const pendiente = await nuevoCodigo(env); // un código aún sin canjear
  const todo = volcado(env);
  assert.ok(!todo.includes(token), "el token en claro no está en D1");
  assert.ok(!todo.includes(token.slice(4)), "ni sin el prefijo");
  assert.ok(todo.includes(sha256hex(token)), "se guarda sha256(token) en hexadecimal");
  assert.ok(!todo.includes(code) && !todo.includes(pendiente.code), "los códigos tampoco se guardan en claro");
  assert.ok(!todo.includes(verifier) && !todo.includes(pendiente.verifier), "el verifier nunca se guarda");
});

test("almacén: registro {login, nombre, plataforma, tipo, alcance, creado, ultimoUso, expira} e índice por login", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana", nombre: "PC de Ana", plataforma: "windows" });
  mock.timers.setTime(T0 + 5000);
  await emitir(env, { login: "ana", nombre: "Teléfono", plataforma: "android" });
  await emitir(env, { login: "beto", nombre: "Mac de Beto", plataforma: "macos" });

  const deAna = await dispositivos(env, "ana");
  assert.equal(deAna.length, 2);
  const pc = deAna.find((d) => d.nombre === "PC de Ana");
  assert.deepEqual(Object.keys(pc).sort(), ["alcance", "creado", "expira", "id", "login", "nombre", "plataforma", "tipo", "ultimoUso"]);
  assert.equal(pc.login, "ana");
  assert.equal(pc.plataforma, "windows");
  assert.equal(pc.tipo, "dispositivo");
  assert.equal(pc.alcance, "completo");
  assert.equal(pc.creado, T0);
  assert.equal(pc.ultimoUso, null, "sin usar todavía");
  assert.equal(pc.expira, T0 + TREINTA_DIAS);
  assert.equal(typeof pc.id, "string");
  assert.ok(pc.id.length >= 16, "id público aleatorio");
  assert.ok(!token.includes(pc.id) && pc.id !== sha256hex(token), "el id no es el token ni su hash");
  assert.notEqual(deAna[0].id, deAna[1].id);

  assert.deepEqual((await dispositivos(env, "ANA")).map((d) => d.id).sort(), deAna.map((d) => d.id).sort(), "el índice por login no distingue mayúsculas");
  const deBeto = await dispositivos(env, "beto");
  assert.deepEqual(deBeto.map((d) => d.nombre), ["Mac de Beto"], "cada login solo ve los suyos");
  assert.deepEqual(await dispositivos(env, "nadie"), []);
});

test("almacén: un token caducado deja de listarse", async () => {
  const { env } = crearEnv();
  await emitir(env);
  mock.timers.setTime(T0 + TREINTA_DIAS + 1);
  assert.deepEqual(await dispositivos(env, "ana"), []);
});

test("crearCodigo: exige login, challenge S256 de 43 caracteres base64url, nombre ≤ 60 y plataforma de la lista", async () => {
  const { env } = crearEnv();
  const { crearCodigo } = await cargarCore();
  const { challenge } = pkce();
  const bueno = { login: "ana", challenge, nombre: "PC de Ana", plataforma: "linux" };
  const malos = [
    { ...bueno, login: "" },
    { ...bueno, login: undefined },
    { ...bueno, challenge: challenge.slice(1) },
    { ...bueno, challenge: `${challenge}A` },
    { ...bueno, challenge: `${challenge.slice(0, 42)}=` },
    { ...bueno, challenge: `${challenge.slice(0, 42)}+` },
    { ...bueno, nombre: "" },
    { ...bueno, nombre: "   " },
    { ...bueno, nombre: "x".repeat(61) },
    { ...bueno, nombre: "con\nsalto" },
    { ...bueno, nombre: 7 },
    { ...bueno, plataforma: "Windows" },
    { ...bueno, plataforma: "beos" },
    { ...bueno, plataforma: undefined },
  ];
  for (const m of malos) await assert.rejects(() => crearCodigo(env.DB, m), `debe rechazar ${JSON.stringify(m)}`);
  for (const plataforma of ["windows", "macos", "linux", "android", "ios"]) {
    const code = await crearCodigo(env.DB, { ...bueno, plataforma, nombre: "ñ".repeat(60) });
    assert.match(code, /^[A-Za-z0-9_-]{43}$/, "código opaco de 256 bits en base64url");
  }
});

// ---------- Criterio 3: un solo uso, PKCE, errores indistinguibles ----------

test("canje: código inexistente, caducado, ya usado o verifier incorrecto dan la misma respuesta 400", async () => {
  const { env } = crearEnv();
  const cuerpos = [];
  const fallo = async (res, que) => {
    assert.equal(res.status, 400, que);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/, que);
    cuerpos.push(await res.text());
  };

  await fallo(await canje(env, { code: pkce().verifier, verifier: pkce().verifier }), "inexistente");

  const mal = await nuevoCodigo(env);
  await fallo(await canje(env, { code: mal.code, verifier: pkce().verifier }), "verifier incorrecto");

  const usado = await nuevoCodigo(env);
  assert.equal((await canje(env, { code: usado.code, verifier: usado.verifier })).status, 200);
  await fallo(await canje(env, { code: usado.code, verifier: usado.verifier }), "ya usado");

  const viejo = await nuevoCodigo(env);
  mock.timers.setTime(T0 + 60_001);
  await fallo(await canje(env, { code: viejo.code, verifier: viejo.verifier }), "caducado");

  assert.equal(new Set(cuerpos).size, 1, `las cuatro respuestas deben ser idénticas: ${JSON.stringify(cuerpos)}`);
  assert.deepEqual(JSON.parse(cuerpos[0]), ERROR_CODIGO);
  assert.equal((await dispositivos(env, "ana")).length, 1, "solo el canje correcto creó un token");
});

test("canje: el código vale 60 s (a los 59 s sí, a los 60 s ya no)", async () => {
  const { env } = crearEnv();
  const a = await nuevoCodigo(env);
  const b = await nuevoCodigo(env);
  mock.timers.setTime(T0 + 59_000);
  assert.equal((await canje(env, { code: a.code, verifier: a.verifier })).status, 200);
  mock.timers.setTime(T0 + 60_000);
  assert.equal((await canje(env, { code: b.code, verifier: b.verifier })).status, 400);
});

test("canje: un intento con verifier incorrecto consume el código", async () => {
  const { env } = crearEnv();
  const { code, verifier } = await nuevoCodigo(env);
  assert.equal((await canje(env, { code, verifier: pkce().verifier })).status, 400);
  const res = await canje(env, { code, verifier });
  assert.equal(res.status, 400, "el código quedó quemado: hay que volver a autorizar");
  assert.deepEqual(await res.json(), ERROR_CODIGO);
  assert.deepEqual(await dispositivos(env, "ana"), []);
});

test("canje: el challenge de otro código no sirve (el código va ligado a su challenge y a su login)", async () => {
  const { env } = crearEnv();
  const deAna = await nuevoCodigo(env, { login: "ana" });
  const deBeto = await nuevoCodigo(env, { login: "beto" });
  assert.equal((await canje(env, { code: deAna.code, verifier: deBeto.verifier })).status, 400);
  const ok = await canje(env, { code: deBeto.code, verifier: deBeto.verifier });
  assert.equal((await ok.json()).login, "beto");
});

test("canje: dos canjes simultáneos del mismo código → solo uno gana", async () => {
  for (let vuelta = 0; vuelta < 5; vuelta++) {
    const { env } = crearEnv();
    const { code, verifier } = await nuevoCodigo(env);
    const res = await Promise.all([canje(env, { code, verifier }), canje(env, { code, verifier }), canje(env, { code, verifier })]);
    assert.deepEqual(res.map((r) => r.status).sort(), [200, 400, 400], `vuelta ${vuelta}`);
    assert.equal((await dispositivos(env, "ana")).length, 1, "un solo token emitido");
  }
});

// ---------- Criterio 3: forma de la petición ----------

test("canje: solo POST (405 con Allow: POST, también OPTIONS) y solo application/json (415)", async () => {
  const { env } = crearEnv();
  const { code, verifier } = await nuevoCodigo(env);
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const res = await canje(env, { code, verifier }, { method, headers: method === "OPTIONS" ? { origin: "https://otra.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" } : {} });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST", method);
  }
  for (const ct of ["text/plain", "application/x-www-form-urlencoded", null]) {
    const res = await canje(env, { code, verifier }, { ct });
    assert.equal(res.status, 415, String(ct));
  }
  // Nada de lo anterior consumió el código.
  assert.equal((await canje(env, { code, verifier })).status, 200);
});

test("canje: cuerpo acotado (413 por encima de 2 KB) y JSON válido con code y verifier bien formados (400)", async () => {
  const { env } = crearEnv();
  const { code, verifier } = await nuevoCodigo(env);
  const grande = await canje(env, { code, verifier, relleno: "x".repeat(3000) });
  assert.equal(grande.status, 413);
  const malos = ["{", "[]", "null", JSON.stringify({ code }), JSON.stringify({ verifier }), JSON.stringify({ code: 7, verifier }), JSON.stringify({ code, verifier: verifier.slice(0, 42) }), JSON.stringify({ code, verifier: "a".repeat(129) }), JSON.stringify({ code, verifier: `${verifier.slice(0, 42)}/` }), JSON.stringify({ code: [code], verifier })];
  for (const cuerpo of malos) {
    const res = await canje(env, cuerpo);
    assert.equal(res.status, 400, cuerpo);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  }
  assert.deepEqual(await dispositivos(env, "ana"), []);
});

test("canje: nombre y plataforma opcionales se validan sin consumir el código y no sustituyen a los consentidos", async () => {
  const { env } = crearEnv();
  const { code, verifier } = await nuevoCodigo(env, { nombre: "PC de Ana", plataforma: "windows" });
  for (const extra of [{ nombre: "x".repeat(61) }, { nombre: 5 }, { nombre: "a\u0000b" }, { plataforma: "beos" }, { plataforma: ["ios"] }]) {
    const res = await canje(env, { code, verifier, ...extra });
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.notDeepEqual(await res.json(), ERROR_CODIGO, "es un error de datos, no del código");
  }
  const ok = await canje(env, { code, verifier, nombre: "Otro nombre", plataforma: "ios" });
  assert.equal(ok.status, 200, "los datos inválidos no consumieron el código");
  const [d] = await dispositivos(env, "ana");
  assert.equal(d.nombre, "PC de Ana", "manda el nombre que el usuario vio en el consentimiento");
  assert.equal(d.plataforma, "windows");
});

// ---------- Criterio 4: límite de tasa por IP ----------

test("canje: límite de tasa por CF-Connecting-IP (429 con Retry-After) que no consume el código", async () => {
  const { env } = crearEnv();
  const ip = "203.0.113.9";
  for (let i = 0; i < 10; i++) {
    const res = await canje(env, { code: pkce().verifier, verifier: pkce().verifier }, { ip });
    assert.equal(res.status, 400, `intento ${i + 1}`);
  }
  const { code, verifier } = await nuevoCodigo(env);
  const limitado = await canje(env, { code, verifier }, { ip, headers: { "x-forwarded-for": "192.0.2.77" } });
  assert.equal(limitado.status, 429, "la undécima petición de la misma IP en un minuto; X-Forwarded-For no cuenta");
  assert.ok(Number(limitado.headers.get("retry-after")) > 0);
  assert.match(limitado.headers.get("content-type") ?? "", /application\/json/);
  // Otra IP no está limitada y el código sigue vivo.
  const otra = await canje(env, { code, verifier }, { ip: "203.0.113.10" });
  assert.equal(otra.status, 200);
  // Pasada la ventana, la primera IP vuelve a poder.
  mock.timers.setTime(T0 + 61_000);
  assert.equal((await canje(env, { code: pkce().verifier, verifier: pkce().verifier }, { ip })).status, 400);
});

// ---------- Configuración ----------

test("canje: sin binding DB → 503 JSON; con login sin configurar → 503", async () => {
  const { env } = crearEnv({ DB: undefined });
  const res = await canje(env, { code: pkce().verifier, verifier: pkce().verifier });
  assert.equal(res.status, 503);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const sinSecreto = crearEnv({ SESSION_SECRET: "corto" });
  assert.equal((await canje(sinSecreto.env, { code: pkce().verifier, verifier: pkce().verifier })).status, 503);
});

// ---------- Criterio 8: el token no se filtra ----------

test("el token no aparece en logs, errores, cabeceras ni en otras respuestas", async () => {
  const { env } = crearEnv();
  let token, code, verifier;
  const cuerpos = [];
  const ver = async (res) => {
    cuerpos.push(`${JSON.stringify([...res.headers])}\n${await res.text()}`);
  };
  const logs = await conConsola(async () => {
    ({ token, code, verifier } = await emitir(env));
    await ver(await canje(env, { code, verifier })); // ya usado
    await ver(await pedir("/auth/me", { env, bearer: token }));
    await ver(await pedir("/uuv/", { env, bearer: token }));
    await ver(await pedir("/api/comentarios/?pagina=%2Fuuv%2Farquitectura%2F", { env, bearer: token }));
    await ver(await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    await ver(await pedir("/api/no-existe", { env, bearer: token }));
    await ver(await pedir("/uuv/", { env, bearer: `${token}x` }));
    await ver(await pedir("/uuv/", { env, bearer: token, cookie: sesion("ana") }));
    // Almacén caído a mitad de uso.
    env.DB.batch = async () => {
      throw new Error("D1 caído");
    };
    env.DB.prepare = () => {
      throw new Error("D1 caído");
    };
    await ver(await pedir("/auth/me", { env, bearer: token }).catch((e) => new Response(String(e?.stack ?? e))));
  });
  for (const secreto of [token, token.slice(4), code, verifier]) {
    assert.ok(!logs.includes(secreto), "nada secreto en console.*");
    for (const c of cuerpos) assert.ok(!c.includes(secreto), `nada secreto en respuestas: ${c.slice(0, 200)}`);
  }
});
