// Editor visual: Esc seguido de Tab sale del editor hacia el primer botón de acción desde cualquier sitio (párrafo, lista, tabla o
// bloque de código), y Esc seguido de Mayús+Tab hacia el control anterior al editor. Sin Esc, Tab conserva su significado: sangra
// en listas y pasa a la celda siguiente en tablas. Crepe se monta de verdad en jsdom, con los bloques de código montados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepararDom } from "./fixtures/dom-editor.mjs";

const dom = prepararDom({ bloquesVisibles: true });
const doc = dom.window.document;
const mod = await import("../src/lib/editor-visual-crepe.ts");
const { TextSelection } = await import("@milkdown/kit/prose/state");

async function montar(md) {
  const form = doc.createElement("div");
  form.innerHTML = '<button id="antes">Markdown</button><div id="ed"></div><button id="adj">Adjuntar</button><button id="otro">Guardar</button>';
  doc.body.append(form);
  const ed = await mod.montarCrepe(form.querySelector("#ed"), md);
  await new Promise((r) => setTimeout(r, 150)); // los bloques de código se montan en un microtask
  return { ed, form, cerrar: async () => { await ed.destruir(); form.remove(); } };
}
const tecla = (destino, key, extra = {}) => {
  const e = new dom.window.KeyboardEvent("keydown", { key, keyCode: key === "Tab" ? 9 : key === "Escape" ? 27 : 0, bubbles: true, cancelable: true, ...extra });
  destino.dispatchEvent(e);
  return e;
};
// Posición dentro del primer nodo de texto `texto` cuyo bloque padre es de tipo `tipo` (o cualquiera).
function posDe(ed, texto, tipo) {
  let pos = -1;
  ed.vista.state.doc.descendants((n, p, padre) => {
    if (pos >= 0) return false;
    if (n.isText && n.text === texto && (!tipo || ed.vista.state.doc.resolve(p).node(-1)?.type.name === tipo)) pos = p + 1;
  });
  assert.ok(pos >= 0, `no se encontró «${texto}»`);
  return pos;
}
function cursorEn(ed, pos) {
  ed.vista.dispatch(ed.vista.state.tr.setSelection(TextSelection.create(ed.vista.state.doc, pos)));
  // (sin vista.focus(): en jsdom dispara un bucle de medidas)
}

test("Esc y luego Tab en una lista sale al primer botón de acción", async () => {
  const { ed, form, cerrar } = await montar("- uno\n- dos\n");
  cursorEn(ed, posDe(ed, "dos"));
  tecla(ed.vista.dom, "Escape");
  const e = tecla(ed.vista.dom, "Tab");
  assert.equal(e.defaultPrevented, true);
  assert.equal(doc.activeElement, form.querySelector("#adj"));
  assert.match(ed.getMarkdown(), /^- uno\n- dos\n?$/, "no sangró la lista");
  await cerrar();
});

test("Esc y luego Tab en una celda de tabla sale al primer botón de acción; Esc y Mayús+Tab, al control anterior", async () => {
  const md = "| a | b |\n| - | - |\n| 1 | 2 |\n";
  const { ed, form, cerrar } = await montar(md);
  cursorEn(ed, posDe(ed, "1"));
  tecla(ed.vista.dom, "Escape");
  tecla(ed.vista.dom, "Tab");
  assert.equal(doc.activeElement, form.querySelector("#adj"));
  cursorEn(ed, posDe(ed, "1"));
  tecla(ed.vista.dom, "Escape");
  tecla(ed.vista.dom, "Tab", { shiftKey: true });
  assert.equal(doc.activeElement, form.querySelector("#antes"));
  await cerrar();
});

test("Esc y luego Tab dentro de un bloque de código (CodeMirror) sale al primer botón de acción", async () => {
  const { ed, form, cerrar } = await montar("Antes.\n\n```python\nprint(1)\n```\n\nDespués.\n");
  const cm = form.querySelector("#ed .cm-content");
  assert.ok(cm, "el bloque de código está montado (CodeMirror)");
  // Sin cm.focus(): en jsdom el foco en CodeMirror dispara un bucle de medidas; las teclas se mandan sobre su contenido.
  tecla(cm, "Escape");
  tecla(cm, "Tab");
  assert.equal(doc.activeElement, form.querySelector("#adj"), "no cae en los botones internos del bloque ni se queda en el código");
  assert.match(ed.getMarkdown(), /```python\nprint\(1\)\n```/, "el código no cambia");
  await cerrar();
});

test("Esc y luego Tab en un párrafo también sale (mismo destino que Tab solo)", async () => {
  const { ed, form, cerrar } = await montar("Un párrafo.\n");
  cursorEn(ed, 3);
  tecla(ed.vista.dom, "Escape");
  tecla(ed.vista.dom, "Tab");
  assert.equal(doc.activeElement, form.querySelector("#adj"));
  await cerrar();
});

test("sin Esc, Tab en una tabla pasa a la celda siguiente y no sale del editor", async () => {
  const { ed, form, cerrar } = await montar("| a | b |\n| - | - |\n| 1 | 2 |\n");
  cursorEn(ed, posDe(ed, "1"));
  const e = tecla(ed.vista.dom, "Tab");
  assert.equal(e.defaultPrevented, true);
  assert.notEqual(doc.activeElement, form.querySelector("#adj"));
  assert.equal(ed.vista.state.selection.$from.parent.textContent, "2", "el cursor pasó a la celda siguiente");
  await cerrar();
});

test("sin Esc, Tab en una lista sangra y no sale del editor", async () => {
  const { ed, form, cerrar } = await montar("- uno\n- dos\n");
  cursorEn(ed, posDe(ed, "dos"));
  const e = tecla(ed.vista.dom, "Tab");
  assert.equal(e.defaultPrevented, true);
  assert.notEqual(doc.activeElement, form.querySelector("#adj"));
  await cerrar();
});

test("Esc, otra tecla y luego Tab: ya no sale (Esc solo vale para la tecla siguiente)", async () => {
  const { ed, form, cerrar } = await montar("| a | b |\n| - | - |\n| 1 | 2 |\n");
  cursorEn(ed, posDe(ed, "1"));
  tecla(ed.vista.dom, "Escape");
  tecla(ed.vista.dom, "ArrowLeft");
  tecla(ed.vista.dom, "Tab");
  assert.notEqual(doc.activeElement, form.querySelector("#adj"));
  assert.equal(ed.vista.state.selection.$from.parent.textContent, "2", "Tab volvió a moverse entre celdas");
  await cerrar();
});
