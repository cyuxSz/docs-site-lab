// Fase 0 · 2: el enlace "Saltar al contenido" se ve al recibir foco y el destino <main id="contenido"> acepta el foco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const base = read("src/layouts/Base.astro");
const css = read("src/styles/global.css");
const enlace = base.match(/<a\b[^>]*href="#contenido"[^>]*>\s*Saltar al contenido\s*<\/a>/);

test("Base.astro: el skip link a #contenido lleva la clase skip-link", () => {
  assert.ok(enlace, 'falta <a href="#contenido">Saltar al contenido</a>');
  assert.match(enlace[0], /class="[^"]*\bskip-link\b[^"]*"/);
});

// Reglas CSS cuyo selector menciona .skip-link con :focus o :focus-visible.
const reglasFoco = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /\.skip-link[^,{]*:focus(-visible)?\b/.test(sel));
const decl = () => reglasFoco.map((r) => r[2]).join(";");

test("global.css: .skip-link al recibir foco deja de estar recortado (clip, ancho, alto y z-index)", () => {
  assert.ok(reglasFoco.length > 0, "falta una regla .skip-link:focus / .skip-link:focus-visible");
  const d = decl();
  assert.match(d, /clip\s*:\s*(auto|unset|initial)/);
  assert.match(d, /width\s*:\s*auto/);
  assert.match(d, /height\s*:\s*auto/);
  assert.match(d, /z-index\s*:\s*\d+/);
});

test("global.css: el estilo con foco usa variables de tema para fondo y texto (legible en claro y oscuro)", () => {
  const d = decl();
  assert.match(d, /background(-color)?\s*:[^;]*var\(--/);
  assert.match(d, /(^|[;\s])color\s*:[^;]*var\(--/);
});

test("global.css: .sr-only no cambia para los demás usos (labels y spans)", () => {
  assert.match(css, /\.sr-only\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/);
  assert.doesNotMatch(css, /\.sr-only:focus/, "no hacer visible cualquier .sr-only con foco");
});

const PAGINAS = {
  "src/pages/404.astro": 1,
  "src/pages/index.astro": 1,
  "src/pages/[project]/grafo.astro": 1,
  "src/pages/[project]/[...slug].astro": 1,
  "src/pages/[project]/index.astro": 2,
  "src/pages/[project]/[disciplina].astro": 1,
  "src/pages/[project]/comentarios.astro": 1,
  "src/pages/[project]/limpieza.astro": 1,
  "src/pages/[project]/novedades.astro": 1,
};

test('cada <main id="contenido"> lleva tabindex="-1"', () => {
  for (const [p, n] of Object.entries(PAGINAS)) {
    const mains = [...read(p).matchAll(/<main\b[^>]*>/g)].map((m) => m[0]).filter((m) => /id="contenido"/.test(m));
    assert.equal(mains.length, n, `${p}: ${n} <main id="contenido">`);
    for (const m of mains) assert.match(m, /tabindex="-1"/, `${p}: ${m}`);
  }
});
