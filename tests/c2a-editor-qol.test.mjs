// C2a: QoL del editor de hardware. Lógica pura en src/lib/hardware-editor.ts (atajo Ctrl/Cmd+S, aviso al salir con
// cambios, enlaces de la misma disciplina, debounce de la vista previa, mensajes de la papelera) y comprobaciones
// estáticas de la página, el script y los estilos (papelera con interfaz, vista previa en vivo lado a lado / por pestañas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const PAGINA = "src/pages/[project]/[disciplina].astro";
const SCRIPT = "src/scripts/hardware-editor.ts";
const CSS = "src/styles/global.css";

let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/hardware-editor.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `no se pudo importar src/lib/hardware-editor.ts: ${fallo?.message}`);
  return lib;
};

// ---------- Ctrl+S / Cmd+S ----------

test("esAtajoGuardar: Ctrl+S y Cmd+S (también con Bloq Mayús); no con Alt (AltGr), Mayús, otra tecla ni durante composición", () => {
  const { esAtajoGuardar } = L();
  const si = [
    { key: "s", ctrlKey: true },
    { key: "S", ctrlKey: true },
    { key: "s", metaKey: true },
    { key: "s", ctrlKey: true, repeat: true },
  ];
  const no = [
    { key: "s" },
    { key: "s", ctrlKey: true, altKey: true },
    { key: "s", ctrlKey: true, shiftKey: true },
    { key: "d", ctrlKey: true },
    { key: "s", ctrlKey: true, isComposing: true },
    { key: "Enter", ctrlKey: true },
  ];
  for (const e of si) assert.equal(esAtajoGuardar(e), true, JSON.stringify(e));
  for (const e of no) assert.equal(esAtajoGuardar(e), false, JSON.stringify(e));
});

// ---------- aviso de cambios sin guardar ----------

test("debeAvisarSalida: solo si se está editando y el texto difiere del guardado", () => {
  const { debeAvisarSalida } = L();
  assert.equal(debeAvisarSalida({ editando: true, actual: "# a\nb", base: "# a" }), true);
  assert.equal(debeAvisarSalida({ editando: true, actual: "# a", base: "# a" }), false);
  assert.equal(debeAvisarSalida({ editando: false, actual: "# a\nb", base: "# a" }), false);
});

test("esEnlaceDeLaDisciplina: misma origen y ruta /<proyecto>/<disciplina>/; no otras disciplinas, otros orígenes, anclas ni javascript:", () => {
  const { esEnlaceDeLaDisciplina } = L();
  const actual = "https://docs.example/uuv/electronica/?p=pcb";
  const casos = [
    ["?p=potencia", true],
    ["/uuv/electronica/?p=potencia", true],
    ["/uuv/electronica/", true],
    ["https://docs.example/uuv/electronica/?p=arquitectura", true],
    ["/uuv/mecanica/?p=ensamble", false],
    ["/uuv/", false],
    ["https://otro.example/uuv/electronica/?p=pcb", false],
    ["#comentarios", false],
    ["?p=pcb#capas", false],
    ["javascript:alert(1)", false],
    ["http://[", false],
  ];
  for (const [href, esperado] of casos) assert.equal(esEnlaceDeLaDisciplina(href, actual, "uuv", "electronica"), esperado, href);
});

// ---------- vista previa en vivo ----------

test("vista previa: constantes del lado a lado (64rem) y del retardo (≤ 300 ms)", () => {
  const { MEDIA_LADO_A_LADO, DEBOUNCE_PREVIA_MS } = L();
  assert.equal(MEDIA_LADO_A_LADO, "(min-width: 64rem)");
  assert.ok(Number.isInteger(DEBOUNCE_PREVIA_MS) && DEBOUNCE_PREVIA_MS >= 100 && DEBOUNCE_PREVIA_MS <= 300, String(DEBOUNCE_PREVIA_MS));
});

test("crearDebounce: agrupa llamadas seguidas, usa los últimos argumentos y se puede cancelar", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { crearDebounce } = L();
  const vistos = [];
  const d = crearDebounce((x) => vistos.push(x), 200);
  d("a");
  d("b");
  t.mock.timers.tick(199);
  assert.deepEqual(vistos, []);
  d("c");
  t.mock.timers.tick(199);
  assert.deepEqual(vistos, [], "cada llamada reinicia la espera");
  t.mock.timers.tick(1);
  assert.deepEqual(vistos, ["c"]);
  d("d");
  d.cancelar();
  t.mock.timers.tick(1000);
  assert.deepEqual(vistos, ["c"], "cancelar descarta la pendiente (al cerrar el editor)");
});

// ---------- papelera: mensajes ----------

test("resultadoRestaurarPapelera: 200 ok; 409 existe, 409 candado y 404 con mensajes propios; el resto, mensajeError", () => {
  const { resultadoRestaurarPapelera, mensajeError, MENSAJE_CANDADO } = L();
  assert.deepEqual(resultadoRestaurarPapelera(200, { json: { pagina: {} } }), { ok: true, mensaje: "" });
  const existe = resultadoRestaurarPapelera(409, { json: { codigo: "existe" } });
  assert.equal(existe.ok, false);
  assert.match(existe.mensaje, /ya (hay|existe)/i);
  assert.equal(resultadoRestaurarPapelera(409, { json: { codigo: "candado" } }).mensaje, MENSAJE_CANDADO);
  const no = resultadoRestaurarPapelera(404, { json: {} });
  assert.match(no.mensaje, /papelera/i);
  assert.notEqual(no.mensaje, mensajeError(404), "no dice 'No se encontró la página' a secas");
  assert.equal(resultadoRestaurarPapelera(403).mensaje, mensajeError(403));
  assert.equal(resultadoRestaurarPapelera(0, { fallo: "timeout" }).mensaje, mensajeError("timeout"));
});

// ---------- página ----------

test("[disciplina].astro: papelera solo para editores, en un diálogo con título, lista y estado aria-live", () => {
  const src = leer(PAGINA);
  assert.match(src, /<button[^>]*data-hw-abrir-papelera[^>]*>|<button[^>]*>[^<]*Papelera/, "botón Papelera");
  const boton = src.match(/<button[^>]*data-hw-abrir-papelera[^>]*>/)?.[0] ?? "";
  assert.match(boton, /aria-haspopup="dialog"/);
  assert.match(boton, /type="button"/);
  const contenedor = src.match(/<[^>]*data-hw-solo-editor[^>]*>[^]*?data-hw-abrir-papelera/)?.[0] ?? "";
  assert.ok(contenedor, "el botón está dentro de un bloque data-hw-solo-editor");
  const dlg = src.match(/<dialog[^>]*id="hw-papelera"[^>]*>[^]*?<\/dialog>/)?.[0] ?? "";
  assert.ok(dlg, "dialog#hw-papelera");
  assert.match(dlg, /aria-labelledby="hw-papelera-titulo"/);
  assert.match(dlg, /<h2 id="hw-papelera-titulo">Papelera<\/h2>/);
  assert.match(dlg, /<(ul|ol)[^>]*data-hw-papelera-lista/);
  assert.match(dlg, /data-hw-papelera-estado[^>]*aria-live="polite"|aria-live="polite"[^>]*data-hw-papelera-estado/);
  assert.match(dlg, /<button type="button"[^>]*data-hw-no[^>]*>Cerrar<\/button>/);
});

test("[disciplina].astro: editor con cuerpo de dos paneles (escribir y vista previa) y ayuda de Ctrl+S", () => {
  const src = leer(PAGINA);
  const form = src.match(/<form class="hw-editor"[^]*?<\/form>/)?.[0] ?? "";
  const cuerpo = form.match(/<div class="hw-editor-cuerpo"[^]*?data-hw-previa[^>]*>/)?.[0] ?? "";
  assert.ok(cuerpo, ".hw-editor-cuerpo envuelve los dos paneles");
  assert.match(cuerpo, /id="hw-panel-escribir"/);
  assert.match(form, /role="tablist"/, "las pestañas siguen para móvil");
  assert.match(form, /<kbd>Ctrl<\/kbd>\s*\+\s*<kbd>S<\/kbd>/, "la ayuda menciona Ctrl+S");
});

// ---------- script ----------

test("hardware-editor.ts: Ctrl/Cmd+S en el editor evita el guardar del navegador y guarda sin salir", () => {
  const js = leer(SCRIPT);
  assert.match(js, /esAtajoGuardar\(e\)/);
  const bloque = js.match(/esAtajoGuardar\(e\)[^]{0,400}/)?.[0] ?? "";
  assert.match(bloque, /preventDefault\(\)/, "preventDefault siempre que sea el atajo, aunque no se guarde");
  assert.match(js, /guardar\(\{\s*salir:\s*false\s*\}\)/, "el atajo guarda sin cerrar el editor");
  assert.match(js, /guardar\(\{\s*salir:\s*true\s*\}\)/, "el botón Guardar mantiene su comportamiento (cierra)");
  assert.match(js, /baseMd\s*=\s*\w+\.json\.pagina\.md|baseMd\s*=\s*pagina\.md/, "tras guardar, la base del aviso de cambios se actualiza");
});

test("hardware-editor.ts: vista previa en vivo con debounce y lado a lado según matchMedia", () => {
  const js = leer(SCRIPT);
  assert.match(js, /matchMedia\(MEDIA_LADO_A_LADO\)/);
  assert.match(js, /crearDebounce\(/);
  assert.match(js, /DEBOUNCE_PREVIA_MS/);
  assert.match(js, /escuchar\(textarea,\s*"input"/, "la previa se actualiza al escribir");
  assert.match(js, /pintarMd\(previa,\s*textarea\.value,\s*pagina\?\.titulo\)/, "reutiliza el renderizador de lectura");
  assert.match(js, /\.cancelar\(\)/, "al cerrar el editor se cancela la previa pendiente");
});

test("hardware-editor.ts: aviso de cambios sin guardar al navegar dentro de la disciplina y al Cancelar", () => {
  const js = leer(SCRIPT);
  assert.match(js, /debeAvisarSalida\(/);
  assert.match(js, /esEnlaceDeLaDisciplina\(/);
  const nav = js.match(/esEnlaceDeLaDisciplina\([^]{0,600}/)?.[0] ?? "";
  assert.match(nav, /preventDefault\(\)/);
  assert.match(nav, /preguntar\(dlgDescartar\)/, "usa el mismo diálogo que Cancelar");
  assert.match(js, /beforeunload/);
  assert.match(js, /escuchar\(btnCancelar,[^]{0,200}preguntar\(dlgDescartar\)/);
});

test("hardware-editor.ts: papelera por la API (listar y restaurar), DOM con textContent y foco devuelto al cerrar", () => {
  const js = leer(SCRIPT);
  assert.match(js, /papelera:\s*"1"/, "GET ?papelera=1");
  assert.match(js, /accion:\s*"restaurar-papelera"/);
  assert.match(js, /resultadoRestaurarPapelera\(/);
  assert.match(js, /#hw-papelera/);
  assert.match(js, /data-hw-abrir-papelera/);
  assert.match(js, /Restaurar «\$\{/, "cada botón dice qué página restaura");
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|outerHTML\s*=/, "sin HTML crudo");
  assert.match(js, /btnPapelera\.focus\(\)/, "al cerrar, el foco vuelve al botón Papelera");
});

// ---------- estilos ----------

test("global.css: lado a lado desde 64rem (pestañas ocultas) y papelera con tokens de tema", () => {
  const css = leer(CSS);
  const media = css.match(/@media \(min-width: 64rem\)\s*\{[^]*?\n\}/g) ?? [];
  const lado = media.find((b) => b.includes(".hw-editor-cuerpo")) ?? "";
  assert.ok(lado, "@media (min-width: 64rem) con .hw-editor-cuerpo");
  assert.match(lado, /grid-template-columns/);
  assert.match(lado, /\.hw-pestanas[^{]*\{[^}]*display:\s*none/);
  assert.match(css, /\.hw-editor-cuerpo\s*\{/);
  const pap = css.match(/\.hw-papelera[^{]*\{[^}]*\}/g) ?? [];
  assert.ok(pap.length, "estilos .hw-papelera");
  for (const r of pap) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgb\(/i, `sin colores fijos: ${r}`);
});
