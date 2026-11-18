// Editor visual: ida y vuelta real con Milkdown Crepe montado en jsdom (src/lib/editor-visual-crepe.ts). Cargar una página y
// sacar el Markdown sin tocar nada no puede cambiar los bloques del portal (pdf, bom, diagrama, mermaid, código) ni los enlaces
// de archivo /api/archivos/?...; la única diferencia admitida es el relleno de las tablas. Además: funciones activas, insertar
// en el cursor, Tab sale del editor en un párrafo, nombre accesible y ninguna imagen como blob: (las subidas van por el portal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepararDom } from "./fixtures/dom-editor.mjs";

const dom = prepararDom();
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
// Con core.autocrlf el fixture puede salir con CRLF en Windows: Milkdown siempre devuelve LF.
const FIXTURE = leer("tests/fixtures/editor-visual/pagina-completa.md").replace(/\r\n/g, "\n");
const PDF = "2f4b20ae-ad0a-48f2-9047-98aa57be8f55";

let mod = null;
let conf = null;
let fallo = null;
try {
  mod = await import("../src/lib/editor-visual-crepe.ts");
  conf = await import("../src/lib/editor-visual.ts");
} catch (e) {
  fallo = e;
}
const M = () => {
  assert.ok(mod && conf, `no se pudo importar el editor visual: ${fallo?.message}`);
  return mod;
};

async function montar(md, opciones) {
  const raiz = dom.window.document.createElement("div");
  dom.window.document.body.append(raiz);
  const ed = await M().montarCrepe(raiz, md, opciones);
  return { ed, raiz };
}

const bloques = (md) => md.match(/^```[\w-]*\n[\s\S]*?^```$/gm) ?? [];
const enlacesArchivo = (md) => {
  const sinCodigo = md.replace(/^```[\w-]*\n[\s\S]*?^```$/gm, "");
  return sinCodigo.match(/!?\[[^\]]*\]\(\/api\/archivos\/[^)]*\)/g) ?? [];
};
// Diferencia admitida: una fila de tabla que solo cambia en espacios de relleno o en el número de guiones del separador.
const filaNormal = (l) => l.replace(/\s+/g, "").replace(/-+/g, "-");
function diferenciasNoAdmitidas(a, b) {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length !== y.length) return [`número de líneas: ${x.length} → ${y.length}`];
  const malas = [];
  x.forEach((l, i) => {
    if (l === y[i]) return;
    if (l.trimStart().startsWith("|") && filaNormal(l) === filaNormal(y[i])) return;
    malas.push(`${i + 1}: ${JSON.stringify(l)} → ${JSON.stringify(y[i])}`);
  });
  return malas;
}

test("ida y vuelta de la página completa: bloques y enlaces de archivo idénticos; solo cambia el relleno de tablas", async () => {
  const { ed } = await montar(FIXTURE);
  const salida = ed.getMarkdown();
  assert.deepEqual(bloques(salida), bloques(FIXTURE), "bloques pdf/bom/diagrama/mermaid/código");
  assert.equal(bloques(FIXTURE).length, 6);
  assert.deepEqual(enlacesArchivo(salida), enlacesArchivo(FIXTURE), "enlaces /api/archivos/ tal cual (sin \\&)");
  assert.equal(enlacesArchivo(FIXTURE).length, 2);
  assert.match(salida, /!\[foto de la PDB\.png\]\(\/api\/archivos\//, "el alt de la imagen se conserva");
  assert.deepEqual(diferenciasNoAdmitidas(FIXTURE, salida), []);
  await ed.destruir();
});

test("ida y vuelta de las plantillas reales (electrónica y mecánica): idénticas", async () => {
  for (const nombre of ["electronica", "mecanica"]) {
    const paginas = JSON.parse(leer(`plantillas/${nombre}.json`));
    for (const p of paginas) {
      const { ed } = await montar(p.md);
      assert.equal(ed.getMarkdown(), p.md, `${nombre}/${p.slug}`);
      await ed.destruir();
    }
  }
});

test("reemplazarTodo (vuelta desde el modo Markdown) deja el mismo resultado que montar de cero", async () => {
  const { ed } = await montar("# Vacía\n");
  ed.reemplazarTodo(FIXTURE);
  assert.deepEqual(bloques(ed.getMarkdown()), bloques(FIXTURE));
  assert.deepEqual(enlacesArchivo(ed.getMarkdown()), enlacesArchivo(FIXTURE));
  await ed.destruir();
});

test("funciones activas en el editor montado = FUNCIONES_ACTIVAS", async () => {
  const { ed } = await montar("# Hola\n");
  const activas = ed.editor.action((ctx) => ctx.use("FeaturesCtx").get());
  assert.deepEqual([...activas].sort(), [...conf.FUNCIONES_ACTIVAS].sort());
  await ed.destruir();
});

test("insertarMarkdown: el bloque entra en la posición del cursor del editor visual", async () => {
  const { ed } = await montar("# Título\n\nPrimer párrafo.\n\nSegundo párrafo.\n");
  const { TextSelection } = await import("@milkdown/kit/prose/state");
  const v = ed.vista;
  let fin = -1;
  v.state.doc.descendants((n, pos) => {
    if (n.isTextblock && n.textContent === "Primer párrafo.") fin = pos + 1 + n.content.size;
  });
  assert.ok(fin > 0);
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, fin)));
  const bloque = `\`\`\`pdf\narchivo: ${PDF}\ntitulo: Manual\n\`\`\`\n`;
  ed.insertarMarkdown(bloque);
  const md = ed.getMarkdown();
  const i = md.indexOf("Primer párrafo.");
  const j = md.indexOf("```pdf");
  const k = md.indexOf("Segundo párrafo.");
  assert.ok(i >= 0 && i < j && j < k, md);
  assert.ok(md.includes(bloque.trimEnd()), "el bloque sale idéntico");
  await ed.destruir();
});

test("Tab en un párrafo no lo captura el editor (sale hacia los botones de acción)", async () => {
  const { ed } = await montar("Un párrafo.\n");
  const { TextSelection } = await import("@milkdown/kit/prose/state");
  const v = ed.vista;
  v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 3)));
  const e = new dom.window.KeyboardEvent("keydown", { key: "Tab", keyCode: 9, bubbles: true, cancelable: true });
  v.dom.dispatchEvent(e);
  assert.equal(e.defaultPrevented, false, "sin el atajo Tab del plugin indent");
  assert.equal(ed.getMarkdown(), "Un párrafo.\n", "no inserta espacios");
  await ed.destruir();
});

test("nombre accesible: el área editable se llama «Contenido de la página» y es un textbox multilínea", async () => {
  const { ed } = await montar("Hola\n");
  const d = ed.vista.dom;
  assert.equal(d.getAttribute("contenteditable"), "true");
  assert.equal(d.getAttribute("aria-label"), "Contenido de la página");
  assert.equal(d.getAttribute("role"), "textbox");
  assert.equal(d.getAttribute("aria-multiline"), "true");
  await ed.destruir();
});

test("subidas: el uploader de Milkdown no crea imágenes blob: (pegar y soltar van por el flujo del portal)", async () => {
  const { ed } = await montar("Hola\n");
  const { uploadConfig } = await import("@milkdown/kit/plugin/upload");
  const { schemaCtx } = await import("@milkdown/kit/core");
  const archivo = new dom.window.File(["x"], "foto.png", { type: "image/png" });
  const lista = { length: 1, item: () => archivo, 0: archivo };
  const nodos = await ed.editor.action((ctx) => ctx.get(uploadConfig.key).uploader(lista, ctx.get(schemaCtx), ctx));
  assert.deepEqual(nodos, []);
  assert.doesNotMatch(ed.getMarkdown(), /blob:/);
  await ed.destruir();
});

test("solo lectura mientras se guarda: setSoloLectura bloquea y desbloquea la edición", async () => {
  const { ed } = await montar("Hola\n");
  ed.setSoloLectura(true);
  assert.equal(ed.vista.dom.getAttribute("contenteditable"), "false");
  ed.setSoloLectura(false);
  assert.equal(ed.vista.dom.getAttribute("contenteditable"), "true");
  await ed.destruir();
});
