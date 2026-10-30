// Estado de proyectos que no se pudieron construir (lote 4b-2): lógica pura en tools/estado.mjs.
// Lo que se muestra nunca incluye el mensaje crudo de git ni tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const RUTA = new URL("../tools/estado.mjs", import.meta.url);
const cargar = async () => {
  assert.ok(existsSync(RUTA), "falta tools/estado.mjs");
  return import(RUTA);
};

test("CAUSAS: lista cerrada", async () => {
  const { CAUSAS } = await cargar();
  assert.deepEqual(CAUSAS, ["sin-token", "sin-acceso", "rama", "red", "datos", "vacio", "desconocido"]);
});

test("clasificarError: autenticación depende de si hay token", async () => {
  const { clasificarError } = await cargar();
  for (const m of [
    "fatal: Authentication failed for 'https://github.com/o/r.git/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "remote: Repository not found.\nfatal: repository 'https://github.com/o/r.git/' not found",
    "fatal: unable to access 'https://github.com/o/r.git/': The requested URL returned error: 403",
  ]) {
    assert.equal(clasificarError(m, { token: false }), "sin-token", m);
    assert.equal(clasificarError(new Error(m), { token: true }), "sin-acceso", m);
  }
});

test("clasificarError: rama, red, datos y desconocido", async () => {
  const { clasificarError } = await cargar();
  assert.equal(clasificarError("warning: Could not find remote branch x\nfatal: Remote branch docs/x not found in upstream origin", {}), "rama");
  assert.equal(clasificarError("fatal: couldn't find remote ref refs/heads/x", {}), "rama");
  assert.equal(clasificarError("error: pathspec 'main' did not match any file(s) known to git", {}), "rama");
  assert.equal(clasificarError("fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com", {}), "red");
  assert.equal(clasificarError("Connection timed out", {}), "red");
  assert.equal(clasificarError(Object.assign(new Error("connect ECONNRESET"), {}), {}), "red");
  assert.equal(clasificarError("fetch-pack: unexpected disconnect while reading sideband packet\nfatal: early EOF", {}), "red");
  assert.equal(clasificarError(new SyntaxError("Unexpected token } in JSON at position 10"), {}), "datos");
  assert.equal(clasificarError("algo raro", {}), "desconocido");
  assert.equal(clasificarError(undefined, {}), "desconocido");
  assert.equal(clasificarError(null), "desconocido");
});

test("clasificarError: autenticación gana a red (orden)", async () => {
  const { clasificarError } = await cargar();
  assert.equal(clasificarError("unable to access: The requested URL returned error: 401 Connection reset", { token: true }), "sin-acceso");
});

const BUILT = "2026-10-29T16:05:00.000Z";
const base = { id: "px", name: "Proyecto X", repo: "o/px", branch: "main" };

test("tarjetaEstado: forma, título y cuándo", async () => {
  const { tarjetaEstado } = await cargar();
  const t = tarjetaEstado({ ...base, error: true, causa: "sin-token" }, BUILT);
  assert.equal(t.estado, "error");
  assert.equal(t.causa, "sin-token");
  assert.equal(t.titulo, "No se pudo construir");
  assert.match(t.que, /o\/px/);
  assert.match(t.cuando, /^Último intento: .*2026/);
  assert.ok(Array.isArray(t.hacer) && t.hacer.length >= 1);
  assert.ok(t.hacer.some((h) => h.includes("DOCS_GITHUB_TOKEN")));
  assert.equal(tarjetaEstado({ ...base, error: true, causa: "red" }, "no es fecha").cuando, "Fecha desconocida");
});

test("tarjetaEstado: cada causa tiene su qué y su qué hacer", async () => {
  const { tarjetaEstado, CAUSAS } = await cargar();
  const ques = new Set();
  for (const causa of CAUSAS) {
    const p = causa === "vacio" ? { ...base, empty: true, causa } : { ...base, error: true, causa };
    const t = tarjetaEstado(p, BUILT);
    assert.equal(t.causa, causa);
    assert.equal(t.estado, causa === "vacio" ? "vacio" : "error");
    assert.ok(t.que.length > 10, causa);
    assert.ok(t.hacer.length >= 1 && t.hacer.every((h) => typeof h === "string" && h.length > 5), causa);
    ques.add(t.que);
  }
  assert.equal(ques.size, CAUSAS.length, "cada causa explica algo distinto");
  assert.match(tarjetaEstado({ ...base, error: true, causa: "rama" }, BUILT).que, /main/);
  assert.ok(tarjetaEstado({ ...base, error: true, causa: "rama" }, BUILT).hacer.some((h) => h.includes("projects.json")));
  assert.equal(tarjetaEstado({ ...base, empty: true, causa: "vacio" }, BUILT).titulo, "Sin documentación aún");
});

test("tarjetaEstado: causa ausente o desconocida", async () => {
  const { tarjetaEstado } = await cargar();
  assert.equal(tarjetaEstado({ ...base, error: true }, BUILT).causa, "desconocido");
  assert.equal(tarjetaEstado({ ...base, error: true, causa: "<script>" }, BUILT).causa, "desconocido");
  assert.equal(tarjetaEstado({ ...base, empty: true }, BUILT).causa, "vacio");
});

test("tarjetaEstado: nunca muestra el mensaje crudo ni tokens", async () => {
  const { tarjetaEstado } = await cargar();
  const message = "fatal: unable to access 'https://x-access-token:ghp_SECRETO123@github.com/o/px.git/': error: 403";
  const t = tarjetaEstado({ ...base, error: true, causa: "sin-acceso", message }, BUILT);
  const todo = JSON.stringify(t);
  for (const x of ["ghp_", "x-access-token", "fatal:", "SECRETO", message]) assert.ok(!todo.includes(x), x);
});

test("tarjetaEstado: ramas pendientes en vacío, filtradas y hasta 5", async () => {
  const { tarjetaEstado } = await cargar();
  const ramas = ["docs/claude-wiki", "docs/a b", "docs/<img>", "docs/x\x1b[31m", "docs/1", "docs/2", "docs/3", "docs/4", "docs/5"];
  const todo = tarjetaEstado({ ...base, empty: true, causa: "vacio", ramas }, BUILT).hacer.join("\n");
  assert.ok(todo.includes("docs/claude-wiki"));
  for (const mala of ["docs/a b", "<img>", "\x1b"]) assert.ok(!todo.includes(mala), mala);
  assert.ok(todo.includes("docs/4"));
  assert.ok(!todo.includes("docs/5"), "máximo 5 ramas");
  // Ramas que no son arreglo no rompen.
  assert.ok(tarjetaEstado({ ...base, empty: true, ramas: "docs/x" }, BUILT).hacer.length >= 1);
});

test("limpiarControl: quita C0, DEL y C1 (incluye ESC y CSI)", async () => {
  const { limpiarControl } = await cargar();
  assert.equal(limpiarControl("paso \x1b[31mrojo\x1b[0m\x07 ok\x7f\x9b2J\nfin\ttab\x00"), "paso [31mrojo[0m ok2Jfintab");
  assert.equal(limpiarControl("ñandú · “ok” ✓"), "ñandú · “ok” ✓");
  assert.equal(limpiarControl(undefined), "");
  assert.equal(limpiarControl(5), "");
});
