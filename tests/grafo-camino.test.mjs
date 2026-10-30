// Lote 22 · camino entre nodos (src/lib/camino.ts): BFS dirigido en el sentido de los mensajes
// (nodo → topic → nodo), alternativa no dirigida, restricción a la configuración, texto de los pasos y la URL
// (desde=, hasta=). También qué modo abre un enlace que trae comparar= y desde=/hasta= a la vez.
import { test } from "node:test";
import assert from "node:assert/strict";
import { graphNodes, graphEdges } from "./fixtures/ros-mini.mjs";

const mod = await import("../src/lib/camino.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/camino.ts → ${name}`);
  return mod[name](...args);
};
const caminoMasCorto = fn("caminoMasCorto");
const textoCamino = fn("textoCamino");
const aristasCamino = fn("aristasCamino");
const leerCaminoUrl = fn("leerCaminoUrl");
const escribirCaminoUrl = fn("escribirCaminoUrl");
const modoInicialUrl = fn("modoInicialUrl");

const nodes = graphNodes;
const edges = graphEdges;
const IDS = new Set(nodes.map((n) => n.id));
const E = (source, target, kind = "pub", label = null) => ({ source, target, kind, label });

test("dirigido: camera_opener → /pose → asmc → /forces → thrust_allocator", () => {
  const r = caminoMasCorto(nodes, edges, "nav/camera_opener", "ctl/thrust_allocator");
  assert.deepEqual(r, { dirigido: true, pasos: ["nav/camera_opener", "topic:/pose", "ctl/asmc", "topic:/forces", "ctl/thrust_allocator"] });
});

test("dirigido: elige la ruta más corta aunque haya otra más larga (vía instruction_handler)", () => {
  const r = caminoMasCorto(nodes, edges, "nav/camera_opener", "ctl/asmc");
  assert.deepEqual(r.pasos, ["nav/camera_opener", "topic:/pose", "ctl/asmc"]);
  assert.equal(r.dirigido, true);
});

test("mismo origen y destino: un solo paso, dirigido", () => {
  assert.deepEqual(caminoMasCorto(nodes, edges, "ctl/asmc", "ctl/asmc"), { dirigido: true, pasos: ["ctl/asmc"] });
});

test("sin ruta dirigida: ofrece la no dirigida y lo marca (dirigido: false)", () => {
  const r = caminoMasCorto(nodes, edges, "ctl/thrust_allocator", "nav/camera_opener");
  assert.equal(r.dirigido, false);
  assert.deepEqual(r.pasos, ["ctl/thrust_allocator", "topic:/forces", "ctl/asmc", "topic:/pose", "nav/camera_opener"]);
});

test("sin ninguna ruta (ni dirigida ni no dirigida): null", () => {
  assert.equal(caminoMasCorto(nodes, edges, "ctl/asmc", "ctl/sinuso"), null);
});

test("ids desconocidos: null", () => {
  assert.equal(caminoMasCorto(nodes, edges, "ctl/asmc", "nope"), null);
  assert.equal(caminoMasCorto(nodes, edges, "nope", "ctl/asmc"), null);
});

test("ciclos: termina y da la ruta más corta", () => {
  // Realimentación: thrust_allocator publica /pose (ciclo asmc → /forces → thrust → /pose → asmc).
  const ciclo = [...edges, E("ctl/thrust_allocator", "topic:/pose", "pub", "/pose")];
  const r = caminoMasCorto(nodes, ciclo, "ctl/thrust_allocator", "mis/instruction_handler");
  assert.deepEqual(r, { dirigido: true, pasos: ["ctl/thrust_allocator", "topic:/pose", "mis/instruction_handler"] });
  const vuelta = caminoMasCorto(nodes, ciclo, "ctl/asmc", "ctl/asmc");
  assert.deepEqual(vuelta.pasos, ["ctl/asmc"]);
});

test("topics con varios publicadores: no se 'retrocede' de un topic a otro publicador en modo dirigido", () => {
  const sim = { id: "nav/sim_pose", label: "sim_pose", group: "navegacion", kind: "node", status: "en_uso", configs: [], x: 0, y: 0, size: 5 };
  const ns = [...nodes, sim];
  const es = [...edges, E("nav/sim_pose", "topic:/pose", "pub", "/pose")];
  assert.deepEqual(caminoMasCorto(ns, es, "nav/sim_pose", "ctl/asmc"), { dirigido: true, pasos: ["nav/sim_pose", "topic:/pose", "ctl/asmc"] });
  const r = caminoMasCorto(ns, es, "nav/camera_opener", "nav/sim_pose");
  assert.equal(r.dirigido, false, "dos publicadores del mismo topic no se hablan");
  assert.deepEqual(r.pasos, ["nav/camera_opener", "topic:/pose", "nav/sim_pose"]);
});

test("respeta la configuración: solo pasa por ids permitidos; si el origen o destino no está, null", () => {
  // Sin asmc (p. ej. otra configuración) la única ruta de camera_opener a thrust_allocator desaparece.
  const permitidos = new Set([...IDS].filter((id) => id !== "ctl/asmc"));
  assert.equal(caminoMasCorto(nodes, edges, "nav/camera_opener", "ctl/thrust_allocator", permitidos), null);
  // Sin /pose directo, camera_opener sigue llegando a instruction_handler por el servicio.
  const sinPose = new Set([...IDS].filter((id) => id !== "topic:/pose"));
  assert.deepEqual(caminoMasCorto(nodes, edges, "nav/camera_opener", "mis/instruction_handler", sinPose), {
    dirigido: true,
    pasos: ["nav/camera_opener", "service:/take_picture", "mis/instruction_handler"],
  });
  const sinOrigen = new Set([...IDS].filter((id) => id !== "nav/camera_opener"));
  assert.equal(caminoMasCorto(nodes, edges, "nav/camera_opener", "ctl/asmc", sinOrigen), null);
});

test("textoCamino: nodo —topic→ nodo; sin sentido en los tramos no dirigidos; flecha simple entre dueños", () => {
  assert.equal(
    textoCamino(["nav/camera_opener", "topic:/pose", "ctl/asmc", "topic:/forces", "ctl/thrust_allocator"], nodes, edges),
    "camera_opener —/pose→ asmc —/forces→ thrust_allocator",
  );
  assert.equal(textoCamino(["ctl/thrust_allocator", "topic:/forces", "ctl/asmc"], nodes, edges), "thrust_allocator —/forces— asmc");
  assert.equal(textoCamino(["hw:zed", "nav/camera_opener"], nodes, edges), "ZED 2 → camera_opener");
  assert.equal(textoCamino(["nav/camera_opener", "hw:zed"], nodes, edges), "camera_opener — ZED 2");
  assert.equal(textoCamino(["topic:/pose", "ctl/asmc"], nodes, edges), "/pose → asmc", "extremo que es topic");
  assert.equal(textoCamino(["ctl/asmc"], nodes, edges), "asmc");
});

test("aristasCamino: pares consecutivos como claves 'origen>destino' en el sentido real de la arista", () => {
  assert.deepEqual(aristasCamino(["nav/camera_opener", "topic:/pose", "ctl/asmc"], edges), ["nav/camera_opener>topic:/pose", "topic:/pose>ctl/asmc"]);
  assert.deepEqual(aristasCamino(["ctl/thrust_allocator", "topic:/forces", "ctl/asmc"], edges), ["topic:/forces>ctl/thrust_allocator", "ctl/asmc>topic:/forces"]);
  assert.deepEqual(aristasCamino(["ctl/asmc"], edges), []);
});

test("leerCaminoUrl: desde= y hasta= con ids existentes; si falta uno o no existe, null", () => {
  const q = `?desde=${encodeURIComponent("nav/camera_opener")}&hasta=${encodeURIComponent("ctl/asmc")}`;
  assert.deepEqual(leerCaminoUrl(q, IDS), { desde: "nav/camera_opener", hasta: "ctl/asmc" });
  assert.deepEqual(leerCaminoUrl(q.slice(1), IDS), { desde: "nav/camera_opener", hasta: "ctl/asmc" }, "acepta la cadena sin '?'");
  assert.equal(leerCaminoUrl("", IDS), null);
  assert.equal(leerCaminoUrl("?desde=ctl%2Fasmc", IDS), null);
  assert.equal(leerCaminoUrl("?desde=ctl%2Fasmc&hasta=nope", IDS), null);
});

test("escribirCaminoUrl: pone desde/hasta o los quita sin tocar lo demás", () => {
  const q = new URLSearchParams("config=sim&node=ctl%2Fasmc");
  escribirCaminoUrl(q, { desde: "nav/camera_opener", hasta: "ctl/asmc" });
  assert.equal(q.get("desde"), "nav/camera_opener");
  assert.equal(q.get("hasta"), "ctl/asmc");
  assert.equal(q.get("config"), "sim");
  escribirCaminoUrl(q, null);
  assert.equal(q.get("desde"), null);
  assert.equal(q.get("hasta"), null);
  assert.equal(q.get("node"), "ctl/asmc");
});

test("modoInicialUrl: comparar gana a camino; sin parámetros válidos, null", () => {
  const configs = ["jetson", "sim"];
  const camino = `desde=${encodeURIComponent("nav/camera_opener")}&hasta=${encodeURIComponent("ctl/asmc")}`;
  assert.deepEqual(modoInicialUrl(`?${camino}`, configs, IDS), { tipo: "camino", desde: "nav/camera_opener", hasta: "ctl/asmc" });
  assert.deepEqual(modoInicialUrl(`?comparar=jetson,sim&${camino}`, configs, IDS), { tipo: "comparar", a: "jetson", b: "sim" });
  assert.deepEqual(modoInicialUrl(`?comparar=jetson,nope&${camino}`, configs, IDS), { tipo: "camino", desde: "nav/camera_opener", hasta: "ctl/asmc" });
  assert.equal(modoInicialUrl("?config=sim", configs, IDS), null);
});
