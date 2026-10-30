// Lote 8a "Limpiar la página": la sección de comentarios arranca plegada ("+ Comentarios (n)"), el formulario nuevo
// queda detrás de "Agregar comentario", indicador visual de carga y contador con el texto recortado (BAJAs del lote 7b).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const COMP = "src/components/Comentarios.astro";
const SCRIPT = "src/scripts/comentarios.ts";
const tag = (src, marca) => src.match(new RegExp(`<[a-z0-9]+[^>]*${marca}[^>]*>`))?.[0] ?? "";

let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/comentarios.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `falta src/lib/comentarios.ts (${fallo?.code ?? fallo?.message})`);
  return lib;
};
const c = (id, extra = {}) => ({ id, padre: null, autor: "ana", tipo: "duda", texto: "x", creado: `2026-10-0${id.length}T00:00:00Z`, editado: null, resuelto: false, resueltoPor: null, borrado: false, ...extra });

// ---------- Lógica pura ----------
test("contador: usa el texto recortado, igual que textoValido", () => {
  const { contador } = L();
  assert.equal(contador("  hola \n"), "4/2000");
  assert.equal(contador("   "), "0/2000");
  assert.equal(contador(" a b "), "3/2000", "los espacios internos sí cuentan");
});

test("contarAbiertos: comentarios no borrados fuera de hilos resueltos; huérfanas no cuentan; lista rara da 0", () => {
  const { contarAbiertos } = L();
  assert.equal(typeof contarAbiertos, "function", "falta contarAbiertos en src/lib/comentarios.ts");
  assert.equal(contarAbiertos([]), 0);
  assert.equal(contarAbiertos(null), 0);
  assert.equal(contarAbiertos([c("a"), c("bb"), c("ccc", { padre: "a" })]), 3);
  assert.equal(contarAbiertos([c("a", { borrado: true }), c("bb", { padre: "a" })]), 1, "la raíz borrada no cuenta; su respuesta sí");
  assert.equal(contarAbiertos([c("a", { resuelto: true }), c("bb", { padre: "a" }), c("ccc")]), 1, "un hilo resuelto no cuenta, con sus respuestas");
  assert.equal(contarAbiertos([c("a"), c("bb", { padre: "zzz" })]), 1, "respuesta huérfana");
  assert.equal(contarAbiertos([c("a"), c("bb", { padre: "a", borrado: true })]), 1);
});

test("etiquetaComentarios: 'Comentarios' antes de cargar y 'Comentarios (n)' después", () => {
  const { etiquetaComentarios } = L();
  assert.equal(typeof etiquetaComentarios, "function", "falta etiquetaComentarios en src/lib/comentarios.ts");
  assert.equal(etiquetaComentarios(null), "Comentarios");
  assert.equal(etiquetaComentarios(0), "Comentarios (0)");
  assert.equal(etiquetaComentarios(12), "Comentarios (12)");
});

// ---------- Marcado ----------
test("Comentarios.astro: el título es un botón de despliegue plegado, con signo decorativo y etiqueta", () => {
  const src = read(COMP);
  assert.match(src, /<h2[^>]*id="comentarios-titulo"[^>]*>\s*<button/, "el botón va dentro del h2 (sigue nombrando la sección)");
  const b = tag(src, "data-comentarios-toggle");
  assert.match(b, /^<button[^>]*type="button"/);
  assert.match(b, /aria-expanded="false"/);
  assert.match(b, /aria-controls="comentarios-cuerpo"/);
  assert.match(src, /<span[^>]*aria-hidden="true"[^>]*data-comentarios-signo[^>]*>\+<\/span>|<span[^>]*data-comentarios-signo[^>]*aria-hidden="true"[^>]*>\+<\/span>/);
  assert.match(src, /<span[^>]*data-comentarios-etiqueta[^>]*>Comentarios<\/span>/);
});

test("Comentarios.astro: cuerpo oculto con estado, lista y botón 'Agregar comentario'; el formulario arranca oculto", () => {
  const src = read(COMP);
  const cuerpo = tag(src, 'id="comentarios-cuerpo"');
  assert.ok(cuerpo, "falta #comentarios-cuerpo");
  assert.match(cuerpo, /\bhidden\b/);
  const ini = src.indexOf('id="comentarios-cuerpo"');
  const dentro = src.slice(ini);
  for (const m of ["data-comentarios-estado", "data-comentarios-lista", "data-comentarios-agregar", "data-comentarios-form"]) assert.ok(dentro.includes(m), `${m} va dentro del cuerpo`);
  const agregar = tag(src, "data-comentarios-agregar");
  assert.match(agregar, /^<button[^>]*type="button"/);
  assert.match(agregar, /aria-expanded="false"/);
  assert.match(agregar, /aria-controls="comentarios-form"/);
  assert.match(src, /data-comentarios-agregar[^>]*>\s*Agregar comentario\s*</);
  const form = tag(src, "data-comentarios-form");
  assert.match(form, /id="comentarios-form"/);
  assert.match(form, /\bhidden\b/);
  assert.match(src, /<button[^>]*type="button"[^>]*data-comentarios-cancelar[^>]*>Cancelar<\/button>/);
});

test("Comentarios.astro: el estado arranca con indicador de carga (data-cargando)", () => {
  assert.match(tag(read(COMP), "data-comentarios-estado"), /data-cargando/);
});

// ---------- Script ----------
test("comentarios.ts: despliega y pliega con aria-expanded, actualiza la etiqueta con el número tras cargar", () => {
  const s = read(SCRIPT);
  assert.match(s, /data-comentarios-toggle/);
  assert.match(s, /setAttribute\(\s*["']aria-expanded["']/);
  assert.match(s, /etiquetaComentarios\(\s*contarAbiertos\(/);
  assert.match(s, /data-comentarios-signo|comentariosSigno/);
  assert.match(s, /new IntersectionObserver\(/, "sigue la carga perezosa (para tener n antes de desplegar)");
});

test("comentarios.ts: 'Agregar comentario' muestra el formulario y enfoca el textarea; Cancelar lo oculta y devuelve el foco", () => {
  const s = read(SCRIPT);
  assert.match(s, /data-comentarios-agregar/);
  assert.match(s, /data-comentarios-cancelar/);
  assert.match(s, /form\.hidden\s*=\s*false/);
  assert.match(s, /form\.hidden\s*=\s*true/);
  assert.match(s, /texto\.focus\(\)/);
  assert.match(s, /agregar\.focus\(\)/, "al cancelar o tras enviar, el foco vuelve a 'Agregar comentario'");
});

test("comentarios.ts: quita el indicador de carga cuando termina (con o sin error)", () => {
  const s = read(SCRIPT);
  assert.match(s, /removeAttribute\(\s*["']data-cargando["']|delete\s+estado\.dataset\.cargando|toggleAttribute\(\s*["']data-cargando["']/);
});

// ---------- Estilos ----------
test("global.css: indicador de carga animado con tokens y sin animación con reduced-motion; botón de despliegue con tokens", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /\.comentarios-estado\[data-cargando\][^{]*\{[^}]*(animation|var\(--)/);
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{[^}]*\.comentarios-estado\[data-cargando\]/);
  assert.match(css, /\.comentarios-toggle[^{]*\{[^}]*var\(--/);
});
