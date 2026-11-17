// D1a (móvil): la BOM no cae en la regla responsive de tablas y se desplaza con teclado; sin visor de PDF no se monta el iframe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const md = () => import("../src/lib/hardware-md.ts");
const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const ventana = () => new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const op = { proyecto: "uuv", slug: "p", vistaPrevia: false, descargar() {} };

test("CSS: la regla responsive de tablas excluye .hw-bom, que conserva layout de tabla dentro de una figura con overflow-x", () => {
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.prose figure\.hw-bom table \{ display: table;/);
  assert.match(css, /\.prose figure\.hw-bom :is\(td, th\) \{ display: table-cell/);
  assert.match(css, /\.prose figure\.hw-bom td::before \{ content: none/);
  assert.match(css, /figure\.hw-bom \{[^}]*overflow-x: auto/);
  assert.match(css, /figure\.hw-bom table \{[^}]*display: table/);
  assert.match(css, /figure\.hw-pdf iframe \{[^}]*height: min\(70vh/);
});

test("montarVisores: la figura BOM es una región enfocable con nombre accesible", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const t = "```bom\nreferencia,descripcion,cantidad,costo_unitario\nR1,x,1,1\n```\n";
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(t));
  montarVisores(win.document.body, t, op);
  const f = win.document.querySelector("figure.hw-bom");
  assert.equal(f.getAttribute("tabindex"), "0");
  assert.equal(f.getAttribute("role"), "region");
  assert.ok(f.getAttribute("aria-label"));
});

test("montarVisores: con navigator.pdfViewerEnabled === false no hay iframe y queda 'Abrir PDF'", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const t = `\`\`\`pdf\narchivo: ${A}\n\`\`\`\n`;
  for (const [valor, esperados] of [[false, 0], [true, 1]]) {
    const win = ventana();
    Object.defineProperty(win.navigator, "pdfViewerEnabled", { value: valor, configurable: true });
    win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(t));
    montarVisores(win.document.body, t, op);
    assert.equal(win.document.querySelectorAll("iframe").length, esperados);
    assert.ok(win.document.querySelector("figure.hw-pdf a"));
  }
});

test("CSS: el iframe del PDF usa el fondo del tema (no blanco fijo en tema oscuro)", () => {
  const regla = /figure\.hw-pdf iframe \{([^}]*)\}/.exec(css)[1];
  assert.match(regla, /background: var\(--surface\)/);
  assert.doesNotMatch(regla, /white|#fff/i);
});
