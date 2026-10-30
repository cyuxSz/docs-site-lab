// Lote 21 · comparar dos configuraciones en el grafo ROS (src/lib/comparar.ts): miembros de cada configuración,
// unión clasificada en "solo A", "solo B" y "ambas", resumen textual, lista de diferencias, estilo con color e ícono
// y el parámetro de URL comparar=a,b.
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphNodes, graphEdges } from "./fixtures/ros-mini.mjs";

const mod = await import("../src/lib/comparar.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/comparar.ts → ${name}`);
  return mod[name](...args);
};
const miembrosConfig = fn("miembrosConfig");
const compararConfigs = fn("compararConfigs");
const textoResumen = fn("textoResumen");
const estiloComparar = fn("estiloComparar");
const leerCompararUrl = fn("leerCompararUrl");
const escribirCompararUrl = fn("escribirCompararUrl");

// Dos configuraciones: "jetson" (robot real) y "sim" (simulación). La cámara solo corre en el robot, el plotter
// solo en la simulación; misión, control y el puente corren en ambas.
const EN = {
  "hw:zed": ["jetson"],
  "nav/camera_opener": ["jetson"],
  "mis/instruction_handler": ["jetson", "sim"],
  "ctl/asmc": ["jetson", "sim"],
  "ctl/thrust_allocator": ["jetson", "sim"],
  "ctl/viejo": ["viejo"],
  "ctl/sinuso": [],
  "viz/plotter": ["sim"],
  "ext/bridge": ["jetson", "sim"],
};
const nodes = graphNodes.map((n) => ({ ...n, configs: EN[n.id] ?? [] }));
const edges = graphEdges;
const CONFIGS = ["jetson", "sim", "viejo"];

test("miembrosConfig: dueños por su lista configs y topics/servicios que tocan algún dueño de la configuración", () => {
  const j = miembrosConfig(nodes, edges, "jetson");
  assert.ok(j instanceof Set);
  for (const id of ["hw:zed", "nav/camera_opener", "ctl/asmc", "ext/bridge", "topic:/pose", "topic:/forces", "topic:/matriz", "service:/take_picture"]) assert.ok(j.has(id), id);
  for (const id of ["viz/plotter", "ctl/viejo", "ctl/sinuso", "topic:/debug"]) assert.ok(!j.has(id), id);
  const s = miembrosConfig(nodes, edges, "sim");
  assert.ok(s.has("topic:/pose"), "/pose lo suscribe instruction_handler aunque su publicador no esté en sim");
  assert.ok(!s.has("nav/camera_opener"));
  assert.ok(s.has("viz/plotter"));
});

test("miembrosConfig: 'all' respeta los filtros legado/sin uso y nunca incluye nodos solo-plan", () => {
  const conPlan = [...nodes, { id: "ctl/futuro", label: "futuro", group: "control", kind: "node", configs: ["jetson"], soloPlan: true, x: 0, y: 0, size: 5 }];
  const todo = miembrosConfig(conPlan, edges, "all", { legado: false, sinUso: false });
  assert.ok(todo.has("ctl/asmc"));
  assert.ok(!todo.has("ctl/viejo") && !todo.has("ctl/sinuso"), "ocultos por defecto");
  assert.ok(!todo.has("topic:/debug"), "solo lo publica un nodo sin uso");
  assert.ok(!todo.has("ctl/futuro"));
  const conViejo = miembrosConfig(conPlan, edges, "all", { legado: true, sinUso: true });
  assert.ok(conViejo.has("ctl/viejo") && conViejo.has("ctl/sinuso") && conViejo.has("topic:/debug"));
  assert.ok(!miembrosConfig(conPlan, edges, "jetson").has("ctl/futuro"), "solo-plan tampoco en una configuración");
});

test("compararConfigs: clasifica la unión en a, b y ambas; lo que no está en ninguna no aparece", () => {
  const r = compararConfigs(nodes, edges, "jetson", "sim");
  assert.ok(r.lado instanceof Map);
  assert.equal(r.lado.get("nav/camera_opener"), "a");
  assert.equal(r.lado.get("hw:zed"), "a");
  assert.equal(r.lado.get("viz/plotter"), "b");
  assert.equal(r.lado.get("ctl/asmc"), "ambas");
  assert.equal(r.lado.get("topic:/forces"), "ambas");
  assert.equal(r.lado.get("service:/take_picture"), "ambas", "lo usa instruction_handler, que está en las dos");
  assert.equal(r.lado.has("ctl/viejo"), false);
  assert.equal(r.lado.has("topic:/debug"), false);
});

test("compararConfigs: resumen cuenta nodos y topics de la unión (sin hardware ni servicios en el resumen)", () => {
  const r = compararConfigs(nodes, edges, "jetson", "sim");
  // Nodos: solo A camera_opener; solo B plotter; ambas instruction_handler, asmc, thrust_allocator, bridge.
  // Topics: ambas /pose, /pose_objetivo, /forces, /matriz.
  assert.deepEqual(r.resumen, { soloA: 1, soloB: 1, comun: 8 });
});

test("compararConfigs: diferencias como listas ordenadas (nodos antes que topics, luego por nombre) con id, label y kind", () => {
  const extra = [...nodes, { id: "topic:/sim_only", label: "/sim_only", group: "topic", kind: "topic", configs: [], x: 0, y: 0, size: 3 }, { id: "nav/aaa_sim", label: "aaa_sim", group: "navegacion", kind: "node", configs: ["sim"], x: 0, y: 0, size: 5 }];
  const ext = [...edges, { source: "nav/aaa_sim", target: "topic:/sim_only", kind: "pub", label: "/sim_only" }];
  const r = compararConfigs(extra, ext, "jetson", "sim");
  assert.deepEqual(r.diferencias.soloA.map((i) => i.id), ["nav/camera_opener"]);
  assert.deepEqual(r.diferencias.soloB.map((i) => i.id), ["nav/aaa_sim", "viz/plotter", "topic:/sim_only"]);
  assert.deepEqual(r.diferencias.soloB[0], { id: "nav/aaa_sim", label: "aaa_sim", kind: "node" });
  assert.deepEqual(r.resumen, { soloA: 1, soloB: 3, comun: 8 });
});

test("compararConfigs: la misma configuración en A y B deja todo en común", () => {
  const r = compararConfigs(nodes, edges, "sim", "sim");
  assert.equal(r.resumen.soloA, 0);
  assert.equal(r.resumen.soloB, 0);
  assert.ok([...r.lado.values()].every((l) => l === "ambas"));
});

test("textoResumen: 'N solo en A, M solo en B, K en común' con los nombres de las configuraciones", () => {
  assert.equal(textoResumen({ soloA: 2, soloB: 1, comun: 9 }, "Jetson", "Sim competencia"), "2 solo en Jetson, 1 solo en Sim competencia, 9 en común");
  assert.equal(textoResumen({ soloA: 0, soloB: 0, comun: 3 }, "A", "B"), "0 solo en A, 0 solo en B, 3 en común");
});

test("estiloComparar: cada lado con color, ícono y texto propios (no solo color)", () => {
  const a = estiloComparar("a");
  const b = estiloComparar("b");
  const c = estiloComparar("ambas");
  for (const e of [a, b, c]) {
    assert.match(e.color, /^#[0-9a-f]{6}$/i);
    assert.equal(typeof e.icono, "string");
    assert.equal(typeof e.texto, "string");
    assert.ok(e.texto.length > 0);
  }
  assert.equal(new Set([a.color, b.color, c.color]).size, 3, "tres colores distintos");
  assert.ok(a.icono && b.icono, "solo A y solo B llevan ícono");
  assert.notEqual(a.icono, b.icono);
  assert.notEqual(a.icono, c.icono);
  assert.notEqual(b.icono, c.icono);
  assert.match(a.texto, /solo en A/i);
  assert.match(b.texto, /solo en B/i);
  assert.match(c.texto, /ambas/i);
});

test("leerCompararUrl: comparar=a,b con ids existentes y distintos; si no, null", () => {
  assert.deepEqual(leerCompararUrl("?comparar=jetson,sim", CONFIGS), ["jetson", "sim"]);
  assert.deepEqual(leerCompararUrl("comparar=sim%2Cjetson&config=real", CONFIGS), ["sim", "jetson"]);
  assert.equal(leerCompararUrl("", CONFIGS), null);
  assert.equal(leerCompararUrl("?comparar=jetson", CONFIGS), null);
  assert.equal(leerCompararUrl("?comparar=jetson,jetson", CONFIGS), null, "iguales: no hay nada que comparar");
  assert.equal(leerCompararUrl("?comparar=jetson,nope", CONFIGS), null);
  assert.equal(leerCompararUrl("?comparar=jetson,sim,viejo", CONFIGS), null);
  assert.equal(leerCompararUrl("?comparar=all,sim", CONFIGS), null, "'all' no es una configuración");
});

test("escribirCompararUrl: pone comparar=a,b o lo quita, sin tocar los demás parámetros", () => {
  const q = new URLSearchParams("config=jetson&legado=1");
  escribirCompararUrl(q, ["jetson", "sim"]);
  assert.equal(q.get("comparar"), "jetson,sim");
  assert.equal(q.get("config"), "jetson");
  assert.equal(q.get("legado"), "1");
  escribirCompararUrl(q, null);
  assert.equal(q.get("comparar"), null);
  assert.equal(q.get("config"), "jetson");
});
