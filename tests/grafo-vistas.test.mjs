// Lote 8b · QoL 4: vistas guardadas del grafo (src/lib/vistas.ts). Se guardan en localStorage por proyecto; lo leído
// se valida (entradas corruptas fuera) y al aplicar se descarta lo que ya no existe (config, sección, nodo, capas).
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/lib/vistas.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/vistas.ts → ${name}`);
  return mod[name](...args);
};
const claveVistas = fn("claveVistas");
const leerVistas = fn("leerVistas");
const serializarVistas = fn("serializarVistas");
const agregarVista = fn("agregarVista");
const renombrarVista = fn("renombrarVista");
const borrarVista = fn("borrarVista");
const vistaAplicable = fn("vistaAplicable");

const ESTADO = { vista: "ros", config: "sub_real", seccion: null, legado: false, sinUso: false, plan: true, ocultos: ["visualizacion"], nodo: "ctl/asmc", camara: { x: 0.4, y: 0.6, ratio: 0.5 } };
const v = (id, nombre, estado = ESTADO) => ({ id, nombre, creada: 1, estado });

test("claveVistas: una clave por proyecto", () => {
  assert.notEqual(claveVistas("uuv"), claveVistas("proyecto-x"));
  assert.match(claveVistas("uuv"), /uuv/);
});

test("MAX_VISTAS es 20", () => {
  assert.equal(mod.MAX_VISTAS, 20);
});

test("leerVistas: null, JSON inválido o no arreglo devuelven []", () => {
  assert.deepEqual(leerVistas(null), []);
  assert.deepEqual(leerVistas("{no json"), []);
  assert.deepEqual(leerVistas('{"a":1}'), []);
  assert.deepEqual(leerVistas("42"), []);
});

test("leerVistas: ida y vuelta con serializarVistas", () => {
  const lista = [v("a", "Control"), v("b", "Sub real", { ...ESTADO, camara: undefined, nodo: null })];
  const leida = leerVistas(serializarVistas(lista));
  assert.equal(leida.length, 2);
  assert.equal(leida[0].nombre, "Control");
  assert.deepEqual(leida[0].estado.camara, { x: 0.4, y: 0.6, ratio: 0.5 });
  assert.equal(leida[1].estado.nodo, null);
  assert.equal(leida[1].estado.camara, undefined);
});

test("leerVistas: descarta entradas corruptas y conserva las válidas", () => {
  const raw = JSON.stringify([
    v("ok", "Buena"),
    null,
    7,
    { id: "sin-estado", nombre: "x", creada: 1 },
    v("", "id vacío"),
    v("n1", "   "),
    v("n2", 5),
    v("t1", "config no texto", { ...ESTADO, config: 3 }),
    v("t2", "legado no booleano", { ...ESTADO, legado: "sí" }),
    v("t3", "ocultos no arreglo", { ...ESTADO, ocultos: "control" }),
    v("t4", "cámara rota", { ...ESTADO, camara: { x: "a", y: 0, ratio: 1 } }),
    v("t5", "ratio no positivo", { ...ESTADO, camara: { x: 0, y: 0, ratio: 0 } }),
    v("ok", "id repetido"),
    v("ok2", "Otra buena"),
  ]);
  assert.deepEqual(leerVistas(raw).map((x) => x.id), ["ok", "ok2"]);
});

test("leerVistas: nombres largos se recortan a 60 caracteres y nunca devuelve más de 20", () => {
  const larga = v("l", "x".repeat(200));
  assert.equal(leerVistas(JSON.stringify([larga]))[0].nombre.length, 60);
  const muchas = Array.from({ length: 25 }, (_, i) => v(`v${i}`, `Vista ${i}`));
  assert.equal(leerVistas(JSON.stringify(muchas)).length, 20);
});

test("leerVistas: no copia campos extra del JSON (solo id, nombre, creada, estado conocido)", () => {
  const raw = JSON.stringify([{ ...v("a", "A"), html: "<b>x</b>", estado: { ...ESTADO, extra: 1 } }]);
  const [x] = leerVistas(raw);
  assert.deepEqual(Object.keys(x).sort(), ["creada", "estado", "id", "nombre"]);
  assert.equal("extra" in x.estado, false);
});

test("agregarVista: añade con nombre recortado; nombre vacío se rechaza", () => {
  const r = agregarVista([], "  Mi vista  ", ESTADO, "id1", 100);
  assert.equal(r.ok, true);
  assert.equal(r.lista.length, 1);
  assert.deepEqual(r.lista[0], { id: "id1", nombre: "Mi vista", creada: 100, estado: ESTADO });
  const vacia = agregarVista([], "   ", ESTADO, "id2", 100);
  assert.equal(vacia.ok, false);
  assert.equal(vacia.motivo, "nombre");
});

test("agregarVista: mismo nombre (sin mayúsculas) reemplaza la vista existente en su lugar", () => {
  const lista = [v("a", "Control"), v("b", "Otra")];
  const r = agregarVista(lista, "control", { ...ESTADO, plan: false }, "c", 5);
  assert.equal(r.ok, true);
  assert.deepEqual(r.lista.map((x) => x.id), ["a", "b"]);
  assert.equal(r.lista[0].estado.plan, false);
  assert.equal(lista[0].estado.plan, true, "no muta la lista original");
});

test("agregarVista: con 20 vistas una nueva se rechaza con motivo 'lleno'", () => {
  const llenas = Array.from({ length: 20 }, (_, i) => v(`v${i}`, `Vista ${i}`));
  const r = agregarVista(llenas, "Nueva", ESTADO, "x", 1);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "lleno");
  // Reemplazar una existente sí se puede aunque esté llena.
  assert.equal(agregarVista(llenas, "Vista 3", ESTADO, "x", 1).ok, true);
});

test("renombrarVista y borrarVista: por id, sin mutar; nombre vacío o repetido no renombra", () => {
  const lista = [v("a", "Uno"), v("b", "Dos")];
  assert.equal(renombrarVista(lista, "a", " Nuevo ")[0].nombre, "Nuevo");
  assert.equal(renombrarVista(lista, "a", "  ")[0].nombre, "Uno");
  assert.equal(renombrarVista(lista, "a", "dos")[0].nombre, "Uno", "no deja dos vistas con el mismo nombre");
  assert.equal(lista[0].nombre, "Uno");
  assert.deepEqual(borrarVista(lista, "a").map((x) => x.id), ["b"]);
  assert.deepEqual(borrarVista(lista, "zzz").map((x) => x.id), ["a", "b"]);
});

test("vistaAplicable: descarta config, sección, nodo y capas que ya no existen", () => {
  const ctx = { configs: ["sub_real"], secciones: ["control"], nodos: new Set(["ctl/asmc"]), grupos: ["control", "visualizacion"] };
  assert.deepEqual(vistaAplicable(ESTADO, ctx), ESTADO);
  const viejo = { ...ESTADO, config: "borrada", seccion: "vision", nodo: "ya/no", ocultos: ["visualizacion", "fantasma"] };
  const r = vistaAplicable(viejo, ctx);
  assert.equal(r.config, "all");
  assert.equal(r.seccion, null);
  assert.equal(r.nodo, null);
  assert.deepEqual(r.ocultos, ["visualizacion"]);
  assert.equal(r.plan, true);
  assert.deepEqual(r.camara, ESTADO.camara);
});
