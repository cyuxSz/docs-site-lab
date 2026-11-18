// Editor visual: Tab desde un párrafo sale hacia los botones de acción (no a los botones internos de los bloques de código) y
// una tabla recién insertada con el menú «/» se serializa como tabla Markdown válida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepararDom } from "./fixtures/dom-editor.mjs";

const dom = prepararDom();
const doc = dom.window.document;
// jsdom no mide: el cursor virtual de Crepe pide los rectángulos de cualquier rango (también los de la selección).
dom.window.Range.prototype.getClientRects ??= () => [];
dom.window.Range.prototype.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
const mod = await import("../src/lib/editor-visual-crepe.ts");

async function montar(md) {
  const form = doc.createElement("div");
  form.innerHTML = '<button id="antes">Markdown</button><div id="ed"></div><button id="adj">Adjuntar</button><button id="otro">Guardar</button>';
  doc.body.append(form);
  const raiz = form.querySelector("#ed");
  const ed = await mod.montarCrepe(raiz, md);
  return { ed, form };
}
const tecla = (ed, shiftKey) => {
  const e = new dom.window.KeyboardEvent("keydown", { key: "Tab", keyCode: 9, shiftKey, bubbles: true, cancelable: true });
  ed.vista.dom.dispatchEvent(e);
  return e;
};
async function cursorEn(ed, pos) {
  const { TextSelection } = await import("@milkdown/kit/prose/state");
  ed.vista.dispatch(ed.vista.state.tr.setSelection(TextSelection.create(ed.vista.state.doc, pos)));
}

test("Tab en un párrafo mueve el foco al primer botón de acción y Mayús+Tab al anterior al editor", async () => {
  const { ed, form } = await montar("Un párrafo.\n\n```diagrama\ntitulo: x\n```\n");
  await cursorEn(ed, 3);
  const e = tecla(ed, false);
  assert.equal(e.defaultPrevented, true);
  assert.equal(doc.activeElement, form.querySelector("#adj"));
  await cursorEn(ed, 3);
  tecla(ed, true);
  assert.equal(doc.activeElement, form.querySelector("#antes"));
  await ed.destruir();
});

test("Tab en una lista no se captura (sangra)", async () => {
  const { ed } = await montar("- uno\n- dos\n");
  await cursorEn(ed, 10);
  const e = tecla(ed, false);
  assert.notEqual(doc.activeElement?.id, "adj");
  assert.ok(e.defaultPrevented, "lo gestiona la lista (sangrar)");
  await ed.destruir();
});

test("tabla recién insertada (cabecera y celdas vacías) se serializa como tabla Markdown válida y sobrevive al reemplazarTodo", async () => {
  const { ed } = await montar("Texto\n");
  const { createTable } = await import("@milkdown/kit/preset/gfm");
  const { addBlockTypeCommand, clearTextInCurrentBlockCommand } = await import("@milkdown/kit/preset/commonmark");
  const { commandsCtx } = await import("@milkdown/kit/core");
  ed.editor.action((ctx) => {
    const c = ctx.get(commandsCtx);
    c.call(clearTextInCurrentBlockCommand.key);
    c.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) });
  });
  const md = ed.getMarkdown();
  const filas = md.split("\n").filter((l) => l.startsWith("|"));
  assert.ok(filas.length >= 3, `se esperaba una tabla con cabecera, separador y filas:\n${md}`);
  assert.match(filas[1], /^\|(\s*:?-+:?\s*\|)+$/, "separador válido");
  const columnas = (l) => l.split("|").length;
  assert.ok(filas.every((l) => columnas(l) === columnas(filas[0])), "mismo número de columnas");
  ed.reemplazarTodo(md);
  const otra = ed.getMarkdown();
  // Todas las celdas (filas y columnas) iguales; solo puede cambiar el relleno y los guiones del separador.
  const celdas = (texto) =>
    texto.split("\n").filter((l) => l.startsWith("|")).map((l) => {
      const c = l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((x) => x.trim());
      return c.length && c.every((x) => /^:?-+:?$/.test(x)) ? c.map((x) => x.replace(/-+/g, "-")) : c;
    });
  assert.deepEqual(celdas(otra), celdas(md), "no se pierde ninguna fila ni columna al pasar de modo");
  await ed.destruir();
});

test("CSS: el botón Editar diagrama usa el fondo del portal y la tabla el color de borde del portal", () => {
  const css = readFileSync(new URL("../src/styles/editor-visual.css", import.meta.url), "utf8");
  const boton = css.match(/\.hw-diagrama-editar \{[^}]*\}/)[0];
  assert.match(boton, /background: var\(--surface\)/);
  assert.match(css, /milkdown-table-block :is\(th, td\)\s*\{\s*border-color: var\(--line\)/);
});
