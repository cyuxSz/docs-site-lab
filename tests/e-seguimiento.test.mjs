// Lote e-seguimiento · pendientes de la revisión del generador de integrados (tools/integrados.py):
//  1 y 2  mensajes de «CSV mal formado» en español y con la línea donde empieza el registro;
//  3      ningún carácter de control de la entrada llega a la terminal;
//  4 y 5  escritura atómica y aviso al reemplazar archivos;
//  6      detector de procesos / ejecución dinámica probado contra fragmentos sintéticos;
//  7 y 8  CSV separado por punto y coma, y su documentación;
//  9 y 10 el nombre del integrado no se encima con los rótulos laterales, y lo demás no cambia ni un byte.
// Todos ejecutan el generador y miden lo que sale (stderr, archivos, geometría), no su código.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  CONTROL, GENERADOR, RAIZ, SIN_PYTHON, analizar, archivos, carpetaTemporal, correr, correrVigilado, existsSync, generar,
  generarBien, join, ladoDePunto, leerBiblioteca, leerSvg, lineas, mkdirSync, puntos, readFileSync, writeFileSync,
} from "./fixtures/integrados.mjs";
import { cajaEtiqueta, cajaNombreCuerpo, cajaTexto, solapan, ver } from "./fixtures/integrados-geometria.mjs";

const CAB = "integrado,pin,nombre,lado\n";
const TRAZA = /Traceback|File ".*", line \d+|Errno|WinError/;
const sha = (ruta) => createHash("sha256").update(readFileSync(ruta)).digest("hex");
const bytes = (dir) => Object.fromEntries(archivos(dir).map((f) => [f, readFileSync(join(dir, f)).toString("base64")]));

// ── Criterios 1 y 2: «CSV mal formado» en español y con la línea del registro ───────────────────────────────────────
// Fragmentos de los mensajes de csv.Error de Python: no deben verse.
const INGLES = /expected|end of data|field larger|field limit|delimiter|new-?line|quote|string/i;

function malFormado(contenido, que, nombre = "a.csv") {
  const r = generar(nombre, contenido);
  assert.equal(r.codigo, 1, `${que}: debía salir con 1 (salió con ${r.codigo}); stderr: ${r.error}`);
  assert.match(r.error, /^error: /, `${que}: el mensaje empieza por «error: »`);
  assert.match(r.error, /CSV mal formado/, `${que}: sigue diciendo «CSV mal formado»; stderr: ${r.error}`);
  assert.doesNotMatch(r.error, TRAZA, `${que}: sin traza de Python`);
  assert.deepEqual(archivos(r.dir), [], `${que}: no deja archivos a medias`);
  return r;
}

test("CSV mal formado: el mensaje es texto propio en español, sin el detalle en inglés de csv.Error", SIN_PYTHON, () => {
  const casos = [
    ["texto pegado a la comilla de cierre", `${CAB}U1,1,"A"B,izquierda\n`, /comilla/i],
    ["comilla sin cerrar", `${CAB}U1,1,"A,izquierda\n`, /comilla/i],
    ["campo más largo que el límite del lector", `${CAB}U1,1,${"A".repeat(200_000)},izquierda\n`, /./],
  ];
  for (const [que, contenido, patron] of casos) {
    const r = malFormado(contenido, que);
    assert.doesNotMatch(r.error, INGLES, `${que}: el mensaje no repite el texto de la excepción de Python; stderr: ${r.error.slice(0, 300)}`);
    assert.match(r.error, patron, `${que}: explica el problema (${patron}); stderr: ${r.error.slice(0, 300)}`);
    assert.equal(lineas(r.error).length, 1, `${que}: una sola línea en stderr`);
    assert.ok(r.error.length < 400, `${que}: el mensaje no vuelca el contenido del archivo`);
  }
});

test("CSV mal formado: una comilla sin cerrar se señala en la línea donde empieza su registro, no al final del archivo", SIN_PYTHON, () => {
  const filas = ["U1,1,A,izquierda", 'U1,2,"B,derecha', "U1,3,C,derecha", "U1,4,D,derecha", "U1,5,E,derecha"];
  const r = malFormado(`${CAB}${filas.join("\n")}\n`, "cabecera + 5 filas, comilla abierta en la línea 3");
  assert.ok(r.error.includes("a.csv:3:"), `indica «a.csv:3:»; stderr: ${r.error}`);
  const crlf = malFormado(`${CAB}${filas.join("\n")}\n`.replace(/\n/g, "\r\n"), "lo mismo con CRLF");
  assert.ok(crlf.error.includes("a.csv:3:"), `con CRLF también indica «a.csv:3:»; stderr: ${crlf.error}`);
  const ultima = malFormado(`${CAB}U1,1,A,izquierda\nU1,2,B,derecha\nU1,3,"C,derecha\n`, "comilla abierta en la última línea");
  assert.ok(ultima.error.includes("a.csv:4:"), `indica «a.csv:4:»; stderr: ${ultima.error}`);
  const sinSalto = malFormado(`${CAB}U1,1,"A,izquierda\nU1,2,B,derecha`, "sin salto de línea final");
  assert.ok(sinSalto.error.includes("a.csv:2:"), `indica «a.csv:2:»; stderr: ${sinSalto.error}`);
});

test("CSV mal formado: si la comilla abierta se «cierra» líneas después, la línea es la del registro que la abrió", SIN_PYTHON, () => {
  const r = malFormado(`${CAB}U1,1,A,izquierda\nU1,2,"B,derecha\nU1,3,C,derecha\nU1,4,"D",derecha\n`, "comilla abierta en la 3, tropieza en la 5");
  assert.ok(r.error.includes("a.csv:3:"), `indica «a.csv:3:»; stderr: ${r.error}`);
  const tras = malFormado(`${CAB}U1,1,"A\nB",izquierda\nU1,2,"C"D,derecha\n`, "tras un campo válido de dos líneas, el registro malo empieza en la 4");
  assert.ok(tras.error.includes("a.csv:4:"), `indica «a.csv:4:»; stderr: ${tras.error}`);
});

// ── Criterio 3: ningún carácter de control llega a la terminal ──────────────────────────────────────────────────────
const ESC = "\u001b", CSI = "\u009b", NEL = "\u0085", DEL = "\u007f", BEL = "\u0007";
const libK = (cuerpo) => `(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor")\n${cuerpo}\n)\n`;
const pinK = (nombre, numero, at = "(at -5.08 0 0)") => `(pin input line ${at} (length 2.54) (name "${nombre}") (number "${numero}"))`;

// stdout y stderr sin caracteres de control (C0 salvo el fin de línea, DEL y C1) y, en stderr, exactamente `n` líneas.
function sinControl(r, que, n = 1) {
  for (const [flujo, texto] of [["stderr", r.error], ["stdout", r.salida]]) {
    for (const linea of lineas(texto)) {
      const m = CONTROL.exec(linea);
      assert.ok(!m, `${que}: ${flujo} lleva el carácter de control U+${(m ? m[0].codePointAt(0) : 0).toString(16).padStart(4, "0")}: ${JSON.stringify(linea)}`);
    }
  }
  assert.doesNotMatch(r.error, TRAZA, `${que}: sin traza de Python`);
  assert.equal(lineas(r.error).length, n, `${que}: ${n} línea(s) en stderr (un salto de línea de la entrada no parte el mensaje): ${JSON.stringify(r.error)}`);
}

function neutraliza(nombre, contenido, que, visible) {
  const r = generar(nombre, contenido);
  assert.equal(r.codigo, 1, `${que}: debía salir con 1 (salió con ${r.codigo}); stderr: ${JSON.stringify(r.error)}`);
  assert.match(r.error, /^error: /, `${que}: el mensaje empieza por «error: »`);
  sinControl(r, que);
  if (visible) assert.ok(r.error.includes(visible), `${que}: el carácter se ve escrito como \\xNN (${JSON.stringify(visible)}); stderr: ${JSON.stringify(r.error)}`);
  assert.deepEqual(archivos(r.dir), [], `${que}: no escribe nada`);
  return r;
}

test("control: un ESC en una columna desconocida de la cabecera del CSV sale escrito como \\x1b, no como secuencia ANSI", SIN_PYTHON, () => {
  const r = neutraliza("a.csv", `integrado,pin,nombre,lado,t${ESC}[31mpo\nU1,1,A,izquierda,entrada\n`, "columna desconocida con ESC", "t\\x1b[31mpo");
  assert.ok(r.error.includes("«") && r.error.includes("a.csv:1:"), `lo demás del mensaje no cambia (comillas angulares, archivo y línea); stderr: ${r.error}`);
  neutraliza("a.csv", `integrado,pin,nombre,lado,${ESC}]0;titulo${BEL}\nU1,1,A,izquierda,x\n`, "columna con una secuencia OSC (ESC ] … BEL)", "\\x1b]0;titulo\\x07");
});

test("control: valores de celda del CSV (lado, tipo, pin, integrado) con ESC, DEL o C1 no llegan crudos a stderr", SIN_PYTHON, () => {
  neutraliza("a.csv", `${CAB}U1,1,A,cen${ESC}[31mtro\n`, "lado desconocido con ESC");
  neutraliza("a.csv", `${CAB}U1,1,A,cen${DEL}tro\n`, "lado desconocido con DEL");
  neutraliza("a.csv", `${CAB}U1,1,A,cen${CSI}31mtro\n`, "lado desconocido con CSI de 8 bits (U+009B)", "cen\\x9b31mtro");
  neutraliza("a.csv", `${CAB.trim()},tipo\nU1,1,A,izquierda,ana${CSI}2Jlogico\n`, "tipo desconocido con U+009B", "ana\\x9b2Jlogico");
  neutraliza("a.csv", `${CAB}U${CSI}1,7${NEL}7,A,izquierda\nU${CSI}1,7${NEL}7,B,derecha\n`, "pin duplicado con C1 en el pin y en el integrado", "7\\x857");
  neutraliza("a.csv", `${CAB}NE${CSI}555,1,A,izquierda\nne${CSI}555,1,A,izquierda\n`, "dos integrados con el mismo slug y C1 en el nombre", "\\x9b");
});

test("control: nombres de símbolo, `extends`, número de pin y ángulo de un .kicad_sym no llegan crudos a stderr", SIN_PYTHON, () => {
  neutraliza("l.kicad_sym", libK(`(symbol "U${ESC}[31m1" (symbol "U1_1_1" ${pinK("A", "1")}))`), "nombre de símbolo con ESC");
  neutraliza("l.kicad_sym", libK(`(symbol "U1\\nerror: falso" (symbol "U1_1_1" ${pinK("A", "1")}))`), "nombre de símbolo con un salto de línea (\\n escapado)");
  neutraliza("l.kicad_sym", libK(`(symbol "HIJO" (extends "NO${ESC}[31mEXISTE"))`), "extends con ESC", "NO\\x1b[31mEXISTE");
  neutraliza("l.kicad_sym", libK(`(symbol "U1" (pin input line (at 0 0 0) (length 2.54) (number "1${ESC}[2J")))`), "número de pin con ESC en un pin sin nombre", "1\\x1b[2J");
  neutraliza("l.kicad_sym", libK(`(symbol "U1" ${pinK("A", "1", '(at 0 0 "45\t")')})`), "ángulo no admitido con un tabulador", "45\\x09");
  neutraliza("l.kicad_sym", libK(`(symbol "U${CSI}1" ${pinK("A", "1")}) (symbol "U${CSI}1" ${pinK("A", "1")})`), "símbolo duplicado con U+009B", "U\\x9b1");
});

test("control: el aviso de un símbolo sin pines también se neutraliza", SIN_PYTHON, () => {
  const r = generar("l.kicad_sym", libK(`(symbol "U1" ${pinK("A", "1")}) (symbol "Solo${CSI}31mDibujo" (property "Value" "x"))`));
  assert.equal(r.codigo, 0, `debía generar U1 y avisar del otro; stderr: ${JSON.stringify(r.error)}`);
  sinControl(r, "aviso de símbolo sin pines con U+009B");
  assert.match(r.error, /^aviso: /);
  assert.ok(r.error.includes("Solo\\x9b31mDibujo"), `el nombre sale con el carácter escrito como \\x9b; stderr: ${JSON.stringify(r.error)}`);
});

test("control: las rutas y opciones de la línea de comandos tampoco pasan caracteres de control", SIN_PYTHON, () => {
  const base = carpetaTemporal();
  const dir = join(base, "salida");
  const noExiste = correr(["--entrada", join(base, `no${ESC}[31mexiste.csv`), "--salida", dir]);
  assert.equal(noExiste.codigo, 1, `entrada inexistente: código 1; stderr: ${JSON.stringify(noExiste.error)}`);
  sinControl(noExiste, "--entrada inexistente con ESC en la ruta");
  assert.ok(noExiste.error.includes("no\\x1b[31mexiste.csv"), `la ruta sale con el ESC escrito como \\x1b; stderr: ${JSON.stringify(noExiste.error)}`);
  assert.ok(!existsSync(dir), "no crea la carpeta de salida");

  const opcion = correr([`--color${ESC}[31m`, "x"]);
  assert.equal(opcion.codigo, 2, `opción desconocida: código 2; stderr: ${JSON.stringify(opcion.error)}`);
  sinControl(opcion, "opción desconocida con ESC");
  assert.ok(opcion.error.includes("--color\\x1b[31m"), `la opción sale con el ESC escrito como \\x1b; stderr: ${JSON.stringify(opcion.error)}`);

  // La carpeta de salida con ESC: en Windows no se puede crear (error), en otros sistemas sí (éxito). En los dos casos, nada crudo.
  const entrada = join(base, "a.csv");
  writeFileSync(entrada, `${CAB}U1,1,A,izquierda\n`);
  const salida = correr(["--entrada", entrada, "--salida", join(base, `sal${ESC}[31mida`)]);
  assert.ok(salida.codigo === 0 || salida.codigo === 1, `código 0 o 1; stderr: ${JSON.stringify(salida.error)}`);
  sinControl(salida, "--salida con ESC en la ruta", salida.codigo === 0 ? 0 : 1);
});

// ── Criterios 4 y 5: escritura atómica y aviso al reemplazar ────────────────────────────────────────────────────────
const DOS = `${CAB}U1,1,A,izquierda\nU1,2,B,derecha\nU2,1,C,izquierda\n`;
const LEGITIMOS = ["a.xml", "u1.svg", "u2.svg"];

// Carpeta temporal con `a.csv` (dos integrados) y una carpeta de salida ya poblada con `previos` ({nombre: contenido | null});
// `null` crea un directorio con ese nombre (y un archivo dentro).
function preparar(previos) {
  const base = carpetaTemporal();
  const entrada = join(base, "a.csv");
  writeFileSync(entrada, DOS);
  const dir = join(base, "salida");
  mkdirSync(dir);
  for (const [nombre, contenido] of Object.entries(previos)) {
    if (contenido === null) {
      mkdirSync(join(dir, nombre));
      writeFileSync(join(dir, nombre, "dentro.txt"), "no tocar\n");
    } else writeFileSync(join(dir, nombre), contenido);
  }
  return { base, entrada, dir, args: ["--entrada", entrada, "--salida", dir] };
}

function intactos(dir, previos, que) {
  assert.deepEqual(archivos(dir), Object.keys(previos).sort(), `${que}: en la carpeta de salida solo queda lo que había (ni salida a medias ni temporales)`);
  for (const [nombre, contenido] of Object.entries(previos)) {
    if (contenido === null) {
      assert.ok(statSync(join(dir, nombre)).isDirectory(), `${que}: ${nombre} sigue siendo un directorio`);
      assert.deepEqual(archivos(join(dir, nombre)), ["dentro.txt"], `${que}: el contenido del directorio ${nombre} no se toca`);
    } else assert.equal(readFileSync(join(dir, nombre), "utf8"), contenido, `${que}: ${nombre} conserva su contenido anterior`);
  }
}

for (const estorbo of ["u2.svg", "u1.svg", "a.xml"]) {
  test(`escritura atómica: si en la salida hay un directorio llamado ${estorbo}, falla con 1 y no cambia nada`, SIN_PYTHON, () => {
    const previos = { "a.xml": "BIBLIOTECA VIEJA\n", "u1.svg": "SVG VIEJO 1\n", "u2.svg": "SVG VIEJO 2\n", "otro.txt": "ajeno\n", [estorbo]: null };
    const { dir, args } = preparar(previos);
    const r = correr(args);
    assert.equal(r.codigo, 1, `debía salir con 1 (salió con ${r.codigo}); stderr: ${r.error}`);
    assert.match(r.error, /^error: /);
    assert.ok(r.error.includes(estorbo), `el mensaje nombra ${estorbo}; stderr: ${r.error}`);
    assert.match(r.error, /carpeta|directorio/i, `el mensaje dice en español que es una carpeta; stderr: ${r.error}`);
    assert.doesNotMatch(r.error, TRAZA, "sin traza ni códigos de error del sistema");
    assert.equal(lineas(r.error).length, 1, "una sola línea en stderr");
    assert.doesNotMatch(r.salida, /generad/, "no anuncia que generó nada");
    intactos(dir, previos, `directorio ${estorbo}`);
  });
}

test("escritura atómica: regenerar la misma entrada sobre la misma carpeta sale con 0, sin avisos y con los mismos bytes", SIN_PYTHON, () => {
  const { dir, args } = preparar({ "otro.txt": "ajeno\n" });
  const primera = correr(args);
  assert.equal(primera.codigo, 0, primera.error);
  assert.equal(primera.error, "", "la primera vez no reemplaza nada: sin avisos");
  assert.deepEqual(archivos(dir), [...LEGITIMOS, "otro.txt"].sort(), "no quedan temporales");
  const antes = bytes(dir);
  const segunda = correr(args);
  assert.equal(segunda.codigo, 0, segunda.error);
  assert.equal(segunda.error, "", "regenerar sin cambios no avisa: ningún archivo cambia de contenido");
  assert.equal(segunda.salida, primera.salida);
  assert.deepEqual(bytes(dir), antes, "mismos archivos y mismos bytes");
});

test("escritura atómica: al reemplazar archivos con otro contenido avisa por stderr de cuántos, sin fallar", SIN_PYTHON, () => {
  const limpio = preparar({});
  assert.equal(correr(limpio.args).codigo, 0);
  const esperado = bytes(limpio.dir);
  const igual = readFileSync(join(limpio.dir, "u1.svg"));
  const { dir, args } = preparar({ "a.xml": "BIBLIOTECA VIEJA\n", "u1.svg": igual, "u2.svg": "SVG VIEJO 2\n", "otro.txt": "ajeno\n" });
  const r = correr(args);
  assert.equal(r.codigo, 0, `reemplazar no es un error; stderr: ${r.error}`);
  const avisos = lineas(r.error);
  assert.equal(avisos.length, 1, `un único aviso; stderr: ${r.error}`);
  assert.match(avisos[0], /^aviso: /);
  assert.match(avisos[0], /reemplaz/i, `dice que reemplazó; stderr: ${r.error}`);
  assert.match(avisos[0], /(^|\D)2 archivo/, `cuenta los 2 archivos cuyo contenido cambió (a.xml y u2.svg), no el que quedó igual; stderr: ${r.error}`);
  assert.match(r.salida, /2 integrado/, "stdout sigue anunciando lo generado");
  assert.deepEqual(archivos(dir), [...LEGITIMOS, "otro.txt"].sort(), "no quedan temporales");
  assert.equal(readFileSync(join(dir, "otro.txt"), "utf8"), "ajeno\n", "los archivos ajenos no se tocan");
  for (const f of LEGITIMOS) assert.equal(readFileSync(join(dir, f)).toString("base64"), esperado[f], `${f} queda con el contenido nuevo`);
});

test("escritura atómica: cada salida se escribe en un temporal dentro de la carpeta y se coloca con os.replace", SIN_PYTHON, () => {
  const base = carpetaTemporal();
  const entrada = join(base, "a.csv");
  writeFileSync(entrada, DOS);
  const dir = join(base, "no", "existe", "salida");
  const r = correrVigilado(["--entrada", entrada, "--salida", dir]);
  assert.equal(r.codigo, 0, r.error);
  assert.equal(r.renombrados.length, LEGITIMOS.length, `un os.replace por archivo de salida; hubo: ${JSON.stringify(r.renombrados)}`);
  assert.deepEqual(r.renombrados.map(([, destino]) => basename(destino)).sort(), LEGITIMOS, "los destinos son la biblioteca y los SVG");
  for (const [origen, destino] of r.renombrados) {
    assert.equal(resolve(dirname(origen)), resolve(dir), `el temporal ${origen} vive en la carpeta de salida (mismo volumen que su destino)`);
    assert.equal(resolve(dirname(destino)), resolve(dir));
    assert.doesNotMatch(basename(origen), /\.(xml|svg)$/i, `el temporal «${basename(origen)}» no puede llamarse como una salida legítima (ninguna acaba en otra cosa que .xml o .svg)`);
    assert.doesNotMatch(basename(origen), CONTROL);
  }
  assert.equal(new Set(r.renombrados.map(([origen]) => resolve(origen))).size, LEGITIMOS.length, "un temporal distinto por archivo");
  assert.deepEqual(archivos(dir), LEGITIMOS, "al terminar solo quedan las salidas");
});

test("escritura atómica: si falla un renombrado no quedan temporales y el error sale en español con código 1", SIN_PYTHON, () => {
  const previos = { "a.xml": "BIBLIOTECA VIEJA\n", "u1.svg": "SVG VIEJO 1\n" };
  const uno = preparar(previos);
  const r = correrVigilado(uno.args, 1);
  assert.equal(r.renombrados.length, 1, `el primer os.replace falla y no se intenta ninguno más; hubo: ${JSON.stringify(r.renombrados)}`);
  assert.equal(r.codigo, 1, `debía salir con 1; stderr: ${r.error}`);
  assert.match(r.error, /^error: .*no se pudo/, `error en español; stderr: ${r.error}`);
  assert.doesNotMatch(r.error, TRAZA);
  assert.doesNotMatch(r.salida, /generad/, "no anuncia que generó nada");
  intactos(uno.dir, previos, "falla el primer renombrado");

  const dos = preparar(previos);
  const s = correrVigilado(dos.args, 2);
  assert.equal(s.codigo, 1, `debía salir con 1; stderr: ${s.error}`);
  assert.doesNotMatch(s.error, TRAZA);
  assert.deepEqual(archivos(dos.dir).filter((f) => !LEGITIMOS.includes(f)), [], "falla el segundo renombrado: tampoco quedan temporales");
});

// ── Criterio 6: el detector de procesos y ejecución dinámica funciona ───────────────────────────────────────────────
const DEBEN_MARCARSE = [
  ["os.system por atributo", 'import os\nos.system("dir")\n'],
  ["os.popen", 'import os\nos.popen("dir").read()\n'],
  ["os.execv", 'import os\nos.execv("/bin/sh", ["sh"])\n'],
  ["os.execlpe", 'import os\nos.execlpe("sh", "sh", {})\n'],
  ["os.spawnl", 'import os\nos.spawnl(os.P_WAIT, "/bin/sh", "sh")\n'],
  ["os.spawnvpe", 'import os\nos.spawnvpe(0, "sh", ["sh"], {})\n'],
  ["os.startfile", 'import os\nos.startfile("x.exe")\n'],
  ["os.posix_spawn", 'import os\nos.posix_spawn("/bin/sh", ["sh"], {})\n'],
  ["os.fork", "import os\nos.fork()\n"],
  ["os con alias", 'import os as o\no.system("dir")\n'],
  ["referencia sin llamar", "import os\nf = os.system\n"],
  ["from os import system", 'from os import system\nsystem("dir")\n'],
  ["from os import popen con alias", 'from os import popen as p\np("dir")\n'],
  ["from os import *", 'from os import *\n'],
  ["subprocess.run", 'import subprocess\nsubprocess.run(["dir"])\n'],
  ["subprocess con alias", 'import subprocess as sp\nsp.Popen(["dir"])\n'],
  ["from subprocess import run", 'from subprocess import run\nrun(["dir"])\n'],
  ["__import__", '__import__("subprocess").run(["dir"])\n'],
  ["getattr(os, …)", 'import os\ngetattr(os, "sys" + "tem")("dir")\n'],
  ["importlib.import_module", 'import importlib\nimportlib.import_module("subprocess")\n'],
  ["from importlib import import_module", 'from importlib import import_module\n'],
  ["sys.modules", 'import sys\nsys.modules["os"]\n'],
  ["os.__dict__", 'import os\nos.__dict__["system"]("dir")\n'],
  ["eval", 'eval("1+1")\n'],
  ["exec", 'exec("x = 1")\n'],
  ["eval con alias", "f = eval\n"],
  ["compile", 'compile("1", "x", "eval")\n'],
  ["builtins.eval", 'import builtins\nbuiltins.eval("1")\n'],
  ["globals()", 'globals()["__builtins__"]\n'],
  ["socket", "import socket\n"],
  ["urllib.request", "import urllib.request\n"],
  ["pickle", "import pickle\n"],
  ["ctypes", "import ctypes\n"],
  ["multiprocessing", "import multiprocessing\n"],
];
const NO_DEBEN_MARCARSE = [
  ["os.replace, os.remove y os.unlink", 'import os\nos.replace("a", "b")\nos.remove("a")\nos.unlink("b")\n'],
  ["os.path, os.makedirs, os.open, os.fdopen, os.fsync, os.getpid", 'import os\nos.makedirs(os.path.join("a", "b"), exist_ok=True)\nf = os.fdopen(os.open("x", os.O_WRONLY | os.O_CREAT | os.O_EXCL), "w")\nos.fsync(f.fileno())\nos.getpid()\n'],
  ["tempfile", 'import tempfile\nfd, ruta = tempfile.mkstemp(dir=".", prefix=".tmp-")\n'],
  ["re.compile y sys.executable", 'import re, sys\nre.compile("x")\nprint(sys.executable)\n'],
  ["csv, io, json, unicodedata", "import csv, io, json, unicodedata\ncsv.reader(io.StringIO(''))\njson.dumps([])\n"],
];

test("detector: marca procesos, ejecución dinámica y acceso indirecto a módulos, también por atributo, alias o import", SIN_PYTHON, () => {
  for (const [que, fuente] of DEBEN_MARCARSE) {
    const r = analizar(fuente);
    assert.ok(r.prohibido.length > 0, `el detector debía marcar «${que}» y no marcó nada:\n${fuente}`);
  }
});

test("detector: no marca lo que la escritura atómica necesita (os.replace, os.remove, os.unlink, tempfile) ni el resto de la biblioteca estándar inocua", SIN_PYTHON, () => {
  for (const [que, fuente] of NO_DEBEN_MARCARSE) {
    const r = analizar(fuente);
    assert.deepEqual(r.prohibido, [], `falso positivo en «${que}»`);
    assert.deepEqual(r.ajenos, [], `«${que}» es biblioteca estándar`);
  }
  assert.deepEqual(analizar("import requests\nfrom . import x\n").ajenos, [".", "requests"], "los imports de terceros y relativos salen en AJENOS");
});

test("detector: tools/integrados.py pasa limpio", SIN_PYTHON, () => {
  const r = analizar(readFileSync(GENERADOR, "utf8"));
  assert.deepEqual(r.prohibido, []);
  assert.deepEqual(r.ajenos, []);
  assert.ok(r.modulos.includes("csv") && r.modulos.includes("os"), "el detector leyó de verdad el generador");
});

// ── Criterios 7 y 8: CSV separado por punto y coma ──────────────────────────────────────────────────────────────────
const aPuntoYComa = (csvSinComillas) => csvSinComillas.replace(/,/g, ";");

test("punto y coma: el CSV que exporta Excel en español (BOM, CRLF y «;») da los mismos bytes que su equivalente con comas", SIN_PYTHON, () => {
  const comas = readFileSync(join(RAIZ, "tools", "ejemplos", "ne555.csv"), "utf8").replace(/\r\n/g, "\n");
  assert.ok(!comas.includes('"') && !comas.includes(";"), "el ejemplo no lleva comillas ni «;» (si cambia, hay que rehacer este test)");
  const esperado = bytes(generarBien("ne555.csv", comas).dir);
  const simple = generarBien("ne555.csv", aPuntoYComa(comas));
  assert.equal(simple.error, "", "sin avisos");
  assert.deepEqual(bytes(simple.dir), esperado, "«;» con LF y sin BOM");
  const excel = generarBien("ne555.csv", `﻿${aPuntoYComa(comas).replace(/\n/g, "\r\n")}`);
  assert.deepEqual(bytes(excel.dir), esperado, "«;» con BOM y CRLF");
});

test("punto y coma: elegido el separador en la cabecera, el otro carácter es texto normal dentro de los campos", SIN_PYTHON, () => {
  const conComas = generarBien("a.csv", `${CAB}"U,1",1,"A,B",izquierda\n"U,1",2,"di ""x""",derecha\n`);
  const conPyc = generarBien("a.csv", 'integrado;pin;nombre;lado\nU,1;1;A,B;izquierda\nU,1;2;"di ""x""";derecha\n');
  const [e] = leerBiblioteca(join(conPyc.dir, "a.xml"));
  assert.equal(e.title, "U,1");
  assert.deepEqual(e.etiquetas.map((c) => c.valor), ["1", "A,B", "2", 'di "x"']);
  assert.deepEqual(bytes(conPyc.dir), bytes(conComas.dir), "las dos escrituras del mismo contenido dan los mismos bytes");

  const pycEnCampo = generarBien("a.csv", `${CAB}U1,1,A;B,izquierda\n`);
  assert.deepEqual(leerBiblioteca(join(pycEnCampo.dir, "a.xml"))[0].etiquetas.map((c) => c.valor), ["1", "A;B"], "con comas, «;» es texto");
  const entreComillas = generarBien("a.csv", 'integrado;pin;nombre;lado\nU1;1;"A;B";izquierda\n');
  assert.deepEqual(leerBiblioteca(join(entreComillas.dir, "a.xml"))[0].etiquetas.map((c) => c.valor), ["1", "A;B"], "con «;», un campo entre comillas puede llevar «;»");
  const cabecera = generarBien("a.csv", " Lado ; PIN;nombre;Integrado;tipo\r\nizquierda;1;A;U1;entrada\r\n");
  assert.deepEqual(leerSvg(join(cabecera.dir, "u1.svg")).pines.map((p) => `${p.lado}:${p.numero}:${p.nombre}:${p.tipo}`), ["izquierda:1:A:entrada"], "cabecera con espacios, mayúsculas y otro orden");
});

test("punto y coma: los errores de fila siguen saliendo con su línea y en español", SIN_PYTHON, () => {
  const casos = [
    ["fila con columnas de menos", "U1;1;A\n", /a\.csv:2:/],
    ["fila con una columna de más (una coma no separa)", "U1;1;A;izquierda;entrada;extra\n", /a\.csv:2:/],
    ["lado desconocido", "U1;1;A;centro;\n", /a\.csv:2:.*centro/s],
    ["texto pegado a la comilla de cierre", 'U1;1;"A"B;izquierda;\n', /a\.csv:2:.*CSV mal formado/s],
  ];
  for (const [que, fila, patron] of casos) {
    const r = generar("a.csv", `integrado;pin;nombre;lado;tipo\n${fila}`);
    assert.equal(r.codigo, 1, `${que}: código 1; stderr: ${r.error}`);
    assert.match(r.error, patron, `${que}: ${patron}; stderr: ${r.error}`);
    assert.doesNotMatch(r.error, INGLES, `${que}: sin texto en inglés; stderr: ${r.error}`);
    assert.deepEqual(archivos(r.dir), [], `${que}: no escribe nada`);
  }
  const mezcla = generar("a.csv", "integrado;pin;nombre;lado\nU1,1,A,izquierda\n");
  assert.equal(mezcla.codigo, 1, "cabecera con «;» y filas con comas: no se adivina, la fila tiene una sola columna");
  assert.match(mezcla.error, /a\.csv:2:/);
});

test("punto y coma: sin adivinar: cabecera ambigua o sin las columnas obligatorias en ninguna de las dos lecturas → error que lo dice", SIN_PYTHON, () => {
  const ambigua = generar("a.csv", "lado,integrado,pin,nombre,lado;integrado;pin;nombre;lado\nx,U1,1,A,izquierda;U1;1;A;izquierda\n");
  assert.equal(ambigua.codigo, 1, `cabecera válida con «,» y con «;»: código 1; stderr: ${ambigua.error}`);
  assert.match(ambigua.error, /a\.csv:1:.*ambig/is, `dice que el separador es ambiguo, en la línea 1; stderr: ${ambigua.error}`);
  assert.match(ambigua.error, /coma/i);
  assert.match(ambigua.error, /punto y coma/i);
  assert.deepEqual(archivos(ambigua.dir), []);

  for (const [que, cabecera, falta] of [
    ["con «;» y sin `integrado`", "chip;pin;nombre;lado\nU1;1;A;izquierda\n", /integrado/],
    ["con «,» y sin `lado`", "integrado,pin,nombre\nU1,1,A\n", /lado/],
    ["con tabuladores", "integrado\tpin\tnombre\tlado\nU1\t1\tA\tizquierda\n", /pin/],
  ]) {
    const r = generar("a.csv", cabecera);
    assert.equal(r.codigo, 1, `${que}: código 1; stderr: ${r.error}`);
    assert.match(r.error, /a\.csv:1:.*faltan columnas/is, `${que}: dice que faltan columnas, en la línea 1; stderr: ${r.error}`);
    assert.match(r.error, falta, `${que}: nombra la columna que falta`);
    assert.match(r.error, /punto y coma/i, `${que}: recuerda que el separador puede ser coma o punto y coma; stderr: ${r.error}`);
    sinControl(r, que);
    assert.deepEqual(archivos(r.dir), []);
  }
});

test("punto y coma: la ayuda y el README dicen que el CSV puede ir separado por comas o por punto y coma", SIN_PYTHON, () => {
  const ayuda = correr(["--ayuda"]);
  assert.equal(ayuda.codigo, 0);
  assert.match(ayuda.salida, /punto y coma/i, "la ayuda (--ayuda) lo menciona");
  assert.match(ayuda.salida, /reemplaz/i, "la ayuda dice que los archivos que ya existan en la carpeta de salida se reemplazan");
  const readme = readFileSync(join(RAIZ, "README.md"), "utf8");
  const m = /^## Biblioteca de integrados[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme);
  assert.ok(m, "falta la sección «## Biblioteca de integrados»");
  assert.match(m[1], /punto y coma/i, "el README lo menciona");
  assert.match(m[1], /reemplaz/i, "el README dice que regenerar reemplaza los archivos de la carpeta de salida");
  assert.ok(m[1].split("\n").length <= 40, "la sección sigue siendo corta (40 líneas como mucho)");
});

// ── Criterio 9: el nombre no se encima con los rótulos laterales ────────────────────────────────────────────────────
const LARGA = "ENTRADA_MUY_LARGA_X";
// [descripción, nombre del integrado, filas «pin,nombre,lado»]: sin pines arriba ni abajo y con columnas de distinto ancho.
const ASIMETRICOS = [
  ["un único pin a la izquierda con nombre largo", "ABC123", [`1,${LARGA},izquierda`]],
  ["tres pines a la izquierda (el nombre caía sobre la fila central)", "ABC123", [`1,${LARGA},izquierda`, "2,B,izquierda", `3,${LARGA},izquierda`]],
  ["izquierda larga y derecha corta", "ABC123", [`1,${LARGA},izquierda`, "2,Q,derecha"]],
  ["izquierda corta y derecha larga", "ABC123", ["1,D,izquierda", `2,${LARGA},derecha`, `3,${LARGA},derecha`]],
  ["un único pin a la derecha con nombre largo", "ABC123", [`1,${LARGA},derecha`]],
  ["nombre de integrado largo, números de dos y tres cifras", "STM32F103C8T6", [`10,${LARGA},izquierda`, "11,PA0,izquierda", "12,PA1,izquierda", "100,X,derecha", "101,Y,derecha"]],
];
const csvDe = (chip, filas) => CAB + filas.map((f) => `${chip},${f}\n`).join("");
const esLateral = (lado) => lado === "izquierda" || lado === "derecha";

for (const [que, chip, filas] of ASIMETRICOS) {
  test(`biblioteca: el nombre va centrado en el hueco entre las columnas laterales y no se encima con ningún rótulo · ${que}`, SIN_PYTHON, () => {
    const r = generarBien("c.csv", csvDe(chip, filas));
    const [e] = leerBiblioteca(join(r.dir, "c.xml"));
    const cuerpo = e.modelo.querySelector('mxCell[id="cuerpo"]');
    assert.equal(cuerpo.getAttribute("value"), chip, "el nombre sigue siendo el rótulo del cuerpo");
    const { caja: nombre, w, h } = cajaNombreCuerpo(cuerpo);
    assert.equal(w, e.w, "el ancho de la entrada es el del cuerpo");
    assert.ok(nombre.x0 >= -0.5 && nombre.x1 <= w + 0.5 && nombre.y0 >= -0.5 && nombre.y1 <= h + 0.5, `el nombre queda dentro de la caja ${w}×${h}: ${ver(nombre)}`);
    const lados = puntos(cuerpo.getAttribute("style")).map(ladoDePunto);
    assert.ok(lados.every(esLateral), "el caso solo tiene pines laterales");
    const etiquetas = [...e.modelo.querySelectorAll('mxCell[parent="cuerpo"]')];
    assert.equal(etiquetas.length, filas.length * 2, "dos etiquetas por pin, en el orden de los pines");
    let izq = 0, der = w;
    etiquetas.forEach((c, i) => {
      const lado = lados[Math.floor(i / 2)];
      const caja = cajaEtiqueta(c);
      assert.ok(!solapan(nombre, caja),
        `el nombre «${chip}» ${ver(nombre)} se encima con el rótulo «${c.getAttribute("value")}» (${lado}) ${ver(caja)} en una caja de ${w}×${h}`);
      if (lado === "izquierda") izq = Math.max(izq, caja.x1);
      else der = Math.min(der, caja.x0);
    });
    assert.ok(der - izq >= nombre.x1 - nombre.x0 - 0.5, `el hueco libre (x ${izq}…${der}) da para el nombre ${ver(nombre)}`);
    const centro = (nombre.x0 + nombre.x1) / 2;
    assert.ok(Math.abs(centro - (izq + der) / 2) <= 1.5, `el nombre (centro x=${centro}) va centrado en el hueco libre x ${izq}…${der} (centro ${(izq + der) / 2})`);
  });

  test(`SVG: el título va en el hueco entre las columnas laterales y no se encima con ningún rótulo · ${que}`, SIN_PYTHON, () => {
    const r = generarBien("c.csv", csvDe(chip, filas));
    const [archivo] = archivos(r.dir).filter((f) => f.endsWith(".svg"));
    const svg = leerSvg(join(r.dir, archivo));
    const titulos = [...svg.doc.querySelectorAll("text")].filter((t) => !t.closest("g.pin") && t.textContent === chip);
    assert.equal(titulos.length, 1, "hay un <text> con el nombre del integrado fuera de los grupos de pin");
    const titulo = cajaTexto(titulos[0], svg.raiz);
    const rect = [...svg.raiz.children].filter((n) => n.nodeName === "rect")[1];
    assert.ok(rect, "el segundo <rect> de la raíz es el cuerpo del integrado");
    const x0 = Number(rect.getAttribute("x")), x1 = x0 + Number(rect.getAttribute("width"));
    assert.ok(titulo.x0 >= x0 && titulo.x1 <= x1, `el título ${ver(titulo)} queda dentro del cuerpo (x ${x0}…${x1})`);
    let izq = x0, der = x1, medidos = 0;
    for (const g of svg.doc.querySelectorAll("g.pin")) {
      const lado = g.getAttribute("data-lado");
      const textos = [...g.querySelectorAll("text")];
      for (const t of textos) {
        const caja = cajaTexto(t, svg.raiz);
        medidos += 1;
        assert.ok(!solapan(titulo, caja), `el título «${chip}» ${ver(titulo)} se encima con el rótulo «${t.textContent}» (${lado}) ${ver(caja)}`);
      }
      const rotulo = cajaTexto(textos.find((t) => t.textContent === g.getAttribute("data-nombre")), svg.raiz);
      if (lado === "izquierda") izq = Math.max(izq, rotulo.x1);
      else der = Math.min(der, rotulo.x0);
    }
    assert.equal(medidos, filas.length * 2, "se midieron el número y el nombre de cada pin");
    const centro = (titulo.x0 + titulo.x1) / 2;
    // El ancho del texto es una estimación: se pide que el título caiga en la mitad central del hueco, no un centrado al píxel.
    assert.ok(Math.abs(centro - (izq + der) / 2) <= (der - izq) / 4,
      `el título (centro x=${centro.toFixed(1)}) va hacia el centro del hueco libre x ${izq.toFixed(1)}…${der.toFixed(1)}`);
  });
}

// ── Criterio 10: lo que no es «solo laterales y asimétrico» no cambia ni un byte ────────────────────────────────────
// Huellas sha256 calculadas con el generador del lote e-integrados (c540a3f), antes de tocar la colocación del nombre.
const EJEMPLO = (ext) => readFileSync(join(RAIZ, "tools", "ejemplos", `ne555.${ext}`));
const SIN_CAMBIOS = [
  ["el ejemplo ne555.csv (laterales simétricos, con pines arriba y abajo)", "ne555.csv", () => EJEMPLO("csv"), {
    "ne555.svg": "0095ac6923dd74c6ed7b2b25f64c895401bfd468c4c9c8c61237a19bd5d67331", "ne555.xml": "5017bef0945cd78aef42da6cc2c5ab7bf866aed03ef6f4f83661c789dba1e342",
  }],
  ["el ejemplo ne555.kicad_sym", "ne555.kicad_sym", () => EJEMPLO("kicad_sym"), {
    "ne555.svg": "0095ac6923dd74c6ed7b2b25f64c895401bfd468c4c9c8c61237a19bd5d67331", "ne555.xml": "5017bef0945cd78aef42da6cc2c5ab7bf866aed03ef6f4f83661c789dba1e342",
  }],
  ["dos integrados solo laterales y simétricos", "sim.csv", () => `${CAB}74HC00,1,A1,izquierda\n74HC00,2,B1,izquierda\n74HC00,3,Y1,derecha\n74HC00,7,GN,derecha\nR1,1,A,izquierda\nR1,2,B,derecha\n`, {
    "74hc00.svg": "9a3d35ec8b591414d594f18511103627b601d23dffc82aa72525a1fb7b6a8904", "r1.svg": "6d6bfa68f12c297829b3d1ee292ca1f92e35aba76dd73f9e6b72a43fa31f029c", "sim.xml": "19bb119d1751020e645de9db8f0cc859a59525daff3d7627945592c2a0b018d9",
  }],
  ["laterales asimétricos pero con un pin arriba (el nombre ya tiene su franja)", "arr.csv", () => csvDe("ABC123", [`1,${LARGA},izquierda`, "2,Q,derecha", "8,VCC,arriba"]), {
    "abc123.svg": "2c606660b97a0a422e6cd890d7abbc77b3b9d3edefd00efb7753bbdf454d14dc", "arr.xml": "430abef1b798b86c23615e3090ef5b2958b59c782a01f6ebf02471704d352712",
  }],
  ["laterales asimétricos pero con un pin abajo", "aba.csv", () => csvDe("ABC123", [`1,${LARGA},izquierda`, "4,GND,abajo"]), {
    "abc123.svg": "8feb906d474152899fb5448b3a4713de8d00504258303a9fe8e3bd324ad53e94", "aba.xml": "479e7bfda12f4733a3c49dc04e81ac855de48d0853fd67fcdbe102e1cdc9d27d",
  }],
  ["solo pines arriba y abajo", "tb.csv", () => csvDe("U1", ["1,VCC,arriba", "2,GND,abajo"]), {
    "tb.xml": "2d1b9e31ecae236685812f511f326e8bdb1e61393a10e58d37117c10439c177e", "u1.svg": "8d69e6ba2f3e0b09e0af84ea8eae62ce5aebeaece44940dfe9d75c24dea5dc80",
  }],
];

for (const [que, nombre, contenido, huellas] of SIN_CAMBIOS) {
  test(`sin cambios: ${que} genera exactamente los mismos bytes que antes de este lote`, SIN_PYTHON, () => {
    const r = generarBien(nombre, String(contenido()).replace(/\r\n/g, "\n"));
    assert.deepEqual(archivos(r.dir), Object.keys(huellas).sort());
    for (const [f, huella] of Object.entries(huellas)) {
      assert.equal(sha(join(r.dir, f)), huella, `${f} cambió: este lote solo puede mover el nombre en integrados sin pines arriba/abajo y con columnas laterales de distinto ancho`);
    }
  });
}
