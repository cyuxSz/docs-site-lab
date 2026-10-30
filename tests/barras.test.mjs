// Lote 8a "Limpiar la página": lógica pura de las barras laterales de la wiki (src/lib/barras.ts). Plegar izquierda y
// derecha en escritorio (persistente), cajones en móvil (uno a la vez, Esc y clic fuera los cierran) y modo enfoque
// (no persistente). El script del navegador solo traduce eventos y aplica el estado.
import { test } from "node:test";
import assert from "node:assert/strict";

// Import dinámico: si el módulo no existe, cada test falla por su cuenta con un mensaje claro.
let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/barras.ts");
} catch (e) {
  fallo = e;
}
const B = () => {
  assert.ok(lib, `falta src/lib/barras.ts (${fallo?.code ?? fallo?.message})`);
  return lib;
};

const base = (extra = {}) => ({ izqPlegada: false, derPlegada: false, enfoque: false, cajon: null, ...extra });
const almacen = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), remove: (k) => m.delete(k), m };
};

test("constantes: claves de localStorage para cada barra y corte de cajón en 900 px", () => {
  const { CLAVES_BARRA, ANCHO_CAJON, esMovil } = B();
  assert.deepEqual(CLAVES_BARRA, { izq: "wiki:barra-izq", der: "wiki:barra-der" });
  assert.equal(ANCHO_CAJON, 900);
  assert.equal(esMovil(375), true);
  assert.equal(esMovil(899), true);
  assert.equal(esMovil(900), false);
  assert.equal(esMovil(1280), false);
});

test("escritorio: alternar pliega y despliega cada barra por separado, sin abrir cajones", () => {
  const { barras } = B();
  const e1 = barras(base(), { tipo: "alternar", lado: "izq", movil: false });
  assert.deepEqual(e1, base({ izqPlegada: true }));
  const e2 = barras(e1, { tipo: "alternar", lado: "der", movil: false });
  assert.deepEqual(e2, base({ izqPlegada: true, derPlegada: true }));
  assert.deepEqual(barras(e2, { tipo: "alternar", lado: "izq", movil: false }), base({ derPlegada: true }));
});

test("móvil: alternar abre el cajón de ese lado (uno a la vez) y no toca lo plegado de escritorio", () => {
  const { barras } = B();
  const e1 = barras(base({ izqPlegada: true }), { tipo: "alternar", lado: "izq", movil: true });
  assert.deepEqual(e1, base({ izqPlegada: true, cajon: "izq" }));
  const e2 = barras(e1, { tipo: "alternar", lado: "der", movil: true });
  assert.equal(e2.cajon, "der", "abrir el derecho cierra el izquierdo");
  assert.equal(barras(e2, { tipo: "alternar", lado: "der", movil: true }).cajon, null, "el mismo botón lo cierra");
});

test("Esc: primero cierra el cajón, luego sale del enfoque; si no hay nada, no cambia el estado", () => {
  const { barras } = B();
  assert.deepEqual(barras(base({ cajon: "izq" }), { tipo: "escape" }), base());
  assert.deepEqual(barras(base({ enfoque: true }), { tipo: "escape" }), base());
  assert.deepEqual(barras(base({ izqPlegada: true }), { tipo: "escape" }), base({ izqPlegada: true }));
});

test("clic fuera cierra el cajón abierto y nada más", () => {
  const { barras } = B();
  assert.deepEqual(barras(base({ cajon: "der", derPlegada: true }), { tipo: "fuera" }), base({ derPlegada: true }));
  assert.deepEqual(barras(base({ enfoque: true }), { tipo: "fuera" }), base({ enfoque: true }), "clic fuera no quita el enfoque");
});

test("enfoque: f lo alterna, cierra cualquier cajón y conserva lo plegado para cuando se salga", () => {
  const { barras } = B();
  const e1 = barras(base({ izqPlegada: true, cajon: "der" }), { tipo: "enfoque" });
  assert.deepEqual(e1, base({ izqPlegada: true, enfoque: true }));
  assert.deepEqual(barras(e1, { tipo: "enfoque" }), base({ izqPlegada: true }));
});

test("en enfoque, [ y ] no cambian nada (se sale con f, Esc o el botón)", () => {
  const { barras } = B();
  const e = base({ enfoque: true });
  assert.deepEqual(barras(e, { tipo: "alternar", lado: "izq", movil: false }), e);
  assert.deepEqual(barras(e, { tipo: "alternar", lado: "der", movil: true }), e);
});

test("visible: qué barra se ve (para aria-expanded) en escritorio, móvil y enfoque", () => {
  const { visible } = B();
  assert.equal(visible(base(), "izq", false), true);
  assert.equal(visible(base({ izqPlegada: true }), "izq", false), false);
  assert.equal(visible(base({ izqPlegada: true }), "der", false), true);
  assert.equal(visible(base(), "izq", true), false, "en móvil los cajones arrancan cerrados");
  assert.equal(visible(base({ cajon: "izq" }), "izq", true), true);
  assert.equal(visible(base({ cajon: "izq" }), "der", true), false);
  assert.equal(visible(base({ enfoque: true }), "izq", false), false);
  assert.equal(visible(base({ enfoque: true }), "der", false), false);
});

test("leerBarras / guardarBarras: solo 'plegada' cuenta, lo desplegado borra la clave y el enfoque nunca se guarda", () => {
  const { leerBarras, guardarBarras } = B();
  assert.deepEqual(leerBarras(almacen()), { izqPlegada: false, derPlegada: false });
  assert.deepEqual(leerBarras(almacen({ "wiki:barra-izq": "plegada" })), { izqPlegada: true, derPlegada: false });
  assert.deepEqual(leerBarras(almacen({ "wiki:barra-izq": "1", "wiki:barra-der": '"><script>' })), { izqPlegada: false, derPlegada: false });
  const a = almacen({ "wiki:barra-der": "plegada" });
  guardarBarras(a, base({ izqPlegada: true, enfoque: true, cajon: "izq" }));
  assert.equal(a.get("wiki:barra-izq"), "plegada");
  assert.equal(a.get("wiki:barra-der"), null, "desplegada: se borra la clave");
  assert.deepEqual([...a.m.keys()].sort(), ["wiki:barra-izq"], "no guarda enfoque ni cajón");
});

test("leerBarras: un almacén que truena (modo privado) da todo desplegado", () => {
  const { leerBarras } = B();
  const roto = { get: () => { throw new Error("SecurityError"); }, set() {}, remove() {} };
  assert.deepEqual(leerBarras(roto), { izqPlegada: false, derPlegada: false });
});
