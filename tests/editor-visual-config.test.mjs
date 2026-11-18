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

// Comprueba en un fragmento que no quedan vectores de script: elementos script/iframe/object, atributos on*, ni URLs javascript:.
function sinVectores(w, salida, etiqueta) {
  const f = fragmento(w, salida);
  assert.equal(f.querySelector("script, iframe, object, embed"), null, `${etiqueta}: sin script/iframe/object`);
  for (const el of f.querySelectorAll("*")) {
    for (const a of el.attributes) {
      assert.doesNotMatch(a.name, /^on/i, `${etiqueta}: atributo de evento ${a.name} en <${el.localName}>`);
      assert.doesNotMatch(a.value.replace(/\s/g, ""), /^javascript:/i, `${etiqueta}: ${a.name}=javascript: en <${el.localName}>`);
    }
  }
  return f;
}

test("vistaBloque: las tarjetas salen del renderizador inyectado (el saneado de la lectura) y no añaden HTML propio salvo el botón", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const llamadas = [];
  const espia = (md) => {
    const r = html(md);
    llamadas.push({ md, r });
    return r;
  };
  const pdf = vistaBloque(espia, "pdf", `archivo: ${PDF}\ntitulo: Hoja`, { editable: true });
  assert.equal(llamadas.length, 1, "pasa una vez por el renderizador");
  assert.match(llamadas[0].md, /^`{3,}pdf\n/);
  assert.equal(pdf, llamadas[0].r, "la tarjeta es exactamente la salida saneada");
  const cuerpo = `editor: excalidraw\nfuente: ${FUENTE}\nsvg: ${SVG}\ntitulo: D`;
  const dia = vistaBloque(espia, "diagrama", cuerpo, { editable: true });
  const saneado = llamadas.at(-1).r;
  const sinBoton = dia.replace(/<button type="button" class="btn hw-diagrama-editar" data-fuente="[\w-]+" data-editor="(excalidraw|drawio)">Editar diagrama<\/button>/, "");
  assert.equal(sinBoton.trimEnd(), saneado.trimEnd(), "lo único que se añade a la salida saneada es el botón con datos filtrados");
  // El renderizador de la lectura usa DOMPurify: HTML crudo en el Markdown no sobrevive.
  sinVectores(w, html('<img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><script>alert(2)</script>'), "DOMPurify");
});

test("vistaBloque: un título sin < ni > que intenta cerrar el atributo se pinta como tarjeta y sale saneado", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const vectores = ['x" onerror="alert(1)', "x&quot; onerror=alert(1) x=&quot;", "x' onmouseover='alert(1)", "javascript:alert(1)"];
  for (const t of vectores) {
    const pdf = vistaBloque(html, "pdf", `archivo: ${PDF}\ntitulo: ${t}`, { editable: true });
    assert.notEqual(pdf, null, `pdf con título ${t} se pinta (no lleva < ni >)`);
    const f = sinVectores(w, pdf, `pdf «${t}»`);
    assert.ok(f.querySelector("figcaption")?.textContent.includes("alert(1)"), "el título se ve como texto");
    const dia = vistaBloque(html, "diagrama", `editor: excalidraw\nfuente: ${FUENTE}\nsvg: ${SVG}\ntitulo: ${t}`, { editable: true });
    assert.notEqual(dia, null, `diagrama con título ${t} se pinta`);
    const g = sinVectores(w, dia, `diagrama «${t}»`);
    assert.equal(g.querySelectorAll("img").length, 1, "una sola imagen: la del SVG");
    assert.equal(g.querySelector("img").getAttribute("src"), `/api/archivos/?proyecto=uuv&id=${SVG}`);
    assert.match(g.querySelector("img").getAttribute("alt"), /alert\(1\)/, "el título va al alt como texto");
  }
  // Con < o > puede rechazarse (se ve como código) o pintarse saneado; nunca con vectores.
  const conMarcas = vistaBloque(html, "pdf", `archivo: ${PDF}\ntitulo: <img src=x onerror=alert(1)><script>alert(2)</script>`, { editable: true });
  if (conMarcas !== null) sinVectores(w, conMarcas, "pdf con marcas");
});

test("vistaBloque bom: celdas con HTML, atributos de evento o javascript: se ven como texto y no dejan vectores", async () => {
  const { vistaBloque } = L();
  const { html, w } = await renderizador();
  const csv = [
    "referencia,descripcion,cantidad,costo_unitario,proveedor",
    "R1,<img src=x onerror=alert(1)>,1,0.5,javascript:alert(1)",
    'R2,"x"" onerror=""alert(2)",2,0.1,<a href=javascript:alert(3)>ver</a>',
    '"<svg onload=alert(6)>",<script>alert(4)</script>,1,1,[x](javascript:alert(5))',
  ].join("\n");
  const salida = vistaBloque(html, "bom", csv, { editable: true });
  assert.notEqual(salida, null, "el BOM es válido: se pinta como tabla");
  const f = sinVectores(w, salida, "bom");
  const tabla = f.querySelector("figure.hw-bom table");
  assert.ok(tabla, "figure.hw-bom > table");
  assert.equal(tabla.querySelectorAll("tbody tr").length, 3);
  assert.equal(tabla.querySelector("tbody img, tbody script"), null, "las celdas no crean elementos");
  assert.match(tabla.textContent, /<img src=x onerror=alert\(1\)>/, "la celda se ve como texto");
});
