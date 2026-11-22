// Lote 1B-1 de «tokens de dispositivo»: página /auth/dispositivos (lista y revocación por formulario, solo con la
// cookie de sesión). Sin JavaScript: cada fila lleva su propio formulario con un token anti-CSRF ligado a la sesión.
// Ver .factory/spec.md, criterios 5 y 6.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0,
  SECRET,
  ORIGIN,
  PAGINA,
  REVOCAR,
  FORM,
  crearEnv,
  pedir,
  emitir,
  dispositivos,
  sesion,
  filasTokens,
  pagina,
  paginaCon,
  enviarRevocar,
  origenDeNavegador,
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

const VACIO = "Ningún dispositivo tiene acceso. Se añaden al iniciar sesión desde la app.";
const vivo = async (env, token) => (await pedir("/auth/me", { env, bearer: token })).status === 200;
const texto = (el) => el.textContent.replace(/\s+/g, " ").trim();

// Dos dispositivos de ana (el segundo, 5 s después y ya usado) y uno de beto.
async function escenario() {
  const { env, llamadas } = crearEnv();
  const a1 = await emitir(env, { login: "ana", nombre: "PC de Ana" });
  mock.timers.tick(5000);
  const a2 = await emitir(env, { login: "ana", nombre: "Portátil", plataforma: "linux" });
  const b = await emitir(env, { login: "beto", nombre: "Equipo de Beto", plataforma: "macos" });
  assert.equal(await vivo(env, a2.token), true); // deja ultimo_uso en a2
  return { env, llamadas, a1, a2, b };
}

// ---------- Criterio 5: la página ----------

test("página: solo con cookie de sesión — sin sesión redirige al login con next=/auth/dispositivos", async () => {
  const { env } = crearEnv();
  for (const path of [PAGINA, `${PAGINA}/`]) {
    const res = await pedir(path, { env });
    assert.equal(res.status, 302);
    assert.equal(new URL(res.headers.get("location"), "https://x").pathname, "/auth/login");
    assert.equal(new URL(res.headers.get("location"), "https://x").searchParams.get("next").replace(/\/$/, ""), PAGINA);
  }
  // Una cookie firmada con otro secreto o caducada tampoco entra.
  assert.equal((await pedir(PAGINA, { env, cookie: sesion("ana", "x".repeat(40)) })).status, 302);
  const vieja = sesion("ana");
  mock.timers.tick(2 * 864e5);
  assert.equal((await pedir(PAGINA, { env, cookie: vieja })).status, 302);
  // Y con sesión no se sirve un asset: la página la pinta el Worker.
  const { res, html } = await pagina(env, sesion("ana"));
  assert.equal(res.status, 200);
  assert.ok(!html.includes("<h1>asset</h1>"), "/auth/dispositivos no debe caer en ASSETS");
});

test("página: lista los dispositivos del login (más reciente primero), con plataforma y último uso, y nada ajeno", async () => {
  const { env, llamadas, a1, a2, b } = await escenario();
  const { res, html, doc, filas } = await pagina(env, sesion("ana"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(llamadas.length, 0);
  assert.equal(doc.documentElement.getAttribute("lang"), "es");
  assert.equal(texto(doc.querySelector("h1")), "Dispositivos");
  assert.match(doc.title, /Dispositivos/);

  assert.equal(filas.length, 2, "un formulario de revocación por dispositivo");
  assert.equal(doc.querySelectorAll("ul > li").length, 2, "una fila <li> por dispositivo");
  assert.ok(filas.every((f) => f.fila), "cada formulario vive dentro de su <li>");
  assert.match(texto(filas[0].fila), /Portátil/);
  assert.match(texto(filas[0].fila), /Linux/);
  assert.match(texto(filas[1].fila), /PC de Ana/);
  assert.match(texto(filas[1].fila), /Windows/);
  assert.ok(!texto(filas[0].fila).includes("PC de Ana"), "cada fila lleva solo su dispositivo");

  // Último uso: fecha legible con <time datetime> en ISO; si no se ha usado, se dice.
  const lista = await dispositivos(env, "ana");
  const usado = lista.find((d) => d.nombre === "Portátil");
  assert.ok(usado.ultimoUso, "el escenario deja usado el Portátil");
  assert.equal(filas[0].fila.querySelector("time")?.getAttribute("datetime"), new Date(usado.ultimoUso).toISOString());
  assert.match(texto(filas[0].fila), /Último uso/);
  assert.match(texto(filas[1].fila), /Sin usar todavía/);
  assert.equal(filas[1].fila.querySelector("time"), null);

  // Formularios: POST a la ruta de revocación, con el id público y un botón «Revocar» con nombre accesible propio.
  assert.deepEqual(filas.map((f) => f.id), [usado.id, lista.find((d) => d.nombre === "PC de Ana").id]);
  for (const f of filas) {
    assert.equal(f.form.getAttribute("method").toLowerCase(), "post");
    assert.equal(f.boton.getAttribute("type") ?? "submit", "submit");
    assert.equal(texto(f.boton), "Revocar");
    assert.equal(f.form.querySelector('input[name="id"]').getAttribute("type"), "hidden");
    assert.equal(f.form.querySelector('input[name="csrf"]').getAttribute("type"), "hidden");
  }
  assert.match(filas[0].boton.getAttribute("aria-label") ?? "", /Revocar.*Portátil/);
  assert.match(filas[1].boton.getAttribute("aria-label") ?? "", /Revocar.*PC de Ana/);

  // Nada de otro login, ni tokens, ni hashes.
  for (const secreto of ["Equipo de Beto", "beto", a1.token, a2.token, b.token, ...filasTokens(env).map((f) => f.hash), SECRET]) {
    assert.ok(!html.includes(secreto), `la página no debe contener ${secreto.slice(0, 12)}…`);
  }
  assert.ok(!html.includes(sesion("ana").split("=")[1]), "la cookie de sesión no se copia al HTML");
});

test("página: estado vacío con el texto acordado y sin formularios", async () => {
  const { env, b } = await escenario();
  const { res, doc, filas, html } = await pagina(env, sesion("carla"));
  assert.equal(res.status, 200);
  assert.equal(filas.length, 0);
  assert.equal(doc.querySelectorAll("form").length, 0);
  assert.ok(texto(doc.body).includes(VACIO), "falta el texto del estado vacío");
  assert.ok(!html.includes("Equipo de Beto") && !html.includes(b.token));

  // Con dispositivos, el texto del estado vacío no aparece.
  assert.ok(!texto((await pagina(env, sesion("ana"))).doc.body).includes(VACIO));
  // Un token caducado deja de listarse.
  mock.timers.tick(31 * 864e5);
  const tarde = await pagina(env, sesion("ana"));
  assert.equal(tarde.filas.length, 0);
  assert.ok(texto(tarde.doc.body).includes(VACIO));
});

test("página: cabeceras contra clickjacking y caché, CSP sin scripts y con form-action 'self'; sin JavaScript ni recursos externos", async () => {
  const { env } = await escenario();
  for (const cookie of [sesion("ana"), sesion("carla")]) {
    const { res, doc, html } = await pagina(env, cookie);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    // Antes se fijaba aquí `no-referrer`. Con esa política el navegador envía `Origin: null` en el POST del formulario
    // (Fetch, «append a request Origin header») y la revocación da siempre 403: ver la sección «Referrer-Policy».
    assert.equal(res.headers.get("referrer-policy"), "same-origin");
    assert.equal(res.headers.get("set-cookie"), null);
    const csp = res.headers.get("content-security-policy") ?? "";
    const directivas = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v.join(" ")]));
    assert.equal(directivas["default-src"], "'none'");
    assert.equal(directivas["frame-ancestors"], "'none'");
    assert.equal(directivas["form-action"], "'self'", "default-src no cubre form-action: hay que declararlo");
    assert.ok(!("script-src" in directivas), "sin script-src: los scripts quedan en 'none' por default-src");
    assert.ok(Object.entries(directivas).every(([k, v]) => k === "style-src" || !/unsafe/.test(v)), csp);

    assert.equal(doc.querySelectorAll("script, iframe, object, embed, img, link, base, meta[http-equiv]").length, 0);
    for (const el of doc.querySelectorAll("*")) {
      for (const at of el.attributes) assert.ok(!/^on/i.test(at.name), `atributo ${at.name} en <${el.tagName.toLowerCase()}>`);
    }
    assert.ok(!/javascript:/i.test(html));
    for (const a of doc.querySelectorAll("a[href]")) assert.match(a.getAttribute("href"), /^\/(?!\/)/, "solo enlaces internos");
  }
});

test("página: nombre y plataforma del dispositivo son entrada no confiable y salen escapados", async () => {
  const { env } = crearEnv();
  const malo = `<img src=x onerror=alert(1)>"'&</li><script>`;
  await emitir(env, { login: "ana", nombre: malo });
  await emitir(env, { login: "ana", nombre: `" autofocus onfocus="alert(2)` });
  // Filas manipuladas directamente en D1: plataforma fuera de la lista y nombre más largo de lo permitido.
  await emitir(env, { login: "ana", nombre: "Tercero" });
  env.DB.sqlite.prepare("UPDATE tokens SET plataforma = ?, nombre = ? WHERE nombre = 'Tercero'").run(`<i id="px">beos</i>`, `${"ñ".repeat(200)}<b id="nx">`);

  const { res, html, doc, filas } = await pagina(env, sesion("ana"));
  assert.equal(res.status, 200);
  assert.equal(filas.length, 3, "las tres filas, ninguna rota por el marcado inyectado");
  assert.equal(doc.querySelectorAll("ul > li").length, 3);
  assert.equal(doc.querySelectorAll("script, img, #px, #nx, [autofocus], [onfocus], [onerror]").length, 0);
  assert.ok(!html.includes("<img") && !html.includes("<script>") && !html.includes(`<i id="px">`));
  assert.ok(texto(doc.body).includes(malo), "el nombre se ve tal cual, como texto");
  for (const f of filas) {
    assert.match(f.id, /^[A-Za-z0-9_-]{16,64}$/);
    assert.equal(texto(f.boton), "Revocar");
    for (const at of f.boton.attributes) assert.ok(["type", "aria-label", "class"].includes(at.name), `atributo inesperado en el botón: ${at.name}`);
  }
  // El nombre demasiado largo se recorta al mostrarlo (60 caracteres como máximo, igual que al crearlo).
  const largo = filas.map((f) => texto(f.fila)).find((t) => t.includes("ñññ"));
  assert.ok((largo.match(/ñ/g) ?? []).length <= 60, "un nombre de más de 60 caracteres no se pinta entero");
  // Una plataforma desconocida no se pinta con su valor crudo.
  assert.ok(!texto(doc.body).includes("beos"), "plataforma fuera de la lista: etiqueta genérica, no el valor de D1");
});

test("página: solo GET; sin binding DB o con D1 caído → 503 sin detalles", async () => {
  const { env } = await escenario();
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await pedir(PAGINA, { env, method, cookie: sesion("ana"), headers: FORM, body: method === "POST" ? "x=1" : undefined });
    assert.equal(res.status, 405, method);
    assert.match(res.headers.get("allow") ?? "", /\bGET\b/);
  }
  assert.equal(filasTokens(env).length, 3);

  const roto = {
    prepare() {
      throw new Error("D1_ERROR: tabla secreta tokens");
    },
    batch() {
      throw new Error("D1_ERROR: tabla secreta tokens");
    },
  };
  const salida = await conConsola(async () => {
    for (const DB of [undefined, roto]) {
      const res = await pedir(PAGINA, { env: { ...env, DB }, cookie: sesion("ana") });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("x-frame-options"), "DENY");
      const html = await res.text();
      assert.ok(!/D1_ERROR|secreta/.test(html));
      const post = await enviarRevocar({ ...env, DB }, { cookie: sesion("ana"), campos: { id: "A".repeat(22), csrf: "B".repeat(43) } });
      assert.ok([403, 503].includes(post.status), `la revocación falla cerrada (${post.status})`);
      assert.ok(!/D1_ERROR|secreta/.test(await post.text()));
    }
  });
  assert.ok(!salida.includes(SECRET));
});

// ---------- Criterios 5 y 6: Referrer-Policy de la página y Origin del formulario ----------
// Defecto visto en Edge: con `Referrer-Policy: no-referrer` el navegador envía `Origin: null` en el POST del formulario
// aunque sea del mismo origen, y la revocación exige el Origin propio. Los demás tests no lo veían porque ponen el
// Origin a mano; aquí el Origin se deduce de la Referrer-Policy con la que se sirvió la página (origenDeNavegador).

test("referrer: GET /auth/dispositivos se sirve con Referrer-Policy same-origin (con filas, vacía y con barra final)", async () => {
  const { env } = await escenario();
  const casos = [
    ["con dispositivos", PAGINA, sesion("ana")],
    ["estado vacío", PAGINA, sesion("carla")],
    ["con barra final", `${PAGINA}/`, sesion("ana")],
  ];
  for (const [que, path, cookie] of casos) {
    const res = await pedir(path, { env, cookie });
    assert.equal(res.status, 200, que);
    // Un solo valor: con una lista («no-referrer, same-origin») el navegador se queda con el último que reconoce.
    assert.equal(res.headers.get("referrer-policy"), "same-origin", que);
    // El resto de cabeceras de page() no cambia.
    assert.equal(res.headers.get("x-frame-options"), "DENY", que);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/, que);
    assert.match(res.headers.get("content-security-policy") ?? "", /form-action 'self'/, que);
    // Y la política va solo en la cabecera: sin <meta name="referrer"> ni atributos referrerpolicy que la cambien.
    const html = await res.text();
    assert.ok(!/name=["']?referrer|referrerpolicy/i.test(html), que);
  }
});

test("referrer: el Origin que un navegador deduce de la página servida es el del Worker, y con él «Revocar» responde 303", async () => {
  // Guardas del ayudante (algoritmo de Fetch): no-referrer oscurece el origen; same-origin solo lo da al mismo origen.
  assert.equal(origenDeNavegador("no-referrer", ORIGIN, `${ORIGIN}${REVOCAR}`), "null");
  assert.equal(origenDeNavegador("same-origin", ORIGIN, `${ORIGIN}${REVOCAR}`), ORIGIN);
  assert.equal(origenDeNavegador("same-origin", ORIGIN, "https://evil.example/x"), "null");

  const { env, a2 } = await escenario();
  const cookie = sesion("ana");
  const { res, filas } = await paginaCon(env, cookie, 2);
  const destino = new URL(filas[0].form.getAttribute("action"), `${ORIGIN}${PAGINA}`).href;
  const origin = origenDeNavegador(res.headers.get("referrer-policy"), ORIGIN, destino);
  assert.equal(origin, ORIGIN, "con la Referrer-Policy de la página, el navegador debe enviar el Origin real y no «null»");

  const post = await enviarRevocar(env, { cookie, campos: { id: filas[0].id, csrf: filas[0].csrf }, headers: { "content-type": FORM["content-type"], origin } });
  assert.equal(post.status, 303);
  assert.equal(post.headers.get("location"), PAGINA);
  assert.equal(await vivo(env, a2.token), false);
  assert.equal((await pagina(env, cookie)).filas.length, 1);
});

test("referrer: las páginas sin formulario conservan no-referrer (resto de page(), errores de la revocación y redirecciones)", async () => {
  const { env } = await escenario();
  const cookie = sesion("ana");
  const { filas } = await paginaCon(env, cookie, 2);
  const campos = { id: filas[0].id, csrf: filas[0].csrf };
  const ct = FORM["content-type"];
  const roto = {
    prepare() {
      throw new Error("D1_ERROR");
    },
    batch() {
      throw new Error("D1_ERROR");
    },
  };

  // [qué, estado esperado, respuesta]. Las de HTML se comprueban además sin <form>: por eso no necesitan same-origin.
  const casos = [
    ["sesión cerrada", 200, await pedir("/auth/signed-out", { env })],
    ["proyecto privado", 403, await pedir("/restringido-demo/", { env, cookie: sesion("otro") })],
    ["login sin configurar", 503, await pedir(PAGINA, { env: { ...env, SESSION_SECRET: "corto" }, cookie })],
    ["callback sin estado", 400, await pedir("/auth/callback?state=x&code=y", { env })],
    ["página: 405", 405, await pedir(PAGINA, { env, method: "POST", cookie, headers: FORM, body: "x=1" })],
    ["página: 503 sin DB", 503, await pedir(PAGINA, { env: { ...env, DB: undefined }, cookie })],
    ["página: 503 con D1 caído", 503, await pedir(PAGINA, { env: { ...env, DB: roto }, cookie })],
    ["revocar: 405", 405, await enviarRevocar(env, { cookie, campos, method: "GET" })],
    ["revocar: 403 sin Origin", 403, await enviarRevocar(env, { cookie, campos, headers: { "content-type": ct } })],
    ["revocar: 403 con Origin null", 403, await enviarRevocar(env, { cookie, campos, headers: { "content-type": ct, origin: "null" } })],
    ["revocar: 403 con Origin ajeno", 403, await enviarRevocar(env, { cookie, campos, headers: { "content-type": ct, origin: "https://evil.example" } })],
    ["revocar: 415", 415, await enviarRevocar(env, { cookie, campos, headers: { ...FORM, "content-type": "text/plain" } })],
    ["revocar: 413", 413, await enviarRevocar(env, { cookie, campos: { ...campos, relleno: "x".repeat(2000) } })],
    ["revocar: 403 por csrf", 403, await enviarRevocar(env, { cookie, campos: { ...campos, csrf: "A".repeat(43) } })],
    ["revocar: 400 por id", 400, await enviarRevocar(env, { cookie, campos: { ...campos, id: "x" } })],
    ["revocar: 503 sin DB", 503, await enviarRevocar({ ...env, DB: undefined }, { cookie, campos })],
    ["página: 302 sin sesión", 302, await pedir(PAGINA, { env })],
    ["revocar: 302 sin sesión", 302, await enviarRevocar(env, { campos })],
    ["revocar: 303 con éxito", 303, await enviarRevocar(env, { cookie, campos })],
  ];
  for (const [que, estado, res] of casos) {
    assert.equal(res.status, estado, que);
    assert.equal(res.headers.get("referrer-policy"), "no-referrer", que);
    if (/^text\/html/.test(res.headers.get("content-type") ?? "")) {
      const html = await res.text();
      assert.ok(!/<form\b/i.test(html), `${que}: una página sin same-origin no puede llevar formularios`);
      assert.equal(res.headers.get("x-frame-options"), "DENY", que);
    }
  }
});

test("referrer: guarda — un POST con Origin: null sigue dando 403 y no revoca, aunque sesión, csrf e id sean válidos", async () => {
  const { env, a1, a2 } = await escenario();
  const cookie = sesion("ana");
  const { filas } = await paginaCon(env, cookie, 2);
  for (const path of [REVOCAR, `${REVOCAR}/`]) {
    for (const origin of ["null", "NULL", " null", "null, null"]) {
      const res = await pedir(path, {
        env,
        method: "POST",
        cookie,
        headers: { "content-type": FORM["content-type"], origin },
        body: new URLSearchParams({ id: filas[0].id, csrf: filas[0].csrf }).toString(),
      });
      assert.equal(res.status, 403, `${path} con Origin ${JSON.stringify(origin)}`);
      assert.equal(res.headers.get("location"), null);
      assert.equal(res.headers.get("set-cookie"), null);
      assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
    }
  }
  assert.equal(filasTokens(env).length, 3, "Origin: null no revoca nada");
  assert.equal(await vivo(env, a1.token), true);
  assert.equal(await vivo(env, a2.token), true);
  assert.equal((await pagina(env, cookie)).filas.length, 2);
});

// ---------- Criterio 6: revocar desde la página ----------

test("revocar: con el formulario de la página → 303 a /auth/dispositivos, el dispositivo desaparece y su token da 401", async () => {
  const { env, a1, a2, b } = await escenario();
  const cookie = sesion("ana");
  const { filas } = await paginaCon(env, cookie, 2);
  const portatil = filas[0];

  const res = await enviarRevocar(env, { cookie, campos: { id: portatil.id, csrf: portatil.csrf } });
  assert.equal(res.status, 303, "Post/Redirect/Get: recargar no reenvía el formulario");
  assert.equal(res.headers.get("location"), PAGINA);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(res.headers.get("set-cookie"), null);

  assert.equal(await vivo(env, a2.token), false, "el token revocado deja de valer en la siguiente petición");
  assert.equal(await vivo(env, a1.token), true);
  assert.equal(await vivo(env, b.token), true);
  const despues = await pagina(env, cookie);
  assert.equal(despues.filas.length, 1);
  assert.match(texto(despues.filas[0].fila), /PC de Ana/);

  // Con barra final también, y hasta quedar vacío.
  const ultimo = await pedir(`${REVOCAR}/`, { env, method: "POST", cookie, headers: FORM, body: new URLSearchParams({ id: despues.filas[0].id, csrf: despues.filas[0].csrf }).toString() });
  assert.equal(ultimo.status, 303);
  assert.ok(texto((await pagina(env, cookie)).doc.body).includes(VACIO));
  assert.deepEqual(filasTokens(env).map((f) => f.login), ["beto"]);
});

test("revocar: anti-CSRF — sin token, con uno inventado, de otro login o de otra sesión del mismo login → 403 y no se borra nada", async () => {
  const { env } = await escenario();
  const cookieAna = sesion("ana");
  const ana = await paginaCon(env, cookieAna, 2);
  const beto = await paginaCon(env, sesion("beto"), 1);
  const id = ana.filas[0].id;
  const csrf = ana.filas[0].csrf;

  // Forma del token: opaco, largo, igual en todas las filas de la misma sesión y distinto entre sesiones.
  assert.match(csrf, /^[A-Za-z0-9_-]{32,128}$/);
  assert.equal(ana.filas[1].csrf, csrf);
  assert.notEqual(beto.filas[0].csrf, csrf);
  const [cuerpoCookie, firmaCookie] = decodeURIComponent(cookieAna.split("=")[1]).split(".");
  assert.ok(csrf !== firmaCookie && !csrf.includes(firmaCookie) && !csrf.includes(cuerpoCookie), "el token anti-CSRF no es la firma de la sesión ni la contiene");
  assert.ok(!csrf.includes(SECRET));

  // Otra sesión del mismo login (emitida un segundo después): su token es otro y el viejo no le sirve.
  mock.timers.tick(1000);
  const cookieAna2 = sesion("ana");
  assert.notEqual(cookieAna2, cookieAna);
  const ana2 = await paginaCon(env, cookieAna2, 2);
  assert.notEqual(ana2.filas[0].csrf, csrf, "el token va ligado a la sesión, no solo al login");

  const malos = [
    ["sin csrf", cookieAna, { id }],
    ["csrf vacío", cookieAna, { id, csrf: "" }],
    ["csrf inventado", cookieAna, { id, csrf: "A".repeat(csrf.length) }],
    ["csrf recortado", cookieAna, { id, csrf: csrf.slice(0, -1) }],
    ["csrf con sufijo", cookieAna, { id, csrf: `${csrf}A` }],
    ["csrf de otro login", cookieAna, { id, csrf: beto.filas[0].csrf }],
    ["csrf de otra sesión del mismo login", cookieAna2, { id, csrf }],
    ["la firma de la cookie como csrf", cookieAna, { id, csrf: firmaCookie }],
  ];
  for (const [que, cookie, campos] of malos) {
    const res = await enviarRevocar(env, { cookie, campos });
    assert.equal(res.status, 403, que);
    assert.equal(res.headers.get("location"), null, que);
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  }
  assert.equal(filasTokens(env).length, 3, "ningún intento fallido borra nada");

  // El de la sesión correcta sí funciona después de todos los intentos (no hay estado que se queme).
  assert.equal((await enviarRevocar(env, { cookie: cookieAna, campos: { id, csrf } })).status, 303);
  assert.equal(filasTokens(env).length, 2);
});

test("revocar: Origin propio obligatorio, solo POST, solo formulario urlencoded y cuerpo acotado", async () => {
  const { env } = await escenario();
  const cookie = sesion("ana");
  const { filas } = await paginaCon(env, cookie, 2);
  const campos = { id: filas[0].id, csrf: filas[0].csrf };
  const ct = FORM["content-type"];

  for (const origin of [undefined, "https://evil.example", "null", "https://docs-site-lab.ejemplo.workers.dev.evil.example"]) {
    const headers = origin === undefined ? { "content-type": ct } : { "content-type": ct, origin };
    assert.equal((await enviarRevocar(env, { cookie, campos, headers })).status, 403, `Origin ${origin}`);
  }
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await enviarRevocar(env, { cookie, campos, method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST");
  }
  // Un GET con los campos en la query tampoco revoca.
  assert.equal((await pedir(`${REVOCAR}?${new URLSearchParams(campos)}`, { env, cookie })).status, 405);
  for (const tipo of ["application/json", "multipart/form-data; boundary=x", "text/plain"]) {
    const res = await pedir(REVOCAR, { env, method: "POST", cookie, headers: { ...FORM, "content-type": tipo }, body: tipo === "application/json" ? JSON.stringify(campos) : new URLSearchParams(campos).toString() });
    assert.equal(res.status, 415, tipo);
  }
  assert.equal((await enviarRevocar(env, { cookie, campos: { ...campos, relleno: "x".repeat(2000) } })).status, 413, "cuerpo de más de 1 KB");
  // id sin forma de id: 400, sin tocar nada.
  for (const id of ["", "x", "a b", "../x", "A".repeat(65), "%"]) {
    assert.equal((await enviarRevocar(env, { cookie, campos: { ...campos, id } })).status, 400, `id ${JSON.stringify(id)}`);
  }
  assert.equal(filasTokens(env).length, 3, "nada de lo anterior revoca");
  assert.equal((await enviarRevocar(env, { cookie, campos })).status, 303, "y el formulario bien enviado sigue funcionando");
});

test("revocar: el id de otro login y un id que no existe dan la misma respuesta, y el dispositivo ajeno sigue vivo", async () => {
  const { env, b } = await escenario();
  const cookie = sesion("ana");
  const { filas } = await paginaCon(env, cookie, 2);
  const csrf = filas[0].csrf;
  const idAjeno = (await dispositivos(env, "beto"))[0].id;
  const idInexistente = "Z".repeat(idAjeno.length);

  const firma = async (res) => JSON.stringify([res.status, [...res.headers].sort(), await res.text()]);
  const ajeno = await enviarRevocar(env, { cookie, campos: { id: idAjeno, csrf } });
  const inexistente = await enviarRevocar(env, { cookie, campos: { id: idInexistente, csrf } });
  assert.equal(ajeno.status, 303);
  assert.equal(await firma(ajeno), await firma(inexistente), "no se puede sondear qué ids existen");

  assert.equal(await vivo(env, b.token), true);
  assert.equal(filasTokens(env).length, 3);
  assert.equal((await pagina(env, sesion("beto"))).filas.length, 1);
  // Un campo `login` en el formulario no cambia de quién se borra.
  await enviarRevocar(env, { cookie, campos: { id: idAjeno, csrf, login: "beto" } });
  assert.equal(await vivo(env, b.token), true);
});

test("revocar: sin sesión → 302 al login (next=/auth/dispositivos) y no se borra nada", async () => {
  const { env } = await escenario();
  const { filas } = await paginaCon(env, sesion("ana"), 2);
  const campos = { id: filas[0].id, csrf: filas[0].csrf };
  for (const cookie of [undefined, sesion("ana", "x".repeat(40))]) {
    const res = await enviarRevocar(env, { cookie, campos });
    assert.equal(res.status, 302);
    const destino = new URL(res.headers.get("location"), "https://x");
    assert.equal(destino.pathname, "/auth/login");
    assert.equal(destino.searchParams.get("next"), PAGINA, "tras el login se vuelve a la página, no a la ruta del POST");
  }
  assert.equal(filasTokens(env).length, 3);
});
