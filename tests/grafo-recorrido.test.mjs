// Retomar el recorrido y teclas del modo presentación (src/lib/recorrido.ts): clave por proyecto+vista/sección,
// guardar/leer/borrar el paso con un almacén que nunca truena, texto "Retomar recorrido (paso 4 de 9)"
// y traducción de teclas a acciones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenSeguro } from "../src/lib/rutas.ts";
import { claveRecorrido, guardarPaso, pasoGuardado, borrarPaso, textoRetomar, accionTecla } from "../src/lib/recorrido.ts";

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test("claveRecorrido: separada por proyecto, vista y sección", () => {
  const claves = new Set([
    claveRecorrido("uuv", "ros", null),
    claveRecorrido("uuv", "docs", null),
    claveRecorrido("otro-proyecto", "ros", null),
    claveRecorrido("uuv", "ros", "control"),
    claveRecorrido("uuv", "ros", "vision"),
  ]);
  assert.equal(claves.size, 5);
  assert.notEqual(claveRecorrido("uuv", "ros", null), "recorrido-visto", "no pisa la marca de 'visto'");
});

test("guardar / leer / borrar el paso del recorrido", () => {
  const ls = memoria();
  const alm = almacenSeguro(() => ls);
  const k = claveRecorrido("uuv", "ros", null);
  assert.equal(pasoGuardado(alm, k, 9), null);
  guardarPaso(alm, k, 3, 9);
  assert.equal(pasoGuardado(alm, k, 9), 3);
  borrarPaso(alm, k);
  assert.equal(pasoGuardado(alm, k, 9), null);
});

test("pasoGuardado: no ofrece retomar en el primer paso, fuera de rango, si el recorrido cambió de largo o si el valor está corrupto", () => {
  const ls = memoria();
  const alm = almacenSeguro(() => ls);
  const k = claveRecorrido("uuv", "ros", "control");
  guardarPaso(alm, k, 0, 9);
  assert.equal(pasoGuardado(alm, k, 9), null, "paso 0 = empezar de nuevo");
  guardarPaso(alm, k, 12, 9);
  assert.equal(pasoGuardado(alm, k, 9), null);
  guardarPaso(alm, k, 4, 9);
  assert.equal(pasoGuardado(alm, k, 7), null, "el recorrido ya no tiene 9 pasos");
  ls.setItem(k, "{no es json");
  assert.equal(pasoGuardado(alm, k, 9), null);
  ls.setItem(k, JSON.stringify({ paso: "3", total: 9 }));
  assert.equal(pasoGuardado(alm, k, 9), null);
});

test("almacén que lanza (modo privado / bloqueado): no truena y devuelve null", () => {
  const roto = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } };
  const alm = almacenSeguro(() => roto);
  const k = claveRecorrido("uuv", "ros", null);
  assert.doesNotThrow(() => guardarPaso(alm, k, 3, 9));
  assert.equal(pasoGuardado(alm, k, 9), null);
  assert.doesNotThrow(() => borrarPaso(alm, k));
  assert.equal(pasoGuardado(almacenSeguro(() => null), k, 9), null);
});

test("textoRetomar: el paso se muestra en base 1", () => {
  assert.equal(textoRetomar(3, 9), "Retomar recorrido (paso 4 de 9)");
  assert.equal(textoRetomar(1, 2), "Retomar recorrido (paso 2 de 2)");
});

const k = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, escribiendo: false, ...extra });

test("accionTecla: p alterna el modo presentación (sin modificadores y fuera de campos de texto)", () => {
  assert.equal(accionTecla(k("p"), false), "alternar");
  assert.equal(accionTecla(k("P"), true), "alternar");
  assert.equal(accionTecla(k("p", { ctrlKey: true }), false), null, "Ctrl+P es imprimir");
  assert.equal(accionTecla(k("p", { metaKey: true }), false), null);
  assert.equal(accionTecla(k("p", { escribiendo: true }), false), null, "escribir en el buscador");
});

test("accionTecla: en presentación, flecha der./espacio/AvPág avanzan, flecha izq./RePág retroceden y Esc sale", () => {
  for (const key of ["ArrowRight", " ", "PageDown"]) assert.equal(accionTecla(k(key), true), "siguiente", key);
  for (const key of ["ArrowLeft", "PageUp"]) assert.equal(accionTecla(k(key), true), "anterior", key);
  assert.equal(accionTecla(k("Escape"), true), "salir");
});

test("accionTecla: fuera de presentación, flechas, espacio y Esc no hacen nada (no roba la navegación normal)", () => {
  for (const key of ["ArrowRight", "ArrowLeft", " ", "PageDown", "PageUp", "Escape", "x"]) assert.equal(accionTecla(k(key), false), null, key);
  assert.equal(accionTecla(k("x"), true), null);
});
