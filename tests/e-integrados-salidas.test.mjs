// Lote e-integrados · criterios 4, 5, 7 y 8: la biblioteca de diagrams.net, el SVG de vista previa, la salida determinista y
// el escapado de nombres (un nombre de pin malicioso no inyecta marcado ni escribe fuera de la carpeta de salida).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  SIN_PYTHON, archivos, generarBien, join, ladoDePunto, leerBiblioteca, leerSvg, puntos, readFileSync,
} from "./fixtures/integrados.mjs";

const CSV = [
  "integrado,pin,nombre,lado,tipo",
  "NE555,2,TRIG,izquierda,entrada",
  "NE555,6,THR,izquierda,entrada",
  "NE555,5,CV,izquierda,entrada",
  "NE555,3,OUT,derecha,salida",
  "NE555,7,DIS,derecha,",
  "NE555,8,VCC,arriba,alimentacion",
  "NE555,4,RESET,arriba,entrada",
  "NE555,1,GND,abajo,alimentacion",
  "MINI,1,A,izquierda,",
  "",
].join("\n");

const PINES = [["2", "TRIG"], ["6", "THR"], ["5", "CV"], ["3", "OUT"], ["7", "DIS"], ["8", "VCC"], ["4", "RESET"], ["1", "GND"]];

// ── Criterio 4: biblioteca ──────────────────────────────────────────────────────────────────────────────────────────
test("biblioteca: <mxlibrary> con un JSON de entradas {xml, w, h, aspect, title}, una por integrado", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV);
  const crudo = readFileSync(join(r.dir, "chips.xml"), "utf8");
  assert.match(crudo, /^<mxlibrary>\[.*\]<\/mxlibrary>\n$/s, "el archivo es exactamente <mxlibrary>[…]</mxlibrary> y un salto de línea");
  const bib = leerBiblioteca(join(r.dir, "chips.xml"));
  assert.equal(bib.length, 2);
  for (const e of bib) {
    assert.deepEqual(Object.keys(e).filter((k) => ["xml", "w", "h", "aspect", "title"].includes(k)).sort(), ["aspect", "h", "title", "w", "xml"]);
    assert.equal(e.aspect, "fixed");
    assert.ok(Number.isFinite(e.w) && e.w > 0 && Number.isFinite(e.h) && e.h > 0, "w y h son números positivos");
    assert.deepEqual([...e.nombres].sort(), ["mxCell", "mxGeometry", "mxGraphModel", "root"], "el modelo solo usa los elementos de mxGraph");
  }
});

test("biblioteca: el cuerpo es una caja con el nombre del integrado y un punto de conexión por pin en su lado", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV);
  const [ne] = leerBiblioteca(join(r.dir, "chips.xml"));
  const { cuerpo } = ne;
  assert.ok(cuerpo, "hay una celda con id «cuerpo»");
  assert.ok(cuerpo.vertice, "el cuerpo es un vértice");
  assert.equal(cuerpo.padre, "1", "el cuerpo cuelga de la capa por defecto (id 1)");
  assert.equal(cuerpo.valor, "NE555");
  assert.equal(cuerpo.ancho, ne.w, "w de la entrada = ancho del cuerpo");
  assert.equal(cuerpo.alto, ne.h, "h de la entrada = alto del cuerpo");
  const pts = puntos(cuerpo.estilo);
  assert.deepEqual(pts.map(ladoDePunto), ["izquierda", "izquierda", "izquierda", "derecha", "derecha", "arriba", "arriba", "abajo"]);
  assert.equal(new Set(pts.map(([x, y]) => `${x},${y}`)).size, 8, "ningún punto de conexión se repite");
  const izq = pts.slice(0, 3).map(([, y]) => y);
  assert.deepEqual(izq, [...izq].sort((a, b) => a - b), "en un lado vertical los pines bajan en el orden de la tabla");
  const arriba = pts.slice(5, 7).map(([x]) => x);
  assert.deepEqual(arriba, [...arriba].sort((a, b) => a - b), "en un lado horizontal van de izquierda a derecha");
});

test("biblioteca: cada pin tiene dos etiquetas hijas del cuerpo (número y nombre), no conectables y en texto plano", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV);
  const [ne, mini] = leerBiblioteca(join(r.dir, "chips.xml"));
  assert.equal(ne.etiquetas.length, 16, "8 pines → 16 etiquetas");
  // Orden: por pin (izquierda, derecha, arriba, abajo), primero el número y luego el nombre.
  assert.deepEqual(ne.etiquetas.map((c) => c.valor), PINES.flat());
  for (const c of ne.etiquetas) {
    assert.ok(c.vertice, "las etiquetas son vértices");
    assert.equal(c.conectable, "0", "las etiquetas no son conectables: las conexiones van a los puntos del cuerpo");
    assert.ok(c.ancho > 0 && c.alto > 0, "cada etiqueta tiene geometría");
  }
  for (const c of ne.celdas) assert.doesNotMatch(c.estilo, /(^|;)html=1/, "ninguna celda usa html=1 (el valor se pinta como texto)");
  assert.equal(new Set(ne.celdas.map((c) => c.id)).size, ne.celdas.length, "los id de las celdas no se repiten");
  assert.deepEqual(mini.etiquetas.map((c) => c.valor), ["1", "A"]);
});

test("biblioteca: el tamaño crece con los pines y un integrado de un solo pin sigue siendo una caja válida", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV);
  const [ne, mini] = leerBiblioteca(join(r.dir, "chips.xml"));
  assert.ok(ne.h > mini.h, "más pines por lado → más alto");
  assert.ok(mini.w >= 40 && mini.h >= 40, "tamaño mínimo razonable");
  for (const e of [ne, mini]) {
    assert.equal(e.w % 10, 0, "w es múltiplo de 10 (rejilla de diagrams.net)");
    assert.equal(e.h % 10, 0, "h es múltiplo de 10");
  }
});

// ── Criterio 5: SVG ─────────────────────────────────────────────────────────────────────────────────────────────────
test("SVG: un archivo por integrado, autocontenido, con <title>, tamaño y un <g class=\"pin\"> por pin", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV);
  assert.deepEqual(archivos(r.dir), ["chips.xml", "mini.svg", "ne555.svg"]);
  const svg = leerSvg(join(r.dir, "ne555.svg"));
  assert.equal(svg.raiz.nodeName, "svg");
  assert.equal(svg.raiz.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(svg.titulo, "NE555", "<title> es hijo directo de <svg> y lleva el nombre del integrado");
  const [, , vw, vh] = (svg.raiz.getAttribute("viewBox") || "").split(/\s+/).map(Number);
  assert.ok(vw > 0 && vh > 0, "viewBox con ancho y alto positivos");
  assert.equal(Number(svg.raiz.getAttribute("width")), vw);
  assert.equal(Number(svg.raiz.getAttribute("height")), vh);
  assert.equal(svg.pines.length, 8);
  for (const [i, [numero, nombre]] of PINES.entries()) {
    const p = svg.pines[i];
    assert.equal(p.numero, numero);
    assert.equal(p.nombre, nombre);
    assert.ok(p.textos.includes(numero), `el pin ${numero} rotula su número`);
    assert.ok(p.textos.includes(nombre), `el pin ${numero} rotula su nombre`);
  }
  const textos = [...svg.doc.querySelectorAll("text")].map((t) => t.textContent);
  assert.ok(textos.includes("NE555"), "el nombre del integrado se ve en el dibujo");
});

test("SVG: solo formas y texto con colores propios (se ve igual en tema claro y oscuro dentro de un <img>)", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV);
  const svg = leerSvg(join(r.dir, "ne555.svg"));
  const permitidos = new Set(["svg", "title", "desc", "g", "rect", "line", "circle", "path", "polyline", "text"]);
  for (const el of svg.doc.querySelectorAll("*")) {
    assert.ok(permitidos.has(el.nodeName), `elemento no permitido en la vista previa: <${el.nodeName}>`);
    for (const a of el.attributes) {
      assert.doesNotMatch(a.name, /^on/i, `atributo de evento: ${a.name}`);
      assert.doesNotMatch(a.name, /href$/i, `enlace o recurso externo: ${a.name}`);
      assert.doesNotMatch(a.value, /url\(|javascript:|currentColor/i, `valor no permitido en ${a.name}`);
    }
  }
  const fondo = [...svg.raiz.children].find((n) => n.nodeName === "rect");
  assert.ok(fondo && /^#[0-9a-f]{3,6}$/i.test(fondo.getAttribute("fill") || ""), "el primer <rect> es un fondo opaco con color fijo");
});

// ── Criterio 7: determinismo ────────────────────────────────────────────────────────────────────────────────────────
const bytes = (dir) => Object.fromEntries(readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f)).toString("base64")]));

test("determinismo: misma entrada → mismos bytes, sin depender de PYTHONHASHSEED ni de los saltos de línea de la entrada", SIN_PYTHON, () => {
  const a = generarBien("chips.csv", CSV, { env: { PYTHONHASHSEED: "0" } });
  const b = generarBien("chips.csv", CSV, { env: { PYTHONHASHSEED: "12345" } });
  const c = generarBien("chips.csv", CSV.replaceAll("\n", "\r\n"), { env: { PYTHONHASHSEED: "7" } });
  assert.equal(Object.keys(bytes(a.dir)).length, 3);
  assert.deepEqual(bytes(b.dir), bytes(a.dir), "dos corridas dan los mismos bytes");
  assert.deepEqual(bytes(c.dir), bytes(a.dir), "CRLF en la entrada (git autocrlf en Windows) no cambia la salida");
});

test("determinismo: UTF-8 sin BOM, solo LF y sin fechas ni rutas de la máquina en la salida", SIN_PYTHON, () => {
  const r = generarBien("chips.csv", CSV.replace("TRIG", "Señal µ"));
  for (const f of archivos(r.dir)) {
    const buf = readFileSync(join(r.dir, f));
    assert.notDeepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${f}: sin BOM`);
    assert.ok(!buf.includes(13), `${f}: sin retornos de carro`);
    assert.equal(buf.at(-1), 10, `${f}: termina en un salto de línea`);
    const texto = buf.toString("utf8");
    assert.ok(!texto.includes(r.base) && !texto.includes(r.base.replaceAll("\\", "/")), `${f}: sin rutas locales`);
    assert.doesNotMatch(texto, /20\d\d-\d\d-\d\d/, `${f}: sin fechas`);
  }
  assert.ok(readFileSync(join(r.dir, "ne555.svg"), "utf8").includes("Señal µ"), "los acentos se escriben tal cual en UTF-8");
});

// ── Criterio 8: escapado ────────────────────────────────────────────────────────────────────────────────────────────
const MALO_CHIP = `X</mxlibrary><script>alert(1)</script>`;
const MALO_PIN = `"><img src=x onerror=alert(1)>&amp;'</text>]]>`;
const MALO_NUM = `<b>1</b>&lt;`;
const csvCampo = (s) => `"${s.replaceAll('"', '""')}"`;
const CSV_MALO = `integrado,pin,nombre,lado\n${csvCampo(MALO_CHIP)},${csvCampo(MALO_NUM)},${csvCampo(MALO_PIN)},izquierda\n`;

test("escapado: nombres con marcado llegan intactos como texto a la biblioteca, sin crear elementos", SIN_PYTHON, () => {
  const r = generarBien("malo.csv", CSV_MALO);
  const [e] = leerBiblioteca(join(r.dir, "malo.xml")); // ya comprueba: XML bien formado, <mxlibrary> sin hijos, JSON válido
  assert.equal(e.title, MALO_CHIP);
  assert.deepEqual([...e.nombres].sort(), ["mxCell", "mxGeometry", "mxGraphModel", "root"]);
  assert.equal(e.cuerpo.valor, MALO_CHIP);
  assert.deepEqual(e.etiquetas.map((c) => c.valor), [MALO_NUM, MALO_PIN]);
  for (const c of e.celdas) {
    assert.doesNotMatch(c.estilo, /img|script|onerror|alert/i, "los nombres nunca entran al estilo");
    assert.doesNotMatch(c.estilo, /(^|;)html=1/);
  }
});

test("escapado: el SVG de un nombre malicioso sigue siendo solo formas y texto", SIN_PYTHON, () => {
  const r = generarBien("malo.csv", CSV_MALO);
  const [nombre] = archivos(r.dir).filter((f) => f.endsWith(".svg"));
  const svg = leerSvg(join(r.dir, nombre));
  assert.equal(svg.titulo, MALO_CHIP);
  assert.deepEqual(svg.pines.map((p) => [p.numero, p.nombre]), [[MALO_NUM, MALO_PIN]]);
  assert.ok(svg.pines[0].textos.includes(MALO_PIN) && svg.pines[0].textos.includes(MALO_NUM));
  const nombres = new Set([...svg.doc.querySelectorAll("*")].map((n) => n.nodeName));
  for (const n of ["script", "img", "b", "foreignObject", "a", "image", "use", "style"]) assert.ok(!nombres.has(n), `no debe existir <${n}>`);
  for (const el of svg.doc.querySelectorAll("*")) for (const a of el.attributes) assert.doesNotMatch(a.name, /^on/i);
});

test("escapado: el nombre del integrado no decide rutas: el SVG se llama por su slug y queda dentro de la carpeta de salida", SIN_PYTHON, () => {
  const csv = "integrado,pin,nombre,lado\n../../Fuera de Aquí,1,A,izquierda\n..\\..\\otro,1,A,izquierda\nC:/x/STM32F4 (LQFP-64),1,A,izquierda\n";
  const r = generarBien("rutas.csv", csv);
  const lista = archivos(r.dir);
  assert.equal(lista.length, 4, "la biblioteca y tres SVG");
  for (const f of lista) assert.match(f, /^[a-z0-9][a-z0-9._-]*\.(svg|xml)$/, `nombre de archivo no seguro: ${f}`);
  assert.deepEqual(lista, ["c-x-stm32f4-lqfp-64.svg", "fuera-de-aqui.svg", "otro.svg", "rutas.xml"], "slug: sin acentos, en minúsculas y con guiones");
  assert.deepEqual(archivos(r.base), ["rutas.csv", "salida"], "nada se escribe fuera de la carpeta de salida");
  assert.deepEqual(leerBiblioteca(join(r.dir, "rutas.xml")).map((e) => e.title), ["../../Fuera de Aquí", "..\\..\\otro", "C:/x/STM32F4 (LQFP-64)"]);
});
