// Lote 8c · legado y sin uso separados en el grafo (src/lib/estados.ts) y en las vistas guardadas (src/lib/vistas.ts).
// Dos filtros independientes, parámetros de URL propios (legado=1, sinuso=1), estilo distinto y las insignias agrupadas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphNodes } from "./fixtures/ros-mini.mjs";
import { leerVistas, serializarVistas, agregarVista, vistaAplicable } from "../src/lib/vistas.ts";

const mod = await import("../src/lib/estados.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/estados.ts → ${name}`);
  return mod[name](...args);
};
const ocultoPorEstado = fn("ocultoPorEstado");
const leerFiltrosUrl = fn("leerFiltrosUrl");
const escribirFiltrosUrl = fn("escribirFiltrosUrl");
const estiloEstado = fn("estiloEstado");
const insignias = fn("insignias");

const nodo = (id) => graphNodes.find((n) => n.id === id);
const NADA = { legado: false, sinUso: false };

test("FILTROS_INICIALES: legado y sin uso ocultos (como hoy)", () => {
  assert.deepEqual(mod.FILTROS_INICIALES, NADA);
});

test("ocultoPorEstado: cada filtro solo afecta a su estado", () => {
  const viejo = nodo("ctl/viejo");
  const sinuso = nodo("ctl/sinuso");
  const asmc = nodo("ctl/asmc");
  assert.equal(ocultoPorEstado(viejo, NADA), true);
  assert.equal(ocultoPorEstado(sinuso, NADA), true);
  assert.equal(ocultoPorEstado(asmc, NADA), false);
  assert.equal(ocultoPorEstado(viejo, { legado: true, sinUso: false }), false);
  assert.equal(ocultoPorEstado(sinuso, { legado: true, sinUso: false }), true, "mostrar legado no muestra sin uso");
  assert.equal(ocultoPorEstado(viejo, { legado: false, sinUso: true }), true, "mostrar sin uso no muestra legado");
  assert.equal(ocultoPorEstado(sinuso, { legado: false, sinUso: true }), false);
  assert.equal(ocultoPorEstado(nodo("ext/bridge"), NADA), false, "externo nunca se oculta por estado");
  assert.equal(ocultoPorEstado(nodo("topic:/debug"), NADA), false, "solo los nodos ROS (kind node) tienen estado");
  assert.equal(ocultoPorEstado({ kind: "node", status: "roto" }, NADA), false);
});

test("leerFiltrosUrl: legado=1 y sinuso=1 son independientes; sin parámetros, como antes (ocultos)", () => {
  assert.deepEqual(leerFiltrosUrl(""), NADA, "enlaces viejos sin parámetros se ven igual");
  assert.deepEqual(leerFiltrosUrl("?config=real&node=ctl%2Fasmc"), NADA);
  assert.deepEqual(leerFiltrosUrl("?legado=1"), { legado: true, sinUso: false });
  assert.deepEqual(leerFiltrosUrl("?sinuso=1"), { legado: false, sinUso: true });
  assert.deepEqual(leerFiltrosUrl("?legado=1&sinuso=1"), { legado: true, sinUso: true });
  assert.deepEqual(leerFiltrosUrl("?legado=0&sinuso=si"), NADA, "solo el valor 1 activa");
  assert.deepEqual(leerFiltrosUrl("legado=1"), { legado: true, sinUso: false }, "acepta la cadena sin '?'");
});

test("escribirFiltrosUrl: pone 1 o quita el parámetro, sin tocar los demás", () => {
  const q = new URLSearchParams("config=real&legado=1&sinuso=1");
  escribirFiltrosUrl(q, { legado: false, sinUso: true });
  assert.equal(q.get("config"), "real");
  assert.equal(q.get("legado"), null);
  assert.equal(q.get("sinuso"), "1");
  escribirFiltrosUrl(q, { legado: true, sinUso: false });
  assert.equal(q.get("legado"), "1");
  assert.equal(q.get("sinuso"), null);
  escribirFiltrosUrl(q, NADA);
  assert.equal(q.toString(), "config=real");
});

test("estiloEstado: legado conserva el color de la capa con reloj; sin uso va en gris; el resto sin cambios", () => {
  const leg = estiloEstado("legado", "#007ACC");
  assert.equal(leg.color, "#007ACC");
  assert.equal(leg.prefijo, "◷ ");
  const sin = estiloEstado("sin_uso", "#007ACC");
  assert.match(mod.GRIS_SIN_USO, /^#[0-9a-f]{6}$/i);
  assert.equal(sin.color, mod.GRIS_SIN_USO);
  assert.notEqual(sin.color, "#007ACC");
  assert.equal(sin.prefijo, "");
  assert.notDeepEqual(leg, sin, "legado y sin uso se distinguen");
  assert.deepEqual(estiloEstado("en_uso", "#10B981"), { color: "#10B981", prefijo: "" });
  assert.deepEqual(estiloEstado(undefined, "#10B981"), { color: "#10B981", prefijo: "" });
});

test("insignias: estado primero (con clase y título) y luego plan, en un solo grupo", () => {
  const leg = insignias({ status: "legado" });
  assert.equal(leg.length, 1);
  assert.equal(leg[0].clase, "badge-legado");
  assert.equal(leg[0].texto, "Legado");
  assert.ok(leg[0].titulo.length > 0, "el título explica qué significa");
  const sin = insignias({ status: "sin_uso", plan: true });
  assert.deepEqual(sin.map((x) => x.clase), ["badge-sin_uso", "badge-plan"]);
  assert.equal(sin[0].texto, "Sin uso");
  assert.notEqual(sin[0].titulo, leg[0].titulo);
  assert.deepEqual(insignias({ plan: true, soloPlan: true }).map((x) => x.texto), ["Solo plan"]);
  assert.deepEqual(insignias({}), []);
  assert.deepEqual(insignias({ status: "raro" }), [], "estados desconocidos no generan insignia");
});

// --- Vistas guardadas: guardan los dos filtros; las entradas viejas (solo "legado") siguen siendo válidas ---
const BASE = { vista: "ros", config: "all", seccion: null, plan: false, ocultos: [], nodo: null };

test("vistas: guardar y leer conserva legado y sinUso por separado", () => {
  const r = agregarVista([], "Solo sin uso", { ...BASE, legado: false, sinUso: true }, "a", 1);
  assert.ok(r.ok);
  const [v] = leerVistas(serializarVistas(r.lista));
  assert.equal(v.estado.legado, false);
  assert.equal(v.estado.sinUso, true);
});

test("vistas: una entrada vieja sin sinUso es válida y hereda el toggle combinado (sinUso = legado)", () => {
  const viejas = JSON.stringify([
    { id: "v1", nombre: "Con todo", creada: 1, estado: { ...BASE, legado: true } },
    { id: "v2", nombre: "Limpia", creada: 2, estado: { ...BASE, legado: false } },
  ]);
  const l = leerVistas(viejas);
  assert.equal(l.length, 2);
  assert.deepEqual([l[0].estado.legado, l[0].estado.sinUso], [true, true]);
  assert.deepEqual([l[1].estado.legado, l[1].estado.sinUso], [false, false]);
});

test("vistas: sinUso no booleano invalida la entrada", () => {
  const malas = JSON.stringify([{ id: "x", nombre: "Mala", creada: 1, estado: { ...BASE, legado: false, sinUso: "sí" } }]);
  assert.deepEqual(leerVistas(malas), []);
});

test("vistas: vistaAplicable conserva los dos filtros", () => {
  const a = vistaAplicable({ ...BASE, legado: true, sinUso: false }, { configs: [], secciones: [], nodos: new Set(), grupos: [] });
  assert.equal(a.legado, true);
  assert.equal(a.sinUso, false);
});
