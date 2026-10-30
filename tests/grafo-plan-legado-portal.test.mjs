// Lote 6b-1 · Cableado en RoboticsGraph y en la tabla de grafo.astro. Lectura de fuente: el aspecto (aristas plan,
// aviso, 375 px, temas) se verifica en el navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const TSX = read("src/components/RoboticsGraph.tsx");
const CSS = read("src/components/RoboticsGraph.css");
const ASTRO = read("src/pages/[project]/grafo.astro");

test("plan: toggle accesible, apagado por defecto y lógica de src/lib/plan", () => {
  assert.match(TSX, /from "\.\.\/lib\/plan(\.ts)?"/);
  assert.match(TSX, /Mostrar plan \(arquitectura objetivo\)/);
  assert.match(TSX, /const \[showPlan, setShowPlan\] = useState\(false\)/);
  assert.match(TSX, /planDisponible\(/);
  assert.match(TSX, /idsConPlan\(/);
  assert.match(TSX, /claveLayout\(/);
  assert.match(TSX, /planFlowEdges/);
  assert.match(TSX, /etiquetaPlan\(/);
  assert.match(TSX, /notaPlan\(/);
  assert.match(TSX, /LEYENDA_PLAN/);
});

test("plan: color desde un token del tema, leyenda con muestra punteada y sin colores fijos nuevos", () => {
  assert.match(TSX, /cssVar\("--warn"/);
  assert.match(CSS, /\.rg-dot-plan\s*\{[^}]*dashed[^}]*var\(--warn\)/);
  const reglas = CSS.split("}").filter((r) => /rg-(dot-plan|plan|legado)/.test(r));
  assert.ok(reglas.length >= 2, "faltan reglas .rg-dot-plan / .rg-legado");
  for (const r of reglas) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b/i, `color fijo en: ${r.trim().slice(0, 60)}`);
});

test("legado: aviso con enlace, recorrido propio y lógica de src/lib/legado", () => {
  assert.match(TSX, /from "\.\.\/lib\/legado(\.ts)?"/);
  assert.match(TSX, /AVISO_LEGADO/);
  assert.match(TSX, /className="[^"]*rg-legado/);
  assert.match(TSX, /recorridoActivo\(/);
  assert.match(TSX, /configInicial\(|configDelRecorrido\(/);
  assert.match(TSX, /Recorrido del sistema anterior/);
  assert.match(TSX, /Ver discrepancias/);
});

test("tabla del grafo: sin aristas plan ni nodos solo-plan", () => {
  assert.match(ASTRO, /separarPlan\(|kind !== "plan"/);
});

test("sin scripts inline nuevos ni dependencias para aristas punteadas", () => {
  assert.doesNotMatch(ASTRO, /is:inline/);
  assert.doesNotMatch(TSX, /dangerouslySetInnerHTML/);
  const pkg = JSON.parse(read("package.json"));
  assert.ok(!Object.keys(pkg.dependencies ?? {}).some((d) => d.startsWith("@sigma/")), "sin paquetes @sigma/* nuevos");
});
