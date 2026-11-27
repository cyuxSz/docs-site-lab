// Lote e-integrados · criterios 6, 9 y 10: entradas inválidas (código 1, mensaje legible, nada escrito), generador con solo la
// biblioteca estándar, y el ejemplo versionado con su sección del README.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  GENERADOR, PYTHON, RAIZ, SIN_PYTHON, analizar, archivos, carpetaTemporal, correr, existsSync, generar, join, leerBiblioteca, leerSvg,
  readFileSync, writeFileSync,
} from "./fixtures/integrados.mjs";

// Una entrada inválida termina con 1, explica el problema en stderr (`error: <archivo>…`), no enseña una traza y no escribe nada.
function rechaza(nombre, contenido, patron, que) {
  const r = generar(nombre, contenido);
  assert.equal(r.codigo, 1, `${que}: debía salir con 1 (salió con ${r.codigo}); stderr: ${r.error}`);
  assert.match(r.error, /^error: /m, `${que}: el mensaje empieza por «error: »`);
  assert.ok(r.error.includes(nombre), `${que}: el mensaje nombra el archivo de entrada`);
  assert.match(r.error, patron, `${que}: mensaje esperado ${patron}; stderr: ${r.error}`);
  assert.doesNotMatch(r.error, /Traceback|File ".*", line \d+/, `${que}: sin traza de Python`);
  assert.deepEqual(archivos(r.dir), [], `${que}: no deja archivos a medias`);
  return r;
}

const CAB = "integrado,pin,nombre,lado,tipo\n";

// ── Criterio 6: errores ─────────────────────────────────────────────────────────────────────────────────────────────
test("errores CSV: faltan columnas obligatorias o sobra una desconocida", SIN_PYTHON, () => {
  rechaza("a.csv", "integrado,pin,nombre\nU1,1,A\n", /lado/, "sin la columna lado");
  rechaza("a.csv", "chip;pin;nombre;lado\nU1;1;A;izquierda\n", /integrado/, "separador punto y coma: no encuentra las columnas");
  rechaza("a.csv", "integrado,pin,nombre,lado,tpo\nU1,1,A,izquierda,entrada\n", /tpo/, "columna desconocida");
  rechaza("a.csv", "integrado,pin,nombre,lado,lado\nU1,1,A,izquierda,derecha\n", /lado/, "columna repetida");
  rechaza("a.csv", "", /vac/i, "archivo vacío");
  rechaza("a.csv", CAB, /pin/i, "solo cabecera, ningún pin");
});

test("errores CSV: pin duplicado, con el número de línea y el pin en el mensaje", SIN_PYTHON, () => {
  const r = rechaza("a.csv", `${CAB}U1,1,A,izquierda,\nU2,1,A,izquierda,\nU1,2,B,derecha,\nU1,1,C,derecha,\n`, /duplicad|repetid/i, "pin duplicado");
  assert.ok(r.error.includes("a.csv:5:"), "indica la línea 5 como «a.csv:5:»");
  assert.match(r.error, /U1/);
});

test("errores CSV: lado o tipo desconocidos, campos vacíos, filas con columnas de más y caracteres de control", SIN_PYTHON, () => {
  rechaza("a.csv", `${CAB}U1,1,A,centro,\n`, /a\.csv:2:.*centro/s, "lado desconocido");
  rechaza("a.csv", `${CAB}U1,1,A,izquierda,analogico\n`, /a\.csv:2:.*analogico/s, "tipo desconocido");
  rechaza("a.csv", `${CAB}U1,1,A,izquierda,\nU1,,B,izquierda,\n`, /a\.csv:3:/, "número de pin vacío");
  rechaza("a.csv", `${CAB}U1,1,,izquierda,\n`, /a\.csv:2:/, "nombre de pin vacío");
  rechaza("a.csv", `${CAB},1,A,izquierda,\n`, /a\.csv:2:/, "integrado vacío");
  rechaza("a.csv", `${CAB}U1,1,A,izquierda,entrada,extra\n`, /a\.csv:2:/, "fila con una columna de más");
  rechaza("a.csv", `${CAB}U1,1,A\n`, /a\.csv:2:/, "fila con columnas de menos");
  rechaza("a.csv", `${CAB}U1,1,A\u0001B,izquierda,\n`, /a\.csv:2:.*control/is, "carácter de control (no se puede escribir en XML)");
  rechaza("a.csv", Buffer.from([...Buffer.from(CAB), 0x55, 0x31, 0x2c, 0x31, 0x2c, 0xff, 0xfe, 0x2c]), /UTF-8/i, "bytes que no son UTF-8");
});

test("errores CSV: dos integrados cuyo SVG se llamaría igual", SIN_PYTHON, () => {
  rechaza("a.csv", `${CAB}NE555,1,A,izquierda,\nne555,1,A,izquierda,\n`, /ne555/, "slugs iguales");
  rechaza("a.csv", `${CAB}///,1,A,izquierda,\n`, /a\.csv:2:/, "nombre sin ninguna letra ni número");
});

const pin = (nombre, numero, extra = "") =>
  `(pin input line (at -5.08 0 0) (length 2.54) (name "${nombre}" (effects (font (size 1.27 1.27)))) (number "${numero}" (effects (font (size 1.27 1.27))))${extra})`;
const lib = (cuerpo) => `(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor")\n${cuerpo}\n)\n`;

test("errores kicad_sym: archivo mal formado", SIN_PYTHON, () => {
  const bueno = lib(`(symbol "U1" (symbol "U1_1_1" ${pin("A", "1")}))`);
  rechaza("l.kicad_sym", bueno.slice(0, -3), /par[eé]ntesis/i, "paréntesis sin cerrar");
  rechaza("l.kicad_sym", `${bueno})`, /par[eé]ntesis/i, "paréntesis de más");
  rechaza("l.kicad_sym", bueno.replace('"U1_1_1"', '"U1_1_1'), /comilla|cadena/i, "cadena sin cerrar");
  rechaza("l.kicad_sym", "", /vac/i, "archivo vacío");
  rechaza("l.kicad_sym", "hola, esto no es KiCad\n", /kicad_symbol_lib/, "no es una S-expresión");
  rechaza("l.kicad_sym", `(kicad_sch (version 20231120) (symbol "U1" (symbol "U1_1_1" ${pin("A", "1")})))`, /kicad_symbol_lib/, "otro tipo de archivo de KiCad");
  rechaza("l.kicad_sym", lib(""), /s[ií]mbolo|pin/i, "biblioteca sin ningún símbolo con pines");
});

test("errores kicad_sym: pin sin número o sin posición, pin duplicado, ángulo inválido y `extends` sin padre", SIN_PYTHON, () => {
  rechaza("l.kicad_sym", lib(`(symbol "U1" (symbol "U1_1_1" (pin input line (at 0 0 0) (length 2.54) (name "A"))))`), /U1/, "pin sin (number …)");
  rechaza("l.kicad_sym", lib(`(symbol "U1" (symbol "U1_1_1" (pin input line (length 2.54) (name "A") (number "1"))))`), /U1/, "pin sin (at …)");
  rechaza("l.kicad_sym", lib(`(symbol "U1" (symbol "U1_1_1" ${pin("A", "7")} ${pin("B", "7")}))`), /(duplicad|repetid).*7|7.*(duplicad|repetid)/is, "pin duplicado");
  rechaza("l.kicad_sym", lib(`(symbol "U1" (symbol "U1_1_1" (pin input line (at 0 0 45) (length 2.54) (name "A") (number "1"))))`), /45/, "ángulo que no es 0, 90, 180 o 270");
  rechaza("l.kicad_sym", lib(`(symbol "HIJO" (extends "NO_EXISTE"))`), /NO_EXISTE/, "extends a un símbolo que no está");
});

test("errores kicad_sym: un anidamiento enorme da un error legible, no un RecursionError", SIN_PYTHON, () => {
  const n = 200_000;
  rechaza("l.kicad_sym", `(kicad_symbol_lib ${"(".repeat(n)}${")".repeat(n)})`, /anidad|profund/i, "200 000 niveles");
});

test("errores de entrada: archivo que no existe, extensión desconocida y carpeta en lugar de archivo", SIN_PYTHON, () => {
  const base = carpetaTemporal();
  const dir = join(base, "salida");
  for (const [entrada, patron] of [[join(base, "no-existe.csv"), /no existe|no se encontr/i], [join(base, "tabla.txt"), /\.csv.*\.kicad_sym/s], [base, /./]]) {
    if (entrada.endsWith(".txt")) writeFileSync(entrada, "integrado,pin,nombre,lado\nU1,1,A,izquierda\n");
    const r = correr(["--entrada", entrada, "--salida", dir]);
    assert.equal(r.codigo, 1, `${entrada}: código 1; stderr: ${r.error}`);
    assert.match(r.error, /^error: /m);
    assert.match(r.error, patron);
    assert.doesNotMatch(r.error, /Traceback/);
    assert.ok(!existsSync(dir), "no crea la carpeta de salida si la entrada es inválida");
  }
});

// ── Criterio 9: solo biblioteca estándar ────────────────────────────────────────────────────────────────────────────
// El detector (imports, nombres sueltos y accesos por atributo) vive en tests/fixtures/integrados.mjs; el lote e-seguimiento lo
// prueba además contra fragmentos sintéticos en tests/e-seguimiento.test.mjs.
test("solo biblioteca estándar: ningún import de terceros ni relativo, y nada de red, procesos, eval o pickle", SIN_PYTHON, () => {
  assert.ok(existsSync(GENERADOR), "falta tools/integrados.py (el generador todavía no existe)");
  const r = analizar(readFileSync(GENERADOR, "utf8"));
  assert.deepEqual(r.ajenos, [], "imports fuera de la biblioteca estándar");
  const prohibidos = ["subprocess", "socket", "urllib", "http", "ssl", "ftplib", "pickle", "marshal", "shelve", "ctypes"];
  assert.deepEqual(r.modulos.filter((m) => prohibidos.includes(m)), [], "módulos que el generador no necesita");
  assert.deepEqual(r.prohibido, [], "procesos, ejecución dinámica o acceso indirecto a módulos (por nombre, por atributo o por import)");
});

test("solo biblioteca estándar: corre aislado (-I -S), sin site-packages", SIN_PYTHON, () => {
  assert.ok(existsSync(GENERADOR), "falta tools/integrados.py (el generador todavía no existe)");
  const r = spawnSync(PYTHON, ["-I", "-S", GENERADOR, "--ayuda"], { encoding: "utf8", timeout: 60_000, windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
});

// ── Criterio 10: ejemplo y README ───────────────────────────────────────────────────────────────────────────────────
test("ejemplo: tools/ejemplos/ne555.csv y ne555.kicad_sym generan el mismo integrado de 8 pines", SIN_PYTHON, () => {
  const pines = {};
  for (const ext of ["csv", "kicad_sym"]) {
    const entrada = join(RAIZ, "tools", "ejemplos", `ne555.${ext}`);
    assert.ok(existsSync(entrada), `falta tools/ejemplos/ne555.${ext}`);
    const dir = join(carpetaTemporal(), "salida");
    const r = correr(["--entrada", entrada, "--salida", dir]);
    assert.equal(r.codigo, 0, r.error);
    assert.deepEqual(archivos(dir), ["ne555.svg", "ne555.xml"]);
    assert.deepEqual(leerBiblioteca(join(dir, "ne555.xml")).map((e) => e.title), ["NE555"]);
    pines[ext] = leerSvg(join(dir, "ne555.svg")).pines.map((p) => `${p.numero}:${p.nombre}`).sort();
  }
  assert.equal(pines.csv.length, 8);
  assert.deepEqual(pines.kicad_sym, pines.csv, "los dos ejemplos describen los mismos pines");
  assert.deepEqual(pines.csv.map((p) => p.split(":")[0]), ["1", "2", "3", "4", "5", "6", "7", "8"]);
});

test("ejemplo: no se versiona salida generada junto a los ejemplos", () => {
  const dir = join(RAIZ, "tools", "ejemplos");
  assert.ok(existsSync(dir), "falta tools/ejemplos/");
  assert.deepEqual(archivos(dir).filter((f) => /\.(xml|svg)$/.test(f)), [], "la biblioteca y los SVG se regeneran; no van al repo");
});

test("README: sección «Biblioteca de integrados» con el comando, el formato del CSV y cómo abrirla en diagrams.net", () => {
  const readme = readFileSync(join(RAIZ, "README.md"), "utf8");
  const m = /^## Biblioteca de integrados[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme);
  assert.ok(m, "falta la sección «## Biblioteca de integrados»");
  const s = m[1];
  assert.match(s, /tools\/integrados\.py/);
  assert.match(s, /--entrada/);
  assert.match(s, /--salida/);
  assert.match(s, /tools\/ejemplos\/ne555\.csv/);
  assert.match(s, /\.kicad_sym/);
  for (const col of ["integrado", "pin", "nombre", "lado", "tipo"]) assert.ok(s.includes(`\`${col}\``), `documenta la columna ${col}`);
  for (const lado of ["izquierda", "derecha", "arriba", "abajo"]) assert.ok(s.includes(lado), `documenta el lado ${lado}`);
  assert.match(s, /Abrir biblioteca/, "explica «Archivo › Abrir biblioteca» de diagrams.net");
  assert.match(s, /Python 3\.10/);
  assert.ok(s.split("\n").length <= 40, "la sección es corta (40 líneas como mucho)");
});
