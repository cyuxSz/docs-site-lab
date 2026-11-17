// Lote 8d "Pulido", criterios 1, 2, 4 y 6: tarjetas de estadísticas que no desbordan y separadas del hero, insignias
// de paquetes con gap, metadatos con 0 ocultos y contraste de --muted calculado desde los tokens de global.css.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const css = read("src/styles/global.css");
const INDICE = read("src/pages/[project]/software.astro"); // lote carátula: la portada de software vive aquí
const PAGINA = read("src/pages/[project]/[...slug].astro");

// Cuerpos de todas las reglas (también dentro de @media) cuya lista de selectores incluye exactamente uno de `sels`.
function reglas(...sels) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const lista = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (sels.some((s) => lista.includes(s))) out.push(m[2]);
  }
  return out;
}
const todas = (...sels) => reglas(...sels).join(";");

// ---------- 1. Estadísticas ----------
test(".stats dd: font-size con clamp() en todas sus reglas (también la de móvil), sin px fijos", () => {
  const sizes = reglas(".stats dd").flatMap((r) => [...r.matchAll(/font-size:\s*([^;]+)/g)].map((m) => m[1].trim()));
  assert.ok(sizes.length > 0, "falta font-size en .stats dd");
  for (const s of sizes) assert.match(s, /^clamp\(/, `.stats dd usa font-size: ${s}`);
  assert.match(todas(".stats dd"), /font-variant-numeric:\s*tabular-nums/);
});

test(".stats: la tarjeta y su número no desbordan (min-width:0 y corte de palabras)", () => {
  assert.match(todas(".stats div", ".stats > div"), /min-width:\s*0/);
  assert.match(todas(".stats dd"), /overflow-wrap:\s*anywhere|min-width:\s*0/);
});

test("índice del proyecto: estadísticas con clase propia separada del hero y sin font-size en línea", () => {
  assert.match(INDICE, /class="stats stats-proyecto"/);
  assert.match(todas(".stats-proyecto"), /margin(-block|-top)?:\s*(?!0)[^;]*\d/);
  const stats = INDICE.slice(INDICE.indexOf('class="stats'), INDICE.indexOf("</dl>", INDICE.indexOf('class="stats')));
  assert.doesNotMatch(stats, /style="font-size/, "los tamaños van en global.css, no en atributos style");
});

// ---------- 2. Insignias de paquetes ----------
test("tarjetas de paquetes: las insignias van en .card-badges (flex, wrap y gap)", () => {
  assert.match(INDICE, /class="card-meta card-badges"/);
  const r = todas(".card-badges");
  assert.match(r, /display:\s*flex/);
  assert.match(r, /flex-wrap:\s*wrap/);
  assert.match(r, /gap:\s*[1-9]/);
});

// ---------- 4. Ceros ocultos ----------
test("línea de metadatos: 'afirmaciones verificadas' solo con claims > 0 y 'contra el código' solo para lector de pantalla", () => {
  const i = PAGINA.indexOf("afirmaciones verificadas");
  assert.ok(i > 0);
  assert.match(PAGINA.slice(Math.max(0, i - 160), i), /entry\.data\.claims\s*>\s*0\s*&&/);
  // Texto visible corto; la frase completa sigue disponible en sr-only (no solo en title, que no siempre se anuncia).
  assert.match(PAGINA.slice(i, i + 200), /afirmaciones verificadas<span class="sr-only"> contra el código<\/span>/);
  assert.doesNotMatch(PAGINA, /afirmaciones verificadas contra el código/, "'contra el código' ya no es texto visible");
});

test("tarjetas de paquetes: 'N afirmaciones' solo con claims > 0", () => {
  const i = INDICE.indexOf("afirmaciones{");
  assert.ok(i > 0, "sigue el texto de afirmaciones en la tarjeta");
  assert.match(INDICE.slice(Math.max(0, i - 160), i), /x\.claims\s*>\s*0/);
});

// ---------- 6. Contraste ----------
function tokens(selector) {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `falta ${selector} en global.css`);
  const cuerpo = css.slice(i, css.indexOf("}", i));
  const t = {};
  for (const m of cuerpo.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) t[m[1]] = m[2];
  return t;
}
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

for (const [tema, sel] of [["oscuro", ":root"], ["claro", ':root[data-theme="light"]']]) {
  test(`contraste de --muted ≥ 4.5:1 sobre --bg y --surface (tema ${tema})`, () => {
    const t = tokens(sel);
    for (const k of ["--muted", "--bg", "--surface"]) assert.ok(t[k], `tema ${tema}: ${k} debe ser un hex de 6 dígitos`);
    for (const fondo of ["--bg", "--surface"]) {
      const c = contraste(t["--muted"], t[fondo]);
      assert.ok(c >= 4.5, `tema ${tema}: --muted sobre ${fondo} = ${c.toFixed(2)}:1`);
    }
  });
}
