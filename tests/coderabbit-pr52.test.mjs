// Hallazgos de CodeRabbit del PR #52: menú ⋯ sin JS, región viva en disciplinas y cancelar destino de hash pendiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("menú ⋯: sin JS el panel se ve y el botón no; el script marca data-js en el contenedor", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /\.pagina-meta:not\(\[data-js\]\) \.pagina-menu-btn \{ display: none; \}/);
  assert.match(css, /\.pagina-meta:not\(\[data-js\]\) \.pagina-menu \{[^}]*display: grid/);
  assert.match(css, /\.pagina-meta\[data-js\] \.pagina-menu\[hidden\] \{ display: none; \}/);
  assert.doesNotMatch(css, /^\.pagina-menu\[hidden\]/m, "ya no se oculta el panel sin condición");
  const js = read("src/scripts/menu-pagina.ts");
  assert.match(js, /setAttribute\("data-js", ""\)/);
  assert.ok(js.indexOf('"data-js"') < js.indexOf("btn.addEventListener"), "data-js antes de enlazar eventos");
  const slug = read("src/pages/[project]/[...slug].astro");
  assert.match(slug, /class="pagina-meta" data-pagina-meta/);
});

test("[disciplina].astro tiene la región viva del modo lectura y carga barras", () => {
  const src = read("src/pages/[project]/[disciplina].astro");
  assert.match(src, /<div class="sr-only" data-anuncio-lectura role="status" aria-live="polite" data-pagefind-ignore="all"><\/div>/);
  assert.match(src, /scripts\/barras/);
});

test("comentarios.ts: abrirDesdeHash cancela el destino pendiente antes de salir y sigue enfocando UUIDs", () => {
  const js = read("src/scripts/comentarios.ts");
  const f = js.slice(js.indexOf("function abrirDesdeHash()"), js.indexOf("abrirDesdeHash();\n"));
  const iAsig = f.indexOf("idHash = h.id;");
  assert.ok(iAsig > 0, "asigna idHash = h.id");
  assert.ok(iAsig < f.indexOf("if (!h.abrir) return;"), "antes de la salida anticipada");
  assert.match(f, /if \(h\.id && cargado\)[^]*idHash = null;[^]*destino\.focus\(\)/, "enfoca al momento si ya cargó");
  // pintar(): idHash null no hace nada; con id pendiente enfoca tras cargar.
  const p = js.slice(js.indexOf("function pintar()"), js.indexOf("function pintarHilo"));
  assert.match(p, /if \(idHash\) \{[^]*comentario-\$\{idHash\}[^]*destino\.focus\(\)/);
});
