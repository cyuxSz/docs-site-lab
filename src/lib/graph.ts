// Datos de los grafos que descarga el componente RoboticsGraph. El layout (ForceAtlas2) se calcula aquí,
// en el build, para que el navegador no cargue ni ejecute el algoritmo y el dibujo salga siempre igual.
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { ProjectData } from "./data";

export interface GraphCategory {
  id: string;
  label: string;
  color: string;
}

export interface GraphNode {
  id: string;
  label: string;
  group: string; // capa (ROS) o tipo de página (wiki): define color y filtro
  kind: "node" | "topic" | "service" | "action" | "hardware" | "page";
  status?: string;
  configs: string[];
  x: number;
  y: number;
  // Posición en cada filtro ("all" sin legado, "old" con legado, o el id de una configuración).
  pos?: Record<string, [number, number]>;
  size: number;
  file?: string;
  line?: number | null;
  rosName?: string;
  types?: string[];
  doc?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string | null;
  kind: string;
  file?: string;
  line?: number | null;
}

export interface GraphData {
  view: "ros" | "paginas";
  title: string;
  repoUrl: string;
  sha: string;
  configs: { id: string; label: string }[];
  groups: GraphCategory[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Paleta de la propuesta (azul ROS, verde visión, violeta IA, naranja hardware), ampliada a las capas del repo.
export const LAYERS: GraphCategory[] = [
  { id: "control", label: "Control", color: "#007ACC" },
  { id: "mision", label: "Misión", color: "#0B9AA8" },
  { id: "navegacion", label: "Navegación", color: "#10B981" },
  { id: "vision", label: "Visión / IA", color: "#8B5CF6" },
  { id: "visualizacion", label: "Visualización", color: "#64748B" },
  { id: "simulacion", label: "Simulación", color: "#B7791F" },
  { id: "externo", label: "Paquetes externos", color: "#94A3B8" },
  { id: "hardware", label: "Hardware", color: "#F97316" },
  { id: "topic", label: "Topics", color: "#9AA5B1" },
  { id: "service", label: "Servicios y acciones", color: "#D4A017" },
];

const PAGE_TYPES: GraphCategory[] = [
  { id: "guide", label: "Guías", color: "#10B981" },
  { id: "architecture", label: "Arquitectura", color: "#007ACC" },
  { id: "component", label: "Paquetes", color: "#8B5CF6" },
  { id: "reference", label: "Referencia", color: "#F97316" },
  { id: "index", label: "Índices", color: "#64748B" },
];

const round = (v: number) => Math.round(v * 100) / 100;

function layout(nodes: GraphNode[], edges: GraphEdge[], groups: GraphCategory[]) {
  const g = new Graph({ multi: true, type: "directed" });
  const order = groups.map((x) => x.id);
  // Posición inicial determinista: cada grupo en su sector del círculo, así el resultado no cambia entre builds.
  nodes.forEach((n, i) => {
    const sector = (order.indexOf(n.group) + 1) / (order.length + 1);
    const angle = 2 * Math.PI * sector + (i % 7) * 0.05;
    const r = 10 + (i % 5) * 3;
    g.addNode(n.id, { x: Math.cos(angle) * r, y: Math.sin(angle) * r, size: n.size });
  });
  for (const e of edges) if (g.hasNode(e.source) && g.hasNode(e.target)) g.addEdge(e.source, e.target);
  forceAtlas2.assign(g, {
    iterations: 600,
    settings: { ...forceAtlas2.inferSettings(g), linLogMode: true, adjustSizes: true, gravity: 1.5, scalingRatio: 6 },
  });
  return new Map(nodes.map((n) => [n.id, [round(g.getNodeAttribute(n.id, "x")), round(g.getNodeAttribute(n.id, "y"))] as [number, number]]));
}

// Mismo criterio que el filtro del componente: nodos que pasan, más los topics/servicios que alguno de ellos usa.
function subset(nodes: GraphNode[], edges: GraphEdge[], pass: (n: GraphNode) => boolean) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const owners = new Set(["node", "hardware", "page"]);
  const ids = new Set(nodes.filter((n) => owners.has(n.kind) && pass(n)).map((n) => n.id));
  for (const e of edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      const other = byId.get(b);
      if (ids.has(a) && other && !owners.has(other.kind) && pass(other)) ids.add(b);
    }
  }
  return { nodes: nodes.filter((n) => ids.has(n.id)), edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
}

// Un layout por filtro: al elegir una configuración, sus ~20 nodos se reparten en todo el lienzo.
function layoutAll(nodes: GraphNode[], edges: GraphEdge[], groups: GraphCategory[], configs: string[]) {
  const old = new Set(["legado", "sin_uso"]);
  const filters: Record<string, (n: GraphNode) => boolean> = {
    all: (n) => !(n.kind === "node" && old.has(n.status ?? "")),
    old: () => true,
  };
  for (const c of configs) filters[c] = (n) => n.configs.includes(c);
  for (const [key, pass] of Object.entries(filters)) {
    const s = subset(nodes, edges, pass);
    for (const [id, xy] of layout(s.nodes, s.edges, groups)) {
      const n = nodes.find((x) => x.id === id)!;
      n.pos = { ...n.pos, [key]: xy };
    }
  }
  for (const n of nodes) [n.x, n.y] = n.pos?.old ?? n.pos?.all ?? [0, 0];
}

export function rosGraph(p: ProjectData): GraphData | null {
  if (!p.ros) return null;
  const docs = new Map(p.pageList.filter((x) => x.path.startsWith("packages/")).map((x) => [x.path.replace(/^packages\/|\.md$/g, ""), x.route]));
  const kindOf = { ros2_node: "node", ros2_topic: "topic", ros2_service: "service", ros2_action: "action", hardware: "hardware" } as const;
  const degree = new Map<string, number>();
  for (const e of p.ros.edges) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nodes: GraphNode[] = p.ros.nodes.map((n) => {
    const kind = kindOf[n.category];
    const group = kind === "node" ? n.layer ?? "externo" : kind === "action" ? "service" : kind;
    const base = kind === "node" ? 7 : kind === "hardware" ? 8 : 3;
    return {
      id: n.id,
      label: n.label,
      group,
      kind,
      status: n.status,
      configs: n.configs ?? [],
      x: 0,
      y: 0,
      size: Math.round((base + Math.min(6, Math.sqrt(degree.get(n.id) ?? 0))) * 10) / 10,
      file: n.file,
      line: n.line,
      rosName: n.ros_name,
      types: n.types,
      doc: n.package ? docs.get(n.package) : undefined,
    };
  });
  const edges: GraphEdge[] = p.ros.edges.map((e) => ({ source: e.source, target: e.target, label: e.label, kind: e.kind, file: e.file, line: e.line }));
  const used = new Set(nodes.map((n) => n.group));
  const groups = LAYERS.filter((g) => used.has(g.id));
  layoutAll(nodes, edges, groups, p.ros.configs.map((c) => c.id));
  return {
    view: "ros",
    title: "Nodos ROS",
    repoUrl: p.repoUrl ?? "",
    sha: p.sha ?? "",
    configs: p.ros.configs.map((c) => ({ id: c.id, label: c.label })),
    groups,
    nodes,
    edges,
  };
}

export function pagesGraph(p: ProjectData): GraphData {
  const pages = p.pageList.filter((x) => x.type !== "meta");
  const ids = new Set(pages.map((x) => x.path));
  const degree = new Map<string, number>();
  const edges: GraphEdge[] = p.links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => {
      for (const id of [l.source, l.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
      return { source: l.source, target: l.target, kind: "link" };
    });
  const nodes: GraphNode[] = pages.map((x) => ({
    id: x.path,
    label: x.title,
    group: PAGE_TYPES.some((t) => t.id === x.type) ? x.type : "index",
    kind: "page",
    configs: [],
    x: 0,
    y: 0,
    size: Math.round((5 + Math.min(8, Math.sqrt(degree.get(x.path) ?? 0) * 1.5)) * 10) / 10,
    doc: x.route,
  }));
  const used = new Set(nodes.map((n) => n.group));
  const groups = PAGE_TYPES.filter((g) => used.has(g.id));
  for (const [id, [x, y]] of layout(nodes, edges, groups)) Object.assign(nodes.find((n) => n.id === id)!, { x, y });
  return { view: "paginas", title: "Páginas de la wiki", repoUrl: p.repoUrl ?? "", sha: p.sha ?? "", configs: [], groups, nodes, edges };
}
