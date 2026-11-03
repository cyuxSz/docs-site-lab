// Fase 0 · 3: mantener pulsada una tecla (keydown con e.repeat) no dispara atajos ni alterna barras una y otra vez.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { atajo } from "../src/lib/atajos.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const t = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, escribiendo: false, dialogoAbierto: false, t: 1000, ...extra });

test("atajo: una pulsación repetida no dispara ninguna acción", () => {
  for (const k of ["[", "]", "f", "?"]) assert.equal(atajo(null, t(k, { repetida: true })).accion, null, k);
  assert.equal(atajo(null, t("[", { altGraph: true, repetida: true })).accion, null, "AltGr+[");
});

test("atajo: una repetición no toca la secuencia pendiente (g sostenida y luego w sigue yendo a la wiki)", () => {
  const g = atajo(null, t("g", { t: 1000 }));
  const rep = atajo(g.pendiente, t("g", { t: 1100, repetida: true }));
  assert.equal(rep.accion, null, "g repetida no es 'g g' (grafo)");
  assert.equal(rep.pendiente, g.pendiente, "la repetición deja la secuencia como estaba");
  assert.equal(atajo(rep.pendiente, t("w", { t: 1200 })).accion, "wiki");
});

test("atajo: sin repetida (o false) todo sigue igual", () => {
  assert.equal(atajo(null, t("[", { repetida: false })).accion, "izquierda");
  assert.equal(atajo(null, t("[")).accion, "izquierda");
});

test("scripts/atajos.ts pasa e.repeat a la lógica pura", () => {
  assert.match(read("src/scripts/atajos.ts"), /repetida:\s*e\.repeat\b/);
});

test("scripts/barras.ts: el keydown de Escape ignora e.repeat", () => {
  const src = read("src/scripts/barras.ts");
  const h = src.match(/addEventListener\("keydown",\s*\(e\)\s*=>\s*\{([\s\S]*?)\n\s*\}\);/);
  assert.ok(h, "falta el listener keydown");
  assert.match(h[1], /e\.repeat/);
});
