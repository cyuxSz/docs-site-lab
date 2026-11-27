// Lote A de «tokens de dispositivo»: manejarLogin y exigirSesion aceptan `Authorization: Bearer <token>` además de la
// cookie. Con Bearer nunca se redirige (401 JSON), no se exige Origin en escrituras, no hay CORS y los permisos
// (canAccess, editores) se aplican con el login del token. Ver .factory/spec.md, criterios 5 a 8.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { T0, DIA, TREINTA_DIAS, ORIGIN, SECRET, EDITOR, PAG, crearEnv, cargarCore, pedir, emitir, dispositivos, sesion, tokenFalso } from "./fixtures/tokens-app.mjs";

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

const API_COM = `/api/comentarios/?pagina=${encodeURIComponent(PAG)}`;
const JSON_CT = { "content-type": "application/json" };
const comentario = (extra = {}) => JSON.stringify({ pagina: PAG, tipo: "duda", texto: "¿Por qué el PID ignora x/y?", ...extra });
const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

async function revocar(env, login, id) {
  const { revocarDispositivo } = await cargarCore();
  return revocarDispositivo(env.DB, login, id);
}

// ---------- Criterio 5: Bearer válido ----------

test("bearer: un token válido abre /auth/me, los assets y la API sin cookie", async () => {
  const { env, llamadas } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });

  const me = await pedir("/auth/me", { env, bearer: token });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { login: "ana" });

  const pagina = await pedir("/uuv/grafo/", { env, bearer: token });
  assert.equal(pagina.status, 200);
  assert.equal(await pagina.text(), "<h1>asset</h1>");
  assert.equal(pagina.headers.get("cache-control"), "private, no-store");
  assert.equal(pagina.headers.get("x-frame-options"), "DENY", "con las cabeceras globales de siempre");
  assert.equal(llamadas.length, 1);

  const api = await pedir(API_COM, { env, bearer: token });
  assert.equal(api.status, 200);
  assert.equal((await api.json()).yo, "ana");
});

test("bearer: el esquema no distingue mayúsculas; otros esquemas se ignoran (sigue el flujo de cookie)", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env);
  assert.equal((await pedir("/auth/me", { env, autorizacion: `bearer ${token}` })).status, 200);
  assert.equal((await pedir("/auth/me", { env, autorizacion: `BEARER ${token}` })).status, 200);
  // Basic no es una credencial del portal: sin cookie redirige como hoy y con cookie entra como hoy.
  const basic = await pedir("/uuv/", { env, autorizacion: "Basic YTpi" });
  assert.equal(basic.status, 302);
  assert.match(basic.headers.get("location"), /^\/auth\/login\?next=/);
  assert.equal((await pedir("/uuv/", { env, autorizacion: "Basic YTpi", cookie: sesion("ana") })).status, 200);
});

// ---------- Criterio 5: Bearer inválido → 401 JSON, nunca redirección ----------

test("bearer: desconocido, mal formado, revocado o caducado → 401 JSON idéntico, sin redirigir ni tocar ASSETS", async () => {
  const { env, llamadas } = crearEnv();
  const revocado = await emitir(env, { nombre: "Revocado" });
  const [d] = await dispositivos(env, "ana");
  assert.equal(await revocar(env, "ana", d.id), true);
  const caducado = await emitir(env, { nombre: "Caducado" });
  mock.timers.setTime(T0 + TREINTA_DIAS + 1);
  const vivo = await emitir(env, { nombre: "Vivo" });

  const malos = {
    desconocido: tokenFalso(),
    revocado: revocado.token,
    caducado: caducado.token,
    "sin prefijo": vivo.token.slice(4),
    "otro prefijo": `xyz_${vivo.token.slice(4)}`,
    truncado: vivo.token.slice(0, -1),
    "con cola": `${vivo.token}A`,
    "cookie como token": decodeURIComponent(sesion("ana").split("=")[1]),
    vacío: "",
  };
  for (const [path, method] of [["/uuv/grafo/?vista=plan", "GET"], [API_COM, "GET"], ["/auth/me", "GET"], ["/api/comentarios/", "POST"], ["/restringido-demo/", "GET"]]) {
    const cuerpos = new Set();
    for (const [que, bearer] of Object.entries(malos)) {
      const res = await pedir(path, { env, method, bearer, headers: method === "POST" ? JSON_CT : {}, body: method === "POST" ? comentario() : undefined });
      assert.equal(res.status, 401, `${que} en ${method} ${path}`);
      assert.equal(res.headers.get("location"), null, `${que}: con Bearer nunca se redirige`);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/, que);
      assert.match(res.headers.get("cache-control") ?? "", /no-store/, que);
      assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/, que);
      assert.equal(res.headers.get("set-cookie"), null);
      const texto = await res.text();
      assert.equal(typeof JSON.parse(texto).error, "string", que);
      cuerpos.add(texto);
    }
    assert.equal(cuerpos.size, 1, `${path}: el 401 no revela por qué falló: ${[...cuerpos].join(" | ")}`);
  }
  assert.equal(llamadas.length, 0, "ningún asset se sirve con un token inválido");
  assert.equal((await pedir("/auth/me", { env, bearer: vivo.token })).status, 200, "el token vivo sigue funcionando");
});

test("bearer: un token mal formado se rechaza sin consultar D1", async () => {
  const { env } = crearEnv();
  await emitir(env);
  const antes = env.DB.stats.sql.length;
  for (const bearer of ["abc", "vtd_corto", `vtd_${"*".repeat(43)}`, "x".repeat(5000)]) {
    assert.equal((await pedir("/uuv/", { env, bearer })).status, 401);
  }
  assert.equal(env.DB.stats.sql.length, antes, "ni una sentencia SQL para un token que no tiene forma de token");
});

test("bearer: sin binding DB o con D1 caído → 503 JSON (falla cerrado, sin redirigir)", async () => {
  const sinDb = crearEnv({ DB: undefined });
  const res = await pedir("/uuv/", { env: sinDb.env, bearer: tokenFalso() });
  assert.equal(res.status, 503);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(sinDb.llamadas.length, 0);

  const { env, llamadas } = crearEnv();
  const { token } = await emitir(env);
  env.DB.batch = async () => {
    throw new Error("D1 caído");
  };
  env.DB.prepare = () => {
    throw new Error("D1 caído");
  };
  const caido = await pedir("/uuv/", { env, bearer: token });
  assert.equal(caido.status, 503);
  assert.match(caido.headers.get("content-type") ?? "", /application\/json/);
  assert.doesNotMatch(await caido.text(), /D1|SQL|caído/, "sin detalles del almacén");
  assert.equal(llamadas.length, 0);
});

// ---------- Criterio 1 y 5: caducidad absoluta, sin renovación ----------

test("bearer: caduca a los 30 días exactos aunque se use a diario (sin renovación)", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env);
  for (let dia = 1; dia <= 29; dia++) {
    mock.timers.setTime(T0 + dia * DIA);
    assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200, `día ${dia}`);
  }
  const [d] = await dispositivos(env, "ana");
  assert.equal(d.expira, T0 + TREINTA_DIAS, "usarlo no mueve la caducidad");
  mock.timers.setTime(T0 + TREINTA_DIAS - 1000);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  mock.timers.setTime(T0 + TREINTA_DIAS);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 401, "en el instante de expira ya no vale");
  mock.timers.setTime(T0 + TREINTA_DIAS + DIA);
  assert.equal((await pedir("/uuv/", { env, bearer: token })).status, 401);
});

// ---------- Criterio 1: revocación ----------

test("revocar: solo el dueño puede; borra el registro y la siguiente petición da 401", async () => {
  const { env } = crearEnv();
  const deAna = await emitir(env, { login: "ana" });
  const deBeto = await emitir(env, { login: "beto", nombre: "Mac de Beto", plataforma: "macos" });
  const [d] = await dispositivos(env, "ana");

  assert.equal(await revocar(env, "beto", d.id), false, "beto no puede revocar un dispositivo de ana");
  assert.equal(await revocar(env, "ana", "no-existe"), false);
  assert.equal((await pedir("/auth/me", { env, bearer: deAna.token })).status, 200);

  assert.equal(await revocar(env, "ANA", d.id), true, "el login no distingue mayúsculas");
  assert.equal((await pedir("/auth/me", { env, bearer: deAna.token })).status, 401);
  assert.deepEqual(await dispositivos(env, "ana"), []);
  assert.equal(await revocar(env, "ana", d.id), false, "ya no existe");
  assert.equal((await pedir("/auth/me", { env, bearer: deBeto.token })).status, 200, "los demás tokens no se tocan");
});

// ---------- Criterio 6: escrituras con Bearer ----------

test("escritura con Bearer: no exige Origin, pero mantiene Content-Type y el autor es el login del token", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const sinOrigin = await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: JSON_CT, body: comentario() });
  assert.equal(sinOrigin.status, 201);
  assert.equal((await sinOrigin.json()).comentario.autor, "ana");

  const sinCt = await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: { "content-type": "text/plain" }, body: comentario() });
  assert.equal(sinCt.status, 415);

  const mismoOrigen = await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: { ...JSON_CT, origin: ORIGIN }, body: comentario() });
  assert.equal(mismoOrigen.status, 201);
});

test("escritura con Bearer: un Origin de otro sitio se rechaza (403); con cookie todo sigue como hoy", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const ajeno = await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: { ...JSON_CT, origin: "https://otra.example" }, body: comentario() });
  assert.equal(ajeno.status, 403);

  const cookieSinOrigin = await pedir("/api/comentarios/", { env, cookie: sesion("ana"), method: "POST", headers: JSON_CT, body: comentario() });
  assert.equal(cookieSinOrigin.status, 403, "con cookie, Origin sigue siendo obligatorio");
  const cookieAjena = await pedir("/api/comentarios/", { env, cookie: sesion("ana"), method: "POST", headers: { ...JSON_CT, origin: "https://otra.example" }, body: comentario() });
  assert.equal(cookieAjena.status, 403);
  const cookieOk = await pedir("/api/comentarios/", { env, cookie: sesion("ana"), method: "POST", headers: { ...JSON_CT, origin: ORIGIN }, body: comentario() });
  assert.equal(cookieOk.status, 201);
});

test("escritura con Bearer: el límite de tasa por login se mantiene y se comparte con la cookie", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  for (let i = 0; i < 9; i++) {
    const res = await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: JSON_CT, body: comentario() });
    assert.equal(res.status, 201, `escritura ${i + 1}`);
  }
  const decima = await pedir("/api/comentarios/", { env, cookie: sesion("ana"), method: "POST", headers: { ...JSON_CT, origin: ORIGIN }, body: comentario() });
  assert.equal(decima.status, 201);
  const once = await pedir("/api/comentarios/", { env, bearer: token, method: "POST", headers: JSON_CT, body: comentario() });
  assert.equal(once.status, 429);
  assert.ok(Number(once.headers.get("retry-after")) > 0);
});

test("archivos con Bearer: un editor sube y borra sin Origin; quien no es editor recibe 403", async () => {
  const { env } = crearEnv();
  const editor = await emitir(env, { login: EDITOR });
  const lectora = await emitir(env, { login: "ana" });
  const q = new URLSearchParams({ proyecto: "uuv", disciplina: "electronica", id: ID, nombre: "placa.png" }).toString();
  const cabeceras = { "content-type": "application/octet-stream", "content-length": String(PNG.length) };

  const no = await pedir(`/api/archivos/?${q}`, { env, bearer: lectora.token, method: "POST", headers: cabeceras, body: PNG });
  assert.equal(no.status, 403, "los permisos de editor se aplican con el login del token");

  const ajeno = await pedir(`/api/archivos/?${q}`, { env, bearer: editor.token, method: "POST", headers: { ...cabeceras, origin: "https://otra.example" }, body: PNG });
  assert.equal(ajeno.status, 403);
  const malCt = await pedir(`/api/archivos/?${q}`, { env, bearer: editor.token, method: "POST", headers: { ...cabeceras, "content-type": "image/png" }, body: PNG });
  assert.equal(malCt.status, 415);

  const sube = await pedir(`/api/archivos/?${q}`, { env, bearer: editor.token, method: "POST", headers: cabeceras, body: PNG });
  assert.equal(sube.status, 201);
  const baja = await pedir(`/api/archivos/?proyecto=uuv&id=${ID}`, { env, bearer: lectora.token });
  assert.equal(baja.status, 200);
  assert.deepEqual(new Uint8Array(await baja.arrayBuffer()), PNG);

  const borraOtra = await pedir("/api/archivos/", { env, bearer: lectora.token, method: "DELETE", headers: JSON_CT, body: JSON.stringify({ proyecto: "uuv", id: ID }) });
  assert.equal(borraOtra.status, 403);
  const borra = await pedir("/api/archivos/", { env, bearer: editor.token, method: "DELETE", headers: JSON_CT, body: JSON.stringify({ proyecto: "uuv", id: ID }) });
  assert.equal(borra.status, 200);
});

// ---------- Criterio 5: permisos con el login del token ----------

test("bearer: canAccess se aplica con el login del token (403 JSON en proyecto restringido)", async () => {
  const { env, llamadas } = crearEnv();
  const otro = await emitir(env, { login: "otro" });
  const admin = await emitir(env, { login: EDITOR });
  for (const path of ["/restringido-demo/", "/restringido-demo/arch/general.html", "/RESTRINGIDO-DEMO/grafo/"]) {
    const res = await pedir(path, { env, bearer: otro.token });
    assert.equal(res.status, 403, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/, "con Bearer la respuesta es JSON, no la página HTML");
    assert.equal(typeof (await res.json()).error, "string");
  }
  assert.equal(llamadas.length, 0, "ningún asset restringido llega a ASSETS");
  const api = await pedir(`/api/comentarios/?pagina=${encodeURIComponent("/restringido-demo/a/")}`, { env, bearer: otro.token });
  assert.equal(api.status, 403);
  const ok = await pedir("/restringido-demo/", { env, bearer: admin.token });
  assert.equal(ok.status, 200);
  assert.equal(llamadas.length, 1);
  // Con cookie, la página 403 HTML de siempre.
  const html = await pedir("/restringido-demo/", { env, cookie: sesion("otro") });
  assert.equal(html.status, 403);
  assert.match(await html.text(), /Este proyecto es privado/);
});

// ---------- Criterio 7: cookie y Bearer a la vez ----------

test("cookie + Bearer a la vez → 400 JSON, sean válidos o no; no se sirve ni se escribe nada", async () => {
  const { env, llamadas } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const combinaciones = [
    ["ambos válidos, mismo login", sesion("ana"), token],
    ["ambos válidos, logins distintos", sesion("beto"), token],
    ["cookie válida, token desconocido", sesion("ana"), tokenFalso()],
    ["cookie inválida, token válido", "docs_session=a.b", token],
    ["cookie de otro secreto, token válido", sesion("ana", "x".repeat(40)), token],
  ];
  for (const [que, cookie, bearer] of combinaciones) {
    for (const [path, method] of [["/uuv/", "GET"], ["/auth/me", "GET"], [API_COM, "GET"], ["/api/comentarios/", "POST"]]) {
      const res = await pedir(path, { env, cookie, bearer, method, headers: method === "POST" ? { ...JSON_CT, origin: ORIGIN } : {}, body: method === "POST" ? comentario() : undefined });
      assert.equal(res.status, 400, `${que}: ${method} ${path}`);
      assert.match(res.headers.get("content-type") ?? "", /application\/json/, que);
      assert.deepEqual(await res.json(), { error: "Envía la cookie de sesión o el token, no ambos" }, que);
      assert.equal(res.headers.get("location"), null);
    }
  }
  assert.equal(llamadas.length, 0);
  const lista = await pedir(API_COM, { env, bearer: token });
  assert.deepEqual((await lista.json()).comentarios, [], "ninguna de las escrituras ambiguas se aplicó");
  // Otras cookies (p. ej. oauth_state) no cuentan como sesión.
  assert.equal((await pedir("/auth/me", { env, bearer: token, cookie: "oauth_state=x; tema=oscuro" })).status, 200);
});

// ---------- Criterio 7: sin CORS ----------

test("sin CORS: OPTIONS sigue en 405 con Bearer y ninguna respuesta lleva Access-Control-*", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env);
  const preflight = { origin: "tauri://localhost", "access-control-request-method": "POST", "access-control-request-headers": "authorization, content-type" };
  // pedir() ya comprueba que ninguna respuesta lleve cabeceras Access-Control-*.
  for (const path of ["/api/comentarios/", "/api/hardware/", "/api/archivos/"]) {
    const res = await pedir(path, { env, method: "OPTIONS", bearer: token, headers: preflight });
    assert.equal(res.status, 405, path);
    assert.ok(res.headers.get("allow"), `${path}: Allow`);
  }
  // Un preflight real no lleva credenciales: sin sesión sigue siendo 401, nunca 204.
  const sinCred = await pedir("/api/comentarios/", { env, method: "OPTIONS", headers: preflight });
  assert.equal(sinCred.status, 401);
  for (const [path, opciones] of [["/auth/me", { bearer: token, headers: { origin: "tauri://localhost" } }], ["/uuv/", { bearer: token, headers: { origin: "https://otra.example" } }], [API_COM, { bearer: tokenFalso(), headers: { origin: "tauri://localhost" } }]]) {
    const res = await pedir(path, { env, ...opciones });
    assert.equal(res.headers.get("vary")?.toLowerCase().includes("origin") ?? false, false, "tampoco se varía por Origin");
  }
});

// ---------- Criterio 8: ultimoUso ----------

test("ultimoUso: se actualiza como mucho una vez por hora por token", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env);
  const otro = await emitir(env, { nombre: "Teléfono", plataforma: "android" });
  const uso = async (nombre = "PC de Ana") => (await dispositivos(env, "ana")).find((d) => d.nombre === nombre).ultimoUso;
  assert.equal(await uso(), null);

  mock.timers.setTime(T0 + 60_000);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  assert.equal(await uso(), T0 + 60_000, "el primer uso se registra");

  mock.timers.setTime(T0 + 30 * 60_000);
  await pedir("/uuv/", { env, bearer: token });
  await pedir(API_COM, { env, bearer: token });
  assert.equal(await uso(), T0 + 60_000, "dentro de la misma hora no se vuelve a escribir");

  mock.timers.setTime(T0 + 60_000 + 3_600_000 - 1);
  await pedir("/auth/me", { env, bearer: token });
  assert.equal(await uso(), T0 + 60_000);

  mock.timers.setTime(T0 + 60_000 + 3_600_000);
  await pedir("/auth/me", { env, bearer: token });
  assert.equal(await uso(), T0 + 60_000 + 3_600_000, "pasada una hora, sí");
  assert.equal(await uso("Teléfono"), null, "cada token lleva su propio último uso");
  assert.equal((await pedir("/auth/me", { env, bearer: otro.token })).status, 200);
  assert.equal(await uso("Teléfono"), T0 + 60_000 + 3_600_000);
});

test("ultimoUso: dentro de la hora, una petición con Bearer no escribe en la tabla de tokens", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env);
  await pedir("/auth/me", { env, bearer: token });
  const antes = env.DB.stats.sql.length;
  mock.timers.setTime(T0 + 1000);
  await pedir("/auth/me", { env, bearer: token });
  const nuevas = env.DB.stats.sql.slice(antes);
  assert.ok(nuevas.length >= 1, "al menos la lectura del token");
  assert.ok(nuevas.every((s) => /^\s*SELECT\b/i.test(s)), `solo lecturas: ${nuevas.join(" ; ")}`);
  assert.equal(nuevas.length, 1, "una única lectura de D1 por petición autenticada con Bearer");
});

// ---------- Criterio 5: exigirSesion y exigirEscritura (lib/api-comun.mjs) ----------

test("api-comun: exigirSesion devuelve el login del token; exigirEscritura solo exime de Origin a un Bearer ya validado", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const { exigirSesion, exigirEscritura, exigirMismoOrigen, HttpError } = await import("../lib/api-comun.mjs");
  const e = { SESSION_SECRET: SECRET, DB: env.DB };
  const peticion = (bearer, extra = {}) => new Request(`${ORIGIN}/api/comentarios/`, { method: "POST", headers: { ...JSON_CT, authorization: `Bearer ${bearer}`, ...extra }, body: "{}" });

  const buena = peticion(token);
  assert.equal(await exigirSesion(buena, e), "ana");
  assert.doesNotThrow(() => exigirEscritura(buena), "validada con Bearer: no se exige Origin");
  assert.doesNotThrow(() => exigirMismoOrigen(buena));

  // Falla cerrado: llevar la cabecera Authorization no basta si exigirSesion no validó esa misma petición.
  const sinValidar = peticion(token);
  assert.throws(() => exigirEscritura(sinValidar), (err) => err instanceof HttpError && err.status === 403);
  const falsa = peticion(tokenFalso());
  await assert.rejects(() => exigirSesion(falsa, e), (err) => err instanceof HttpError && err.status === 401);
  assert.throws(() => exigirEscritura(falsa), (err) => err instanceof HttpError && err.status === 403);

  const ajena = peticion(token, { origin: "https://otra.example" });
  assert.equal(await exigirSesion(ajena, e), "ana");
  assert.throws(() => exigirEscritura(ajena), (err) => err instanceof HttpError && err.status === 403);

  const ambas = peticion(token, { cookie: sesion("ana"), origin: ORIGIN });
  await assert.rejects(() => exigirSesion(ambas, e), (err) => err instanceof HttpError && err.status === 400);
  await assert.rejects(() => exigirSesion(peticion(token), { SESSION_SECRET: SECRET }), (err) => err instanceof HttpError && err.status === 503, "sin DB no se puede validar un token");
  await assert.rejects(() => exigirSesion(peticion(token), { SESSION_SECRET: "corto", DB: env.DB }), (err) => err instanceof HttpError && err.status === 503);
});

test("core directo: un handler de API acepta Bearer sin pasar por manejarLogin (defensa en profundidad)", async () => {
  const { env } = crearEnv();
  const { token } = await emitir(env, { login: "ana" });
  const { crearHandler } = await import("../lib/comentarios-core.mjs");
  const { clienteD1 } = await import("../lib/almacen-d1.mjs");
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET, DB: env.DB }, redis: clienteD1(env.DB), proyectos: [{ id: "uuv" }], restringidos: {} });
  const ok = await handler(new Request(`${ORIGIN}${API_COM}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).yo, "ana");
  const mal = await handler(new Request(`${ORIGIN}${API_COM}`, { headers: { authorization: `Bearer ${tokenFalso()}` } }));
  assert.equal(mal.status, 401);
});
