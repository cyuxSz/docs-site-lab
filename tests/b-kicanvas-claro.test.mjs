// Lote b-kicanvas-claro (revisado tras la verificación en navegador).
// Hechos comprobados con el bundle real: el atributo theme="…" de <kicanvas-embed> NO cambia el lienzo. El tema solo se
// aplica en el visor interno (<kc-schematic-viewer> / <kc-board-viewer>, dentro de los shadow roots anidados del embed):
//   v.theme = "kicad"; v.update_theme(); v.viewer.paint(); v.viewer.draw();   // con v.loaded === true
// en caliente, sin recrear el embed ni volver a descargar. El bundle no trae tema claro de PCB: la placa recibe el mismo
// tema pero no lleva botón. Aquí el visor interno es un doble: un custom element "kicanvas-embed" definido en jsdom que,
// como el real, abre su shadow root al conectarse y crea el visor interno después (primero sin cargar, luego loaded).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const md = () => import("../src/lib/hardware-md.ts");
const fondo = () => import("../src/lib/kicad-fondo.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const bloque = (cuerpo) => "```kicad\n" + cuerpo + "\n```\n";
const SCH = "(kicad_sch\n  (version 20251024)\n  (generator \"eeschema\")\n)\n";
const PCB = "(kicad_pcb (version 20251024) (generator \"pcbnew\"))\n";
const CLARO = "kicad";
const OSCURO = "witchhazel";
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, mensaje, ms = 1500) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() > fin) assert.fail(`no ocurrió a tiempo: ${mensaje}`);
    await pausa(10);
  }
}

// Doble del visor interno de KiCanvas. `registro` guarda lo que el portal le hizo.
function crearVisorDoble(win, { pcb = false, sinMetodos = false } = {}) {
  const el = win.document.createElement(pcb ? "kc-board-viewer" : "kc-schematic-viewer");
  const registro = { el, pcb, llamadas: [], antesDeCargar: [] };
  const anotar = (nombre) => () => {
    registro.llamadas.push(nombre);
    if (!el.loaded) registro.antesDeCargar.push(nombre);
  };
  el.theme = null;
  el.loaded = false;
  if (!sinMetodos) {
    el.update_theme = anotar("update_theme");
    el.viewer = { paint: anotar("paint"), draw: anotar("draw") };
  }
  return registro;
}
const cargar = (win, registro) => {
  registro.el.loaded = true;
  // Como el real: KiCanvasLoadEvent es composed y no burbujea.
  registro.el.dispatchEvent(new win.Event("kicanvas:load", { composed: true, bubbles: false }));
};
// Define "kicanvas-embed" como lo hace kicanvas.js: shadow root abierto al conectarse; dentro, <kc-*-app> con su propio
// shadow root y, en él, el visor interno, que aparece tras `retraso` ms y queda `loaded` otros `retraso` ms después.
function definirDoble(win, { retraso = 5, sinMetodos = false, nuncaCarga = false, sinVisor = false } = {}) {
  const visores = [];
  win.customElements.define(
    "kicanvas-embed",
    class extends win.HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const raiz = this.attachShadow({ mode: "open" });
        if (sinVisor) return;
        setTimeout(() => {
          const pcb = /^\s*\(kicad_pcb/.test(this.querySelector("kicanvas-source")?.textContent ?? "");
          const app = win.document.createElement(pcb ? "kc-board-app" : "kc-schematic-app");
          const registro = crearVisorDoble(win, { pcb, sinMetodos });
          registro.embed = this;
          app.attachShadow({ mode: "open" }).appendChild(registro.el);
          raiz.appendChild(app);
          visores.push(registro);
          if (!nuncaCarga) setTimeout(() => cargar(win, registro), retraso);
        }, retraso);
      }
    },
  );
  return visores;
}
// `doble: false` deja "kicanvas-embed" sin definir (como si el bundle no expusiera nada).
function ventana({ doble = {} } = {}) {
  const win = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
  win.visores = doble ? definirDoble(win, doble) : [];
  return win;
}

function falsoKicad(texto = SCH, { webgl2 = true } = {}) {
  const llamadas = { script: 0, urls: [] };
  return {
    llamadas,
    kicad: {
      cargarScript: async () => {
        llamadas.script++;
      },
      leer: async (url) => {
        llamadas.urls.push(url);
        if (texto instanceof Error) throw texto;
        return typeof texto === "function" ? texto(url) : texto;
      },
      webgl2: () => webgl2,
    },
  };
}
const porUrl = (url) => (url.includes(C) ? PCB : SCH); // A y B → esquemático, C → PCB
const opciones = (extra = {}) => ({ proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {}, ...extra });

async function montar(win, texto, f = falsoKicad(), extra = {}) {
  const { crearRenderizador, montarVisores } = await md();
  const { kicad: extraKicad, ...resto } = extra;
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  await montarVisores(win.document.body, texto, opciones({ kicad: { ...f.kicad, ...extraKicad }, ...resto }));
  return f;
}
const botones = (win) => [...win.document.querySelectorAll("figure.hw-kicad button")];
const hayBotones = (win) => () => (botones(win).length ? botones(win) : null);
const embeds = (win) => [...win.document.querySelectorAll("figure.hw-kicad kicanvas-embed")];
// Visores internos de los embeds que siguen en la página, en orden de documento, con su tema vigente.
const vivos = (win) => embeds(win).map((e) => win.visores.find((v) => v.embed === e)).filter(Boolean);
const temas = (win) => vivos(win).map((v) => v.el.theme);
const temasSon = (win, esperado) => () => vivos(win).length === esperado.length && temas(win).every((t, i) => t === esperado[i]);
const repintados = (v) => v.llamadas.filter((n) => n === "draw").length;
const clavesPropias = (win) => Object.keys(win.localStorage).filter((k) => k !== "kc:prefs");

// ---------- C1. Claro por defecto: el tema va al visor interno ----------

test("C1: sin preferencia, el visor interno del esquemático recibe theme=\"kicad\" y se repinta (update_theme, paint, draw) ya cargado", async () => {
  const win = ventana({ doble: { retraso: 40 } });
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "theme=kicad en <kc-schematic-viewer>");
  const [v] = win.visores;
  await hasta(() => ["update_theme", "paint", "draw"].every((n) => v.llamadas.includes(n)), "update_theme + paint + draw");
  assert.equal(v.el.loaded, true);
  assert.ok(!v.antesDeCargar.includes("paint") && !v.antesDeCargar.includes("draw"), "no se pinta antes de loaded");
  const ultima = (n) => v.llamadas.lastIndexOf(n);
  assert.ok(ultima("update_theme") < ultima("paint") && ultima("paint") < ultima("draw"), "orden: update_theme → paint → draw");
});

test("C1: el tema del visor no depende del tema del portal (claro u oscuro)", async () => {
  for (const temaPortal of ["light", null]) {
    const win = ventana();
    if (temaPortal) win.document.documentElement.dataset.theme = temaPortal;
    await montar(win, bloque(`archivo: ${A}`));
    await hasta(temasSon(win, [CLARO]), `portal ${temaPortal ?? "oscuro"}`);
  }
});

test("C1: no basta el atributo theme del embed; el tema llega al visor interno sin usar las preferencias de KiCanvas (kc:prefs)", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "theme en el visor interno");
  assert.equal(win.localStorage.getItem("kc:prefs"), null);
});

// ---------- C2. Acceso aislado y defensivo a los internos (src/lib/kicad-fondo.ts) ----------

test("C2: visorInternoKicad(embed) encuentra <kc-schematic-viewer> o <kc-board-viewer> en shadow roots anidados; null si no hay", async () => {
  const { visorInternoKicad } = await fondo();
  assert.equal(typeof visorInternoKicad, "function");
  const win = ventana({ doble: false });
  for (const pcb of [false, true]) {
    const embed = win.document.createElement("kicanvas-embed");
    const app = win.document.createElement(pcb ? "kc-board-app" : "kc-schematic-app");
    const medio = win.document.createElement("div");
    const { el } = crearVisorDoble(win, { pcb });
    medio.appendChild(el);
    app.attachShadow({ mode: "open" }).appendChild(medio);
    embed.attachShadow({ mode: "open" }).appendChild(app);
    assert.equal(visorInternoKicad(embed), el, pcb ? "pcb" : "esquemático");
  }
  const vacio = win.document.createElement("kicanvas-embed");
  vacio.attachShadow({ mode: "open" });
  assert.equal(visorInternoKicad(vacio), null, "shadow root sin visor");
  assert.equal(visorInternoKicad(win.document.createElement("kicanvas-embed")), null, "sin shadow root");
  assert.equal(visorInternoKicad(null), null);
  assert.equal(visorInternoKicad({}), null);
});

test("C2: aplicarTemaVisorKicad(visor, tema) asigna theme y llama update_theme → paint → draw; devuelve true", async () => {
  const { aplicarTemaVisorKicad } = await fondo();
  assert.equal(typeof aplicarTemaVisorKicad, "function");
  const win = ventana({ doble: false });
  const v = crearVisorDoble(win);
  v.el.loaded = true;
  assert.equal(aplicarTemaVisorKicad(v.el, CLARO), true);
  assert.equal(v.el.theme, CLARO);
  assert.deepEqual(v.llamadas, ["update_theme", "paint", "draw"]);
  assert.equal(aplicarTemaVisorKicad(v.el, OSCURO), true);
  assert.equal(v.el.theme, OSCURO);
});

test("C2: defensivo; visor sin cargar, sin update_theme, sin viewer.paint o sin viewer.draw → false, sin tocar theme ni pintar", async () => {
  const { aplicarTemaVisorKicad } = await fondo();
  assert.equal(typeof aplicarTemaVisorKicad, "function");
  const win = ventana({ doble: false });
  const sinCargar = crearVisorDoble(win);
  assert.equal(aplicarTemaVisorKicad(sinCargar.el, CLARO), false);
  assert.deepEqual(sinCargar.llamadas, [], "sin loaded no se llama a nada");
  const rotos = [
    ["sin métodos", (el) => { delete el.update_theme; delete el.viewer; }],
    ["update_theme no es función", (el) => { el.update_theme = "x"; }],
    ["sin viewer", (el) => { el.viewer = null; }],
    ["sin viewer.paint", (el) => { delete el.viewer.paint; }],
    ["viewer.draw no es función", (el) => { el.viewer.draw = 1; }],
  ];
  for (const [nombre, romper] of rotos) {
    const v = crearVisorDoble(win);
    v.el.loaded = true;
    romper(v.el);
    assert.equal(aplicarTemaVisorKicad(v.el, CLARO), false, nombre);
    assert.equal(v.el.theme, null, `${nombre}: theme intacto`);
    assert.deepEqual(v.llamadas, [], `${nombre}: no llama a nada`);
  }
  assert.equal(aplicarTemaVisorKicad(null, CLARO), false);
  assert.equal(aplicarTemaVisorKicad(undefined, CLARO), false);
  assert.equal(aplicarTemaVisorKicad({}, CLARO), false);
});

test("C2: si un interno lanza (update_theme, paint o draw), aplicarTemaVisorKicad no propaga el error y devuelve false", async () => {
  const { aplicarTemaVisorKicad } = await fondo();
  assert.equal(typeof aplicarTemaVisorKicad, "function");
  const win = ventana({ doble: false });
  for (const cual of ["update_theme", "paint", "draw"]) {
    const v = crearVisorDoble(win);
    v.el.loaded = true;
    const lanzar = () => {
      throw new Error("interno roto");
    };
    if (cual === "update_theme") v.el.update_theme = lanzar;
    else v.el.viewer[cual] = lanzar;
    let r;
    assert.doesNotThrow(() => {
      r = aplicarTemaVisorKicad(v.el, CLARO);
    }, cual);
    assert.equal(r, false, cual);
  }
});

test("C2: hardware-md.ts no toca los internos de KiCanvas por su cuenta (update_theme, paint/draw y kc-*-viewer solo en kicad-fondo.ts)", () => {
  const fuente = leer("src/lib/hardware-md.ts");
  assert.doesNotMatch(fuente, /update_theme|kc-schematic-viewer|kc-board-viewer|\.viewer\.(paint|draw)/);
  const modulo = leer("src/lib/kicad-fondo.ts");
  assert.match(modulo, /typeof[^;\n]*update_theme/);
  assert.match(modulo, /kc-schematic-viewer/);
  assert.match(modulo, /kc-board-viewer/);
});

// ---------- C3. Esquemático: botón «Fondo oscuro» que alterna en caliente ----------

test("C3: un <button type=button class=btn> por esquemático, dentro de figure.hw-kicad, tras los enlaces y antes del figcaption", async () => {
  const win = ventana();
  const texto = `${bloque(`archivo: ${A}\nrespaldo: ${B}\ntitulo: Potencia`)}\n${bloque(`archivo: ${B}`)}`;
  const f = await montar(win, texto);
  await hasta(temasSon(win, [CLARO, CLARO]), "tema aplicado a los dos esquemáticos");
  await hasta(() => botones(win).length === 2, "un botón por esquemático");
  const { montarVisores } = await md();
  await montarVisores(win.document.body, texto, opciones({ kicad: f.kicad })); // idempotente
  await pausa(150);
  const figs = [...win.document.querySelectorAll("figure.hw-kicad")];
  for (const fig of figs) {
    const bs = [...fig.querySelectorAll("button")];
    assert.equal(bs.length, 1, "un solo botón por visor, también tras montar dos veces");
    const b = bs[0];
    assert.equal(b.parentElement, fig, "hijo directo de la figura, junto a los enlaces");
    assert.equal(b.getAttribute("type"), "button");
    assert.ok(b.classList.contains("btn"));
    assert.equal(b.previousElementSibling?.tagName, "A", "va justo después del último enlace");
    const cap = fig.querySelector("figcaption");
    if (cap) assert.ok(b.compareDocumentPosition(cap) & win.Node.DOCUMENT_POSITION_FOLLOWING, "antes del figcaption");
  }
  assert.equal(f.llamadas.urls.length, 2);
});

test("C3: el botón aparece solo cuando el tema ya se aplicó al visor interno; «Fondo oscuro», sin iconos, aria-pressed=false", async () => {
  const win = ventana({ doble: { retraso: 60 } });
  await montar(win, bloque(`archivo: ${A}`));
  assert.equal(botones(win).length, 0, "mientras el visor interno no ha cargado no hay botón");
  const [b] = await hasta(hayBotones(win), "botón tras aplicar el tema");
  assert.deepEqual(temas(win), [CLARO], "cuando aparece el botón el tema ya está aplicado");
  assert.equal(b.textContent.trim(), "Fondo oscuro");
  assert.equal(b.getAttribute("aria-pressed"), "false");
  assert.equal(b.querySelector("svg, img, i"), null);
});

test("C3: pulsar alterna claro ↔ oscuro en el visor interno (kicad ↔ witchhazel) y lo repinta; aria-pressed refleja el estado y el texto no cambia", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "kicad al montar");
  const [b] = await hasta(hayBotones(win), "botón");
  const [v] = win.visores;
  const antes = repintados(v);
  b.click();
  await hasta(temasSon(win, [OSCURO]), "witchhazel en el visor interno");
  assert.equal(b.getAttribute("aria-pressed"), "true");
  assert.equal(b.textContent.trim(), "Fondo oscuro");
  await hasta(() => repintados(v) > antes, "se repinta al alternar");
  const medio = repintados(v);
  b.click();
  await hasta(temasSon(win, [CLARO]), "kicad de vuelta");
  assert.equal(b.getAttribute("aria-pressed"), "false");
  await hasta(() => repintados(v) > medio, "se repinta al volver");
});

test("C3: alternar es en caliente; mismo <kicanvas-embed> y mismo visor interno (no se recrea), una sola descarga, región y atributos intactos", async () => {
  const win = ventana();
  const f = await montar(win, bloque(`archivo: ${A}\ntitulo: Potencia`));
  await hasta(temasSon(win, [CLARO]), "kicad al montar");
  const [b] = await hasta(hayBotones(win), "botón");
  const [embed] = embeds(win);
  const fuente = embed.querySelector("kicanvas-source");
  b.click();
  b.click();
  b.click();
  await hasta(temasSon(win, [OSCURO]), "witchhazel tras tres pulsaciones");
  await pausa(50);
  assert.equal(f.llamadas.urls.length, 1, "una sola descarga por visor");
  assert.equal(f.llamadas.script, 1);
  assert.equal(embeds(win).length, 1, "un solo visor en la figura");
  assert.equal(embeds(win)[0], embed, "el embed es el mismo nodo: no se recrea");
  assert.equal(win.visores.length, 1, "no se creó otro visor interno");
  assert.equal(embed.querySelector("kicanvas-source"), fuente);
  assert.equal(fuente.textContent, SCH);
  assert.equal(fuente.children.length, 0);
  assert.equal(embed.getAttribute("controls"), "basic");
  assert.match(embed.getAttribute("controlslist") ?? "", /nodownload/);
  const regiones = win.document.querySelectorAll("figure.hw-kicad [role=region]");
  assert.equal(regiones.length, 1);
  assert.match(regiones[0].getAttribute("aria-label"), /Esquemático de KiCad.*Potencia/);
});

test("C3: teclado; es un <button> nativo, enfocable, y conserva el foco tras alternar", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "kicad al montar");
  const [b] = await hasta(hayBotones(win), "botón");
  assert.equal(b.tagName, "BUTTON");
  assert.notEqual(b.getAttribute("tabindex"), "-1");
  assert.equal(b.disabled, false);
  b.focus();
  b.click();
  await hasta(temasSon(win, [OSCURO]), "witchhazel");
  assert.equal(win.document.activeElement, b, "el mismo botón sigue con el foco");
  assert.equal(b.isConnected, true);
});

// ---------- C4. PCB: mismo tema, sin botón ----------

test("C4: el PCB recibe el tema elegido en <kc-board-viewer> pero su figura no tiene botón de fondo", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${C}\nrespaldo: ${B}\ntitulo: Placa`), falsoKicad(PCB));
  await hasta(temasSon(win, [CLARO]), "theme=kicad en <kc-board-viewer>");
  const [v] = win.visores;
  assert.equal(v.pcb, true);
  await hasta(() => repintados(v) > 0, "el PCB se repinta");
  await pausa(150);
  assert.equal(botones(win).length, 0, "sin botón en la placa");
  assert.equal(win.document.querySelectorAll("figure.hw-kicad a").length, 2, "siguen los enlaces");
  assert.equal(embeds(win).length, 1);
});

test("C4: con esquemático y PCB en la página hay un solo botón (el del esquemático) y alterna los dos visores sin descargas nuevas", async () => {
  const win = ventana();
  const f = await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${C}`)}`, falsoKicad(porUrl));
  await hasta(temasSon(win, [CLARO, CLARO]), "ambos en kicad");
  await hasta(() => botones(win).length === 1, "un botón");
  await pausa(150);
  const figs = [...win.document.querySelectorAll("figure.hw-kicad")];
  assert.equal(figs[0].querySelectorAll("button").length, 1, "esquemático con botón");
  assert.equal(figs[1].querySelectorAll("button").length, 0, "PCB sin botón");
  const nodos = embeds(win);
  botones(win)[0].click();
  await hasta(temasSon(win, [OSCURO, OSCURO]), "los dos visores en witchhazel");
  assert.deepEqual(embeds(win), nodos, "ningún embed se recrea");
  assert.equal(win.visores.length, 2);
  assert.equal(f.llamadas.urls.length, 2, "una descarga por archivo");
  assert.equal(botones(win).length, 1);
});

test("C4: con la preferencia oscura guardada, una página con solo PCB aplica witchhazel y sigue sin botón", async () => {
  const { guardarFondoKicad } = await fondo();
  const win = ventana();
  guardarFondoKicad(win, "oscuro");
  await montar(win, bloque(`archivo: ${C}`), falsoKicad(PCB));
  await hasta(temasSon(win, [OSCURO]), "witchhazel en la placa");
  await pausa(150);
  assert.equal(botones(win).length, 0);
});

// ---------- C5. Preferencia recordada y aplicada a todos ----------

test("C5: módulo kicad-fondo: lee y guarda en una clave propia (no la de KiCanvas); valores desconocidos → claro", async () => {
  const { leerFondoKicad, guardarFondoKicad, CLAVE_FONDO_KICAD } = await fondo();
  assert.equal(typeof CLAVE_FONDO_KICAD, "string");
  assert.ok(CLAVE_FONDO_KICAD && CLAVE_FONDO_KICAD !== "kc:prefs");
  const win = ventana();
  assert.equal(leerFondoKicad(win), "claro");
  guardarFondoKicad(win, "oscuro");
  assert.equal(leerFondoKicad(win), "oscuro");
  guardarFondoKicad(win, "claro");
  assert.equal(leerFondoKicad(win), "claro");
  win.localStorage.setItem(CLAVE_FONDO_KICAD, "<script>");
  assert.equal(leerFondoKicad(win), "claro");
});

test("C5: tolerante a fallos; localStorage que lanza o no existe → claro, y guardar no lanza", async () => {
  const { leerFondoKicad, guardarFondoKicad } = await fondo();
  const rota = ventana();
  Object.defineProperty(rota, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  assert.equal(leerFondoKicad(rota), "claro");
  assert.doesNotThrow(() => guardarFondoKicad(rota, "oscuro"));
  const llena = ventana();
  Object.defineProperty(llena, "localStorage", {
    configurable: true,
    value: { getItem() { throw new Error("x"); }, setItem() { throw new Error("QuotaExceededError"); } },
  });
  assert.equal(leerFondoKicad(llena), "claro");
  assert.doesNotThrow(() => guardarFondoKicad(llena, "oscuro"));
  assert.equal(leerFondoKicad({}), "claro");
  assert.equal(leerFondoKicad(null), "claro");
});

test("C5: con localStorage roto el visor interno queda en claro y el botón sigue alternando en la página", async () => {
  const win = ventana();
  Object.defineProperty(win, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "kicad");
  const [b] = await hasta(hayBotones(win), "botón");
  b.click();
  await hasta(temasSon(win, [OSCURO]), "witchhazel");
  assert.equal(b.getAttribute("aria-pressed"), "true");
});

test("C5: pulsar el botón guarda la preferencia en localStorage (clave propia, sin tocar kc:prefs)", async () => {
  const { leerFondoKicad, CLAVE_FONDO_KICAD } = await fondo();
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "kicad");
  const [b] = await hasta(hayBotones(win), "botón");
  b.click();
  assert.equal(leerFondoKicad(win), "oscuro");
  assert.ok(win.localStorage.getItem(CLAVE_FONDO_KICAD) != null);
  assert.deepEqual(clavesPropias(win), [CLAVE_FONDO_KICAD], "una sola clave propia");
  assert.equal(win.localStorage.getItem("kc:prefs"), null);
  b.click();
  assert.equal(leerFondoKicad(win), "claro");
});

test("C5: con la preferencia oscura guardada, los visores internos reciben witchhazel y el botón nace con aria-pressed=true", async () => {
  const { guardarFondoKicad } = await fondo();
  const win = ventana();
  guardarFondoKicad(win, "oscuro");
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}`)}`);
  await hasta(temasSon(win, [OSCURO, OSCURO]), "witchhazel en ambos");
  await hasta(() => botones(win).length === 2, "dos botones");
  assert.deepEqual(botones(win).map((b) => b.getAttribute("aria-pressed")), ["true", "true"]);
});

test("C5: el botón de un esquemático cambia todos los visores de la página y todos los botones, sin descargar de nuevo", async () => {
  const win = ventana();
  const f = await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}`)}\n${bloque(`archivo: ${C}`)}`, falsoKicad(porUrl));
  await hasta(temasSon(win, [CLARO, CLARO, CLARO]), "tres visores en kicad");
  await hasta(() => botones(win).length === 2, "dos botones (los esquemáticos)");
  botones(win)[1].click();
  await hasta(temasSon(win, [OSCURO, OSCURO, OSCURO]), "tres visores en witchhazel");
  assert.deepEqual(botones(win).map((b) => b.getAttribute("aria-pressed")), ["true", "true"]);
  const fuentes = embeds(win).map((e) => e.querySelector("kicanvas-source").textContent);
  assert.deepEqual(fuentes, [SCH, SCH, PCB], "cada visor conserva su propio archivo");
  assert.equal(f.llamadas.urls.length, 3);
  botones(win)[0].click();
  await hasta(temasSon(win, [CLARO, CLARO, CLARO]), "de vuelta a kicad");
  assert.deepEqual(botones(win).map((b) => b.getAttribute("aria-pressed")), ["false", "false"]);
});

test("C5: los visores montados después de cambiar la preferencia reciben el tema elegido", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  await hasta(temasSon(win, [CLARO]), "kicad");
  const [b] = await hasta(hayBotones(win), "botón");
  b.click();
  await hasta(temasSon(win, [OSCURO]), "witchhazel");
  // La página se vuelve a pintar (p. ej. tras guardar en el editor) y se montan visores nuevos.
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}`)}`);
  await hasta(temasSon(win, [OSCURO, OSCURO]), "los visores nuevos en witchhazel");
  await hasta(() => botones(win).length === 2, "dos botones");
  assert.deepEqual(botones(win).map((x) => x.getAttribute("aria-pressed")), ["true", "true"]);
});

// ---------- C6. Internos ausentes o distintos: nada se rompe y no hay botón ----------

test("C6: si <kicanvas-embed> no expone shadowRoot al conectarse, se abandona al momento: sin botón, sin aviso de error y sin temporizadores", async () => {
  const win = ventana({ doble: false });
  const usados = [];
  for (const nombre of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
    const original = win[nombre];
    win[nombre] = (...args) => {
      usados.push(nombre);
      return typeof original === "function" ? original.apply(win, args) : 0;
    };
  }
  await montar(win, bloque(`archivo: ${A}`));
  await pausa(100);
  assert.equal(embeds(win).length, 1, "el visor sigue montado en su tema por defecto");
  assert.equal(win.document.querySelector("figure.hw-kicad [role=status]"), null, "no es un error para el lector");
  assert.equal(botones(win).length, 0, "sin botón");
  assert.deepEqual(usados, [], "no deja esperas pendientes");
});

test("C6: si el visor interno no tiene update_theme / viewer.paint / viewer.draw (bundle distinto), el visor queda como esté y no hay botón", async () => {
  const win = ventana({ doble: { sinMetodos: true } });
  await montar(win, bloque(`archivo: ${A}`), falsoKicad(), { kicad: { esperaVisorMs: 80 } });
  await hasta(() => win.visores.length === 1 && win.visores[0].el.loaded, "visor interno cargado");
  await pausa(300);
  assert.equal(win.visores[0].el.theme, null, "no se toca un visor que no se puede repintar");
  assert.equal(embeds(win).length, 1);
  assert.equal(win.document.querySelector("figure.hw-kicad [role=status]"), null);
  assert.equal(botones(win).length, 0);
});

test("C6: espera acotada (OpcionesKicad.esperaVisorMs); si el visor interno no aparece o no carga a tiempo, se deja de esperar y no hay botón", async () => {
  for (const doble of [{ sinVisor: true }, { nuncaCarga: true }]) {
    const win = ventana({ doble });
    await montar(win, bloque(`archivo: ${A}`), falsoKicad(), { kicad: { esperaVisorMs: 60 } });
    await pausa(400);
    const caso = JSON.stringify(doble);
    assert.equal(embeds(win).length, 1, caso);
    assert.equal(win.document.querySelector("figure.hw-kicad [role=status]"), null, caso);
    assert.equal(botones(win).length, 0, caso);
    // Carga tardía, ya fuera de plazo: nadie sigue escuchando ni sondeando.
    for (const v of win.visores) cargar(win, v);
    await pausa(300);
    assert.equal(botones(win).length, 0, `${caso}: fuera de plazo no aparece el botón`);
    for (const v of win.visores) assert.deepEqual(v.llamadas.filter((n) => n !== "update_theme"), [], `${caso}: no se repinta fuera de plazo`);
  }
});

test("C6: un visor interno que lanza al repintar no rompe la página ni a los demás visores", async () => {
  const win = ventana();
  const f = await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}`)}`);
  await hasta(temasSon(win, [CLARO, CLARO]), "kicad en ambos");
  await hasta(() => botones(win).length === 2, "dos botones");
  win.visores[0].el.viewer.draw = () => {
    throw new Error("interno roto");
  };
  assert.doesNotThrow(() => botones(win)[1].click());
  await hasta(() => win.visores[1].el.theme === OSCURO, "el otro visor sí cambia");
  assert.equal(embeds(win).length, 2);
  assert.equal(f.llamadas.urls.length, 2);
});

// ---------- C7. Sin visor montado no hay botón ----------

test("C7: sin WebGL2, con descarga fallida, o texto que no es KiCad: aviso role=status y ningún botón", async () => {
  const casos = [
    ["sin WebGL2", falsoKicad(SCH, { webgl2: false })],
    ["HTTP 500", falsoKicad(new Error("HTTP 500"))],
    ["no es KiCad", falsoKicad("<html>no</html>")],
  ];
  for (const [nombre, f] of casos) {
    const win = ventana();
    await montar(win, bloque(`archivo: ${A}\nrespaldo: ${B}`), f);
    await pausa(50);
    assert.ok(win.document.querySelector("figure.hw-kicad [role=status]"), nombre);
    assert.equal(win.document.querySelector("kicanvas-embed"), null, nombre);
    assert.equal(botones(win).length, 0, `${nombre}: sin botón de fondo`);
    assert.equal(win.document.querySelectorAll("figure.hw-kicad a").length, 2, `${nombre}: siguen los enlaces`);
  }
});

test("C7: si falla la carga de kicanvas.js no hay botón", async () => {
  const win = ventana();
  const f = falsoKicad();
  f.kicad.cargarScript = async () => {
    throw new Error("No se pudo cargar KiCanvas");
  };
  await montar(win, bloque(`archivo: ${A}`), f);
  await pausa(50);
  assert.ok(win.document.querySelector("figure.hw-kicad [role=status]"));
  assert.equal(botones(win).length, 0);
});

test("C7: en la vista previa del editor (no se monta el visor) no hay botón", async () => {
  const win = ventana();
  const f = await montar(win, bloque(`archivo: ${A}`), falsoKicad(), { vistaPrevia: true });
  await pausa(50);
  assert.equal(f.llamadas.urls.length, 0);
  assert.equal(botones(win).length, 0);
});

test("C7: con un visor que monta y otro que falla, solo el que monta tiene botón y alternar no crea visor en el fallido", async () => {
  const win = ventana();
  const f = falsoKicad((url) => (url.includes(B) ? "<html>no</html>" : SCH));
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}`)}`, f);
  const figs = [...win.document.querySelectorAll("figure.hw-kicad")];
  await hasta(temasSon(win, [CLARO]), "kicad en el visor que montó");
  await hasta(() => figs[0].querySelectorAll("button").length === 1, "botón en el visor que montó");
  assert.equal(figs[1].querySelectorAll("button").length, 0);
  figs[0].querySelector("button").click();
  await hasta(temasSon(win, [OSCURO]), "witchhazel en el visor que montó");
  assert.equal(figs[1].querySelector("kicanvas-embed"), null);
  assert.ok(figs[1].querySelector("[role=status]"));
  assert.equal(f.llamadas.urls.length, 2);
});

// ---------- C8. Estilos (archivo propio, sin tocar global.css) ----------

test("C8 estilos: src/styles/kicad.css, cargado desde Base.astro, con foco visible para el botón y solo tokens (sin colores nuevos)", () => {
  assert.ok(existsSync(new URL("../src/styles/kicad.css", import.meta.url)), "src/styles/kicad.css");
  const css = leer("src/styles/kicad.css");
  assert.match(css, /figure\.hw-kicad[^{]*\.btn[^{]*:focus-visible[^{]*\{[^}]*outline/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "solo var(--…)");
  assert.match(leer("src/layouts/Base.astro"), /import\s+["']\.\.\/styles\/kicad\.css["']/);
});

test("vendor intacto: kicanvas.js sigue trayendo los temas kicad y witchhazel y los internos en que se apoya el portal", () => {
  const js = leer("public/vendor/kicanvas/kicanvas.js");
  assert.match(js, /name:"kicad"/);
  assert.match(js, /name:"witchhazel"/);
  assert.match(js, /update_theme\(\)\{this\.viewer\.theme=this\.themeObject\.schematic\}/);
  assert.match(js, /update_theme\(\)\{this\.viewer\.theme=this\.themeObject\.board\}/);
  assert.match(js, /customElements\.define\("kc-schematic-viewer"/);
  assert.match(js, /customElements\.define\("kc-board-viewer"/);
});
