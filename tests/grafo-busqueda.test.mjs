// Lote 8b · QoL 8: búsqueda de nodos y topics en la barra del grafo (combobox).
// Lógica pura en src/lib/busqueda.ts: candidatos (lo visible y los topics/servicios que tocan lo visible),
// filtrado sin mayúsculas ni acentos y con coincidencia parcial, y a qué elemento ir al elegir un resultado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rosGraph } from "../src/lib/graph.ts";
import { projectData, graphNodes, graphEdges } from "./fixtures/ros-mini.mjs";

// Import dinámico: mientras no exista src/lib/busqueda.ts cada test falla con un mensaje claro.
const mod = await import("../src/lib/busqueda.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/busqueda.ts → ${name}`);
  return mod[name](...args);
};
const candidatosBusqueda = fn("candidatosBusqueda");
const filtrarBusqueda = fn("filtrarBusqueda");
const destinoBusqueda = fn("destinoBusqueda");

// Nodos del fixture con paquete (como los publicará rosGraph tras este lote).
const NODOS = graphNodes.map((n) => (n.kind === "node" ? { ...n, package: n.id.split("/")[0] } : n));
const EN_USO = new Set(["hw:zed", "nav/camera_opener", "mis/instruction_handler", "ctl/asmc", "ctl/thrust_allocator", "viz/plotter", "ext/bridge"]);

test("graph.ts: GraphNode tipa package y rosGraph lo publica en los nodos ROS (no en topics)", () => {
  const g = rosGraph(projectData());
  const cam = g.nodes.find((n) => n.id === "nav/camera_opener");
  assert.equal(cam.package, "nav");
  const pose = g.nodes.find((n) => n.id === "topic:/pose");
  assert.equal(pose.package, undefined);
});

test("candidatosBusqueda: nodos visibles + topics/servicios conectados a algo visible; nada oculto", () => {
  const items = candidatosBusqueda(NODOS, graphEdges, EN_USO);
  const ids = items.map((i) => i.id).sort();
  assert.ok(ids.includes("nav/camera_opener"));
  assert.ok(ids.includes("hw:zed"));
  assert.ok(ids.includes("topic:/pose"), "topic usado por un nodo visible");
  assert.ok(ids.includes("service:/take_picture"), "servicio usado por un nodo visible");
  // ctl/viejo y ctl/sinuso están ocultos; /debug solo lo publica ctl/sinuso.
  assert.ok(!ids.includes("ctl/viejo"));
  assert.ok(!ids.includes("ctl/sinuso"));
  assert.ok(!ids.includes("topic:/debug"), "topic que solo toca nodos ocultos no aparece");
  assert.equal(new Set(ids).size, ids.length, "sin duplicados");
});

test("candidatosBusqueda: cada resultado trae tipo legible y paquete (el topic toma el de quien lo publica)", () => {
  const items = candidatosBusqueda(NODOS, graphEdges, EN_USO);
  const by = new Map(items.map((i) => [i.id, i]));
  assert.deepEqual(
    { label: by.get("ctl/asmc").label, tipo: by.get("ctl/asmc").tipo, paquete: by.get("ctl/asmc").paquete },
    { label: "asmc", tipo: "nodo", paquete: "ctl" },
  );
  assert.equal(by.get("topic:/pose").tipo, "topic");
  assert.equal(by.get("topic:/pose").paquete, "nav", "/pose lo publica nav/camera_opener");
  assert.equal(by.get("service:/take_picture").tipo, "servicio");
  assert.equal(by.get("hw:zed").tipo, "hardware");
  assert.equal(by.get("hw:zed").paquete, "");
});

test("filtrarBusqueda: sin distinguir mayúsculas ni acentos, coincidencia parcial", () => {
  const items = candidatosBusqueda(NODOS, graphEdges, EN_USO);
  assert.deepEqual(filtrarBusqueda(items, "POSE").map((i) => i.id).sort(), ["topic:/pose", "topic:/pose_objetivo"]);
  assert.deepEqual(filtrarBusqueda(items, "opener").map((i) => i.id), ["nav/camera_opener"]);
  const conAcento = [{ id: "m", label: "misión_handler", tipo: "nodo", paquete: "mis", kind: "node" }];
  assert.equal(filtrarBusqueda(conAcento, "MISION").length, 1);
  assert.equal(filtrarBusqueda(conAcento, "misión").length, 1);
});

test("filtrarBusqueda: consulta vacía o solo espacios no devuelve nada; sin coincidencias devuelve []", () => {
  const items = candidatosBusqueda(NODOS, graphEdges, EN_USO);
  assert.deepEqual(filtrarBusqueda(items, ""), []);
  assert.deepEqual(filtrarBusqueda(items, "   "), []);
  assert.deepEqual(filtrarBusqueda(items, "zzz"), []);
});

test("filtrarBusqueda: primero los que empiezan por la consulta, luego el resto; alfabético dentro de cada grupo", () => {
  const it = (label) => ({ id: label, label, tipo: "nodo", paquete: "", kind: "node" });
  const items = [it("x_pose"), it("pose_b"), it("a_pose"), it("pose_a")];
  assert.deepEqual(filtrarBusqueda(items, "pose").map((i) => i.label), ["pose_a", "pose_b", "a_pose", "x_pose"]);
});

test("filtrarBusqueda: respeta el máximo de resultados (12 por defecto)", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `nodo_${String(i).padStart(2, "0")}`, tipo: "nodo", paquete: "", kind: "node" }));
  assert.equal(filtrarBusqueda(items, "nodo").length, 12);
  assert.equal(filtrarBusqueda(items, "nodo", 5).length, 5);
});

test("destinoBusqueda: un elemento visible se selecciona tal cual", () => {
  assert.equal(destinoBusqueda("ctl/asmc", graphEdges, EN_USO), "ctl/asmc");
});

test("destinoBusqueda: un topic oculto (vista por capas) va a su primer publicador visible, si no a un suscriptor", () => {
  // /forces lo publica ctl/asmc.
  assert.equal(destinoBusqueda("topic:/forces", graphEdges, EN_USO), "ctl/asmc");
  // Sin publicador visible: el suscriptor visible.
  const sinAsmc = new Set([...EN_USO].filter((id) => id !== "ctl/asmc"));
  assert.equal(destinoBusqueda("topic:/forces", graphEdges, sinAsmc), "ctl/thrust_allocator");
  // Nadie visible: null.
  assert.equal(destinoBusqueda("topic:/debug", graphEdges, EN_USO), null);
});
