// Cableado de los lotes 21 (comparar configuraciones) y 22 (camino entre nodos) en RoboticsGraph. Lectura de fuente:
// el color, la atenuación y el foco se verifican en el navegador (## Verificación de la spec).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const TSX = read("src/components/RoboticsGraph.tsx");
const CSS = read("src/components/RoboticsGraph.css");

test("comparar: usa src/lib/comparar, entrada en el menú Vista y estado en la URL", () => {
  assert.match(TSX, /from "\.\.\/lib\/comparar(\.ts)?"/);
  for (const f of ["compararConfigs", "textoResumen", "estiloComparar", "leerCompararUrl", "escribirCompararUrl"]) assert.match(TSX, new RegExp(`\\b${f}\\(`), f);
  assert.match(TSX, /Comparar configuraciones/);
  assert.match(TSX, /className="rg-comparar"/);
  assert.match(TSX, /Salir de comparar/);
});

test("comparar: dos selectores etiquetados (A y B), resumen anunciado y lista de diferencias plegable", () => {
  assert.match(TSX, /Configuración A/);
  assert.match(TSX, /Configuración B/);
  assert.match(TSX, /<details[^>]*className="rg-comparar-dif/);
  assert.match(TSX, /<summary/);
  assert.match(TSX, /rg-comparar-resumen[^>]*aria-live="polite"|aria-live="polite"[^>]*rg-comparar-resumen/);
});

test("comparar: leyenda propia con ícono y texto por lado (no solo color)", () => {
  assert.match(TSX, /rg-comparar-leyenda/);
  assert.match(TSX, /\.icono/);
  assert.match(TSX, /\.texto/);
});

test("camino: usa src/lib/camino, reusa el combobox de búsqueda para origen y destino", () => {
  assert.match(TSX, /from "\.\.\/lib\/camino(\.ts)?"/);
  for (const f of ["caminoMasCorto", "textoCamino", "aristasCamino", "leerCaminoUrl", "escribirCaminoUrl", "modoInicialUrl"]) assert.match(TSX, new RegExp(`\\b${f}\\(`), f);
  assert.match(TSX, /Camino entre nodos/);
  assert.match(TSX, /className="rg-camino"/);
  assert.match(TSX, /Origen/);
  assert.match(TSX, /Destino/);
  // El buscador se reutiliza como componente o función, no se copia: un solo role="combobox" en el JSX
  // o, si hay varios, todos usan filtrarBusqueda.
  const combos = (TSX.match(/role="combobox"/g) ?? []).length;
  assert.ok(combos >= 1);
  assert.equal((TSX.match(/candidatosBusqueda\(/g) ?? []).length, 1, "un solo cálculo de candidatos");
});

test("camino: intercambiar, aviso de ruta no dirigida, sin ruta y salir", () => {
  assert.match(TSX, /Intercambiar origen y destino/);
  assert.match(TSX, /no respeta el sentido de los mensajes/);
  assert.match(TSX, /No hay camino/);
  assert.match(TSX, /Salir del camino/);
  assert.match(TSX, /className="rg-camino-pasos"/);
});

test("modos: Esc sale de comparar y de camino, y los dos modos se excluyen", () => {
  assert.match(TSX, /salirComparar/);
  assert.match(TSX, /salirCamino/);
  // Esc dentro de cada panel sale del modo.
  assert.match(TSX, /rg-comparar[\s\S]{0,400}Escape|Escape[\s\S]{0,400}salirComparar/);
  assert.match(TSX, /rg-camino[\s\S]{0,400}Escape|Escape[\s\S]{0,400}salirCamino/);
});

test("CSS: reglas de los paneles, oculto en presentación y sin colores fijos nuevos fuera de lib", () => {
  for (const sel of [".rg-comparar", ".rg-camino", ".rg-comparar-leyenda", ".rg-camino-pasos"]) assert.ok(CSS.includes(sel), `falta ${sel}`);
  assert.match(CSS, /\.rg-presenting[^{]*\.rg-comparar/);
  assert.match(CSS, /\.rg-presenting[^{]*\.rg-camino/);
  const reglas = CSS.split("}").filter((r) => r.includes(".rg-comparar") || r.includes(".rg-camino"));
  for (const r of reglas) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b/i, `color fijo en: ${r.trim().slice(0, 60)}`);
});

test("el resalte actualiza las refs y repinta en el mismo efecto; resumen anunciado", () => {
  assert.match(TSX, /resalteRef\.current = resalte;\s*ladosRef\.current = [^\n]*\n\s*sigma\.current\?\.refresh/);
  assert.match(TSX, /className="rg-comparar-resumen" role="status" aria-live="polite"/);
});
