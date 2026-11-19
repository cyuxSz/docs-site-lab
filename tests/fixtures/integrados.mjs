// Utilidades de los tests del lote e-integrados: localizar un Python 3.10+, ejecutar tools/integrados.py y leer lo que genera
// (biblioteca de diagrams.net y SVG de vista previa). El generador no existe todavía: `generar` falla con un mensaje claro.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

export const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
export const GENERADOR = join(RAIZ, "tools", "integrados.py");

const PRUEBA = "import sys; print(sys.executable) if sys.version_info >= (3, 10) else sys.exit(1)";
const CANDIDATOS = [
  ["python3"],
  ["python"],
  ["uv", "run", "--no-project", "--python", "3.12", "python"],
];

// Prueba los candidatos en orden y devuelve la ruta del intérprete real (así `uv` solo se paga una vez). En Windows `python3` y
// `python` pueden ser el alias de la Microsoft Store, que no ejecuta nada: por eso se exige que imprima `sys.executable`.
function localizarPython() {
  for (const [cmd, ...args] of CANDIDATOS) {
    const r = spawnSync(cmd, [...args, "-c", PRUEBA], { encoding: "utf8", timeout: 120_000, windowsHide: true });
    const ruta = (r.stdout || "").trim().split(/\r?\n/).pop();
    if (r.status === 0 && ruta && existsSync(ruta)) return ruta;
  }
  return null;
}

export const PYTHON = localizarPython();
// Opción para `test(nombre, SIN_PYTHON, fn)`: sin intérprete el test se salta con el motivo a la vista, no pasa en falso.
export const SIN_PYTHON = PYTHON
  ? {}
  : { skip: "no hay Python 3.10+ (se probó python3, python y `uv run --no-project --python 3.12 python`)" };

export function carpetaTemporal() {
  return mkdtempSync(join(tmpdir(), "integrados-"));
}

// Ejecuta el generador con los argumentos dados. `env` se suma al entorno (p. ej. PYTHONHASHSEED).
export function correr(args, { env = {}, cwd = RAIZ } = {}) {
  assert.ok(existsSync(GENERADOR), "falta tools/integrados.py (el generador todavía no existe)");
  const r = spawnSync(PYTHON, [GENERADOR, ...args], {
    encoding: "utf8", cwd, timeout: 60_000, windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", ...env },
  });
  return { codigo: r.status, salida: r.stdout || "", error: r.stderr || "" };
}

// Escribe `contenido` (texto o Buffer) como `nombre` en una carpeta temporal nueva y corre el generador sobre él.
// Devuelve además `dir` (carpeta de salida, que no existe antes de correr) y `base` (carpeta temporal).
export function generar(nombre, contenido, opciones = {}) {
  const base = carpetaTemporal();
  const entrada = join(base, nombre);
  writeFileSync(entrada, contenido);
  const dir = join(base, "salida");
  const r = correr(["--entrada", entrada, "--salida", dir], opciones);
  return { ...r, dir, base, entrada };
}

export function generarBien(nombre, contenido, opciones) {
  const r = generar(nombre, contenido, opciones);
  assert.equal(r.codigo, 0, `el generador debía terminar con 0; stderr: ${r.error}`);
  return r;
}

export function archivos(dir) {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function xml(texto, que) {
  try {
    return new JSDOM(texto, { contentType: "application/xml" }).window.document;
  } catch (e) {
    assert.fail(`${que} no es XML bien formado: ${e.message}`);
  }
}

const hijos = (el) => [...el.children];

// Lee `<mxlibrary>[…]</mxlibrary>`: el contenido es un texto JSON (sin elementos hijos) con una entrada por integrado, y el campo
// `xml` de cada entrada es un `<mxGraphModel>` sin comprimir. Devuelve, por entrada, sus celdas ya interpretadas.
export function leerBiblioteca(ruta) {
  const crudo = readFileSync(ruta, "utf8");
  const doc = xml(crudo, "la biblioteca");
  const raiz = doc.documentElement;
  assert.equal(raiz.nodeName, "mxlibrary", "la raíz de la biblioteca es <mxlibrary>");
  assert.equal(raiz.children.length, 0, "<mxlibrary> solo lleva texto (JSON), ningún elemento hijo");
  let entradas;
  try {
    entradas = JSON.parse(raiz.textContent);
  } catch (e) {
    assert.fail(`el contenido de <mxlibrary> no es JSON: ${e.message}`);
  }
  assert.ok(Array.isArray(entradas), "el JSON de la biblioteca es una lista");
  return entradas.map((e) => {
    assert.equal(typeof e.xml, "string", "cada entrada lleva `xml`");
    assert.ok(e.xml.startsWith("<mxGraphModel"), "`xml` va sin comprimir y empieza por <mxGraphModel");
    const modelo = xml(e.xml, `el modelo de «${e.title}»`);
    const nombres = new Set([...modelo.querySelectorAll("*")].map((n) => n.nodeName));
    const celdas = [...modelo.querySelectorAll("mxCell")].map((c) => {
      const geo = hijos(c).find((n) => n.nodeName === "mxGeometry");
      const num = (a) => (geo && geo.hasAttribute(a) ? Number(geo.getAttribute(a)) : null);
      return {
        id: c.getAttribute("id"), padre: c.getAttribute("parent"), valor: c.getAttribute("value"),
        estilo: c.getAttribute("style") || "", vertice: c.getAttribute("vertex") === "1",
        conectable: c.getAttribute("connectable"), ancho: num("width"), alto: num("height"),
      };
    });
    const cuerpo = celdas.find((c) => c.id === "cuerpo");
    const etiquetas = cuerpo ? celdas.filter((c) => c.padre === "cuerpo") : [];
    return { ...e, modelo, nombres, celdas, cuerpo, etiquetas };
  });
}

// Puntos de conexión del cuerpo: `points=[[x,y,0],…]` dentro del estilo.
export function puntos(estilo) {
  const m = /(?:^|;)points=(\[\[.*?\]\])(?:;|$)/.exec(estilo);
  assert.ok(m, `el estilo del cuerpo no trae points=[[…]]: ${estilo}`);
  return JSON.parse(m[1]);
}

export function ladoDePunto([x, y]) {
  if (x === 0 && y > 0 && y < 1) return "izquierda";
  if (x === 1 && y > 0 && y < 1) return "derecha";
  if (y === 0 && x > 0 && x < 1) return "arriba";
  if (y === 1 && x > 0 && x < 1) return "abajo";
  return `fuera del borde (${x}, ${y})`;
}

// Lee un SVG de vista previa. `pines` sale de los `<g class="pin">` en orden de documento.
export function leerSvg(ruta) {
  const crudo = readFileSync(ruta, "utf8");
  const doc = xml(crudo, `el SVG ${ruta}`);
  const raiz = doc.documentElement;
  const pines = [...doc.querySelectorAll("g.pin")].map((g) => ({
    numero: g.getAttribute("data-numero"), nombre: g.getAttribute("data-nombre"),
    lado: g.getAttribute("data-lado"), tipo: g.getAttribute("data-tipo"),
    textos: [...g.querySelectorAll("text")].map((t) => t.textContent),
  }));
  const titulo = hijos(raiz).find((n) => n.nodeName === "title");
  return { crudo, doc, raiz, pines, titulo: titulo ? titulo.textContent : null };
}

export const resumen = (pines) => pines.map((p) => `${p.lado}:${p.numero}:${p.nombre}:${p.tipo}`);

export { existsSync, mkdirSync, readFileSync, writeFileSync, join };
