// Lote 8d "Pulido", criterio 5: conteos coherentes. El índice del proyecto mostraba "18/68" (nodos en uso / todos los
// ros2_node, incluidos 11 externos) y el grafo "6 de 71" (elementos visibles / nodos + hardware). Una sola función en
// src/lib/conteos.ts define qué es "nodo del repo" (ros2_node sin externos, como la tabla de grafo.astro) y las
// etiquetas dicen explícitamente qué cuenta cada número. RoboticsGraph.tsx adopta etiquetaVisibles en su propia rama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let mod = null;
let fallo = null;
try {
  mod = await import("../src/lib/conteos.ts");
} catch (e) {
  fallo = e;
}
const C = (...fns) => {
  assert.ok(mod, `falta src/lib/conteos.ts (${fallo?.code ?? fallo?.message})`);
  for (const f of fns) assert.equal(typeof mod[f], "function", `src/lib/conteos.ts no exporta ${f}`);
  return mod;
};

const n = (status, category = "ros2_node") => ({ id: `${category}-${status}-${Math.random()}`, label: "x", category, status, configs: [] });
const NODOS = [
  ...Array.from({ length: 3 }, () => n("en_uso")),
  ...Array.from({ length: 2 }, () => n("legado")),
  n("sin_uso"),
  n("roto"),
  ...Array.from({ length: 4 }, () => n("externo")),
  n(undefined, "ros2_topic"),
  n(undefined, "ros2_topic"),
  n(undefined, "hardware"),
];

test("conteoNodos: total = ros2_node sin externos; desglose por estado; externos aparte; topics y hardware no cuentan", () => {
  const { conteoNodos } = C("conteoNodos");
  assert.deepEqual(conteoNodos(NODOS), { total: 7, enUso: 3, legado: 2, sinUso: 1, rotos: 1, externos: 4 });
  assert.deepEqual(conteoNodos([]), { total: 0, enUso: 0, legado: 0, sinUso: 0, rotos: 0, externos: 0 });
});

test("etiquetaNodos y etiquetaVisibles dicen qué cuenta cada número", () => {
  const { conteoNodos, etiquetaNodos, etiquetaVisibles } = C("conteoNodos", "etiquetaNodos", "etiquetaVisibles");
  assert.equal(etiquetaNodos(conteoNodos(NODOS)), "3 en uso de 7 nodos del repo");
  assert.equal(etiquetaVisibles(6, 71), "6 de 71 elementos visibles");
  assert.equal(etiquetaVisibles(1, 1), "1 de 1 elemento visible");
});

test("el índice del proyecto usa conteoNodos (sin rosNodes.length ni filtros propios por estado)", () => {
  const src = read("src/pages/[project]/index.astro");
  assert.match(src, /import\s*\{[^}]*conteoNodos[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/conteos(\.ts)?["']/);
  assert.doesNotMatch(src, /rosNodes\.length/);
  assert.doesNotMatch(src, /byStatus\(/);
});
