// Lote 8b · teclado de los menús ("Vista ▾", "Más ▾", "Vistas ▾") y del listbox del buscador (src/lib/menu.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/lib/menu.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/menu.ts → ${name}`);
  return mod[name](...args);
};
const navegarLista = fn("navegarLista");
const accionMenu = fn("accionMenu");

test("navegarLista: flechas con vuelta, Home y End", () => {
  assert.equal(navegarLista("ArrowDown", 0, 4), 1);
  assert.equal(navegarLista("ArrowDown", 3, 4), 0);
  assert.equal(navegarLista("ArrowUp", 0, 4), 3);
  assert.equal(navegarLista("ArrowUp", 2, 4), 1);
  assert.equal(navegarLista("Home", 2, 4), 0);
  assert.equal(navegarLista("End", 0, 4), 3);
});

test("navegarLista: sin elemento activo (-1), abajo va al primero y arriba al último", () => {
  assert.equal(navegarLista("ArrowDown", -1, 4), 0);
  assert.equal(navegarLista("ArrowUp", -1, 4), 3);
});

test("navegarLista: lista vacía da -1; otras teclas dan null (no se manejan)", () => {
  assert.equal(navegarLista("ArrowDown", -1, 0), -1);
  assert.equal(navegarLista("a", 1, 4), null);
  assert.equal(navegarLista("Enter", 1, 4), null);
});

test("accionMenu: Esc cierra, Tab sale, Enter y espacio activan; el resto null", () => {
  assert.equal(accionMenu("Escape"), "cerrar");
  assert.equal(accionMenu("Tab"), "salir");
  assert.equal(accionMenu("Enter"), "activar");
  assert.equal(accionMenu(" "), "activar");
  assert.equal(accionMenu("ArrowDown"), null);
  assert.equal(accionMenu("x"), null);
});
