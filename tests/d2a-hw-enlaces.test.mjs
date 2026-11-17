// Lote D2a · Enlaces entre el grafo y el hardware. Lógica pura en src/lib/hw-enlaces.ts:
// - enlacesHardware(): valida projects.json → hwPaginas ({"hw:zed": "electronica/sensores-actuadores"}) contra los nodos
//   de hardware de ros.json y las disciplinas del proyecto; lo inválido avisa y se ignora (nunca lanza).
// - usadoPor(): por página de una disciplina, los nodos ROS conectados a cada hw:* enlazado (se calcula en el build).
// - usoDePagina(): lectura defensiva en el cliente del JSON que la página lleva en un atributo data-*.
import { test } from "node:test";
import assert from "node:assert/strict";
import { enlacesHardware, usadoPor, usoDePagina, HW_PAGINA } from "../src/lib/hw-enlaces.ts";
import { rosGraph } from "../src/lib/graph.ts";
import { rosNodes, rosEdges, projectData } from "./fixtures/ros-mini.mjs";

const DISC = { electronica: { plantilla: "electronica", editores: [] }, mecanica: { plantilla: "mecanica", editores: [] } };
const proyecto = (hwPaginas, extra = {}) => ({ id: "uuv", disciplinas: DISC, hwPaginas, ...extra });

// Grafo con la forma real del UUV: Arduino (con arista hw y plan desde el mismo nodo), ESC (solo hardware) y un nodo
// que solo llega por una arista plan.
const hw = (id, label) => ({ id, label, category: "hardware", layer: "hardware", configs: [] });
const nodo = (id) => ({ id, label: id.split("/").pop(), category: "ros2_node", package: id.split("/")[0], layer: "control", status: "en_uso", configs: [] });
const arista = (source, target, kind) => ({ source, target, kind, label: null, file: "x.py", line: 1 });
const ROS = {
  configs: [],
  launches: [],
  nodes: [
    ...rosNodes,
    hw("hw:arduino", "Arduino"),
    hw("hw:esc", "6 ESC / thrusters"),
    nodo("ctl/to_arduino"),
    nodo("ctl/futuro"),
  ],
  edges: [
    ...rosEdges,
    arista("hw:arduino", "hw:esc", "hw"),
    arista("ctl/to_arduino", "hw:arduino", "hw"),
    arista("ctl/to_arduino", "hw:arduino", "plan"),
    arista("ctl/futuro", "hw:arduino", "plan"),
  ],
};

// ---------- formato ----------
test("HW_PAGINA: <disciplina>/<slug> con el mismo slug que la API de hardware", () => {
  for (const ok of ["electronica/sensores-actuadores", "mecanica/ensamble", "electronica/a", `electronica/${"a".repeat(60)}`]) assert.ok(HW_PAGINA.test(ok), ok);
  for (const malo of ["electronica", "electronica/", "/electronica/x", "electronica/Sensores", "electronica/a/b", "electronica/../x", "electronica/a_b", `electronica/${"a".repeat(61)}`, "electronica/x?y", ""])
    assert.ok(!HW_PAGINA.test(malo), malo);
});

// ---------- enlacesHardware ----------
test("enlacesHardware: hw:* existente con slug válido → href de la API de hardware y etiqueta por disciplina", () => {
  const { enlaces, avisos } = enlacesHardware(proyecto({ "hw:zed": "electronica/sensores-actuadores", "hw:esc": "mecanica/ensamble" }), ROS.nodes);
  assert.deepEqual(avisos, []);
  assert.deepEqual(enlaces["hw:zed"], { disciplina: "electronica", slug: "sensores-actuadores", href: "/uuv/electronica/?p=sensores-actuadores", etiqueta: "Ver en Electrónica" });
  assert.deepEqual(enlaces["hw:esc"], { disciplina: "mecanica", slug: "ensamble", href: "/uuv/mecanica/?p=ensamble", etiqueta: "Ver en Mecánica" });
});

test("enlacesHardware: sin hwPaginas no hay enlaces ni avisos", () => {
  for (const vacio of [undefined, null, {}]) {
    const r = enlacesHardware(proyecto(vacio), ROS.nodes);
    assert.deepEqual(r, { enlaces: {}, avisos: [] }, String(vacio));
  }
});

test("enlacesHardware: hw:* inexistente, id que no es de hardware o slug inválido → aviso y se ignora (no lanza)", () => {
  const { enlaces, avisos } = enlacesHardware(
    proyecto({
      "hw:zed": "electronica/sensores-actuadores",
      "hw:fantasma": "electronica/pcb",
      "nav/camera_opener": "electronica/pcb",
      "topic:/pose": "electronica/pcb",
      "hw:arduino": "electronica/Placa Arduino",
      "hw:esc": "electronica/../pcb",
    }),
    ROS.nodes,
  );
  assert.deepEqual(Object.keys(enlaces), ["hw:zed"]);
  assert.equal(avisos.length, 5);
  for (const id of ["hw:fantasma", "nav/camera_opener", "topic:/pose", "hw:arduino", "hw:esc"]) assert.ok(avisos.some((a) => a.includes(id)), `aviso para ${id}`);
  for (const a of avisos) assert.match(a, /hwPaginas/, "el aviso dice de dónde sale");
});

test("enlacesHardware: disciplina no configurada en el proyecto → aviso", () => {
  const p = { id: "uuv", disciplinas: { electronica: DISC.electronica }, hwPaginas: { "hw:zed": "mecanica/ensamble", "hw:esc": "software/x" } };
  const { enlaces, avisos } = enlacesHardware(p, ROS.nodes);
  assert.deepEqual(enlaces, {});
  assert.equal(avisos.length, 2);
  assert.ok(avisos.some((a) => a.includes("mecanica")));
});

test("enlacesHardware: hwPaginas con forma inválida (array, texto, valores no texto) avisa sin romper", () => {
  for (const malo of [["hw:zed"], "hw:zed", 42]) {
    const r = enlacesHardware(proyecto(malo), ROS.nodes);
    assert.deepEqual(r.enlaces, {});
    assert.equal(r.avisos.length, 1, JSON.stringify(malo));
  }
  const r = enlacesHardware(proyecto({ "hw:zed": 42, "hw:esc": null }), ROS.nodes);
  assert.deepEqual(r.enlaces, {});
  assert.equal(r.avisos.length, 2);
});

test("enlacesHardware: sin nodos (proyecto sin ros.json) no lanza y avisa por cada clave", () => {
  const r = enlacesHardware(proyecto({ "hw:zed": "electronica/pcb" }), []);
  assert.deepEqual(r.enlaces, {});
  assert.equal(r.avisos.length, 1);
});

test("enlacesHardware: claves como __proto__ no contaminan el resultado", () => {
  const hwPaginas = JSON.parse('{"__proto__": "electronica/pcb", "hw:zed": "electronica/pcb"}');
  const { enlaces, avisos } = enlacesHardware(proyecto(hwPaginas), ROS.nodes);
  assert.deepEqual(Object.keys(enlaces), ["hw:zed"]);
  assert.equal(avisos.length, 1);
  assert.equal({}.disciplina, undefined);
});

// ---------- usadoPor ----------
test("usadoPor: por slug de la disciplina, cada hw:* con los nodos ROS conectados (enlazan al grafo)", () => {
  const { enlaces } = enlacesHardware(proyecto({ "hw:zed": "electronica/sensores-actuadores" }), ROS.nodes);
  const mapa = usadoPor("uuv", ROS, enlaces, "electronica");
  assert.deepEqual(Object.keys(mapa), ["sensores-actuadores"]);
  assert.deepEqual(mapa["sensores-actuadores"], [
    { id: "hw:zed", label: "ZED 2", nodos: [{ id: "nav/camera_opener", label: "camera_opener", href: "/uuv/grafo/?node=nav%2Fcamera_opener" }] },
  ]);
});

test("usadoPor: solo nodos ROS (no topics ni otro hardware), sin duplicados; plan solo si todas sus aristas son plan", () => {
  const { enlaces } = enlacesHardware(proyecto({ "hw:arduino": "electronica/pinout" }), ROS.nodes);
  const [uso] = usadoPor("uuv", ROS, enlaces, "electronica").pinout;
  assert.equal(uso.id, "hw:arduino");
  assert.deepEqual(uso.nodos, [
    { id: "ctl/futuro", label: "futuro", href: "/uuv/grafo/?node=ctl%2Ffuturo", plan: true },
    { id: "ctl/to_arduino", label: "to_arduino", href: "/uuv/grafo/?node=ctl%2Fto_arduino" },
  ]);
});

test("usadoPor: hardware sin nodos ROS sale con lista vacía; varias piezas en una página ordenadas por nombre", () => {
  const { enlaces } = enlacesHardware(proyecto({ "hw:esc": "electronica/potencia", "hw:arduino": "electronica/potencia" }), ROS.nodes);
  const lista = usadoPor("uuv", ROS, enlaces, "electronica").potencia;
  assert.deepEqual(lista.map((u) => u.id), ["hw:esc", "hw:arduino"]);
  assert.deepEqual(lista[0].nodos, []);
});

test("usadoPor: filtra por disciplina y no falla sin ros.json", () => {
  const { enlaces } = enlacesHardware(proyecto({ "hw:zed": "electronica/sensores-actuadores", "hw:esc": "mecanica/ensamble" }), ROS.nodes);
  assert.deepEqual(Object.keys(usadoPor("uuv", ROS, enlaces, "mecanica")), ["ensamble"]);
  assert.deepEqual(usadoPor("uuv", null, enlaces, "electronica"), {});
});

// ---------- usoDePagina (cliente) ----------
test("usoDePagina: lee el JSON del atributo y devuelve lo de la página actual", () => {
  const { enlaces } = enlacesHardware(proyecto({ "hw:zed": "electronica/sensores-actuadores" }), ROS.nodes);
  const texto = JSON.stringify(usadoPor("uuv", ROS, enlaces, "electronica"));
  assert.equal(usoDePagina(texto, "sensores-actuadores")[0].nodos[0].href, "/uuv/grafo/?node=nav%2Fcamera_opener");
  assert.deepEqual(usoDePagina(texto, "pcb"), []);
});

test("usoDePagina: entrada rota, ausente o maliciosa → lista vacía o filtrada (nunca lanza)", () => {
  for (const malo of [null, undefined, "", "{", "[]", "42", '{"x": 1}']) assert.deepEqual(usoDePagina(malo, "x"), [], String(malo));
  assert.deepEqual(usoDePagina('{"__proto__": [{"id":"hw:a","label":"A","nodos":[]}]}', "__proto__"), []);
  const raro = JSON.stringify({
    p: [
      { id: "hw:a", label: "A", nodos: [{ id: "n", label: "n", href: "javascript:alert(1)" }, { id: "m", label: "m", href: "//evil.com/x" }, { id: "k", label: "k", href: "/uuv/grafo/?node=k" }] },
      { id: 3, label: null, nodos: "x" },
    ],
  });
  const r = usoDePagina(raro, "p");
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].nodos.map((n) => n.id), ["k"]);
});

// ---------- rosGraph ----------
test("rosGraph: el nodo hw:* enlazado lleva hwPagina (href y etiqueta); el resto no", () => {
  const data = rosGraph(projectData({ disciplinas: DISC, hwPaginas: { "hw:zed": "electronica/sensores-actuadores" } }));
  const zed = data.nodes.find((n) => n.id === "hw:zed");
  assert.deepEqual(zed.hwPagina, { href: "/uuv/electronica/?p=sensores-actuadores", etiqueta: "Ver en Electrónica" });
  assert.ok(data.nodes.filter((n) => n.id !== "hw:zed").every((n) => !("hwPagina" in n)));
});

test("rosGraph: hwPaginas inválido avisa en el build ([grafo]) y no rompe", (t) => {
  const avisos = [];
  t.mock.method(console, "warn", (...a) => avisos.push(a.join(" ")));
  const data = rosGraph(projectData({ disciplinas: DISC, hwPaginas: { "hw:fantasma": "electronica/pcb", "hw:zed": "electronica/NO VALE" } }));
  assert.ok(data);
  assert.ok(data.nodes.every((n) => !("hwPagina" in n)));
  assert.ok(avisos.some((a) => a.includes("hw:fantasma")));
  assert.ok(avisos.some((a) => a.includes("hw:zed")));
});
