// Lote 6b-1 · Capa "Plan" (arquitectura objetivo): lógica pura en src/lib/plan.ts y lo que rosGraph() publica.
// Sin el toggle, el grafo debe quedar idéntico al de un ros.json sin plan (ni aristas plan ni nodos solo-plan).
import { test } from "node:test";
import assert from "node:assert/strict";
import { rosGraph } from "../src/lib/graph.ts";
import { separarPlan, idsConPlan, planDisponible, etiquetaPlan, claveLayout, notaPlan, LEYENDA_PLAN } from "../src/lib/plan.ts";
import { planProjectData, planRosNodes, planRosEdges, planNodes } from "./fixtures/ros-plan.mjs";

const SOLO_PLAN = ["ext/ekf", "ext/imu_drv", "topic:/imu", "topic:/odom_f"];

// El mismo proyecto, pero como si ros.json no trajera la capa plan.
const sinPlan = () => {
  const p = planProjectData();
  const nodes = planRosNodes.filter((n) => !SOLO_PLAN.includes(n.id)).map(({ plan, ...n }) => n);
  const edges = planRosEdges.filter((e) => e.kind !== "plan");
  return { ...p, ros: { ...p.ros, nodes, edges } };
};

const conPlan = rosGraph(planProjectData({ tour: [{ node: "ctl/asmc", text: "a" }, { node: "ext/ekf", text: "solo plan" }] }));
const base = rosGraph({ ...sinPlan(), tour: [{ node: "ctl/asmc", text: "a" }] });
const byId = (id) => conPlan.nodes.find((n) => n.id === id);

test("separarPlan: aparta las aristas kind 'plan' y detecta los nodos que solo existen en el plan", () => {
  const r = separarPlan(planRosNodes, planRosEdges);
  assert.equal(r.planEdges.length, 6);
  assert.ok(r.planEdges.every((e) => e.kind === "plan"));
  assert.ok(r.edges.every((e) => e.kind !== "plan"));
  assert.equal(r.edges.length, planRosEdges.length - 6);
  assert.deepEqual([...r.soloPlan].sort(), SOLO_PLAN);
  assert.ok(!r.soloPlan.has("hw:ard"), "hw:ard tiene una arista real: no es solo-plan");
  assert.ok(!r.soloPlan.has("ctl/viejo"));
  assert.ok(!r.soloPlan.has("ctl/asmc"), "sin plan: true no es solo-plan aunque reciba aristas plan");
});

test("separarPlan: sin capa plan no cambia nada", () => {
  const nodes = planRosNodes.filter((n) => !n.plan);
  const edges = planRosEdges.filter((e) => e.kind !== "plan");
  const r = separarPlan(nodes, edges);
  assert.deepEqual(r.edges, edges);
  assert.deepEqual(r.planEdges, []);
  assert.equal(r.soloPlan.size, 0);
});

test("rosGraph sin el toggle: edges, flowEdges, secciones, recorridos y layouts iguales a los de un ros.json sin plan", () => {
  assert.ok(conPlan.edges.every((e) => e.kind !== "plan"), "data.edges no lleva aristas plan");
  assert.deepEqual(conPlan.flowEdges, base.flowEdges);
  assert.deepEqual(conPlan.sections, base.sections);
  assert.deepEqual(conPlan.tour, base.tour, "un paso del recorrido sobre un nodo solo-plan se descarta");
  for (const n of base.nodes) {
    const m = byId(n.id);
    for (const k of Object.keys(n.pos ?? {})) assert.deepEqual(m.pos?.[k], n.pos[k], `${n.id} cambió en pos['${k}']`);
  }
  for (const id of SOLO_PLAN) {
    const keys = Object.keys(byId(id)?.pos ?? {}).filter((k) => !k.includes("plan:"));
    assert.deepEqual(keys, [], `${id} no debe tener layout fuera de la capa plan`);
  }
});

test("rosGraph: marca plan / soloPlan en los nodos y publica planEdges y planFlowEdges", () => {
  for (const id of SOLO_PLAN) assert.equal(byId(id).soloPlan, true, id);
  assert.equal(byId("hw:ard").plan, true);
  assert.ok(!byId("hw:ard").soloPlan);
  assert.equal(byId("ctl/viejo").plan, true);
  assert.ok(!byId("ctl/asmc").plan);
  assert.equal(conPlan.planEdges?.length, 6);
  const flujo = (conPlan.planFlowEdges ?? []).map((e) => `${e.source}→${e.target}|${e.label}|${e.kind}`).sort();
  assert.deepEqual(flujo, [
    "ctl/asmc→ctl/viejo|/forces|plan",
    "ctl/viejo→hw:ard|PWM|plan",
    "ext/ekf→ctl/asmc|/odom_f|plan",
    "ext/imu_drv→ext/ekf|/imu|plan",
  ]);
});

test("rosGraph: layout por capas con plan ('capas:plan:<filtro>') para 'all', 'old' y configuraciones no legado", () => {
  for (const id of ["ext/ekf", "ext/imu_drv", "ctl/asmc", "ctl/viejo", "hw:ard", "hw:zed"]) {
    assert.ok(byId(id).pos?.["capas:plan:all"], `${id} sin capas:plan:all`);
    assert.ok(byId(id).pos?.["capas:plan:old"], `${id} sin capas:plan:old`);
  }
  assert.ok(byId("ext/ekf").pos["capas:plan:real"], "los nodos del plan entran en el layout de cada configuración");
  assert.ok(byId("ctl/asmc").pos["capas:plan:real"]);
  assert.ok(!byId("topic:/imu").pos?.["capas:plan:all"], "en el diseño por capas los topics no son nodos");
  assert.ok(conPlan.nodes.every((n) => !n.pos?.["capas:plan:legado"]), "la configuración legado no tiene capa plan");
  // Columnas en el sentido del dato: imu_drv → ekf → asmc → viejo → ard.
  const x = (id) => byId(id).pos["capas:plan:all"][0];
  assert.ok(x("ext/imu_drv") < x("ext/ekf") && x("ext/ekf") < x("ctl/asmc") && x("ctl/asmc") < x("ctl/viejo") && x("ctl/viejo") < x("hw:ard"));
});

test("rosGraph: un proyecto sin capa plan no publica planFlowEdges con contenido", () => {
  assert.ok(!base.planFlowEdges || base.planFlowEdges.length === 0);
  assert.ok(base.nodes.every((n) => !n.soloPlan));
});

test("idsConPlan: sin el toggle devuelve lo mismo; con él suma los extremos de las flechas plan", () => {
  const visibles = new Set(["ctl/asmc", "hw:zed"]);
  const flujo = [{ source: "ext/ekf", target: "ctl/asmc" }, { source: "ctl/asmc", target: "ctl/viejo" }];
  assert.deepEqual([...idsConPlan(visibles, flujo, false)].sort(), ["ctl/asmc", "hw:zed"]);
  assert.deepEqual([...idsConPlan(visibles, flujo, true)].sort(), ["ctl/asmc", "ctl/viejo", "ext/ekf", "hw:zed"]);
  assert.equal(visibles.size, 2, "no muta el conjunto recibido");
});

test("planDisponible: solo con aristas plan, sin sección y fuera de una configuración legado", () => {
  assert.equal(planDisponible({ planFlow: 4, seccion: null, config: undefined }), true);
  assert.equal(planDisponible({ planFlow: 4, seccion: null, config: { id: "real" } }), true);
  assert.equal(planDisponible({ planFlow: 0, seccion: null, config: undefined }), false);
  assert.equal(planDisponible({ planFlow: 4, seccion: "control", config: undefined }), false);
  assert.equal(planDisponible({ planFlow: 4, seccion: null, config: { id: "legado", legado: true } }), false);
});

test("claveLayout: misma clave que hoy sin plan; 'plan:<filtro>' con plan", () => {
  assert.equal(claveLayout({ seccion: null, showOld: false, config: "all", plan: false }), "all");
  assert.equal(claveLayout({ seccion: null, showOld: true, config: "all", plan: false }), "old");
  assert.equal(claveLayout({ seccion: null, showOld: true, config: "real", plan: false }), "real");
  assert.equal(claveLayout({ seccion: "control", showOld: false, config: "all", plan: false }), "seccion:control");
  assert.equal(claveLayout({ seccion: "control", showOld: true, config: "all", plan: false }), "seccion:control:old");
  assert.equal(claveLayout({ seccion: null, showOld: false, config: "all", plan: true }), "plan:all");
  assert.equal(claveLayout({ seccion: null, showOld: true, config: "all", plan: true }), "plan:old");
  assert.equal(claveLayout({ seccion: null, showOld: false, config: "real", plan: true }), "plan:real");
  assert.equal(claveLayout({ seccion: "control", showOld: false, config: "all", plan: true }), "seccion:control", "en sección el plan no aplica");
});

test("etiquetaPlan / notaPlan / leyenda: el plan se distingue con texto, no solo con color", () => {
  assert.equal(LEYENDA_PLAN, "Planeado, no corre hoy");
  assert.equal(etiquetaPlan("/forces"), "plan · /forces");
  assert.equal(etiquetaPlan(null), "plan");
  assert.equal(etiquetaPlan(""), "plan");
  assert.match(notaPlan({ plan: true, soloPlan: true }), /^Planeado, no corre hoy/);
  assert.match(notaPlan({ plan: true }), /arquitectura objetivo/);
  assert.doesNotMatch(notaPlan({ plan: true }), /no corre hoy/, "un nodo que ya existe no dice que no corre");
  assert.equal(notaPlan({}), null);
  assert.equal(planNodes.length, 5);
});

test("ninguna arista plan lleva forceLabel y el reducer solo etiqueta las enfocadas", async () => {
  const todas = [...(conPlan.planEdges ?? []), ...(conPlan.planFlowEdges ?? [])];
  assert.ok(todas.length > 0);
  assert.ok(todas.every((e) => !("forceLabel" in e)));
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/components/RoboticsGraph.tsx", import.meta.url), "utf8");
  assert.match(src, /label: enfocada \? etiquetaPlan\(attrs\.label\) : undefined/);
});
