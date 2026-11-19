// Lote a-editor-qol: el editor de páginas de hardware, más cómodo sin saturar la interfaz.
// C1 menú «/» de Crepe acotado · C2 un solo botón «Insertar» con menú accesible (lógica en src/lib/editor-controles.ts)
// · C3 ayuda plegada tras «Atajos» · C4 barra fija de Guardar/Cancelar con «Cambios sin guardar» · C5 títulos en móvil.
// Lo que solo se ve en el navegador (posición real del menú, que la barra no tape texto, temas) va a la verificación.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const PAGINA = leer("src/pages/[project]/[disciplina].astro");
const SCRIPT = leer("src/scripts/hardware-editor.ts");
const CSS = sinComentarios(leer("src/styles/global.css"));
const CSS_VISUAL = sinComentarios(leer("src/styles/editor-visual.css"));

let controles = null;
let falloControles = null;
try {
  controles = await import("../src/lib/editor-controles.ts");
} catch (e) {
  falloControles = e;
}
const K = () => {
  assert.ok(controles, `no se pudo importar src/lib/editor-controles.ts: ${falloControles?.message}`);
  return controles;
};
const hwLib = await import("../src/lib/hardware-editor.ts");

// ---------- utilidades CSS ----------

// Reglas de primer nivel o dentro de @media: [{ selector, cuerpo, media }]
function reglas(css) {
  const out = [];
  const re = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1] !== undefined) {
      const media = m[1].trim();
      const r2 = /([^{}]+)\{([^{}]*)\}/g;
      let n;
      while ((n = r2.exec(m[2]))) out.push({ selector: n[1].trim(), cuerpo: n[2], media });
    } else out.push({ selector: m[3].trim(), cuerpo: m[4], media: null });
  }
  return out;
}
const prop = (cuerpo, p) => new RegExp(`(?:^|;|\\s)${p}\\s*:\\s*([^;]+)`).exec(cuerpo)?.[1].trim() ?? null;
const R = reglas(CSS);
const RV = reglas(CSS_VISUAL);

// ---------- utilidades DOM ----------

// El <form class="hw-editor"> de la página, montado en jsdom (no lleva expresiones de Astro).
function formulario() {
  const html = /<form class="hw-editor"[\s\S]*?<\/form>/.exec(PAGINA)?.[0];
  assert.ok(html, "no se encontró <form class=\"hw-editor\"> en la página");
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  return dom.window.document;
}

let win = null;
const previos = {};
beforeEach(() => {
  win = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
  for (const k of ["window", "document", "HTMLElement", "Node", "KeyboardEvent", "MouseEvent", "Event"]) {
    previos[k] = globalThis[k];
    Object.defineProperty(globalThis, k, { value: k === "window" ? win : win[k], configurable: true, writable: true });
  }
});
afterEach(() => {
  for (const [k, v] of Object.entries(previos)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  win?.close();
});

// Menú de prueba: botón, menú con 5 acciones (algunas pueden ocultarse o deshabilitarse) y un botón fuera.
function montarMenu({ ocultar = [], deshabilitar = [] } = {}) {
  const d = win.document;
  d.body.innerHTML = `
    <div class="hw-subida">
      <div class="hw-insertar">
        <button type="button" class="btn" data-hw-menu-insertar aria-haspopup="menu" aria-expanded="false" aria-controls="hw-insertar-menu">Insertar</button>
        <div class="hw-insertar-menu" id="hw-insertar-menu" role="menu" aria-label="Insertar" hidden>
          <button type="button" class="btn" data-hw-adjuntar role="menuitem" tabindex="-1">Adjuntar archivo</button>
          <button type="button" class="btn" data-hw-insertar-diagrama role="menuitem" tabindex="-1" aria-haspopup="dialog">Diagrama</button>
          <button type="button" class="btn" data-hw-insertar-pdf role="menuitem" tabindex="-1">PDF</button>
          <button type="button" class="btn" data-hw-insertar-bom role="menuitem" tabindex="-1">BOM (CSV)</button>
          <button type="button" class="btn" data-hw-insertar-kicad role="menuitem" tabindex="-1">Insertar esquemático (KiCad)</button>
        </div>
      </div>
    </div>
    <button type="button" id="fuera">Guardar</button>`;
  const boton = d.querySelector("[data-hw-menu-insertar]");
  const menu = d.querySelector("#hw-insertar-menu");
  const items = [...menu.querySelectorAll("[role=menuitem]")];
  for (const i of ocultar) items[i].hidden = true;
  for (const i of deshabilitar) items[i].disabled = true;
  return { d, boton, menu, items, fuera: d.querySelector("#fuera") };
}
const tecla = (el, key, extra = {}) => {
  const e = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  el.dispatchEvent(e);
  return e;
};
const clic = (el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
const abierto = ({ boton, menu }) => boton.getAttribute("aria-expanded") === "true" && !menu.hidden;

// =====================================================================
// C1: menú «/» de Crepe
// =====================================================================

test("C1a editor-visual.css: .milkdown-slash-menu con alto máximo min(320px, 45vh) en columna y z-index > 20 (por encima de .topbar)", () => {
  const r = RV.find((x) => !x.media && /\.milkdown-slash-menu\s*$/.test(x.selector));
  assert.ok(r, "falta una regla cuyo selector termine en .milkdown-slash-menu en editor-visual.css");
  assert.equal(prop(r.cuerpo, "max-height")?.replace(/\s+/g, " "), "min(320px, 45vh)");
  const z = Number(prop(r.cuerpo, "z-index"));
  const zTopbar = Number(prop(R.find((x) => x.selector === ".topbar").cuerpo, "z-index"));
  assert.ok(Number.isInteger(z) && z > zTopbar, `z-index ${prop(r.cuerpo, "z-index")} debe ser entero > ${zTopbar}`);
  assert.equal(prop(r.cuerpo, "display"), "flex");
  assert.equal(prop(r.cuerpo, "flex-direction"), "column");
});

test("C1b editor-visual.css: la lista de grupos se desplaza dentro del menú (min-height:0, overflow auto, sin el 420px de Crepe)", () => {
  const r = RV.find((x) => !x.media && /\.milkdown-slash-menu\s+\.menu-groups\s*$/.test(x.selector));
  assert.ok(r, "falta la regla .milkdown-slash-menu .menu-groups");
  assert.equal(prop(r.cuerpo, "min-height"), "0");
  assert.match(prop(r.cuerpo, "overflow-y") ?? prop(r.cuerpo, "overflow") ?? "", /^auto$/);
  assert.equal(prop(r.cuerpo, "max-height"), "none");
});

test("C1c editor-visual.css: al cambiar display del menú se conserva el ocultado de Crepe ([data-show=false] → display:none)", () => {
  const r = RV.find((x) => !x.media && /\.milkdown-slash-menu\[data-show=['"]?false['"]?\]\s*$/.test(x.selector));
  assert.ok(r, "falta .milkdown-slash-menu[data-show=\"false\"] { display: none } en editor-visual.css");
  assert.equal(prop(r.cuerpo, "display"), "none");
  const base = RV.findIndex((x) => !x.media && /\.milkdown-slash-menu\s*$/.test(x.selector));
  assert.ok(RV.indexOf(r) > base, "la regla [data-show=false] va después de la que pone display:flex");
});

// =====================================================================
// C2: botón «Insertar» con menú
// =====================================================================

test("C2a página: .hw-subida tiene un solo botón visible «Insertar» (aria-haspopup=menu, aria-expanded=false, aria-controls al menú)", () => {
  const d = formulario();
  const subida = d.querySelector(".hw-subida");
  const boton = subida.querySelector("[data-hw-menu-insertar]");
  assert.ok(boton, "falta el botón [data-hw-menu-insertar]");
  assert.equal(boton.tagName, "BUTTON");
  assert.equal(boton.getAttribute("type"), "button");
  assert.ok(boton.classList.contains("btn"), "reutiliza .btn");
  assert.equal(boton.textContent.trim(), "Insertar");
  assert.equal(boton.getAttribute("aria-haspopup"), "menu");
  assert.equal(boton.getAttribute("aria-expanded"), "false");
  const menu = d.getElementById(boton.getAttribute("aria-controls") ?? "");
  assert.ok(menu, "aria-controls apunta al menú");
  assert.equal(menu.getAttribute("role"), "menu");
  assert.ok(menu.hasAttribute("hidden"), "el menú empieza oculto");
  // Fuera del menú no queda ningún otro botón ni <label> de acción.
  const sueltos = [...subida.querySelectorAll("button, label")].filter((el) => el !== boton && !menu.contains(el));
  assert.deepEqual(sueltos.map((e) => e.outerHTML), [], "las acciones sueltas pasan al menú");
});

test("C2b página: el menú tiene las 5 acciones en orden, como menuitem, y conservan sus data-hw-*", () => {
  const d = formulario();
  const menu = d.querySelector(".hw-subida [role=menu]");
  assert.ok(menu, "falta [role=menu] en .hw-subida");
  const items = [...menu.querySelectorAll("[role=menuitem]")];
  const esperado = [
    ["data-hw-adjuntar", "Adjuntar archivo"],
    ["data-hw-insertar-diagrama", "Diagrama"],
    ["data-hw-insertar-pdf", "PDF"],
    ["data-hw-insertar-bom", "BOM (CSV)"],
    // Texto y atributos iniciales fijados por tests/d1b-kicanvas.test.mjs (lote b-kicanvas-claro en paralelo).
    ["data-hw-insertar-kicad", "Insertar esquemático (KiCad)"],
  ];
  assert.equal(items.length, 5, "5 acciones");
  esperado.forEach(([attr, texto], i) => {
    const it = items[i];
    assert.equal(it.tagName, "BUTTON", `${texto}: es <button>`);
    assert.equal(it.getAttribute("type"), "button");
    assert.ok(it.classList.contains("btn"), `${texto}: conserva class="btn" (las 5 acciones, igual marcado)`);
    assert.ok(it.hasAttribute(attr), `${texto}: conserva ${attr}`);
    assert.equal(it.textContent.trim(), texto);
    assert.equal(it.getAttribute("tabindex"), "-1", `${texto}: fuera del orden de tabulación (roving)`);
  });
  assert.equal(items[1].getAttribute("aria-haspopup"), "dialog", "Diagrama sigue anunciando que abre un diálogo");
});

test("C2c página: los input file siguen igual (ocultos, sin foco, con sus accept) y #hw-archivo ya no tiene <label> propio", () => {
  const d = formulario();
  const subida = d.querySelector(".hw-subida");
  const archivo = d.getElementById("hw-archivo");
  assert.ok(archivo && archivo.type === "file", "#hw-archivo sigue siendo input file");
  assert.equal(d.querySelector('label[for="hw-archivo"]'), null, "Adjuntar pasa a ser un menuitem <button>");
  const inputs = [archivo, ...["pdf", "bom", "kicad"].map((t) => d.querySelector(`[data-hw-archivo-${t}]`))];
  for (const i of inputs) {
    assert.ok(i, "existen los 4 input file");
    assert.ok(subida.contains(i), "siguen en .hw-subida");
    assert.ok(i.classList.contains("hw-archivo"));
    assert.equal(i.getAttribute("tabindex"), "-1");
    assert.equal(i.getAttribute("aria-hidden"), "true");
    assert.equal(i.closest("[role=menu]"), null, "fuera del menú");
  }
  assert.equal(d.querySelector("[data-hw-archivo-pdf]").getAttribute("accept"), ".pdf,application/pdf");
  assert.equal(d.querySelector("[data-hw-archivo-bom]").getAttribute("accept"), ".csv,text/csv");
  assert.equal(d.querySelector("[data-hw-archivo-kicad]").getAttribute("accept"), ".kicad_sch,.kicad_pcb,.pdf,.svg");
  assert.ok(d.querySelector("[data-hw-archivo-kicad]").hasAttribute("multiple"));
});

test("C2d página: la barra de progreso y el texto «subiendo» quedan en .hw-subida fuera del menú", () => {
  const d = formulario();
  const subida = d.querySelector(".hw-subida");
  for (const sel of ["[data-hw-progreso]", "[data-hw-subiendo]"]) {
    const el = d.querySelector(sel);
    assert.ok(el && subida.contains(el), `${sel} en .hw-subida`);
    assert.equal(el.closest("[role=menu]"), null, `${sel} fuera del menú`);
  }
  assert.equal(d.querySelector("[data-hw-subiendo]").getAttribute("aria-live"), "polite");
});

// ---------- C2e: lógica pura del menú ----------

test("C2e menuInsertar: abrir con alternar/flechas y moverse en círculo con flechas, Inicio y Fin", () => {
  const { menuInsertar } = K();
  const cerrado = { abierto: false, activo: -1 };
  assert.deepEqual(menuInsertar(cerrado, "alternar", 5), { abierto: true, activo: 0, foco: "item" });
  assert.deepEqual(menuInsertar(cerrado, "abajo", 5), { abierto: true, activo: 0, foco: "item" });
  assert.deepEqual(menuInsertar(cerrado, "arriba", 5), { abierto: true, activo: 4, foco: "item" });
  assert.equal(menuInsertar(cerrado, "alternar", 0), null, "sin acciones disponibles no abre");
  const a = (activo) => ({ abierto: true, activo });
  assert.deepEqual(menuInsertar(a(0), "abajo", 5), { abierto: true, activo: 1, foco: "item" });
  assert.deepEqual(menuInsertar(a(4), "abajo", 5), { abierto: true, activo: 0, foco: "item" });
  assert.deepEqual(menuInsertar(a(0), "arriba", 5), { abierto: true, activo: 4, foco: "item" });
  assert.deepEqual(menuInsertar(a(3), "inicio", 5), { abierto: true, activo: 0, foco: "item" });
  assert.deepEqual(menuInsertar(a(1), "fin", 5), { abierto: true, activo: 4, foco: "item" });
});

test("C2e menuInsertar: cerrar con alternar, Esc, elegir y Tab devuelve el foco al botón; un clic fuera no mueve el foco", () => {
  const { menuInsertar } = K();
  const a = { abierto: true, activo: 2 };
  for (const ev of ["alternar", "escape", "elegir", "tab"]) {
    assert.deepEqual(menuInsertar(a, ev, 5), { abierto: false, activo: -1, foco: "boton" }, ev);
  }
  assert.deepEqual(menuInsertar(a, "fuera", 5), { abierto: false, activo: -1, foco: null });
  const c = { abierto: false, activo: -1 };
  for (const ev of ["escape", "elegir", "tab", "fuera", "inicio", "fin"]) assert.equal(menuInsertar(c, ev, 5), null, `${ev} con el menú cerrado no se maneja`);
  assert.equal(menuInsertar(a, "otra-cosa", 5), null);
});

// ---------- C2f: conectarMenuInsertar en jsdom ----------

test("C2f clic en «Insertar»: abre (aria-expanded=true, menú visible) y enfoca la primera acción; otro clic lo cierra", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu();
  conectarMenuInsertar(m.boton, m.menu);
  m.boton.focus();
  clic(m.boton);
  assert.ok(abierto(m), "abre");
  assert.equal(m.d.activeElement, m.items[0]);
  clic(m.boton);
  assert.ok(!abierto(m) && m.menu.hidden, "cierra");
  assert.equal(m.boton.getAttribute("aria-expanded"), "false");
  assert.equal(m.d.activeElement, m.boton);
});

test("C2f teclado: ↓/↑ en el botón abren en la primera/última; ↓, ↑, Inicio y Fin mueven el foco saltando ocultas y deshabilitadas", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu({ ocultar: [2], deshabilitar: [3] }); // PDF oculto, BOM deshabilitado
  conectarMenuInsertar(m.boton, m.menu);
  m.boton.focus();
  const e = tecla(m.boton, "ArrowDown");
  assert.ok(e.defaultPrevented, "↓ en el botón no desplaza la página");
  assert.ok(abierto(m));
  assert.equal(m.d.activeElement, m.items[0]);
  tecla(m.d.activeElement, "ArrowDown");
  assert.equal(m.d.activeElement, m.items[1]);
  tecla(m.d.activeElement, "ArrowDown");
  assert.equal(m.d.activeElement, m.items[4], "salta la oculta y la deshabilitada");
  tecla(m.d.activeElement, "ArrowDown");
  assert.equal(m.d.activeElement, m.items[0], "da la vuelta");
  tecla(m.d.activeElement, "ArrowUp");
  assert.equal(m.d.activeElement, m.items[4]);
  tecla(m.d.activeElement, "Home");
  assert.equal(m.d.activeElement, m.items[0]);
  tecla(m.d.activeElement, "End");
  assert.equal(m.d.activeElement, m.items[4]);
  tecla(m.d.activeElement, "Escape");
  m.boton.focus();
  tecla(m.boton, "ArrowUp");
  assert.equal(m.d.activeElement, m.items[4], "↑ en el botón abre en la última disponible");
});

test("C2f Esc cierra, devuelve el foco al botón y no se propaga a otros manejadores de Esc", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu();
  conectarMenuInsertar(m.boton, m.menu);
  let llegoAlDocumento = false;
  m.d.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !ev.defaultPrevented) llegoAlDocumento = true;
  });
  clic(m.boton);
  tecla(m.d.activeElement, "ArrowDown");
  const e = tecla(m.d.activeElement, "Escape");
  assert.ok(!abierto(m));
  assert.equal(m.d.activeElement, m.boton);
  assert.ok(e.defaultPrevented, "Esc se consume (preventDefault)");
  assert.equal(llegoAlDocumento, false);
});

test("C2f Tab cierra el menú y deja que el navegador siga desde el botón (sin preventDefault)", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu();
  conectarMenuInsertar(m.boton, m.menu);
  clic(m.boton);
  const e = tecla(m.d.activeElement, "Tab");
  assert.ok(!abierto(m));
  assert.equal(e.defaultPrevented, false);
  assert.equal(m.d.activeElement, m.boton);
  clic(m.boton);
  const s = tecla(m.d.activeElement, "Tab", { shiftKey: true });
  assert.ok(!abierto(m), "Mayús+Tab también cierra");
  assert.equal(s.defaultPrevented, false);
});

test("C2f elegir: el menú se cierra y el foco vuelve al botón ANTES de que corra la acción (así un diálogo que abra conserva el foco)", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu();
  conectarMenuInsertar(m.boton, m.menu);
  const vistos = [];
  for (const it of m.items) {
    it.addEventListener("click", () => vistos.push({ item: it.textContent, oculto: m.menu.hidden, expandido: m.boton.getAttribute("aria-expanded"), foco: m.d.activeElement }));
  }
  clic(m.boton);
  tecla(m.d.activeElement, "ArrowDown");
  m.d.activeElement.click(); // Enter/Espacio sobre un <button> disparan click
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0].item, "Diagrama", "se ejecuta la acción elegida, una sola vez");
  assert.equal(vistos[0].oculto, true);
  assert.equal(vistos[0].expandido, "false");
  assert.equal(vistos[0].foco, m.boton);
  // La acción puede mover el foco (p. ej. a un diálogo) y el menú no se lo quita después.
  m.items[0].addEventListener("click", () => m.fuera.focus());
  clic(m.boton);
  clic(m.items[0]);
  assert.equal(m.d.activeElement, m.fuera);
});

test("C2f clic fuera cierra sin mover el foco; con el botón deshabilitado no abre; cerrar() lo cierra desde el script", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu();
  const ctl = conectarMenuInsertar(m.boton, m.menu);
  clic(m.boton);
  m.fuera.focus();
  clic(m.fuera);
  assert.ok(!abierto(m), "clic fuera cierra");
  assert.equal(m.d.activeElement, m.fuera, "y no roba el foco");
  m.boton.disabled = true;
  clic(m.boton);
  tecla(m.boton, "ArrowDown");
  assert.ok(!abierto(m), "deshabilitado no abre");
  m.boton.disabled = false;
  clic(m.boton);
  assert.ok(abierto(m));
  assert.equal(typeof ctl?.cerrar, "function", "devuelve { cerrar }");
  ctl.cerrar();
  assert.ok(!abierto(m), "cerrar() lo cierra");
});

test("C2f con AbortSignal: al abortar se quitan los oyentes", () => {
  const { conectarMenuInsertar } = K();
  const m = montarMenu();
  const ctl = new win.AbortController();
  conectarMenuInsertar(m.boton, m.menu, ctl.signal);
  ctl.abort();
  clic(m.boton);
  assert.ok(!abierto(m));
});

// ---------- C2g: integración en el script ----------

test("C2g script: usa conectarMenuInsertar, «Adjuntar archivo» abre #hw-archivo y el diagrama devuelve el foco al botón «Insertar»", () => {
  assert.match(SCRIPT, /import\s*\{[^}]*\bconectarMenuInsertar\b[^}]*\}\s*from\s*["']\.\.\/lib\/editor-controles(\.ts)?["']/);
  assert.match(SCRIPT, /conectarMenuInsertar\(/);
  assert.match(SCRIPT, /\[data-hw-adjuntar\]/);
  assert.match(SCRIPT, /inputArchivo\.click\(\)/);
  assert.doesNotMatch(SCRIPT, /btnInsertarDiagrama\.focus\(\)/, "el ítem queda oculto al cerrar el menú: el foco vuelve al botón «Insertar»");
  assert.doesNotMatch(SCRIPT, /abrirDiagrama\([^)]*,\s*btnInsertarDiagrama\s*\)/);
});

// =====================================================================
// C3: ayuda plegada tras «Atajos»
// =====================================================================

test("C3a página: botón «Atajos» (aria-expanded=false, aria-controls=hw-ayuda-visual) y la lista empieza oculta", () => {
  const d = formulario();
  const b = d.querySelector("[data-hw-atajos]");
  assert.ok(b, "falta [data-hw-atajos]");
  assert.equal(b.tagName, "BUTTON");
  assert.equal(b.getAttribute("type"), "button");
  assert.ok(b.classList.contains("btn"));
  assert.equal(b.textContent.trim(), "Atajos");
  assert.equal(b.getAttribute("aria-expanded"), "false");
  assert.equal(b.getAttribute("aria-controls"), "hw-ayuda-visual");
  const ul = d.getElementById("hw-ayuda-visual");
  assert.ok(ul && ul.tagName === "UL" && ul.hasAttribute("data-hw-ayuda-visual"));
  assert.ok(ul.hasAttribute("hidden"), "oculta por defecto");
  assert.equal(ul.querySelectorAll("li").length, 5, "mismas 5 líneas");
});

test("C3b página: «Markdown» sigue con aria-describedby=hw-ayuda-visual y ese id existe una sola vez", () => {
  const d = formulario();
  assert.equal(d.querySelector("[data-hw-modo-markdown]").getAttribute("aria-describedby"), "hw-ayuda-visual");
  assert.equal(d.querySelectorAll("#hw-ayuda-visual").length, 1);
});

test("C3c conectarPlegable: alterna hidden del panel de aria-controls y aria-expanded; con AbortSignal se desconecta", () => {
  const { conectarPlegable } = K();
  const d = win.document;
  d.body.innerHTML = '<button type="button" id="b" aria-expanded="false" aria-controls="p">Atajos</button><ul id="p" hidden><li>x</li></ul>';
  const b = d.getElementById("b");
  const p = d.getElementById("p");
  const ctl = new win.AbortController();
  conectarPlegable(b, ctl.signal);
  clic(b);
  assert.equal(p.hidden, false);
  assert.equal(b.getAttribute("aria-expanded"), "true");
  clic(b);
  assert.equal(p.hidden, true);
  assert.equal(b.getAttribute("aria-expanded"), "false");
  ctl.abort();
  clic(b);
  assert.equal(p.hidden, true, "desconectado");
});

test("C3d script: conecta «Atajos» con conectarPlegable y ya no muestra la ayuda solo por estar en modo visual", () => {
  assert.match(SCRIPT, /import\s*\{[^}]*\bconectarPlegable\b[^}]*\}\s*from\s*["']\.\.\/lib\/editor-controles(\.ts)?["']/);
  assert.match(SCRIPT, /\[data-hw-atajos\]/);
  assert.doesNotMatch(SCRIPT, /ayudaVisual\.hidden\s*=\s*modoMarkdown\s*;/, "en modo visual la lista solo se ve si «Atajos» está expandido");
});

// =====================================================================
// C4: barra fija de Guardar con «Cambios sin guardar»
// =====================================================================

test("C4a textoSinGuardar: «Cambios sin guardar» solo editando y con contenido distinto del guardado", () => {
  const { textoSinGuardar, TEXTO_SIN_GUARDAR } = hwLib;
  assert.equal(TEXTO_SIN_GUARDAR, "Cambios sin guardar");
  assert.equal(typeof textoSinGuardar, "function", "falta textoSinGuardar en src/lib/hardware-editor.ts");
  assert.equal(textoSinGuardar({ editando: true, actual: "# A\nb", base: "# A\n" }), "Cambios sin guardar");
  assert.equal(textoSinGuardar({ editando: true, actual: "# A\n", base: "# A\n" }), "");
  assert.equal(textoSinGuardar({ editando: false, actual: "x", base: "y" }), "", "fuera del editor no hay aviso");
  // Coherente con el aviso al salir: mismo criterio que debeAvisarSalida.
  for (const c of [{ editando: true, actual: "a", base: "b" }, { editando: true, actual: "", base: "" }, { editando: false, actual: "a", base: "b" }]) {
    assert.equal(textoSinGuardar(c) !== "", hwLib.debeAvisarSalida(c));
  }
});

test("C4b página: .hw-acciones lleva Guardar, Cancelar y un estado vacío role=status [data-hw-sin-guardar]", () => {
  const d = formulario();
  const acc = d.querySelector(".hw-acciones");
  assert.ok(acc.querySelector("[data-hw-guardar]") && acc.querySelector("[data-hw-cancelar]"));
  const s = acc.querySelector("[data-hw-sin-guardar]");
  assert.ok(s, "falta [data-hw-sin-guardar] dentro de .hw-acciones");
  assert.equal(s.getAttribute("role"), "status");
  assert.equal(s.textContent.trim(), "", "empieza vacío");
  assert.ok(!s.hasAttribute("hidden"), "la región viva existe siempre (se vacía, no se oculta)");
});

test("C4c CSS: .hw-acciones pegada abajo (sticky, bottom 0, fondo var(--surface), borde superior var(--line)) y por debajo de los menús", () => {
  const r = R.find((x) => !x.media && x.selector === ".hw-acciones");
  assert.ok(r, "falta .hw-acciones");
  assert.equal(prop(r.cuerpo, "position"), "sticky");
  assert.equal(prop(r.cuerpo, "bottom"), "0");
  assert.match(prop(r.cuerpo, "background") ?? prop(r.cuerpo, "background-color") ?? "", /^var\(--surface\)$/);
  assert.match(prop(r.cuerpo, "border-top") ?? "", /^1px solid var\(--line\)$/);
  const z = Number(prop(r.cuerpo, "z-index"));
  const zTopbar = Number(prop(R.find((x) => x.selector === ".topbar").cuerpo, "z-index"));
  const zSlash = Number(prop(RV.find((x) => !x.media && /\.milkdown-slash-menu\s*$/.test(x.selector))?.cuerpo ?? "", "z-index"));
  const zMenu = Number(prop(R.find((x) => !x.media && x.selector === ".hw-insertar-menu")?.cuerpo ?? "", "z-index"));
  assert.ok(Number.isInteger(z) && z > 0, "z-index entero positivo (sobre el contenido del editor)");
  assert.ok(z < zTopbar, "por debajo de .topbar");
  assert.ok(z < zSlash, "por debajo del menú «/»");
  assert.ok(z < zMenu, "por debajo del menú «Insertar»");
});

test("C4d CSS: el estado «sin guardar» usa var(--muted) y el menú «Insertar» reutiliza tokens (sin colores nuevos)", () => {
  const s = R.find((x) => !x.media && x.selector === ".hw-sin-guardar");
  assert.ok(s, "falta .hw-sin-guardar");
  assert.equal(prop(s.cuerpo, "color"), "var(--muted)");
  const m = R.find((x) => !x.media && x.selector === ".hw-insertar-menu");
  assert.ok(m, "falta .hw-insertar-menu");
  assert.equal(prop(m.cuerpo, "position"), "absolute");
  assert.match(prop(m.cuerpo, "background") ?? "", /^var\(--surface\)$/);
  assert.match(prop(m.cuerpo, "border") ?? "", /var\(--line\)/);
  const rel = R.find((x) => !x.media && x.selector === ".hw-insertar");
  assert.equal(prop(rel?.cuerpo ?? "", "position"), "relative", ".hw-insertar es el ancla del menú");
  const nuevos = [s, m, ...R.filter((x) => /\.hw-insertar/.test(x.selector))].map((x) => x.cuerpo).join(";");
  assert.doesNotMatch(nuevos, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "solo tokens");
  assert.ok(R.some((x) => /\.hw-insertar-menu\s+\[role="?menuitem"?\]:focus-visible/.test(x.selector) && /var\(--accent\)/.test(x.cuerpo)), "foco visible de las acciones con var(--accent)");
});

test("C4e script: el estado se actualiza al escribir (textarea y Crepe con alCambiar), al guardar y al cerrar", () => {
  assert.match(SCRIPT, /\btextoSinGuardar\b/);
  assert.match(SCRIPT, /\[data-hw-sin-guardar\]/);
  assert.match(SCRIPT, /montarCrepe\([^)]*alCambiar\s*:/s, "Crepe avisa de cada cambio con alCambiar");
});

// =====================================================================
// C5: títulos en móvil
// =====================================================================

test("C5 global.css: a ≤600 px los tokens de título bajan a 28/22/18 px (la base sigue en em)", () => {
  const movil = R.filter((x) => x.media && /max-width:\s*600px/.test(x.media) && /(^|,)\s*:root\s*($|,)/.test(x.selector));
  const cuerpo = movil.map((x) => x.cuerpo).join(";");
  assert.equal(prop(cuerpo, "--hw-h1-size"), "28px");
  assert.equal(prop(cuerpo, "--hw-h2-size"), "22px");
  assert.equal(prop(cuerpo, "--hw-h3-size"), "18px");
  const base = R.find((x) => !x.media && x.selector === ":root" && /--hw-h1-size/.test(x.cuerpo));
  assert.equal(prop(base.cuerpo, "--hw-h1-size"), "2.625em");
  const iBase = R.indexOf(base);
  assert.ok(movil.every((x) => R.indexOf(x) > iBase), "el @media va después de la definición base");
});
