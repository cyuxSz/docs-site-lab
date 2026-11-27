// Lote «movil-impresion», seguimientos de severidad baja.
// S1: por debajo de 900 px, si el cajón derecho no tiene nada que mostrar, el atajo «]» no abre nada; y cuando un cajón
//     se cierra, el foco vuelve al elemento que lo tenía antes de abrirlo (si ya no está, al botón de ese lado).
// S2: la ayuda de atajos llama al panel derecho como lo llaman sus botones («índice» en escritorio, «datos de la página»
//     en pantalla estrecha).
// S3 (barras laterales bajo la cabecera real) está en tests/movil-impresion.test.mjs, que tiene el motor de cascada.
// El script del navegador (src/scripts/barras.ts) se ejecuta de verdad sobre un DOM de jsdom; no se busca solo texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { barras, etiquetaBarra } = await import("../src/lib/barras.ts");
const { ATAJOS } = await import("../src/lib/atajos.ts");

// ---------- S1. Lógica pura: alternar un cajón vacío no cambia el estado ----------
const base = (extra = {}) => ({ izqPlegada: false, derPlegada: false, enfoque: false, cajon: null, ...extra });

test("S1 barras(): en móvil, alternar un cajón vacío y cerrado devuelve el mismo estado (no se abre nada)", () => {
  const e = base();
  assert.equal(barras(e, { tipo: "alternar", lado: "der", movil: true, vacio: true }), e, "misma referencia: el script no aplica ni mueve el foco");
  const izqAbierto = base({ cajon: "izq" });
  assert.equal(barras(izqAbierto, { tipo: "alternar", lado: "der", movil: true, vacio: true }), izqAbierto, "con el otro cajón abierto tampoco cambia nada");
  const plegadas = base({ izqPlegada: true, derPlegada: true });
  assert.equal(barras(plegadas, { tipo: "alternar", lado: "der", movil: true, vacio: true }), plegadas, "lo plegado de escritorio no se toca");
});

test("S1 barras(): `vacio` solo frena la apertura en móvil; todo lo demás sigue igual", () => {
  assert.equal(barras(base(), { tipo: "alternar", lado: "der", movil: true, vacio: false }).cajon, "der", "con contenido se abre");
  assert.equal(barras(base(), { tipo: "alternar", lado: "der", movil: true }).cajon, "der", "sin el campo se comporta como antes");
  assert.equal(barras(base({ cajon: "der" }), { tipo: "alternar", lado: "der", movil: true, vacio: true }).cajon, null, "un cajón ya abierto siempre se puede cerrar");
  assert.deepEqual(barras(base(), { tipo: "alternar", lado: "der", movil: false, vacio: true }), base({ derPlegada: true }), "en escritorio el riel se pliega como siempre");
  assert.deepEqual(barras(base({ enfoque: true }), { tipo: "alternar", lado: "der", movil: true, vacio: true }), base(), "en modo lectura, «]» sigue saliendo del modo");
  assert.equal(barras(base(), { tipo: "alternar", lado: "izq", movil: true, vacio: false }).cajon, "izq");
});

// ---------- S1. El script de verdad, sobre la forma de [...slug].astro ----------
const NODOS = '<div><dt>Nodos en el grafo</dt><dd><ul><li><a href="/uuv/grafo/?node=a" id="nodo">nodo</a></li></ul></dd></div>';
const pagina = (dl) => `<!doctype html><html><body>
  <div class="doc doc-wiki">
    <div class="barra-caja barra-caja-izq">
      <button type="button" class="barra-btn" data-barra="izq" aria-controls="barra-izq"></button>
      <nav class="sidenav" id="barra-izq"><ul><li><a href="/uuv/quickstart/" id="nav1">Inicio</a></li></ul></nav>
    </div>
    <main id="contenido">
      <div class="barras-movil">
        <button type="button" id="movil-izq" data-barra="izq" aria-controls="barra-izq" aria-expanded="false"></button>
        <button type="button" id="movil-der" data-barra="der" aria-controls="barra-der" aria-expanded="false"></button>
      </div>
      <article class="prose"><p><a href="#seccion" id="enlace">Un enlace del texto</a> y <a href="#otra" id="enlace2">otro</a></p></article>
    </main>
    <div class="barra-caja barra-caja-der">
      <button type="button" class="barra-btn" id="riel-der" data-barra="der" aria-controls="barra-der"></button>
      <aside class="meta" id="barra-der"><dl>${dl}</dl>
        <nav class="toc-box"><p class="toc-title">En esta página</p><ul class="toc"><li><a href="#seccion" id="toc1">Sección</a></li></ul></nav>
      </aside>
    </div>
  </div>
  <div class="barras-velo" data-barras-velo hidden></div>
  <div class="sr-only" data-anuncio-lectura role="status" aria-live="polite"></div>
</body></html>`;

let n = 0;
// Monta la página, expone los globales que usa el script y lo importa de nuevo (la consulta evita la caché de módulos).
async function montar(dl, { movil = true } = {}) {
  const dom = new JSDOM(pagina(dl), { url: "https://docs.test/uuv/quickstart/", pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: movil, media: "", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const datos = new Map();
  const almacen = { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => void datos.set(k, String(v)), removeItem: (k) => void datos.delete(k) };
  for (const [k, v] of Object.entries({ window: w, document: w.document, localStorage: almacen, matchMedia: w.matchMedia })) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  await import(`../src/scripts/barras.ts?caso=${++n}`);
  const d = w.document;
  return {
    d,
    html: d.documentElement,
    el: (id) => d.getElementById(id),
    atajo: (accion) => d.dispatchEvent(new w.CustomEvent("wiki:barras", { detail: accion })),
    esc: () => d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    velo: d.querySelector("[data-barras-velo]"),
  };
}

test("S1 script: con el cajón derecho vacío, «]» no abre nada y el foco se queda donde estaba", async () => {
  const p = await montar("");
  p.el("enlace").focus();
  p.atajo("derecha");
  assert.equal(p.html.dataset.cajon, undefined, "no se abre el cajón (hoy: se abre vacío)");
  assert.equal(p.velo.hidden, true, "tampoco aparece el velo");
  assert.equal(p.el("movil-der").getAttribute("aria-expanded"), "false");
  assert.equal(p.d.activeElement, p.el("enlace"), "el foco no se mueve");
  p.esc();
  assert.equal(p.d.activeElement, p.el("enlace"), "y Esc no tiene nada que cerrar");
});

test("S1 script: el cajón está vacío cuando el <dl> de #barra-der no tiene hijos, aunque exista el índice (.toc-box), que en móvil no se muestra", async () => {
  const p = await montar("");
  assert.ok(p.el("barra-der").querySelector(".toc-box a[href]"), "la página de prueba tiene índice en el panel derecho");
  p.atajo("derecha");
  assert.equal(p.html.dataset.cajon, undefined);
  // El cajón izquierdo no se ve afectado.
  p.atajo("izquierda");
  assert.equal(p.html.dataset.cajon, "izq");
});

test("S1 script: con «Nodos en el grafo», «]» abre el cajón derecho y mete el foco dentro (como antes)", async () => {
  const p = await montar(NODOS);
  p.el("enlace").focus();
  p.atajo("derecha");
  assert.equal(p.html.dataset.cajon, "der");
  assert.equal(p.velo.hidden, false);
  assert.equal(p.el("movil-der").getAttribute("aria-expanded"), "true");
  assert.equal(p.d.activeElement, p.el("nodo"), "el foco entra al cajón");
});

test("S1 script: al cerrar con Esc un cajón abierto con el atajo, el foco vuelve al elemento que lo tenía", async () => {
  const p = await montar(NODOS);
  p.el("enlace").focus();
  p.atajo("derecha");
  p.esc();
  assert.equal(p.html.dataset.cajon, undefined, "Esc cierra el cajón");
  assert.equal(p.d.activeElement, p.el("enlace"), "el foco vuelve al enlace del texto (hoy: salta al botón del cajón)");
});

test("S1 script: lo mismo al cerrar con el velo, con el atajo otra vez y en el cajón izquierdo", async () => {
  const p = await montar(NODOS);
  p.el("enlace2").focus();
  p.atajo("izquierda");
  assert.equal(p.d.activeElement, p.el("nav1"), "el foco entra al cajón izquierdo");
  p.velo.click();
  assert.equal(p.html.dataset.cajon, undefined);
  assert.equal(p.d.activeElement, p.el("enlace2"), "clic fuera: el foco vuelve a donde estaba");

  p.atajo("derecha");
  p.atajo("derecha");
  assert.equal(p.html.dataset.cajon, undefined);
  assert.equal(p.d.activeElement, p.el("enlace2"), "«]» dos veces: abre, cierra y el foco vuelve");
});

test("S1 script: al pasar de un cajón al otro sin cerrar, el foco vuelve al punto de partida, no al cajón anterior", async () => {
  const p = await montar(NODOS);
  p.el("enlace").focus();
  p.atajo("izquierda");
  p.atajo("derecha");
  assert.equal(p.html.dataset.cajon, "der");
  p.esc();
  assert.equal(p.d.activeElement, p.el("enlace"));
});

test("S1 script: abierto con su botón, al cerrar el foco vuelve al botón (como antes)", async () => {
  const p = await montar(NODOS);
  p.el("movil-der").focus();
  p.el("movil-der").click();
  assert.equal(p.html.dataset.cajon, "der");
  p.esc();
  assert.equal(p.d.activeElement, p.el("movil-der"));
});

test("S1 script: si el elemento que tenía el foco ya no está en la página, el foco va al botón de ese lado", async () => {
  const p = await montar(NODOS);
  p.el("enlace").focus();
  p.atajo("derecha");
  p.el("enlace").remove();
  p.esc();
  assert.equal(p.html.dataset.cajon, undefined);
  assert.equal(p.d.activeElement?.getAttribute("data-barra"), "der", "respaldo: el botón del cajón que se cerró");
});

// El origen sigue en el documento pero ya no se puede enfocar (dejó de renderizarse con el cajón abierto: un enlace
// dentro de un <details> que se plegó, o algo que pasó a `hidden`/display:none). jsdom no calcula estilos de hoja, pero
// sí hace que focus() no tenga efecto con el atributo `hidden` y con display:none en línea, igual que el navegador.
test("S1 script: si el origen sigue en la página pero quedó oculto (`hidden`) y no recibe el foco, el foco va al botón de ese lado", async () => {
  const p = await montar(NODOS);
  p.el("enlace").focus();
  p.atajo("derecha");
  assert.equal(p.d.activeElement, p.el("nodo"), "el foco entra al cajón");
  p.el("enlace").hidden = true;
  p.esc();
  assert.equal(p.html.dataset.cajon, undefined, "Esc cierra el cajón");
  assert.ok(p.d.contains(p.el("enlace")), "el origen sigue en el documento");
  assert.notEqual(p.d.activeElement, p.el("nodo"), "el foco no se queda dentro del cajón cerrado (hoy: se queda ahí)");
  assert.equal(p.d.activeElement?.getAttribute("data-barra"), "der", "respaldo: el botón del cajón que se cerró");
});

test("S1 script: lo mismo si quien se oculta es un antecesor del origen (display:none), al cerrar con el velo y en el cajón izquierdo", async () => {
  const p = await montar(NODOS);
  p.el("enlace2").focus();
  p.atajo("izquierda");
  assert.equal(p.d.activeElement, p.el("nav1"));
  p.el("enlace2").parentElement.style.display = "none";
  p.velo.click();
  assert.equal(p.html.dataset.cajon, undefined);
  assert.equal(p.d.activeElement?.getAttribute("data-barra"), "izq", "respaldo: el botón del cajón izquierdo (hoy: el foco se queda en el cajón cerrado)");
});

test("S1 script: si el origen sí recibe el foco, el respaldo no interviene (ningún botón llega a tener el foco)", async () => {
  const p = await montar(NODOS);
  let enBoton = 0;
  for (const b of p.d.querySelectorAll("[data-barra]")) b.addEventListener("focus", () => enBoton++);
  p.el("enlace").focus();
  p.atajo("derecha");
  // Ocultar y volver a mostrar con el cajón abierto: lo que cuenta es el estado al cerrar.
  p.el("enlace").hidden = true;
  p.el("enlace").hidden = false;
  p.esc();
  assert.equal(p.d.activeElement, p.el("enlace"), "el foco vuelve al origen");
  assert.equal(enBoton, 0, "el foco no pasa por el botón");
});

test("S1 script: si nada tenía el foco al abrir, al cerrar va al botón de ese lado (no se pierde)", async () => {
  const p = await montar(NODOS);
  assert.equal(p.d.activeElement, p.d.body);
  p.atajo("derecha");
  p.esc();
  assert.equal(p.d.activeElement?.getAttribute("data-barra"), "der");
});

test("S1 script: en escritorio «]» sigue plegando el panel derecho aunque el <dl> esté vacío, y no mueve el foco", async () => {
  const p = await montar("", { movil: false });
  p.el("enlace").focus();
  p.atajo("derecha");
  assert.equal(p.html.dataset.barraDer, "plegada");
  assert.equal(p.html.dataset.cajon, undefined);
  assert.equal(p.d.activeElement, p.el("enlace"));
  p.atajo("derecha");
  assert.equal(p.html.dataset.barraDer, undefined);
});

// ---------- S2. La ayuda llama al panel derecho como lo llaman sus botones ----------
const nombre = (lado, movil) => etiquetaBarra(base(), lado, movil).replace(/^(Mostrar|Ocultar)\s+/, "");
const ayuda = (tecla) => ATAJOS.find((a) => a.teclas.join(" ") === tecla)?.descripcion ?? "";

test("S2: la ayuda de «]» nombra el panel derecho como sus botones: «índice» y «datos de la página»", () => {
  assert.equal(nombre("der", false), "índice");
  assert.equal(nombre("der", true), "datos de la página");
  const texto = ayuda("]");
  assert.match(texto, /^Mostrar u ocultar /, "misma forma que la entrada de «[»");
  assert.ok(texto.includes(nombre("der", false)), `nombra «${nombre("der", false)}» (escritorio): ${texto}`);
  assert.ok(texto.includes(nombre("der", true)), `nombra «${nombre("der", true)}» (pantalla estrecha, donde el cajón no trae índice): ${texto}`);
  assert.ok(texto.length <= 60, `la fila de la ayuda sigue siendo corta (${texto.length} caracteres)`);
});

test("S2: la ayuda de «[» sigue llamando «navegación» al panel izquierdo, y no hay entradas nuevas", () => {
  assert.equal(nombre("izq", false), "navegación");
  assert.equal(nombre("izq", true), "navegación");
  assert.ok(ayuda("[").includes("navegación"));
  assert.equal(ATAJOS.length, 9, "la ayuda no gana filas");
  assert.equal(ATAJOS.filter((a) => a.teclas.join(" ") === "]").length, 1);
});
