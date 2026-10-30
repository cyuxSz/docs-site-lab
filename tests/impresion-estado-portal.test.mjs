// Lote 4b-2 en el portal: botón "Copiar cita", estado de proyectos que no se construyeron, hoja de impresión y
// arreglos de los revisores (ancla segura, summary, .to-top sobre la barra, nota de atajos).
// Scripts empaquetados (CSP), textContent en vez de HTML, fuera de Pagefind y estilos con tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const css = read("src/styles/global.css");
const sinHtml = (f, s) => assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|set:html/, `${f} no pinta HTML`);
const sinColores = (nombre, s) => assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `${nombre} usa tokens, no colores fijos`);

// Bloque de CSS que empieza en `inicio` (p. ej. "@media print {"), con llaves balanceadas.
const bloque = (src, inicio) => {
  const i = src.indexOf(inicio);
  if (i < 0) return "";
  let d = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) return src.slice(i, j + 1);
  }
  return "";
};
// Reglas (selector + cuerpo) de un bloque CSS cuyo selector menciona `sel`.
const reglasCon = (src, sel) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes(sel)).map((m) => m[0]).join("\n");
// Reglas cuyo cuerpo (declaraciones) menciona `decl`.
const reglasDecl = (src, decl) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[2].includes(decl)).map((m) => m[0]).join("\n");

// --- 1 y 2. Copiar como cita Markdown ---
test("prose.ts: sección 'Copiar como cita Markdown' con botón, citaMarkdown y aviso", () => {
  const s = read("src/scripts/prose.ts");
  assert.match(s, /import\s*\{[^}]*\bcitaMarkdown\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/tools\/citas\.mjs["']/);
  const i = s.indexOf("// --- Copiar como cita Markdown");
  assert.ok(i >= 0, "falta la sección // --- Copiar como cita Markdown");
  const fin = s.indexOf("// ---", i + 10);
  const sec = s.slice(i, fin < 0 ? undefined : fin);
  assert.match(sec, /createElement\(["']button["']\)/);
  assert.match(sec, /cita-copiar/);
  assert.match(sec, /["']Copiar cita["']/);
  assert.match(sec, /Copiar como cita Markdown/);
  assert.match(sec, /citaMarkdown\(/);
  assert.match(sec, /["']Copiado["']/);
  assert.match(sec, /Cita copiada en Markdown/);
  assert.match(sec, /No se pudo copiar la cita/);
  assert.match(sec, /\.after\(/, "el botón va justo después del enlace");
  assert.match(sec, /data-pagefind-ignore/);
  assert.match(sec, /textContent/);
  sinHtml("sección de cita", sec);
});

test("prose.ts: copy() con respaldo (textarea + execCommand) y región aria-live", () => {
  const s = read("src/scripts/prose.ts");
  assert.match(s, /navigator\.clipboard/);
  assert.match(s, /createElement\(["']textarea["']\)/);
  assert.match(s, /execCommand\(["']copy["']\)/);
  assert.match(s, /aria-live["'],\s*["']polite["']/);
});

test("CSS: .cita-copiar con tokens y foco visible", () => {
  const r = reglasCon(css, ".cita-copiar");
  assert.ok(r, "faltan estilos de .cita-copiar");
  sinColores(".cita-copiar", r.replace(bloque(css, "@media print {"), ""));
  assert.match(r, /var\(--/);
  assert.match(r, /:focus-visible/);
});

// --- 3, 4 y 5. Estado de proyectos ---
test("fetch.mjs: usa estado.mjs, guarda causa (no el mensaje de git) y limpia los avisos de consola", () => {
  const s = read("tools/fetch.mjs");
  assert.match(s, /import\s*\{[^}]*\bclasificarError\b[^}]*\}\s*from\s*["']\.\/estado\.mjs["']/);
  assert.match(s, /import\s*\{[^}]*\blimpiarControl\b[^}]*\}\s*from\s*["']\.\/estado\.mjs["']/);
  assert.doesNotMatch(s, /describeError/, "describeError se reemplaza por clasificarError");
  assert.match(s, /clasificarError\(err,\s*\{\s*token:/);
  assert.match(s, /error:\s*true[^}]*\bcausa\b/, "el resumen del proyecto con error guarda causa");
  assert.match(s, /empty:\s*true[^}]*causa:\s*["']vacio["'][^}]*ramas/, "el vacío guarda causa y ramas");
  assert.match(s, /console\.warn\([^\n]*limpiarControl\(/);
});

test("data.ts: ProjectSummary con causa y ramas", () => {
  const s = read("src/lib/data.ts");
  assert.match(s, /causa\?:\s*string/);
  assert.match(s, /ramas\?:\s*string\[\]/);
});

test("EstadoProyecto.astro: qué pasó, cuándo y qué hacer, fuera de Pagefind y sin HTML crudo", () => {
  assert.ok(exists("src/components/EstadoProyecto.astro"), "falta src/components/EstadoProyecto.astro");
  const s = read("src/components/EstadoProyecto.astro");
  assert.match(s, /import\s*\{[^}]*\btarjetaEstado\b[^}]*\}\s*from\s*["']\.\.\/\.\.\/tools\/estado\.mjs["']/);
  assert.match(s, /tarjetaEstado\(/);
  assert.match(s, /class="estado-proyecto"/);
  assert.match(s, /data-pagefind-ignore="all"/);
  assert.match(s, /data-estado=/);
  assert.match(s, /<time[^>]*datetime=\{/);
  assert.match(s, /hacer\.map\(/);
  assert.match(s, /<ol/);
  assert.match(s, /compacto/);
  assert.doesNotMatch(s, /message/, "nunca el mensaje crudo");
  sinHtml("EstadoProyecto", s);
});

test("Portada: tarjetas con error o vacías usan EstadoProyecto y enlazan a /<id>/", () => {
  const s = read("src/pages/index.astro");
  assert.match(s, /import\s+EstadoProyecto\s+from\s+["']\.\.\/components\/EstadoProyecto\.astro["']/);
  assert.match(s, /<EstadoProyecto[^>]*compacto/);
  assert.doesNotMatch(s, /\{p\.message\}/, "ya no se pinta el mensaje crudo");
  assert.match(s, /Ver qué pasó →/);
});

test("/<id>/: se genera para todos los proyectos y muestra el estado sin indexarse", () => {
  const s = read("src/pages/[project]/index.astro");
  const paths = s.slice(s.indexOf("getStaticPaths"), s.indexOf("}", s.indexOf("getStaticPaths")) + 1);
  assert.match(paths, /portal\(\)\.projects/, "getStaticPaths recorre todos los proyectos");
  assert.doesNotMatch(paths, /builtProjects/);
  assert.match(s, /import\s+EstadoProyecto\s+from\s+["']\.\.\/\.\.\/components\/EstadoProyecto\.astro["']/);
  assert.match(s, /<EstadoProyecto/);
  assert.match(s, /Volver al inicio/);
});

test("CSS: .estado-proyecto con tokens", () => {
  const r = reglasCon(css, ".estado-proyecto");
  assert.ok(r, "faltan estilos de .estado-proyecto");
  sinColores(".estado-proyecto", r.replace(bloque(css, "@media print {"), ""));
  assert.match(r, /var\(--danger\)/);
});

// --- 6. Impresión ---
test("@media print: oculta barra, navegación, botones y bloques personales", () => {
  const p = bloque(css, "@media print {");
  assert.ok(p, "falta @media print en global.css");
  const ocultos = reglasDecl(p, "display: none");
  for (const sel of [".topbar", ".ptabs", ".sidenav", ".migas", ".toc-box", ".prevnext", ".to-top", ".copy-btn", ".cita-copiar", ".anchor", ".favorito-btn", ".aviso-cambio", ".ruta-paso", ".lectura-ajustes", ".resaltado-barra", ".continuar", ".favoritos", ".search-dialog", ".atajos-dialog", ".popover", ".meta .acciones"]) {
    assert.ok(ocultos.includes(sel), `@media print oculta ${sel}`);
  }
  assert.match(ocultos, /display:\s*none\s*!important/);
});

test("@media print: negro sobre blanco", () => {
  const p = bloque(css, "@media print {");
  assert.match(p, /--bg:\s*(#fff\b|#ffffff\b|white)/i);
  assert.match(p, /--text:\s*(#000\b|#000000\b|black)/i);
  const body = reglasCon(p, "body");
  assert.match(body, /background:\s*(#fff\b|#ffffff\b|white)/i);
  assert.match(body, /color:\s*(#000\b|#000000\b|black)/i);
});

test("@media print: URL visible tras los enlaces externos", () => {
  const p = bloque(css, "@media print {");
  const r = reglasDecl(p, "attr(href)");
  assert.match(r, /a\[href\^=["']?http/);
  assert.match(r, /::after/);
  assert.match(r, /content:\s*["'] \(["']\s*attr\(href\)\s*["']\)["']/);
});

test("@media print: código y diagramas sin cortarse", () => {
  const p = bloque(css, "@media print {");
  const r = reglasDecl(p, "break-inside: avoid");
  for (const sel of ["pre", ".mermaid", "svg", "tr"]) assert.ok(r.includes(sel), `break-inside: avoid en ${sel}`);
  assert.match(reglasCon(p, "pre"), /white-space:\s*pre-wrap/);
  assert.match(p, /break-after:\s*avoid/);
});

test("@media print: tablas como tabla (anula el modo tarjeta del teléfono)", () => {
  const p = bloque(css, "@media print {");
  assert.match(p, /display:\s*table-header-group/);
  assert.match(p, /display:\s*table-row/);
  assert.match(p, /display:\s*table-cell/);
  assert.match(reglasCon(p, "td::before"), /content:\s*none/);
});

// --- 7. Arreglos de los revisores ---
test("decodificarAncla: pura y tolerante a URIError", async () => {
  const { decodificarAncla } = await import("../src/lib/lectura.ts");
  assert.equal(typeof decodificarAncla, "function", "falta decodificarAncla en src/lib/lectura.ts");
  assert.equal(decodificarAncla("#se%C3%B1al"), "señal");
  assert.equal(decodificarAncla("sin-gato"), "sin-gato");
  assert.equal(decodificarAncla("#%E0%A4%A"), "");
  assert.equal(decodificarAncla("#"), "");
  assert.equal(decodificarAncla(undefined), "");
});

test("lectura.ts y prose.ts usan decodificarAncla en vez de decodeURIComponent directo sobre el hash", () => {
  for (const f of ["src/scripts/lectura.ts", "src/scripts/prose.ts"]) {
    const s = read(f);
    assert.doesNotMatch(s, /decodeURIComponent\((location|a)\.hash/, `${f} no decodifica el hash sin protección`);
    assert.match(s, /decodificarAncla\(/, `${f} usa decodificarAncla`);
  }
});

test("Ajustes de lectura: summary descriptivo", () => {
  const s = read("src/pages/[project]/[...slug].astro");
  assert.match(s, /<summary>Ajustes de texto<\/summary>/);
  assert.doesNotMatch(s, /<summary>Texto<\/summary>/);
});

test(".to-top sube cuando la barra de resaltado está visible", () => {
  assert.match(css, /:root:has\(\.resaltado-barra:not\(\[hidden\]\)\)\s+\.to-top\s*\{[^}]*bottom:\s*calc\(var\(--resaltado-alto/);
  const s = read("src/scripts/lectura.ts");
  assert.match(s, /--resaltado-alto/);
  assert.match(s, /offsetHeight/);
  assert.match(s, /removeProperty\(["']--resaltado-alto["']\)/);
});

test("Diálogo de atajos: avisa que se pausan con un diálogo abierto", () => {
  const s = read("src/layouts/Base.astro");
  const dlg = s.slice(s.indexOf('id="atajos"'), s.indexOf("</dialog>", s.indexOf('id="atajos"')));
  assert.match(dlg, /<p class="atajos-nota">Los atajos se pausan mientras hay un diálogo abierto\.<\/p>/);
  assert.ok(reglasCon(css, ".atajos-nota"), "estilo de .atajos-nota");
});

// --- 8. Transversales ---
test("Sin scripts en línea nuevos: Base conserva un solo is:inline y los componentes nuevos ninguno", () => {
  assert.equal((read("src/layouts/Base.astro").match(/is:inline/g) ?? []).length, 1);
  if (exists("src/components/EstadoProyecto.astro")) assert.doesNotMatch(read("src/components/EstadoProyecto.astro"), /<script/);
});
