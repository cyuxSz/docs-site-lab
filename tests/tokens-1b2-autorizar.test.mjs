// Lote 1B-2 de «tokens de dispositivo»: POST /auth/app/autorizar. Es la ruta que emite códigos: solo con la cookie de
// sesión, Origin propio y el token anti-CSRF del consentimiento. Responde con la página «Listo», que abre el esquema
// fijo vanttec-docs://auth?code=…&state=… sin JavaScript. Ver .factory/spec.md, criterios 4 a 8.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0,
  SECRET,
  ORIGIN,
  AUTORIZAR,
  INICIAR,
  ESQUEMA,
  RE_CODIGO,
  RE_TOKEN,
  FORM,
  crearEnv,
  pedir,
  canje,
  emitir,
  dispositivos,
  sesion,
  sha256hex,
  volcado,
  conConsola,
  filasTokens,
  paginaCon,
  enviarRevocar,
  origenDeNavegador,
  peticionApp,
  consentir,
  enviarAutorizar,
  leerListo,
  autorizar,
  filasCodigos,
  directivasCsp,
  d1Roto,
} from "./fixtures/tokens-1b2.mjs";

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

const texto = (el) => el.textContent.replace(/\s+/g, " ").trim();

// Una respuesta que no emite: ni enlace al esquema, ni redirección, ni cookies, y sin formulario que reenviar.
async function sinEmitir(res, que) {
  assert.equal(res.headers.get("location"), null, `${que}: sin Location`);
  assert.equal(res.headers.get("refresh"), null, `${que}: sin Refresh`);
  assert.equal(res.headers.get("set-cookie"), null, `${que}: sin Set-Cookie`);
  const cuerpo = await res.clone().text();
  assert.ok(!/vanttec-docs:/i.test(cuerpo), `${que}: sin enlace a la app`);
  if (/^text\/html/.test(res.headers.get("content-type") ?? "")) {
    assert.equal(res.headers.get("x-frame-options"), "DENY", que);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", que);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, que);
    assert.ok(!/<form\b/i.test(cuerpo), `${que}: una página de error no lleva formularios`);
  }
  assert.ok(!/D1_ERROR|secreta/.test(cuerpo), que);
}

// ---------- Criterios 5 y 6: emisión y página «Listo» ----------

test("autorizar: con el formulario del consentimiento → página «Listo» con el enlace fijo vanttec-docs://auth?code&state y un código en D1", async () => {
  const { env, llamadas } = crearEnv();
  const cookie = sesion("ana");
  const { params } = peticionApp({ nombre: "Portátil de Ana", plataforma: "linux" });
  const { res, doc, enlaces, enlace, href, destino, meta, code, state, html } = await autorizar(env, cookie, params);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(llamadas.length, 0);
  assert.equal(doc.documentElement.getAttribute("lang"), "es");
  assert.equal(texto(doc.querySelector("h1")), "Listo");

  // Destino fijo: esquema y host propios, sin ruta, y solo code y state.
  assert.equal(destino.protocol, ESQUEMA);
  assert.equal(destino.host, "auth");
  assert.equal(destino.pathname, "");
  assert.equal(destino.hash, "");
  assert.deepEqual([...destino.searchParams.keys()], ["code", "state"]);
  assert.equal(href, `vanttec-docs://auth?code=${code}&state=${params.state}`);
  assert.equal(state, params.state, "el state vuelve tal cual");
  assert.match(code, RE_CODIGO);

  // Un solo enlace en toda la página (visible, con texto), y la apertura automática sin JavaScript apunta al mismo sitio.
  assert.equal(enlaces.length, 1);
  assert.equal(doc.querySelectorAll("a[href]").length, 1, "la página «Listo» no lleva más enlaces");
  assert.equal(texto(enlace), "Abrir VantTec Docs");
  assert.ok(meta, 'falta <meta http-equiv="refresh"> para abrir la app sin JavaScript');
  const m = /^\s*(\d+)\s*;\s*url=(.+)$/i.exec(meta.getAttribute("content") ?? "");
  assert.ok(m, `content del refresh: ${meta.getAttribute("content")}`);
  assert.equal(m[2], href, "el refresh va exactamente al mismo destino que el enlace");
  assert.ok(Number(m[1]) <= 2, "se abre sin esperar");
  assert.equal(doc.querySelectorAll("meta[http-equiv]").length, 1);
  assert.equal(doc.querySelectorAll("form, script, iframe, object, embed, img, link, base").length, 0);
  assert.ok(!/javascript:/i.test(html));

  // En D1: una fila, con el hash del código y lo que se mostró en el consentimiento. El login es el de la sesión.
  assert.deepEqual(filasCodigos(env), [{ hash: sha256hex(code), login: "ana", challenge: params.challenge, nombre: "Portátil de Ana", plataforma: "linux", expira: T0 + 60_000 }]);
  assert.ok(!volcado(env).includes(code), "el código no se guarda en claro");

  // Con barra final también; cada envío crea un código distinto.
  const otra = peticionApp();
  const c = await consentir(env, cookie, otra.params);
  const res2 = await enviarAutorizar(env, { cookie, campos: c.campos, path: `${AUTORIZAR}/` });
  assert.equal(res2.status, 200);
  const listo2 = await leerListo(res2);
  assert.match(listo2.code ?? "", RE_CODIGO);
  assert.notEqual(listo2.code, code);
  assert.equal(filasCodigos(env).length, 2);
});

test("listo: el código solo va en el cuerpo — ni cabeceras, ni Location o Refresh, ni logs; no-store, no-referrer y sin enmarcar", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  let r;
  const salida = await conConsola(async () => {
    r = await autorizar(env, cookie, peticionApp().params);
  });
  const { res, code, doc, html } = r;
  assert.ok(!salida.includes(code) && !salida.includes(SECRET), "el código no se registra");
  for (const [k, v] of res.headers) assert.ok(!v.includes(code), `el código no va en la cabecera ${k}`);
  assert.equal(res.headers.get("location"), null);
  assert.equal(res.headers.get("refresh"), null, "la apertura automática va en el HTML, no en una cabecera");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", "la página «Listo» no lleva formulario: no-referrer");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  const csp = directivasCsp(res);
  assert.equal(csp["default-src"], "'none'");
  assert.equal(csp["frame-ancestors"], "'none'");
  assert.ok(!("script-src" in csp) && !("navigate-to" in csp));
  assert.ok(!/vanttec-docs/i.test(res.headers.get("content-security-policy")), "abrir el esquema no exige ampliar la CSP");
  assert.ok(Object.entries(csp).every(([k, v]) => k === "style-src" || !/unsafe/.test(v)));
  for (const el of doc.querySelectorAll("*")) {
    for (const at of el.attributes) assert.ok(!/^on/i.test(at.name), `atributo ${at.name} en <${el.tagName.toLowerCase()}>`);
  }
  // El código aparece solo dentro del destino (enlace y refresh): dos veces, ninguna más.
  assert.equal(html.split(code).length - 1, 2, "el código no se repite fuera del enlace y del refresh");
  assert.ok(!html.includes(SECRET) && !html.includes(decodeURIComponent(cookie.split("=")[1]).split(".")[1]));
});

// ---------- Criterio 7: extremo a extremo con el canje del lote 1A ----------

test("extremo a extremo: el código de «Listo» se canjea con el verifier de la app; un solo uso, 60 s, y el token queda con lo consentido", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const app = peticionApp({ nombre: "PC de Ana", plataforma: "windows" });
  const { code } = await autorizar(env, cookie, app.params);

  // El nombre y la plataforma que mande el canje no pisan los del consentimiento (regla del 1A).
  const res = await canje(env, { code, verifier: app.verifier, nombre: "Otro nombre", plataforma: "ios" });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.token, RE_TOKEN);
  assert.equal(json.login, "ana");
  assert.equal((await (await pedir("/auth/me", { env, bearer: json.token })).json()).login, "ana");
  const lista = await dispositivos(env, "ana");
  assert.deepEqual(lista.map((d) => [d.nombre, d.plataforma, d.login]), [["PC de Ana", "windows", "ana"]]);
  assert.equal(filasCodigos(env).length, 0, "el canje consume el código");
  assert.equal((await canje(env, { code, verifier: app.verifier })).status, 400, "un solo uso");
  // Y aparece en la página de dispositivos de esa sesión.
  assert.equal((await paginaCon(env, cookie, 1)).filas.length, 1);

  // Sin el verifier de la app el código no sirve (quien intercepte el deep link no puede canjearlo).
  const b = peticionApp();
  const robado = await autorizar(env, cookie, b.params);
  assert.equal((await canje(env, { code: robado.code, verifier: peticionApp().verifier })).status, 400);
  assert.equal((await canje(env, { code: robado.code, verifier: b.verifier })).status, 400, "el intento fallido lo quemó");

  // Caduca a los 60 s.
  const c = peticionApp();
  const tarde = await autorizar(env, cookie, c.params);
  mock.timers.tick(60_000);
  assert.equal((await canje(env, { code: tarde.code, verifier: c.verifier })).status, 400);
  assert.equal(filasTokens(env).length, 1, "solo el primer flujo dejó un token");
});

test("extremo a extremo: el Origin que un navegador deduce de la página de consentimiento es el del Worker, y con él «Autorizar» emite", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const { res, form, campos } = await consentir(env, cookie, peticionApp().params);
  const destino = new URL(form.getAttribute("action"), `${ORIGIN}${INICIAR}`).href;
  assert.equal(destino, `${ORIGIN}${AUTORIZAR}`);
  const origin = origenDeNavegador(res.headers.get("referrer-policy"), ORIGIN, destino);
  assert.equal(origin, ORIGIN, "con la Referrer-Policy del consentimiento el navegador debe enviar el Origin real y no «null»");
  const post = await enviarAutorizar(env, { cookie, campos, headers: { "content-type": FORM["content-type"], origin } });
  assert.equal(post.status, 200);
  assert.match((await leerListo(post)).code ?? "", RE_CODIGO);
});

// ---------- Criterio 4: quién puede enviar el formulario ----------

test("autorizar: anti-CSRF ligado a la sesión, al propósito y a lo que se mostró → 403 y no se crea nada", async () => {
  const { env } = crearEnv();
  await emitir(env, { login: "ana" }); // un dispositivo, para que /auth/dispositivos traiga su propio csrf
  const cookieAna = sesion("ana");
  const a = peticionApp();
  const ana = await consentir(env, cookieAna, a.params);
  const csrf = ana.campos.csrf;
  const beto = await consentir(env, sesion("beto"), a.params);
  const otraPeticion = await consentir(env, cookieAna, peticionApp().params);
  const disp = await paginaCon(env, cookieAna, 1);
  mock.timers.tick(1000);
  const cookieAna2 = sesion("ana");
  const ana2 = await consentir(env, cookieAna2, a.params);
  const firmaCookie = decodeURIComponent(cookieAna.split("=")[1]).split(".")[1];

  assert.notEqual(beto.campos.csrf, csrf, "otro login, otro token");
  assert.notEqual(ana2.campos.csrf, csrf, "otra sesión del mismo login, otro token");
  assert.notEqual(disp.filas[0].csrf, csrf, "el propósito separa este formulario del de revocación");
  assert.notEqual(otraPeticion.campos.csrf, csrf, "el token va ligado también a lo que se mostró");

  const con = (cambios) => ({ ...ana.campos, ...cambios });
  const sinCsrf = { ...ana.campos };
  delete sinCsrf.csrf;
  const malos = [
    ["sin csrf", cookieAna, sinCsrf],
    ["csrf vacío", cookieAna, con({ csrf: "" })],
    ["csrf inventado", cookieAna, con({ csrf: "A".repeat(csrf.length) })],
    ["csrf recortado", cookieAna, con({ csrf: csrf.slice(0, -1) })],
    ["csrf con sufijo", cookieAna, con({ csrf: `${csrf}A` })],
    ["csrf de otro login", cookieAna, con({ csrf: beto.campos.csrf })],
    ["csrf de otra sesión del mismo login", cookieAna2, ana.campos],
    ["csrf de la página de dispositivos", cookieAna, con({ csrf: disp.filas[0].csrf })],
    ["la firma de la cookie como csrf", cookieAna, con({ csrf: firmaCookie })],
    // El caso que importa: un csrf legítimo de esta sesión no sirve para autorizar otra cosa que la que se vio.
    ["challenge distinto del mostrado", cookieAna, con({ challenge: peticionApp().params.challenge })],
    ["csrf de otro consentimiento de la misma sesión", cookieAna, con({ csrf: otraPeticion.campos.csrf })],
    ["nombre distinto del mostrado", cookieAna, con({ nombre: "Otro PC" })],
    ["plataforma distinta de la mostrada", cookieAna, con({ plataforma: "linux" })],
    ["state distinto del mostrado", cookieAna, con({ state: peticionApp().params.state })],
  ];
  for (const [que, cookie, campos] of malos) {
    const res = await enviarAutorizar(env, { cookie, campos });
    assert.equal(res.status, 403, que);
    await sinEmitir(res, que);
  }
  assert.equal(filasCodigos(env).length, 0, "ningún intento fallido crea un código");

  // Y al revés: el csrf del consentimiento no revoca dispositivos.
  const rev = await enviarRevocar(env, { cookie: cookieAna, campos: { id: disp.filas[0].id, csrf } });
  assert.equal(rev.status, 403);
  assert.equal(filasTokens(env).length, 1);

  // El formulario legítimo sigue funcionando después de todos los intentos (no hay estado que se queme).
  const ok = await enviarAutorizar(env, { cookie: cookieAna, campos: ana.campos });
  assert.equal(ok.status, 200);
  assert.equal(filasCodigos(env).length, 1);
});

test("autorizar: Origin propio obligatorio, solo POST, solo formulario urlencoded, cuerpo acotado y campos exactos", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const { campos } = await consentir(env, cookie, peticionApp().params);
  const ct = FORM["content-type"];
  const probar = async (que, estado, res) => {
    assert.equal(res.status, estado, que);
    await sinEmitir(res, que);
  };

  for (const origin of [undefined, "https://evil.example", "null", "NULL", `${ORIGIN}.evil.example`, ORIGIN.replace("https:", "http:"), "vanttec-docs://auth"]) {
    const headers = origin === undefined ? { "content-type": ct } : { "content-type": ct, origin };
    await probar(`Origin ${origin}`, 403, await enviarAutorizar(env, { cookie, campos, headers }));
  }
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await enviarAutorizar(env, { cookie, campos, method });
    await probar(method, 405, res);
    assert.equal(res.headers.get("allow"), "POST");
  }
  for (const tipo of ["application/json", "multipart/form-data; boundary=x", "text/plain"]) {
    const body = tipo === "application/json" ? JSON.stringify(campos) : new URLSearchParams(campos).toString();
    await probar(tipo, 415, await pedir(AUTORIZAR, { env, method: "POST", cookie, headers: { ...FORM, "content-type": tipo }, body }));
  }
  await probar("cuerpo de más de 2 KB", 413, await enviarAutorizar(env, { cookie, campos: { ...campos, relleno: "x".repeat(3000) } }));

  // Con el csrf válido, un campo de más no se ignora: 400. El login y el destino no se eligen desde el formulario.
  for (const [k, v] of [["login", "beto"], ["redirect_uri", "https://evil.example/"], ["next", "/x"], ["x", ""]]) {
    await probar(`sobra ${k}`, 400, await enviarAutorizar(env, { cookie, campos: { ...campos, [k]: v } }));
  }
  // Un campo repetido nunca emite (400, o 403 si el csrf deja de casar), ni con el valor legítimo delante ni detrás.
  const ajeno = peticionApp().params.challenge;
  for (const pares of [[...Object.entries(campos), ["challenge", ajeno]], [["challenge", ajeno], ...Object.entries(campos)], [...Object.entries(campos), ["csrf", campos.csrf]]]) {
    const res = await enviarAutorizar(env, { cookie, campos: pares });
    assert.ok([400, 403].includes(res.status), `campo repetido: ${res.status}`);
    await sinEmitir(res, "campo repetido");
  }
  assert.equal(filasCodigos(env).length, 0, "nada de lo anterior crea un código");
  assert.equal((await enviarAutorizar(env, { cookie, campos })).status, 200, "y el formulario bien enviado sigue funcionando");
});

test("autorizar: sin sesión válida → 401 con una página sin formulario, y no se emite nada", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const { campos } = await consentir(env, cookie, peticionApp().params);
  mock.timers.tick(1000);
  const casos = [
    ["sin cookie", undefined],
    ["cookie firmada con otro secreto", sesion("ana", "x".repeat(40))],
    ["cookie de otra persona", sesion("beto")],
  ];
  for (const [que, c] of casos.slice(0, 2)) {
    const res = await enviarAutorizar(env, { cookie: c, campos });
    assert.equal(res.status, 401, que);
    assert.match(res.headers.get("content-type") ?? "", /^text\/html/, que);
    await sinEmitir(res, que);
  }
  // Con la sesión de otra persona el csrf no casa: 403, y tampoco se emite a su nombre.
  const ajena = await enviarAutorizar(env, { cookie: casos[2][1], campos });
  assert.equal(ajena.status, 403);
  await sinEmitir(ajena, casos[2][0]);
  // Una sesión que caduca con el consentimiento abierto tampoco emite.
  mock.timers.tick(2 * 864e5);
  const caducada = await enviarAutorizar(env, { cookie, campos });
  assert.equal(caducada.status, 401);
  await sinEmitir(caducada, "sesión caducada");
  assert.equal(filasCodigos(env).length, 0);
});

// ---------- Criterio 5: tope de códigos vivos y fallos del almacén ----------

test("autorizar: como mucho 5 códigos vivos por login — el sexto da 429 con Retry-After y no crea nada", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const flujos = [];
  for (let i = 0; i < 5; i++) {
    const app = peticionApp();
    flujos.push({ app, ...(await autorizar(env, cookie, app.params)) });
    mock.timers.tick(1000);
  }
  assert.equal(filasCodigos(env).length, 5);

  const sexta = peticionApp();
  const c6 = await consentir(env, cookie, sexta.params);
  assert.equal(c6.res.status, 200, "el consentimiento se sigue viendo: el tope se aplica al emitir");
  const res = await enviarAutorizar(env, { cookie, campos: c6.campos });
  assert.equal(res.status, 429);
  const espera = Number(res.headers.get("retry-after"));
  assert.ok(Number.isInteger(espera) && espera >= 1 && espera <= 60, `Retry-After: ${res.headers.get("retry-after")}`);
  await sinEmitir(res, "sexto código");
  assert.equal(filasCodigos(env).length, 5);
  // Otra sesión del mismo login comparte el tope; otro login no.
  const cookie2 = sesion("ana");
  const c6b = await consentir(env, cookie2, sexta.params);
  assert.equal((await enviarAutorizar(env, { cookie: cookie2, campos: c6b.campos })).status, 429, "el tope es por login, no por sesión");
  await autorizar(env, sesion("beto"), peticionApp().params);
  assert.deepEqual(filasCodigos(env).map((f) => f.login).sort(), ["ana", "ana", "ana", "ana", "ana", "beto"]);

  // Canjear uno libera un hueco.
  assert.equal((await canje(env, { code: flujos[0].code, verifier: flujos[0].app.verifier })).status, 200);
  assert.equal((await enviarAutorizar(env, { cookie, campos: c6.campos })).status, 200);
  assert.equal((await enviarAutorizar(env, { cookie, campos: c6.campos })).status, 429, "y vuelve a estar lleno");

  // Los caducados no cuentan: pasado un minuto se puede volver a autorizar.
  mock.timers.tick(61_000);
  assert.equal((await enviarAutorizar(env, { cookie, campos: c6.campos })).status, 200);
});

test("autorizar: sin binding DB o con D1 caído → 503 sin detalles y sin enlace a la app", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const { params } = peticionApp();
  const { campos } = await consentir(env, cookie, params);
  const salida = await conConsola(async () => {
    for (const DB of [undefined, d1Roto()]) {
      // El consentimiento no necesita D1: se sigue viendo.
      assert.equal((await consentir({ ...env, DB }, cookie, params)).res.status, 200);
      const res = await enviarAutorizar({ ...env, DB }, { cookie, campos });
      assert.equal(res.status, 503);
      assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
      await sinEmitir(res, "D1 no disponible");
    }
  });
  assert.ok(!salida.includes(SECRET) && !salida.includes(campos.csrf));
  assert.equal(filasCodigos(env).length, 0);
  assert.equal((await enviarAutorizar(env, { cookie, campos })).status, 200, "con D1 de vuelta, el mismo formulario emite");
});
