// Comentarios por página, lote 7b: interfaz (estático sobre fuentes). Componente al pie de cada página de la wiki, script
// empaquetado sin inline (CSP por hash), DOM seguro (sin innerHTML), carga perezosa, estados, foco y estilos con tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SLUG = "src/pages/[project]/[...slug].astro";
const COMP = "src/components/Comentarios.astro";
const SCRIPT = "src/scripts/comentarios.ts";
const leer = (p) => {
  assert.ok(exists(p), `falta ${p}`);
  return read(p);
};

// ---------- 6. Componente e inclusión ----------
test("[...slug].astro incluye <Comentarios> con la ruta de la página e importa el script empaquetado", () => {
  const src = read(SLUG);
  assert.match(src, /import Comentarios from "\.\.\/\.\.\/components\/Comentarios\.astro"/);
  assert.match(src, /<Comentarios\b[^>]*\bpagina=\{route\}/);
  assert.match(src, /<script>[^]*import\s+["']\.\.\/\.\.\/scripts\/comentarios(\.ts)?["'][^]*<\/script>/);
});

test("solo en la wiki: grafo, novedades e índice del proyecto no tienen comentarios", () => {
  for (const f of ["src/pages/[project]/grafo.astro", "src/pages/[project]/novedades.astro", "src/pages/[project]/index.astro"]) {
    assert.doesNotMatch(read(f), /Comentarios|scripts\/comentarios/, f);
  }
});

test("Comentarios.astro: section fuera de Pagefind, encabezado, estado aria-live y lista", () => {
  const src = leer(COMP);
  assert.match(src, /<section[^>]*class="comentarios"[^>]*data-pagefind-ignore="all"|<section[^>]*data-pagefind-ignore="all"[^>]*class="comentarios"/);
  assert.match(src, /<section[^>]*aria-labelledby="comentarios-titulo"/);
  // Lote 8a: el h2 envuelve el botón de despliegue (ver comentarios-plegado.test.mjs).
  assert.match(src, /<h2[^>]*id="comentarios-titulo"[^>]*>[^]*?Comentarios[^]*?<\/h2>/);
  assert.match(src, /data-pagina=\{pagina\}/);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /Cargando comentarios/);
  assert.match(src, /<ol[^>]*data-comentarios-lista/);
});

test("Comentarios.astro: formulario con selector de tipo, textarea de 2000 con contador y botón Enviar, todo con label", () => {
  const src = leer(COMP);
  assert.match(src, /<form[^>]*data-comentarios-form/);
  assert.match(src, /<label[^>]*for="comentario-tipo"/);
  assert.match(src, /<select[^>]*id="comentario-tipo"[^>]*name="tipo"|<select[^>]*name="tipo"[^>]*id="comentario-tipo"/);
  for (const [v, t] of [["duda", "Duda"], ["aclaracion", "Aclaración"], ["sugerencia", "Sugerencia"], ["bug", "Bug"]]) {
    assert.match(src, new RegExp(`<option value="${v}"[^>]*>${t}</option>`), v);
  }
  assert.match(src, /<label[^>]*for="comentario-texto"/);
  assert.match(src, /<textarea[^>]*id="comentario-texto"/);
  assert.match(src, /<textarea[^>]*maxlength="2000"/);
  assert.match(src, /aria-describedby="comentario-contador"/);
  assert.match(src, /id="comentario-contador"[^>]*>0\/2000</);
  assert.match(src, /<button[^>]*type="submit"[^>]*>Enviar<\/button>/);
});

test("Comentarios.astro: <dialog> de confirmación de borrado como rutas-reiniciar y sin is:inline", () => {
  const src = leer(COMP);
  assert.match(src, /<dialog[^>]*class="atajos-dialog"[^>]*id="comentarios-borrar"[^>]*aria-labelledby="comentarios-borrar-titulo"/);
  assert.match(src, /id="comentarios-borrar-titulo"[^>]*>Borrar comentario</);
  assert.match(src, /<button[^>]*type="button"[^>]*data-borrar-ok[^>]*>Borrar<\/button>/);
  assert.match(src, /<button[^>]*type="button"[^>]*data-borrar-cancelar[^>]*>Cancelar<\/button>/);
  assert.doesNotMatch(src, /is:inline|<script/);
});

// ---------- 7. Script ----------
test("comentarios.ts: usa la lógica pura de src/lib/comentarios.ts y no pinta HTML como texto", () => {
  const src = leer(SCRIPT);
  assert.match(src, /from\s+["']\.\.\/lib\/comentarios(\.ts)?["']/);
  for (const f of ["armarHilos", "fechaRelativa", "tipoInfo", "mensajeError", "acciones", "urlComentarios", "opcionesEscritura", "contador"]) {
    assert.match(src, new RegExp(`\\b${f}\\b`), f);
  }
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML\s*=|document\.write|\beval\(|new Function/);
  assert.match(src, /textContent/);
  assert.match(src, /createElement\(\s*["']time["']\s*\)/);
  assert.match(src, /\.dateTime\s*=|setAttribute\(\s*["']datetime["']/);
});

test("comentarios.ts: carga perezosa con IntersectionObserver y sin cache del navegador", () => {
  const src = leer(SCRIPT);
  assert.match(src, /new IntersectionObserver\(/);
  assert.match(src, /\.disconnect\(\)|\.unobserve\(/, "pide los comentarios una sola vez");
  assert.match(src, /cache:\s*["']no-store["']/);
  assert.match(src, /credentials:\s*["']same-origin["']|opcionesEscritura/);
  assert.doesNotMatch(src, /fetch\(\s*["'`]https?:/, "solo same-origin");
});

test("comentarios.ts: estados de vacío, editado, borrado, resuelto y errores de red", () => {
  const src = leer(SCRIPT);
  assert.match(src, /Aún no hay comentarios\. Sé el primero\./);
  assert.match(src, /\(editado\)/);
  assert.match(src, /Comentario borrado/);
  assert.match(src, /Responder/);
  assert.match(src, /Editar/);
  assert.match(src, /Borrar/);
  assert.match(src, /mensajeError\(\s*["']red["']/, "un fallo de fetch (local o sin red) usa el mensaje de red");
  assert.match(src, /Retry-After/);
  assert.match(src, /showModal\(/);
});

test("comentarios.ts: foco al abrir respuesta o edición y de vuelta al cerrar; botones reales", () => {
  const src = leer(SCRIPT);
  assert.ok((src.match(/\.focus\(/g) ?? []).length >= 2, "mueve el foco al abrir y lo devuelve al enviar o cancelar");
  assert.match(src, /createElement\(\s*["']button["']\s*\)/);
  assert.match(src, /\.type\s*=\s*["']button["']/);
  assert.match(src, /Cancelar/);
  assert.match(src, /aria-label|setAttribute\(\s*["']aria-/, "los campos de respuesta y edición tienen nombre accesible");
});

test("CSP: la CSP sigue con solo el hash del tema", () => {
  assert.match(read("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
  assert.doesNotMatch(read(SLUG), /is:inline/);
});

// ---------- 8. Estilos ----------
test("global.css: estilos de comentarios con tokens (sin colores fijos), chips por tipo y resuelto atenuado", () => {
  const css = read("src/styles/global.css");
  const reglas = css
    .replace(/@media print\s*\{[^]*?\n\}/, "")
    .split("\n")
    .filter((l) => /\.comentario|\.chip-(duda|aclaracion|sugerencia|bug|otro)/.test(l));
  assert.ok(reglas.length > 0, "faltan reglas .comentarios en global.css");
  for (const l of reglas) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
  for (const t of ["duda", "aclaracion", "sugerencia", "bug"]) assert.match(css, new RegExp(`\\.chip-${t}\\b[^{]*\\{[^}]*var\\(--`), t);
  assert.match(css, /\.comentario[^{]*(\.resuelto|\[data-resuelto\])[^{]*\{[^}]*opacity/);
  assert.match(css, /\.comentario[^{]*\{[^}]*overflow-wrap:\s*anywhere/, "texto largo sin desbordar a 375 px");
  assert.match(css, /\.comentario[^{]*\{[^}]*white-space:\s*pre-wrap/, "respeta los saltos de línea sin HTML");
});

test("impresión: la sección de comentarios se oculta", () => {
  const css = read("src/styles/global.css");
  const print = css.match(/@media print\s*\{[^]*?\n\}/)?.[0] ?? "";
  assert.match(print, /\.comentarios[,\s]/);
});
