// Lote «sueltos-teclado». Dos pendientes del portal:
// C1–C4: el enlace #comentario-<uuid> deja el comentario arriba (bajo la cabecera), con foco y con un anillo que se ve
//        aunque se llegue con el ratón; el tabindex temporal se retira al salir y un destino que no existe no rompe nada.
// A1–A4: la tecla «?» no se dispara al escribir (tampoco dentro de un shadow DOM), y con la ayuda abierta la cierra.
// Lógica pura importada y probada con jsdom; scripts y CSS comprobados sobre las fuentes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as atajosLib from "../src/lib/atajos.ts";
import * as comLib from "../src/lib/comentarios.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const UUID = "00000000-0000-4000-8000-000000000001";
const OTRO = "00000000-0000-4000-8000-000000000002";
const fn = (mod, archivo, nombre) => {
  assert.equal(typeof mod[nombre], "function", `${archivo} debe exportar ${nombre}()`);
  return mod[nombre];
};

// ---------- C1–C3. enfocarComentario ----------
function pagina() {
  const dom = new JSDOM(`<button id="antes">antes</button><ol>
    <li class="comentario" id="comentario-${UUID}"><p>hilo</p>
      <ol><li class="comentario" id="comentario-${OTRO}"><p>respuesta</p></li></ol>
    </li></ol><button id="despues">después</button>`);
  const doc = dom.window.document;
  const llamadas = [];
  // jsdom no trae scrollIntoView: se espía en el prototipo, junto con las opciones de focus().
  dom.window.Element.prototype.scrollIntoView = function (o) {
    llamadas.push({ que: "scroll", id: this.id, o });
  };
  const focusReal = dom.window.HTMLElement.prototype.focus;
  dom.window.HTMLElement.prototype.focus = function (o) {
    llamadas.push({ que: "focus", id: this.id, o });
    return focusReal.call(this, o);
  };
  return { doc, llamadas };
}

test("C1 enfocarComentario: lleva el comentario arriba (block start), sin centrarlo, y le da el foco sin un segundo salto", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc, llamadas } = pagina();
  assert.equal(enfocar(doc, UUID), true);
  const li = doc.getElementById(`comentario-${UUID}`);
  assert.equal(doc.activeElement, li, "el foco queda en el comentario: teclado y lector de pantalla parten de ahí");
  assert.equal(li.getAttribute("tabindex"), "-1", "enfocable por script, fuera del orden de tabulación");
  const scroll = llamadas.find((l) => l.que === "scroll");
  assert.ok(scroll, "llama a scrollIntoView");
  assert.equal(scroll.id, li.id);
  assert.equal(scroll.o?.block, "start", "arriba: scroll-padding-top del documento lo deja bajo la cabecera fija");
  const foco = llamadas.find((l) => l.que === "focus");
  assert.equal(foco.o?.preventScroll, true, "focus() no vuelve a desplazar");
  assert.ok(llamadas.indexOf(scroll) < llamadas.indexOf(foco), "primero desplaza, luego enfoca");
});

test("C1 enfocarComentario: también enfoca una respuesta dentro de un hilo (solo ella, no el hilo)", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc } = pagina();
  assert.equal(enfocar(doc, OTRO), true);
  assert.equal(doc.activeElement.id, `comentario-${OTRO}`);
  assert.equal(doc.getElementById(`comentario-${UUID}`).hasAttribute("tabindex"), false);
});

test("C2 enfocarComentario: al perder el foco se retira el tabindex (un clic posterior ya no lo enfoca ni pinta el anillo)", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc } = pagina();
  enfocar(doc, UUID);
  const li = doc.getElementById(`comentario-${UUID}`);
  doc.getElementById("despues").focus();
  assert.equal(li.hasAttribute("tabindex"), false, "sin tabindex tras el blur");
  // Se puede volver a enfocar con el mismo enlace.
  assert.equal(enfocar(doc, UUID), true);
  assert.equal(doc.activeElement, li);
  assert.equal(li.getAttribute("tabindex"), "-1");
});

test("C3 enfocarComentario: si el comentario no existe (o no hay id) devuelve false y no toca el foco ni lanza", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc, llamadas } = pagina();
  const antes = doc.getElementById("antes");
  antes.focus();
  llamadas.length = 0;
  for (const id of ["00000000-0000-4000-8000-00000000ffff", null, undefined, ""]) {
    assert.equal(enfocar(doc, id), false, String(id));
  }
  assert.equal(doc.activeElement, antes, "el foco sigue donde estaba");
  assert.deepEqual(llamadas, [], "ni desplaza ni enfoca");
  // Un id que no es de comentario no se usa como selector ni como id arbitrario.
  doc.body.insertAdjacentHTML("beforeend", `<div id="comentario-x" tabindex="0"></div>`);
  assert.equal(enfocar(doc, "x"), false, "solo UUID");
});

test("C1/C3 scripts/comentarios.ts: los dos caminos (tras pintar y en hashchange) usan enfocarComentario; ya no centra", () => {
  const js = read("src/scripts/comentarios.ts");
  assert.match(js, /import \{[^}]*\benfocarComentario\b[^}]*\} from "\.\.\/lib\/comentarios(\.ts)?"/);
  const p = js.slice(js.indexOf("function pintar()"), js.indexOf("function pintarHilo"));
  assert.match(p, /enfocarComentario\(/, "pintar(): enfoca el destino pendiente al terminar de cargar");
  const h = js.slice(js.indexOf("function abrirDesdeHash()"), js.indexOf("abrirDesdeHash();\n"));
  assert.match(h, /enfocarComentario\(/, "abrirDesdeHash(): enfoca al momento si la lista ya cargó");
  assert.doesNotMatch(js, /block:\s*["']center["']/, "centrar esconde el inicio de un hilo más alto que la pantalla");
  assert.doesNotMatch(js, /destino\.scrollIntoView|destino\.focus\(/, "sin copias de la lógica en el script");
});

// ---------- C4. Indicador de foco ----------
test("C4 CSS: el comentario enfocado por enlace lleva el anillo del sitio con :focus (no solo :focus-visible) y solo tokens", () => {
  const css = read("src/styles/global.css");
  const regla = css.match(/\.comentario:focus\s*\{([^}]*)\}/);
  assert.ok(regla, "falta la regla .comentario:focus (tras un clic de ratón :focus-visible no se cumple)");
  assert.match(regla[1], /outline:\s*2px solid var\(--accent\)/, "mismo anillo que el resto del sitio");
  assert.match(regla[1], /outline-offset:\s*2px/);
  assert.doesNotMatch(regla[1], /#[0-9a-f]{3,8}\b|rgb\(|animation|box-shadow|background/i, "sobrio: sin colores sueltos, fondo, sombra ni animación");
});

// ---------- A1–A2. «?» no se dispara al escribir ----------
function campos() {
  const dom = new JSDOM(`<main><p id="texto">texto <a id="enlace" href="#x">enlace</a></p><button id="boton">b</button>
    <input id="input"><textarea id="textarea"></textarea><select id="select"><option>a</option></select>
    <div id="editor" contenteditable="true"><p id="parrafo">hola</p></div>
    <div id="rol" role="textbox" tabindex="0"><span id="rol-dentro">x</span></div>
    <div id="buscador" role="searchbox" tabindex="0"></div>
    <div id="visor"></div></main>`);
  const doc = dom.window.document;
  const raiz = doc.getElementById("visor").attachShadow({ mode: "open" });
  raiz.innerHTML = `<input id="dentro"><button id="boton-dentro">b</button>`;
  // Dispara un keydown real y devuelve lo que vería el listener de document.
  const visto = (origen, escribiendoEn) => {
    let r = null;
    const oir = (e) => (r = escribiendoEn(e));
    doc.addEventListener("keydown", oir);
    origen.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, composed: true }));
    doc.removeEventListener("keydown", oir);
    return r;
  };
  return { doc, raiz, visto };
}

test("A1 escribiendoEn: campos de texto, select, contenteditable y roles de texto cuentan como «escribiendo»", () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { doc, visto } = campos();
  for (const id of ["input", "textarea", "select", "editor", "parrafo", "rol", "rol-dentro", "buscador"]) {
    assert.equal(visto(doc.getElementById(id), escribiendoEn), true, `#${id}`);
  }
  for (const id of ["texto", "enlace", "boton"]) assert.equal(visto(doc.getElementById(id), escribiendoEn), false, `#${id}`);
  assert.equal(visto(doc.body, escribiendoEn), false, "sin foco en nada");
});

test("A2 escribiendoEn: un campo dentro de un shadow DOM (visores) también cuenta, aunque e.target sea el anfitrión", () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { raiz, visto } = campos();
  assert.equal(visto(raiz.getElementById("dentro"), escribiendoEn), true, "input en shadow DOM");
  assert.equal(visto(raiz.getElementById("boton-dentro"), escribiendoEn), false, "un botón en shadow DOM no es escribir");
});

test("A1 escribiendoEn: destinos raros (document, null, sin composedPath) no lanzan y no cuentan", () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { doc } = campos();
  assert.equal(escribiendoEn({ target: doc }), false);
  assert.equal(escribiendoEn({ target: null }), false);
  assert.equal(escribiendoEn({ target: doc.getElementById("input") }), true, "sin composedPath usa target");
  assert.equal(escribiendoEn({ target: doc.getElementById("boton"), composedPath: () => [] }), false);
});

test("A1/A2 scripts/atajos.ts: delega en escribiendoEn(e) y ya no decide con e.target.closest", () => {
  const s = read("src/scripts/atajos.ts");
  assert.match(s, /import \{[^}]*\bescribiendoEn\b[^}]*\} from "\.\.\/lib\/atajos(\.ts)?"/);
  assert.match(s, /escribiendo:\s*escribiendoEn\(e\)/);
  assert.doesNotMatch(s, /e\.target[^;\n]*closest/, "e.target es el anfitrión cuando la tecla viene de un shadow DOM");
});

// ---------- A3–A4. «?» con la ayuda abierta ----------
const { atajo, ATAJOS } = atajosLib;
const t = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, escribiendo: false, dialogoAbierto: false, t: 1000, ...extra });
const ABIERTA = { dialogoAbierto: true, ayudaAbierta: true };

test("A3 atajo: con la ayuda abierta, «?» (con o sin Mayús) devuelve «ayuda» para cerrarla", () => {
  assert.equal(atajo(null, t("?", { ...ABIERTA, shiftKey: true })).accion, "ayuda", "teclado español: Mayús + '");
  assert.equal(atajo(null, t("?", ABIERTA)).accion, "ayuda");
  assert.equal(atajo(null, t("?", { ...ABIERTA, shiftKey: true })).pendiente, null);
});

test("A3 atajo: con la ayuda abierta el resto de atajos sigue en pausa, y «?» respeta escribir, modificadores y repetición", () => {
  for (const k of ["g", "w", "f", "[", "]", "n"]) {
    const r = atajo(1000, t(k, { ...ABIERTA, t: 1100 }));
    assert.equal(r.accion, null, k);
    assert.equal(r.pendiente, null, `${k} no deja nada pendiente`);
  }
  for (const extra of [{ escribiendo: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { repetida: true }, { altGraph: true }]) {
    assert.equal(atajo(null, t("?", { ...ABIERTA, ...extra })).accion, null, JSON.stringify(extra));
  }
});

test("A3 atajo: con otro diálogo abierto (no la ayuda) «?» no hace nada", () => {
  assert.equal(atajo(null, t("?", { dialogoAbierto: true })).accion, null);
  assert.equal(atajo(null, t("?", { dialogoAbierto: true, ayudaAbierta: false, shiftKey: true })).accion, null);
});

test("A3 scripts/atajos.ts: avisa de que la ayuda está abierta y la acción «ayuda» alterna (cierra si ya está abierta)", () => {
  const s = read("src/scripts/atajos.ts");
  assert.match(s, /ayudaAbierta:\s*dialogo\.open\b/);
  const rama = s.slice(s.indexOf('r.accion === "ayuda"'));
  assert.ok(rama.length > 0 && rama !== s, "sigue habiendo una rama para la ayuda");
  const cuerpo = rama.slice(0, rama.indexOf("return;"));
  assert.match(cuerpo, /dialogo\.open/, "mira si ya está abierta: showModal() sobre un diálogo abierto lanza InvalidStateError");
  assert.match(cuerpo, /dialogo\.close\(\)/);
  assert.match(cuerpo, /dialogo\.showModal\(\)/);
});

test("A4 ATAJOS: la fila de «?» dice que también la oculta, y la ayuda no gana filas", () => {
  const filas = ATAJOS.filter((a) => a.teclas.join(" ") === "?");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].descripcion, "Mostrar u ocultar esta ayuda");
  assert.equal(ATAJOS.length, 9);
});

test("A4 Base.astro: la nota del diálogo ya no dice que todos los atajos se pausan (ahora «?» lo cierra) y sigue siendo una línea", () => {
  const src = read("src/layouts/Base.astro");
  const nota = src.match(/<p class="atajos-nota">([^<]*)<\/p>/)?.[1] ?? "";
  assert.match(nota, /\?/, "nombra la tecla que cierra la ayuda");
  assert.match(nota, /Esc/, "y Esc");
  assert.ok(nota.length <= 90, `corta (${nota.length} caracteres)`);
});
