// Lote 8a "Limpiar la página": barras plegables, cajones en móvil y modo enfoque en las páginas de la wiki (estático
// sobre fuentes). Script empaquetado (CSP por hash, sin inline nuevo), estado previo a pintar en tema-inline.js,
// localStorage con almacén seguro, UI fuera de Pagefind, ARIA y estilos con tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const leer = (p) => {
  assert.ok(exists(p), `falta ${p}`);
  return read(p);
};
const SLUG = "src/pages/[project]/[...slug].astro";
const SIDENAV = "src/components/SideNav.astro";
const SCRIPT = "src/scripts/barras.ts";
const ATAJOS_JS = "src/scripts/atajos.ts";
const BASE = "src/layouts/Base.astro";
const tag = (src, marca) => src.match(new RegExp(`<[a-z]+[^>]*${marca}[^>]*>`))?.[0] ?? "";

// ---------- 1. Marcado de la página de wiki ----------
test("[...slug].astro: .doc de la wiki con clase doc-wiki; barra izquierda id=barra-izq y derecha id=barra-der", () => {
  const src = read(SLUG);
  assert.match(src, /<div class="doc doc-wiki"/, "la clase acota los estilos a la wiki (novedades también usa .doc)");
  assert.match(src, /<SideNav\b[^>]*\bid="barra-izq"/);
  assert.match(tag(src, 'class="meta"'), /id="barra-der"/);
});

test("SideNav.astro: acepta un id opcional y lo pone en el <nav>", () => {
  const src = read(SIDENAV);
  assert.match(src, /id\?:\s*string/);
  assert.match(src, /<nav class="sidenav"[^>]*\bid=\{id\}/);
});

// Lote 9a: la fila .barras-control ("Navegación · Modo enfoque · Índice") se quitó; los botones de riel y de
// móvil se prueban en tests/pagina-limpia.test.mjs.

test("[...slug].astro: velo para clic fuera de los cajones (el botón 'Salir del enfoque' se quitó en el lote 9a)", () => {
  const src = read(SLUG);
  const velo = tag(src, "data-barras-velo");
  assert.ok(velo, "falta el velo data-barras-velo");
  assert.match(velo, /\bhidden\b/);
});

test("[...slug].astro: importa el script empaquetado de barras y no agrega scripts en línea", () => {
  const src = read(SLUG);
  assert.match(src, /<script>[^]*import\s+["']\.\.\/\.\.\/scripts\/barras(\.ts)?["'][^]*<\/script>/);
  assert.doesNotMatch(src, /is:inline/);
  assert.equal((read(BASE).match(/is:inline/g) ?? []).length, 1, "tema-inline sigue siendo el único en línea");
});

// ---------- 2. Script de barras ----------
test("barras.ts: usa la lógica pura y el almacén seguro; nada de HTML como texto", () => {
  const s = leer(SCRIPT);
  assert.match(s, /from\s+["']\.\.\/lib\/barras(\.ts)?["']/);
  for (const f of ["barras", "visible", "leerBarras", "guardarBarras", "ANCHO_CAJON"]) assert.match(s, new RegExp(`\\b${f}\\b`), f);
  assert.match(s, /almacenSeguro\(/);
  assert.doesNotMatch(s, /localStorage\.(get|set|remove)Item/, "localStorage solo a través de almacenSeguro (try/catch)");
  assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(/);
});

test("barras.ts: escucha los atajos (wiki:barras), Esc, clic en el velo y el cambio de ancho", () => {
  const s = leer(SCRIPT);
  assert.match(s, /addEventListener\(\s*["']wiki:barras["']/);
  assert.match(s, /["']Escape["']/);
  assert.match(s, /dialog\[open\]/, "Esc no compite con un <dialog> abierto");
  assert.match(s, /data-barras-velo|barrasVelo/);
  assert.match(s, /matchMedia\(/);
});

test("barras.ts: sincroniza aria-expanded y aria-label, gestiona el foco y no persiste el enfoque", () => {
  const s = leer(SCRIPT);
  assert.match(s, /setAttribute\(\s*["']aria-expanded["']/);
  assert.match(s, /setAttribute\(\s*["']aria-label["']/);
  assert.ok((s.match(/\.focus\(/g) ?? []).length >= 2, "foco al abrir el cajón y de vuelta al botón al cerrar");
  assert.match(s, /dataset\.enfoque|data-enfoque/);
  assert.match(s, /dataset\.barraIzq|data-barra-izq/);
  assert.doesNotMatch(s, /wiki:enfoque/, "el enfoque no se guarda entre páginas");
});

test("atajos.ts (script): manda [ ] f a las barras con un CustomEvent, pasa AltGr y no dispara en select", () => {
  const s = read(ATAJOS_JS);
  assert.match(s, /new CustomEvent\(\s*["']wiki:barras["']/);
  assert.match(s, /getModifierState\(\s*["']AltGraph["']\s*\)/);
  // Lote «sueltos-teclado»: quién está escribiendo lo decide escribiendoEn() en la lógica pura, que cubre <select> y
  // shadow DOM (tests/sueltos-teclado.test.mjs).
  assert.match(s, /escribiendo:\s*escribiendoEn\(e\)/, "un <select> también cuenta como escribiendo");
});

// ---------- 3. Antes de pintar ----------
function correTema(guardado) {
  const dataset = {};
  const localStorage = { getItem: (k) => (Object.hasOwn(guardado, k) ? guardado[k] : null) };
  vm.runInNewContext(read("src/scripts/tema-inline.js"), { localStorage, document: { documentElement: { dataset } } });
  return dataset;
}

test("tema-inline.js: aplica las barras plegadas antes de pintar (lista blanca) y nunca el enfoque", () => {
  assert.deepEqual(correTema({ "wiki:barra-izq": "plegada" }), { barraIzq: "plegada" });
  assert.deepEqual(correTema({ "wiki:barra-izq": "plegada", "wiki:barra-der": "plegada" }), { barraIzq: "plegada", barraDer: "plegada" });
  assert.deepEqual(correTema({ "wiki:barra-izq": "1", "wiki:barra-der": '"><script>' }), {});
  assert.deepEqual(correTema({ "wiki:enfoque": "1" }), {});
});

// ---------- 4. Estilos ----------
test("global.css: plegado por data-* en <html> acotado a .doc-wiki y enfoque", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /\[data-barra-izq="plegada"\][^{]*\.doc-wiki/);
  assert.match(css, /\[data-barra-der="plegada"\][^{]*\.doc-wiki/);
  assert.match(css, /\[data-enfoque\][^{]*\.doc-wiki/);
});

test("global.css: cajones por debajo de 900 px (fixed, con velo) y animación desactivada con reduced-motion", () => {
  const css = read("src/styles/global.css");
  const movil = [...css.matchAll(/@media \(max-width: 899(\.\d+)?px\)\s*\{([^]*?)\n\}/g)].map((m) => m[2]).join("\n");
  assert.ok(movil, "falta @media (max-width: 899…px)");
  assert.match(movil, /\.doc-wiki[^{]*(\.sidenav|\.meta)[^{]*\{[^}]*position:\s*fixed/);
  assert.match(movil, /\.barras-velo/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{[^}]*\.doc-wiki/);
});

test("global.css: velo con tokens (sin colores fijos); se oculta al imprimir", () => {
  const css = read("src/styles/global.css");
  const reglas = css
    .replace(/@media print\s*\{[^]*?\n\}/, "")
    .split("\n")
    .filter((l) => /\.barras-velo/.test(l));
  assert.ok(reglas.length > 0, "faltan reglas .barras-velo");
  for (const l of reglas) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
  const print = css.match(/@media print\s*\{[^]*?\n\}/)?.[0] ?? "";
  for (const sel of [".barras-velo"]) assert.ok(print.includes(sel), `impresión oculta ${sel}`);
});

test("el cajón abierto se hace visible sin retraso para que focus() funcione", () => {
  const css = read("src/styles/global.css");
  const regla = css.match(/html\[data-cajon="izq"\] \.doc-wiki \.sidenav[^{]*\{[^}]*\}/)?.[0] ?? "";
  assert.match(regla, /visibility:\s*visible/);
  assert.match(regla, /transition:[^;]*visibility 0s/, "al abrir, visibility no debe animarse (el foco fallaría)");
});
