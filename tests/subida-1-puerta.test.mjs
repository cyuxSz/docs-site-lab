// Lote G1 «token de subida»: puerta central de alcance. Un token que no es de dispositivo solo pasa por una lista
// blanca de (método, ruta, parámetros); todo lo demás responde 403 JSON con `codigo: "alcance"`, y una ruta nueva
// queda cerrada por defecto. Ver .factory/spec.md, criterios 2 a 6.
// Las peticiones con Bearer de este archivo NO llevan `Origin`: un cliente que no es un navegador no lo envía.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { T0, ORIGIN, SECRET, EDITOR, crearEnv, pedir, emitir, sesion, insertarToken, filaToken, cuantosTokens, esDenegada, esDenegadaPorPermiso } from "./fixtures/subida.mjs";

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

const JSON_CT = { "content-type": "application/json" };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const BIN = { "content-type": "application/octet-stream", "content-length": String(PNG.length) };
// Desde G3 el token de subida solo sube drawio, svg, kicad_sch y kicad_pcb con contenido que cuadre: las subidas que
// tienen que salir bien usan un .drawio real. Las que la puerta corta siguen con el PNG.
const DRAWIO = new TextEncoder().encode('<mxfile host="test"><diagram id="a"/></mxfile>');
const SUBE = { "content-type": "application/octet-stream", "content-length": String(DRAWIO.length) };
const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const uuid = (n) => `3f2b8c1e-9a4d-4e7f-8b21-${String(n).padStart(12, "0")}`;
const qs = (o) => new URLSearchParams(o).toString();
const subir = (env, bearer, extra = {}) => pedir(`/api/archivos/?${qs({ proyecto: "uuv", disciplina: "electronica", id: ID, nombre: "placa.drawio", ...extra })}`, { env, bearer, method: "POST", headers: SUBE, body: DRAWIO });
const HW = "/api/hardware/?proyecto=uuv&disciplina=electronica";

// Páginas de hardware de uuv/electronica creadas por un editor con su sesión de navegador.
async function inicializarHardware(env) {
  const res = await pedir("/api/hardware/", { env, cookie: sesion(EDITOR), method: "POST", headers: { ...JSON_CT, origin: ORIGIN }, body: JSON.stringify({ proyecto: "uuv", disciplina: "electronica", accion: "inicializar" }) });
  assert.equal(res.status, 201, "preparación: inicializar la disciplina con cookie");
  return (await res.json()).paginas;
}

// ---------- Criterio 3: lo permitido ----------

test("permitido: /auth/me, capacidades, subida, lista y descarga de adjuntos, índice y página de hardware", async () => {
  const { env, llamadas } = crearEnv();
  const paginas = await inicializarHardware(env);
  const { token } = insertarToken(env, { login: EDITOR });

  const me = await pedir("/auth/me", { env, bearer: token });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { login: EDITOR });
  assert.equal((await pedir("/auth/me/", { env, bearer: token })).status, 200, "la barra final no cambia la regla");

  const cap = await pedir("/api/archivos/?capacidades=1", { env, bearer: token });
  assert.equal(cap.status, 200);
  assert.deepEqual(await cap.json(), { subida: "directa" });
  assert.equal((await pedir("/api/archivos?capacidades=1", { env, bearer: token })).status, 200);

  const sube = await subir(env, token);
  assert.equal(sube.status, 201, "un editor sube sin Origin");
  assert.deepEqual(await sube.json(), { id: ID, nombre: "placa.drawio", tipo: "drawio" });

  for (const lista of ["/api/archivos/?lista=1&proyecto=uuv", "/api/archivos/?lista=1&proyecto=uuv&disciplina=electronica"]) {
    const res = await pedir(lista, { env, bearer: token });
    assert.equal(res.status, 200, lista);
    const { archivos } = await res.json();
    assert.deepEqual(archivos.map((a) => [a.id, a.subidoPor]), [[ID, EDITOR]], "el autor de la subida es el login del token");
  }
  const baja = await pedir(`/api/archivos/?proyecto=uuv&id=${ID}`, { env, bearer: token });
  assert.equal(baja.status, 200);
  assert.deepEqual(new Uint8Array(await baja.arrayBuffer()), DRAWIO);

  const indice = await pedir(HW, { env, bearer: token });
  assert.equal(indice.status, 200);
  const jIndice = await indice.json();
  assert.equal(jIndice.yo, EDITOR);
  assert.deepEqual(jIndice.paginas.map((p) => p.slug), paginas.map((p) => p.slug));
  const pagina = await pedir(`${HW}&pagina=${paginas[0].slug}`, { env, bearer: token });
  assert.equal(pagina.status, 200);
  assert.equal(typeof (await pagina.json()).pagina.md, "string");
  const noExiste = await pedir(`${HW}&pagina=no-existe`, { env, bearer: token });
  assert.equal(noExiste.status, 404, "permitida por la puerta: responde la ruta");

  assert.equal(llamadas.length, 0, "nada de lo permitido es un asset");
});

test("permitido: quien no es editor lee el hardware de los proyectos a los que su login tiene acceso", async () => {
  const { env } = crearEnv();
  await inicializarHardware(env);
  assert.equal((await subir(env, insertarToken(env, { login: EDITOR }).token)).status, 201);
  const { token } = insertarToken(env, { login: "ana" });

  const indice = await pedir(HW, { env, bearer: token });
  assert.equal(indice.status, 200);
  assert.equal((await indice.json()).editable, false);
  assert.equal((await pedir(`${HW}&pagina=arquitectura`, { env, bearer: token })).status, 200);
  assert.equal((await pedir("/api/archivos/?lista=1&proyecto=uuv", { env, bearer: token })).status, 200);
  assert.equal((await pedir(`/api/archivos/?proyecto=uuv&id=${ID}`, { env, bearer: token })).status, 200);
});

// ---------- Criterio 5: nunca más que el login ----------

test("permisos: el token de subida solo sube donde su login es editor y no entra donde su login no entra", async () => {
  const { env } = crearEnv();
  const lectora = insertarToken(env, { login: "ana" });
  const ajeno = insertarToken(env, { login: "otro" });
  const editor = insertarToken(env, { login: EDITOR });

  const no = await subir(env, lectora.token);
  const { error } = await esDenegadaPorPermiso(no, "subida de quien no es editor");
  assert.equal(error, "Solo los editores pueden subir archivos");
  assert.equal(env.ARCHIVOS.objetos.size, 0, "nada llega a R2");

  // El fixture pone a ana como editora de restringido-demo, pero su login no tiene acceso al proyecto.
  await esDenegadaPorPermiso(await subir(env, lectora.token, { proyecto: "restringido-demo" }), "subida a un proyecto sin acceso");
  for (const path of ["/api/hardware/?proyecto=restringido-demo&disciplina=electronica", "/api/archivos/?lista=1&proyecto=restringido-demo", `/api/archivos/?proyecto=restringido-demo&id=${ID}`]) {
    await esDenegadaPorPermiso(await pedir(path, { env, bearer: ajeno.token }), path);
  }
  assert.equal((await pedir("/api/hardware/?proyecto=restringido-demo&disciplina=electronica", { env, bearer: editor.token })).status, 200, "con acceso, sí");
  assert.equal((await subir(env, editor.token, { disciplina: "no-existe" })).status, 404);
  assert.equal(env.ARCHIVOS.objetos.size, 0);
});

test("permisos: el límite de escrituras por login se comparte entre el token de subida y la cookie", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  for (let i = 0; i < 9; i++) assert.equal((await subir(env, token, { id: uuid(i) })).status, 201, `subida ${i + 1}`);
  const conCookie = await pedir(`/api/archivos/?${qs({ proyecto: "uuv", disciplina: "electronica", id: uuid(9), nombre: "placa.png" })}`, { env, cookie: sesion(EDITOR), method: "POST", headers: { ...BIN, origin: ORIGIN }, body: PNG });
  assert.equal(conCookie.status, 201);
  const once = await subir(env, token, { id: uuid(10) });
  assert.equal(once.status, 429);
  assert.ok(Number(once.headers.get("retry-after")) > 0);
});

test("permisos: cookie de sesión y token de subida a la vez → 400, también en rutas permitidas", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  for (const path of ["/auth/me", "/api/archivos/?capacidades=1", "/uuv/"]) {
    const res = await pedir(path, { env, bearer: token, cookie: sesion(EDITOR) });
    assert.equal(res.status, 400, path);
    assert.deepEqual(await res.json(), { error: "Envía la cookie de sesión o el token, no ambos" });
  }
});

// ---------- Criterio 4: lo denegado, con parámetros ----------

test("denegado: comentarios, escrituras y vistas de editor de hardware, borrado de adjuntos y parámetros fuera de la lista", async () => {
  const { env, llamadas } = crearEnv();
  const paginas = await inicializarHardware(env);
  const { token, id } = insertarToken(env, { login: EDITOR });
  assert.equal((await subir(env, token)).status, 201);
  const slug = paginas[0].slug;
  const hw = (extra) => JSON.stringify({ proyecto: "uuv", disciplina: "electronica", ...extra });
  const antes = env.DB.stats.sql.length;

  const casos = [
    // Comentarios: ni leer ni escribir.
    ["GET", `/api/comentarios/?pagina=${encodeURIComponent("/uuv/arquitectura/")}`],
    ["GET", "/api/comentarios/?proyecto=uuv"],
    ["POST", "/api/comentarios/", JSON.stringify({ pagina: "/uuv/arquitectura/", tipo: "duda", texto: "hola" })],
    ["PATCH", "/api/comentarios/", JSON.stringify({ pagina: "/uuv/arquitectura/", id: ID, resuelto: true })],
    ["DELETE", "/api/comentarios/", JSON.stringify({ pagina: "/uuv/arquitectura/", id: ID })],
    // Hardware: solo índice y página.
    ["GET", `${HW}&papelera=1`],
    ["GET", `${HW}&papelera=0`],
    ["GET", `${HW}&pagina=${slug}&revisiones=1`],
    ["GET", `${HW}&pagina=${slug}&revisiones=0`],
    ["GET", `${HW}&otro=1`],
    ["GET", `${HW}&pagina=${slug}&pagina=potencia`],
    ["GET", `${HW}&proyecto=restringido-demo`],
    ["GET", "/api/hardware/?proyecto=uuv"],
    ["GET", "/api/hardware/?disciplina=electronica"],
    ["GET", "/api/hardware/"],
    ["POST", "/api/hardware/", hw({ accion: "inicializar" })],
    ["POST", "/api/hardware/", hw({ accion: "crear", pagina: "nueva", titulo: "Nueva" })],
    ["POST", "/api/hardware/", hw({ accion: "reordenar", orden: [slug] })],
    ["POST", "/api/hardware/", hw({ accion: "restaurar", pagina: slug, revision: 0, version: 1 })],
    ["POST", "/api/hardware/", hw({ accion: "restaurar-papelera", id: `${slug}:1` })],
    ["POST", "/api/hardware/", hw({ accion: "diagrama", slug, version: 1, fuente: ID, svg: ID })],
    ["POST", HW, hw({ accion: "crear", pagina: "nueva", titulo: "Nueva" })],
    ["PUT", "/api/hardware/", hw({ pagina: slug, titulo: "Otro", md: "# Otro\n", version: 1 })],
    ["DELETE", "/api/hardware/", hw({ pagina: slug, version: 1 })],
    // Archivos: sin borrar y sin parámetros fuera de la lista.
    ["DELETE", "/api/archivos/", JSON.stringify({ proyecto: "uuv", id: ID })],
    ["DELETE", `/api/archivos/?proyecto=uuv&id=${ID}`],
    ["GET", "/api/archivos/"],
    ["GET", "/api/archivos/?proyecto=uuv"],
    ["GET", "/api/archivos/?lista=1"],
    ["GET", "/api/archivos/?capacidades=1&proyecto=uuv"],
    ["GET", `/api/archivos/?proyecto=uuv&id=${ID}&otro=1`],
    ["GET", `/api/archivos/?proyecto=uuv&id=${ID}&id=${uuid(1)}`],
    ["GET", "/api/archivos/?lista=1&proyecto=uuv&papelera=1"],
    ["PUT", `/api/archivos/?proyecto=uuv&id=${ID}`],
    // Variantes de ruta que no son la ruta de la lista.
    ["GET", "/API/ARCHIVOS/?capacidades=1"],
    ["GET", "/Api/Hardware/?proyecto=uuv&disciplina=electronica"],
    ["GET", "/AUTH/ME"],
    ["GET", "//api/archivos/?capacidades=1"],
    ["GET", "/api/archivos%2F?capacidades=1"],
    ["GET", "/api%2Farchivos?capacidades=1"],
    ["GET", "/api/archivos/extra?capacidades=1"],
    ["GET", "/uuv/../api/archivos-otra?capacidades=1"],
  ];
  for (const [method, path, body] of casos) {
    const headers = body ? JSON_CT : {};
    await esDenegada(await pedir(path, { env, bearer: token, method, headers, body }), `${method} ${path}${body ? ` ${body.slice(0, 60)}` : ""}`);
  }
  // Subida con parámetros de más, de menos o repetidos: la puerta la corta antes de leer el cuerpo.
  const base = { proyecto: "uuv", disciplina: "electronica", id: uuid(2), nombre: "placa.png" };
  const subidas = [`${qs(base)}&accion=diagrama`, `${qs(base)}&disciplina=mecanica`, qs({ proyecto: "uuv", disciplina: "electronica", id: uuid(2) }), qs({ proyecto: "uuv", id: uuid(2), nombre: "placa.png" }), ""];
  for (const q of subidas) {
    await esDenegada(await pedir(`/api/archivos/?${q}`, { env, bearer: token, method: "POST", headers: BIN, body: PNG }), `POST /api/archivos/?${q}`);
  }

  assert.equal(llamadas.length, 0, "ningún asset");
  const nuevas = env.DB.stats.sql.slice(antes);
  assert.ok(nuevas.every((s) => /^\s*SELECT\b/i.test(s)), `lo denegado no escribe en D1: ${nuevas.filter((s) => !/^\s*SELECT\b/i.test(s)).join(" ; ")}`);
  assert.equal(nuevas.length, casos.length + subidas.length, "una lectura del token por petición y nada más: la puerta corta antes de llegar a la ruta");
  assert.equal(env.ARCHIVOS.objetos.size, 1, "en R2 sigue solo el adjunto de la preparación");
  assert.ok(filaToken(env, id), "un 403 de la puerta no revoca el token");

  // Lo que la puerta cortó, el mismo login con su cookie sí lo puede hacer: la regla es del token, no del login.
  const conCookie = await pedir(`${HW}&papelera=1`, { env, cookie: sesion(EDITOR) });
  assert.equal(conCookie.status, 200);
});

// ---------- Criterios 2 y 4: recorrido de todas las rutas (falla cerrado) ----------

// Rutas del Worker, sin barra final. Las cuatro últimas no existen: representan una ruta futura.
const RUTAS = [
  "/",
  "/uuv",
  "/uuv/grafo",
  "/uuv/software",
  "/uuv/wiki",
  "/uuv/content/x",
  "/uuv/arch/general.html",
  "/uuv/hardware/electronica",
  "/restringido-demo",
  "/_astro/app.js",
  "/pagefind/pagefind.js",
  "/favicon.svg",
  "/404.html",
  "/auth/login",
  "/auth/callback",
  "/auth/logout",
  "/auth/signed-out",
  "/auth/dispositivos",
  "/auth/dispositivos/revocar",
  "/auth/dispositivos/token",
  "/auth/app/iniciar",
  "/auth/app/autorizar",
  "/auth/app/dispositivos",
  "/auth/app/revocar",
  "/auth/me",
  "/api",
  "/api/comentarios",
  "/api/archivos",
  "/api/hardware",
  "/auth/nueva",
  "/auth/app/nueva",
  "/api/nueva",
  "/api/hardware/nueva",
];
// Pública por diseño (1A): no mira cookie, Bearer ni Origin, así que la puerta no la alcanza.
const RUTA_PUBLICA = "/auth/app/canje";
const METODOS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
// Sin parámetros, lo único de la lista blanca: las rutas de /api piden parámetros exactos (test de arriba).
const PERMITIDAS_SIN_PARAMETROS = new Set(["GET /auth/me", "POST /auth/app/revocar"]);

test("recorrido: la tabla de rutas del test incluye todas las rutas /auth y /api que nombra el código (guarda)", () => {
  const dirLib = fileURLToPath(new URL("../lib/", import.meta.url));
  const fuentes = [...readdirSync(dirLib).filter((f) => f.endsWith(".mjs")).map((f) => `${dirLib}${f}`), fileURLToPath(new URL("../worker/index.mjs", import.meta.url))];
  const nombradas = new Set();
  for (const f of fuentes) {
    for (const m of readFileSync(f, "utf8").matchAll(/["'`](\/(?:auth|api)(?:\/[a-z-]+)*)/g)) nombradas.add(m[1]);
  }
  assert.ok(nombradas.has("/auth/me") && nombradas.has("/api/hardware") && nombradas.has("/auth/app/autorizar"), "el rastreo encuentra las rutas");
  const conocidas = new Set([...RUTAS, RUTA_PUBLICA, "/auth", "/auth/app"]);
  const faltan = [...nombradas].filter((r) => !conocidas.has(r));
  assert.deepEqual(faltan, [], "ruta nueva en el código: añádela a RUTAS y decide si entra en la lista blanca del token de subida");
});

test("recorrido: con un token de subida, cada ruta y método del Worker da 403 salvo la lista blanca", async () => {
  const { env, llamadas } = crearEnv();
  await inicializarHardware(env);
  const { token, id } = insertarToken(env, { login: EDITOR });
  // Primer uso: anota ultimo_uso. A partir de aquí, dentro de la hora, cada petición es una sola lectura.
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200);
  const tokensAntes = cuantosTokens(env);
  const antes = env.DB.stats.sql.length;
  const cuerpo = JSON.stringify({ proyecto: "uuv", disciplina: "electronica", accion: "inicializar", pagina: "/uuv/arquitectura/", tipo: "duda", texto: "hola", id: ID });

  let peticiones = 0;
  const abiertas = [];
  for (const ruta of RUTAS) {
    for (const path of ruta === "/" ? ["/"] : [ruta, `${ruta}/`]) {
      for (const method of METODOS) {
        const clave = `${method} ${ruta}`;
        if (clave === "POST /auth/app/revocar") continue; // se comprueba al final: revoca el token
        const conCuerpo = method !== "GET" && method !== "HEAD";
        const res = await pedir(path, { env, bearer: token, method, headers: conCuerpo ? JSON_CT : {}, body: conCuerpo ? cuerpo : undefined });
        peticiones++;
        if (PERMITIDAS_SIN_PARAMETROS.has(clave)) {
          assert.equal(res.status, 200, `${method} ${path}: está en la lista blanca`);
          abiertas.push(clave);
        } else {
          await esDenegada(res, `${method} ${path}`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(abiertas)], ["GET /auth/me"]);
  assert.equal(llamadas.length, 0, "ningún asset (wiki, software, portal) se sirve con un token de subida");
  const nuevas = env.DB.stats.sql.slice(antes);
  assert.ok(nuevas.every((s) => /^\s*SELECT\b/i.test(s)), `ninguna escritura en D1: ${nuevas.filter((s) => !/^\s*SELECT\b/i.test(s)).join(" ; ")}`);
  assert.equal(nuevas.length, peticiones, "una lectura del token por petición y nada más");
  assert.equal(cuantosTokens(env), tokensAntes);

  // La ruta pública del canje responde lo mismo con token de subida que sin credencial: ni lo mira ni lo premia.
  const cuerpoCanje = JSON.stringify({ code: "x", verifier: "y" });
  const sinNada = await pedir(RUTA_PUBLICA, { env, method: "POST", headers: JSON_CT, body: cuerpoCanje });
  const conToken = await pedir(RUTA_PUBLICA, { env, method: "POST", headers: JSON_CT, body: cuerpoCanje, bearer: token });
  assert.equal(conToken.status, sinNada.status);
  assert.equal(await conToken.text(), await sinNada.text());

  // Lo único que el token puede escribir fuera de la subida: revocarse a sí mismo.
  for (const path of ["/auth/app/revocar/", "/auth/app/revocar"]) {
    const res = await pedir(path, { env, bearer: path.endsWith("/") ? insertarToken(env, { login: EDITOR }).token : token, method: "POST" });
    assert.equal(res.status, 200, `POST ${path}`);
    assert.deepEqual(await res.json(), { ok: true });
  }
  assert.equal(filaToken(env, id), undefined);
});

test("recorrido: un token de dispositivo no pasa por la puerta (las mismas rutas siguen abiertas para la app)", async () => {
  const { env, llamadas } = crearEnv();
  await inicializarHardware(env);
  const { token } = await emitir(env, { login: EDITOR });
  assert.equal((await pedir("/uuv/grafo/", { env, bearer: token })).status, 200);
  assert.equal(llamadas.length, 1);
  assert.equal((await pedir(`/api/comentarios/?pagina=${encodeURIComponent("/uuv/arquitectura/")}`, { env, bearer: token })).status, 200);
  assert.equal((await pedir(`${HW}&papelera=1`, { env, bearer: token })).status, 200);
  assert.equal((await pedir(`${HW}&pagina=arquitectura&revisiones=1`, { env, bearer: token })).status, 200);
  assert.equal((await pedir("/auth/app/dispositivos", { env, bearer: token })).status, 200);
  const navegador = await pedir("/auth/login", { env, bearer: token });
  assert.equal(navegador.status, 400, "rutas de navegador con token de dispositivo: el 400 del 1B-1");
  assert.deepEqual(await navegador.json(), { error: "Ruta solo para navegador" });
});

// ---------- Criterio 6: refuerzo en exigirSesion ----------

test("refuerzo: un token de subida que no pasó por la puerta no abre ninguna API (exigirSesion → 403)", async () => {
  const { env } = crearEnv();
  const subida = insertarToken(env, { login: EDITOR });
  const { exigirSesion, HttpError } = await import("../lib/api-comun.mjs");
  const e = { SESSION_SECRET: SECRET, DB: env.DB };
  const peticion = (path, token) => new Request(`${ORIGIN}${path}`, { headers: { authorization: `Bearer ${token}` } });

  // Ni siquiera para una ruta que la puerta sí permitiría: quien decide es la puerta de manejarLogin, no la URL.
  for (const path of ["/api/archivos/?capacidades=1", "/api/hardware/?proyecto=uuv&disciplina=electronica", "/api/nueva"]) {
    await assert.rejects(
      () => exigirSesion(peticion(path, subida.token), e),
      (err) => err instanceof HttpError && err.status === 403 && err.extra?.codigo === "alcance",
      `exigirSesion directo en ${path}`,
    );
  }

  // Los handlers llamados sin pasar por manejarLogin (defensa en profundidad del 1A) quedan cerrados.
  const { clienteD1 } = await import("../lib/almacen-d1.mjs");
  const proyectos = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] } } }];
  const hardware = (await import("../lib/hardware-core.mjs")).crearHandler({ env: e, redis: clienteD1(env.DB), proyectos, plantillas: { electronica: [] }, restringidos: {} });
  await esDenegada(await hardware(peticion("/api/hardware/?proyecto=uuv&disciplina=electronica", subida.token)), "handler de hardware llamado sin pasar por manejarLogin");
  const comentarios = (await import("../lib/comentarios-core.mjs")).crearHandler({ env: e, redis: clienteD1(env.DB), proyectos, restringidos: {} });
  const res = await comentarios(peticion(`/api/comentarios/?pagina=${encodeURIComponent("/uuv/arquitectura/")}`, subida.token));
  assert.equal(res.status, 403, "handler de comentarios llamado sin pasar por manejarLogin");

  // El de dispositivo sigue entrando por exigirSesion sin puerta, como en el 1A.
  const app = await emitir(env, { login: "ana" });
  assert.equal(await exigirSesion(peticion("/api/nueva", app.token), e), "ana");
});
