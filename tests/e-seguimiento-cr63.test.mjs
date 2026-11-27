// Lote e-seguimiento · dos hilos de CodeRabbit del PR 63 sobre tools/integrados.py:
//  11  si ninguna lectura de la cabecera es válida y alguna falló por formato, el error es «CSV mal formado» (con su línea),
//      no «faltan columnas obligatorias»;
//  12  modo de los archivos: temporal sin permisos para grupo ni otros, la salida que ya existía conserva su modo y la
//      nueva queda como una creación normal (0666 menos el umask).
// Todos ejecutan el generador y miden lo que sale (stderr, archivos, modos), no su código.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SIN_MODOS, SIN_PYTHON, analizar, archivos, carpetaTemporal, correr, correrConModos, correrVigilado, generar, generarBien, join, lineas,
  readFileSync, writeFileSync,
} from "./fixtures/integrados.mjs";

const CAB = "integrado,pin,nombre,lado\n";
const TRAZA = /Traceback|File ".*", line \d+|Errno|WinError/;
// Fragmentos de los mensajes de csv.Error de Python: no deben verse.
const INGLES = /expected|end of data|field larger|field limit|delimiter|new-?line|quote|string/i;
const bytes = (dir) => Object.fromEntries(archivos(dir).map((f) => [f, readFileSync(join(dir, f)).toString("base64")]));

// ── Criterio 11: error de formato cuando ninguna cabecera es válida ─────────────────────────────────────────────────
test("cabecera mal formada: si ninguna lectura es válida y alguna falló por las comillas, el error es «CSV mal formado» con su línea", SIN_PYTHON, () => {
  const casos = [
    ["texto pegado a la comilla de cierre en la cabecera, con comas", 'integrado,pin,nombre,"lado"x\nU1,1,A,izquierda\n', 1],
    ["lo mismo con punto y coma", 'integrado;pin;nombre;"lado"x\nU1;1;A;izquierda\n', 1],
    ["comilla sin cerrar en la cabecera", 'integrado,pin,nombre,"lado\nU1,1,A,izquierda\n', 1],
    ["comilla sin cerrar en la cabecera, con punto y coma y CRLF", 'integrado;pin;nombre;"lado\r\nU1;1;A;izquierda\r\n', 1],
    ["cabecera mal formada tras dos líneas en blanco", '\n\nintegrado,pin,nombre,"lado"x\nU1,1,A,izquierda\n', 3],
    ["con BOM", '﻿integrado,pin,nombre,"lado"x\nU1,1,A,izquierda\n', 1],
    ["las dos lecturas fallan por formato", '"integrado"x,pin;nombre\nU1,1,A,izquierda\n', 1],
    ["la lectura que no falla tampoco trae las columnas (faltan en las dos)", 'pin;nombre;"lado"x\nU1;1;A\n', 1],
  ];
  for (const [que, contenido, linea] of casos) {
    const r = generar("a.csv", contenido);
    assert.equal(r.codigo, 1, `${que}: debía salir con 1 (salió con ${r.codigo}); stderr: ${r.error}`);
    assert.match(r.error, /^error: /, `${que}: el mensaje empieza por «error: »`);
    assert.match(r.error, /CSV mal formado/, `${que}: dice «CSV mal formado»; stderr: ${r.error}`);
    assert.doesNotMatch(r.error, /faltan columnas/i, `${que}: no lo confunde con columnas que faltan; stderr: ${r.error}`);
    assert.ok(r.error.includes(`a.csv:${linea}:`), `${que}: indica «a.csv:${linea}:»; stderr: ${r.error}`);
    assert.match(r.error, /comilla/i, `${que}: habla de las comillas; stderr: ${r.error}`);
    assert.doesNotMatch(r.error, INGLES, `${que}: sin el texto de la excepción de Python; stderr: ${r.error}`);
    assert.doesNotMatch(r.error, TRAZA, `${que}: sin traza de Python`);
    assert.equal(lineas(r.error).length, 1, `${que}: una sola línea en stderr`);
    assert.ok(r.error.length < 400, `${que}: el mensaje no vuelca el contenido del archivo`);
    assert.deepEqual(archivos(r.dir), [], `${que}: no escribe nada`);
  }
});

test("cabecera mal formada: si hay una cabecera válida con un separador, da igual que la otra lectura falle por las comillas", SIN_PYTHON, () => {
  // `"integrado";pin…` leído con comas es un campo con texto pegado a la comilla de cierre; con «;» es una cabecera válida.
  const comas = generarBien("a.csv", `${CAB}U1,1,A,izquierda\nU1,2,B,derecha\n`);
  const esperado = bytes(comas.dir);
  const pyc = generarBien("a.csv", '"integrado";pin;nombre;lado\nU1;1;A;izquierda\nU1;2;B;derecha\n');
  assert.equal(pyc.error, "", "válida con «;», la lectura con comas falla por formato: sin avisos");
  assert.deepEqual(bytes(pyc.dir), esperado, "mismos bytes que la tabla equivalente con comas");
  const coma = generarBien("a.csv", '"integrado",pin,nombre,lado\nU1,1,A,izquierda\nU1,2,B,derecha\n');
  assert.equal(coma.error, "", "válida con «,», la lectura con «;» falla por formato: sin avisos");
  assert.deepEqual(bytes(coma.dir), esperado);
});

test("cabecera mal formada: sin errores de formato, la cabecera ambigua y la que no trae las columnas siguen dando su error de siempre", SIN_PYTHON, () => {
  const ambigua = generar("a.csv", "lado,integrado,pin,nombre,lado;integrado;pin;nombre;lado\nx,U1,1,A,izquierda;U1;1;A;izquierda\n");
  assert.equal(ambigua.codigo, 1, ambigua.error);
  assert.match(ambigua.error, /a\.csv:1:.*ambig/is, `sigue diciendo que el separador es ambiguo; stderr: ${ambigua.error}`);
  assert.doesNotMatch(ambigua.error, /CSV mal formado/);
  for (const [que, contenido, falta] of [
    ["sin `integrado`", "chip;pin;nombre;lado\nU1;1;A;izquierda\n", /integrado/],
    ["sin `lado`", "integrado,pin,nombre\nU1,1,A\n", /lado/],
    ["comilla en medio de un campo (no es un error de formato)", 'integrado,pin,nombre,la"do\nU1,1,A,izquierda\n', /lado/],
  ]) {
    const r = generar("a.csv", contenido);
    assert.equal(r.codigo, 1, `${que}: código 1; stderr: ${r.error}`);
    assert.match(r.error, /a\.csv:1:.*faltan columnas/is, `${que}: sigue diciendo que faltan columnas, en la línea 1; stderr: ${r.error}`);
    assert.match(r.error, falta, `${que}: nombra la columna que falta`);
    assert.doesNotMatch(r.error, /CSV mal formado/, `${que}: no hay error de formato que informar`);
  }
  // La cabecera es correcta y la fila 2 está mal formada: el fallo es de la fila, no de la cabecera.
  const fila = generar("a.csv", `${CAB}U1,1,"A"B,izquierda\n`);
  assert.equal(fila.codigo, 1);
  assert.ok(fila.error.includes("a.csv:2:") && fila.error.includes("CSV mal formado"), `con cabecera válida, la fila mal formada se señala en su línea; stderr: ${fila.error}`);
});

// ── Criterio 12: modo de los archivos de salida ─────────────────────────────────────────────────────────────────────
const DOS = `${CAB}U1,1,A,izquierda\nU1,2,B,derecha\nU2,1,C,izquierda\n`;
const LEGITIMOS = ["a.xml", "u1.svg", "u2.svg"];
const modo = (ruta) => statSync(ruta).mode & 0o777;
const octal = (m) => `0${m.toString(8).padStart(3, "0")}`;
const modos = (dir) => Object.fromEntries(archivos(dir).map((f) => [f, octal(modo(join(dir, f)))]));

function entradaDos() {
  const base = carpetaTemporal();
  const entrada = join(base, "a.csv");
  writeFileSync(entrada, DOS);
  const dir = join(base, "salida");
  return { base, entrada, dir, args: ["--entrada", entrada, "--salida", dir] };
}

function bien(r, que) {
  assert.equal(r.codigo, 0, `${que}: el generador debía terminar con 0; stderr: ${r.error}`);
  return r;
}

test("modos: cada temporal se crea sin permisos para grupo ni otros, aunque el umask sea 0", SIN_MODOS, () => {
  const { dir, args } = entradaDos();
  const r = bien(correrConModos(args, "000"), "umask 000");
  const enSalida = r.creados.filter(([ruta]) => resolve(dirname(ruta)) === resolve(dir));
  assert.ok(enSalida.length >= LEGITIMOS.length, `se observa la creación de un temporal por archivo de salida (con os.open o tempfile); creados: ${JSON.stringify(r.creados)}`);
  for (const [ruta, m] of enSalida) {
    assert.equal(m & 0o077, 0, `${ruta} se creó con modo ${octal(m)}: mientras se escribe no debe ser legible ni escribible por grupo ni otros`);
  }
  assert.deepEqual(archivos(dir), LEGITIMOS, "al terminar solo quedan las salidas");
});

for (const [mascara, esperado] of [["022", "0644"], ["027", "0640"], ["002", "0664"], ["077", "0600"], ["000", "0666"]]) {
  test(`modos: una salida nueva queda como una creación normal (umask ${mascara} → ${esperado})`, SIN_MODOS, () => {
    const { dir, args } = entradaDos();
    bien(correrConModos(args, mascara), `umask ${mascara}`);
    assert.deepEqual(modos(dir), Object.fromEntries(LEGITIMOS.map((f) => [f, esperado])), "0666 menos el umask del proceso, en los tres archivos");
  });
}

test("modos: al regenerar, cada salida que ya existía conserva el modo que tenía, cambie o no su contenido", SIN_MODOS, () => {
  const { dir, args } = entradaDos();
  bien(correrConModos(args, "022"), "primera generación");
  const nuevo = bytes(dir);
  const previos = { "a.xml": 0o600, "u1.svg": 0o640, "u2.svg": 0o666 };
  writeFileSync(join(dir, "a.xml"), "BIBLIOTECA VIEJA\n"); // cambia de contenido
  writeFileSync(join(dir, "u2.svg"), "SVG VIEJO 2\n"); // cambia de contenido; u1.svg queda idéntico
  for (const [f, m] of Object.entries(previos)) chmodSync(join(dir, f), m);
  const r = bien(correrConModos(args, "022"), "regenerar");
  assert.match(r.error, /(^|\D)2 archivo/, `sigue avisando de los 2 archivos reemplazados; stderr: ${r.error}`);
  assert.deepEqual(bytes(dir), nuevo, "el contenido es el nuevo");
  assert.deepEqual(modos(dir), { "a.xml": "0600", "u1.svg": "0640", "u2.svg": "0666" }, "un archivo privado (0600) no pasa a 0644, ni uno abierto (0666) se cierra");

  bien(correrConModos(args, "077"), "regenerar con otro umask");
  assert.deepEqual(modos(dir), { "a.xml": "0600", "u1.svg": "0640", "u2.svg": "0666" }, "el umask no afecta a las salidas que ya existían");
});

test("modos: en la misma ejecución, la salida que existía conserva su modo y la que faltaba se crea con 0666 menos el umask", SIN_MODOS, () => {
  const { dir, args } = entradaDos();
  bien(correrConModos(args, "022"), "primera generación");
  chmodSync(join(dir, "a.xml"), 0o600);
  chmodSync(join(dir, "u2.svg"), 0o400);
  rmSync(join(dir, "u1.svg"));
  writeFileSync(join(dir, "otro.txt"), "ajeno\n");
  chmodSync(join(dir, "otro.txt"), 0o604);
  bien(correrConModos(args, "027"), "regenerar con u1.svg borrado");
  assert.deepEqual(modos(dir), { "a.xml": "0600", "otro.txt": "0604", "u1.svg": "0640", "u2.svg": "0400" }, "existentes: su modo (también solo lectura); nueva: 0666 menos 027; el archivo ajeno no se toca");
});

test("modos: sin vigilancia (como lo corre un usuario), regenerar no abre un archivo que estaba en 0600", SIN_MODOS, () => {
  const { dir, args } = entradaDos();
  assert.equal(correr(args).codigo, 0);
  for (const f of LEGITIMOS) chmodSync(join(dir, f), 0o600);
  const r = correr(args);
  assert.equal(r.codigo, 0, r.error);
  assert.equal(r.error, "", "regenerar sin cambios sigue sin avisos");
  assert.deepEqual(modos(dir), Object.fromEntries(LEGITIMOS.map((f) => [f, "0600"])));
});

// Salida existente de solo lectura: el temporal hereda su modo antes del os.replace (criterio 12). Si la colocación falla,
// el temporal también es de solo lectura y en Windows no se deja borrar sin quitarle antes ese atributo: no debe quedarse.
// Estos dos tests no se saltan en ninguna plataforma (chmod 0444 es el atributo «solo lectura» en Windows).
const TEMPORAL = /\.tmp$/i;

function conSalidaDeSoloLectura(cual, fn) {
  const caso = entradaDos();
  try {
    assert.equal(correr(caso.args).codigo, 0, "primera generación");
    const nuevo = bytes(caso.dir);
    writeFileSync(join(caso.dir, cual), "CONTENIDO VIEJO\n");
    writeFileSync(join(caso.dir, "otro.txt"), "ajeno\n");
    chmodSync(join(caso.dir, cual), 0o444);
    fn({ ...caso, nuevo, previo: bytes(caso.dir) });
  } finally {
    // Se devuelve el permiso de escritura a todo (también a un temporal suelto) para poder borrar la carpeta en Windows.
    for (const f of archivos(caso.dir)) chmodSync(join(caso.dir, f), 0o666);
    rmSync(caso.base, { recursive: true, force: true });
  }
}

function falloDeColocacion(r, cual, que) {
  assert.equal(r.codigo, 1, `${que}: debía salir con 1 (salió con ${r.codigo}); stderr: ${r.error}`);
  assert.equal(lineas(r.error).length, 1, `${que}: una sola línea en stderr; stderr: ${r.error}`);
  assert.match(r.error, /^error: .*no se pudo/, `${que}: el error es el del criterio 4; stderr: ${r.error}`);
  assert.ok(r.error.includes(cual), `${que}: nombra ${cual}; stderr: ${r.error}`);
  assert.doesNotMatch(r.error, TRAZA, `${que}: sin traza ni códigos del sistema`);
  assert.doesNotMatch(r.salida, /generado/, `${que}: no anuncia que generó nada`);
}

for (const cual of LEGITIMOS) {
  test(`solo lectura: si falla el primer renombrado y ${cual} ya existía de solo lectura, no queda ningún temporal`, SIN_PYTHON, () => {
    conSalidaDeSoloLectura(cual, ({ dir, args, previo }) => {
      const r = correrVigilado(args, 1);
      falloDeColocacion(r, "a.xml", `${cual} de solo lectura`);
      assert.deepEqual(archivos(dir).filter((f) => TEMPORAL.test(f)), [], "ningún temporal suelto, tampoco el que heredó el solo lectura");
      assert.deepEqual(bytes(dir), previo, "falló el primer renombrado: la carpeta queda como estaba, archivo ajeno incluido");
      assert.equal(modo(join(dir, cual)) & 0o222, 0, `${cual} sigue siendo de solo lectura`);
    });
  });
}

test("solo lectura: sin vigilancia, una salida existente de solo lectura no deja temporales (Windows: no se reemplaza; POSIX: se reemplaza y conserva el modo)", SIN_PYTHON, () => {
  for (const cual of LEGITIMOS) {
    conSalidaDeSoloLectura(cual, ({ dir, args, nuevo, previo }) => {
      const r = correr(args);
      assert.deepEqual(archivos(dir).filter((f) => TEMPORAL.test(f)), [], `${cual} de solo lectura: ningún temporal suelto; stderr: ${r.error}`);
      assert.deepEqual(archivos(dir), [...LEGITIMOS, "otro.txt"].sort(), `${cual} de solo lectura: solo las salidas y el archivo ajeno`);
      assert.equal(modo(join(dir, cual)) & 0o222, 0, `${cual} sigue siendo de solo lectura`);
      if (process.platform === "win32") {
        // os.replace no puede sustituir un destino de solo lectura: es un fallo de colocación del criterio 4.
        falloDeColocacion(r, cual, `${cual} de solo lectura`);
        assert.equal(bytes(dir)[cual], previo[cual], `${cual} conserva su contenido`);
        if (cual === LEGITIMOS[0]) assert.deepEqual(bytes(dir), previo, "falló el primer renombrado: nada cambia");
      } else {
        // Con la carpeta escribible, os.replace sí sustituye un archivo de solo lectura: sale bien y conserva el 0444.
        assert.equal(r.codigo, 0, `${cual} de solo lectura: en POSIX se reemplaza; stderr: ${r.error}`);
        assert.deepEqual(bytes(dir), { ...nuevo, "otro.txt": previo["otro.txt"] }, "el contenido es el nuevo");
        assert.equal(octal(modo(join(dir, cual))), "0444", `${cual} conserva su modo`);
      }
    });
  }
});

test("modos: el detector no marca lo que hace falta para fijar los modos (os.chmod, os.fchmod, os.umask, os.stat, stat.S_IMODE)", SIN_PYTHON, () => {
  const r = analizar('import os, stat\nm = stat.S_IMODE(os.stat("a").st_mode)\nos.chmod("a", m)\nfd = os.open("b", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)\nos.fchmod(fd, m)\nv = os.umask(0)\nos.umask(v)\n');
  assert.deepEqual(r.prohibido, [], "ninguna de esas llamadas lanza procesos ni ejecuta código");
  assert.deepEqual(r.ajenos, []);
});
