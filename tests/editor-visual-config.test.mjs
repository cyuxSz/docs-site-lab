// Editor visual (Milkdown Crepe), parte pura: src/lib/editor-visual.ts. Fija qué funciones de Crepe están activas, el estilo
// de Markdown al serializar, los lenguajes de CodeMirror, los textos en español, qué Markdown se guarda (sin tocar nada se
// manda el original) y las tarjetas de los bloques del portal, que reutilizan el renderizador de la lectura (marked + DOMPurify).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const MODULO = "src/lib/editor-visual.ts";

let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/editor-visual.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `no se pudo importar ${MODULO}: ${fallo?.message}`);
  return lib;
};

const PDF = "2f4b20ae-ad0a-48f2-9047-98aa57be8f55";
const FUENTE = "04a238d1-a144-47df-a5cf-00bacb6b56e0";
const SVG = "0dec7eb3-19f8-43de-a025-d66a03eca897";

async function renderizador() {
  const { crearRenderizador } = await import("../src/lib/hardware-md.ts");
  const w = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
  return { html: crearRenderizador(w, { proyecto: "uuv" }).html, w };
}
const fragmento = (w, html) => {
  const t = w.document.createElement("template");
  t.innerHTML = html;
  return t.content;
};

// ---------- funciones de Crepe ----------

test("FUNCIONES_ACTIVAS: exactamente las que usamos (sin AI, TopBar, Latex ni ImageBlock)", () => {
  const { FUNCIONES_ACTIVAS, FUNCIONES_DESACTIVADAS } = L();
  assert.deepEqual([...FUNCIONES_ACTIVAS].sort(), ["block-edit", "code-mirror", "cursor", "link-tooltip", "list-item", "placeholder", "table", "toolbar"]);
  // ImageBlock guarda la proporción en el alt (![1.00](...)) y borra el nombre de la imagen: se queda fuera.
  assert.deepEqual([...FUNCIONES_DESACTIVADAS].sort(), ["ai", "image-block", "latex", "top-bar"]);
  for (const f of FUNCIONES_DESACTIVADAS) assert.ok(!FUNCIONES_ACTIVAS.includes(f), f);
});

test("el portal no renderiza fórmulas: no hay KaTeX ni remark-math en src (por eso Latex va desactivado)", () => {
  for (const rel of ["src/lib/hardware-md.ts", "src/scripts/hardware-editor.ts", "astro.config.mjs"]) assert.doesNotMatch(leer(rel), /katex|remark-math|rehype-katex/i, rel);
});

test("OPCIONES_MARKDOWN: viñetas con -, énfasis y negrita con *, separador con -", () => {
  const { OPCIONES_MARKDOWN } = L();
  assert.deepEqual(OPCIONES_MARKDOWN, { bullet: "-", emphasis: "*", strong: "*", rule: "-" });
});

test("LENGUAJES_CODEMIRROR: lista corta con los lenguajes útiles del equipo", () => {
  const { LENGUAJES_CODEMIRROR } = L();
  assert.ok(Array.isArray(LENGUAJES_CODEMIRROR));
  assert.ok(LENGUAJES_CODEMIRROR.length > 0 && LENGUAJES_CODEMIRROR.length <= 16, `son ${LENGUAJES_CODEMIRROR.length}`);
  for (const l of ["C", "C++", "Python", "JSON", "YAML", "XML", "Shell", "CMake", "Markdown"]) assert.ok(LENGUAJES_CODEMIRROR.includes(l), l);
  assert.equal(new Set(LENGUAJES_CODEMIRROR).size, LENGUAJES_CODEMIRROR.length, "sin repetidos");
});

test("el módulo puro no importa Milkdown ni CodeMirror (se carga con la lectura sin arrastrar el editor)", () => {
  assert.doesNotMatch(leer(MODULO), /from\s+["'](@milkdown|@codemirror|codemirror|vue)/);
});

// ---------- textos en español ----------

test("TEXTOS: menú /, barra, enlaces y bloques de código en español (ningún texto por defecto en inglés)", () => {
  const { TEXTOS, ETIQUETA_EDITOR } = L();
  assert.equal(ETIQUETA_EDITOR, "Contenido de la página");
  assert.match(TEXTOS.placeholder.text, /\//, "el marcador menciona el menú /");
  const be = TEXTOS.blockEdit;
  assert.equal(be.textGroup.label, "Texto");
  assert.equal(be.textGroup.text.label, "Párrafo");
  assert.equal(be.textGroup.h1.label, "Título 1");
  assert.equal(be.textGroup.quote.label, "Cita");
  assert.equal(be.textGroup.divider.label, "Separador");
  assert.equal(be.listGroup.label, "Listas");
  assert.equal(be.listGroup.taskList.label, "Tareas");
  assert.equal(be.advancedGroup.label, "Avanzado");
  assert.equal(be.advancedGroup.table.label, "Tabla");
  assert.equal(be.advancedGroup.codeBlock.label, "Código");
  const cm = TEXTOS.codeMirror;
  for (const k of ["searchPlaceholder", "noResultText", "copyText", "previewLabel", "previewLoading"]) assert.equal(typeof cm[k], "string", k);
  assert.equal(cm.previewOnlyByDefault, true, "los bloques del portal se ven como tarjeta al abrir");
  assert.equal(typeof cm.previewToggleText, "function");
  const tb = TEXTOS.toolbar;
  for (const k of ["boldLabel", "italicLabel", "strikethroughLabel", "codeLabel", "linkLabel"]) assert.equal(typeof tb[k], "string", k);
  assert.equal(typeof TEXTOS.linkTooltip.inputPlaceholder, "string");
  const ingles = /^(Search|No result|Copy|Preview|Loading|Edit|Hide|Bold|Italic|Strikethrough|Code|Link|Text|Heading|Quote|Divider|List|Advanced|Table|Paste link)/;
  const textos = [
    TEXTOS.placeholder.text, cm.searchPlaceholder, cm.noResultText, cm.copyText, cm.previewLabel, cm.previewLoading,
    cm.previewToggleText(true), cm.previewToggleText(false), ...Object.values(tb).filter((v) => typeof v === "string"), TEXTOS.linkTooltip.inputPlaceholder,
  ];
  for (const t of textos) assert.doesNotMatch(t, ingles, t);
});

// ---------- qué Markdown se guarda ----------

test("markdownParaGuardar: sin tocar nada se manda el Markdown de origen; si se editó, el del editor", () => {
  const { markdownParaGuardar } = L();
  const origen = "* viñeta\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
  const inicial = "- viñeta\n\n| a | b |\n| - | - |\n| 1 | 2 |\n"; // lo que devolvió getMarkdown() al cargar
  assert.equal(markdownParaGuardar({ actual: inicial, inicialEditor: inicial, origen }), origen);
  const editado = inicial + "\nNuevo párrafo\n";
  assert.equal(markdownParaGuardar({ actual: editado, inicialEditor: inicial, origen }), editado);
});

// ---------- tarjetas de los bloques del portal ----------

test("vistaBloque pdf: reutiliza el renderizador de la lectura (figure.hw-pdf con «Abrir PDF» y título)", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const salida = vistaBloque(html, "pdf", `archivo: ${PDF}\ntitulo: Hoja de datos del regulador`, { editable: true });
  assert.equal(typeof salida, "string");
  const f = fragmento(w, salida);
  const fig = f.querySelector("figure.hw-pdf");
  assert.ok(fig, "figure.hw-pdf");
  assert.match(fig.querySelector("a")?.getAttribute("href") ?? "", new RegExp(`^/api/archivos/\\?proyecto=uuv&id=${PDF}$`));
  assert.equal(fig.querySelector("figcaption")?.textContent, "Hoja de datos del regulador");
  assert.equal(f.querySelector("iframe"), null, "en el editor no se carga el visor en iframe");
});

test("vistaBloque bom: tabla real del portal con totales", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const salida = vistaBloque(html, "bom", "referencia,descripcion,cantidad,costo_unitario\nR1,Resistencia 10k,10,0.0032\nC1,Capacitor 100nF,4,0.01", { editable: true });
  const f = fragmento(w, salida);
  const tabla = f.querySelector("figure.hw-bom table");
  assert.ok(tabla, "figure.hw-bom > table");
  assert.equal(tabla.querySelectorAll("tbody tr").length, 2);
  assert.ok(tabla.querySelector("tfoot"), "fila de totales");
  assert.match(tabla.textContent, /Resistencia 10k/);
});

test("vistaBloque diagrama: SVG del almacén y botón «Editar diagrama» solo si se puede editar", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const cuerpo = `editor: excalidraw\nfuente: ${FUENTE}\nsvg: ${SVG}\ntitulo: Bloques de prueba`;
  const f = fragmento(w, vistaBloque(html, "diagrama", cuerpo, { editable: true }));
  const fig = f.querySelector("figure.hw-diagrama");
  assert.ok(fig, "figure.hw-diagrama");
  assert.equal(fig.querySelector("img")?.getAttribute("src"), `/api/archivos/?proyecto=uuv&id=${SVG}`);
  const b = f.querySelector("button.hw-diagrama-editar");
  assert.ok(b, "botón Editar diagrama");
  assert.equal(b.getAttribute("type"), "button");
  assert.equal(b.textContent, "Editar diagrama");
  assert.equal(b.dataset.fuente, FUENTE);
  assert.equal(b.dataset.editor, "excalidraw");
  const drawio = fragmento(w, vistaBloque(html, "diagrama", cuerpo.replace("excalidraw", "drawio"), { editable: true }));
  assert.equal(drawio.querySelector("button.hw-diagrama-editar")?.dataset.editor, "drawio");
  const lector = fragmento(w, vistaBloque(html, "diagrama", cuerpo, { editable: false }));
  assert.equal(lector.querySelector("button"), null);
});

test("vistaBloque: un bloque que no parsea u otro lenguaje se queda como código (null)", async () => {
  const { vistaBloque } = L();
  const { html } = await renderizador();
  assert.equal(vistaBloque(html, "pdf", "archivo: no-es-un-uuid", { editable: true }), null);
  assert.equal(vistaBloque(html, "bom", "esto,no\nes,un bom", { editable: true }), null);
  assert.equal(vistaBloque(html, "diagrama", "editor: paint\nfuente: x\nsvg: y", { editable: true }), null);
  assert.equal(vistaBloque(html, "python", 'print("hola")', { editable: true }), null);
  assert.equal(vistaBloque(html, "mermaid", "graph LR\n A-->B", { editable: true }), null);
});

test("vistaBloque: el título pasa por el saneado (sin HTML ni atributos de evento)", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const malo = `archivo: ${PDF}\ntitulo: <img src=x onerror=alert(1)><script>alert(2)</script>`;
  const salida = vistaBloque(html, "pdf", malo, { editable: true });
  if (salida === null) return; // también vale rechazarlo
  const f = fragmento(w, salida);
  assert.equal(f.querySelector("img, script, [onerror]"), null);
  assert.doesNotMatch(salida, /onerror=|<script/i);
  const d = vistaBloque(html, "diagrama", `editor: excalidraw\nfuente: ${FUENTE}\nsvg: ${SVG}\ntitulo: "><img src=x onerror=alert(1)>`, { editable: true });
  if (d !== null) assert.equal(fragmento(w, d).querySelector("[onerror]"), null);
});
