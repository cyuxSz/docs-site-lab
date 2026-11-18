// Editor visual integrado en la página de hardware: dependencia exacta y empaquetada, carga diferida al pulsar «Editar»
// (la lectura no descarga Milkdown), solo las funciones y estilos que usamos (sin Latex/KaTeX, AI, TopBar ni ImageBlock),
// CSP sin aflojar, conmutador «Markdown», mismos flujos que el textarea (subidas, insertar, guardar) y estilos con los
// tokens del portal (colores de los dos temas, fuentes, sin el padding de 120 px, tablas con desplazamiento, foco visible).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const existe = (rel) => existsSync(new URL(`../${rel}`, import.meta.url));
const PAGINA = "src/pages/[project]/[disciplina].astro";
const SCRIPT = "src/scripts/hardware-editor.ts";
const ENTRADA = "src/scripts/editor-visual.ts";
const CREPE = "src/lib/editor-visual-crepe.ts";
const CSS = "src/styles/editor-visual.css";
const leerSi = (rel) => {
  assert.ok(existe(rel), `falta ${rel}`);
  return leer(rel);
};

// ---------- dependencia ----------

test("package.json: @milkdown/crepe con versión exacta 7.23.0 y en el lockfile", () => {
  const pkg = JSON.parse(leer("package.json"));
  assert.equal(pkg.dependencies?.["@milkdown/crepe"], "7.23.0");
  const lock = JSON.parse(leer("package-lock.json"));
  assert.equal(lock.packages?.["node_modules/@milkdown/crepe"]?.version, "7.23.0");
  for (const [nombre, v] of Object.entries(pkg.dependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, `${nombre} sin rango (^ o ~)`);
});

// ---------- carga diferida ----------

test("la lectura no carga Milkdown: hardware-editor.ts lo pide con import() dinámico y sin imports estáticos", () => {
  const js = leer(SCRIPT);
  assert.match(js, /import\(\s*["']\.\/editor-visual(\.ts)?["']\s*\)/, "import() dinámico de ./editor-visual");
  assert.doesNotMatch(js, /^\s*import\s[^(]*["'](\.\/editor-visual|\.\.\/lib\/editor-visual-crepe|@milkdown|@codemirror)/m, "sin import estático del editor");
  assert.doesNotMatch(js, /@milkdown|@codemirror/, "Milkdown solo entra por src/scripts/editor-visual.ts");
  for (const rel of [PAGINA, "src/layouts/Base.astro"]) assert.doesNotMatch(leer(rel), /milkdown|editor-visual/i, rel);
});

test("empaquetado por Astro/Vite: sin CDN ni scripts externos", () => {
  for (const rel of [ENTRADA, CREPE]) {
    const s = leerSi(rel);
    assert.doesNotMatch(s, /https?:\/\/|cdn\.|unpkg|jsdelivr|esm\.sh|skypack/i, rel);
  }
  assert.doesNotMatch(leer(PAGINA), /<script[^>]+src=["']https?:/);
});

// ---------- peso: solo lo que usamos ----------

test("editor-visual-crepe.ts: CrepeBuilder con las funciones activas, nunca la entrada completa de Crepe", async () => {
  const s = leerSi(CREPE);
  const { FUNCIONES_ACTIVAS } = await import("../src/lib/editor-visual.ts");
  assert.match(s, /from\s+["']@milkdown\/crepe\/builder["']/);
  assert.doesNotMatch(s, /from\s+["']@milkdown\/crepe["']/, "la entrada principal importa KaTeX, Vue de todas las funciones y todos los lenguajes");
  const subrutas = [...s.matchAll(/["']@milkdown\/crepe\/feature\/([\w-]+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(subrutas)].sort(), [...FUNCIONES_ACTIVAS].sort());
  assert.doesNotMatch(s, /katex|remark-math|feature\/(latex|ai|top-bar|image-block)/);
  assert.match(s, /LENGUAJES_CODEMIRROR/, "CodeMirror con la lista corta de lenguajes");
  assert.match(s, /OPCIONES_MARKDOWN/);
  assert.match(s, /remarkStringifyOptionsCtx/);
});

test("editor-visual.ts (entrada del chunk): CSS de Crepe por partes, sin KaTeX ni temas de Crepe; estilos del portal", () => {
  const s = leerSi(ENTRADA);
  assert.match(s, /editor-visual-crepe/);
  assert.match(s, /["']\.\.\/styles\/editor-visual\.css["']/);
  for (const parte of ["prosemirror", "reset", "block-edit", "code-mirror", "cursor", "link-tooltip", "list-item", "placeholder", "toolbar", "table"]) {
    assert.match(s, new RegExp(`@milkdown/crepe/theme/common/${parte}\\.css`), parte);
  }
  assert.doesNotMatch(s, /theme\/common\/style\.css|latex\.css|katex|ai\.css|top-bar\.css|image-block\.css|theme\/(crepe|frame|nord)/);
});

// ---------- seguridad ----------

test("CSP sin aflojar: estilos como hoy ('self' 'unsafe-inline'), sin unsafe-eval ni blob:", async () => {
  const config = (await import("../astro.config.mjs")).default;
  const csp = config.security.csp;
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.ok(csp.directives.includes("img-src 'self' data:"));
  assert.ok(csp.directives.includes("connect-src 'self'"));
  assert.doesNotMatch(JSON.stringify(csp), /'unsafe-eval'|blob:/);
  assert.match(leer("worker/index.mjs"), /"Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"/);
});

test("las tarjetas de bloques salen del renderizador saneado de la lectura (vistaBloque + crearRenderizador)", () => {
  const js = leer(SCRIPT);
  // El `html` que recibe vistaBloque es el de cargarRender(), que es crearRenderizador(window, { proyecto }) (marked + DOMPurify).
  assert.match(js, /cargaRender \?\?= import\("\.\.\/lib\/hardware-md"\)\.then\(\(m\) => \(\{ \.\.\.m\.crearRenderizador\(window, \{ proyecto \}\)/);
  const montar = js.match(/async function montarVisual[^]*?\r?\n  \}\r?\n/)?.[0] ?? "";
  assert.match(montar, /\{ html \}[^\n]*cargarRender\(\)/, "html sale de cargarRender()");
  assert.match(montar, /renderizarBloque: \(lenguaje, contenido\) => mod\.vistaBloque\(html, lenguaje, contenido, \{ editable \}\)/);
  assert.doesNotMatch(leerSi(ENTRADA) + leerSi(CREPE), /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/, "sin HTML crudo propio");
  // El comportamiento (tarjetas pintadas dentro del editor y sin vectores) lo prueba tests/editor-visual-tarjetas.test.mjs.
});

// ---------- página ----------

test("[disciplina].astro: conmutador «Markdown» y contenedor del editor visual dentro del formulario", () => {
  const src = leer(PAGINA);
  const form = src.match(/<form class="hw-editor"[^]*?<\/form>/)?.[0] ?? "";
  assert.match(form, /<button type="button"[^>]*data-hw-modo-markdown[^>]*aria-pressed="false"[^>]*>Markdown<\/button>/);
  assert.match(form, /<div[^>]*class="[^"]*hw-visual[^"]*"[^>]*data-hw-visual/);
  // El modo Markdown sigue siendo el textarea de hoy, con su etiqueta, sus pestañas y su vista previa.
  assert.match(form, /<textarea[^>]*id="hw-md"/);
  assert.match(form, /<label[^>]*for="hw-md"/);
  assert.match(form, /data-hw-previa/);
});

// ---------- script ----------

test("hardware-editor.ts: lo que se guarda es markdownParaGuardar (sin tocar nada, el original) y el aviso de cambios lo usa", () => {
  const js = leer(SCRIPT);
  assert.match(js, /markdownParaGuardar\(/);
  const cambios = js.match(/const hayCambios = [^\n]*/)?.[0] ?? "";
  assert.match(cambios, /contenido\w*\(\)|markdownParaGuardar/, "hayCambios compara el contenido del modo activo, no solo textarea.value");
  const put = js.match(/api\("PUT", \{ cuerpo: \{ pagina: actual\.slug, md: [^,]+/)?.[0] ?? "";
  assert.ok(put, "PUT del guardado");
  assert.doesNotMatch(put, /md: textarea\.value/, "en modo visual se manda el Markdown del editor");
});

test("hardware-editor.ts: conmutador con aria-pressed y los dos modos editan el mismo contenido", () => {
  const js = leer(SCRIPT);
  assert.match(js, /data-hw-modo-markdown/);
  assert.match(js, /setAttribute\("aria-pressed"/);
  assert.match(js, /reemplazarTodo\(/, "al volver a visual se carga lo escrito en el textarea");
  assert.match(js, /textarea\.value = [^;\n]*getMarkdown\(\)|textarea\.value = markdownParaGuardar/, "al pasar a Markdown el textarea recibe lo del editor");
});

test("hardware-editor.ts: adjuntar, PDF, BOM y diagramas se insertan en el cursor del editor visual", () => {
  const js = leer(SCRIPT);
  assert.ok((js.match(/insertarMarkdown\(/g) ?? []).length >= 2, "enlaces de archivo y bloques");
  assert.match(js, /reemplazarDiagrama\([^)]*getMarkdown\(\)|reemplazarDiagrama\(\s*contenido\w*\(\)/, "segundo guardado del diagrama sobre el Markdown del editor");
});

test("hardware-editor.ts: pegar y soltar archivos también en el editor visual (y antes que Milkdown)", () => {
  const js = leer(SCRIPT);
  assert.ok((js.match(/"paste"/g) ?? []).length >= 2, "paste en textarea y en el editor visual");
  assert.ok((js.match(/"drop"/g) ?? []).length >= 2, "drop en textarea y en el editor visual");
  assert.match(js, /capture:\s*true/, "en captura, para que ProseMirror no lo procese");
});

test("hardware-editor.ts: «Editar diagrama» funciona desde la tarjeta del editor visual", () => {
  const js = leer(SCRIPT);
  assert.ok((js.match(/closest<HTMLButtonElement>\("button\.hw-diagrama-editar"\)/g) ?? []).length >= 2, "delegación en la lectura y en el editor visual");
});

test("hardware-editor.ts: mientras se guarda el editor visual queda en solo lectura", () => {
  const js = leer(SCRIPT);
  const f = js.match(/function actualizarGuardar[^]*?\n  \}/)?.[0] ?? "";
  assert.match(f, /setSoloLectura\(/);
});

// ---------- estilos ----------

test("editor-visual.css: colores de Crepe mapeados a los tokens del portal (valen en claro y oscuro)", () => {
  const css = leerSi(CSS);
  const nombres = [
    "background", "on-background", "surface", "surface-low", "on-surface", "on-surface-variant", "outline", "primary", "secondary",
    "on-secondary", "inverse", "on-inverse", "inline-code", "error", "hover", "selected", "inline-area",
  ];
  for (const n of nombres) {
    const m = css.match(new RegExp(`--crepe-color-${n}:\\s*([^;]+);`));
    assert.ok(m, `--crepe-color-${n}`);
    assert.match(m[1], /var\(--/, `--crepe-color-${n} usa un token`);
    assert.doesNotMatch(m[1], /#[0-9a-f]{3,8}\b|rgba?\(/i, `--crepe-color-${n} sin color fijo`);
  }
  assert.match(css, /--crepe-font-default:\s*var\(--font-body\)/);
  assert.match(css, /--crepe-font-title:\s*var\(--font-head\)/);
  assert.match(css, /--crepe-font-code:/);
  for (const s of ["--crepe-shadow-1", "--crepe-shadow-2"]) assert.match(css, new RegExp(`${s}:`), s);
});

test("editor-visual.css: sin el padding de 120 px, tablas con desplazamiento y foco visible", () => {
  const css = leerSi(CSS);
  assert.doesNotMatch(css, /120px/);
  const pm = css.match(/\.ProseMirror\s*\{[^}]*\}/)?.[0] ?? "";
  assert.match(pm, /padding:/, "padding propio del .ProseMirror");
  assert.match(css, /\.milkdown-table-block[^{]*\{[^}]*overflow-x:\s*auto/, "las tablas se desplazan dentro de su caja");
  assert.match(css, /:focus-within[^{]*\{[^}]*outline:[^;]*var\(--accent\)/, "foco visible del editor (Crepe quita el outline)");
});
