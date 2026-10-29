// rosGraph() publica las secciones en el JSON del grafo, con layout propio por sección calculado en el build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rosGraph } from "../src/lib/graph.ts";
import { projectData } from "./fixtures/ros-mini.mjs";

const data = rosGraph(projectData({ secciones: { mision: { tour: [{ node: "mis/instruction_handler", text: "Texto propio." }] } } }));
const byId = (id) => data.nodes.find((n) => n.id === id);

test("rosGraph: trae una sección por capa con nodos propios, en el orden de LAYERS", () => {
  assert.ok(Array.isArray(data.sections), "falta data.sections");
  assert.deepEqual(data.sections.map((s) => s.id), ["control", "mision", "navegacion", "visualizacion", "externo", "hardware"]);
  const control = data.sections.find((s) => s.id === "control");
  assert.equal(control.label, "Control");
  assert.equal(control.hint, "calcula las fuerzas para mover el sub");
  assert.deepEqual(control.core, ["ctl/asmc", "ctl/thrust_allocator"]);
  assert.deepEqual(control.context, ["ext/bridge", "mis/instruction_handler", "nav/camera_opener", "viz/plotter"]);
  assert.ok(control.old.core.includes("ctl/viejo"), "variante con legado");
});

test("rosGraph: cada sección trae su recorrido; projects.json → secciones.<id>.tour lo sobrescribe", () => {
  const control = data.sections.find((s) => s.id === "control");
  assert.deepEqual(control.tour.map((t) => t.node), ["ctl/asmc", "ctl/thrust_allocator"]);
  assert.ok(control.tour[0].text.startsWith("Control: "));
  assert.deepEqual(data.sections.find((s) => s.id === "mision").tour, [{ node: "mis/instruction_handler", text: "Texto propio." }]);
});

test("rosGraph: layout propio por sección (pos['seccion:<id>'] y 'capas:seccion:<id>' para el diseño A)", () => {
  for (const id of ["ctl/asmc", "topic:/forces", "nav/camera_opener"]) assert.ok(byId(id).pos["seccion:control"], `${id} sin seccion:control`);
  assert.ok(byId("ctl/asmc").pos["capas:seccion:control"]);
  assert.ok(byId("nav/camera_opener").pos["capas:seccion:control"], "el contexto también va en el layout por capas");
  assert.equal(byId("topic:/forces").pos["capas:seccion:control"], undefined, "los topics no son nodos en el diseño A");
  assert.equal(byId("ctl/viejo").pos["seccion:control"], undefined, "legado fuera del layout por defecto");
  assert.ok(byId("ctl/viejo").pos["seccion:control:old"], "legado dentro del layout con legado");
  assert.equal(byId("hw:zed").pos["seccion:control"], undefined, "lo que no toca la sección no tiene posición");
});

test("rosGraph: las secciones no cambian los layouts existentes ni el recorrido global", () => {
  assert.ok(byId("ctl/asmc").pos.all && byId("ctl/asmc").pos.old && byId("ctl/asmc").pos["capas:all"]);
  assert.deepEqual(data.tour, []);
});
