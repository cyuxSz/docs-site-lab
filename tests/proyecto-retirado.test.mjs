// Lote "quitar el proyecto de prueba": el proyecto ficticio con el que se probaron las herramientas sale del portal
// (projects.json, RESTRICTED, README y cualquier texto), pero el mecanismo de proyectos restringidos se queda.
// El nombre se arma por partes para que este archivo no se detecte a sí mismo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DEMO } from "./fixtures/acceso-demo.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ID = ["proyecto", "x"].join("-");
const REPO = ["docs", "lab", ID].join("-");
// El id con guion, espacio, guion bajo, sin separador o con el guion codificado (%2d, %252d), con cualquier mayúscula.
const NOMBRE = new RegExp(`proyecto(?:[-_\\s]|%2d|%252d)?x(?![a-z0-9])`, "i");

test("projects.json: el proyecto retirado ya no está (ni por id, nombre ni repo)", () => {
  const ps = JSON.parse(read("projects.json"));
  for (const p of ps) {
    assert.notEqual(p.id.toLowerCase(), ID, "id");
    assert.ok(!NOMBRE.test(p.name ?? ""), `nombre: ${p.name}`);
    assert.ok(!String(p.repo ?? "").toLowerCase().includes(REPO), `repo: ${p.repo}`);
  }
  assert.ok(!NOMBRE.test(JSON.stringify(ps)), "ningún texto de projects.json lo nombra");
});

test("access.config: RESTRICTED ya no lo contiene (queda vacío) y el mecanismo sigue exportado", async () => {
  const m = await import("../access.config.js");
  assert.ok(!Object.keys(m.RESTRICTED).some((k) => k.toLowerCase() === ID), "sigue en RESTRICTED");
  assert.deepEqual(m.RESTRICTED, {});
  assert.equal(typeof m.isRestricted, "function");
  assert.equal(typeof m.canAccess, "function");
  assert.equal(m.canAccess("otro", `/${ID}/`), true, "ya no es un proyecto restringido (y ya no existe: 404 del sitio)");
});

test("ningún archivo versionado (código, README, tests, CI) nombra al proyecto retirado ni su repo", () => {
  const archivos = execFileSync("git", ["ls-files", "-z"], { cwd: RAIZ, encoding: "utf8" }).split("\0").filter(Boolean);
  assert.ok(archivos.length > 20, "git ls-files devolvió muy pocos archivos");
  const binario = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf|glb|zip)$/i;
  const encontrados = [];
  for (const f of archivos) {
    if (binario.test(f) || f === "package-lock.json") continue;
    let txt;
    try {
      txt = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    } catch {
      continue; // borrado en el árbol de trabajo pero aún en el índice
    }
    txt.split(/\r?\n/).forEach((linea, i) => {
      if (NOMBRE.test(linea) || linea.toLowerCase().includes(REPO)) encontrados.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(encontrados, [], `todavía lo nombran:\n${encontrados.join("\n")}`);
});

test("README: la sección de proyectos restringidos explica el mecanismo sin nombrar proyectos y dice que hoy está vacío", () => {
  const readme = read("README.md");
  const i = readme.indexOf("## Proyectos restringidos");
  assert.ok(i >= 0, "falta la sección «## Proyectos restringidos»");
  const fin = readme.indexOf("\n## ", i + 1);
  const sec = readme.slice(i, fin < 0 ? undefined : fin);
  for (const s of ["access.config.js", "RESTRICTED", "isRestricted", "canAccess", "403"]) assert.ok(sec.includes(s), `falta ${s}`);
  assert.match(sec, /vac[ií]o|RESTRICTED = \{\}/, "debe decir que hoy no hay proyectos restringidos");
  assert.ok(!NOMBRE.test(sec) && !sec.includes("cyuxSz"), "no nombra proyectos ni logins concretos");
});

test("middleware.js: exporta crearMiddleware y el default usa RESTRICTED (sin tabla inyectada)", async () => {
  const mod = await import("../middleware.js");
  assert.equal(typeof mod.crearMiddleware, "function", "falta crearMiddleware({ restringidos })");
  assert.equal(typeof mod.default, "function");
  assert.ok(mod.config?.matcher, "se conserva el config del Routing Middleware");
  const src = read("middleware.js");
  assert.match(src, /export default crearMiddleware\(\)/, "el default no debe recibir una tabla");
});

test("APIs de producción no inyectan tabla: usan RESTRICTED de access.config.js", () => {
  for (const f of ["api/comentarios.js", "api/hardware.js", "api/archivos.js"]) {
    assert.ok(!/restringidos/.test(read(f)), `${f} no debe pasar restringidos a crearHandler`);
  }
  for (const f of ["lib/comentarios-core.mjs", "lib/hardware-core.mjs", "lib/archivos-core.mjs"]) {
    const src = read(f);
    const firma = src.split(/\r?\n/).find((l) => l.includes("export function crearHandler(")) ?? "";
    assert.match(firma, /\brestringidos\b/, `${f}: crearHandler acepta restringidos`);
    const llamadas = src.match(/canAccess\(/g) ?? [];
    const conTabla = src.match(/canAccess\([^()]*,\s*restringidos\)/g) ?? [];
    assert.ok(llamadas.length > 0, `${f}: usa canAccess`);
    assert.equal(conTabla.length, llamadas.length, `${f}: cada canAccess recibe restringidos`);
  }
});

test("la tabla de prueba es un id que no existe en el portal", () => {
  const ids = JSON.parse(read("projects.json")).map((p) => p.id);
  for (const id of Object.keys(DEMO)) assert.ok(!ids.includes(id), id);
});
