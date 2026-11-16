// Lote 8d "Pulido", criterio 3: títulos crudos. Una página cuyo título (frontmatter o primer H1) es solo el nombre de
// su carpeta/archivo en minúsculas (p. ej. "architecture") usa un título legible; los nombres de paquete (uuv_vision)
// no se tocan. tools/fetch.mjs aplica tools/titulos.mjs, así que encabezado, migas, navegación y <title> lo heredan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let mod = null;
let fallo = null;
try {
  mod = await import("../tools/titulos.mjs");
} catch (e) {
  fallo = e;
}
const T = (...fns) => {
  assert.ok(mod, `falta tools/titulos.mjs (${fallo?.code ?? fallo?.message})`);
  for (const f of fns) assert.equal(typeof mod[f], "function", `tools/titulos.mjs no exporta ${f}`);
  return mod;
};

test("esTituloCrudo: solo cuando el título es el slug (carpeta en index.md, archivo en las demás) en minúsculas", () => {
  const { esTituloCrudo } = T("esTituloCrudo");
  assert.equal(esTituloCrudo("architecture", "architecture/index.md"), true);
  assert.equal(esTituloCrudo("operations", "operations/index.md"), true);
  assert.equal(esTituloCrudo("getting-started", "guias/getting-started.md"), true);
  assert.equal(esTituloCrudo("Arquitectura", "architecture/index.md"), false);
  assert.equal(esTituloCrudo("uuv_vision", "packages/uuv_vision.md"), false, "los nombres de paquete con _ son legítimos");
  assert.equal(esTituloCrudo("x_vision", "packages/x_vision.md"), false);
  assert.equal(esTituloCrudo("Wiki del proyecto Demo", "index.md"), false);
  assert.equal(esTituloCrudo("overview", "architecture/index.md"), false, "no coincide con la carpeta");
});

test("humanizar: diccionario de carpetas conocidas (igual que las secciones de la SideNav) y, si no, mayúscula inicial", () => {
  const { humanizar } = T("humanizar");
  assert.equal(humanizar("architecture"), "Arquitectura");
  assert.equal(humanizar("packages"), "Paquetes");
  assert.equal(humanizar("operations"), "Operación");
  assert.equal(humanizar("getting-started"), "Getting started");
  assert.equal(humanizar("glosario"), "Glosario");
});

test("tituloPagina: frontmatter > primer H1 > slug humanizado, saltando los que son crudos", () => {
  const { tituloPagina } = T("tituloPagina");
  assert.equal(tituloPagina({ title: "architecture" }, "# architecture\n\n- x", "architecture/index.md"), "Arquitectura");
  assert.equal(tituloPagina({}, "# architecture\n", "architecture/index.md"), "Arquitectura");
  assert.equal(tituloPagina({ title: "architecture" }, "# Arquitectura del sistema\n", "architecture/index.md"), "Arquitectura del sistema");
  assert.equal(tituloPagina({ title: "Visión general" }, "# otra cosa\n", "architecture/overview.md"), "Visión general");
  assert.equal(tituloPagina({}, "# Visión general\n", "architecture/overview.md"), "Visión general");
  assert.equal(tituloPagina({ title: "uuv_vision" }, "# uuv_vision\n", "packages/uuv_vision.md"), "uuv_vision");
  assert.equal(tituloPagina({}, "Texto sin encabezado.\n", "guias/getting-started.md"), "Getting started");
});

test("corregirH1: reemplaza solo un primer H1 crudo; el resto del cuerpo queda igual", () => {
  const { corregirH1 } = T("corregirH1");
  assert.equal(corregirH1("# architecture\n\n- [a](b)\n", "Arquitectura", "architecture/index.md"), "# Arquitectura\n\n- [a](b)\n");
  assert.equal(corregirH1("# uuv_vision\n\nTexto\n", "uuv_vision", "packages/uuv_vision.md"), "# uuv_vision\n\nTexto\n");
  assert.equal(corregirH1("# Visión general\n", "Visión general", "architecture/overview.md"), "# Visión general\n");
  assert.equal(corregirH1("Sin H1\n", "Getting started", "guias/getting-started.md"), "Sin H1\n");
});

test("tools/fetch.mjs usa tituloPagina y corregirH1 de tools/titulos.mjs (no el fallback a rel)", () => {
  const src = read("tools/fetch.mjs");
  assert.match(src, /import\s*\{[^}]*tituloPagina[^}]*\}\s*from\s*["']\.\/titulos\.mjs["']/);
  assert.match(src, /corregirH1\(/);
  assert.doesNotMatch(src, /\|\|\s*rel;/, "el título ya no cae en el nombre del archivo");
});
