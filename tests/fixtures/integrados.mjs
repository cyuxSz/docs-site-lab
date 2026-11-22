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

// ── Lote e-seguimiento ──────────────────────────────────────────────────────────────────────────────────────────────
// Corre el intérprete aislado (-I) con un programa y, si se da, texto por stdin.
export function correrPython(programa, args = [], { entrada } = {}) {
  const r = spawnSync(PYTHON, ["-I", "-c", programa, ...args], {
    encoding: "utf8", timeout: 60_000, windowsHide: true, input: entrada,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
  });
  return { codigo: r.status, salida: r.stdout || "", error: r.stderr || "" };
}

// Detector estático del criterio «solo biblioteca estándar, sin procesos ni ejecución dinámica». Lee el código por stdin y
// escribe AJENOS= (imports que no son de la biblioteca estándar, o relativos), MODULOS= y PROHIBIDO= (lo que no debe usarse).
// Mira imports (también `from os import system` y `import *`), nombres sueltos (`eval`, `getattr`, `__import__`…) y accesos
// por atributo (`os.system`, `os.popen`, `os.exec*`, `os.spawn*`, `sys.modules`, `x.__dict__`…). Es una alarma, no un
// aislamiento: no pretende detectar código ofuscado a propósito.
export const ANALISIS = `
import ast, re, sys
arbol = ast.parse(sys.stdin.buffer.read())
MODULOS_PROHIBIDOS = {
    "subprocess", "socket", "urllib", "http", "ssl", "ftplib", "pickle", "marshal", "shelve", "ctypes", "importlib",
    "multiprocessing", "runpy", "pty", "webbrowser", "builtins", "code", "codeop", "smtplib", "telnetlib", "xmlrpc",
    "asyncio", "concurrent", "imp", "pkgutil", "zipimport", "socketserver", "poplib", "imaplib", "nntplib",
}
NOMBRES = {"eval", "exec", "compile", "__import__", "getattr", "setattr", "globals", "locals", "vars", "__builtins__",
           "breakpoint", "execfile"}
ATRIBUTOS = re.compile(
    r"^(system|popen[0-9]?|startfile|fork|forkpty|posix_spawnp?|exec|eval|exec[lv]p?e?|spawn[lv]p?e?|__import__|import_module"
    r"|modules|__dict__|__builtins__|__globals__|__subclasses__|__getattribute__|__loader__|__spec__)$")
mods, malos = set(), set()
for n in ast.walk(arbol):
    if isinstance(n, ast.Import):
        mods.update(a.name.split(".")[0] for a in n.names)
    elif isinstance(n, ast.ImportFrom):
        mods.add("." * n.level + (n.module or "").split(".")[0])
        for a in n.names:
            if a.name == "*":
                malos.add("import:*")
            elif ATRIBUTOS.match(a.name) or a.name in NOMBRES:
                malos.add("import:" + (n.module or "") + "." + a.name)
    elif isinstance(n, ast.Name) and n.id in NOMBRES:
        malos.add("nombre:" + n.id)
    elif isinstance(n, ast.Attribute) and ATRIBUTOS.match(n.attr):
        malos.add("atributo:" + n.attr)
malos.update("modulo:" + m for m in mods if m in MODULOS_PROHIBIDOS)
print("AJENOS=" + ",".join(sorted(m for m in mods if m.startswith(".") or m not in sys.stdlib_module_names)))
print("MODULOS=" + ",".join(sorted(mods)))
print("PROHIBIDO=" + ",".join(sorted(malos)))
`;

export function analizar(fuente) {
  const r = correrPython(ANALISIS, [], { entrada: fuente });
  assert.equal(r.codigo, 0, `el analizador no pudo leer el código: ${r.error}`);
  const campo = (k) => (new RegExp(`^${k}=(.*)$`, "m").exec(r.salida)?.[1] || "").trim().split(",").filter(Boolean);
  return { ajenos: campo("AJENOS"), modulos: campo("MODULOS"), prohibido: campo("PROHIBIDO") };
}

// Corre `main(argv)` del generador dentro del mismo intérprete con `os.replace` vigilado: anota cada renombrado y, si
// `fallaEn` es N, hace fallar el N-ésimo con un OSError. Devuelve además la lista de renombrados [origen, destino].
const VIGILAR = `
import json, os, runpy, sys
generador, falla_en, argv = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
hechos, real = [], os.replace
def vigilado(origen, destino, *a, **k):
    hechos.append([os.fspath(origen), os.fspath(destino)])
    if len(hechos) == falla_en:
        raise OSError(13, "Permission denied")
    return real(origen, destino, *a, **k)
os.replace = vigilado
modulo = runpy.run_path(generador, run_name="integrados_vigilado")
codigo = modulo["main"](argv)
sys.stdout.flush()
sys.stderr.flush()
print("RENOMBRADOS=" + json.dumps(hechos))
sys.exit(codigo)
`;

export function correrVigilado(args, fallaEn = 0) {
  const r = correrPython(VIGILAR, [GENERADOR, String(fallaEn), ...args]);
  const m = /^RENOMBRADOS=(.*)$/m.exec(r.salida);
  assert.ok(m, `el generador no llegó a terminar bajo vigilancia; stdout: ${r.salida}; stderr: ${r.error}`);
  return { ...r, salida: r.salida.slice(0, m.index), renombrados: JSON.parse(m[1]) };
}

// Caracteres de control que no deben llegar a la terminal ni al log: C0 (sin el salto de línea), DEL y C1.
export const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
// Líneas de un flujo de texto, sin el fin de línea (LF, o CRLF cuando Python escribe en Windows) ni la última vacía.
export const lineas = (texto) => texto.split(/\r?\n/).filter((l, i, t) => i < t.length - 1 || l !== "");

// ── Hilos de CodeRabbit del PR 63 ───────────────────────────────────────────────────────────────────────────────────
// Los bits de permiso POSIX y el umask no existen en Windows: esos tests se saltan allí con el motivo a la vista.
export const SIN_MODOS = !PYTHON
  ? SIN_PYTHON
  : process.platform === "win32"
    ? { skip: "Windows no tiene bits de permiso POSIX ni umask; se comprueba en Linux, donde corre el CI (.github/workflows/build.yml, ubuntu-latest)" }
    : {};

// Corre `main(argv)` del generador con el umask dado (texto octal, p. ej. "022") y `os.open` vigilado: anota cada archivo
// que se crea (ruta y bits de permiso recién creado, leídos con fstat). `tempfile.mkstemp` también pasa por `os.open`.
const VIGILAR_MODOS = `
import json, os, runpy, stat, sys
generador, mascara, argv = sys.argv[1], int(sys.argv[2], 8), sys.argv[3:]
os.umask(mascara)
creados, real = [], os.open
def vigilado(ruta, banderas, *a, **k):
    existia = os.path.lexists(ruta) if "dir_fd" not in k else False
    fd = real(ruta, banderas, *a, **k)
    if banderas & os.O_CREAT and not existia:
        creados.append([os.fsdecode(ruta), stat.S_IMODE(os.fstat(fd).st_mode)])
    return fd
os.open = vigilado
modulo = runpy.run_path(generador, run_name="integrados_vigilado")
codigo = modulo["main"](argv)
sys.stdout.flush()
sys.stderr.flush()
print("CREADOS=" + json.dumps(creados))
sys.exit(codigo)
`;

export function correrConModos(args, mascara = "022") {
  const r = correrPython(VIGILAR_MODOS, [GENERADOR, mascara, ...args]);
  const m = /^CREADOS=(.*)$/m.exec(r.salida);
  assert.ok(m, `el generador no llegó a terminar bajo vigilancia; stdout: ${r.salida}; stderr: ${r.error}`);
  return { ...r, salida: r.salida.slice(0, m.index), creados: JSON.parse(m[1]) };
}
