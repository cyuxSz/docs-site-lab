// Lote 1B-2 de «tokens de dispositivo»: autorizar un dispositivo exige un login reciente (criterio 9 de .factory/spec.md).
// La cookie de sesión dura 7 días y el acceso solo se comprueba en /auth/callback. Sin esta regla, quien pierde el
// acceso pero conserva la cookie podría convertirla en tokens de 30 días. Desde este lote la sesión lleva `iat` (ms,
// el instante en que pasó `comprobarAcceso`) y GET /auth/app/iniciar y POST /auth/app/autorizar exigen que tenga como
// mucho 10 minutos. El resto del portal no mira `iat`.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0,
  DIA,
  PAG,
  INICIAR,
  AUTORIZAR,
  RE_CODIGO,
  FORM,
  VENTANA_LOGIN,
  crearEnv,
  pedir,
  emitir,
  sesion,
  sesionSinIat,
  sesionCon,
  sesionDeRespuesta,
  pasarPorLogin,
  peticionApp,
  urlIniciar,
  consentimiento,
  consentir,
  enviarAutorizar,
  enviarRevocar,
  leerListo,
  paginaCon,
  filasCodigos,
  filasTokens,
} from "./fixtures/tokens-1b2.mjs";

const realFetch = globalThis.fetch;
const sinRed = async (input) => {
  throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
};
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  globalThis.fetch = sinRed;
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const MIEMBRO = { miembro: 200, publico: 404 };
const NO_MIEMBRO = { miembro: 404, publico: 404 };

// Sesiones válidas para el portal (firma y `exp` correctos) que no demuestran un login reciente.
// Cada entrada es una función porque `iat` se calcula con el reloj del momento.
const NO_RECIENTES = [
  ["sin iat (cookie emitida antes de este cambio)", () => sesionSinIat("ana")],
  ["iat de hace 10 minutos y 1 ms", () => sesionCon("ana", { iat: Date.now() - VENTANA_LOGIN - 1 })],
  ["iat de hace una hora", () => sesionCon("ana", { iat: Date.now() - 3_600_000 })],
  ["iat de hace 6 días, con la sesión aún viva", () => sesionCon("ana", { iat: Date.now() - 6 * DIA })],
  ["iat en segundos en vez de milisegundos", () => sesionCon("ana", { iat: Math.floor(Date.now() / 1000) })],
  ["iat como texto", () => sesionCon("ana", { iat: String(Date.now()) })],
  ["iat null", () => sesionCon("ana", { iat: null })],
  ["iat true", () => sesionCon("ana", { iat: true })],
  ["iat objeto", () => sesionCon("ana", { iat: { ms: Date.now() } })],
  ["iat cinco minutos en el futuro", () => sesionCon("ana", { iat: Date.now() + 5 * 60_000 })],
];

// Y las que sí: recién emitida, en el borde exacto de la ventana y con un desfase de reloj pequeño entre máquinas.
const RECIENTES = [
  ["iat = ahora", () => sesionCon("ana", { iat: Date.now() })],
  ["iat de hace exactamente 10 minutos", () => sesionCon("ana", { iat: Date.now() - VENTANA_LOGIN })],
  ["iat un segundo en el futuro (desfase de reloj)", () => sesionCon("ana", { iat: Date.now() + 1000 })],
];

// ---------- La sesión registra cuándo pasó por el login ----------

test("callback: la sesión nueva lleva iat (ms) = el instante del login, con el login, el exp de 7 días y el formato de siempre", async () => {
  const { env } = crearEnv();
  const res = await pasarPorLogin(env, "/auth/login?next=%2Fuuv%2F", { login: "ana", ...MIEMBRO });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/uuv/");
  const nueva = sesionDeRespuesta(res);
  assert.ok(nueva, "el callback pone docs_session");
  assert.deepEqual(nueva.carga, { login: "ana", exp: T0 + 7 * DIA, iat: T0 }, "la carga es { login, exp, iat }: exp no se acorta e iat es Date.now() en milisegundos");
  assert.match(nueva.linea, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800$/, "los atributos y la vida de la cookie no cambian");

  // iat es el momento de ese login, no una constante: otro login más tarde lleva otro.
  mock.timers.tick(90_000);
  const otra = sesionDeRespuesta(await pasarPorLogin(env, "/auth/login", { login: "ana", ...MIEMBRO }));
  assert.deepEqual(otra.carga, { login: "ana", exp: T0 + 90_000 + 7 * DIA, iat: T0 + 90_000 });

  // Entrar por ALLOWED_USERS también es pasar comprobarAcceso.
  const lista = crearEnv({ ALLOWED_ORG: "", ALLOWED_USERS: "beto" });
  const deLista = sesionDeRespuesta(await pasarPorLogin(lista.env, "/auth/login", { login: "beto", ...NO_MIEMBRO }));
  assert.equal(deLista.carga.iat, T0 + 90_000);
});

// ---------- GET /auth/app/iniciar ----------

test("iniciar: con una sesión antigua o sin iat redirige al login con el mismo next reconstruido que sin sesión, y no pinta el consentimiento", async () => {
  const { env, llamadas } = crearEnv();
  const { params } = peticionApp({ nombre: "Portátil de Ana", plataforma: "linux" });
  const sinSesion = await pedir(urlIniciar(params), { env });
  assert.equal(sinSesion.status, 302);
  const esperado = sinSesion.headers.get("location");
  assert.ok(esperado.startsWith("/auth/login?next="), esperado);

  for (const [que, cookie] of NO_RECIENTES) {
    // Desordenada y con espacios: el next sale de los valores validados, no de la query cruda.
    const query = Object.entries({ ...params, nombre: `  ${params.nombre}  ` }).reverse();
    for (const lista of [params, query]) {
      const res = await pedir(urlIniciar(lista), { env, cookie: cookie() });
      assert.equal(res.status, 302, `${que}: no se ve el consentimiento sin revalidar el acceso`);
      assert.equal(res.headers.get("location"), esperado, `${que}: el mismo destino que sin sesión`);
      assert.equal(res.headers.get("set-cookie"), null, `${que}: no borra ni cambia la sesión (sigue valiendo para el portal)`);
      const cuerpo = await res.text();
      assert.ok(!/<form\b|csrf/i.test(cuerpo), `${que}: sin formulario ni csrf`);
    }
  }

  for (const [que, cookie] of RECIENTES) {
    const c = await consentimiento(env, cookie(), params);
    assert.equal(c.res.status, 200, que);
    assert.ok(c.form && c.campos.csrf, `${que}: se ve el consentimiento, como hasta ahora`);
  }

  // Una sesión reciente deja de serlo con el paso del tiempo, sin que nadie la toque.
  const cookie = sesion("ana");
  mock.timers.tick(VENTANA_LOGIN);
  assert.equal((await pedir(urlIniciar(params), { env, cookie })).status, 200, "a los 10 minutos justos todavía vale");
  mock.timers.tick(1);
  const tarde = await pedir(urlIniciar(params), { env, cookie });
  assert.equal(tarde.status, 302, "un milisegundo después ya no");
  assert.equal(tarde.headers.get("location"), esperado);

  assert.equal(llamadas.length, 0, "nada cae en ASSETS");
  assert.equal(filasCodigos(env).length, 0);
});

test("iniciar: el orden no cambia — método y validación van antes que la sesión, también con una sesión antigua", async () => {
  const { env } = crearEnv();
  const { params } = peticionApp();
  for (const [que, cookie] of NO_RECIENTES.slice(0, 2)) {
    const post = await pedir(urlIniciar(params), { env, method: "POST", cookie: cookie(), headers: FORM, body: "x=1" });
    assert.equal(post.status, 405, `${que}: método`);
    for (const lista of [{ ...params, plataforma: "beos" }, { ...params, extra: "1" }, { challenge: params.challenge }]) {
      const res = await pedir(urlIniciar(lista), { env, cookie: cookie() });
      assert.equal(res.status, 400, `${que}: un enlace roto no pasa por el login`);
      assert.equal(res.headers.get("location"), null, que);
    }
  }
  // Con Bearer la regla de siempre: 400 JSON, sin mirar la sesión.
  const { token } = await emitir(env, { login: "ana" });
  const conBearer = await pedir(urlIniciar(params), { env, bearer: token });
  assert.equal(conBearer.status, 400);
  assert.deepEqual(await conBearer.json(), { error: "Ruta solo para navegador" });
});

// ---------- POST /auth/app/autorizar ----------

test("autorizar: con una sesión antigua o sin iat responde la misma página 401 que sin sesión y no crea ningún código", async () => {
  const { env } = crearEnv();
  const app = peticionApp();
  const reciente = sesion("ana");
  const { campos } = await consentir(env, reciente, app.params);
  const sinSesion = await enviarAutorizar(env, { campos });
  assert.equal(sinSesion.status, 401);
  const pagina401 = await sinSesion.text();

  const igualQueSinSesion = async (res, que) => {
    assert.equal(res.status, 401, que);
    assert.equal(await res.text(), pagina401, `${que}: la misma página que «sin sesión»`);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", que);
    for (const h of ["location", "refresh", "set-cookie", "allow", "retry-after"]) assert.equal(res.headers.get(h), null, `${que}: sin ${h}`);
    assert.ok(!/<form\b|vanttec-docs:/i.test(pagina401), "sin formulario ni enlace a la app");
    assert.equal(filasCodigos(env).length, 0, `${que}: no se crea ningún código`);
  };

  // El caso que importa: formulario legítimo (csrf válido, Origin propio) enviado con la misma cookie cuando el
  // login ya tiene más de 10 minutos. La ventana se mide al autorizar, no solo al pintar el consentimiento.
  mock.timers.tick(VENTANA_LOGIN + 1);
  await igualQueSinSesion(await enviarAutorizar(env, { cookie: reciente, campos }), "consentimiento abierto más de 10 minutos");
  await igualQueSinSesion(await enviarAutorizar(env, { cookie: reciente, campos, path: `${AUTORIZAR}/` }), "con barra final");

  // Cookies que nunca fueron recientes: el 401 llega antes que el anti-CSRF (que con estas cookies daría 403).
  for (const [que, cookie] of NO_RECIENTES) await igualQueSinSesion(await enviarAutorizar(env, { cookie: cookie(), campos }), que);

  // Va con la comprobación de sesión, la primera del orden: antes que el método, el Origin, el formato y el tamaño.
  const vieja = NO_RECIENTES[0][1]();
  const ct = FORM["content-type"];
  await igualQueSinSesion(await enviarAutorizar(env, { cookie: vieja, campos, method: "GET" }), "GET con sesión antigua (no 405)");
  await igualQueSinSesion(await enviarAutorizar(env, { cookie: vieja, campos, headers: { "content-type": ct } }), "sin Origin (no 403)");
  await igualQueSinSesion(await enviarAutorizar(env, { cookie: vieja, campos, headers: { "content-type": ct, origin: "https://evil.example" } }), "Origin ajeno (no 403)");
  await igualQueSinSesion(await pedir(AUTORIZAR, { env, method: "POST", cookie: vieja, headers: { ...FORM, "content-type": "application/json" }, body: "{}" }), "JSON (no 415)");
  await igualQueSinSesion(await enviarAutorizar(env, { cookie: vieja, campos: { ...campos, relleno: "x".repeat(3000) } }), "cuerpo grande (no 413)");
  // Y no necesita D1 para negarse.
  await igualQueSinSesion(await enviarAutorizar({ ...env, DB: undefined }, { cookie: vieja, campos }), "sin binding DB (no 503)");
});

test("autorizar: dentro de los 10 minutos emite como hasta ahora, también en el borde exacto de la ventana", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const app = peticionApp();
  const { campos } = await consentir(env, cookie, app.params);
  mock.timers.tick(VENTANA_LOGIN);
  const res = await enviarAutorizar(env, { cookie, campos });
  assert.equal(res.status, 200, "a los 10 minutos justos del login todavía se puede autorizar");
  assert.match((await leerListo(res)).code ?? "", RE_CODIGO);
  assert.deepEqual(filasCodigos(env).map((f) => f.login), ["ana"]);
  mock.timers.tick(1);
  assert.equal((await enviarAutorizar(env, { cookie, campos })).status, 401);
  assert.equal(filasCodigos(env).length, 1);
});

// ---------- Ida y vuelta por el login: sin bucle ----------

test("sin bucle: sesión antigua → login → GitHub confirma el acceso → vuelve al consentimiento con los mismos datos y «Autorizar» emite", async () => {
  const { env } = crearEnv();
  const app = peticionApp({ nombre: "Portátil de Ana", plataforma: "linux" });
  for (const [que, hacerCookie] of [NO_RECIENTES[0], NO_RECIENTES[3]]) {
    const vieja = hacerCookie();
    const ida = await pedir(urlIniciar(app.params), { env, cookie: vieja });
    assert.equal(ida.status, 302, `${que}: primero revalida el acceso`);
    const rutaLogin = ida.headers.get("location");
    assert.ok(rutaLogin.startsWith("/auth/login?next="), rutaLogin);

    const cb = await pasarPorLogin(env, rutaLogin, { login: "ana", ...MIEMBRO }, vieja);
    globalThis.fetch = sinRed;
    assert.equal(cb.status, 302, que);
    const vuelta = cb.headers.get("location");
    assert.ok(vuelta.startsWith(`${INICIAR}?`), `${que}: el login vuelve al consentimiento, no al portal: ${vuelta}`);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(vuelta.slice(INICIAR.length + 1))), app.params);
    const nueva = sesionDeRespuesta(cb);
    assert.equal(nueva?.carga.iat, Date.now(), `${que}: la sesión que sale del login es reciente por definición`);

    // El navegador sigue la redirección con la cookie nueva: consentimiento, no otro viaje al login.
    const c = await consentimiento(env, nueva.cookie, vuelta.slice(INICIAR.length + 1));
    assert.equal(c.res.status, 200, `${que}: tras un login correcto no se vuelve a redirigir`);
    assert.equal(c.res.headers.get("location"), null);
    assert.deepEqual({ ...c.campos, csrf: undefined }, { ...app.params, csrf: undefined });
    // Aunque el OAuth tarde (pantalla de GitHub, 2FA), los 10 minutos cuentan desde el callback.
    mock.timers.tick(VENTANA_LOGIN - 1000);
    const post = await enviarAutorizar(env, { cookie: nueva.cookie, campos: c.campos });
    assert.equal(post.status, 200, que);
    assert.match((await leerListo(post)).code ?? "", RE_CODIGO);
    // La cookie antigua, si el navegador la conservara, sigue sin poder autorizar.
    assert.equal((await pedir(urlIniciar(app.params), { env, cookie: vieja })).status, 302);
    mock.timers.tick(61_000);
  }
});

test("quien perdió el acceso no alarga nada: GitHub lo niega en el login → 403, se revocan sus tokens y la cookie antigua sigue sin autorizar", async () => {
  const { env } = crearEnv();
  await emitir(env, { login: "ana" });
  assert.equal(filasTokens(env).length, 1);
  const app = peticionApp();
  // Formulario que consiguió cuando su login era reciente; después pierde el acceso y conserva la cookie.
  const vieja = sesion("ana");
  const { campos } = await consentir(env, vieja, app.params);
  mock.timers.tick(DIA / 2);

  const ida = await pedir(urlIniciar(app.params), { env, cookie: vieja });
  assert.equal(ida.status, 302, "con el login de hace 12 horas no se llega al consentimiento");
  const cb = await pasarPorLogin(env, ida.headers.get("location"), { login: "ana", ...NO_MIEMBRO }, vieja);
  globalThis.fetch = sinRed;
  assert.equal(cb.status, 403);
  assert.equal(sesionDeRespuesta(cb), null, "sin acceso no hay sesión nueva");
  assert.equal(cb.headers.get("location"), null);
  assert.equal(filasTokens(env).length, 0, "la negativa concluyente revoca sus tokens de dispositivo (1B-1)");

  // Con lo único que le queda, la cookie antigua, no obtiene ni el consentimiento ni un código.
  assert.equal((await pedir(urlIniciar(app.params), { env, cookie: vieja })).status, 302);
  assert.equal((await enviarAutorizar(env, { cookie: vieja, campos })).status, 401);
  assert.equal(filasCodigos(env).length, 0);
  assert.equal(filasTokens(env).length, 0);
});

// ---------- El resto del portal no cambia ----------

test("el resto del portal no mira iat: una cookie sin iat o con iat antiguo sigue valiendo para páginas, /auth/me, dispositivos y revocar", async () => {
  const { env, llamadas } = crearEnv();
  await emitir(env, { login: "ana" });
  await emitir(env, { login: "ana", nombre: "Otro PC" });
  const cookies = [sesionSinIat("ana"), sesionCon("ana", { iat: Date.now() - 6 * DIA }), sesionCon("ana", { iat: "x" })];
  for (const cookie of cookies) {
    const antes = llamadas.length;
    const pag = await pedir(PAG, { env, cookie });
    assert.equal(pag.status, 200);
    assert.equal(llamadas.length, antes + 1, "el contenido se sirve");
    assert.equal(pag.headers.get("set-cookie"), null);
    const me = await pedir("/auth/me", { env, cookie });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), { login: "ana" });
    assert.equal((await pedir("/api/comentarios?ruta=/uuv/arquitectura/", { env, cookie })).status !== 401, true, "las APIs siguen aceptando la sesión");
  }
  // La página de dispositivos y su revocación (1B-1) tampoco exigen login reciente.
  const p = await paginaCon(env, cookies[0], 2);
  const rev = await enviarRevocar(env, { cookie: cookies[0], campos: { id: p.filas[0].id, csrf: p.filas[0].csrf } });
  assert.equal(rev.status, 303);
  assert.equal(filasTokens(env).length, 1);
  // La vida de la sesión no se acorta: una sesión de hace 6 días y 23 horas sigue entrando al portal.
  const res = await pasarPorLogin(env, "/auth/login", { login: "ana", ...MIEMBRO });
  globalThis.fetch = sinRed;
  const { cookie } = sesionDeRespuesta(res);
  mock.timers.tick(7 * DIA - 3_600_000);
  assert.equal((await pedir(PAG, { env, cookie })).status, 200);
  assert.equal((await pedir(urlIniciar(peticionApp().params), { env, cookie })).status, 302, "pero para autorizar un dispositivo hay que volver a pasar por el login");
  mock.timers.tick(3_600_000);
  assert.equal((await pedir(PAG, { env, cookie })).status, 302, "y caduca a los 7 días, como siempre");
});
