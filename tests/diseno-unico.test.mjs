// Fin de la prueba A/B: queda solo el diseño A, sin ?diseno, chip, localStorage, hash de CSP ni CSS/código de B.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("diseño único: se borran el script de la prueba y la página /prueba/", () => {
  assert.equal(existsSync(join(ROOT, "src/scripts/diseno-inline.js")), false, "src/scripts/diseno-inline.js sigue existiendo");
  assert.equal(existsSync(join(ROOT, "src/pages/prueba.astro")), false, "src/pages/prueba.astro sigue existiendo");
});

test("diseño único: nada en src/ ni en astro.config.mjs menciona 'diseno' (?diseno, data-diseno, chip, localStorage)", () => {
  const files = [...walk(join(ROOT, "src")), join(ROOT, "astro.config.mjs")];
  const sucios = files.filter((f) => /diseno/i.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length));
  assert.deepEqual(sucios, []);
});

test("diseño único: la CSP solo lleva el hash del script del tema", () => {
  assert.match(read("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
});

test("diseño único: tablas como tarjetas en teléfono sin depender de [data-diseno]", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /:is\(\.prose table, \.data-table\) td::before\s*\{\s*content:\s*attr\(data-label\)/);
  assert.doesNotMatch(css, /min-width:\s*15rem/, "queda CSS de tablas con scroll lateral (B)");
});

test("diseño único: el grafo usa siempre el layout por capas en la vista ROS y conserva ?seccion", () => {
  const src = read("src/components/RoboticsGraph.tsx");
  assert.doesNotMatch(src, /rg-help|Cómo leer este grafo/, "queda el recuadro de ayuda de B");
  assert.match(src, /const capas = data\?\.view === "ros" && Boolean\(data\.flowEdges\)/);
  assert.match(src, /q\.get\("seccion"\)/);
  assert.match(src, /Recorrido de la sección/);
  assert.doesNotMatch(read("src/components/RoboticsGraph.css"), /\.rg-help/);
});
