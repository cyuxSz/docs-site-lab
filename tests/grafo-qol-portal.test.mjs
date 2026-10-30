// Cableado del lote 5 (QoL del grafo) en RoboticsGraph: modo presentación, minimapa en <canvas> propio y retomar
// el recorrido. Lectura de fuente: el comportamiento visual se verifica en el navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const TSX = read("src/components/RoboticsGraph.tsx");
const CSS = read("src/components/RoboticsGraph.css");
const regla = (sel) => {
  const i = CSS.indexOf(sel);
  return i < 0 ? "" : CSS.slice(i, CSS.indexOf("}", i) + 1);
};

test("presentación: botón accesible, tecla vía accionTecla y estado en la raíz del grafo", () => {
  assert.match(TSX, /from "\.\.\/lib\/recorrido(\.ts)?"/);
  assert.match(TSX, /accionTecla\(/);
  assert.match(TSX, /Modo presentación/);
  assert.match(TSX, /aria-pressed=\{present/);
  assert.match(TSX, /rg-presenting/);
  assert.match(TSX, /requestFullscreen/);
});

test("presentación: el CSS oculta barra, leyenda y paneles, agranda el texto del paso y no fija colores nuevos", () => {
  assert.match(CSS, /\.rg-presenting/);
  for (const sel of [".rg-toolbar", ".rg-legend"]) assert.match(CSS, new RegExp(`\\.rg-presenting[^{]*\\${sel}`), sel);
  // Sin pantalla completa nativa: la raíz ocupa toda la ventana y tapa SideNav y pestañas del portal.
  assert.match(CSS, /\.rg-presenting\s*\{[^}]*position:\s*fixed/);
  assert.match(CSS, /\.rg-presenting[^{]*\.rg-tour[^{]*\{[^}]*font-size/);
  const reglas = CSS.split("}").filter((r) => r.includes(".rg-presenting") || r.includes(".rg-minimap"));
  for (const r of reglas) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b/i, `color fijo en: ${r.trim().slice(0, 60)}`);
});

test("minimapa: <canvas> propio, posiciones ya calculadas, rAF en el evento de cámara y sin otra instancia de Sigma", () => {
  assert.match(TSX, /from "\.\.\/lib\/minimapa(\.ts)?"/);
  assert.match(TSX, /<canvas[^>]*className="rg-minimap/);
  assert.match(TSX, /requestAnimationFrame/);
  assert.match(TSX, /cancelAnimationFrame/);
  assert.match(TSX, /getCamera\(\)\.on\("updated"/);
  assert.equal((TSX.match(/new Sigma\b/g) ?? []).length, 1, "solo una instancia de Sigma");
  assert.match(TSX, /claveMinimapa/);
  assert.match(TSX, /minimapaVisible\(/);
  assert.match(TSX, /Ocultar minimapa|Mostrar minimapa/);
  assert.ok(regla(".rg-minimap"), "falta la regla .rg-minimap");
});

test("retomar recorrido: guarda el paso y ofrece retomar o empezar de nuevo", () => {
  assert.match(TSX, /claveRecorrido\(/);
  assert.match(TSX, /guardarPaso\(/);
  assert.match(TSX, /pasoGuardado\(/);
  assert.match(TSX, /textoRetomar\(/);
  assert.match(TSX, /Empezar de nuevo/);
  assert.match(TSX, /almacenSeguro/);
});

test("sin scripts inline nuevos en la página del grafo", () => {
  assert.doesNotMatch(read("src/pages/[project]/grafo.astro"), /is:inline/);
});
