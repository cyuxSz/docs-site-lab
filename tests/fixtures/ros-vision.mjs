// Cadena real de Visión del UUV (openwiki/.graph/ros.json, config sim-competencia), recortada: cámara → picture →
// /take_picture → *_analizer → /<Tarea>Service → mission_handler_3 / instruction_handler → /pose_objetivo → asmc.
// Los ids son los mismos que en el ros.json de la wiki. No depende de ../uuv-wiki.
const node = (id, layer, status = "en_uso") => ({ id, label: id.split("/").pop(), category: "ros2_node", package: id.split("/")[0], layer, status, configs: [] });
const topic = (name) => ({ id: `topic:${name}`, label: name, category: "ros2_topic", configs: [] });
const service = (name) => ({ id: `service:${name}`, label: name, category: "ros2_service", configs: [] });
const edge = (source, target, kind) => ({ source, target, kind, label: null, file: "src/x.py", line: 1 });

export const rosNodes = [
  node("uuv_vision/picture", "vision"),
  node("uuv_vision/gate_analizer", "vision"),
  node("uuv_vision/navigation_analizer", "vision"),
  node("uuv_vision/search_analizer", "vision"),
  node("uuv_vision/octagon_analizer", "vision"),
  node("uuv_vision/pivot_align_analizer", "vision"),
  node("uuv_vision/nodo_vision", "vision", "legado"),
  node("uuv_mission/mission_handler_3", "mision"),
  node("uuv_mission/instruction_handler", "mision"),
  node("uuv_navigation/camera_opener", "navegacion"),
  node("uuv_control/asmc", "control"),
  node("uuv_control/thrust_allocator", "control"),
  topic("/camera/right"),
  topic("/camera/low_res"),
  topic("/pose"),
  topic("/pose_objetivo"),
  topic("/forces"),
  service("/take_picture"),
  service("/GateService"),
  service("/NavigationService"),
  service("/SearchService"),
  service("/OctagonService"),
  service("/PivotAlignService"),
];

const analizers = [
  ["gate_analizer", "/GateService"],
  ["navigation_analizer", "/NavigationService"],
  ["search_analizer", "/SearchService"],
  ["octagon_analizer", "/OctagonService"],
  ["pivot_align_analizer", "/PivotAlignService"],
];

export const rosEdges = [
  edge("uuv_vision/nodo_vision", "topic:/camera/right", "pub"),
  edge("topic:/camera/right", "uuv_vision/picture", "sub"),
  edge("uuv_vision/picture", "topic:/camera/low_res", "pub"),
  edge("uuv_vision/picture", "service:/take_picture", "srv"),
  edge("uuv_navigation/camera_opener", "service:/take_picture", "srv"),
  ...analizers.flatMap(([n, srv]) => [
    edge("service:/take_picture", `uuv_vision/${n}`, "cli"),
    edge(`uuv_vision/${n}`, `service:${srv}`, "srv"),
    edge(`service:${srv}`, "uuv_mission/mission_handler_3", "cli"),
  ]),
  edge("service:/GateService", "uuv_mission/instruction_handler", "cli"),
  edge("topic:/pose", "uuv_mission/mission_handler_3", "sub"),
  edge("uuv_mission/mission_handler_3", "topic:/pose_objetivo", "pub"),
  edge("uuv_mission/instruction_handler", "topic:/pose_objetivo", "pub"),
  edge("topic:/pose_objetivo", "uuv_control/asmc", "sub"),
  edge("uuv_control/asmc", "topic:/forces", "pub"),
  edge("topic:/forces", "uuv_control/thrust_allocator", "sub"),
];

const kindOf = { ros2_node: "node", ros2_topic: "topic", ros2_service: "service", ros2_action: "action", hardware: "hardware" };
export const graphNodes = rosNodes.map((n) => {
  const kind = kindOf[n.category];
  const group = kind === "node" ? n.layer ?? "externo" : kind === "action" ? "service" : kind;
  return { id: n.id, label: n.label, group, kind, status: n.status, configs: n.configs, x: 0, y: 0, size: 5 };
});
export const graphEdges = rosEdges.map((e) => ({ ...e }));

export const VISION = { id: "vision", label: "Visión / IA", color: "#8B5CF6", hint: "reconoce objetos en la cámara" };
