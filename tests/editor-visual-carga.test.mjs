// Editor visual: estado de carga y fallo de carga. Mientras se descarga y monta Crepe se ve «Cargando editor…» (role=status y
// aria-busy en el contenedor) y Adjuntar, Insertar diagrama/PDF/BOM y Guardar (también Ctrl/Cmd+S) quedan desactivados, para
// que nada entre en el textarea oculto ni se pierda. Si el import() falla se pasa a modo Markdown con un mensaje propio y las
// acciones se reactivan. Además, el texto de ayuda del modo visual es una lista corta que explica Esc y luego Tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const PAGINA = "src/pages/[project]/[disciplina].astro";
const SCRIPT = "src/scripts/hardware-editor.ts";
const lib = await import("../src/lib/hardware-editor.ts");
const funcion = (js, cabecera) => js.match(new RegExp(`${cabecera}[^]*?\\r?\\n  \\}\\r?\\n`))?.[0] ?? "";

// ---------- lógica pura ----------

test("estadoGuardar: mientras carga el editor visual, Guardar está deshabilitado (sin romper la firma de dos argumentos)", () => {
  const { estadoGuardar } = lib;
  assert.equal(estadoGuardar(0, false, true).deshabilitado, true);
  assert.equal(estadoGuardar(0, false, false).deshabilitado, false);
  assert.equal(estadoGuardar(0, false).deshabilitado, false, "el tercer argumento es opcional");
  assert.equal(estadoGuardar(2, false, false).deshabilitado, true);
});

test("insercionBloqueada: Adjuntar e Insertar quedan bloqueados mientras se guarda o mientras carga el editor visual", () => {
  const { insercionBloqueada } = lib;
  assert.equal(typeof insercionBloqueada, "function", "src/lib/hardware-editor.ts exporta insercionBloqueada(guardando, cargandoVisual)");
  assert.equal(insercionBloqueada(false, false), false);
  assert.equal(insercionBloqueada(true, false), true);
  assert.equal(insercionBloqueada(false, true), true);
  assert.equal(insercionBloqueada(true, true), true);
});

test("MENSAJE_CARGANDO_EDITOR y MENSAJE_FALLO_VISUAL: textos en español", () => {
  assert.equal(lib.MENSAJE_CARGANDO_EDITOR, "Cargando editor…");
  assert.equal(typeof lib.MENSAJE_FALLO_VISUAL, "string");
  assert.match(lib.MENSAJE_FALLO_VISUAL, /editor visual/i, "dice qué falló");
  assert.match(lib.MENSAJE_FALLO_VISUAL, /Markdown/, "dice que se sigue en modo Markdown");
});

// ---------- página ----------

test("[disciplina].astro: indicador «Cargando editor…» con role=status dentro del formulario, oculto de inicio", () => {
  const form = leer(PAGINA).match(/<form class="hw-editor"[^]*?<\/form>/)?.[0] ?? "";
  const el = form.match(/<(\w+)[^>]*data-hw-cargando-visual[^>]*>([^<]*)<\/\1>/);
  assert.ok(el, "elemento [data-hw-cargando-visual] en el formulario");
  assert.match(el[0], /role="status"/);
  assert.match(el[0], /\shidden[\s>]/, "oculto hasta que empieza la carga");
  assert.equal(el[2], "Cargando editor…");
});

test("[disciplina].astro: la ayuda del modo visual es una lista corta que explica Esc y luego Tab desde cualquier sitio", () => {
  const src = leer(PAGINA);
  const ul = src.match(/<ul[^>]*id="hw-ayuda-visual"[^>]*>([^]*?)<\/ul>/);
  assert.ok(ul, "#hw-ayuda-visual es una <ul>");
  assert.match(ul[0], /data-hw-ayuda-visual/, "el script la sigue encontrando");
  assert.match(src, /data-hw-modo-markdown[^>]*aria-describedby="hw-ayuda-visual"/, "sigue describiendo el conmutador");
  const items = ul[1].match(/<li>[^]*?<\/li>/g) ?? [];
  assert.ok(items.length >= 3 && items.length <= 5, `entre 3 y 5 puntos (hay ${items.length})`);
  const texto = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  for (const li of items) assert.ok(texto(li).length <= 90, `punto corto: «${texto(li)}»`);
  assert.ok(texto(ul[1]).length <= 320, "la ayuda entera es corta");
  const esc = items.find((li) => /<kbd>Esc<\/kbd>/.test(li) && /<kbd>Tab<\/kbd>/.test(li));
  assert.ok(esc, "un punto explica Esc y luego Tab");
  assert.doesNotMatch(texto(esc), /bloque de código/i, "Esc y Tab vale desde cualquier sitio, no solo en código");
  assert.ok(items.some((li) => /<kbd>(Ctrl|Cmd)<\/kbd>\+<kbd>S<\/kbd>/.test(li)), "guardar con Ctrl/Cmd+S");
  assert.ok(items.some((li) => /lista/i.test(li) && /tabla/i.test(li)), "Tab sangra en listas y cambia de celda en tablas");
});

// ---------- script ----------

test("hardware-editor.ts: montarVisual marca la carga (cargandoVisual, aria-busy y el indicador) antes de esperar el import()", () => {
  const js = leer(SCRIPT);
  assert.match(js, /let cargandoVisual = false;/);
  assert.match(js, /\[data-hw-cargando-visual\]/, "el script usa el indicador de la página");
  const m = funcion(js, "async function montarVisual");
  assert.ok(m, "montarVisual");
  const antes = m.slice(0, m.indexOf("await"));
  assert.match(antes, /cargandoVisual = true/, "se marca antes del primer await");
  assert.match(antes, /actualizarGuardar\(/, "y se desactivan las acciones antes del primer await");
  assert.match(js, /setAttribute\("aria-busy", "true"\)/);
  assert.match(js, /removeAttribute\("aria-busy"\)|setAttribute\("aria-busy", "false"\)/);
});

test("hardware-editor.ts: al terminar (montado, fallo o abandonado) se quita la carga y se reactivan las acciones", () => {
  const m = funcion(leer(SCRIPT), "async function montarVisual");
  const fin = m.match(/finally \{[^]*?\r?\n    \}/)?.[0] ?? "";
  assert.ok(fin, "un finally en montarVisual (vale para montado, fallo y generación abandonada)");
  assert.match(fin, /cargandoVisual = false/);
  assert.match(fin, /actualizarGuardar\(/);
});

test("hardware-editor.ts: actualizarGuardar desactiva Guardar, Adjuntar e Insertar también mientras carga el editor visual", () => {
  const f = funcion(leer(SCRIPT), "function actualizarGuardar");
  assert.match(f, /estadoGuardar\(subidasActivas, guardando, cargandoVisual\)/);
  assert.match(f, /insercionBloqueada\(guardando, cargandoVisual\)/);
  for (const b of ["inputArchivo", "btnInsertarDiagrama", "btnInsertarPdf", "btnInsertarBom"]) {
    const linea = f.match(new RegExp(`${b}\\.disabled = ([^;]+);`))?.[1];
    assert.ok(linea, `${b}.disabled se asigna en actualizarGuardar`);
    assert.notEqual(linea.trim(), "guardando", `${b} también depende de la carga del editor visual`);
  }
});

test("hardware-editor.ts: guardar (botón y Ctrl/Cmd+S) no hace nada mientras carga el editor visual", () => {
  const g = funcion(leer(SCRIPT), "async function guardar\\(");
  const inicio = g.split(/\r?\n/).slice(0, 4).join("\n");
  assert.match(inicio, /if \([^)]*cargandoVisual[^)]*\) return;/, "salida temprana al principio de guardar()");
});

test("hardware-editor.ts: si falla el import() se pasa a modo Markdown con MENSAJE_FALLO_VISUAL", () => {
  const js = leer(SCRIPT);
  assert.match(js, /MENSAJE_FALLO_VISUAL/);
  const m = funcion(js, "async function montarVisual");
  const captura = m.match(/catch \{[^]*?\r?\n    \}/)?.[0] ?? "";
  assert.ok(captura, "catch en montarVisual");
  assert.match(captura, /modoMarkdown = true/);
  assert.match(captura, /mostrarModo\(\)/);
  assert.match(captura, /errorEditor\(MENSAJE_FALLO_VISUAL\)/);
  assert.match(captura, /textarea\.focus\(\)/);
});
