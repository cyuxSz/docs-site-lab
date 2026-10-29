// Vista previa de citas: qué enlaces son citas al código y qué líneas se incrustan en el build (tools/citas.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCita, extraerLineas, citasDe } from "../tools/citas.mjs";

const REPO = "https://github.com/o/r";
const SHA = "3f2820a87a1aacf4b8de9b31cb0906d46a8d2038";
const url = (rest) => `${REPO}/blob/${SHA}/${rest}`;

test("parseCita: rango, línea suelta y rango invertido", () => {
  assert.deepEqual(parseCita(url("src/uuv_master/a.py#L11-L18"), REPO, SHA), { file: "src/uuv_master/a.py", start: 11, end: 18, key: "src/uuv_master/a.py#L11-L18" });
  assert.deepEqual(parseCita(url("src/a.cpp#L5"), REPO, SHA), { file: "src/a.cpp", start: 5, end: 5, key: "src/a.cpp#L5-L5" });
  assert.deepEqual(parseCita(url("src/a.cpp#L9-L3"), REPO, SHA), { file: "src/a.cpp", start: 3, end: 9, key: "src/a.cpp#L3-L9" });
});

test("parseCita: decodifica la ruta", () => {
  assert.equal(parseCita(url("src/con%20espacio.py#L1"), REPO, SHA).file, "src/con espacio.py");
});

test("parseCita: no es cita si falta el ancla de líneas, es otro repo/commit o la ruta sale del repo", () => {
  assert.equal(parseCita(url("src/a.py"), REPO, SHA), null);
  assert.equal(parseCita(url("src/a.py#readme"), REPO, SHA), null);
  assert.equal(parseCita(`https://github.com/otro/r/blob/${SHA}/src/a.py#L1`, REPO, SHA), null);
  assert.equal(parseCita(`${REPO}/blob/otrosha/src/a.py#L1`, REPO, SHA), null);
  assert.equal(parseCita(url("../../etc/passwd#L1"), REPO, SHA), null);
  assert.equal(parseCita("/uuv/packages/#L1", REPO, SHA), null);
});

const FILE = ["uno", "  dos", "\ttres", "cuatro", "cinco"].join("\r\n") + "\r\n";

test("extraerLineas: devuelve las líneas exactas (1-based, inclusivo) sin \\r", () => {
  assert.deepEqual(extraerLineas(FILE, 2, 3), { start: 2, end: 3, lines: ["  dos", "\ttres"], truncated: false });
});

test("extraerLineas: recorta el final al tamaño del archivo y da null si empieza fuera", () => {
  assert.deepEqual(extraerLineas(FILE, 4, 99), { start: 4, end: 5, lines: ["cuatro", "cinco"], truncated: false });
  assert.equal(extraerLineas(FILE, 50, 60), null);
  assert.equal(extraerLineas(FILE, 0, 2), null);
});

test("extraerLineas: corta a max líneas y lo marca", () => {
  assert.deepEqual(extraerLineas(FILE, 1, 5, 2), { start: 1, end: 2, lines: ["uno", "  dos"], truncated: true });
});

test("citasDe: junta las citas únicas de un Markdown ya reescrito, ignorando enlaces que no son citas", () => {
  const md = [
    `Ver [launch](${url("src/l.py#L11-L18")}) y [otra vez](${url("src/l.py#L11-L18")}).`,
    `El [ASMC](${url("src/asmc.cpp#L40")}) y la [página](/uuv/packages/uuv_control/).`,
    `Sin líneas: [archivo](${url("src/l.py")}).`,
  ].join("\n");
  assert.deepEqual(
    citasDe(md, REPO, SHA).map((c) => c.key),
    ["src/l.py#L11-L18", "src/asmc.cpp#L40-L40"],
  );
});
