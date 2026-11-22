// Lote G1 «token de subida»: resolverBearer acepta `vts_…` (tipo `subida`) además de `vtd_…` (tipo `dispositivo`),
// lee `tipo` y `alcance` en la misma consulta y falla cerrado si el prefijo no cuadra con la fila o si el tipo o el
// alcance no son los conocidos. También: revocación y listas. Ver .factory/spec.md, criterios 1 y 7.
// Las filas de subida se insertan directamente en D1: la emisión es el lote G2.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0,
  DIA,
  TREINTA_DIAS,
  ORIGIN,
  EDITOR,
  API_LISTA,
  API_REVOCAR,
  crearEnv,
  cargarCore,
  pedir,
  emitir,
  dispositivos,
  sesion,
  tokenFalso,
  paginaCon,
  mockGitHub,
  callback,
  insertarToken,
  tokenSubidaFalso,
  filaToken,
  cuantosTokens,
} from "./fixtures/subida.mjs";

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

// ---------- Criterio 1: el token de subida se reconoce ----------

test("subida: un token vts_ vivo se autentica como su login; el resultado lleva tipo y alcance", async () => {
  const { env } = crearEnv();
  const subida = insertarToken(env, { login: "ana" });
  const app = await emitir(env, { login: "beto" });

  const me = await pedir("/auth/me", { env, bearer: subida.token });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { login: "ana" });
  assert.equal((await pedir("/auth/me", { env, autorizacion: `bearer ${subida.token}` })).status, 200, "el esquema no distingue mayúsculas");

  const { resolverBearer } = await cargarCore();
  const peticion = (token) => new Request(`${ORIGIN}/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.deepEqual(await resolverBearer(peticion(subida.token), env), { estado: "ok", login: "ana", id: subida.id, tipo: "subida", alcance: "subida" });
  const deApp = await resolverBearer(peticion(app.token), env);
  assert.equal(deApp.estado, "ok");
  assert.equal(deApp.login, "beto");
  assert.equal(deApp.tipo, "dispositivo");
  assert.equal(deApp.alcance, "completo");
});

test("subida: tipo y alcance salen de la misma lectura (una sola sentencia de D1 por petición)", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: "ana" });
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  const antes = env.DB.stats.sql.length;
  mock.timers.setTime(T0 + 1000);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  const nuevas = env.DB.stats.sql.slice(antes);
  assert.equal(nuevas.length, 1, `una única lectura: ${nuevas.join(" ; ")}`);
  assert.match(nuevas[0], /^\s*SELECT\b/i);
});

// ---------- Criterio 1: falla cerrado ----------

test("subida: prefijo que no cuadra con el tipo, o tipo o alcance desconocidos → el mismo 401 que un token desconocido", async () => {
  const { env, llamadas } = crearEnv();
  const casos = {
    "vtd_ con fila de subida": { prefijo: "vtd_", tipo: "subida", alcance: "subida" },
    "vts_ con fila de dispositivo": { prefijo: "vts_", tipo: "dispositivo", alcance: "completo" },
    "vts_ con alcance completo": { prefijo: "vts_", tipo: "subida", alcance: "completo" },
    "vts_ con alcance más fino (aún no existe)": { prefijo: "vts_", tipo: "subida", alcance: "subida:uuv/electronica" },
    "vts_ con alcance vacío": { prefijo: "vts_", tipo: "subida", alcance: "" },
    "vts_ con alcance en mayúsculas": { prefijo: "vts_", tipo: "subida", alcance: "Subida" },
    "vts_ con tipo en mayúsculas": { prefijo: "vts_", tipo: "Subida", alcance: "subida" },
    "vts_ con tipo desconocido": { prefijo: "vts_", tipo: "admin", alcance: "subida" },
    "vtd_ con tipo desconocido": { prefijo: "vtd_", tipo: "admin", alcance: "completo" },
    "vtd_ con alcance de subida": { prefijo: "vtd_", tipo: "dispositivo", alcance: "subida" },
    "vtd_ con alcance desconocido": { prefijo: "vtd_", tipo: "dispositivo", alcance: "otro" },
    "vtd_ con tipo vacío": { prefijo: "vtd_", tipo: "", alcance: "completo" },
  };
  const filas = Object.entries(casos).map(([que, fila]) => [que, insertarToken(env, { login: EDITOR, ...fila })]);
  const caducado = insertarToken(env, { login: EDITOR, creado: T0 - TREINTA_DIAS, expira: T0 });
  const malos = [...filas, ["vts_ caducado", caducado], ["vts_ desconocido", { token: tokenSubidaFalso() }]];

  for (const path of ["/auth/me", "/api/archivos/?capacidades=1", "/uuv/grafo/"]) {
    const referencia = await pedir(path, { env, bearer: tokenFalso() });
    assert.equal(referencia.status, 401);
    const esperado = await referencia.text();
    for (const [que, { token }] of malos) {
      const res = await pedir(path, { env, bearer: token });
      assert.equal(res.status, 401, `${que} en ${path}`);
      assert.match(res.headers.get("www-authenticate") ?? "", /^Bearer/, que);
      assert.equal(res.headers.get("location"), null, que);
      assert.equal(await res.text(), esperado, `${que}: el 401 no revela por qué falló`);
    }
  }
  assert.equal(llamadas.length, 0, "ningún asset se sirve");
  for (const [que, { id }] of filas) assert.equal(filaToken(env, id).ultimo_uso, null, `${que}: una fila rechazada no anota último uso`);
});

test("subida: un vts_ mal formado se rechaza sin consultar D1; sin binding DB, uno bien formado da 503", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env);
  const antes = env.DB.stats.sql.length;
  for (const bearer of ["vts_corto", `vts_${"*".repeat(43)}`, `${token}A`, token.slice(0, -1), `vtx_${token.slice(4)}`, `VTS_${token.slice(4)}`, token.slice(4)]) {
    assert.equal((await pedir("/auth/me", { env, bearer })).status, 401, bearer.slice(0, 8));
  }
  assert.equal(env.DB.stats.sql.length, antes, "ni una sentencia SQL para algo que no tiene forma de token");

  const sinDb = crearEnv({ DB: undefined });
  const res = await pedir("/auth/me", { env: sinDb.env, bearer: tokenSubidaFalso() });
  assert.equal(res.status, 503, "un vts_ bien formado es un token: sin D1 falla cerrado con 503, como un vtd_");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
});

// ---------- Criterio 1: caducidad y último uso, como los de dispositivo ----------

test("subida: caduca en el instante de `expira` (30 días) y anota el último uso como mucho una vez por hora", async () => {
  const { env } = crearEnv();
  const { token, id } = insertarToken(env, { login: "ana" });
  assert.equal(filaToken(env, id).expira, T0 + TREINTA_DIAS);

  mock.timers.setTime(T0 + 60_000);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  assert.equal(filaToken(env, id).ultimo_uso, T0 + 60_000);
  mock.timers.setTime(T0 + 30 * 60_000);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  assert.equal(filaToken(env, id).ultimo_uso, T0 + 60_000, "dentro de la misma hora no se vuelve a escribir");

  mock.timers.setTime(T0 + 29 * DIA);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  assert.equal(filaToken(env, id).expira, T0 + TREINTA_DIAS, "usarlo no mueve la caducidad");
  mock.timers.setTime(T0 + TREINTA_DIAS - 1000);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  mock.timers.setTime(T0 + TREINTA_DIAS);
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 401, "en el instante de expira ya no vale");
});

// ---------- Criterio 7: revocación ----------

test("revocar: POST /auth/app/revocar con un token de subida borra solo ese token", async () => {
  const { env } = crearEnv();
  const subida = insertarToken(env, { login: "ana" });
  const otra = insertarToken(env, { login: "ana", nombre: "Otra CLI" });
  const app = await emitir(env, { login: "ana" });
  assert.equal(cuantosTokens(env), 3);

  // Sin Origin, sin cuerpo y sin Content-Type: lo que envía un cliente que no es un navegador.
  const res = await pedir(API_REVOCAR, { env, method: "POST", bearer: subida.token });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(filaToken(env, subida.id), undefined, "la fila se borra");
  assert.equal(cuantosTokens(env), 2);
  assert.equal((await pedir("/auth/me", { env, bearer: subida.token })).status, 401, "revocado al momento");
  assert.equal((await pedir("/auth/me", { env, bearer: otra.token })).status, 200, "el otro token de subida sigue vivo");
  assert.equal((await pedir("/auth/me", { env, bearer: app.token })).status, 200, "el de dispositivo también");
});

test("revocar: revocarTodos y la negativa de GitHub en el callback borran también los tokens de subida (guarda)", async () => {
  const { env } = crearEnv();
  const { revocarTodos, revocarDispositivo } = await cargarCore();
  const porId = insertarToken(env, { login: "ana" });
  assert.equal(await revocarDispositivo(env.DB, "beto", porId.id), false, "otro login no puede");
  assert.equal(await revocarDispositivo(env.DB, "ANA", porId.id), true, "revocarDispositivo borra por id sea cual sea el tipo");

  insertarToken(env, { login: "ana" });
  insertarToken(env, { login: "Ana", nombre: "Otra CLI" });
  await emitir(env, { login: "ana" });
  const deBeto = insertarToken(env, { login: "beto" });
  assert.equal(await revocarTodos(env.DB, "ANA"), 3);
  assert.equal(cuantosTokens(env), 1);

  mockGitHub({ login: "beto", miembro: 404, publico: 404 });
  assert.equal((await callback(env)).status, 403);
  assert.equal(filaToken(env, deBeto.id), undefined, "quien pierde el acceso pierde también su token de subida");
});

// ---------- Criterio 7: las listas de dispositivos no muestran tokens de subida ----------

test("listas: un token de subida no aparece como dispositivo en el core, en la API ni en la página", async () => {
  const { env } = crearEnv();
  const app = await emitir(env, { login: "ana", nombre: "PC de Ana" });
  const subida = insertarToken(env, { login: "ana", nombre: "CLI de Ana" });

  const delCore = await dispositivos(env, "ana");
  assert.deepEqual(delCore.map((d) => d.nombre), ["PC de Ana"], "listarDispositivos solo devuelve tipo dispositivo");
  assert.ok(delCore.every((d) => d.tipo === "dispositivo"));

  const api = await pedir(API_LISTA, { env, bearer: app.token });
  assert.equal(api.status, 200);
  const json = await api.json();
  assert.deepEqual(json.dispositivos.map((d) => d.nombre), ["PC de Ana"]);
  assert.ok(!JSON.stringify(json).includes(subida.id), "ni el id del token de subida sale en la lista de la app");

  // Desde G2 la página sí lo muestra, pero aparte: en la sección «Tokens de subida», nunca en la lista de dispositivos.
  const { filas } = await paginaCon(env, sesion("ana"), 2);
  const deLista = filas.filter((f) => !f.form.closest("section"));
  const deSeccion = filas.filter((f) => f.form.closest("section"));
  assert.deepEqual(deLista.map((f) => f.id), [delCore[0].id], "la lista de dispositivos sigue trayendo solo el dispositivo");
  assert.ok(!deLista[0].fila.textContent.includes("CLI de Ana"), "la página de dispositivos no lo pinta como un dispositivo más");
  assert.deepEqual(deSeccion.map((f) => f.id), [subida.id], "el token de subida va en su propia sección");
  assert.equal((await pedir("/auth/me", { env, bearer: subida.token })).status, 200, "listarlo aparte no lo revoca");
});
