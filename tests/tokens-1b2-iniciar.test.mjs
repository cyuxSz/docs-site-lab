// Lote 1B-2 de «tokens de dispositivo»: GET /auth/app/iniciar, la página de consentimiento que la app de escritorio
// abre en el navegador del sistema. Solo con cookie de sesión, sin JavaScript, y nunca crea nada: el código lo emite
// POST /auth/app/autorizar (tests/tokens-1b2-autorizar.test.mjs). Ver .factory/spec.md, criterios 1 a 3.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0,
  SECRET,
  INICIAR,
  AUTORIZAR,
  CAMPOS,
  FORM,
  crearEnv,
  pedir,
  emitir,
  sesion,
  peticionApp,
  urlIniciar,
  consentimiento,
  consentir,
  filasCodigos,
  directivasCsp,
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
const ASSET = "<h1>asset</h1>";

// ---------- Criterio 1: parámetros exactos ----------

test("iniciar: admite challenge, state, nombre y plataforma (una vez cada uno) en sus límites, también con barra final", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const validos = [
    ["los cuatro tal cual", {}],
    ["state de 22 caracteres", { state: "s".repeat(22) }],
    ["state de 128 caracteres", { state: "S-_9".repeat(32) }],
    ["nombre de 60 caracteres", { nombre: "ñ".repeat(60) }],
    ["nombre de 1 carácter", { nombre: "X" }],
    ...["windows", "macos", "linux", "android", "ios"].map((p) => [`plataforma ${p}`, { plataforma: p }]),
  ];
  for (const [que, extra] of validos) {
    const { params } = peticionApp(extra);
    const c = await consentimiento(env, cookie, params);
    assert.equal(c.res.status, 200, que);
    assert.ok(c.form, `${que}: debe traer el formulario`);
    for (const k of ["challenge", "state", "nombre", "plataforma"]) assert.equal(c.campos[k], params[k], `${que}: el campo oculto ${k} lleva el valor validado`);
  }
  // El orden de la query no importa, y la barra final tampoco.
  const { params } = peticionApp();
  const alReves = Object.entries(params).reverse();
  assert.equal((await consentimiento(env, cookie, alReves)).res.status, 200);
  assert.ok((await consentimiento(env, cookie, params, { path: `${INICIAR}/` })).form, "con barra final");
  // El nombre se recorta (trim) antes de mostrarlo y de ligarlo.
  const conEspacios = await consentir(env, cookie, { ...params, nombre: "  PC de Ana  " });
  assert.equal(conEspacios.campos.nombre, "PC de Ana");
  assert.equal(filasCodigos(env).length, 0, "abrir el consentimiento no crea ningún código");
});

test("iniciar: si falta, sobra, se repite o no cumple su forma algún parámetro → 400 sin formulario y sin reflejar la query", async () => {
  const { env, llamadas } = crearEnv();
  const cookie = sesion("ana");
  const { params } = peticionApp();
  const pares = (cambios = {}, quitar = []) => Object.entries({ ...params, ...cambios }).filter(([k]) => !quitar.includes(k));
  const MARCA = "zz9marca";

  const malos = [
    ...Object.keys(params).map((k) => [`falta ${k}`, pares({}, [k])]),
    ["sin query", []],
    ["challenge de 42", pares({ challenge: "A".repeat(42) })],
    ["challenge de 44", pares({ challenge: "A".repeat(44) })],
    ["challenge base64 clásico", pares({ challenge: `${"A".repeat(41)}+/` })],
    ["challenge con relleno", pares({ challenge: `${"A".repeat(42)}=` })],
    ["challenge vacío", pares({ challenge: "" })],
    ["state de 21", pares({ state: "s".repeat(21) })],
    ["state de 129", pares({ state: "s".repeat(129) })],
    ["state con punto", pares({ state: `${"s".repeat(30)}.x` })],
    ["state con espacio", pares({ state: `${"s".repeat(30)} x` })],
    ["state con marcado", pares({ state: `${"s".repeat(30)}"><b id=${MARCA}>` })],
    ["state vacío", pares({ state: "" })],
    ["nombre vacío", pares({ nombre: "" })],
    ["nombre solo espacios", pares({ nombre: "   " })],
    ["nombre de 61", pares({ nombre: "x".repeat(61) })],
    ["nombre con salto de línea", pares({ nombre: `PC\n${MARCA}` })],
    ["nombre con NUL", pares({ nombre: `PC\u0000${MARCA}` })],
    ["nombre con marca de dirección", pares({ nombre: `PC‮${MARCA}` })],
    ["plataforma con mayúscula", pares({ plataforma: "Windows" })],
    ["plataforma abreviada", pares({ plataforma: "win" })],
    ["plataforma desconocida", pares({ plataforma: `beos${MARCA}` })],
    ["plataforma vacía", pares({ plataforma: "" })],
    ["sobra redirect_uri", [...pares(), ["redirect_uri", `https://evil.example/${MARCA}`]]],
    ["sobra code_challenge_method", [...pares(), ["code_challenge_method", "S256"]]],
    ["sobra next", [...pares(), ["next", `/${MARCA}`]]],
    ["sobra login", [...pares(), ["login", "beto"]]],
    ["sobra uno vacío", [...pares(), [MARCA, ""]]],
    ...Object.keys(params).map((k) => [`${k} repetido`, [...pares(), [k, params[k]]]]),
    ["challenge repetido con otro valor", [["challenge", peticionApp().params.challenge], ...pares()]],
  ];
  for (const [que, lista] of malos) {
    const res = await pedir(lista.length ? urlIniciar(lista) : INICIAR, { env, cookie });
    assert.equal(res.status, 400, que);
    assert.match(res.headers.get("content-type") ?? "", /^text\/html/, que);
    assert.equal(res.headers.get("x-frame-options"), "DENY", que);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, que);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", `${que}: una página sin formulario conserva no-referrer`);
    assert.equal(res.headers.get("location"), null, que);
    const html = await res.text();
    assert.ok(!/<form\b/i.test(html), `${que}: sin formulario`);
    assert.ok(!html.includes(MARCA) && !html.includes("evil.example"), `${que}: nada de la query aparece en la página`);
    assert.ok(!html.includes("vanttec-docs:"), que);
  }
  assert.equal(llamadas.length, 0, "ninguna cae en ASSETS");
  assert.equal(filasCodigos(env).length, 0);
});

// ---------- Criterio 2: sesión, método y Bearer ----------

test("iniciar: sin sesión redirige al login con un next reconstruido, y al volver se ve el mismo consentimiento", async () => {
  const { env } = crearEnv();
  // 60 caracteres que ocupan 9 bytes cada uno ya codificados: el peor caso para la cookie oauth_state.
  const { params } = peticionApp({ nombre: "電".repeat(60), state: "s".repeat(128) });
  const sinSesion = [undefined, sesion("ana", "x".repeat(40))];
  const vieja = sesion("ana");
  let next;
  for (const cookie of sinSesion) {
    const res = await pedir(urlIniciar(params), { env, cookie });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("set-cookie"), null);
    const destino = new URL(res.headers.get("location"), "https://x");
    assert.equal(destino.pathname, "/auth/login");
    next = destino.searchParams.get("next");
    assert.ok(next.startsWith(`${INICIAR}?`), `next vuelve al consentimiento: ${next}`);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(next.slice(INICIAR.length + 1))), params, "next lleva exactamente los cuatro parámetros validados");

    // /auth/login acepta ese next (safeTarget) y lo guarda en una cookie que cabe en el límite del navegador.
    const login = await pedir(`${destino.pathname}${destino.search}`, { env });
    assert.equal(login.status, 302);
    const cookieEstado = login.headers.get("set-cookie") ?? "";
    assert.ok(cookieEstado.length < 4096, `la cookie oauth_state pesa ${cookieEstado.length} bytes`);
    const pendiente = JSON.parse(decodeURIComponent(/oauth_state=([^;]*)/.exec(cookieEstado)[1]));
    assert.equal(pendiente.back, next, "el login vuelve al consentimiento, no al portal");
  }
  mock.timers.tick(2 * 864e5);
  assert.equal((await pedir(urlIniciar(params), { env, cookie: vieja })).status, 302, "una sesión caducada tampoco entra");

  // Con sesión, el destino del login muestra el consentimiento con los mismos datos.
  const res = await pedir(next, { env, cookie: sesion("ana") });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes(ASSET), "/auth/app/iniciar no debe caer en ASSETS: la página la pinta el Worker");
  assert.ok(html.includes(params.nombre));
  assert.match(html, /¿Autorizar esta app\?/);
  assert.equal(filasCodigos(env).length, 0);
});

test("iniciar: la validación va antes que la sesión — un enlace roto da 400 sin pasar por el login", async () => {
  const { env } = crearEnv();
  const { params } = peticionApp();
  for (const lista of [{ ...params, plataforma: "beos" }, { ...params, extra: "1" }, { challenge: params.challenge }]) {
    const res = await pedir(urlIniciar(lista), { env });
    assert.equal(res.status, 400);
    assert.equal(res.headers.get("location"), null, "no se redirige al login con una query que no vale");
    assert.equal(res.headers.get("set-cookie"), null);
    assert.ok(!/<form\b/i.test(await res.text()));
  }
});

test("iniciar: solo GET; con un Bearer válido las dos rutas responden 400 JSON; ningún GET crea un código", async () => {
  const { env, llamadas } = crearEnv();
  const cookie = sesion("ana");
  const { params } = peticionApp();
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await pedir(urlIniciar(params), { env, method, cookie, headers: FORM, body: method === "POST" ? "x=1" : undefined });
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get("allow") ?? "", /\bGET\b/, method);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", method);
    assert.ok(!/<form\b/i.test(await res.text()), method);
  }

  const { token } = await emitir(env, { login: "ana" });
  const casos = [
    [urlIniciar(params), "GET"],
    [urlIniciar(params, `${INICIAR}/`), "GET"],
    [AUTORIZAR, "POST"],
    [`${AUTORIZAR}/`, "POST"],
  ];
  for (const [path, method] of casos) {
    const res = await pedir(path, { env, method, bearer: token, headers: method === "POST" ? FORM : {}, body: method === "POST" ? new URLSearchParams(params).toString() : undefined });
    assert.equal(res.status, 400, `${method} ${path} con Bearer`);
    assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await res.json(), { error: "Ruta solo para navegador" });
    assert.equal(res.headers.get("set-cookie"), null);
    assert.equal(res.headers.get("location"), null);
    // Cookie y Bearer a la vez: el 400 del lote 1A, tampoco HTML.
    const ambos = await pedir(path, { env, method, bearer: token, cookie, headers: method === "POST" ? FORM : {}, body: method === "POST" ? "x=1" : undefined });
    assert.equal(ambos.status, 400);
    assert.match(ambos.headers.get("content-type") ?? "", /^application\/json/);
  }

  // GET no autoriza nunca: ni repetido, ni con el nombre de la otra ruta, ni con campos del formulario en la query.
  for (let i = 0; i < 3; i++) assert.equal((await pedir(urlIniciar(params), { env, cookie })).status, 200);
  const { campos } = await consentir(env, cookie, params);
  assert.equal((await pedir(`${AUTORIZAR}?${new URLSearchParams(campos)}`, { env, cookie })).status, 405, "GET /auth/app/autorizar no emite");
  assert.equal(filasCodigos(env).length, 0, "solo el POST del formulario crea códigos");
  assert.equal(llamadas.length, 0);
});

// ---------- Criterio 3: la página de consentimiento ----------

test("consentimiento: título, textos, formulario y enlaces de la propuesta, y nada más", async () => {
  const { env, llamadas } = crearEnv();
  const cookie = sesion("ana");
  const { params } = peticionApp({ nombre: "PC de Ana", plataforma: "macos" });
  const { res, html, doc, form, campos, boton } = await consentir(env, cookie, params);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(llamadas.length, 0);
  assert.equal(doc.documentElement.getAttribute("lang"), "es");
  assert.equal(texto(doc.querySelector("h1")), "¿Autorizar esta app?");
  assert.match(doc.title, /Autorizar/);

  const cuerpo = texto(doc.body);
  assert.match(cuerpo, /VantTec Docs en «PC de Ana» \(macOS\) quiere entrar como @?ana\b/, cuerpo);
  assert.ok(cuerpo.includes("El acceso dura 30 días. Puedes quitarlo cuando quieras en Dispositivos"), cuerpo);
  assert.ok(!cuerpo.includes("macos"), "la plataforma se pinta con su etiqueta, no con el valor de la query");

  // Un solo formulario: POST a /auth/app/autorizar, con los cuatro datos y el csrf ocultos, y el botón «Autorizar».
  assert.equal(doc.querySelectorAll("form").length, 1);
  assert.equal(form.getAttribute("method").toLowerCase(), "post");
  assert.equal(form.getAttribute("action"), AUTORIZAR, "el destino del formulario es fijo");
  assert.deepEqual(Object.keys(campos).sort(), CAMPOS);
  for (const i of form.querySelectorAll("input")) assert.equal(i.getAttribute("type"), "hidden", `campo ${i.getAttribute("name")}`);
  assert.deepEqual({ ...campos, csrf: undefined }, { ...params, csrf: undefined });
  assert.match(campos.csrf, /^[A-Za-z0-9_-]{32,128}$/);
  assert.equal(doc.querySelectorAll("button, input[type=submit]").length, 1);
  assert.equal(texto(boton), "Autorizar");
  assert.equal(boton.getAttribute("type") ?? "submit", "submit");
  assert.ok(!boton.hasAttribute("autofocus"), "el botón no toma el foco solo: Enter al cargar la página no autoriza");

  // Dos enlaces y solo dos: «Dispositivos» y «Cancelar» (vuelve al portal sin crear nada).
  const enlaces = [...doc.querySelectorAll("a[href]")].map((a) => [texto(a), a.getAttribute("href")]);
  assert.deepEqual(enlaces.sort(), [["Cancelar", "/"], ["Dispositivos", "/auth/dispositivos"]]);
  const cancelar = await pedir("/", { env, cookie });
  assert.equal(cancelar.status, 200);
  assert.equal(filasCodigos(env).length, 0, "«Cancelar» es un enlace al portal: no crea ningún código");

  // Sin secretos: ni el SESSION_SECRET, ni la cookie, ni su firma.
  const [cuerpoCookie, firmaCookie] = decodeURIComponent(cookie.split("=")[1]).split(".");
  for (const secreto of [SECRET, cuerpoCookie, firmaCookie]) assert.ok(!html.includes(secreto), "la página no contiene secretos de la sesión");
  assert.ok(campos.csrf !== firmaCookie && !campos.csrf.includes(firmaCookie));
});

test("consentimiento: cabeceras contra clickjacking y caché, Referrer-Policy same-origin, CSP sin scripts y form-action 'self'", async () => {
  const { env } = crearEnv();
  const { params } = peticionApp();
  for (const path of [INICIAR, `${INICIAR}/`]) {
    const { res, doc, html } = await consentir(env, sesion("ana"), params, { path });
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    // La página lleva un formulario hacia una ruta que exige Origin: con no-referrer el navegador enviaría `Origin: null`.
    assert.equal(res.headers.get("referrer-policy"), "same-origin");
    assert.equal(res.headers.get("set-cookie"), null);
    const csp = directivasCsp(res);
    assert.equal(csp["default-src"], "'none'");
    assert.equal(csp["frame-ancestors"], "'none'");
    assert.equal(csp["form-action"], "'self'", "el formulario solo puede ir al propio origen: el esquema de la app no entra en form-action");
    assert.ok(!("script-src" in csp) && !("navigate-to" in csp));
    assert.ok(Object.entries(csp).every(([k, v]) => k === "style-src" || !/unsafe/.test(v)));

    assert.equal(doc.querySelectorAll("script, iframe, object, embed, img, link, base, meta[http-equiv]").length, 0);
    for (const el of doc.querySelectorAll("*")) {
      for (const at of el.attributes) assert.ok(!/^on/i.test(at.name), `atributo ${at.name} en <${el.tagName.toLowerCase()}>`);
    }
    assert.ok(!/javascript:|vanttec-docs:/i.test(html), "el consentimiento no enlaza todavía al esquema de la app");
    assert.ok(!/name=["']?referrer|referrerpolicy/i.test(html));
  }
});

test("consentimiento: el nombre del dispositivo es entrada no confiable y sale escapado, en el texto y en el campo oculto", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  const nombres = [`<img src=x onerror=alert(1)>"'&</p><script>`, `" autofocus onfocus="alert(2)`, `'><form action=//evil.example><button>`, "«PC» & <b>negrita</b>"];
  for (const nombre of nombres) {
    const { params } = peticionApp({ nombre });
    const { doc, html, form, campos, boton } = await consentir(env, cookie, params);
    assert.equal(doc.querySelectorAll("script, img, b, [autofocus], [onfocus], [onerror]").length, 0, nombre);
    assert.equal(doc.querySelectorAll("form").length, 1, `${nombre}: el marcado inyectado no añade formularios`);
    assert.equal(doc.querySelectorAll("button").length, 1, nombre);
    assert.equal(form.getAttribute("action"), AUTORIZAR);
    assert.ok(!html.includes("<img") && !html.includes("<script>") && !html.includes("evil.example><"), nombre);
    assert.ok(texto(doc.body).includes(nombre), `${nombre}: se ve tal cual, como texto`);
    assert.equal(campos.nombre, nombre, "el campo oculto lleva el nombre íntegro, escapado como atributo");
    assert.deepEqual(Object.keys(campos).sort(), CAMPOS);
    for (const at of boton.attributes) assert.ok(["type", "class"].includes(at.name), `atributo inesperado en el botón: ${at.name}`);
  }
  // El login de la sesión también pasa por esc() (viene de GitHub, pero se pinta igual que cualquier dato externo).
  const raro = await consentimiento(env, sesion(`ana"><i id="lx">`), peticionApp().params);
  assert.equal(raro.doc.querySelectorAll("#lx").length, 0);
});
