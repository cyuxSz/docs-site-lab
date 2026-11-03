// Lote 8c · cableado: dos toggles en "Vista ▾" con su URL, estilo y leyenda por estado, insignias agrupadas en panel y
// tabla, y la página /<proyecto>/limpieza/ con progreso, filtro y exportación. Lectura de fuente: lo visual (375 px,
// temas, foco, descarga real) va a la verificación en navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), "utf8") : "");
const TSX = read("src/components/RoboticsGraph.tsx");
const CSS = read("src/components/RoboticsGraph.css");
const GRAFO = read("src/pages/[project]/grafo.astro");
const INDICE = read("src/pages/[project]/software.astro"); // lote carátula: la portada de software vive aquí
const PAGINA = read("src/pages/[project]/limpieza.astro");
const SCRIPT = read("src/scripts/limpieza.ts");

test("grafo: dos menuitemcheckbox independientes 'Mostrar legado' y 'Mostrar sin uso'", () => {
  assert.match(TSX, /from "\.\.\/lib\/estados(\.ts)?"/);
  assert.match(TSX, />\s*Mostrar legado\s*</);
  assert.match(TSX, />\s*Mostrar sin uso\s*</);
  assert.doesNotMatch(TSX, /Mostrar legado y sin uso/, "el toggle combinado desaparece (también en la nota de sección vacía)");
  assert.match(TSX, /aria-checked=\{filtros\.legado\}/);
  assert.match(TSX, /aria-checked=\{filtros\.sinUso\}/);
  assert.match(TSX, /ocultoPorEstado\(/, "la visibilidad usa el filtro por estado");
  assert.doesNotMatch(TSX, /HIDDEN_BY_DEFAULT/, "el conjunto combinado se sustituye por los dos filtros");
});

test("grafo: los filtros se leen y escriben en la URL (legado=1, sinuso=1)", () => {
  assert.match(TSX, /leerFiltrosUrl\(/);
  assert.match(TSX, /escribirFiltrosUrl\(/);
});

test("grafo: las vistas guardadas guardan y aplican los dos filtros", () => {
  assert.match(TSX, /sinUso:\s*filtros\.sinUso/);
  assert.match(TSX, /legado:\s*filtros\.legado/);
  assert.match(TSX, /a\.sinUso/);
});

test("grafo: estilo por estado en el lienzo y chips de leyenda separados", () => {
  assert.match(TSX, /estiloEstado\(/);
  assert.match(TSX, /rg-chip-legado/);
  assert.match(TSX, /rg-chip-sin_uso/);
  assert.match(CSS, /\.rg-chip-legado/);
  assert.match(CSS, /\.rg-chip-sin_uso/);
});

test("insignias agrupadas: panel del nodo y tabla usan insignias() dentro de un contenedor .insignias", () => {
  assert.match(TSX, /insignias\(/);
  assert.match(TSX, /className="insignias"/);
  assert.match(GRAFO, /insignias\(/);
  assert.match(GRAFO, /class="insignias"/);
});

test("menú Más: enlace 'Limpieza del repo' como menuitem hacia /<proyecto>/limpieza/", () => {
  assert.match(TSX, /Limpieza del repo/);
  assert.match(TSX, /href=\{`\/\$\{projectId\}\/limpieza\/`\}/);
  assert.match(TSX, /<a[^>]*role="menuitem"[^>]*limpieza|<a[^>]*limpieza[^>]*role="menuitem"/s);
});

test("índice del proyecto enlaza la limpieza (solo con grafo ROS)", () => {
  assert.match(INDICE, /\/limpieza\//);
  assert.match(INDICE, /Limpieza del repo/);
});

test("página limpieza: existe, usa filasLimpieza y tiene las dos secciones", () => {
  assert.ok(PAGINA, "falta src/pages/[project]/limpieza.astro");
  assert.match(PAGINA, /getStaticPaths/);
  assert.match(PAGINA, /filasLimpieza\(/);
  assert.match(PAGINA, /Sin uso \(candidatos a borrar\)/);
  assert.match(PAGINA, /Legado/);
  assert.match(PAGINA, /se puede borrar cuando se retire/i);
  assert.match(PAGINA, /type="checkbox"/, "casilla 'revisado' por fila");
  assert.match(PAGINA, /data-id=/);
  assert.match(PAGINA, /Ocultar revisados/);
  assert.match(PAGINA, /Exportar/);
  assert.match(PAGINA, /aria-live="polite"/, "el progreso se anuncia");
  assert.match(PAGINA, /<script>[\s\S]*scripts\/limpieza/, "script empaquetado, no inline");
  assert.doesNotMatch(PAGINA, /set:html/, "nada de HTML crudo con datos del repo");
});

test("script limpieza: almacén seguro, lógica de src/lib/limpieza y descarga local con Blob", () => {
  assert.ok(SCRIPT, "falta src/scripts/limpieza.ts");
  assert.match(SCRIPT, /almacenSeguro\(/);
  assert.match(SCRIPT, /claveRevisados\(/);
  assert.match(SCRIPT, /leerRevisados\(/);
  assert.match(SCRIPT, /limpiezaMarkdown\(/);
  assert.match(SCRIPT, /new Blob\(/);
  assert.match(SCRIPT, /URL\.revokeObjectURL\(/);
  assert.doesNotMatch(SCRIPT, /fetch\(/, "sin servidor");
  assert.doesNotMatch(SCRIPT, /innerHTML/, "sin innerHTML");
});
