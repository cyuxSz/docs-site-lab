// Lote e-integrados · criterios 1 a 3: la CLI de tools/integrados.py y sus dos entradas (CSV de pines y .kicad_sym).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SIN_PYTHON, archivos, carpetaTemporal, correr, existsSync, generar, generarBien, join, leerBiblioteca, leerSvg, resumen,
  writeFileSync,
} from "./fixtures/integrados.mjs";

const CSV_DOS = [
  "integrado,pin,nombre,lado,tipo",
  "NE555,1,GND,izquierda,alimentacion",
  "NE555,2,TRIG,izquierda,entrada",
  "NE555,3,OUT,derecha,salida",
  "NE555,8,VCC,arriba,alimentacion",
  "LM358,1,OUTA,derecha,salida",
  "NE555,4,RESET,abajo,",
  "LM358,2,IN-,izquierda,",
  "",
].join("\n");

// ── Criterio 1: CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
test("CLI: --ayuda y -h salen con 0 y explican --entrada y --salida en español", SIN_PYTHON, () => {
  for (const opcion of ["--ayuda", "-h"]) {
    const r = correr([opcion]);
    assert.equal(r.codigo, 0, `${opcion} debe salir con 0; stderr: ${r.error}`);
    assert.match(r.salida, /--entrada/);
    assert.match(r.salida, /--salida/);
    assert.match(r.salida, /\.kicad_sym/, "la ayuda nombra los dos formatos de entrada");
    assert.match(r.salida, /\.csv|CSV/);
    assert.match(r.salida, /^uso:/im, "la ayuda empieza por «uso:»");
    assert.doesNotMatch(r.salida, /usage:|options:|optional arguments|show this help/i, "sin los textos en inglés de argparse");
  }
});

test("CLI: sin argumentos o con una opción desconocida sale con 2 y un mensaje en español, sin traza", SIN_PYTHON, () => {
  for (const args of [[], ["--entrada", "x.csv"], ["--entrada", "x.csv", "--salida", "y", "--nope"]]) {
    const r = correr(args);
    assert.equal(r.codigo, 2, `args ${JSON.stringify(args)}: código 2 (uso)`);
    assert.match(r.error, /^error: /m);
    assert.doesNotMatch(r.error, /Traceback|the following arguments|unrecognized arguments/);
  }
});

test("CLI: crea la carpeta de salida y escribe <base>.xml y un <slug>.svg por integrado, nada más", SIN_PYTHON, () => {
  const base = carpetaTemporal();
  const entrada = join(base, "Mis Chips.csv");
  writeFileSync(entrada, CSV_DOS);
  const dir = join(base, "a", "b", "salida");
  const r = correr(["--entrada", entrada, "--salida", dir]);
  assert.equal(r.codigo, 0, r.error);
  assert.deepEqual(archivos(dir), ["Mis Chips.xml", "lm358.svg", "ne555.svg"].sort());
  assert.equal(r.error, "", "sin avisos en stderr cuando todo va bien");
});

// ── Criterio 2: CSV ─────────────────────────────────────────────────────────────────────────────────────────────────
test("CSV: una entrada por integrado en orden de aparición; pines por lado y, dentro del lado, en orden de archivo", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV_DOS);
  const bib = leerBiblioteca(join(r.dir, "chips.xml"));
  assert.deepEqual(bib.map((e) => e.title), ["NE555", "LM358"]);
  assert.deepEqual(resumen(leerSvg(join(r.dir, "ne555.svg")).pines), [
    "izquierda:1:GND:alimentacion", "izquierda:2:TRIG:entrada", "derecha:3:OUT:salida", "arriba:8:VCC:alimentacion", "abajo:4:RESET:",
  ]);
  assert.deepEqual(resumen(leerSvg(join(r.dir, "lm358.svg")).pines), ["izquierda:2:IN-:", "derecha:1:OUTA:salida"]);
});

test("CSV: `tipo` es opcional, las columnas van en cualquier orden y se toleran BOM, CRLF, espacios y mayúsculas en lado/tipo", SIN_PYTHON, () => {
  const sinTipo = generarBien("a.csv", "integrado,pin,nombre,lado\nU1,A1,D+,izquierda\nU1,A2,D-,derecha\n");
  assert.deepEqual(resumen(leerSvg(join(sinTipo.dir, "u1.svg")).pines), ["izquierda:A1:D+:", "derecha:A2:D-:"]);

  const raro = "﻿Lado , nombre,PIN,integrado,tipo\r\n Izquierda , D+ , A1 , U1 , Bidireccional \r\n\r\nDERECHA,D-,A2,U1,\r\n";
  const r = generarBien("a.csv", raro);
  assert.deepEqual(resumen(leerSvg(join(r.dir, "u1.svg")).pines), ["izquierda:A1:D+:bidireccional", "derecha:A2:D-:"]);
});

test("CSV: admite los seis tipos eléctricos documentados", SIN_PYTHON, () => {
  const tipos = ["entrada", "salida", "bidireccional", "alimentacion", "pasivo", "sin_conexion"];
  const filas = tipos.map((t, i) => `U1,${i + 1},P${i + 1},izquierda,${t}`);
  const r = generarBien("a.csv", ["integrado,pin,nombre,lado,tipo", ...filas, ""].join("\n"));
  assert.deepEqual(leerSvg(join(r.dir, "u1.svg")).pines.map((p) => p.tipo), tipos);
});

// ── Criterio 3: .kicad_sym ──────────────────────────────────────────────────────────────────────────────────────────
const pin = (tipo, x, y, angulo, nombre, numero) =>
  `(pin ${tipo} line (at ${x} ${y} ${angulo}) (length 2.54) (name "${nombre}" (effects (font (size 1.27 1.27)))) (number "${numero}" (effects (font (size 1.27 1.27)))))`;

const KICAD = `(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor")
  (symbol "NE555" (pin_names (offset 1.016)) (in_bom yes) (on_board yes)
    (property "Reference" "U" (at -10.16 8.89 0) (effects (font (size 1.27 1.27))))
    (property "Description" "Timer (555) \\"clasico\\" ) con parentesis" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "NE555_0_1"
      (rectangle (start -8.89 7.62) (end 8.89 -7.62) (stroke (width 0.254) (type default)) (fill (type background))))
    (symbol "NE555_1_1"
      ${pin("power_in", 0, -10.16, 90, "GND", "1")}
      ${pin("power_in", 0, 10.16, 270, "VCC", "8")}
      ${pin("output", 12.7, 2.54, 180, "Q", "3")}
      ${pin("input", -12.7, -5.08, 0, "THR", "6")}
      ${pin("input", -12.7, 5.08, 0, "TR", "2")}
      ${pin("open_collector", 12.7, -2.54, 180, "DIS", "7")}
      ${pin("input", -12.7, 0, 0, "CV", "5")}
      ${pin("input", 2.54, -10.16, 90, "~{R}", "4")}))
  (symbol "SoloDibujo" (in_bom no) (on_board no)
    (symbol "SoloDibujo_0_1" (polyline (pts (xy 0 0) (xy 1 1)) (stroke (width 0) (type default)) (fill (type none)))))
  (symbol "TIPOS" (in_bom yes) (on_board yes)
    (symbol "TIPOS_1_1"
      ${pin("bidirectional", -5.08, 7.62, 0, "IO", "1")}
      ${pin("passive", -5.08, 5.08, 0, "PAS", "2")}
      ${pin("no_connect", -5.08, 2.54, 0, "NC", "3")}
      ${pin("power_out", -5.08, 0, 0, "VOUT", "4")}
      ${pin("tri_state", -5.08, -2.54, 0, "TS", "5")}
      ${pin("unspecified", -5.08, -5.08, 0, "~", "6")}))
)
`;

test("kicad_sym: un integrado por símbolo con pines; el lado sale del ángulo del pin y el orden de su posición", SIN_PYTHON, () => {
  const r = generar("lib.kicad_sym", KICAD);
  assert.equal(r.codigo, 0, r.error);
  const bib = leerBiblioteca(join(r.dir, "lib.xml"));
  assert.deepEqual(bib.map((e) => e.title), ["NE555", "TIPOS"], "el símbolo sin pines se omite");
  assert.deepEqual(archivos(r.dir), ["lib.xml", "ne555.svg", "tipos.svg"]);
  // Ángulo 0 → izquierda, 180 → derecha, 270 → arriba, 90 → abajo. Izquierda y derecha de arriba abajo (y descendente en KiCad);
  // arriba y abajo de izquierda a derecha (x ascendente).
  assert.deepEqual(resumen(leerSvg(join(r.dir, "ne555.svg")).pines), [
    "izquierda:2:TR:entrada", "izquierda:5:CV:entrada", "izquierda:6:THR:entrada",
    "derecha:3:Q:salida", "derecha:7:DIS:",
    "arriba:8:VCC:alimentacion",
    "abajo:1:GND:alimentacion", "abajo:4:~{R}:entrada",
  ]);
  assert.match(r.error, /SoloDibujo/, "avisa en stderr del símbolo omitido por no tener pines");
});

test("kicad_sym: los tipos eléctricos de KiCad se traducen a los del CSV; los que no tienen equivalente quedan vacíos", SIN_PYTHON, () => {
  const r = generar("lib.kicad_sym", KICAD);
  assert.equal(r.codigo, 0, r.error);
  assert.deepEqual(resumen(leerSvg(join(r.dir, "tipos.svg")).pines), [
    "izquierda:1:IO:bidireccional", "izquierda:2:PAS:pasivo", "izquierda:3:NC:sin_conexion",
    "izquierda:4:VOUT:alimentacion", "izquierda:5:TS:", "izquierda:6:~:",
  ]);
});

test("kicad_sym: junta las unidades de un símbolo, ignora el estilo De Morgan y resuelve `extends`", SIN_PYTHON, () => {
  const lib = `(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor")
  (symbol "DOBLE" (in_bom yes) (on_board yes)
    (symbol "DOBLE_1_1" ${pin("input", -7.62, 2.54, 0, "A", "1")} ${pin("output", 7.62, 0, 180, "Y", "2")})
    (symbol "DOBLE_1_2" ${pin("input", -7.62, 2.54, 0, "A", "1")} ${pin("output", 7.62, 0, 180, "Y", "2")})
    (symbol "DOBLE_2_1" ${pin("input", -7.62, 0, 0, "B", "3")} ${pin("output", 7.62, -2.54, 180, "Z", "4")})
    (symbol "DOBLE_0_1" ${pin("power_in", 0, 7.62, 270, "VCC", "5")}))
  (symbol "DOBLE_B" (extends "DOBLE") (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27)))))
)
`;
  const r = generarBien("lib.kicad_sym", lib);
  const esperado = ["izquierda:1:A:entrada", "izquierda:3:B:entrada", "derecha:2:Y:salida", "derecha:4:Z:salida", "arriba:5:VCC:alimentacion"];
  assert.deepEqual(resumen(leerSvg(join(r.dir, "doble.svg")).pines), esperado);
  assert.deepEqual(resumen(leerSvg(join(r.dir, "doble_b.svg")).pines), esperado, "el derivado hereda los pines del padre");
  assert.deepEqual(leerBiblioteca(join(r.dir, "lib.xml")).map((e) => e.title), ["DOBLE", "DOBLE_B"]);
});

test("la extensión decide el formato sin importar mayúsculas", SIN_PYTHON, () => {
  const a = generarBien("CHIPS.CSV", "integrado,pin,nombre,lado\nU1,1,A,izquierda\n");
  assert.ok(existsSync(join(a.dir, "CHIPS.xml")));
  const b = generarBien("LIB.KICAD_SYM", KICAD);
  assert.ok(existsSync(join(b.dir, "LIB.xml")));
});
