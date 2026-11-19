// Criterios 14 y 16 (lote d1b): la lectura de hardware (.hw-lectura y la vista previa .hw-previa, mismo HTML) se ve
// como el editor visual (Milkdown Crepe). Solo CSS; se sigue guardando Markdown. Las páginas de docs (.prose sin
// .hw-lectura/.hw-previa) no cambian.
// C14 (tablas): antes `.prose table { display:block }` encogía la tabla, las celdas solo tenían borde inferior (filas
// vacías = líneas sueltas) y el encabezado iba en gris. Ahora, en lectura de hardware: display:table + width:100%,
// rejilla, encabezado con color normal, 600 y fondo sutil, celdas vacías con alto mínimo; en ≤ 640 px no hay tarjetas
// (el contenido se pinta en el cliente, sin data-label): la tabla conserva la rejilla y se desplaza de lado.
// C16 (aspecto común): tokens --hw-* definidos una vez en global.css (valores de Crepe) y usados por la lectura de
// hardware (global.css) y por el editor (editor-visual.css) para títulos, párrafos, bloques y tablas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leerCss = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const css = leerCss("src/styles/global.css");
const ed = leerCss("src/styles/editor-visual.css");

// Reglas de primer nivel y reglas dentro de @media, con su condición.
function reglas(texto) {
  const fuera = [];
  const medias = [];
  let i = 0;
  while (i < texto.length) {
    const ab = texto.indexOf("{", i);
    if (ab < 0) break;
    const prelude = texto.slice(i, ab).trim();
    if (prelude.startsWith("@")) {
      let prof = 1, j = ab + 1;
      while (j < texto.length && prof > 0) { if (texto[j] === "{") prof++; else if (texto[j] === "}") prof--; j++; }
      medias.push({ cond: prelude, reglas: reglas(texto.slice(ab + 1, j - 1)).fuera });
      i = j;
    } else {
      const ce = texto.indexOf("}", ab);
      fuera.push({ sel: prelude.replace(/\s+/g, " "), decl: texto.slice(ab + 1, ce).replace(/\s+/g, " ") });
      i = ce + 1;
    }
  }
  return { fuera, medias };
}
const G = reglas(css);
const E = reglas(ed);
// Selectores sueltos de una regla (separa por comas fuera de paréntesis).
const partes = (sel) => sel.split(/,(?![^(]*\))/).map((s) => s.trim());
const decl = (lista, pred) => lista.filter((r) => partes(r.sel).some(pred)).map((r) => r.decl).join(";");
// Selector de lectura de hardware que termina en `el` (th, td, h1…), directo o dentro de :is(...).
const HW = /\.hw-lectura|\.hw-previa/;
const termina = (el) => new RegExp(`(\\b${el}|:is\\([^)]*\\b${el}\\b[^)]*\\))$`);
const lectura = (lista, el) => decl(lista, (p) => HW.test(p) && !/hw-bom|hw-visual/.test(p) && termina(el).test(p));
const editor = (el) => decl(E.fuera, (p) => /\.hw-visual/.test(p) && termina(el).test(p));
const movil = G.medias.filter((m) => /max-width:\s*640px/.test(m.cond)).flatMap((m) => m.reglas);
const v = (d, prop) => new RegExp(`(^|;)\\s*${prop}:\\s*([^;]+)`).exec(d)?.[2].trim();

// ---------- C14: tablas ----------

test("C14 lectura hw: la tabla ocupa el ancho (display:table + width:100%) fuera de @media", () => {
  const d = lectura(G.fuera, "table");
  assert.match(d, /display:\s*table\s*(;|$)/, "la tabla de lectura de hardware sigue sin display:table");
  assert.match(d, /width:\s*100%/);
});

test("C14 lectura hw: rejilla, borde completo en th y td con var(--line) (directo o vía --hw-celda-borde)", () => {
  for (const c of ["th", "td"]) {
    assert.match(lectura(G.fuera, c), /(^|;)\s*border:\s*(1px solid var\(--line\)|var\(--hw-celda-borde\))/, `${c} sin borde completo`);
  }
});

test("C14 lectura hw: encabezado con color de texto normal, peso 600 y fondo sutil", () => {
  const d = lectura(G.fuera, "th");
  assert.match(d, /(^|;)\s*color:\s*(var\(--text\)|inherit)/);
  assert.match(d, /font-weight:\s*600/);
  assert.match(d, /background(-color)?:\s*(var\(--(surface|glass|accent-soft)\)|color-mix\()/, "falta fondo sutil en th");
});

test("C14 lectura hw: las celdas vacías tienen altura mínima visible", () => {
  assert.match(lectura(G.fuera, "td") + ";" + lectura(G.fuera, "td:empty"), /(^|;)\s*(min-)?height:\s*[\d.]+(em|rem|px)/, "celdas vacías sin altura");
});

test("C14 375 px: docs siguen en tarjetas; la lectura de hardware conserva la rejilla y se desplaza de lado", () => {
  assert.ok(movil.length, "no hay @media (max-width: 640px)");
  assert.match(decl(movil, (p) => p.includes(".prose table") && p.includes("td::before")), /content:\s*attr\(data-label\)/);
  const t = lectura(movil, "table");
  assert.match(t, /display:\s*block/);
  assert.match(t, /overflow-x:\s*auto/);
  assert.match(t, /max-width:\s*100%/);
  assert.match(lectura(movil, "thead"), /position:\s*static/);
  assert.match(lectura(movil, "thead"), /display:\s*table-header-group/);
  assert.match(lectura(movil, "tr"), /display:\s*table-row/);
  assert.match(lectura(movil, "td"), /display:\s*table-cell/);
  assert.match(lectura(movil, "td::before"), /content:\s*none/);
  assert.match(lectura(movil, "td:empty"), /display:\s*table-cell/);
});

// ---------- C16: mismo aspecto que el editor ----------

const TOKENS = {
  "--hw-h1-size": "2.625em",
  "--hw-h2-size": "2.25em",
  "--hw-h3-size": "2em",
  "--hw-titulo-peso": "400",
  "--hw-linea": "1.5",
  "--hw-p-padding": "4px 0",
  "--hw-bloque-margen": "4px 0",
  "--hw-celda-padding": "4px 16px",
  "--hw-celda-borde": "1px solid var(--line)",
};

test("C16 tokens: global.css define una vez los --hw-* con los valores de Crepe", () => {
  // La definición base (fuera de @media) es única. Lote a-editor-qol: solo los tres tamaños de título pueden
  // redefinirse, y solo dentro de @media (max-width: 600px).
  const base = G.fuera.map((r) => r.decl).join(";");
  const AJUSTABLES = ["--hw-h1-size", "--hw-h2-size", "--hw-h3-size"];
  for (const [k, val] of Object.entries(TOKENS)) {
    const re = () => new RegExp(`${k}:\\s*([^;}]+)`, "g");
    const defs = [...base.matchAll(re())].map((m) => m[1].trim());
    assert.deepEqual(defs, [val], `${k}: ${JSON.stringify(defs)}`);
    const total = [...css.matchAll(re())].length;
    for (const m of G.medias) {
      const n = [...m.reglas.map((r) => r.decl).join(";").matchAll(re())].length;
      if (!n) continue;
      assert.ok(AJUSTABLES.includes(k), `${k} no se redefine en @media`);
      assert.match(m.cond, /max-width:\s*600px/, `${k} solo se redefine en @media (max-width: 600px), no en ${m.cond}`);
      assert.equal(n, 1, `${k}: una sola redefinición en ${m.cond}`);
    }
    assert.ok(total <= (AJUSTABLES.includes(k) ? 2 : 1), `${k}: ${total} definiciones en global.css`);
  }
});

test("C16 títulos: lectura de hardware y editor usan los mismos tokens (tamaño y peso)", () => {
  for (const n of [1, 2, 3]) {
    for (const [nombre, d] of [["lectura", lectura(G.fuera, `h${n}`)], ["editor", editor(`h${n}`)]]) {
      assert.equal(v(d, "font-size"), `var(--hw-h${n}-size)`, `${nombre} h${n} font-size`);
      assert.equal(v(d, "font-weight"), "var(--hw-titulo-peso)", `${nombre} h${n} font-weight`);
    }
  }
});

test("C16 espaciado: párrafos (padding y línea) y bloques comparten tokens en lectura y editor", () => {
  for (const [nombre, d] of [["lectura", lectura(G.fuera, "p")], ["editor", editor("p")]]) {
    assert.equal(v(d, "padding"), "var(--hw-p-padding)", `${nombre} p padding`);
    assert.equal(v(d, "line-height"), "var(--hw-linea)", `${nombre} p line-height`);
  }
  assert.equal(v(lectura(G.fuera, "p"), "margin"), "0", "lectura p: margen 0, el espacio lo da el padding (como Crepe)");
  assert.equal(v(lectura(G.fuera, "table"), "margin"), "var(--hw-bloque-margen)");
  assert.equal(v(lectura(G.fuera, "blockquote"), "margin"), "var(--hw-bloque-margen)");
});

test("C16 tablas: celdas con el mismo borde y padding en lectura y editor", () => {
  for (const c of ["th", "td"]) {
    for (const [nombre, d] of [["lectura", lectura(G.fuera, c)], ["editor", editor(c)]]) {
      assert.equal(v(d, "border"), "var(--hw-celda-borde)", `${nombre} ${c} border`);
      assert.equal(v(d, "padding"), "var(--hw-celda-padding)", `${nombre} ${c} padding`);
    }
  }
});

test("C16 docs intactas: ningún selector sin .hw-lectura/.hw-previa/.hw-visual usa --hw-*; .prose h1/h2/h3/table como antes", () => {
  for (const { sel, decl: d } of [...G.fuera, ...E.fuera, ...G.medias.flatMap((m) => m.reglas)]) {
    if (!/var\(--hw-/.test(d)) continue;
    for (const p of partes(sel)) assert.match(p, /\.hw-lectura|\.hw-previa|\.hw-visual/, `--hw-* fuera de hardware: ${p}`);
  }
  const prose = (s) => decl(G.fuera, (p) => p === s);
  assert.match(prose(".prose h1"), /font-weight: 800; font-size: clamp\(1\.75em, 4\.5vw, 2\.5em\)/);
  assert.match(prose(".prose h2"), /font-size: 1\.3125em; margin: 32px 0 8px/);
  assert.match(prose(".prose h3"), /font-size: 1\.0625em; margin: 22px 0 6px/);
  assert.match(prose(".prose table"), /display: block; overflow-x: auto/, "las tablas de docs no cambian en este lote");
  assert.match(prose(".prose th"), /color: var\(--muted\)/);
});
