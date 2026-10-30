// QoL de lectura (src/lib/lectura.ts), lógica pura: búsquedas recientes y sugerencias del buscador, términos y
// coincidencias para resaltar el término buscado, tiempo de lectura y nivel de cada página, y ajustes de letra y ancho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenSeguro } from "../src/lib/rutas.ts";
import {
  CLAVE_RECIENTES,
  MAX_RECIENTES,
  MAX_TERMINO,
  limpiarTermino,
  recientes,
  agregarReciente,
  borrarRecientes,
  SUGERIDAS,
  sugerenciasBusqueda,
  PARAM_RESALTADO,
  terminosResaltado,
  coincidencias,
  PALABRAS_POR_MINUTO,
  contarPalabras,
  minutosLectura,
  UMBRAL_CITAS,
  nivelPagina,
  CLAVE_LETRA,
  CLAVE_ANCHO,
  LETRAS,
  ANCHOS,
  normalizarLetra,
  normalizarAncho,
} from "../src/lib/lectura.ts";

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const nuevo = () => {
  const ls = memoria();
  return { ls, a: almacenSeguro(() => ls) };
};
const roto = () =>
  almacenSeguro(() => {
    throw new Error("SecurityError");
  });

// --- Búsquedas recientes ---
test("constantes del buscador", () => {
  assert.equal(CLAVE_RECIENTES, "busqueda:recientes");
  assert.equal(MAX_RECIENTES, 5);
  assert.equal(MAX_TERMINO, 80);
  assert.equal(PARAM_RESALTADO, "q");
});

test("limpiarTermino: recorta, colapsa espacios, quita caracteres de control y corta a MAX_TERMINO", () => {
  assert.equal(limpiarTermino("  hola\u0000   mundo \n"), "hola mundo");
  assert.equal(limpiarTermino("x".repeat(500)).length, MAX_TERMINO);
  assert.equal(limpiarTermino("a"), "", "menos de 2 caracteres no es búsqueda");
  assert.equal(limpiarTermino(42), "");
  assert.equal(limpiarTermino(null), "");
});

test("agregarReciente: al frente, sin duplicados (sin distinguir mayúsculas) y máximo 5", () => {
  const { ls, a } = nuevo();
  assert.deepEqual(recientes(a), []);
  agregarReciente(a, "pid");
  agregarReciente(a, "launch");
  assert.deepEqual(agregarReciente(a, "PID"), ["PID", "launch"]);
  for (const t of ["uno", "dos", "tres", "cuatro", "cinco"]) agregarReciente(a, t);
  assert.deepEqual(recientes(a), ["cinco", "cuatro", "tres", "dos", "uno"]);
  assert.equal(JSON.parse(ls.getItem(CLAVE_RECIENTES)).length, MAX_RECIENTES);
  agregarReciente(a, " ");
  assert.equal(recientes(a)[0], "cinco", "un término vacío no se guarda");
});

test("recientes: el almacén no es confiable (JSON roto, tipos raros, demasiados)", () => {
  const { ls, a } = nuevo();
  ls.setItem(CLAVE_RECIENTES, "{no es json");
  assert.deepEqual(recientes(a), []);
  ls.setItem(CLAVE_RECIENTES, JSON.stringify({ a: 1 }));
  assert.deepEqual(recientes(a), []);
  ls.setItem(CLAVE_RECIENTES, JSON.stringify([1, null, "ok", "OK", "y".repeat(300), "a", "b2", "c3", "d4", "e5", "f6"]));
  const r = recientes(a);
  assert.equal(r.length, MAX_RECIENTES);
  assert.equal(r[0], "ok");
  assert.ok(r.every((t) => typeof t === "string" && t.length >= 2 && t.length <= MAX_TERMINO));
  assert.ok(!r.includes("OK"), "deduplica sin distinguir mayúsculas");
});

test("borrarRecientes vacía la lista; con almacén roto nada lanza", () => {
  const { a } = nuevo();
  agregarReciente(a, "control");
  borrarRecientes(a);
  assert.deepEqual(recientes(a), []);
  const r = roto();
  assert.doesNotThrow(() => agregarReciente(r, "x1"));
  assert.doesNotThrow(() => borrarRecientes(r));
  assert.deepEqual(recientes(r), []);
});

// --- Sugerencias fijas por proyecto ---
const pg = (path, title, type = "page") => ({ path, route: `/uuv/${path.replace(/\.md$/, "").replace(/(^|\/)index$/, "")}/`, title, type });

test("sugerenciasBusqueda: primero las páginas clave en orden, luego índices de sección; sin meta ni portada; máx. 6", () => {
  assert.deepEqual(SUGERIDAS, ["quickstart.md", "onboarding.md", "architecture/overview.md", "operations/estado.md", "glosario.md", "rutas.md"]);
  const pages = [
    pg("index.md", "Inicio", "index"),
    pg("INSTRUCTIONS.md", "Instrucciones", "meta"),
    pg("packages/index.md", "Paquetes", "index"),
    pg("glosario.md", "Glosario", "reference"),
    pg("quickstart.md", "Inicio rápido", "guide"),
    pg("architecture/index.md", "Arquitectura", "index"),
    pg("architecture/overview.md", "Visión general", "architecture"),
    pg("operations/index.md", "Operación", "index"),
    pg("packages/uuv_control.md", "uuv_control", "component"),
  ];
  const s = sugerenciasBusqueda(pages);
  assert.deepEqual(
    s.map((x) => x.title),
    ["Inicio rápido", "Visión general", "Glosario", "Paquetes", "Arquitectura", "Operación"],
  );
  assert.deepEqual(Object.keys(s[0]).sort(), ["route", "title"]);
  assert.equal(s[0].route, "/uuv/quickstart/");
  assert.equal(sugerenciasBusqueda(pages, 2).length, 2);
  assert.deepEqual(sugerenciasBusqueda([]), []);
});

// --- Resaltado del término buscado ---
test("terminosResaltado: palabras de 2+ caracteres, sin duplicados, máximo 5", () => {
  assert.deepEqual(terminosResaltado(" PID  pid control "), ["PID", "control"]);
  assert.deepEqual(terminosResaltado("a"), []);
  assert.deepEqual(terminosResaltado(null), []);
  assert.deepEqual(terminosResaltado(undefined), []);
  assert.equal(terminosResaltado("uno dos tres cuatro cinco seis siete").length, 5);
  assert.ok(terminosResaltado("x".repeat(500))[0].length <= MAX_TERMINO);
});

test("coincidencias: sin distinguir mayúsculas ni acentos, con índices del texto original", () => {
  assert.deepEqual(coincidencias("El nodo de navegación", ["navegacion"]), [[11, 21]]);
  assert.deepEqual(coincidencias("Navegacion y NAVEGACIÓN", ["navegación"]), [[0, 10], [13, 23]]);
  assert.deepEqual(coincidencias("PID y pid", ["pid"]), [[0, 3], [6, 9]]);
});

test("coincidencias: sin solapes (la más larga gana), ordenadas, y los caracteres especiales son literales", () => {
  assert.deepEqual(coincidencias("controlador", ["control", "controlador"]), [[0, 11]]);
  assert.deepEqual(coincidencias("aaaa", ["aa"]), [[0, 2], [2, 4]]);
  assert.deepEqual(coincidencias("ver /pose y pose", ["pose", "/pose"]), [[4, 9], [12, 16]]);
  assert.deepEqual(coincidencias("a.b axb", ["a.b"]), [[0, 3]]);
  assert.deepEqual(coincidencias("(x+y)*", ["x+y"]), [[1, 4]]);
  assert.deepEqual(coincidencias("texto", []), []);
  assert.deepEqual(coincidencias("", ["pid"]), []);
});

// --- Tiempo de lectura ---
test("contarPalabras: cuenta el texto, no el código, las URLs ni el HTML que agrega el portal", () => {
  assert.equal(PALABRAS_POR_MINUTO, 200);
  assert.equal(contarPalabras("# Título\n\nHola mundo, esto es una prueba."), 7);
  assert.equal(contarPalabras("Ver [el código](https://github.com/o/r/blob/abc/src/a.py#L1-L2) aquí"), 4);
  assert.equal(contarPalabras("Antes\n\n```python\nuno dos tres cuatro\n```\n\nDespués"), 2);
  assert.equal(contarPalabras("Antes\n\n~~~\nuno dos\n~~~\nDespués"), 2);
  assert.equal(contarPalabras('<span class="st st-en_uso" role="img" aria-label="En uso" title="En uso"></span> Activo'), 1);
  assert.equal(contarPalabras("Usa `ros2 launch` ahora"), 4, "el código en línea sí se lee");
  assert.equal(contarPalabras(""), 0);
});

test("minutosLectura: palabras / 200 hacia arriba, mínimo 1", () => {
  const palabras = (n) => Array.from({ length: n }, (_, i) => `p${i}`).join(" ");
  assert.equal(minutosLectura(""), 1);
  assert.equal(minutosLectura(palabras(200)), 1);
  assert.equal(minutosLectura(palabras(201)), 2);
  assert.equal(minutosLectura(palabras(1000)), 5);
  assert.equal(minutosLectura(`${palabras(10)}\n\n\`\`\`\n${palabras(5000)}\n\`\`\``), 1, "el código no suma");
});

// --- Nivel de la página ---
test("nivelPagina: el frontmatter manda (con o sin acento, cualquier caja)", () => {
  assert.deepEqual(nivelPagina({ level: "avanzado", type: "guide", path: "quickstart.md" }), { nivel: "avanzado", etiqueta: "Avanzado", fuente: "frontmatter" });
  assert.deepEqual(nivelPagina({ level: "Básico", type: "component", path: "packages/a.md", claims: 40 }), { nivel: "basico", etiqueta: "Básico", fuente: "frontmatter" });
  assert.equal(nivelPagina({ level: " BASICO ", type: "component", path: "packages/a.md", claims: 40 }).nivel, "basico");
});

test("nivelPagina: heurística documentada cuando no hay level válido", () => {
  assert.equal(UMBRAL_CITAS, 5);
  const h = (d) => nivelPagina(d);
  // Un level inválido se ignora.
  assert.equal(h({ level: "experto", type: "component", path: "packages/a.md", claims: 9 }).fuente, "heuristica");
  // En una ruta por rol: básico.
  assert.equal(h({ type: "component", path: "packages/a.md", claims: 30, enRuta: true }).nivel, "basico");
  // Guías, índices, meta y páginas de entrada: básico (aunque sean reference, como el glosario).
  assert.equal(h({ type: "guide", path: "operations/x.md", claims: 30 }).nivel, "basico");
  assert.equal(h({ type: "index", path: "packages/index.md", claims: 30 }).nivel, "basico");
  assert.equal(h({ type: "reference", path: "glosario.md", claims: 30 }).nivel, "basico");
  // Técnicas (package/component/reference o packages/) con muchas citas: avanzado.
  assert.deepEqual(h({ type: "component", path: "packages/a.md", claims: UMBRAL_CITAS }), { nivel: "avanzado", etiqueta: "Avanzado", fuente: "heuristica" });
  assert.equal(h({ type: "reference", path: "architecture/topics.md", claims: 12 }).nivel, "avanzado");
  assert.equal(h({ type: "page", path: "packages/b.md", claims: 7 }).nivel, "avanzado");
  // Técnicas con pocas citas, o cualquier otra: básico.
  assert.equal(h({ type: "component", path: "packages/a.md", claims: UMBRAL_CITAS - 1 }).nivel, "basico");
  assert.equal(h({ type: "architecture", path: "architecture/overview.md", claims: 20 }).nivel, "basico");
  assert.equal(h({ path: "x.md" }).nivel, "basico");
});

// --- Tamaño de letra y ancho de lectura ---
test("ajustes de lectura: claves, valores y normalización con valor por defecto", () => {
  assert.equal(CLAVE_LETRA, "lectura:letra");
  assert.equal(CLAVE_ANCHO, "lectura:ancho");
  assert.deepEqual([...LETRAS], ["s", "m", "l"]);
  assert.deepEqual([...ANCHOS], ["estrecho", "normal", "ancho"]);
  assert.equal(normalizarLetra("l"), "l");
  assert.equal(normalizarLetra("s"), "s");
  assert.equal(normalizarLetra("xl"), "m");
  assert.equal(normalizarLetra(null), "m");
  assert.equal(normalizarAncho("ancho"), "ancho");
  assert.equal(normalizarAncho("estrecho"), "estrecho");
  assert.equal(normalizarAncho("<script>"), "normal");
  assert.equal(normalizarAncho(undefined), "normal");
});
