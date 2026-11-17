// Mini tutoriales en el portal: fetch.mjs lee openwiki/rutas/*.md, data.ts los expone, /<id>/rutas/ los lista
// (filtro por disciplina, progreso, reanudar) y cada /<id>/rutas/<slug>/ es un checklist accesible. Sin HTML desde
// datos, sin is:inline nuevo (CSP), estilos con tokens y el formato documentado en el README.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SLUG = "src/pages/[project]/[...slug].astro";
const LISTA = "src/components/TutorialesLista.astro";
const PASOS = "src/components/TutorialPasos.astro";
const SCRIPT = "src/scripts/tutoriales.ts";
const leerSi = (p) => {
  assert.ok(exists(p), `falta ${p}`);
  return read(p);
};

test("fetch.mjs: lee openwiki/rutas/*.md con parseTutorial y guarda tutoriales en data/<id>.json solo si hay", () => {
  const src = read("tools/fetch.mjs");
  assert.match(src, /import\s*\{[^}]*parseTutorial[^}]*\}\s*from\s*["']\.\/rutas\.mjs["']/);
  assert.match(src, /rutas\//, "recorre el directorio openwiki/rutas/");
  assert.match(src, /disciplinas/, "pasa las disciplinas configuradas para validar enlaces hardware:");
  assert.match(src, /tutoriales\.length\s*\?\s*\{\s*tutoriales\s*\}/, "solo agrega tutoriales si hay");
});

test("data.ts: ProjectData tiene tutoriales opcionales con el tipo de src/lib/tutoriales.ts", () => {
  const src = read("src/lib/data.ts");
  assert.match(src, /tutoriales\?:\s*Tutorial\[\]/);
  assert.match(src, /from\s+["']\.\/tutoriales(\.ts)?["']/);
});

test("[...slug].astro: rutas.md lista los tutoriales y una página de tutorial se vuelve checklist", () => {
  const src = read(SLUG);
  assert.match(src, /import TutorialesLista from "\.\.\/\.\.\/components\/TutorialesLista\.astro"/);
  assert.match(src, /import TutorialPasos from "\.\.\/\.\.\/components\/TutorialPasos\.astro"/);
  assert.match(src, /p\.tutoriales\?\.find\(/, "busca el tutorial de la página actual");
  assert.match(src, /<TutorialesLista[^>]*tutoriales=\{/);
  assert.match(src, /<TutorialPasos[^>]*tutorial=\{/);
});

test("TutorialesLista: sección con encabezado, filtro de disciplina con radios en fieldset, conteo aria-live y enlaces reales", () => {
  const src = leerSi(LISTA);
  assert.match(src, /<section[^>]*aria-labelledby=/);
  assert.match(src, /Mini tutoriales/);
  assert.match(src, /<fieldset[^>]*>[^]*<legend/);
  assert.match(src, /type="radio"/);
  assert.match(src, /aria-live="polite"/, "anuncia cuántos tutoriales quedan tras filtrar");
  assert.match(src, /<a[^>]*href=\{[^}]*route/, "cada tutorial es un enlace real (funciona sin JS)");
  assert.match(src, /data-proyecto=\{/);
  assert.match(src, /import\s+["']\.\.\/scripts\/tutoriales(\.ts)?["']/);
});

test("TutorialPasos: lista ordenada con ancla por paso, objetivo, enlace, casilla 'Hecho cuando' con label, progreso y acciones", () => {
  const src = leerSi(PASOS);
  assert.match(src, /<ol[^>]*>/);
  assert.match(src, /id=\{`paso-\$\{[^}]+\}`\}/, "cada paso tiene id=\"paso-<id>\" para reanudar por ancla");
  assert.match(src, /Objetivo/);
  assert.match(src, /type="checkbox"/);
  assert.match(src, /<label[^>]*for=/);
  assert.match(src, /Hecho cuando/);
  assert.match(src, /<progress/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /data-reanudar/);
  assert.match(src, /Reiniciar tutorial/);
  assert.match(src, /<dialog/, "reiniciar pide confirmación");
  assert.match(src, /import\s+["']\.\.\/scripts\/tutoriales(\.ts)?["']/);
});

test("src/scripts/tutoriales.ts: usa la lógica pura, almacén seguro, confirma con showModal y nunca pinta HTML", () => {
  const src = leerSi(SCRIPT);
  assert.match(src, /from\s+["']\.\.\/lib\/tutoriales(\.ts)?["']/);
  assert.match(src, /almacenSeguro\(/);
  assert.match(src, /showModal\(/);
  assert.match(src, /\.focus\(/, "reanudar y cerrar el diálogo mueven el foco");
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
});

test("CSP: los componentes nuevos no usan is:inline ni set:html", () => {
  for (const f of [LISTA, PASOS]) {
    const src = leerSi(f);
    assert.doesNotMatch(src, /is:inline/, f);
    assert.doesNotMatch(src, /set:html/, f);
  }
});

test("estilos: clases .tutorial* con tokens del tema, sin anchos fijos que rompan 375 px y foco visible", () => {
  const css = read("src/styles/global.css");
  const bloque = css.match(/\.tutorial[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(bloque.length > 0, "faltan estilos .tutorial*");
  const todo = bloque.join("\n");
  assert.match(todo, /var\(--/, "usa tokens (claro/oscuro)");
  assert.doesNotMatch(todo, /(?<!max-)width:\s*\d{3,}px/, "sin anchos fijos >= 100px");
  assert.doesNotMatch(todo, /#[0-9a-f]{3,6}\b/i, "sin colores fijos");
  assert.match(css, /\.tutorial[^{]*:focus-visible/, "foco visible en los controles del tutorial");
});

test("README: documenta el formato de openwiki/rutas/<slug>.md y que rutas.md sigue igual", () => {
  const src = read("README.md");
  assert.match(src, /openwiki\/rutas\//);
  assert.match(src, /## Paso:/);
  assert.match(src, /Objetivo:/);
  assert.match(src, /Enlace:/);
  assert.match(src, /Hecho cuando:/);
  assert.match(src, /grafo:\?/);
  assert.match(src, /hardware:/);
  assert.match(src, /disciplina:/);
  assert.match(src, /retrocompatible|no cambia/i);
});

test("TutorialPasos muestra la etiqueta del rol (la de RutasRol), no el id crudo", () => {
  const pasos = read(PASOS);
  assert.match(pasos, /rolNombre/);
  assert.doesNotMatch(pasos, /rol \$\{tutorial\.rol\}/);
  assert.match(read(SLUG), /<TutorialPasos[^>]*rolNombre=\{/);
  assert.match(read(SLUG), /p\.rutas\?\.find\([^\n]*\?\.nombre/);
});

test("TutorialesLista explica los tutoriales ocultos por el rol y ofrece verlos todos (aria-live)", () => {
  const lista = read(LISTA);
  assert.match(lista, /data-otros/);
  assert.match(lista, /data-ver-todos/);
  assert.match(lista, /Ver todos/);
  const src = read(SCRIPT);
  assert.match(src, /ocultosPorRol\(/);
  assert.match(src, /de otros roles/);
});

test("página de tutorial: el índice lateral sale de los pasos válidos, no del Markdown completo", () => {
  const src = read(SLUG);
  assert.match(src, /tutorial\.pasos\.map\([^\n]*paso-/);
});

test("script: usa el respaldo en memoria del almacén; README aclara que el tutorial inválido sigue como página normal", () => {
  assert.match(read(SCRIPT), /almacenConRespaldo\(almacenSeguro\(/);
  assert.match(read("README.md"), /página normal de la wiki/);
});
