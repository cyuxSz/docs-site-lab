// QoL de lectura en el portal (lote 4b-1): buscador con recientes y sugerencias, resaltado del término buscado,
// tiempo de lectura y nivel, y ajustes de letra y ancho aplicados antes de pintar por el script del tema.
// Scripts empaquetados (CSP), textContent en vez de HTML, fuera de Pagefind y estilos con tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SLUG = "src/pages/[project]/[...slug].astro";
const BASE = "src/layouts/Base.astro";
const tag = (src, marca) => src.match(new RegExp(`<[a-z]+[^>]*${marca}[^>]*>`))?.[0] ?? "";
const sinHtml = (f, s) => assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, `${f} no pinta HTML`);

// --- 1. Buscador: recientes y sugerencias ---
test("Base: panel de recientes y sugerencias dentro del diálogo de búsqueda, fuera de Pagefind", () => {
  const src = read(BASE);
  const panel = tag(src, "data-search-extra");
  assert.ok(panel, "falta el panel data-search-extra");
  assert.match(panel, /data-pagefind-ignore="all"/);
  const dialogo = src.slice(src.indexOf('id="search"'), src.indexOf("</dialog>", src.indexOf('id="search"')));
  assert.ok(dialogo.includes("data-search-extra"), "el panel va dentro del diálogo #search");
  assert.match(dialogo, /data-recientes/, "lista de recientes (la llena el script)");
  assert.match(dialogo, /data-borrar-recientes/, "botón para borrar recientes");
  assert.match(dialogo, /Borrar recientes/);
  assert.match(tag(dialogo, "data-borrar-recientes"), /^<button[^>]*type="button"/);
  assert.match(dialogo, /sugerencias\.map\(/, "sugerencias fijas pintadas en el build");
});

test("Base: la búsqueda vive en scripts/busqueda.ts (empaquetado) y Base ya no carga Pagefind en línea", () => {
  const src = read(BASE);
  assert.match(src, /import\s+["']\.\.\/scripts\/busqueda(\.ts)?["']/);
  assert.doesNotMatch(src, /PagefindUI/, "Pagefind UI se crea en scripts/busqueda.ts");
  assert.match(src, /sugerencias\?:/, "Props.project acepta sugerencias");
});

test("busqueda.ts: Pagefind con ?q= en los resultados, recientes con almacén seguro y textContent", () => {
  assert.ok(exists("src/scripts/busqueda.ts"), "falta src/scripts/busqueda.ts");
  const s = read("src/scripts/busqueda.ts");
  assert.match(s, /new\s+\(?window\.PagefindUI|new\s+PagefindUI/);
  assert.match(s, /highlightParam:\s*["']q["']|highlightParam:\s*PARAM_RESALTADO/);
  assert.match(s, /from\s+["']\.\.\/lib\/lectura(\.ts)?["']/);
  for (const f of ["agregarReciente", "recientes", "borrarRecientes"]) assert.match(s, new RegExp(`\\b${f}\\(`), `usa ${f}`);
  assert.match(s, /almacenSeguro\(/);
  assert.match(s, /triggerSearch\(/, "un reciente relanza la búsqueda");
  assert.match(s, /textContent/);
  sinHtml("busqueda.ts", s);
  // Conserva lo que ya hacía Base: carga diferida, Ctrl/Cmd+K y "/".
  assert.match(s, /pagefind-ui\.js/);
  assert.match(s, /showModal\(/);
  assert.match(s, /ctrlKey|metaKey/);
});

test("projectNav: las sugerencias de búsqueda salen de sugerenciasBusqueda(pageList)", () => {
  const src = read("src/lib/data.ts");
  assert.match(src, /from\s+["']\.\/lectura(\.ts)?["']/);
  assert.match(src, /sugerencias:\s*sugerenciasBusqueda\(p\.pageList\)/);
});

// --- 2. Resaltado del término ---
test("página de la wiki: barra de resaltado oculta, anunciada, con botón 'Quitar resaltado' y fuera de Pagefind", () => {
  const src = read(SLUG);
  const barra = tag(src, "data-resaltado");
  assert.ok(barra, "falta la barra data-resaltado");
  assert.match(barra, /\bhidden\b/);
  assert.match(barra, /role="status"/);
  assert.match(barra, /data-pagefind-ignore="all"/);
  assert.match(src, /data-quitar-resaltado/);
  assert.match(src, />Quitar resaltado</);
  assert.match(tag(src, "data-quitar-resaltado"), /^<button[^>]*type="button"/);
  assert.match(src, /import\s+["']\.\.\/\.\.\/scripts\/lectura(\.ts)?["']/);
});

test("scripts/lectura.ts: marca con <mark> creado por DOM, usa la lógica pura y no pinta HTML", () => {
  assert.ok(exists("src/scripts/lectura.ts"), "falta src/scripts/lectura.ts");
  const s = read("src/scripts/lectura.ts");
  assert.match(s, /from\s+["']\.\.\/lib\/lectura(\.ts)?["']/);
  assert.match(s, /terminosResaltado\(/);
  assert.match(s, /coincidencias\(/);
  assert.match(s, /createElement\(\s*["']mark["']\s*\)/);
  assert.match(s, /createTreeWalker\(/, "recorre nodos de texto, no reemplaza HTML");
  assert.match(s, /scrollIntoView\(/, "salta a la primera coincidencia");
  assert.match(s, /replaceState\(/, "quitar el resaltado limpia ?q= de la URL");
  assert.match(s, /textContent/);
  sinHtml("scripts/lectura.ts", s);
});

// --- 3. Tiempo de lectura y nivel ---
test("página de la wiki: insignias de minutos y nivel calculadas en el build, fuera de Pagefind", () => {
  const src = read(SLUG);
  assert.match(src, /import \{[^}]*minutosLectura[^}]*\} from "\.\.\/\.\.\/lib\/lectura(\.ts)?"/);
  assert.match(src, /import \{[^}]*nivelPagina[^}]*\} from "\.\.\/\.\.\/lib\/lectura(\.ts)?"/);
  assert.match(src, /minutosLectura\(entry\.body/);
  assert.match(src, /nivelPagina\(\{/);
  assert.match(src, /level:\s*entry\.data\.level/);
  const meta = tag(src, 'class="lectura-meta"');
  assert.ok(meta, "falta .lectura-meta");
  assert.match(meta, /data-pagefind-ignore/);
  assert.match(src, /min de lectura/);
  assert.match(src, /data-nivel=/);
  // Junto al título: dentro del artículo, antes del contenido.
  const i = src.indexOf('class="lectura-meta"');
  assert.ok(i > src.indexOf('class="prose"') && i < src.indexOf("<Content />"), "la insignia va en el artículo, antes del título");
});

test("content.config: level opcional como texto (un valor raro no rompe el build; lo valida nivelPagina)", () => {
  const src = read("src/content.config.ts");
  assert.match(src, /level:\s*z\.string\(\)\.(optional|nullable)\(\)/);
});

// --- 5. Tamaño de letra y ancho ---
test("control de letra y ancho: details con dos fieldsets de radios, en la página y fuera de Pagefind", () => {
  const src = read(SLUG);
  const c = tag(src, "data-lectura-ajustes");
  assert.ok(c, "falta el control data-lectura-ajustes");
  assert.match(c, /^<details/);
  const bloque = src.slice(src.indexOf("data-lectura-ajustes"), src.indexOf("</details>", src.indexOf("data-lectura-ajustes")));
  assert.equal((bloque.match(/<fieldset/g) ?? []).length, 2);
  assert.match(bloque, /<legend>Tamaño de letra<\/legend>/);
  assert.match(bloque, /<legend>Ancho de lectura<\/legend>/);
  for (const v of ["s", "m", "l"]) assert.match(bloque, new RegExp(`type="radio" name="letra" value="${v}"`));
  for (const v of ["estrecho", "normal", "ancho"]) assert.match(bloque, new RegExp(`type="radio" name="ancho" value="${v}"`));
  const contenedor = src.slice(src.lastIndexOf("<", src.indexOf("data-pagina")), src.indexOf("data-lectura-ajustes"));
  assert.match(contenedor, /data-pagefind-ignore="all"/, "va dentro del bloque personal ignorado por Pagefind");
  const s = read("src/scripts/lectura.ts");
  for (const f of ["normalizarLetra", "normalizarAncho", "CLAVE_LETRA", "CLAVE_ANCHO", "almacenSeguro"]) assert.match(s, new RegExp(`\\b${f}\\b`), `lectura.ts usa ${f}`);
});

// Ejecuta tema-inline.js como lo haría el navegador, con un localStorage falso.
function correTema(guardado, { rompe = false } = {}) {
  const dataset = {};
  const localStorage = {
    getItem(k) {
      if (rompe) throw new Error("SecurityError");
      return Object.hasOwn(guardado, k) ? guardado[k] : null;
    },
  };
  vm.runInNewContext(read("src/scripts/tema-inline.js"), { localStorage, document: { documentElement: { dataset } } });
  return dataset;
}

test("tema-inline.js: aplica tema, letra y ancho antes de pintar; solo valores de la lista; nunca lanza", () => {
  assert.deepEqual(correTema({}), {});
  assert.deepEqual(correTema({ tema: "light", "lectura:letra": "l", "lectura:ancho": "estrecho" }), { theme: "light", letra: "l", ancho: "estrecho" });
  assert.deepEqual(correTema({ "lectura:letra": "s", "lectura:ancho": "ancho" }), { letra: "s", ancho: "ancho" });
  // Los valores por defecto no ponen atributo, y lo desconocido se ignora.
  assert.deepEqual(correTema({ "lectura:letra": "m", "lectura:ancho": "normal" }), {});
  assert.deepEqual(correTema({ "lectura:letra": "xl", "lectura:ancho": '"><script>' }), {});
  assert.doesNotThrow(() => correTema({}, { rompe: true }));
});

test("CSP: tema-inline sigue siendo el único script en línea y su hash se calcula del archivo", () => {
  assert.equal((read(BASE).match(/is:inline/g) ?? []).length, 1);
  assert.doesNotMatch(read(SLUG), /is:inline/);
  const cfg = read("astro.config.mjs");
  assert.match(cfg, /readFileSync\(new URL\("\.\/src\/scripts\/tema-inline\.js"/);
  assert.match(cfg, /hashes:\s*\[\s*temaHash\s*\]/);
  const tema = read("src/scripts/tema-inline.js");
  assert.doesNotMatch(tema, /innerHTML|setAttribute\(\s*["']style|eval\(/);
});

// --- Estilos ---
test("estilos: panel de búsqueda, mark, barra, insignias y ajustes con tokens; letra y ancho por data-* en <html>", () => {
  const css = read("src/styles/global.css");
  const bloque = (sel) => [...css.matchAll(new RegExp(`${sel.replace(/[.[\]"=]/g, "\\$&")}[^{]*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
  for (const sel of [".search-extra", ".prose mark", ".resaltado-barra", ".lectura-meta", ".lectura-ajustes"]) {
    const reglas = bloque(sel);
    assert.ok(reglas.length > 0, `faltan estilos para ${sel}`);
    assert.match(reglas, /var\(--/, `${sel} usa tokens`);
    assert.doesNotMatch(reglas, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${sel} no usa colores fijos`);
  }
  for (const v of ['data-letra="s"', 'data-letra="l"', 'data-ancho="estrecho"', 'data-ancho="ancho"']) assert.ok(css.includes(`[${v}]`), `falta la regla [${v}]`);
  assert.match(bloque(".prose"), /max-width:\s*var\(--prose-max/, ".prose toma el ancho de --prose-max");
  assert.match(bloque(".prose"), /font-size:\s*var\(--prose-size/, ".prose toma la letra de --prose-size");
});
