// Rutas por rol en el portal: página /<id>/rutas/ (la propia rutas.md mejorada), bloque al pie de cada paso, enlaces
// en la portada y el SideNav solo si hay rutas, script empaquetado (sin inline nuevo: CSP) y estilos con los tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SLUG = "src/pages/[project]/[...slug].astro";

test("data.ts: ProjectData tiene rutas opcionales con la forma de tools/rutas.mjs", () => {
  const src = read("src/lib/data.ts");
  assert.match(src, /rutas\?:\s*Ruta\[\]/);
  assert.match(src, /from "\.\/rutas(\.ts)?"/);
});

test("la página wiki rutas.md se vuelve interactiva con el componente RutasRol solo si el proyecto tiene rutas", () => {
  const src = read(SLUG);
  assert.match(src, /import RutasRol from "\.\.\/\.\.\/components\/RutasRol\.astro"/);
  assert.match(src, /entry\.data\.path === "rutas\.md"/);
  assert.match(src, /p\.rutas\?\.length/);
});

test("RutasRol: selector de rol con radios reales, casillas con label, progreso con texto, continuar y reiniciar", () => {
  assert.ok(exists("src/components/RutasRol.astro"), "falta src/components/RutasRol.astro");
  const src = read("src/components/RutasRol.astro");
  assert.match(src, /<fieldset[^>]*>[^]*<legend/, "el selector de rol es un fieldset con legend");
  assert.match(src, /type="radio"/);
  assert.match(src, /<label[^>]*>[^]*type="checkbox"|type="checkbox"[^]*<label/, "casillas reales con label");
  assert.match(src, /<progress/);
  assert.match(src, /aria-live="polite"/, "el contador 'N de M' se anuncia");
  // Lote 9a: el botón principal arranca como "Empezar" (activa la ruta); el script cambia el texto con textoContinuar.
  assert.match(src, /data-continuar[^>]*>\s*Empezar\s*</);
  assert.match(src, /Reiniciar ruta/);
  assert.match(src, /import\s+["']\.\.\/scripts\/rutas(\.ts)?["']/, "usa el script empaquetado");
});

test("bloque al pie de cada paso: oculto hasta que el script lo llena y fuera del índice de Pagefind", () => {
  const src = read(SLUG);
  assert.match(src, /class="ruta-paso"[^>]*\bhidden\b/);
  assert.match(src, /class="ruta-paso"[^>]*data-pagefind-ignore="all"|data-pagefind-ignore="all"[^>]*class="ruta-paso"/);
  assert.match(src, /import\s+["']\.\.\/\.\.\/scripts\/rutas(\.ts)?["']/);
});

test("src/scripts/rutas.ts: usa la lógica de src/lib/rutas.ts, confirma el reinicio y no usa innerHTML", () => {
  assert.ok(exists("src/scripts/rutas.ts"), "falta src/scripts/rutas.ts");
  const src = read("src/scripts/rutas.ts");
  assert.match(src, /from\s+["']\.\.\/lib\/rutas(\.ts)?["']/);
  assert.match(src, /almacenSeguro\(/);
  assert.match(src, /showModal\(/);
  assert.match(src, /Marcar como leído/);
  assert.match(src, /Siguiente: /);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test("CSP: no hay scripts is:inline nuevos y la CSP sigue con solo el hash del tema", () => {
  for (const f of [SLUG, "src/components/RutasRol.astro", "src/components/SideNav.astro"]) {
    if (exists(f)) assert.doesNotMatch(read(f), /is:inline/, f);
  }
  assert.match(read("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
});

test("SideNav y portada: 'Rutas por rol' solo cuando el proyecto tiene rutas, sin duplicar rutas.md en Empezar", () => {
  const nav = read("src/components/SideNav.astro");
  assert.match(nav, /rutas\?:\s*string/, "prop opcional con la ruta de /<id>/rutas/");
  assert.match(nav, /\{rutas\s*&&[^]*Rutas por rol/);
  assert.match(nav, /rutas\.md/, "con rutas, el enlace normal a rutas.md no se repite en la sección");
  for (const f of ["src/pages/[project]/index.astro", SLUG, "src/pages/[project]/novedades.astro"]) {
    assert.match(read(f), /<SideNav[^>]*rutas=\{/, `${f} pasa rutas al SideNav`);
  }
  const portada = read("src/pages/[project]/index.astro");
  assert.match(portada, /p\.rutas\?\.length/);
  assert.match(portada, /Rutas por rol/);
});

test("estilos: .rutas y .ruta-paso usan los tokens del tema, sin colores fijos", () => {
  const css = read("src/styles/global.css");
  const bloque = (sel) => [...css.matchAll(new RegExp(`\\${sel}[^{]*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
  for (const sel of [".rutas", ".ruta-paso"]) {
    const reglas = bloque(sel);
    assert.ok(reglas.length > 0, `faltan estilos para ${sel}`);
    assert.match(reglas, /var\(--/, `${sel} usa tokens`);
    assert.doesNotMatch(reglas, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${sel} no usa colores fijos`);
  }
});

test("a11y rutas: sin aria-label duplicado, texto sr-only único y diálogo propio en vez de confirm()", () => {
  const c = read("src/components/RutasRol.astro");
  assert.doesNotMatch(c, /aria-label=\{`Marcar como leído/);
  assert.match(c, /class="sr-only"> — marcar como leído: \{s\.title\}/);
  assert.match(c, /<dialog class="atajos-dialog" id="rutas-reiniciar"/);
  const js = read("src/scripts/rutas.ts");
  assert.doesNotMatch(js, /confirm\(/);
  assert.match(js, /showModal\(\)/);
  assert.match(read("src/components/EstadoProyecto.astro"), /<ol aria-labelledby="estado-hacer">/);
  assert.match(read("src/pages/[project]/index.astro"), /class="estado-pagina" data-pagefind-ignore="all"/);
});
