// Lote 9a "Página limpia" (estático sobre fuentes): barras laterales con ícono y riel estilo Claude Code (sin la fila
// .barras-control), contenido centrado, modo enfoque sin botón flotante, botones de cajón en móvil, favorito como
// estrella junto al H1, barra de ruta solo con ruta activa, slogan de la portada y sin "Copiar cita".
// Scripts empaquetados (CSP por hash, sin inline nuevo), textContent y estilos con tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SLUG = "src/pages/[project]/[...slug].astro";
const css = () => read("src/styles/global.css");
const sinHtml = (f, s) => assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(/, `${f} no pinta HTML`);
// Elementos <button …>…</button> completos que llevan la marca.
const botones = (src, marca) => [...src.matchAll(/<button\b[^>]*>[^]*?<\/button>/g)].map((m) => m[0]).filter((b) => b.slice(0, b.indexOf(">")).includes(marca));
const apertura = (b) => b.slice(0, b.indexOf(">") + 1);
// Reglas (selector + cuerpo) sin anidar cuyo selector menciona `sel`.
const reglasCon = (src, sel) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].includes(sel)).map((m) => m[0]);
const bloquePrint = (src) => {
  const i = src.indexOf("@media print {");
  if (i < 0) return "";
  let d = 0;
  for (let j = src.indexOf("{", i); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) return src.slice(i, j + 1);
  }
  return "";
};
const sinPrint = (src) => src.replace(bloquePrint(src), "");

// ---------- 1. Barras con ícono y riel ----------
test("C1 [...slug].astro: ya no hay fila .barras-control ni botón 'Modo enfoque'", () => {
  const src = read(SLUG);
  assert.doesNotMatch(src, /barras-control/);
  assert.doesNotMatch(src, /data-enfoque-btn|Modo enfoque/);
});

test("C1 [...slug].astro: cada barra tiene su botón solo-ícono (riel) con aria-label, title, aria-expanded y aria-controls", () => {
  const src = read(SLUG);
  for (const [lado, id, nombre] of [["izq", "barra-izq", "navegación"], ["der", "barra-der", "índice"]]) {
    const riel = botones(src, `data-barra="${lado}"`).filter((b) => /class="[^"]*\bbarra-btn\b/.test(apertura(b)));
    assert.equal(riel.length, 1, `falta el botón de riel .barra-btn data-barra="${lado}"`);
    const b = riel[0];
    const a = apertura(b);
    assert.match(a, /type="button"/);
    assert.match(a, new RegExp(`aria-controls="${id}"`));
    assert.match(a, /aria-expanded="true"/);
    assert.match(a, new RegExp(`aria-label="Ocultar ${nombre}"`));
    assert.match(a, new RegExp(`title="Ocultar ${nombre}"`));
    assert.match(b, /<svg\b[^>]*aria-hidden="true"/, "ícono SVG en el marcado, oculto a lectores");
    assert.doesNotMatch(b.replace(/<svg[^]*<\/svg>/, "").replace(/<[^>]+>/g, "").trim(), /\S/, "solo ícono, sin texto visible");
  }
});

test("C1 barras.ts: etiquetas con etiquetaBarra en todos los botones del lado; sin enfoque-btn ni 'Salir del enfoque'", () => {
  const s = read("src/scripts/barras.ts");
  assert.match(s, /\betiquetaBarra\b/);
  assert.match(s, /querySelectorAll[^(]*\(\s*["'`]\[data-barra/, "un lado puede tener dos botones (riel y móvil)");
  assert.match(s, /setAttribute\(\s*["']title["']|\.title\s*=/);
  assert.doesNotMatch(s, /data-enfoque-btn|data-salir-enfoque|aria-pressed/);
  sinHtml("barras.ts", s);
});

test("C1 global.css: riel de 36 px por token y plegado con transición (desactivada con reduced-motion)", () => {
  const c = css();
  assert.match(c, /\.doc-wiki\s*\{[^}]*--riel:\s*36px/);
  const plegada = reglasCon(c, '[data-barra-izq="plegada"]').join("\n");
  assert.match(plegada, /var\(--riel\)/, "la columna plegada queda del ancho del riel");
  assert.match(reglasCon(c, ".barra-btn").join("\n"), /:focus-visible/);
  assert.match(c, /prefers-reduced-motion: reduce\)\s*\{[^}]*\.doc-wiki/);
});

// ---------- 2. Contenido centrado ----------
test("C2 global.css: con las dos barras plegadas el <main> se centra con margin-inline: auto", () => {
  const r = reglasCon(css(), '[data-barra-izq="plegada"][data-barra-der="plegada"]').filter((x) => /main/.test(x.split("{")[0]));
  assert.ok(r.length, 'falta una regla html[data-barra-izq="plegada"][data-barra-der="plegada"] .doc-wiki > main');
  assert.match(r.join("\n"), /margin-inline:\s*auto/);
});

// ---------- 3. Modo enfoque ----------
test("C3 sin botón flotante 'Salir del enfoque' en la página, el script ni el CSS", () => {
  assert.doesNotMatch(read(SLUG), /salir-enfoque|Salir del enfoque/);
  assert.doesNotMatch(css(), /\.salir-enfoque|\.barras-control/);
});

test("C3 global.css: el enfoque deja los dos rieles y oculta migas, estrella y 'Ajustes de texto'", () => {
  const c = css();
  const enfoque = reglasCon(c, "[data-enfoque]");
  const ocultos = enfoque.filter((r) => /display:\s*none/.test(r)).join("\n");
  for (const sel of [".migas", ".favorito-btn", ".lectura-ajustes"]) assert.ok(ocultos.includes(sel), `el enfoque oculta ${sel}`);
  assert.match(enfoque.join("\n"), /var\(--riel\)/, "en enfoque las barras quedan como rieles, no desaparecen");
});

// ---------- 4. Móvil ----------
test("C4 [...slug].astro: botones de cajón (solo ícono) en la cabecera de la página para móvil", () => {
  const src = read(SLUG);
  const caja = src.match(/<div class="barras-movil"[^>]*>[^]*?<\/div>/)?.[0] ?? "";
  assert.ok(caja, "falta <div class=\"barras-movil\"> en la cabecera del <main>");
  assert.match(caja, /^<div[^>]*data-pagefind-ignore="all"/);
  for (const [lado, id] of [["izq", "barra-izq"], ["der", "barra-der"]]) {
    const b = botones(caja, `data-barra="${lado}"`)[0] ?? "";
    assert.ok(b, `falta el botón de móvil data-barra="${lado}"`);
    assert.match(apertura(b), /type="button"/);
    assert.match(apertura(b), new RegExp(`aria-controls="${id}"`));
    assert.match(apertura(b), /aria-label="[^"]+"/);
    assert.match(b, /<svg\b[^>]*aria-hidden="true"/);
  }
  assert.ok(src.indexOf('class="barras-movil"') < src.indexOf('class="migas"'), "va arriba, antes de las migas");
});

test("C4 global.css: .barras-movil solo bajo 900 px y los rieles (.barra-btn) no se ven en móvil", () => {
  const c = css();
  assert.match(sinPrint(c), /(^|\n)\.barras-movil\s*\{[^}]*display:\s*none/, "fuera de móvil no se ve");
  const movil = [...c.matchAll(/@media \(max-width: 899(\.\d+)?px\)\s*\{([^]*?)\n\}/g)].map((m) => m[2]).join("\n");
  assert.match(movil, /\.barras-movil\s*\{[^}]*display:\s*flex/);
  assert.match(movil, /\.barra-btn[^{]*\{[^}]*display:\s*none/);
  const print = bloquePrint(c);
  for (const sel of [".barra-btn", ".barras-movil"]) assert.ok(print.includes(sel), `impresión oculta ${sel}`);
  for (const l of sinPrint(c).split("\n").filter((x) => /\.barra-btn|\.barras-movil/.test(x))) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
});

// ---------- 5. Favorito como estrella ----------
test("C5 [...slug].astro: estrella solo-ícono con title y aria-label, sin la pastilla de texto", () => {
  const src = read(SLUG);
  const b = botones(src, "data-favorito")[0] ?? "";
  assert.ok(b, "falta el botón data-favorito");
  assert.match(apertura(b), /aria-label="Guardar en favoritos"/);
  assert.match(apertura(b), /title="Guardar en favoritos"/);
  assert.doesNotMatch(b, /favorito-txt/);
  assert.doesNotMatch(b.replace(/<svg[^]*<\/svg>/, "").replace(/<[^>]+>/g, "").trim(), /\S/, "sin texto visible");
  assert.match(b, /<svg\b[^>]*fill="none"[^>]*stroke="currentColor"|<svg\b[^>]*stroke="currentColor"[^>]*fill="none"/, "contorno por defecto");
});

test("C5 personal.ts: pone la estrella junto al H1 y cambia title y aria-label (sin .favorito-txt)", () => {
  const s = read("src/scripts/personal.ts");
  assert.doesNotMatch(s, /favorito-txt/);
  assert.match(s, /\.prose h1/);
  assert.match(s, /titulo-pagina/);
  assert.match(s, /createElement\(\s*["']div["']\s*\)/);
  assert.match(s, /setAttribute\(\s*["']title["']|\.title\s*=/);
  assert.match(s, /Quitar de favoritos/);
  sinHtml("personal.ts", s);
});

test("C5 global.css: estrella gris (--muted) y rellena dorada (--warn) cuando es favorito; título en fila", () => {
  const c = sinPrint(css());
  assert.match(reglasCon(c, ".favorito-btn").filter((r) => !/aria-pressed/.test(r.split("{")[0])).join("\n"), /color:\s*var\(--muted\)/);
  const on = reglasCon(c, '.favorito-btn[aria-pressed="true"]').join("\n");
  assert.match(on, /var\(--warn\)/);
  assert.match(on, /fill:\s*(currentColor|var\(--warn\))/);
  assert.match(reglasCon(c, ".titulo-pagina").join("\n"), /display:\s*flex/);
  assert.doesNotMatch(reglasCon(c, ".favorito-btn").join("\n"), /border-radius:\s*999px/, "ya no es pastilla");
});

// ---------- 6. Rutas solo si se activan ----------
test("C6 rutas.ts: el pie usa pasoActivo (no el rol elegido) y tiene botón 'Salir de la ruta'", () => {
  const s = read("src/scripts/rutas.ts");
  for (const f of ["pasoActivo", "activarRuta", "desactivarRuta", "textoContinuar"]) assert.match(s, new RegExp(`\\b${f}\\b`), f);
  assert.doesNotMatch(s, /r\.id === rolGuardado\(/, "el pie ya no depende del rol guardado");
  assert.match(s, /Salir de la ruta/);
  assert.match(s, /["']✕["']/);
  assert.match(s, /createElement\(\s*["']button["']\s*\)/);
  assert.match(s, /\.focus\(/, "al salir de la ruta el foco no se pierde");
  sinHtml("rutas.ts", s);
});

test("C6 global.css: botón de salir de la ruta con tokens y foco visible", () => {
  const r = reglasCon(sinPrint(css()), ".ruta-salir").join("\n");
  assert.ok(r, "faltan estilos .ruta-salir");
  assert.match(r, /var\(--/);
  assert.match(r, /:focus-visible/);
  assert.doesNotMatch(r, /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});

// ---------- 7. Slogan ----------
test("C7 portada: 'Software, electrónica y mecánica de cada vehículo'", () => {
  const src = read("src/pages/index.astro");
  assert.match(src, /<h1>Software, electrónica y mecánica de <span class="grad">cada vehículo<\/span><\/h1>/);
  assert.doesNotMatch(src, /Navegando/);
});

// ---------- 8. Sin "Copiar cita" ----------
test("C8 no existe 'Copiar cita' ni .cita-copiar; la vista previa de citas sigue", () => {
  const s = read("src/scripts/prose.ts");
  assert.doesNotMatch(s, /Copiar cita|Copiar como cita|cita-copiar|citaMarkdown/);
  assert.match(s, /showCita\(/, "el popover de vista previa de citas se conserva");
  assert.doesNotMatch(css(), /\.cita-copiar/);
  assert.doesNotMatch(read("tools/citas.mjs"), /export function citaMarkdown/, "citaMarkdown ya no tiene usuarios");
  assert.match(read("tools/citas.mjs"), /export function citasDe/);
});
