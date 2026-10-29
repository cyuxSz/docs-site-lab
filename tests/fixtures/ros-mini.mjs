// Grafo ROS de juguete con la misma forma que openwiki/.graph/ros.json: una cadena cámara → navegación → misión →
// control → puente externo, más nodos legado/sin uso para probar el filtro por defecto. No depende de ../uuv-lab.
const node = (id, layer, status) => ({ id, label: id.split("/").pop(), category: "ros2_node", package: id.split("/")[0], layer, status, configs: [] });
const topic = (name) => ({ id: `topic:${name}`, label: name, category: "ros2_topic", configs: [] });
const edge = (source, target, kind, label = null) => ({ source, target, kind, label, file: "src/x.py", line: 1 });

export const rosNodes = [
  { id: "hw:zed", label: "ZED 2", category: "hardware", layer: "hardware", configs: [] },
  node("nav/camera_opener", "navegacion", "en_uso"),
  node("mis/instruction_handler", "mision", "en_uso"),
  node("ctl/asmc", "control", "en_uso"),
  node("ctl/thrust_allocator", "control", "en_uso"),
  node("ctl/viejo", "control", "legado"),
  node("ctl/sinuso", "control", "sin_uso"),
  node("viz/plotter", "visualizacion", "en_uso"),
  node("ext/bridge", "externo", "externo"),
  topic("/pose"),
  topic("/pose_objetivo"),
  topic("/forces"),
  topic("/matriz"),
  topic("/debug"),
  { id: "service:/take_picture", label: "/take_picture", category: "ros2_service", configs: [] },
];

export const rosEdges = [
  edge("hw:zed", "nav/camera_opener", "hw", "USB"),
  edge("nav/camera_opener", "topic:/pose", "pub", "/pose"),
  edge("topic:/pose", "ctl/asmc", "sub", "/pose"),
  edge("topic:/pose", "mis/instruction_handler", "sub", "/pose"),
  edge("mis/instruction_handler", "topic:/pose_objetivo", "pub", "/pose_objetivo"),
  edge("topic:/pose_objetivo", "ctl/asmc", "sub", "/pose_objetivo"),
  edge("ctl/asmc", "topic:/forces", "pub", "/forces"),
  edge("topic:/forces", "ctl/thrust_allocator", "sub", "/forces"),
  edge("topic:/forces", "ctl/viejo", "sub", "/forces"),
  edge("topic:/forces", "viz/plotter", "sub", "/forces"),
  edge("ctl/thrust_allocator", "topic:/matriz", "pub", "/matriz"),
  edge("topic:/matriz", "ext/bridge", "sub", "/matriz"),
  edge("ctl/sinuso", "topic:/debug", "pub", "/debug"),
  edge("nav/camera_opener", "service:/take_picture", "srv", "TakePicture"),
  edge("service:/take_picture", "mis/instruction_handler", "cli", "TakePicture"),
];

// Misma conversión que rosGraph() en src/lib/graph.ts (sin layout): lo que reciben las funciones de secciones.
const kindOf = { ros2_node: "node", ros2_topic: "topic", ros2_service: "service", ros2_action: "action", hardware: "hardware" };
export const graphNodes = rosNodes.map((n) => {
  const kind = kindOf[n.category];
  const group = kind === "node" ? n.layer ?? "externo" : kind === "action" ? "service" : kind;
  return { id: n.id, label: n.label, group, kind, status: n.status, configs: n.configs, x: 0, y: 0, size: 5 };
});
export const graphEdges = rosEdges.map((e) => ({ ...e }));

export const CONTROL = { id: "control", label: "Control", color: "#007ACC", hint: "calcula las fuerzas para mover el sub" };
export const NAVEGACION = { id: "navegacion", label: "Navegación", color: "#10B981", hint: "sabe dónde está el sub" };

// ProjectData mínimo para rosGraph().
export function projectData(extra = {}) {
  return {
    id: "uuv",
    name: "UUV",
    summary: "",
    repo: "o/r",
    branch: "main",
    repoUrl: "https://github.com/o/r",
    sha: "abc123",
    lastUpdate: null,
    pageList: [],
    diagramList: [],
    links: [],
    tour: [],
    ros: { configs: [], launches: [], nodes: rosNodes, edges: rosEdges },
    ...extra,
  };
}
