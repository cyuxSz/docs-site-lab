// CodeRabbit PR #53: el eco asíncrono de `toggle` al cargar no debe pisar la preferencia; rutas no pinta índices vacíos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const lib = await import("../src/lib/nav-grupos.ts");

test("filtroEcoToggle: ignora el eco inicial y guarda los cambios del usuario", () => {
  const f = lib.filtroEcoToggle(true);
  assert.equal(f(true), false, "eco de la apertura inicial");
  assert.equal(f(false), true, "el usuario cierra");
  assert.equal(f(true), true, "el usuario reabre");
  const g = lib.filtroEcoToggle(false);
  assert.equal(g(true), true, "el usuario abre antes de que llegue ningún eco");
  assert.equal(g(false), true, "y vuelve a cerrar: se guarda");
});

test("jsdom: el grupo actual con preferencia «cerrado» no la pisa al cargar", async () => {
  const dom = new JSDOM(`<details open data-nav-grupo="a"><summary>a</summary></details>`);
  const d = dom.window.document.querySelector("details");
  const alm = {};
  const guardar = lib.filtroEcoToggle(true);
  d.open = true;
  d.addEventListener("toggle", () => { if (guardar(d.open)) alm.a = d.open; });
  d.dispatchEvent(new dom.window.Event("toggle")); // eco asíncrono de la carga
  assert.equal(alm.a, undefined);
  d.open = false;
  d.dispatchEvent(new dom.window.Event("toggle"));
  assert.equal(alm.a, false);
});

test("slug.astro: «En esta página» (móvil y escritorio) no se pinta en rutas", () => {
  const src = read("src/pages/[project]/[...slug].astro");
  assert.equal(src.match(/!esRutas && toc\.length > 1 &&/g)?.length, 2);
});
