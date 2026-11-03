// Progreso de las rutas por rol en el navegador (src/lib/rutas.ts): claves de localStorage por proyecto+rol+paso,
// almacén que nunca truena, contador "3 de 8", siguiente paso y qué paso es la página actual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenSeguro, claveRol, clavePaso, leidos, marcar, reiniciar, progreso, pasoEnPagina, rolGuardado } from "../src/lib/rutas.ts";

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const paso = (page, anchor = "") => ({ route: `/uuv/${page.replace(/\.md$/, "")}/${anchor}`, page, title: page, nota: "" });
const CONTROL = {
  id: "control",
  nombre: "Control",
  pasos: [paso("quickstart.md"), paso("operations/hardware.md"), paso("packages/uuv_control.md"), paso("operations/hardware.md", "#banco"), paso("glosario.md")],
};
const RUTAS = [CONTROL, { id: "vision", nombre: "Visión", pasos: [paso("quickstart.md")] }];

test("claves: separadas por proyecto, rol y página del paso (fase 0)", () => {
  assert.equal(claveRol("uuv"), "rutas:uuv:rol");
  assert.equal(clavePaso("uuv", "control", "glosario.md"), "rutas:uuv:control:pagina:glosario.md");
  assert.notEqual(clavePaso("uuv", "control", "glosario.md"), clavePaso("proyecto-x", "control", "glosario.md"));
});

test("marcar / leidos / reiniciar: guarda por paso y reiniciar solo borra ese rol de ese proyecto", () => {
  const ls = memoria();
  const a = almacenSeguro(() => ls);
  marcar(a, "uuv", "control", paso("quickstart.md"), true);
  marcar(a, "uuv", "control", paso("packages/uuv_control.md"), true);
  marcar(a, "uuv", "vision", paso("quickstart.md"), true);
  marcar(a, "proyecto-x", "control", paso("operations/hardware.md"), true);
  assert.deepEqual(leidos(a, "uuv", CONTROL), [true, false, true, false, false]);
  marcar(a, "uuv", "control", paso("packages/uuv_control.md"), false);
  assert.deepEqual(leidos(a, "uuv", CONTROL), [true, false, false, false, false]);
  reiniciar(a, "uuv", CONTROL);
  assert.deepEqual(leidos(a, "uuv", CONTROL), [false, false, false, false, false]);
  assert.equal(ls.getItem(clavePaso("uuv", "vision", "quickstart.md")), "1", "reiniciar no toca otro rol");
  assert.equal(ls.getItem(clavePaso("proyecto-x", "control", "operations/hardware.md")), "1", "reiniciar no toca otro proyecto");
});

test("almacenSeguro: sin localStorage o si truena, no lanza y simplemente no recuerda", () => {
  const sinLs = almacenSeguro(() => {
    throw new Error("SecurityError");
  });
  const roto = almacenSeguro(() => ({
    getItem() {
      throw new Error("x");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("x");
    },
  }));
  for (const a of [sinLs, roto, almacenSeguro(() => null), almacenSeguro(() => undefined)]) {
    assert.doesNotThrow(() => marcar(a, "uuv", "control", paso("quickstart.md"), true));
    assert.doesNotThrow(() => reiniciar(a, "uuv", CONTROL));
    assert.deepEqual(leidos(a, "uuv", CONTROL), [false, false, false, false, false]);
    assert.equal(rolGuardado(a, "uuv", RUTAS), null);
  }
});

test("rolGuardado: solo devuelve un rol que exista en las rutas del proyecto", () => {
  const ls = memoria();
  const a = almacenSeguro(() => ls);
  assert.equal(rolGuardado(a, "uuv", RUTAS), null);
  ls.setItem(claveRol("uuv"), "vision");
  assert.equal(rolGuardado(a, "uuv", RUTAS), "vision");
  ls.setItem(claveRol("uuv"), "rol-borrado");
  assert.equal(rolGuardado(a, "uuv", RUTAS), null);
});

test("progreso: texto 'N de M' y siguiente = primer paso no leído (null si ya terminó)", () => {
  assert.deepEqual(progreso([true, false, true, false, false]), { hechos: 2, total: 5, texto: "2 de 5", siguiente: 1 });
  assert.deepEqual(progreso([false, false]), { hechos: 0, total: 2, texto: "0 de 2", siguiente: 0 });
  assert.deepEqual(progreso([true, true, true]), { hechos: 3, total: 3, texto: "3 de 3", siguiente: null });
});

test("pasoEnPagina: si la página se repite usa el primer paso no leído; si todos están leídos, el primero; -1 si no está", () => {
  assert.equal(pasoEnPagina(CONTROL, "operations/hardware.md", [false, false, false, false, false]), 1);
  assert.equal(pasoEnPagina(CONTROL, "operations/hardware.md", [true, true, false, false, false]), 3);
  assert.equal(pasoEnPagina(CONTROL, "operations/hardware.md", [true, true, true, true, false]), 1);
  assert.equal(pasoEnPagina(CONTROL, "glosario.md", [false, false, false, false, false]), 4);
  assert.equal(pasoEnPagina(CONTROL, "packages/uuv_vision.md", [false, false, false, false, false]), -1);
});
