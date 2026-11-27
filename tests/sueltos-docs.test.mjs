// Lote «sueltos-docs». Ver .factory/spec.md.
// D1–D3: README alineado con el código (comprobarAcceso, revocación a mano completa, cuándo sale «Tokens de subida»).
// K1–K2: «/» no abre la búsqueda con el foco dentro de un componente con shadow DOM (visor KiCad), igual que «?».
// E1:    esbuild, que importan los tests, figura en devDependencies con la versión exacta que ya resuelve el lock.
// R1–R2: una sola normalización de la barra final, compartida por la puerta G1 (login) y el despacho del Worker.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as atajosLib from "../src/lib/atajos.ts";
import { T0, EDITOR, crearEnv, pedir, sesion, insertarToken } from "./fixtures/subida.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ---------- D1–D3. README ----------
const README = read("README.md");

test("D1 README: nombra comprobarAcceso (la función real de lib/login-core.mjs), no isAllowed", () => {
  assert.doesNotMatch(README, /\bisAllowed\b/, "isAllowed no existe en el código");
  assert.match(README, /`comprobarAcceso`/);
  assert.match(read("lib/login-core.mjs"), /async function comprobarAcceso\(/, "guarda: la función sigue llamándose así");
});

test("D2 README: la revocación a mano borra también los códigos pendientes de codigos_app de ese login", () => {
  const bloques = [...README.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const bloque = bloques.find((b) => b.includes("DELETE FROM tokens WHERE lower(login) = 'login-en-minusculas'"));
  assert.ok(bloque, "falta el bloque de revocación a mano");
  assert.match(
    bloque,
    /npx wrangler d1 execute docs-site --remote --command "DELETE FROM codigos_app WHERE lower\(login\) = 'login-en-minusculas'"/,
    "mismo login en minúsculas, misma base y en el mismo bloque",
  );
  // guarda: la columna existe en el esquema.
  const esquema = read("migrations/0002_tokens.sql");
  assert.match(esquema.slice(esquema.indexOf("CREATE TABLE IF NOT EXISTS codigos_app")), /^\s*login TEXT NOT NULL,/m);
});

test("D3 README: «Crear un token de subida» dice que la sección también sale a quien conserva tokens vivos sin ser editor (solo para revocarlos)", () => {
  const item = README.split("\n").find((l) => l.startsWith("- **Crear un token de subida.**"));
  assert.ok(item, "falta el punto «Crear un token de subida»");
  assert.doesNotMatch(item, /debajo de los dispositivos, los editores de hardware ven la sección «Tokens de subida»:/, "ya no la ven solo los editores");
  assert.match(item, /tokens de subida vivos/i, "quien conserva tokens vivos (no caducados) también la ve");
  assert.match(item, /ya no (es|sea) editor/i, "aunque ya no sea editor");
  assert.match(item, /sin (el )?formulario|no (ve|tiene|aparece) el formulario|solo (puede )?revoca/i, "sin el formulario: solo la lista y «Revocar»");
  // guarda: es lo que hace el código.
  const core = read("lib/login-core.mjs");
  assert.match(core, /if \(editor \|\| tokens\.length\) \{/);
  assert.match(read("lib/dispositivos-core.mjs"), /tipo = 'subida' AND expira > \?/, "listarTokensSubida solo cuenta los vivos");
});

// ---------- K1–K2. «/» y el shadow DOM ----------
function pagina({ modo = "open" } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
    <button id="fuera">b</button><input id="campo">
    <astro-island id="isla"><button id="boton-isla">b</button><input id="input-isla"></astro-island>
    <visor-kicad id="visor"></visor-kicad><visor-foco id="host" tabindex="0"></visor-foco>
    <dialog class="search-dialog" id="search"><div class="search-bar"><button type="button" data-search-close>×</button></div>
      <div id="pagefind"></div><div class="search-extra" data-search-extra hidden><div data-bloque-recientes hidden><ul data-recientes></ul>
      <button type="button" data-borrar-recientes hidden>Borrar</button></div></div></dialog>
    </body></html>`,
    { url: "https://docs.example/uuv/electronica/" },
  );
  const w = dom.window;
  const doc = w.document;
  let raiz = null;
  w.customElements.define("visor-kicad", class extends w.HTMLElement {
    constructor() {
      super();
      raiz = this.attachShadow({ mode: modo });
      raiz.innerHTML = `<button id="zoom">z</button><input id="dentro">`;
    }
  });
  w.customElements.define("visor-foco", class extends w.HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: modo }).innerHTML = `<canvas></canvas>`;
    }
  });
  // jsdom no implementa showModal()/close(): los imita con el atributo open.
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const pulsar = (origen, opciones = { key: "/" }) => {
    origen.focus();
    const e = new w.KeyboardEvent("keydown", { bubbles: true, composed: true, cancelable: true, ...opciones });
    origen.dispatchEvent(e);
    return e;
  };
  return { dom, w, doc, raiz: () => raiz, pulsar };
}

let guionBusqueda;
function conBusqueda(opciones) {
  guionBusqueda ??= buildSync({ entryPoints: [fileURLToPath(new URL("../src/scripts/busqueda.ts", import.meta.url))], bundle: true, write: false, format: "iife", platform: "neutral" }).outputFiles[0].text;
  const p = pagina(opciones);
  const { w, doc } = p;
  new Function("window", "document", "localStorage", "navigator", "setTimeout", guionBusqueda)(w, doc, w.localStorage, w.navigator, w.setTimeout);
  const search = doc.getElementById("search");
  const cerrar = () => search.removeAttribute("open");
  return { ...p, search, cerrar };
}

test("K1 busqueda.ts: «/» abre la búsqueda en una página normal, pero no al escribir en un campo", () => {
  const { doc, search, cerrar, pulsar } = conBusqueda();
  const e = pulsar(doc.getElementById("fuera"));
  assert.equal(search.open, true, "foco en un botón normal: «/» abre la búsqueda");
  assert.equal(e.defaultPrevented, true, "y no escribe la barra en ningún sitio");
  cerrar();
  pulsar(doc.body);
  assert.equal(search.open, true, "sin foco en nada también abre");
  cerrar();
  pulsar(doc.getElementById("campo"));
  assert.equal(search.open, false, "escribiendo en un input: no abre");
});

test("K1 busqueda.ts: con el foco dentro del visor (shadow DOM abierto), en un campo de su shadow DOM o en el anfitrión, «/» no abre la búsqueda", () => {
  const { doc, search, raiz, pulsar } = conBusqueda();
  const e = pulsar(raiz().getElementById("zoom"));
  assert.equal(search.open, false, "botón «zoom» dentro del visor: no abre");
  assert.equal(e.defaultPrevented, false, "y el visor recibe la tecla");
  pulsar(raiz().getElementById("dentro"));
  assert.equal(search.open, false, "input dentro del shadow DOM: no abre");
  pulsar(doc.getElementById("host"));
  assert.equal(search.open, false, "anfitrión enfocado (tabindex): no abre");
});

test("K1 busqueda.ts: con shadow root cerrado (e.target es el anfitrión) «/» tampoco abre la búsqueda", () => {
  const { search, raiz, pulsar } = conBusqueda({ modo: "closed" });
  pulsar(raiz().getElementById("zoom"));
  assert.equal(search.open, false, "botón dentro de un shadow root cerrado");
  pulsar(raiz().getElementById("dentro"));
  assert.equal(search.open, false, "input dentro de un shadow root cerrado");
});

test("K1 busqueda.ts: Ctrl+K no cambia (abre también dentro de un campo y del visor) y con la búsqueda abierta «/» no hace nada", () => {
  const { doc, search, cerrar, raiz, pulsar } = conBusqueda();
  pulsar(doc.getElementById("campo"), { key: "k", ctrlKey: true });
  assert.equal(search.open, true, "Ctrl+K desde un input");
  cerrar();
  pulsar(raiz().getElementById("zoom"), { key: "k", ctrlKey: true });
  assert.equal(search.open, true, "Ctrl+K desde el visor");
  const e = pulsar(doc.getElementById("fuera"));
  assert.equal(e.defaultPrevented, false, "con el diálogo abierto «/» no se intercepta");
});

test("K1 busqueda.ts: decide «/» con escribiendoEn(e) || enComponente(e) de src/lib/atajos.ts, no con e.target.closest", () => {
  const s = read("src/scripts/busqueda.ts");
  assert.match(s, /import \{[^}]*\benComponente\b[^}]*\} from "\.\.\/lib\/atajos(\.ts)?"/);
  assert.match(s, /import \{[^}]*\bescribiendoEn\b[^}]*\} from "\.\.\/lib\/atajos(\.ts)?"/);
  assert.match(s, /escribiendoEn\(e\)\s*\|\|\s*enComponente\(e\)/);
  assert.doesNotMatch(s, /\(e\.target as HTMLElement\)\.closest\(/, "e.target es el anfitrión con shadow DOM: no ve dentro");
});

test("K2 enComponente: un custom element sin shadow DOM como astro-island no cuenta (sus botones y campos se tratan como los de fuera)", () => {
  const { doc, pulsar } = pagina();
  const decide = (el) => {
    let r = null;
    const oir = (e) => (r = { comp: atajosLib.enComponente(e), escribe: atajosLib.escribiendoEn(e) });
    doc.addEventListener("keydown", oir);
    pulsar(el);
    doc.removeEventListener("keydown", oir);
    return r;
  };
  assert.deepEqual(decide(doc.getElementById("boton-isla")), { comp: false, escribe: false }, "botón dentro de astro-island: «/» y «?» siguen");
  assert.deepEqual(decide(doc.getElementById("input-isla")), { comp: false, escribe: true }, "input dentro de astro-island: lo cubre escribiendoEn");
  // Con shadow root cerrado no hay otra señal que el guion del nombre: el anfitrión enfocado sí cuenta.
  assert.equal(decide(doc.getElementById("host")).comp, true);
});

test("K2 busqueda.ts: dentro de astro-island un botón deja abrir la búsqueda con «/» y un input no", () => {
  const { doc, search, cerrar, pulsar } = conBusqueda();
  pulsar(doc.getElementById("boton-isla"));
  assert.equal(search.open, true);
  cerrar();
  pulsar(doc.getElementById("input-isla"));
  assert.equal(search.open, false);
});

// ---------- E1. esbuild en devDependencies ----------
test("E1 package.json: esbuild (lo importan los tests) está en devDependencies con la versión exacta que resuelve el lock", () => {
  const pkg = JSON.parse(read("package.json"));
  const lock = JSON.parse(read("package-lock.json"));
  const resuelta = lock.packages["node_modules/esbuild"]?.version;
  assert.match(resuelta ?? "", /^\d+\.\d+\.\d+$/, "el lock ya resuelve esbuild");
  assert.equal(pkg.devDependencies?.esbuild, resuelta, "versión exacta, sin ^ ni ~");
  assert.equal(lock.packages[""].devDependencies?.esbuild, resuelta, "el lock refleja la dependencia directa");
  assert.equal(pkg.dependencies?.esbuild, undefined, "solo de desarrollo");
  for (const t of ["tests/c1-diagramas-revision.test.mjs", "tests/d2a-hw-portal.test.mjs", "tests/sueltos-teclado.test.mjs"]) {
    assert.match(read(t), /from "esbuild"/, `guarda: ${t} importa esbuild`);
  }
});

// ---------- R1–R2. Barra final: una sola normalización ----------
const MOD = "lib/normalizar-ruta.mjs";

test("R1 lib/normalizar-ruta.mjs: sinBarraFinal quita todas las barras finales y deja «/» para la raíz; nada más", async () => {
  assert.ok(existsSync(fileURLToPath(new URL(`../${MOD}`, import.meta.url))), `falta ${MOD}`);
  const { sinBarraFinal } = await import(`../${MOD}`);
  assert.equal(typeof sinBarraFinal, "function");
  const casos = [
    ["/api/archivos", "/api/archivos"],
    ["/api/archivos/", "/api/archivos"],
    ["/api/archivos//", "/api/archivos"],
    ["/auth/me///", "/auth/me"],
    ["/", "/"],
    ["//", "/"],
    ["", "/"],
    // Solo el final: lo de dentro no se toca (la lista blanca compara por igualdad y lo deja cerrado).
    ["/api//archivos", "/api//archivos"],
    ["/api/archivos%2F", "/api/archivos%2F"],
    ["/API/archivos/", "/API/archivos"],
  ];
  for (const [entrada, salida] of casos) assert.equal(sinBarraFinal(entrada), salida, JSON.stringify(entrada));
});

test("R1 login-core y Worker usan la misma función: sin copias de la regla", () => {
  const core = read("lib/login-core.mjs");
  const worker = read("worker/index.mjs");
  for (const [nombre, src, ruta] of [["lib/login-core.mjs", core, "./normalizar-ruta.mjs"], ["worker/index.mjs", worker, "../lib/normalizar-ruta.mjs"]]) {
    assert.match(src, new RegExp(`import \\{[^}]*\\bsinBarraFinal\\b[^}]*\\} from "${ruta.replace(/\./g, "\\.")}"`), `${nombre} importa sinBarraFinal`);
    assert.match(src, /sinBarraFinal\(/, `${nombre} la usa`);
  }
  assert.doesNotMatch(core, /pathname\.replace\(/, "login-core ya no normaliza por su cuenta");
  assert.doesNotMatch(worker, /path === "\/api\/(comentarios|archivos|hardware)\/"/, "el Worker ya no lista la variante con una barra a mano");
  assert.match(read("lib/alcance-subida.mjs"), /sinBarraFinal/, "el comentario de la lista blanca nombra la función de la que depende");
});

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

const resumen = async (res) => ({ status: res.status, cuerpo: res.headers.get("content-type")?.includes("json") ? (await res.json()) : await res.text() });

test("R2 Worker: /api/archivos, /api/archivos/ y /api/archivos// responden lo mismo, con cookie y con token de subida", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  for (const cred of [{ cookie: sesion(EDITOR) }, { bearer: token }]) {
    const que = cred.cookie ? "cookie" : "token de subida";
    const base = await resumen(await pedir("/api/archivos?capacidades=1", { env, ...cred }));
    assert.equal(base.status, 200, `${que}: preparación`);
    for (const ruta of ["/api/archivos/?capacidades=1", "/api/archivos//?capacidades=1", "/api/archivos///?capacidades=1"]) {
      assert.deepEqual(await resumen(await pedir(ruta, { env, ...cred })), base, `${que}: ${ruta}`);
    }
  }
  const hw = (r) => pedir(`${r}?proyecto=uuv&disciplina=electronica`, { env, cookie: sesion(EDITOR) });
  assert.equal((await hw("/api/hardware//")).status, (await hw("/api/hardware")).status, "también /api/hardware//");
});

test("R2 seguridad: con token de subida lo que no está en la lista sigue cerrado, con o sin barras finales", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  for (const ruta of ["/api/comentarios//?proyecto=uuv", "/api//archivos?capacidades=1", "/api/archivos%2F?capacidades=1", "/api/archivos/x//?capacidades=1", "/auth/dispositivos//"]) {
    const res = await pedir(ruta, { env, bearer: token });
    assert.equal(res.status, 403, ruta);
    assert.equal((await res.json()).codigo, "alcance", ruta);
  }
  // Rutas que no existen siguen en 404 con cookie.
  assert.equal((await pedir("/api/archivos/x//", { env, cookie: sesion(EDITOR) })).status, 404);
  assert.equal((await pedir("/api//archivos", { env, cookie: sesion(EDITOR) })).status, 404);
});
