// Lote G2 «emisión de tokens de subida»: POST /auth/dispositivos/token (solo con la cookie de sesión). Crea un token
// `vts_…` y lo muestra una sola vez en la propia respuesta. Ver .factory/spec.md, criterios 3 a 7, 9 y 10.
// Los envíos llevan solo lo que manda un navegador al enviar un formulario: cookie, Content-Type y Origin.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import PROYECTOS_REALES from "../projects.json" with { type: "json" };
import { DEMO } from "./fixtures/acceso-demo.mjs";
import {
  T0,
  DIA,
  TREINTA_DIAS,
  SECRET,
  ORIGIN,
  PAGINA,
  CREAR,
  API_LISTA,
  FORM,
  MAX_SUBIDA,
  VENTANA_LOGIN,
  EDITOR,
  RE_TOKEN_SUBIDA,
  RE_VTS,
  crearEnv,
  cargarCore,
  pedir,
  emitir,
  dispositivos,
  sesion,
  sesionCon,
  sesionSinIat,
  sha256hex,
  insertarToken,
  filaToken,
  filasSubida,
  paginaSubida,
  enviarCrear,
  enviarRevocar,
  leerCreado,
  crearToken,
  origenDeNavegador,
  directivasCsp,
  esDenegada,
  peticionApp,
  urlIniciar,
  d1Roto,
  volcado,
  conConsola,
  texto,
} from "./fixtures/subida-2.mjs";
import { csrfToken } from "../lib/dispositivos-paginas.mjs";

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

const TOPE = "Tienes 5 tokens de subida, el máximo. Revoca uno para crear otro.";
const LOGIN_DE_NUEVO = `/auth/login?next=${encodeURIComponent(PAGINA)}`;
const CT = FORM["content-type"];
const vivo = async (env, token) => (await pedir("/auth/me", { env, bearer: token })).status === 200;

// Formulario de creación recién pintado para esa cookie: { id, csrf, nombre }.
async function formulario(env, cookie, nombre = "CLI de prueba") {
  const p = await paginaSubida(env, cookie);
  assert.ok(p.crear, `la página debe traer el formulario de creación (action=${CREAR})`);
  return { ...p.campos, nombre };
}

// Una respuesta de la ruta que no crea nada: HTML de error del login, sin token, sin formulario y sin caché.
async function esRechazo(res, estado, que) {
  assert.equal(res.status, estado, que);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/, `${que}: HTML`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${que}: no-store`);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", `${que}: sin formulario, no-referrer`);
  assert.equal(res.headers.get("x-frame-options"), "DENY", que);
  assert.equal(res.headers.get("set-cookie"), null, `${que}: la cookie no se toca`);
  const html = await res.text();
  assert.equal(html.match(RE_VTS), null, `${que}: ningún token en un rechazo`);
  assert.ok(!/<form\b|<script\b/i.test(html), `${que}: sin formularios ni scripts`);
  assert.ok(!/D1_ERROR|secreta/.test(html), `${que}: sin detalles internos`);
  return html;
}

// ---------- Criterio 4: la fila y el token ----------

test("emisión: crea una fila de tipo subida para el login de la sesión, con 30 días de vida, y el token funciona como en G1", async () => {
  const { env, llamadas } = crearEnv();
  const cookie = sesion(EDITOR);
  const pagina = await paginaSubida(env, cookie);
  // El Origin lo deduce el navegador de la Referrer-Policy con la que se sirvió la página del formulario.
  const origin = origenDeNavegador(pagina.res.headers.get("referrer-policy"), ORIGIN, `${ORIGIN}${CREAR}`);
  assert.ok(pagina.crear, `la página debe traer el formulario de creación (action=${CREAR})`);
  const res = await enviarCrear(env, { cookie, campos: { ...pagina.campos, nombre: "  CLI del taller  " }, headers: { "content-type": CT, origin } });
  assert.equal(res.status, 200);
  const { token, vistos } = await leerCreado(res);
  assert.equal(vistos.length, 1);
  assert.match(token, RE_TOKEN_SUBIDA, "vts_ más 43 caracteres base64url");
  assert.equal(llamadas.length, 0, "la ruta no cae en ASSETS");

  // La fila: lo que G1 exige para aceptarla, y nada del formulario salvo el nombre (recortado) y el id.
  const filas = filasSubida(env);
  assert.equal(filas.length, 1);
  assert.deepEqual(filas[0], {
    id: pagina.campos.id,
    hash: sha256hex(token),
    login: EDITOR,
    nombre: "CLI del taller",
    plataforma: "cli",
    tipo: "subida",
    alcance: "subida",
    creado: T0,
    ultimo_uso: null,
    expira: T0 + TREINTA_DIAS,
  });
  assert.ok(!volcado(env).includes(token), "en D1 solo queda el hash");

  // Vale lo que vale un token de subida: la lista blanca sí, el resto 403 de la puerta.
  const me = await pedir("/auth/me", { env, bearer: token });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { login: EDITOR });
  assert.equal((await pedir("/api/archivos/?capacidades=1", { env, bearer: token })).status, 200);
  await esDenegada(await pedir("/uuv/", { env, bearer: token }), "GET /uuv/ con el token recién creado");

  // Caduca a los 30 días, sin renovación.
  mock.timers.tick(TREINTA_DIAS - 1);
  assert.equal(await vivo(env, token), true);
  mock.timers.tick(1);
  assert.equal(await vivo(env, token), false);
});

test("emisión: el nombre sigue las reglas del nombre de un dispositivo (1 a 60 caracteres tras recortar, sin controles)", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const malos = [
    ["vacío", ""],
    ["solo espacios", "   "],
    ["61 caracteres", "a".repeat(61)],
    ["carácter nulo", "a\u0000b"],
    ["salto de línea", "a\nb"],
    ["marca de dirección", "a‮b"],
  ];
  for (const [que, nombre] of malos) {
    const html = await esRechazo(await enviarCrear(env, { cookie, campos: await formulario(env, cookie, nombre) }), 400, `nombre ${que}`);
    assert.match(html, /Escribe un nombre de 1 a 60 caracteres\./, `nombre ${que}: dice qué se espera`);
    assert.match(html, new RegExp(`href="${PAGINA}"`), `nombre ${que}: enlace de vuelta`);
  }
  const { id, csrf } = await formulario(env, cookie);
  await esRechazo(await enviarCrear(env, { cookie, campos: { id, csrf } }), 400, "sin campo nombre");
  assert.equal(filasSubida(env).length, 0, "un nombre inválido no crea nada");

  // Un error de validación no gasta el formulario: el mismo, con un nombre bueno, sí crea.
  const campos = await formulario(env, cookie, "");
  await esRechazo(await enviarCrear(env, { cookie, campos }), 400, "primero vacío");
  assert.equal((await enviarCrear(env, { cookie, campos: { ...campos, nombre: "a".repeat(60) } })).status, 200, "60 caracteres valen");
  await crearToken(env, cookie, "Ñandú 🚀 del taller");
  assert.deepEqual(filasSubida(env).map((f) => f.nombre).sort(), ["a".repeat(60), "Ñandú 🚀 del taller"].sort());
});

// ---------- Criterio 5: se muestra una sola vez ----------

test("una vez: el token va solo en el cuerpo de la respuesta 200 — ni Location, ni cabeceras, ni logs; no-store y no-referrer", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const nombre = `</textarea><script>alert(1)</script><b id="nx">"&'`;
  let creado;
  const salida = await conConsola(async () => {
    creado = await crearToken(env, cookie, nombre);
  });
  const { res, html, doc, token, control } = creado;
  assert.ok(!salida.includes(token) && !/vts_/.test(salida), "el token no se registra");
  assert.ok(!salida.includes(SECRET));

  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, "la página del token no se guarda en caché ni en el historial");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", "sin formulario: no-referrer");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("location"), null, "respuesta directa del POST: sin redirección");
  assert.equal(res.headers.get("refresh"), null);
  assert.equal(res.headers.get("set-cookie"), null);
  for (const [k, v] of res.headers) assert.ok(!v.includes(token) && !/vts_/.test(v), `el token no va en la cabecera ${k}`);
  const csp = directivasCsp(res);
  assert.equal(csp["default-src"], "'none'");
  assert.equal(csp["frame-ancestors"], "'none'");
  assert.ok(!("script-src" in csp));

  // Sin JavaScript: texto seleccionable en un control de solo lectura con etiqueta, alcanzable con el teclado.
  assert.equal(texto(doc.querySelector("h1")), "Token creado");
  assert.ok(!doc.title.includes("vts_"), "el título de la pestaña no lleva el token");
  assert.ok(control, "falta <textarea readonly> con el token");
  assert.equal(control.value.trim(), token);
  assert.equal(control.value, token, "sin espacios ni saltos alrededor: se copia tal cual");
  assert.ok(!control.hasAttribute("disabled"), "readonly, no disabled: se puede enfocar y seleccionar");
  assert.equal(control.getAttribute("autocomplete"), "off");
  assert.equal(control.getAttribute("spellcheck"), "false");
  assert.ok(control.id && doc.querySelector(`label[for="${control.id}"]`), "el control lleva etiqueta");
  assert.ok(texto(doc.body).includes("Cópialo ahora. No se volverá a mostrar."), "aviso corto de que no se volverá a mostrar");
  assert.ok(texto(doc.body).includes("Caduca el 21 dic 2026."), "dice cuándo caduca");
  assert.equal(doc.querySelectorAll("script, form, button, iframe, img, link, base, meta[http-equiv], #nx, [autofocus]").length, 0);
  assert.ok(texto(doc.body).includes(nombre), "el nombre se ve tal cual, como texto");
  const enlaces = [...doc.querySelectorAll("a[href]")];
  assert.deepEqual(enlaces.map((a) => [a.getAttribute("href"), texto(a)]), [[PAGINA, "Volver a Dispositivos"]]);

  // Después no hay forma de volver a verlo: ni en la página, ni en la API de la app.
  const lista = await paginaSubida(env, cookie);
  assert.equal(lista.tokens.length, 1);
  assert.ok(!lista.html.includes(token) && lista.html.match(RE_VTS) === null);
  assert.equal((await pedir(CREAR, { env, cookie })).status, 405, "GET a la ruta no muestra nada");
});

// ---------- Criterio 6: recargar no crea otro ----------

test("reenvío: recargar la respuesta (el mismo formulario otra vez) responde 409 y no crea otro token", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const { token, campos } = await crearToken(env, cookie, "CLI del taller");

  for (const nombre of ["CLI del taller", "Otro nombre"]) {
    const html = await esRechazo(await enviarCrear(env, { cookie, campos: { ...campos, nombre } }), 409, `reenvío con nombre «${nombre}»`);
    assert.match(html, /El token solo se muestra una vez\. Si no lo copiaste, revócalo y crea otro\./);
    assert.match(html, new RegExp(`href="${PAGINA}"`));
  }
  assert.equal(filasSubida(env).length, 1, "sigue habiendo un solo token");
  assert.equal(await vivo(env, token), true, "el reenvío no toca el token ya creado");

  // Dos envíos simultáneos del mismo formulario (doble clic): uno crea, el otro no.
  const doble = await formulario(env, cookie, "Doble clic");
  const respuestas = await Promise.all([enviarCrear(env, { cookie, campos: doble }), enviarCrear(env, { cookie, campos: doble })]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409]);
  assert.equal(filasSubida(env).length, 2);

  // Para crear otro hay que volver a la página: cada vez que se pinta trae un formulario nuevo.
  await crearToken(env, cookie, "Tercero");
  assert.equal(filasSubida(env).length, 3);
});

// ---------- Criterio 3: protecciones de la ruta ----------

test("protecciones: sin sesión → login; solo POST; Origin propio; urlencoded de 1024 bytes como mucho; nada de eso crea un token", async () => {
  const { env, llamadas } = crearEnv();
  const cookie = sesion(EDITOR);
  const campos = await formulario(env, cookie);

  // Sin sesión (o con una que no vale) se va al login, de vuelta a la página y no a la ruta del POST.
  for (const [que, c] of [["sin cookie", undefined], ["cookie de otro secreto", sesion(EDITOR, "x".repeat(40))]]) {
    for (const path of [CREAR, `${CREAR}/`]) {
      const res = await enviarCrear(env, { cookie: c, campos, path });
      assert.equal(res.status, 302, `${que} ${path}`);
      assert.equal(res.headers.get("location"), LOGIN_DE_NUEVO, `${que} ${path}`);
    }
  }
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await enviarCrear(env, { cookie, campos, method });
    await esRechazo(res.clone(), 405, method);
    assert.equal(res.headers.get("allow"), "POST", method);
  }
  for (const [que, headers] of [
    ["sin Origin", { "content-type": CT }],
    ["Origin null", { "content-type": CT, origin: "null" }],
    ["Origin ajeno", { "content-type": CT, origin: "https://evil.example" }],
    ["Origin de otro puerto", { "content-type": CT, origin: `${ORIGIN}:8443` }],
  ]) {
    await esRechazo(await enviarCrear(env, { cookie, campos, headers }), 403, que);
  }
  for (const ct of ["text/plain", "multipart/form-data; boundary=x", "application/json"]) {
    await esRechazo(await enviarCrear(env, { cookie, campos, headers: { ...FORM, "content-type": ct } }), 415, ct);
  }
  await esRechazo(await enviarCrear(env, { cookie, campos: { ...campos, relleno: "x".repeat(2000) } }), 413, "cuerpo de más de 1024 bytes");

  // Sin binding o con D1 caído: 503 sin detalles.
  for (const DB of [undefined, d1Roto()]) {
    await esRechazo(await enviarCrear({ ...env, DB }, { cookie, campos }), 503, DB ? "D1 caído" : "sin binding DB");
  }

  assert.equal(filasSubida(env).length, 0, "ninguna de esas peticiones crea un token");
  assert.equal(llamadas.length, 0, "ninguna cae en ASSETS");
  // Y ninguna gastó el formulario: enviado bien, crea.
  assert.equal((await enviarCrear(env, { cookie, campos })).status, 200);
});

test("protecciones: anti-CSRF propio, ligado a la sesión y al id del formulario; no vale el de «Revocar» ni al revés", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const previo = insertarToken(env, { login: EDITOR, nombre: "Ya existía" });
  const p = await paginaSubida(env, cookie);
  assert.ok(p.crear, `la página debe traer el formulario de creación (action=${CREAR})`);
  const campos = { ...p.campos, nombre: "CLI de prueba" };
  const revocar = p.tokens[0];
  assert.notEqual(campos.csrf, revocar.csrf, "cada formulario lleva su propio token");

  const otraCookie = sesionCon(EDITOR, { iat: Date.now() - 1000 });
  const otra = await formulario(env, otraCookie);
  const otroId = (await formulario(env, cookie)).id;
  const casos = [
    ["sin csrf", { id: campos.id, nombre: campos.nombre }],
    ["csrf vacío", { ...campos, csrf: "" }],
    ["csrf inventado", { ...campos, csrf: "A".repeat(43) }],
    ["csrf del formulario de revocación", { ...campos, csrf: revocar.csrf }],
    ["csrf de otra sesión del mismo login", { ...campos, csrf: otra.csrf }],
    ["formulario entero de otra sesión", otra],
    ["id cambiado por otro bien formado", { ...campos, id: otroId }],
    ["id cambiado por el de un token que ya existe", { ...campos, id: previo.id }],
    ["sin id", { csrf: campos.csrf, nombre: campos.nombre }],
  ];
  for (const [que, c] of casos) await esRechazo(await enviarCrear(env, { cookie, campos: c }), 403, que);
  assert.equal(filasSubida(env).length, 1, "ningún token nuevo");

  // Al revés: el csrf de creación no revoca nada.
  const post = await enviarRevocar(env, { cookie, campos: { id: previo.id, csrf: campos.csrf } });
  assert.equal(post.status, 403);
  assert.ok(filaToken(env, previo.id), "el token sigue vivo");

  // Quien no es editor no recibe formulario; un envío sin él no pasa del anti-CSRF y no crea nada.
  for (const login of ["carla", "ana"]) {
    const res = await enviarCrear(env, { cookie: sesion(login), campos });
    assert.equal(res.status, 403, login);
    assert.equal(filasSubida(env, login).length, 0, login);
  }
});

test("protecciones: login reciente — con la sesión de hace más de 10 minutos responde 401 con enlace al login y no crea nada", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const campos = await formulario(env, cookie);

  // La ventana se mide también al enviar: el formulario se pintó dentro y se envía fuera.
  mock.timers.tick(VENTANA_LOGIN + 1);
  const res = await enviarCrear(env, { cookie, campos });
  const html = await esRechazo(res.clone(), 401, "sesión de hace 10 minutos y 1 ms");
  assert.ok(html.includes(`href="${LOGIN_DE_NUEVO}"`), "enlace al login, de vuelta a la página");
  assert.ok(texto(new JSDOM(html).window.document.querySelector("main")).includes("Para crear un token, inicia sesión de nuevo."), "el mismo texto que en la página");
  assert.equal(res.headers.get("location"), null, "sin 302: es la respuesta a un POST");
  assert.equal(res.headers.get("www-authenticate"), null);
  assert.equal(filasSubida(env).length, 0);
  // La sesión sigue valiendo para el resto del portal.
  assert.equal((await pedir(PAGINA, { env, cookie })).status, 200);

  // Una cookie sin `iat` (anterior a 1B-2) tampoco crea. El anti-CSRF va antes que el login reciente: con el csrf
  // pintado para otra cookie responde el 403 del formulario caducado; con un csrf válido para esa misma cookie llega
  // al login reciente y responde el mismo 401 que una sesión antigua (como /auth/app/autorizar en 1B-2).
  const cookieSinIat = sesionSinIat(EDITOR);
  await esRechazo(await enviarCrear(env, { cookie: cookieSinIat, campos }), 403, "cookie sin iat con el csrf de otra cookie");
  const valorSinIat = decodeURIComponent(cookieSinIat.slice("docs_session=".length));
  const camposSinIat = { ...campos, csrf: await csrfToken(SECRET, valorSinIat, campos.id) };
  const sinIat = await enviarCrear(env, { cookie: cookieSinIat, campos: camposSinIat });
  const htmlSinIat = await esRechazo(sinIat.clone(), 401, "cookie sin iat con su propio csrf");
  assert.ok(htmlSinIat.includes(`href="${LOGIN_DE_NUEVO}"`), "cookie sin iat: el mismo enlace al login");
  assert.equal(sinIat.headers.get("location"), null);
  assert.equal(filasSubida(env).length, 0);

  // En el borde exacto de la ventana todavía crea.
  const nueva = sesion(EDITOR);
  const camposNuevos = await formulario(env, nueva);
  mock.timers.tick(VENTANA_LOGIN);
  assert.equal((await enviarCrear(env, { cookie: nueva, campos: camposNuevos })).status, 200);
  assert.equal(filasSubida(env).length, 1);
});

test("protecciones: quien deja de ser editor (o pierde el acceso al proyecto) entre pintar y enviar recibe 403 y no crea nada", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const campos = await formulario(env, cookie);
  const { crearWorker } = await import("../worker/index.mjs");
  const enviar = (worker) =>
    worker.fetch(new Request(`${ORIGIN}${CREAR}`, { method: "POST", headers: { ...FORM, cookie }, body: new URLSearchParams(campos).toString() }), env, { waitUntil() {}, passThroughOnException() {} });

  const sinEditores = PROYECTOS_REALES.map((p) => ({ ...p, disciplinas: Object.fromEntries(Object.entries(p.disciplinas ?? {}).map(([k, d]) => [k, { ...d, editores: ["otra-persona"] }])) }));
  const casos = [
    ["ya no es editor de ninguna disciplina", crearWorker({ restringidos: DEMO, proyectos: sinEditores })],
    ["proyectos sin disciplinas", crearWorker({ restringidos: DEMO, proyectos: PROYECTOS_REALES.map(({ disciplinas, ...p }) => p) })],
    ["sin proyectos", crearWorker({ restringidos: DEMO, proyectos: [] })],
    ["es editor, pero el proyecto pasó a ser restringido sin él", crearWorker({ restringidos: Object.fromEntries(PROYECTOS_REALES.map((p) => [p.id, ["otra-persona"]])), proyectos: PROYECTOS_REALES })],
  ];
  for (const [que, worker] of casos) {
    const html = await esRechazo(await enviar(worker), 403, que);
    assert.match(html, /Solo los editores de hardware pueden crear tokens de subida\./, que);
  }
  assert.equal(filasSubida(env).length, 0);
  // Con la configuración de siempre, el mismo formulario crea.
  assert.equal((await enviarCrear(env, { cookie, campos })).status, 200);
});

// ---------- Criterio 7: tope de 5 vivos por login ----------

test("tope: con 5 tokens de subida vivos el sexto responde 409 con un mensaje claro; revocar uno deja crear", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  // Formulario pintado antes de llegar al tope (en el tope la página ya no lo ofrece).
  const guardado = await formulario(env, cookie, "El sexto");
  const creados = [];
  for (let i = 0; i < MAX_SUBIDA; i++) creados.push(await crearToken(env, cookie, `CLI ${i + 1}`));
  assert.equal(new Set(creados.map((c) => c.token)).size, MAX_SUBIDA, "cada token es distinto");
  // Los de otro login y los dispositivos no cuentan para el tope de nadie.
  insertarToken(env, { login: "beto" });
  await emitir(env, { login: EDITOR });

  const html = await esRechazo(await enviarCrear(env, { cookie, campos: guardado }), 409, "sexto token");
  assert.ok(html.includes(TOPE), `falta el aviso: ${TOPE}`);
  assert.match(html, new RegExp(`href="${PAGINA}"`), "enlace de vuelta para revocar");
  assert.equal(filasSubida(env, EDITOR).length, MAX_SUBIDA);
  for (const c of creados) assert.equal(await vivo(env, c.token), true, "el rechazo no toca los existentes");

  const lista = await paginaSubida(env, cookie);
  const post = await enviarRevocar(env, { cookie, campos: { id: lista.tokens[0].id, csrf: lista.tokens[0].csrf } });
  assert.equal(post.status, 303);
  // El rechazo por tope no gastó el formulario guardado.
  assert.equal((await enviarCrear(env, { cookie, campos: guardado })).status, 200);
  assert.equal(filasSubida(env, EDITOR).length, MAX_SUBIDA);
});

test("tope: dos formularios distintos enviados a la vez con 4 vivos no pasan de 5", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  for (let i = 0; i < MAX_SUBIDA - 1; i++) insertarToken(env, { login: EDITOR, nombre: `CLI ${i + 1}` });
  const [a, b] = [await formulario(env, cookie, "A"), await formulario(env, cookie, "B")];
  const respuestas = await Promise.all([enviarCrear(env, { cookie, campos: a }), enviarCrear(env, { cookie, campos: b })]);
  assert.deepEqual(respuestas.map((r) => r.status).sort(), [200, 409], "la cuenta y la inserción van en una sola sentencia");
  assert.equal(filasSubida(env, EDITOR).length, MAX_SUBIDA);
});

test("tope: los caducados no cuentan y se borran al crear (solo los de subida de ese login)", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const hace40 = T0 - 40 * DIA;
  const caducados = Array.from({ length: MAX_SUBIDA }, (_, i) => insertarToken(env, { login: EDITOR, nombre: `Caducado ${i + 1}`, creado: hace40 }));
  const deOtro = insertarToken(env, { login: "beto", nombre: "Caducado de Beto", creado: hace40 });
  const dispositivo = insertarToken(env, { login: EDITOR, prefijo: "vtd_", tipo: "dispositivo", alcance: "completo", plataforma: "windows", nombre: "PC caducada", creado: hace40 });
  const vivoPrevio = insertarToken(env, { login: EDITOR, nombre: "Sigue vivo" });

  const antes = await paginaSubida(env, cookie);
  assert.equal(antes.tokens.length, 1, "los caducados no se listan");
  assert.ok(antes.crear, "ni cuentan para el tope");
  await crearToken(env, cookie, "Nuevo");

  for (const c of caducados) assert.equal(filaToken(env, c.id), undefined, "caducado de subida del login: borrado al crear");
  assert.ok(filaToken(env, vivoPrevio.id), "los vivos no se tocan");
  assert.ok(filaToken(env, deOtro.id), "los de otro login no se tocan");
  assert.ok(filaToken(env, dispositivo.id), "los dispositivos no se tocan");
  assert.deepEqual(filasSubida(env, EDITOR).map((f) => f.nombre).sort(), ["Nuevo", "Sigue vivo"]);

  // Con el tiempo el tope se libera solo: 5 vivos hoy, ninguno dentro de 30 días.
  for (let i = 0; i < MAX_SUBIDA - 2; i++) insertarToken(env, { login: EDITOR });
  assert.equal((await paginaSubida(env, cookie)).crear, null);
  mock.timers.tick(TREINTA_DIAS);
  await crearToken(env, sesion(EDITOR), "Tras caducar");
  assert.deepEqual(filasSubida(env, EDITOR).map((f) => f.nombre), ["Tras caducar"]);
});

// ---------- Criterio 9: con Bearer la ruta es de navegador, y las listas de la app no cambian ----------

test("bearer: la ruta nueva responde 400 a un token de dispositivo y 403 de la puerta a uno de subida; nunca crea", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const campos = await formulario(env, cookie);
  const app = await emitir(env, { login: EDITOR });
  const subida = insertarToken(env, { login: EDITOR });
  const cuerpo = new URLSearchParams(campos).toString();

  for (const path of [CREAR, `${CREAR}/`]) {
    for (const method of ["GET", "POST"]) {
      const extra = method === "POST" ? { headers: { "content-type": CT }, body: cuerpo } : {};
      const conApp = await pedir(path, { env, method, bearer: app.token, ...extra });
      assert.equal(conApp.status, 400, `${method} ${path} con vtd_`);
      assert.deepEqual(await conApp.json(), { error: "Ruta solo para navegador" });
      await esDenegada(await pedir(path, { env, method, bearer: subida.token, ...extra }), `${method} ${path} con vts_`);
    }
    // Cookie y token a la vez: el 400 de 1A, también con el formulario válido.
    for (const bearer of [app.token, subida.token]) {
      const ambos = await pedir(path, { env, method: "POST", bearer, cookie, headers: FORM, body: cuerpo });
      assert.equal(ambos.status, 400, `${path} con cookie y Bearer`);
      assert.deepEqual(await ambos.json(), { error: "Envía la cookie de sesión o el token, no ambos" });
    }
  }
  assert.equal(filasSubida(env).length, 1, "solo el de la preparación");
  // El formulario no se gastó: con la cookie sola, crea.
  assert.equal((await enviarCrear(env, { cookie, campos })).status, 200);
});

test("listas: un token de subida creado aquí no sale en GET /auth/app/dispositivos ni como dispositivo, y «cli» no es plataforma de la app", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const app = await emitir(env, { login: EDITOR, nombre: "PC de casa" });
  const { token } = await crearToken(env, cookie, "CLI del taller");

  const res = await pedir(API_LISTA, { env, bearer: app.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json.dispositivos.map((d) => d.nombre), ["PC de casa"]);
  assert.ok(!JSON.stringify(json).includes("CLI del taller"));
  assert.deepEqual((await dispositivos(env, EDITOR)).map((d) => d.tipo), ["dispositivo"]);
  await esDenegada(await pedir(API_LISTA, { env, bearer: token }), "la lista de la app con el token de subida");

  // La etiqueta existe en la tabla fija (ninguna vista pinta «Otro» ni el valor crudo para un token de subida)…
  const { ETIQUETAS } = await import("../lib/dispositivos-paginas.mjs");
  assert.equal(ETIQUETAS.get("cli"), "Línea de comandos");
  // …pero la app no puede declararse «cli»: esa plataforma solo la escribe esta ruta.
  const { PLATAFORMAS, plataformaValida } = await cargarCore();
  assert.ok(!PLATAFORMAS.includes("cli") && !plataformaValida("cli"));
  const iniciar = await pedir(urlIniciar(peticionApp({ plataforma: "cli" }).params), { env, cookie });
  assert.equal(iniciar.status, 400);
});
