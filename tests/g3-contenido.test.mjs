// Lote G3 «tipo por contenido»: con token de subida, POST /api/archivos solo acepta drawio, svg, kicad_sch y kicad_pcb,
// y el primer trozo del cuerpo tiene que cuadrar con la extensión. Con cookie no cambia nada en este lote.
// Ver .factory/spec.md, criterios 1 a 4.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { T0, EDITOR, sesion, crearEnv, insertarToken, enc, uuid, DRAWIO, SVG, SCH, PCB, PNG, subirArchivo, subirEnTrozos, adjuntos, bajar } from "./fixtures/g3-diagrama.mjs";

const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const cargar = () => import("../lib/contenido-subida.mjs");
const respirar = () => mock.timers.tick(61_000); // vacía la ventana del límite `hw` (10 escrituras por minuto)

// ---------- Criterio 1: la función pura ----------

test("contenido: tipos admitidos y ventana exportados", async () => {
  const { TIPOS_SUBIDA, VENTANA_CONTENIDO } = await cargar();
  assert.deepEqual([...TIPOS_SUBIDA], ["drawio", "svg", "kicad_sch", "kicad_pcb"]);
  assert.ok(Object.isFrozen(TIPOS_SUBIDA), "la lista no se puede ampliar en tiempo de ejecución");
  assert.equal(VENTANA_CONTENIDO, 4096);
});

test("contenido: reconoce los cuatro tipos con lo que se tolera (BOM, espacios, declaración XML; comentarios y DOCTYPE solo en SVG)", async () => {
  const { tipoPorContenido } = await cargar();
  const casos = [
    [DRAWIO, "drawio"],
    ["<mxfile>", "drawio"],
    ["<mxfile/>", "drawio"],
    ["﻿<mxfile host=\"x\">", "drawio"],
    [" \t\r\n<mxfile\nhost=\"x\">", "drawio"],
    ['<?xml version="1.0" encoding="UTF-8"?>\n<mxfile host="x">', "drawio"],
    ['﻿  <?xml version="1.0"?><mxfile>', "drawio"],
    [SVG, "svg"],
    ['<svg xmlns="http://www.w3.org/2000/svg">', "svg"],
    ["<svg>", "svg"],
    ["<svg/>", "svg"],
    ["<svg\n  width=\"1\">", "svg"],
    ["<!-- Created with Inkscape -->\n<svg>", "svg"],
    ['﻿<?xml version="1.0"?>\n<!-- a -->\n<!-- b --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg>', "svg"],
    [SCH, "kicad_sch"],
    ["(kicad_sch (version 20211123)", "kicad_sch"],
    ["(kicad_sch)", "kicad_sch"],
    ["﻿\n  (kicad_sch\n\t(version 1))", "kicad_sch"],
    [PCB, "kicad_pcb"],
    ["(kicad_pcb\n\t(version 20240108)", "kicad_pcb"],
  ];
  for (const [texto, tipo] of casos) assert.equal(tipoPorContenido(enc(texto)), tipo, JSON.stringify(texto.slice(0, 80)));
});

test("contenido: todo lo demás es null (mayúsculas, prefijos parecidos, prólogos no tolerados, truncado, UTF-16, fuera de la ventana)", async () => {
  const { tipoPorContenido, VENTANA_CONTENIDO } = await cargar();
  const textos = [
    "",
    "   \n",
    "<MXFILE>",
    "<mxfilex>",
    "<mxfile", // termina antes de saber si la etiqueta sigue
    "<mx:mxfile>",
    "<!-- c --><mxfile>", // comentarios y DOCTYPE solo antes de <svg>
    '<!DOCTYPE mxfile><mxfile>',
    "<SVG>",
    "<svgx>",
    "<svg:svg>",
    "<svg",
    "<html><svg>",
    "texto<svg>",
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg>', // DOCTYPE con subconjunto interno
    "<!-- sin cerrar <svg>",
    '<!-- c --><?xml version="1.0"?><svg>', // la declaración solo puede ir primero
    '<?xml version="1.0"?><?xml version="1.0"?><svg>', // una sola declaración
    '<?xml-stylesheet href="a.css"?><svg>',
    "﻿﻿<svg>", // un solo BOM
    "(KICAD_SCH)",
    "( kicad_sch)",
    "(kicad_schematic)",
    "(kicad_sch",
    "(kicad_pcbnew)",
    '<?xml version="1.0"?>(kicad_sch)', // KiCad no lleva prólogo XML
    "<!-- c -->(kicad_pcb)",
    "x(kicad_pcb)",
  ];
  for (const t of textos) assert.equal(tipoPorContenido(enc(t)), null, JSON.stringify(t));

  assert.equal(tipoPorContenido(PNG), null, "PNG");
  const utf16 = new Uint8Array([0xff, 0xfe, ...[..."<svg>"].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.equal(tipoPorContenido(utf16), null, "UTF-16 LE con BOM");

  // Solo cuentan los primeros VENTANA_CONTENIDO bytes, aunque se pasen más.
  assert.equal(tipoPorContenido(enc(" ".repeat(VENTANA_CONTENIDO - 6) + "<svg>")), "svg", "la raíz cabe entera dentro de la ventana");
  assert.equal(tipoPorContenido(enc(" ".repeat(VENTANA_CONTENIDO) + "<svg>")), null, "la raíz empieza fuera de la ventana");
  assert.equal(tipoPorContenido(enc(`<!--${"x".repeat(VENTANA_CONTENIDO)}--><svg>`)), null, "un comentario que llena la ventana");

  for (const raro of [undefined, null, "<svg>", [60, 115, 118, 103, 62], new ArrayBuffer(4)]) {
    assert.equal(tipoPorContenido(raro), null, `entrada que no es Uint8Array: ${Object.prototype.toString.call(raro)}`);
  }
});

// ---------- Criterio 2: con token, solo los cuatro tipos ----------

test("token: una extensión fuera de los cuatro tipos da 400 `tipo` sin tocar R2 ni gastar el límite", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  const casos = [
    ["placa.png", PNG],
    ["plano.pdf", enc("%PDF-1.7\n")],
    ["proyecto.kicad_pro", enc("{}")],
    ["pieza.step", enc("ISO-10303-21;")],
    ["dibujo.excalidraw", enc('{"type":"excalidraw"}')],
    ["datos.csv", enc("a,b\n")],
  ];
  for (let i = 0; i < 11; i++) {
    const [nombre, contenido] = casos[i % casos.length];
    const res = await subirArchivo(env, { bearer: token, id: uuid(i), nombre, contenido });
    assert.equal(res.status, 400, nombre);
    const json = await res.json();
    assert.equal(json.codigo, "tipo", nombre);
    assert.equal(json.error, "Tipo de archivo no permitido con este token", nombre);
  }
  assert.equal(env.ARCHIVOS.objetos.size, 0, "nada llega a R2");
  assert.deepEqual(await adjuntos(env), []);
  // 11 rechazos y el límite sigue intacto: la comprobación va antes de `limitar`.
  assert.equal((await subirArchivo(env, { bearer: token, id: uuid(50), nombre: "a.drawio", contenido: DRAWIO })).status, 201);
});

test("token: los cuatro tipos con contenido correcto se suben (201) y R2 guarda los bytes sin cambios", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  const grande = DRAWIO.replace("<mxGraphModel/>", `<mxGraphModel>${"<mxCell/>".repeat(2000)}</mxGraphModel>`); // > ventana
  assert.ok(enc(grande).length > 4096);
  const casos = [
    [uuid(1), "placa.drawio", DRAWIO, "drawio"],
    [uuid(2), "placa.svg", SVG, "svg"],
    [uuid(3), "placa.kicad_sch", SCH, "kicad_sch"],
    [uuid(4), "placa.kicad_pcb", PCB, "kicad_pcb"],
    [uuid(5), "grande.drawio", grande, "drawio"],
    [uuid(6), "con-bom.svg", "﻿<svg/>", "svg"],
  ];
  for (const [id, nombre, contenido, tipo] of casos) {
    const res = await subirArchivo(env, { bearer: token, id, nombre, contenido });
    assert.equal(res.status, 201, nombre);
    assert.deepEqual(await res.json(), { id, nombre, tipo });
    assert.deepEqual(await bajar(env, id), enc(contenido), `${nombre}: bytes íntegros`);
  }
});

// ---------- Criterio 3: contenido que no cuadra con token ----------

test("token: contenido que no cuadra con la extensión → 400 `contenido`, el objeto se borra de R2 y el id queda libre", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  const casos = [
    ["placa.drawio", PNG],
    ["placa.drawio", SVG],
    ["placa.svg", DRAWIO],
    ["placa.svg", "<html><body><svg/></body></html>"],
    ["placa.kicad_sch", PCB],
    ["placa.kicad_pcb", SCH],
    ["placa.kicad_sch", "hola"],
  ];
  for (const [i, [nombre, contenido]] of casos.entries()) {
    const res = await subirArchivo(env, { bearer: token, id: uuid(i), nombre, contenido });
    assert.equal(res.status, 400, nombre);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const json = await res.json();
    assert.equal(json.codigo, "contenido", nombre);
    assert.equal(json.error, "El contenido no corresponde al tipo de archivo", nombre);
  }
  assert.equal(env.ARCHIVOS.objetos.size, 0, "cada objeto subido se borró");
  assert.deepEqual(await adjuntos(env), [], "ningún metadato apunta a nada");
  respirar();
  // El mismo id se puede volver a usar con el contenido correcto (no quedó ni en la lista ni en la papelera).
  const otra = await subirArchivo(env, { bearer: token, id: uuid(0), nombre: "placa.drawio", contenido: DRAWIO });
  assert.equal(otra.status, 201);
  assert.equal(env.ARCHIVOS.objetos.size, 1);
});

test("token: el cuerpo llega en trozos pequeños y la decisión se toma igual (cabecera partida entre trozos)", async () => {
  const { env } = crearEnv();
  const { token } = insertarToken(env, { login: EDITOR });
  const bien = await subirEnTrozos(env, { bearer: token, id: uuid(1), nombre: "a.svg", contenido: SVG, tam: 3 });
  assert.equal(bien.status, 201);
  assert.deepEqual(await bajar(env, uuid(1)), enc(SVG));
  const pcb = await subirEnTrozos(env, { bearer: token, id: uuid(2), nombre: "a.kicad_pcb", contenido: PCB, tam: 1 });
  assert.equal(pcb.status, 201);
  const mal = await subirEnTrozos(env, { bearer: token, id: uuid(3), nombre: "a.drawio", contenido: SVG, tam: 2 });
  assert.equal(mal.status, 400);
  assert.equal((await mal.json()).codigo, "contenido");
  assert.equal(env.ARCHIVOS.objetos.size, 2, "solo quedan los dos buenos");
});

// ---------- Criterio 4: con cookie no cambia nada en este lote ----------

test("cookie: la subida web no valida el contenido ni restringe los tipos (sin cambios en G3)", async () => {
  const { env } = crearEnv();
  const cookie = sesion(EDITOR);
  const casos = [
    [uuid(1), "placa.png", PNG, "png"],
    [uuid(2), "placa.drawio", PNG, "drawio"],
    [uuid(3), "placa.svg", enc(DRAWIO), "svg"],
    [uuid(4), "placa.kicad_sch", enc("hola"), "kicad_sch"],
  ];
  for (const [id, nombre, contenido, tipo] of casos) {
    const res = await subirArchivo(env, { cookie, id, nombre, contenido });
    assert.equal(res.status, 201, nombre);
    assert.deepEqual(await res.json(), { id, nombre, tipo });
  }
  assert.equal(env.ARCHIVOS.objetos.size, 4);
});

test("token: las reglas de siempre van antes (editor, Content-Length, tope de TIPOS sin cambios)", async () => {
  const { env } = crearEnv();
  const lectora = insertarToken(env, { login: "ana" });
  const editor = insertarToken(env, { login: EDITOR });
  const no = await subirArchivo(env, { bearer: lectora.token, id: uuid(1), nombre: "a.png", contenido: PNG });
  assert.equal(no.status, 403, "quien no es editor sigue recibiendo el 403 de permiso, antes del tipo");
  // Tope de drawio (10 MB, TIPOS) sin cambios: se declara de más y se corta antes de leer.
  const { TIPOS } = await import("../lib/archivos-nombre.mjs");
  const res = await subirArchivo(env, { bearer: editor.token, id: uuid(2), nombre: "a.drawio", contenido: DRAWIO });
  assert.equal(res.status, 201);
  assert.equal(TIPOS.drawio.max, 10 * 1024 * 1024);
  assert.equal(TIPOS.svg.max, 10 * 1024 * 1024);
  assert.equal(TIPOS.kicad_sch.max, 50 * 1024 * 1024);
  assert.equal(TIPOS.kicad_pcb.max, 50 * 1024 * 1024);
});
