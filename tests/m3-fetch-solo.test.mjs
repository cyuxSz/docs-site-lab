// M3 · tools/fetch.mjs con DOCS_SOLO_PROYECTO=<id>: solo vuelve a traer ese proyecto y conserva los demás desde el
// .content/ que dejó la caché; si a otro proyecto le falta algo, cae a descarga completa. Sin la variable (Vercel),
// todo sigue igual. Sin red: copia tools/ a un directorio temporal con su propio projects.json y usa DOCS_LOCAL_REPOS
// con repos git creados aquí.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
let T; // directorio temporal: T/sitio (copia de tools/ + projects.json) y T/repos/<id>
const SITIO = () => join(T, "sitio");
const OUT = () => join(SITIO(), ".content");
const NO_EXISTE = () => join(T, "repos", "no-existe");

const PROYECTOS = [
  { id: "a", name: "A", repo: "local/a", branch: "main", editoresDocs: ["cyuxSz"] },
  { id: "b", name: "B", repo: "local/b", branch: "main" },
];

const git = (dir, ...args) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=Prueba", "-c", "user.email=prueba@example.com", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function escribir(dir, rel, texto) {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), texto);
}

function repo(id, archivos) {
  const dir = join(T, "repos", id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "--quiet", "-b", "main", dir]);
  for (const [rel, texto] of Object.entries(archivos)) escribir(dir, rel, texto);
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "inicio");
  return dir;
}

function commit(dir, cambios, borrar = []) {
  for (const [rel, texto] of Object.entries(cambios)) escribir(dir, rel, texto);
  for (const rel of borrar) git(dir, "rm", "--quiet", rel);
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "cambio");
  return git(dir, "rev-parse", "HEAD");
}

function fetch({ solo, locales }) {
  const env = { ...process.env, DOCS_LOCAL_REPOS: Object.entries(locales).map(([id, d]) => `${id}=${d}`).join(",") };
  delete env.DOCS_GITHUB_TOKEN;
  delete env.DOCS_STRICT;
  delete env.DOCS_SOLO_PROYECTO;
  if (solo !== undefined) env.DOCS_SOLO_PROYECTO = solo;
  return spawnSync(process.execPath, [join(SITIO(), "tools", "fetch.mjs")], { cwd: SITIO(), env, encoding: "utf8" });
}

const resumen = () => JSON.parse(readFileSync(join(OUT(), "projects.json"), "utf8"));
const entrada = (id) => resumen().projects.find((p) => p.id === id);

before(() => {
  T = mkdtempSync(join(tmpdir(), "m3-fetch-"));
  mkdirSync(SITIO(), { recursive: true });
  cpSync(join(RAIZ, "tools"), join(SITIO(), "tools"), { recursive: true });
  // tools/neutralizar.mjs importa satteri: enlaza node_modules del repo (junction en Windows, no pide permisos).
  symlinkSync(join(RAIZ, "node_modules"), join(SITIO(), "node_modules"), process.platform === "win32" ? "junction" : "dir");
  writeFileSync(join(SITIO(), "package.json"), JSON.stringify({ type: "module", private: true }));
  writeFileSync(join(SITIO(), "projects.json"), JSON.stringify(PROYECTOS));
});

after(() => {
  // Primero el enlace: nunca borrar recursivamente a través de él.
  try { unlinkSync(join(SITIO(), "node_modules")); } catch {}
  rmSync(T, { recursive: true, force: true });
});

function inicial() {
  const a = repo("a", { "openwiki/index.md": "# A\n\nInicio de A.\n", "openwiki/viejo.md": "# Viejo\n\nSe borrará.\n", "docs/arch/viejo.html": "<title>Viejo · Diagrama</title>" });
  const b = repo("b", { "openwiki/index.md": "# B\n\nInicio de B.\n" });
  rmSync(OUT(), { recursive: true, force: true });
  const r = fetch({ locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  return { a, b };
}

test("sin DOCS_SOLO_PROYECTO: construye todos y borra restos de .content (como en Vercel)", () => {
  const { a, b } = inicial();
  escribir(OUT(), "docs/fantasma/x.md", "resto");
  const r = fetch({ locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(entrada("a").sha && entrada("b").sha);
  assert.equal(existsSync(join(OUT(), "docs", "fantasma")), false);
});

test("DOCS_SOLO_PROYECTO=a: rehace a y conserva b desde .content sin volver a traerlo", () => {
  const { a, b } = inicial();
  const antesB = entrada("b");
  const nuevoSha = commit(a, { "openwiki/nuevo.md": "# Nuevo\n\nPágina nueva.\n" }, ["openwiki/viejo.md", "docs/arch/viejo.html"]);
  // Marca en b: si fetch lo reconstruyera, se borraría (conservar exige que su sha siga siendo el HEAD remoto).
  escribir(OUT(), "docs/b/marca.md", "marca");
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(entrada("a").sha, nuevoSha);
  assert.ok(existsSync(join(OUT(), "docs", "a", "nuevo.md")));
  assert.equal(existsSync(join(OUT(), "docs", "a", "viejo.md")), false, "borra las páginas viejas de a");
  assert.equal(existsSync(join(OUT(), "arch", "a", "viejo.html")), false, "borra los diagramas viejos de a");
  assert.deepEqual(entrada("b"), antesB, "b sale tal cual de la caché");
  assert.ok(existsSync(join(OUT(), "docs", "b", "marca.md")), "b no se reconstruyó");
  assert.ok(existsSync(join(OUT(), "docs", "b", "index.md")));
  assert.ok(existsSync(join(OUT(), "data", "b.json")));
});

test("DOCS_SOLO_PROYECTO: sin .content previo cae a descarga completa", () => {
  const { a, b } = inicial();
  rmSync(OUT(), { recursive: true, force: true });
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(entrada("a").sha && entrada("b").sha && !entrada("b").error);
});

test("DOCS_SOLO_PROYECTO: si a otro proyecto le falta su data/<id>.json, lo vuelve a traer", () => {
  const { a, b } = inicial();
  rmSync(join(OUT(), "data", "b.json"));
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(OUT(), "data", "b.json")));
  assert.ok(!entrada("b").error);
});

test("DOCS_SOLO_PROYECTO: si otro proyecto quedó con error en la caché, lo vuelve a traer", () => {
  const a = repo("a", { "openwiki/index.md": "# A\n" });
  const b = repo("b", { "openwiki/index.md": "# B\n" });
  rmSync(OUT(), { recursive: true, force: true });
  assert.equal(fetch({ locales: { a, b: NO_EXISTE() } }).status, 0);
  assert.ok(entrada("b").error, "precondición: b con error");
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!entrada("b").error && entrada("b").sha);
});

test("DOCS_SOLO_PROYECTO vacío se comporta como sin variable", () => {
  const { a, b } = inicial();
  escribir(OUT(), "docs/fantasma/x.md", "resto");
  const r = fetch({ solo: "", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(OUT(), "docs", "fantasma")), false);
});

test("DOCS_SOLO_PROYECTO con un id que no está en projects.json: falla sin tocar .content", () => {
  const { a, b } = inicial();
  const antes = readFileSync(join(OUT(), "projects.json"), "utf8");
  for (const malo of ["zzz", "a; rm -rf /", "../a"]) {
    const r = fetch({ solo: malo, locales: { a, b } });
    assert.equal(r.status, 1, JSON.stringify(malo));
    assert.match(r.stderr, /DOCS_SOLO_PROYECTO/);
    assert.doesNotMatch(r.stderr, /rm -rf/, "no repite la entrada");
    assert.equal(readFileSync(join(OUT(), "projects.json"), "utf8"), antes);
  }
});

test("editoresDocs no se copia a .content (no llega al sitio)", () => {
  inicial();
  assert.doesNotMatch(readFileSync(join(OUT(), "projects.json"), "utf8"), /editoresDocs/);
  assert.doesNotMatch(readFileSync(join(OUT(), "data", "a.json"), "utf8"), /editoresDocs/);
});

// Conservar desde la caché exige que el sha guardado siga siendo el HEAD remoto de la rama (git ls-remote; aquí, repos locales).
test("DOCS_SOLO_PROYECTO: si el HEAD remoto de otro proyecto avanzó, lo reconstruye", () => {
  const { a, b } = inicial();
  const shaViejo = entrada("b").sha;
  const shaNuevo = commit(b, { "openwiki/nuevo.md": "# Nuevo B\n\nCambió.\n" });
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(shaViejo, shaNuevo);
  assert.equal(entrada("b").sha, shaNuevo);
  assert.ok(existsSync(join(OUT(), "docs", "b", "nuevo.md")));
});

test("DOCS_SOLO_PROYECTO: si el sha coincide con el HEAD remoto, conserva sin reconstruir", () => {
  const { a, b } = inicial();
  escribir(OUT(), "docs/b/marca.md", "marca");
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(OUT(), "docs", "b", "marca.md")));
  assert.match(r.stdout, /b: desde caché/);
});

test("DOCS_SOLO_PROYECTO: si ls-remote falla, reconstruye (aquí queda con error al no poder traerlo)", () => {
  const { a } = inicial();
  escribir(OUT(), "docs/b/marca.md", "marca");
  const r = fetch({ solo: "a", locales: { a, b: NO_EXISTE() } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /b: desde caché/);
  assert.match(r.stderr, /b: ls-remote falló/);
  assert.equal(existsSync(join(OUT(), "docs", "b", "marca.md")), false);
  assert.ok(entrada("b").error);
});

test("DOCS_SOLO_PROYECTO: si falta una página de docs/<id>/ de otro proyecto, lo reconstruye", () => {
  const { a, b } = inicial();
  rmSync(join(OUT(), "docs", "b", "index.md"));
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(OUT(), "docs", "b", "index.md")));
  assert.doesNotMatch(r.stdout, /b: desde caché/);
});

test("DOCS_SOLO_PROYECTO: si falta un diagrama de arch/<id>/ de otro proyecto, lo reconstruye", () => {
  const a = repo("a", { "openwiki/index.md": "# A\n" });
  const b = repo("b", { "openwiki/index.md": "# B\n", "docs/arch/d.html": "<title>D · Diagrama</title>" });
  rmSync(OUT(), { recursive: true, force: true });
  assert.equal(fetch({ locales: { a, b } }).status, 0);
  assert.ok(existsSync(join(OUT(), "arch", "b", "d.html")));
  rmSync(join(OUT(), "arch", "b", "d.html"));
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(OUT(), "arch", "b", "d.html")));
  assert.doesNotMatch(r.stdout, /b: desde caché/);
});

test("DOCS_SOLO_PROYECTO: entradas vacías (sin sha) se reconstruyen", () => {
  const a = repo("a", { "openwiki/index.md": "# A\n" });
  const b = repo("b", { "README.md": "sin docs\n" });
  rmSync(OUT(), { recursive: true, force: true });
  assert.equal(fetch({ locales: { a, b } }).status, 0);
  assert.ok(entrada("b").empty);
  const r = fetch({ solo: "a", locales: { a, b } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /b: desde caché/);
  assert.ok(entrada("b").empty);
});
