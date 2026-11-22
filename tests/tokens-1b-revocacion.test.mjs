// Lote 1B-1 de «tokens de dispositivo»: revocación y purga, antes de que exista ninguna ruta que emita códigos.
// API con Bearer (listar y revocar el propio token), revocar todos los tokens de un login, purga de codigos_app y
// rutas de navegador con Bearer. Ver .factory/spec.md, criterios 1 a 4 y 7.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0,
  ORIGIN,
  RE_ISO,
  API_LISTA,
  API_REVOCAR,
  PAGINA,
  REVOCAR,
  FORM,
  crearEnv,
  cargarCore,
  pedir,
  canje,
  emitir,
  nuevoCodigo,
  dispositivos,
  sesion,
  sha256hex,
  tokenFalso,
  filasTokens,
  codigos,
  mockGitHub,
  callback,
  conConsola,
} from "./fixtures/tokens-1b.mjs";

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

const esJson = (res) => assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
const vivo = async (env, token) => (await pedir("/auth/me", { env, bearer: token })).status === 200;

// ---------- Criterio 1: core (revocar todos, purga de códigos) ----------

test("core: revocarTodos borra todos los tokens del login (sin distinguir mayúsculas) y ninguno ajeno", async () => {
  const { env } = crearEnv();
  const a1 = await emitir(env, { login: "Ana", nombre: "PC de Ana" });
  const a2 = await emitir(env, { login: "ana", nombre: "Portátil", plataforma: "linux" });
  const b = await emitir(env, { login: "beto", nombre: "PC de Beto" });
  const { revocarTodos } = await cargarCore();
  assert.equal(typeof revocarTodos, "function", "lib/dispositivos-core.mjs debe exportar revocarTodos(db, login)");

  assert.equal(await revocarTodos(env.DB, "ANA"), 2, "devuelve cuántos borró");
  assert.equal(await vivo(env, a1.token), false);
  assert.equal(await vivo(env, a2.token), false);
  assert.equal(await vivo(env, b.token), true, "el token de otro login sigue vivo");
  assert.deepEqual(await dispositivos(env, "ana"), []);
  assert.equal((await dispositivos(env, "beto")).length, 1);

  assert.equal(await revocarTodos(env.DB, "ana"), 0, "repetirlo no borra nada");
  for (const malo of ["", undefined, null, 7, "%", "a%"]) assert.equal(await revocarTodos(env.DB, malo), 0, `login ${JSON.stringify(malo)}`);
  assert.equal(await vivo(env, b.token), true, "un login vacío o con comodines no borra nada");
});

test("purga: crear un código borra códigos caducados de codigos_app, de forma acotada, y nunca uno vivo", async () => {
  const { env } = crearEnv();
  const viejo = await nuevoCodigo(env, { login: "ana" });
  // 60 códigos caducados (uno justo en el límite) metidos a mano, como quedarían tras 60 consentimientos sin canjear.
  const st = env.DB.sqlite.prepare("INSERT INTO codigos_app (hash, login, challenge, nombre, plataforma, expira) VALUES (?, 'ana', ?, 'PC', 'windows', ?)");
  for (let i = 0; i < 60; i++) st.run(sha256hex(`caducado-${i}`), "c".repeat(43), i === 0 ? T0 + 30_000 : T0 - 1000 - i);
  mock.timers.tick(30_000);
  const caducados = () => codigos(env).filter((c) => Number(c.expira) <= Date.now()).length;
  assert.equal(caducados(), 60);

  const nuevo = await nuevoCodigo(env, { login: "beto" });
  const quedan = caducados();
  assert.ok(quedan < 60, "crear un código debe purgar códigos caducados");
  assert.ok(quedan >= 10, `la purga es acotada: como mucho 50 por creación (quedan ${quedan})`);
  await nuevoCodigo(env, { login: "beto" });
  assert.equal(caducados(), 0, "la segunda creación termina la purga");
  assert.equal(codigos(env).length, 3, "quedan solo los tres códigos vivos");

  // Los vivos siguen valiendo: el de hace 30 s y el recién creado.
  assert.equal((await canje(env, { code: viejo.code, verifier: viejo.verifier })).status, 200);
  assert.equal((await canje(env, { code: nuevo.code, verifier: nuevo.verifier })).status, 200);
});

test("purga: no añade escrituras a rutas anónimas (un canje fallido no borra códigos caducados)", async () => {
  const { env } = crearEnv();
  env.DB.sqlite.prepare("INSERT INTO codigos_app (hash, login, challenge, nombre, plataforma, expira) VALUES (?, 'ana', ?, 'PC', 'windows', ?)").run(sha256hex("x"), "c".repeat(43), T0 - 1);
  const res = await canje(env, { code: "A".repeat(43), verifier: "v".repeat(43) });
  assert.equal(res.status, 400);
  assert.equal(codigos(env).length, 1, "la purga va con la creación de códigos (ruta con sesión), no con el canje público");
});

// ---------- Criterio 2: GET /auth/app/dispositivos (Bearer) ----------

test("api: GET /auth/app/dispositivos lista los dispositivos del login del token y marca el actual", async () => {
  const { env, llamadas } = crearEnv();
  const a1 = await emitir(env, { login: "ana", nombre: "PC de Ana" });
  mock.timers.tick(5000);
  const a2 = await emitir(env, { login: "ana", nombre: "Portátil", plataforma: "linux" });
  const b = await emitir(env, { login: "beto", nombre: "Equipo de Beto", plataforma: "macos" });

  for (const path of [API_LISTA, `${API_LISTA}/`]) {
    const res = await pedir(path, { env, bearer: a1.token });
    assert.equal(res.status, 200, path);
    esJson(res);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("set-cookie"), null);
    const texto = await res.text();
    const json = JSON.parse(texto);
    assert.equal(json.login, "ana");
    assert.deepEqual(json.dispositivos.map((d) => d.nombre), ["Portátil", "PC de Ana"], "más reciente primero");
    assert.deepEqual(json.dispositivos.map((d) => d.actual), [false, true], "solo el token de la petición es el actual");
    assert.deepEqual(json.dispositivos.map((d) => d.plataforma), ["linux", "windows"]);
    for (const d of json.dispositivos) {
      assert.deepEqual(Object.keys(d).sort(), ["actual", "creado", "expira", "id", "nombre", "plataforma", "ultimoUso"]);
      assert.match(d.creado, RE_ISO);
      assert.match(d.expira, RE_ISO);
      assert.ok(d.ultimoUso === null || RE_ISO.test(d.ultimoUso), "ultimoUso es null o una fecha ISO");
    }
    assert.deepEqual(json.dispositivos.map((d) => d.id).sort(), (await dispositivos(env, "ana")).map((d) => d.id).sort());
    // Nada secreto ni ajeno en el cuerpo.
    for (const secreto of [a1.token, a2.token, b.token, sha256hex(a1.token), sha256hex(a2.token), "beto", "Equipo de Beto"]) {
      assert.ok(!texto.includes(secreto), `la respuesta no debe contener ${secreto.slice(0, 12)}…`);
    }
  }
  assert.equal(llamadas.length, 0, "no se sirve ningún asset");
});

test("api: /auth/app/dispositivos y /auth/app/revocar exigen Bearer (401 JSON sin redirigir, también con cookie válida)", async () => {
  const { env, llamadas } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  for (const [path, method] of [
    [API_LISTA, "GET"],
    [API_REVOCAR, "POST"],
  ]) {
    for (const cookie of [undefined, sesion("ana")]) {
      const res = await pedir(path, { env, method, cookie });
      assert.equal(res.status, 401, `${method} ${path} ${cookie ? "con cookie" : "sin credenciales"}`);
      esJson(res);
      assert.deepEqual(await res.json(), { error: "Token requerido" });
      assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/);
      assert.equal(res.headers.get("location"), null);
    }
    // Un token desconocido recibe el 401 genérico del lote A.
    const falso = await pedir(path, { env, method, bearer: tokenFalso() });
    assert.equal(falso.status, 401);
    assert.deepEqual(await falso.json(), { error: "Token inválido" });
  }
  assert.equal(await vivo(env, token), true, "nada de lo anterior revoca");
  assert.equal(llamadas.length, 0, "ninguna de estas rutas sirve un asset");
});

test("api: métodos — la lista solo admite GET y la revocación solo POST (405 con Allow)", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const res = await pedir(API_LISTA, { env, method, bearer: token });
    assert.equal(res.status, 405, `${method} ${API_LISTA}`);
    assert.match(res.headers.get("allow") ?? "", /\bGET\b/);
    esJson(res);
  }
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const res = await pedir(API_REVOCAR, { env, method, bearer: token });
    assert.equal(res.status, 405, `${method} ${API_REVOCAR}`);
    assert.equal(res.headers.get("allow"), "POST");
    esJson(res);
  }
  assert.equal(await vivo(env, token), true, "un GET a /auth/app/revocar no revoca");
});

// ---------- Criterio 3: POST /auth/app/revocar (Bearer) ----------

test("api: POST /auth/app/revocar borra solo el token de la petición; la siguiente petición con él da 401", async () => {
  const { env } = crearEnv();
  const a1 = await emitir(env, { login: "ana", nombre: "PC de Ana" });
  const a2 = await emitir(env, { login: "ana", nombre: "Portátil", plataforma: "linux" });
  const b = await emitir(env, { login: "beto" });

  // El cuerpo se ignora: un id ajeno en el cuerpo o en la query no cambia qué se revoca.
  const idAjeno = (await dispositivos(env, "beto"))[0].id;
  const idHermano = (await dispositivos(env, "ana")).find((d) => d.nombre === "Portátil").id;
  const res = await pedir(`${API_REVOCAR}?id=${idAjeno}`, { env, method: "POST", bearer: a1.token, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: idHermano, login: "beto" }) });
  assert.equal(res.status, 200);
  esJson(res);
  assert.deepEqual(await res.json(), { ok: true });
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(res.headers.get("set-cookie"), null);

  const despues = await pedir("/auth/me", { env, bearer: a1.token });
  assert.equal(despues.status, 401);
  assert.deepEqual(await despues.json(), { error: "Token inválido" });
  assert.equal(await vivo(env, a2.token), true, "otro dispositivo del mismo login sigue vivo");
  assert.equal(await vivo(env, b.token), true, "el de otro login también");
  assert.deepEqual((await dispositivos(env, "ana")).map((d) => d.nombre), ["Portátil"]);

  // Repetir con el token ya revocado: 401 genérico, sin distinguir «ya revocado» de «nunca existió».
  const otraVez = await pedir(API_REVOCAR, { env, method: "POST", bearer: a1.token });
  assert.equal(otraVez.status, 401);
  assert.deepEqual(await otraVez.json(), { error: "Token inválido" });
});

test("api: POST /auth/app/revocar no exige Origin, pero un Origin ajeno se rechaza (403) sin revocar", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  for (const origin of ["https://evil.example", "tauri://localhost", "null"]) {
    const res = await pedir(API_REVOCAR, { env, method: "POST", bearer: token, headers: { origin } });
    assert.equal(res.status, 403, origin);
    esJson(res);
  }
  assert.equal(await vivo(env, token), true);
  assert.equal((await pedir(API_REVOCAR, { env, method: "POST", bearer: token, headers: { origin: ORIGIN } })).status, 200, "con el Origin propio sí");
  assert.equal(await vivo(env, token), false);
});

test("api: sin binding DB o con D1 caído → 503 JSON sin detalles; el token no sale en logs ni en respuestas", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const sinDb = await pedir(API_LISTA, { env: { ...env, DB: undefined }, bearer: token });
  assert.equal(sinDb.status, 503);
  esJson(sinDb);

  // D1 responde a la lectura del Bearer y falla después (al listar o al borrar).
  const real = env.DB;
  let n = 0;
  const roto = {
    prepare(sql) {
      if (n++ === 0) return real.prepare(sql);
      throw new Error("D1_ERROR: tabla secreta tokens");
    },
    batch() {
      throw new Error("D1_ERROR: tabla secreta tokens");
    },
  };
  const salida = await conConsola(async () => {
    for (const [path, method] of [
      [API_LISTA, "GET"],
      [API_REVOCAR, "POST"],
    ]) {
      n = 0;
      const res = await pedir(path, { env: { ...env, DB: roto }, method, bearer: token });
      assert.equal(res.status, 503, `${method} ${path}`);
      esJson(res);
      const texto = await res.text();
      assert.ok(!/D1_ERROR|secreta/.test(texto), "sin el mensaje de D1");
      assert.ok(!texto.includes(token));
    }
  });
  assert.ok(!salida.includes(token) && !salida.includes(sha256hex(token)), "ni el token ni su hash aparecen en console.*");
  assert.equal(await vivo(env, token), true, "si falló el borrado, el token sigue vivo y la app lo sabe por el 503");
});

// ---------- Criterio 4: revocar todos los tokens de un login que pierde el acceso ----------

test("callback: si GitHub confirma que el login ya no tiene acceso, se revocan todos sus tokens", async () => {
  const { env } = crearEnv();
  const a1 = await emitir(env, { login: "ana", nombre: "PC de Ana" });
  const a2 = await emitir(env, { login: "ana", nombre: "Portátil", plataforma: "linux" });
  const b = await emitir(env, { login: "beto" });

  mockGitHub({ login: "Ana", miembro: 404, publico: 404 });
  const res = await callback(env);
  assert.equal(res.status, 403, "la página de «Sin acceso» de siempre");
  assert.match(await res.text(), /github\.com\/orgs\/vanttec\/people/);
  assert.equal(res.headers.get("set-cookie"), null);

  globalThis.fetch = realFetch;
  assert.equal(await vivo(env, a1.token), false);
  assert.equal(await vivo(env, a2.token), false);
  assert.equal(await vivo(env, b.token), true, "los tokens de otro login no se tocan");
  assert.deepEqual(filasTokens(env).map((f) => f.login), ["beto"]);
});

test("callback: un fallo de GitHub (5xx) no revoca nada; un login con acceso tampoco", async () => {
  const { env } = crearEnv();
  const a = await emitir(env, { login: "ana" });

  for (const estados of [
    { miembro: 500, publico: 500 },
    { miembro: 502, publico: 404 },
    { miembro: 404, publico: 503 },
  ]) {
    mockGitHub({ login: "ana", ...estados });
    const res = await callback(env);
    assert.equal(res.status, 403, "sin confirmación de acceso no se entra, como hoy");
    assert.equal(filasTokens(env).length, 1, `con ${JSON.stringify(estados)} no se sabe si perdió el acceso: no se revoca`);
  }

  mockGitHub({ login: "ana", miembro: 200 });
  assert.equal((await callback(env)).status, 302);
  const { env: envLista } = crearEnv({ ALLOWED_USERS: "ana", DB: env.DB });
  mockGitHub({ login: "ana", miembro: 404, publico: 404 });
  assert.equal((await callback(envLista)).status, 302, "ALLOWED_USERS deja pasar");
  globalThis.fetch = realFetch;
  assert.equal(await vivo(env, a.token), true);
});

test("callback: si la revocación falla (D1 caído o sin binding), la respuesta sigue siendo el 403 de siempre", async () => {
  const { env } = crearEnv();
  const roto = {
    prepare() {
      throw new Error("D1_ERROR: caído");
    },
    batch() {
      throw new Error("D1_ERROR: caído");
    },
  };
  for (const DB of [roto, undefined]) {
    mockGitHub({ login: "ana", miembro: 404, publico: 404 });
    const res = await callback({ ...env, DB });
    assert.equal(res.status, 403);
    const html = await res.text();
    assert.match(html, /@ana/);
    assert.ok(!html.includes("D1_ERROR"));
  }
});

// ---------- Criterio 7: rutas de navegador con Bearer ----------

test("bearer: las rutas de navegador responden 400 JSON con un token válido (ni OAuth, ni cookies, ni HTML)", async () => {
  const { env, llamadas } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const id = (await dispositivos(env, "ana"))[0].id;
  const casos = [
    ["GET", "/auth/login"],
    ["GET", "/auth/login/?next=/uuv/"],
    ["GET", "/auth/callback?state=S&code=C"],
    ["GET", "/auth/logout"],
    ["GET", "/auth/signed-out"],
    ["GET", PAGINA],
    ["GET", `${PAGINA}/`],
    ["POST", REVOCAR],
  ];
  for (const [method, path] of casos) {
    const res = await pedir(path, { env, method, bearer: token, headers: method === "POST" ? FORM : {}, body: method === "POST" ? `id=${id}&csrf=x` : undefined });
    assert.equal(res.status, 400, `${method} ${path}`);
    esJson(res);
    assert.deepEqual(await res.json(), { error: "Ruta solo para navegador" }, path);
    assert.equal(res.headers.get("set-cookie"), null, `${path}: sin Set-Cookie`);
    assert.equal(res.headers.get("location"), null, `${path}: sin redirección`);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  }
  assert.equal(llamadas.length, 0);
  assert.equal(await vivo(env, token), true, "/auth/logout con Bearer no revoca ni finge cerrar sesión: para eso está /auth/app/revocar");
  assert.equal(filasTokens(env).length, 1);
});
