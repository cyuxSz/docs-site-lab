// QoL de navegación en el portal: contenedor personal en cada página de la wiki (estrella + aviso de cambios),
// favoritos en SideNav y portada, tarjeta "Continuar" y diálogo de atajos en Base. Scripts empaquetados (CSP),
// textContent en vez de HTML, fuera de Pagefind y estilos con tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SLUG = "src/pages/[project]/[...slug].astro";
const PORTADA = "src/pages/[project]/software.astro"; // lote carátula
// Etiqueta de apertura del primer elemento que lleva la marca (atributo o clase).
const tag = (src, marca) => src.match(new RegExp(`<[a-z]+[^>]*${marca}[^>]*>`))?.[0] ?? "";

test("página de la wiki: contenedor data-pagina con proyecto, ruta, título y firma; fuera de Pagefind", () => {
  const src = read(SLUG);
  const t = tag(src, "data-pagina\\b");
  assert.ok(t, "falta el contenedor con data-pagina");
  for (const a of ["data-proyecto=", "data-route=", "data-title=", "data-firma=", 'data-pagefind-ignore="all"']) assert.ok(t.includes(a), `data-pagina sin ${a}`);
  assert.match(src, /firmaPagina\(/, "la firma se calcula con firmaPagina (commit o fecha)");
});

test("estrella de favoritos: botón real con aria-pressed, oculto hasta que el script lo activa", () => {
  const t = tag(read(SLUG), "data-favorito\\b");
  assert.match(t, /^<button/);
  assert.match(t, /type="button"/);
  assert.match(t, /aria-pressed="false"/);
  assert.match(t, /\bhidden\b/);
});

test("aviso de cambios: oculto, anunciado, con enlace a Novedades y botón para descartar", () => {
  const src = read(SLUG);
  const t = tag(src, 'class="aviso-cambio"');
  assert.ok(t, "falta .aviso-cambio");
  assert.match(t, /\bhidden\b/);
  assert.match(t, /role="status"/);
  assert.match(src, /Esta página cambió desde tu última visita/);
  assert.match(src, /href=\{`\/\$\{p\.id\}\/novedades\/`\}[^>]*>ver en Novedades/);
  assert.match(src, /data-descartar/);
});

test("SideNav: bloque Favoritos oculto por defecto, ligado al proyecto y con su script", () => {
  const src = read("src/components/SideNav.astro");
  const t = tag(src, "data-favoritos-lista");
  assert.ok(t, "falta data-favoritos-lista en el SideNav");
  assert.match(t, /\bhidden\b/);
  assert.match(t, /data-proyecto=\{projectId\}/);
  assert.match(src, />Favoritos</);
  assert.match(src, /import\s+["']\.\.\/scripts\/personal(\.ts)?["']/);
});

test("portada: tarjeta 'Continuar' y lista de favoritos, ambas ocultas hasta tener datos y fuera de Pagefind", () => {
  const src = read(PORTADA);
  const c = tag(src, "data-continuar-visita");
  assert.ok(c, "falta la tarjeta data-continuar-visita");
  assert.match(c, /^<a/);
  assert.match(c, /\bhidden\b/);
  assert.match(c, /data-proyecto=\{p\.id\}/);
  assert.match(c, /data-pagefind-ignore/);
  const f = tag(src, "data-favoritos-lista");
  assert.ok(f, "falta la lista de favoritos en la portada");
  assert.match(f, /\bhidden\b/);
  assert.match(f, /data-pagefind-ignore/);
  assert.match(src, /import\s+["']\.\.\/\.\.\/scripts\/personal(\.ts)?["']/);
});

test("Base: diálogo de atajos accesible con la lista de ATAJOS y rutas del proyecto; script empaquetado", () => {
  const src = read("src/layouts/Base.astro");
  const d = tag(src, 'id="atajos"');
  assert.match(d, /^<dialog/);
  assert.match(d, /aria-labelledby="atajos-titulo"/);
  assert.match(d, /data-pagefind-ignore="all"/);
  for (const a of ["data-wiki=", "data-grafo=", "data-novedades="]) assert.ok(d.includes(a), `diálogo sin ${a}`);
  assert.match(src, /id="atajos-titulo"[^>]*>Atajos de teclado</);
  assert.match(src, /import \{[^}]*ATAJOS[^}]*\} from "\.\.\/lib\/atajos(\.ts)?"/);
  assert.match(src, /ATAJOS\.map\(/);
  assert.match(src, /<kbd/);
  assert.match(src, /import\s+["']\.\.\/scripts\/atajos(\.ts)?["']/);
});

test("scripts: usan la lógica pura y el almacén seguro, pintan con textContent y nunca con HTML", () => {
  assert.ok(exists("src/scripts/personal.ts"), "falta src/scripts/personal.ts");
  assert.ok(exists("src/scripts/atajos.ts"), "falta src/scripts/atajos.ts");
  const personal = read("src/scripts/personal.ts");
  assert.match(personal, /from\s+["']\.\.\/lib\/personal(\.ts)?["']/);
  assert.match(personal, /almacenSeguro\(/);
  assert.match(personal, /textContent/);
  assert.match(personal, /aria-pressed/);
  assert.match(personal, /Continuar: /);
  const atajos = read("src/scripts/atajos.ts");
  assert.match(atajos, /from\s+["']\.\.\/lib\/atajos(\.ts)?["']/);
  assert.match(atajos, /showModal\(/);
  for (const [f, s] of [["personal", personal], ["atajos", atajos]]) assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML/, f);
  const lib = read("src/lib/personal.ts");
  assert.match(lib, /from\s+["']\.\/rutas\.ts["']/, "reutiliza almacenSeguro/Almacen de rutas.ts");
  assert.doesNotMatch(lib + read("src/lib/atajos.ts"), /\b(document|window|localStorage)\b/, "la lógica pura no toca el DOM");
});

test("CSP: sin is:inline nuevos y la CSP sigue con solo el hash del tema", () => {
  for (const f of [SLUG, PORTADA, "src/components/SideNav.astro"]) assert.doesNotMatch(read(f), /is:inline/, f);
  assert.equal((read("src/layouts/Base.astro").match(/is:inline/g) ?? []).length, 1, "Base solo conserva el script del tema");
  assert.match(read("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
});

test("estilos: estrella, aviso, continuar, favoritos y diálogo de atajos con tokens del tema, sin colores fijos", () => {
  const css = read("src/styles/global.css");
  const bloque = (sel) => [...css.matchAll(new RegExp(`\\${sel}[^{]*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
  for (const sel of [".favorito-btn", ".aviso-cambio", ".continuar", ".favoritos", ".atajos-dialog"]) {
    const reglas = bloque(sel);
    assert.ok(reglas.length > 0, `faltan estilos para ${sel}`);
    assert.match(reglas, /var\(--/, `${sel} usa tokens`);
    assert.doesNotMatch(reglas, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${sel} no usa colores fijos`);
  }
});
