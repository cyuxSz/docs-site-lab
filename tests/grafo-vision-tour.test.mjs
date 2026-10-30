// Lote 6b-2 · Recorrido de depuración de Visión: projects.json → uuv.secciones.vision.tour sigue la cadena real
// detección → servicio → tarea → control → thrust, con qué revisar en cada eslabón.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seccion, recorridoSeccion } from "../src/lib/secciones.ts";
import { graphNodes as N, graphEdges as E, VISION } from "./fixtures/ros-vision.mjs";

const projects = JSON.parse(readFileSync(fileURLToPath(new URL("../projects.json", import.meta.url)), "utf8"));
const crudo = projects.find((p) => p.id === "uuv")?.secciones?.vision?.tour;
// Cada test falla con un mensaje claro mientras falte el recorrido.
const pasos = () => {
  assert.ok(Array.isArray(crudo), "falta secciones.vision.tour en el proyecto uuv");
  return crudo;
};

test("projects.json (uuv): secciones.vision.tour existe, con 4–7 pasos y texto en cada uno", () => {
  const tour = pasos();
  assert.ok(tour.length >= 4 && tour.length <= 7, `pasos: ${tour.length}`);
  for (const p of tour) assert.ok(typeof p.node === "string" && typeof p.text === "string" && p.text.trim().length > 20, JSON.stringify(p));
});

test("tour de visión: sigue la cadena picture → gate_analizer → mission_handler_3 / instruction_handler", () => {
  const tour = pasos();
  const ids = tour.map((p) => p.node);
  assert.equal(ids[0], "uuv_vision/picture");
  const i = (id) => ids.indexOf(id);
  for (const id of ["uuv_vision/gate_analizer", "uuv_mission/mission_handler_3", "uuv_mission/instruction_handler"]) assert.ok(i(id) > 0, `falta ${id}`);
  assert.ok(i("uuv_vision/gate_analizer") < i("uuv_mission/mission_handler_3"), "la detección va antes que la tarea");
  assert.ok(i("uuv_vision/gate_analizer") < i("uuv_mission/instruction_handler"));
});

test("tour de visión: textos para depurar (servicios, topics, comandos y salto a Control)", () => {
  const tour = pasos();
  const todo = tour.map((p) => p.text).join("\n");
  for (const s of ["/camera/right", "/camera/low_res", "/take_picture", "/GateService", "/pose_objetivo", "/forces"]) assert.ok(todo.includes(s), `no menciona ${s}`);
  assert.match(todo, /ros2 service call \/take_picture/);
  assert.match(todo, /ros2 topic echo \/pose_objetivo/);
  assert.match(todo, /sim-competencia/);
  const ultimo = tour[tour.length - 1].text;
  assert.match(ultimo, /asmc/);
  assert.match(ultimo, /thrust_allocator/);
  assert.match(ultimo, /secci[oó]n Control/);
});

test("tour de visión: todos sus nodos son visibles en la sección (fixture con los ids reales) y recorridoSeccion lo conserva", () => {
  const tour = pasos();
  const s = seccion(N, E, "vision");
  const visibles = new Set([...s.core, ...s.context]);
  for (const p of tour) assert.ok(visibles.has(p.node), `${p.node} no está en la sección vision`);
  assert.deepEqual(recorridoSeccion(s, N, E, VISION, tour), tour);
});

// Comprobación extra contra los datos reales del build (.content/ lo deja tools/fetch.mjs; no está en git).
const REAL = fileURLToPath(new URL("../.content/data/uuv.json", import.meta.url));
test("tour de visión: con el ros.json real del build, todos los pasos están en la sección vision", { skip: !existsSync(REAL) && "sin .content/data/uuv.json" }, () => {
  const tour = pasos();
  const ros = JSON.parse(readFileSync(REAL, "utf8")).ros;
  const kindOf = { ros2_node: "node", ros2_topic: "topic", ros2_service: "service", ros2_action: "action", hardware: "hardware" };
  const nodes = ros.nodes.map((n) => {
    const kind = kindOf[n.category];
    return { id: n.id, label: n.label, kind, group: kind === "node" ? n.layer ?? "externo" : kind === "action" ? "service" : kind, status: n.status, configs: n.configs ?? [] };
  });
  const s = seccion(nodes, ros.edges, "vision");
  const visibles = new Set([...s.core, ...s.context]);
  for (const p of tour) assert.ok(visibles.has(p.node), `${p.node} no está en la sección vision real`);
});
