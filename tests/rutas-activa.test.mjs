// Lote 9a "Página limpia": la barra de ruta solo aparece si el usuario ACTIVÓ esa ruta (botón "Empezar" en la página de
// rutas por rol). Lógica pura en src/lib/rutas.ts: clave por proyecto, lectura validada contra las rutas del proyecto,
// activar/desactivar, qué paso mostrar en una página y el texto del botón principal.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/rutas.ts";

const memoria = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const paso = (page) => ({ route: `/uuv/${page.replace(/\.md$/, "")}/`, page, title: page, nota: "" });
const CONTROL = { id: "control", nombre: "Control", pasos: [paso("quickstart.md"), paso("operations/hardware.md"), paso("glosario.md")] };
const VISION = { id: "vision", nombre: "Visión", pasos: [paso("quickstart.md"), paso("packages/uuv_vision.md")] };
const RUTAS = [CONTROL, VISION];
const fn = (nombre) => {
  assert.equal(typeof R[nombre], "function", `falta ${nombre} en src/lib/rutas.ts`);
  return R[nombre];
};

test("claveRutaActiva: una clave por proyecto, distinta de la del rol elegido", () => {
  const claveRutaActiva = fn("claveRutaActiva");
  assert.equal(claveRutaActiva("uuv"), "rutas:uuv:activa");
  assert.notEqual(claveRutaActiva("uuv"), R.claveRol("uuv"));
});

test("activarRuta / rutaActiva / desactivarRuta: guarda, valida contra las rutas del proyecto y borra", () => {
  const [activarRuta, rutaActiva, desactivarRuta] = ["activarRuta", "rutaActiva", "desactivarRuta"].map(fn);
  const s = memoria();
  const a = R.almacenSeguro(() => s);
  assert.equal(rutaActiva(a, "uuv", RUTAS), null, "sin activar no hay ruta activa");
  activarRuta(a, "uuv", "vision");
  assert.equal(s.getItem("rutas:uuv:activa"), "vision");
  assert.equal(rutaActiva(a, "uuv", RUTAS), "vision");
  assert.equal(rutaActiva(a, "usv", RUTAS), null, "separada por proyecto");
  desactivarRuta(a, "uuv");
  assert.equal(s.getItem("rutas:uuv:activa"), null, "desactivar borra la clave");
  assert.equal(rutaActiva(a, "uuv", RUTAS), null);
});

test("rutaActiva: ignora valores que no son una ruta del proyecto y un almacén que truena", () => {
  const rutaActiva = fn("rutaActiva");
  for (const v of ["borrada", "", '"><script>', "__proto__", "1"]) {
    assert.equal(rutaActiva(R.almacenSeguro(() => memoria({ "rutas:uuv:activa": v })), "uuv", RUTAS), null, JSON.stringify(v));
  }
  const roto = R.almacenSeguro(() => {
    throw new Error("SecurityError");
  });
  assert.equal(rutaActiva(roto, "uuv", RUTAS), null);
});

test("elegir un rol (radio) NO activa la ruta: solo 'Empezar' lo hace", () => {
  const rutaActiva = fn("rutaActiva");
  const a = R.almacenSeguro(() => memoria({ "rutas:uuv:rol": "control" }));
  assert.equal(R.rolGuardado(a, "uuv", RUTAS), "control");
  assert.equal(rutaActiva(a, "uuv", RUTAS), null);
});

test("pasoActivo: sin ruta activa no hay barra; con ruta activa, solo en sus páginas", () => {
  const [pasoActivo, activarRuta] = ["pasoActivo", "activarRuta"].map(fn);
  const s = memoria({ "rutas:uuv:rol": "control" });
  const a = R.almacenSeguro(() => s);
  assert.equal(pasoActivo(a, "uuv", RUTAS, "quickstart.md"), null, "la página está en dos rutas, pero ninguna está activa");
  activarRuta(a, "uuv", "control");
  assert.deepEqual(pasoActivo(a, "uuv", RUTAS, "operations/hardware.md"), { ruta: CONTROL, i: 1 });
  assert.equal(pasoActivo(a, "uuv", RUTAS, "packages/uuv_vision.md"), null, "página de otra ruta: nada");
  R.marcar(a, "uuv", "control", "quickstart.md", true);
  assert.deepEqual(pasoActivo(a, "uuv", RUTAS, "quickstart.md"), { ruta: CONTROL, i: 0 }, "usa pasoEnPagina");
  activarRuta(a, "uuv", "vision");
  assert.deepEqual(pasoActivo(a, "uuv", RUTAS, "quickstart.md"), { ruta: VISION, i: 0 });
});

test("textoContinuar: 'Empezar' sin avance, 'Continuar con el siguiente paso' a medias y 'Ruta completa' deshabilitado", () => {
  const textoContinuar = fn("textoContinuar");
  assert.deepEqual(textoContinuar(R.progreso([false, false])), { texto: "Empezar", deshabilitado: false });
  assert.deepEqual(textoContinuar(R.progreso([true, false])), { texto: "Continuar con el siguiente paso", deshabilitado: false });
  assert.deepEqual(textoContinuar(R.progreso([true, true])), { texto: "Ruta completa", deshabilitado: true });
});
