// Lote G2 «emisión de tokens de subida»: la sección «Tokens de subida» de /auth/dispositivos (solo con la cookie de
// sesión, pintada por el Worker, sin JavaScript). Ver .factory/spec.md, criterios 1, 2, 8 y 10.
// Logins del fixture: EDITOR (cyuxSz) es editor de uuv/electronica; «ana» solo es editora de restringido-demo, un
// proyecto al que no tiene acceso; «carla» no es editora de nada.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  T0,
  DIA,
  TREINTA_DIAS,
  SECRET,
  ORIGIN,
  PAGINA,
  REVOCAR,
  CREAR,
  FORM,
  MAX_SUBIDA,
  VENTANA_LOGIN,
  EDITOR,
  crearEnv,
  pedir,
  emitir,
  sesion,
  sesionCon,
  sesionSinIat,
  insertarToken,
  filaToken,
  filasSubida,
  paginaSubida,
  enviarRevocar,
  origenDeNavegador,
  directivasCsp,
  texto,
} from "./fixtures/subida-2.mjs";

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
const vivo = async (env, token) => (await pedir("/auth/me", { env, bearer: token })).status === 200;

// ---------- Criterio 1: la sección y su lista ----------

test("sección: debajo de los dispositivos, con título propio y una fila por token de subida vivo del login", async () => {
  const { env, llamadas } = crearEnv();
  const app = await emitir(env, { login: EDITOR, nombre: "PC de casa" });
  const viejo = insertarToken(env, { login: EDITOR, nombre: "CLI del taller" });
  mock.timers.tick(5000);
  const nuevo = insertarToken(env, { login: EDITOR, nombre: "CLI del portátil" });
  const ajeno = insertarToken(env, { login: "beto", nombre: "CLI de Beto" });
  insertarToken(env, { login: EDITOR, nombre: "CLI caducada", creado: T0 - 40 * DIA });
  assert.equal(await vivo(env, nuevo.token), true); // deja ultimo_uso en el más nuevo

  const { res, html, doc, h2, seccion, tokens, dispositivos } = await paginaSubida(env, sesion(EDITOR));
  assert.equal(res.status, 200);
  assert.equal(llamadas.length, 0, "la página la pinta el Worker");
  assert.equal(texto(doc.querySelector("h1")), "Dispositivos", "la página sigue siendo la de dispositivos");
  assert.ok(h2 && seccion, "falta <section> con <h2>Tokens de subida</h2>");
  assert.equal(doc.querySelectorAll("h2").length, 1, "un solo subtítulo");
  assert.equal(seccion.getAttribute("aria-labelledby"), h2.id, "la sección se nombra con su título");
  assert.ok(h2.id, "el <h2> lleva id");

  // Los dispositivos van antes y en su propia lista: un token de subida no es un dispositivo.
  assert.equal(dispositivos.length, 1);
  assert.match(texto(dispositivos[0].fila), /PC de casa/);
  assert.ok(dispositivos[0].form.compareDocumentPosition(seccion) & 4, "la sección va después de la lista de dispositivos");
  assert.ok(!texto(seccion).includes("PC de casa"));

  // Solo los vivos del login, el más reciente primero.
  assert.equal(tokens.length, 2, "una fila por token de subida vivo");
  assert.deepEqual(tokens.map((t) => t.id), [nuevo.id, viejo.id]);
  assert.equal(seccion.querySelectorAll("ul > li").length, 2);
  assert.match(texto(tokens[0].fila), /CLI del portátil/);
  assert.match(texto(tokens[1].fila), /CLI del taller/);
  assert.ok(!html.includes("CLI de Beto") && !html.includes("CLI caducada"));

  // Creado, último uso y caducidad: fechas legibles en <time datetime> ISO, con el formato de la lista de dispositivos.
  const iso = (ms) => new Date(ms).toISOString();
  const fechas = (f) => [...f.fila.querySelectorAll("time")].map((t) => t.getAttribute("datetime"));
  assert.deepEqual(fechas(tokens[1]), [iso(T0), iso(T0 + TREINTA_DIAS)], "sin usar: creado y caduca");
  assert.match(texto(tokens[1].fila), /Creado: 21 nov 2026 · Sin usar todavía · Caduca: 21 dic 2026/);
  assert.deepEqual(fechas(tokens[0]), [iso(T0 + 5000), iso(filaToken(env, nuevo.id).ultimo_uso), iso(T0 + 5000 + TREINTA_DIAS)], "usado: creado, último uso y caduca");
  assert.match(texto(tokens[0].fila), /Creado: 21 nov 2026 · Último uso: 21 nov 2026 · Caduca: 21 dic 2026/);

  // Mismo marcado de fila que los dispositivos, y nada secreto en el HTML.
  for (const t of tokens) {
    assert.ok(t.fila.querySelector(".d strong"), "nombre en .d strong, como en los dispositivos");
    assert.equal(t.form.getAttribute("method").toLowerCase(), "post");
    assert.equal(texto(t.boton), "Revocar");
    assert.ok(!texto(t.fila).includes("Línea de comandos"), "la plataforma no se repite en cada fila: ya lo dice el título");
  }
  assert.match(tokens[0].boton.getAttribute("aria-label") ?? "", /^Revocar el token «CLI del portátil»$/);
  for (const secreto of [viejo.token, nuevo.token, ajeno.token, app.token, viejo.hash, nuevo.hash, SECRET]) {
    assert.ok(!html.includes(secreto), `la página no debe contener ${secreto.slice(0, 12)}…`);
  }
  assert.equal(doc.querySelectorAll("script, iframe, object, embed, img, link, base, meta[http-equiv]").length, 0, "sin JavaScript ni recursos externos");
});

test("sección: el nombre del token es entrada no confiable y sale escapado y recortado", async () => {
  const { env } = crearEnv();
  const malo = `<img src=x onerror=alert(1)>"'&</li><script>`;
  insertarToken(env, { login: EDITOR, nombre: malo });
  insertarToken(env, { login: EDITOR, nombre: `" autofocus onfocus="alert(2)` });
  insertarToken(env, { login: EDITOR, nombre: `${"ñ".repeat(200)}<b id="nx">`, plataforma: `<i id="px">beos</i>` });

  const { html, doc, seccion, tokens } = await paginaSubida(env, sesion(EDITOR));
  assert.equal(tokens.length, 3, "las tres filas, ninguna rota por el marcado inyectado");
  assert.equal(doc.querySelectorAll("script, img, #px, #nx, [autofocus], [onfocus], [onerror]").length, 0);
  assert.ok(!html.includes("<img") && !html.includes("<script>") && !html.includes(`<i id="px">`));
  assert.ok(texto(seccion).includes(malo), "el nombre se ve tal cual, como texto");
  assert.ok(!texto(seccion).includes("beos"), "la plataforma de D1 no se pinta");
  assert.ok((texto(seccion).match(/ñ/g) ?? []).length <= 60, "un nombre de más de 60 caracteres no se pinta entero");
});

// ---------- Criterio 2: a quién se le ofrece crear, y los estados del formulario ----------

test("sección: solo aparece a quien es editor de un proyecto al que tiene acceso, o a quien ya tiene tokens", async () => {
  const { env } = crearEnv();
  // Editor sin tokens: título, una línea de explicación y el formulario. Sin lista vacía ni texto de relleno.
  const editor = await paginaSubida(env, sesion(EDITOR));
  assert.ok(editor.seccion && editor.crear, "al editor se le ofrece crear");
  assert.equal(editor.tokens.length, 0);
  assert.equal(editor.seccion.querySelectorAll("ul").length, 0, "sin tokens no hay lista");
  assert.deepEqual([...editor.seccion.querySelectorAll("p")].map(texto), ["Para subir archivos de hardware desde la línea de comandos. Duran 30 días."]);
  // El login no distingue mayúsculas, como en el resto del portal.
  assert.ok((await paginaSubida(env, sesion(EDITOR.toUpperCase()))).crear);

  // Quien no es editor de nada, o solo lo es de un proyecto al que no entra: la página de siempre, sin la sección.
  for (const login of ["carla", "ana"]) {
    const p = await paginaSubida(env, sesion(login));
    assert.equal(p.res.status, 200, login);
    assert.equal(p.seccion, null, `${login}: sin sección`);
    assert.equal(p.doc.querySelectorAll("h2, form, input").length, 0, `${login}: sin formulario`);
    assert.ok(!/token/i.test(texto(p.doc.body)), `${login}: la página no habla de tokens`);
  }

  // Quien dejó de ser editor pero conserva tokens los sigue viendo y puede revocarlos; no puede crear más.
  const resto = insertarToken(env, { login: "carla", nombre: "CLI antigua" });
  const carla = await paginaSubida(env, sesion("carla"));
  assert.ok(carla.seccion, "con tokens, la sección aparece");
  assert.deepEqual(carla.tokens.map((t) => t.id), [resto.id]);
  assert.equal(carla.crear, null);
  assert.equal(carla.doc.querySelectorAll("input:not([type=hidden])").length, 0);
});

test("formulario: un campo «Nombre» con etiqueta, un botón, y los ocultos id y csrf; sin autofocus", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const { doc, seccion, crear, campos } = await paginaSubida(env, cookie);
  assert.ok(seccion && crear, `la sección debe traer el formulario de creación (action=${CREAR})`);
  assert.ok(seccion.contains(crear), "el formulario vive dentro de la sección");
  assert.equal(doc.querySelectorAll(`form[action="${CREAR}"]`).length, 1);
  assert.equal(crear.getAttribute("method").toLowerCase(), "post");
  assert.ok(!crear.hasAttribute("enctype") || crear.getAttribute("enctype") === "application/x-www-form-urlencoded");

  assert.deepEqual(Object.keys(campos).sort(), ["csrf", "id", "nombre"], "tres campos y ninguno más: ni proyecto ni disciplina");
  const nombre = crear.querySelector('input[name="nombre"]');
  assert.equal(nombre.getAttribute("type") ?? "text", "text");
  assert.ok(nombre.hasAttribute("required"));
  assert.equal(nombre.getAttribute("maxlength"), "60", "mismo tope que el nombre de un dispositivo");
  assert.equal(nombre.getAttribute("autocomplete"), "off");
  assert.equal(nombre.value, "");
  assert.ok(nombre.id, "el campo lleva id");
  const etiqueta = crear.querySelector(`label[for="${nombre.id}"]`);
  assert.equal(texto(etiqueta), "Nombre", "etiqueta visible asociada al campo");
  assert.ok(!nombre.hasAttribute("placeholder"), "la etiqueta basta: sin placeholder");
  assert.equal(doc.querySelectorAll("[autofocus]").length, 0, "abrir la página no mueve el foco al formulario");

  for (const oculto of ["id", "csrf"]) assert.equal(crear.querySelector(`input[name="${oculto}"]`).getAttribute("type"), "hidden");
  assert.match(campos.id, /^[A-Za-z0-9_-]{16,64}$/, "id público del token que se va a crear");
  assert.match(campos.csrf, /^[A-Za-z0-9_-]{43}$/);
  const botones = crear.querySelectorAll("button");
  assert.equal(botones.length, 1);
  assert.equal(texto(botones[0]), "Crear token");
  assert.equal(botones[0].getAttribute("type") ?? "submit", "submit");

  // Cada vez que se pinta la página el id es otro (es lo que impide crear dos tokens con un mismo envío), y el csrf
  // va ligado a él y a la sesión.
  const otra = await paginaSubida(env, cookie);
  assert.notEqual(otra.campos.id, campos.id);
  assert.notEqual(otra.campos.csrf, campos.csrf);
  const otraSesion = await paginaSubida(env, sesionCon(EDITOR, { iat: Date.now() - 1000 }));
  assert.notEqual(otraSesion.campos.csrf, campos.csrf);
  // Pintar la página no escribe nada en D1.
  assert.equal(filasSubida(env).length, 0);
});

test("formulario: objetivo táctil de 44 px y foco visible en el campo y en el botón (reglas del <style> de la página)", async () => {
  const { env } = crearEnv();
  insertarToken(env, { login: EDITOR });
  const { html } = await paginaSubida(env, sesion(EDITOR));
  // jsdom no maqueta, pero sí aplica las reglas del <style>: se mira lo que le toca a cada control.
  const { window } = new JSDOM(html);
  const form = window.document.querySelector(`form[action="${CREAR}"]`);
  assert.ok(form, "falta el formulario de creación");
  const controles = [form.querySelector('input[name="nombre"]'), form.querySelector("button"), window.document.querySelector(`form[action="${REVOCAR}"] button`)];
  for (const el of controles) {
    const cs = window.getComputedStyle(el);
    assert.ok(parseFloat(cs.minHeight) >= 44, `<${el.tagName.toLowerCase()}>: min-height ${cs.minHeight || "sin definir"} (hacen falta 44 px)`);
  }
  const campo = window.getComputedStyle(controles[0]);
  assert.equal(campo.boxSizing, "border-box", "el campo no desborda la columna a 375 px");
  const css = [...window.document.querySelectorAll("style")].map((s) => s.textContent).join("");
  assert.match(css, /input:focus-visible[^{]*\{[^}]*outline:\s*2px solid/, "foco visible en el campo, como en botones y enlaces");
  assert.ok(!/outline:\s*(0|none)/.test(css), "ningún control pierde el contorno de foco");
});

test("estado «tope alcanzado»: con 5 tokens vivos el formulario se cambia por una línea que dice qué hacer", async () => {
  const { env } = crearEnv();
  for (let i = 0; i < MAX_SUBIDA; i++) insertarToken(env, { login: EDITOR, nombre: `CLI ${i + 1}` });
  // Los caducados, los de otro login y los dispositivos no cuentan.
  insertarToken(env, { login: EDITOR, nombre: "caducado", creado: T0 - 31 * DIA });
  insertarToken(env, { login: "beto" });
  await emitir(env, { login: EDITOR });

  const lleno = await paginaSubida(env, sesion(EDITOR));
  assert.equal(lleno.tokens.length, MAX_SUBIDA);
  assert.equal(lleno.crear, null, "en el tope no se ofrece el formulario");
  assert.equal(lleno.doc.querySelectorAll("input:not([type=hidden])").length, 0);
  assert.ok(texto(lleno.seccion).includes(TOPE), `falta el aviso: ${TOPE}`);

  // Con 4 vuelve el formulario y desaparece el aviso.
  const post = await enviarRevocar(env, { cookie: sesion(EDITOR), campos: { id: lleno.tokens[0].id, csrf: lleno.tokens[0].csrf } });
  assert.equal(post.status, 303);
  const cuatro = await paginaSubida(env, sesion(EDITOR));
  assert.equal(cuatro.tokens.length, MAX_SUBIDA - 1);
  assert.ok(cuatro.crear);
  assert.ok(!texto(cuatro.seccion).includes(TOPE));
});

test("estado «sesión antigua»: sin login reciente la lista y «Revocar» siguen, y el formulario se cambia por un enlace al login", async () => {
  const { env } = crearEnv();
  const t = insertarToken(env, { login: EDITOR, nombre: "CLI del taller" });
  const antiguas = [
    ["sin iat", sesionSinIat(EDITOR)],
    ["iat de hace 10 minutos y 1 ms", sesionCon(EDITOR, { iat: Date.now() - VENTANA_LOGIN - 1 })],
    ["iat cinco minutos en el futuro", sesionCon(EDITOR, { iat: Date.now() + 5 * 60_000 })],
  ];
  for (const [que, cookie] of antiguas) {
    const p = await paginaSubida(env, cookie);
    assert.equal(p.res.status, 200, `${que}: la página no exige login reciente`);
    assert.ok(p.seccion, que);
    assert.deepEqual(p.tokens.map((x) => x.id), [t.id], `${que}: la lista sigue`);
    assert.equal(p.crear, null, `${que}: sin formulario de creación`);
    const enlace = p.seccion.querySelector(`a[href="${LOGIN_DE_NUEVO}"]`);
    assert.ok(enlace, `${que}: enlace al login con next=/auth/dispositivos`);
    assert.equal(texto(enlace.closest("p")), "Para crear un token, inicia sesión de nuevo.", que);
    assert.equal(p.res.headers.get("set-cookie"), null, `${que}: la cookie no se toca`);
  }
  // En el borde exacto de la ventana todavía se ofrece.
  assert.ok((await paginaSubida(env, sesionCon(EDITOR, { iat: Date.now() - VENTANA_LOGIN }))).crear);

  // Revocar no exige login reciente (como en 1B-1): quitar acceso nunca se bloquea.
  const p = await paginaSubida(env, antiguas[0][1]);
  const post = await enviarRevocar(env, { cookie: antiguas[0][1], campos: { id: p.tokens[0].id, csrf: p.tokens[0].csrf } });
  assert.equal(post.status, 303);
  assert.equal(filaToken(env, t.id), undefined);

  // En el tope manda el aviso del tope: iniciar sesión de nuevo no serviría de nada.
  for (let i = 0; i < MAX_SUBIDA; i++) insertarToken(env, { login: EDITOR });
  const lleno = await paginaSubida(env, antiguas[0][1]);
  assert.ok(texto(lleno.seccion).includes(TOPE));
  assert.equal(lleno.seccion.querySelector('a[href^="/auth/login"]'), null);
});

// ---------- Criterio 8: revocar desde la página ----------

test("revocar: un token de subida se revoca con el mismo formulario y la misma ruta que un dispositivo, y solo el propio", async () => {
  const { env } = crearEnv();
  const app = await emitir(env, { login: EDITOR, nombre: "PC de casa" });
  const mio = insertarToken(env, { login: EDITOR, nombre: "CLI del taller" });
  const otro = insertarToken(env, { login: EDITOR, nombre: "CLI del portátil", creado: T0 - 1000 });
  const ajeno = insertarToken(env, { login: "beto" });
  const cookie = sesion(EDITOR);
  const { tokens, dispositivos } = await paginaSubida(env, cookie);
  assert.equal(tokens.length, 2, "la sección «Tokens de subida» debe traer una fila revocable por token");
  assert.equal(dispositivos.length, 1);
  assert.equal(tokens[0].id, mio.id);
  assert.equal(tokens[0].form.getAttribute("action"), REVOCAR, "sin ruta nueva para revocar");
  assert.equal(tokens[0].csrf, dispositivos[0].csrf, "mismo anti-CSRF que la revocación de dispositivos");

  // El id de un token ajeno no revoca nada y responde igual.
  const nada = await enviarRevocar(env, { cookie, campos: { id: ajeno.id, csrf: tokens[0].csrf } });
  assert.equal(nada.status, 303);
  assert.ok(filaToken(env, ajeno.id));

  const post = await enviarRevocar(env, { cookie, campos: { id: tokens[0].id, csrf: tokens[0].csrf } });
  assert.equal(post.status, 303);
  assert.equal(post.headers.get("location"), PAGINA);
  assert.equal(await vivo(env, mio.token), false, "el token revocado deja de valer al momento");
  assert.equal(await vivo(env, otro.token), true);
  assert.equal(await vivo(env, app.token), true, "el dispositivo no se toca");
  const despues = await paginaSubida(env, cookie);
  assert.deepEqual(despues.tokens.map((t) => t.id), [otro.id]);
  assert.equal(despues.dispositivos.length, 1);
});

// ---------- Criterio 10: Referrer-Policy y cabeceras de la página con el formulario ----------

test("referrer: la página con el formulario de creación se sirve con same-origin y el navegador deduce el Origin propio", async () => {
  const { env } = crearEnv();
  insertarToken(env, { login: EDITOR });
  const { res, html, crear } = await paginaSubida(env, sesion(EDITOR));
  assert.ok(crear, "falta el formulario de creación");
  // Con no-referrer Edge envía `Origin: null` en el POST del formulario y la ruta, que exige el Origin propio, da 403.
  assert.equal(res.headers.get("referrer-policy"), "same-origin", "un solo valor");
  assert.ok(!/name=["']?referrer|referrerpolicy/i.test(html), "la política va solo en la cabecera");
  const destino = new URL(crear.getAttribute("action"), `${ORIGIN}${PAGINA}`).href;
  assert.equal(destino, `${ORIGIN}${CREAR}`, "el formulario apunta al propio origen");
  assert.equal(origenDeNavegador(res.headers.get("referrer-policy"), ORIGIN, destino), ORIGIN);

  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  const csp = directivasCsp(res);
  assert.equal(csp["default-src"], "'none'");
  assert.equal(csp["form-action"], "'self'");
  assert.ok(!("script-src" in csp));
  assert.equal(FORM.origin, ORIGIN);
});
