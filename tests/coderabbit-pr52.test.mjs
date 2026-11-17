// Hallazgos de CodeRabbit del PR #52: menú ⋯ sin JS, región viva en disciplinas y cancelar destino de hash pendiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("menú ⋯: sin JS el panel se ve y el botón no; tema-inline.js marca data-js en <html> antes de pintar", () => {
  const css = read("src/styles/global.css");
  assert.ok(css.includes("html:not([data-js]) .pagina-menu-btn { display: none; }"));
  assert.match(css, /html:not\(\[data-js\]\) \.pagina-menu \{[^}]*position: static;[^}]*display: grid;[^}]*max-height: none/);
  assert.ok(css.includes("html:not([data-js]) .pagina-menu[hidden] { display: grid !important; }"), "gana al [hidden] { display: none !important } global");
  assert.ok(css.includes("html[data-js] .pagina-menu[hidden] { display: none; }"));
  assert.doesNotMatch(css, /^\.pagina-menu\[hidden\]/m, "ya no se oculta el panel sin condición");
  assert.doesNotMatch(read("src/scripts/menu-pagina.ts"), /data-js/, "el script del menú ya no marca data-js");
  const calls = [];
  const documentElement = { dataset: {}, setAttribute: (k, v) => calls.push([k, v]) };
  vm.runInNewContext(read("src/scripts/tema-inline.js"), { localStorage: { getItem: () => null }, document: { documentElement } });
  assert.deepEqual(calls, [["data-js", ""]]);
  assert.ok(read("src/layouts/Base.astro").includes("<script is:inline set:html={temaScript} />"));
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
