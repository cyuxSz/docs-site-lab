// Datos de los grafos que descarga el componente RoboticsGraph. El layout (ForceAtlas2) se calcula aquí,
// en el build, para que el navegador no cargue ni ejecute el algoritmo y el dibujo salga siempre igual.
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { ProjectData } from "./data";
import { separarPlan, acomodarPlan } from "./plan.ts";
import { enlaceInterno, recorridoConfig } from "./legado.ts";
import { panoramaCajas, type PanoramaCaja } from "./panorama.ts";
import { recorridoSeccion, seccion, seccionesDe } from "./secciones.ts";

export interface GraphCategory {
  id: string;
  label: string;
  color: string;
  hint?: string; // qué hace, en una línea, para quien no conoce el proyecto
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
  package?: string; // paquete ROS (solo nodos ROS)
  // Aparece en la arquitectura objetivo (ros.json); soloPlan: no existe hoy (todas sus aristas son plan).
  plan?: true;
  soloPlan?: true;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string | null;
  kind: string;
  file?: string;
  line?: number | null;
}

export interface GraphConfig {
  id: string;
  label: string;
  legado?: true;
  enlace?: string;
  tour?: { node: string; text: string }[];
}

export interface GraphData {
  view: "ros" | "paginas";
  title: string;
  repoUrl: string;
  sha: string;
  configs: GraphConfig[];
  groups: GraphCategory[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  // Diseño A ("por capas"): flechas nodo → nodo con el topic o servicio como etiqueta, sin los topics como nodos.
  flowEdges?: GraphEdge[];
  // Capa plan (arquitectura objetivo): aristas crudas y flechas dueño → dueño con kind "plan".
  planEdges?: GraphEdge[];
  planFlowEdges?: GraphEdge[];
  // Recorrido guiado del diseño A (projects.json → tour).
  tour?: { node: string; text: string }[];
  // Una sub-vista por capa ROS (con layout propio en pos["seccion:<id>"]) y su recorrido.
  sections?: GraphSection[];
  // Panorama (nivel 0): cajas que abren una sección (projects.json → panorama), ya filtradas a secciones existentes.
  panorama?: PanoramaCaja[];
}

export interface GraphSection {
  id: string;
  label: string;
  color: string;
  hint?: string;
  core: string[];
  channels: string[];
  context: string[];
  tour: { node: string; text: string }[];
  // Misma sección contando legado y sin uso (cuando "mostrar legado" está activo).
  old: { core: string[]; channels: string[]; context: string[] };
}

// Paleta de la propuesta (azul ROS, verde visión, violeta IA, naranja hardware), ampliada a las capas del repo.
export const LAYERS: GraphCategory[] = [
  { id: "control", label: "Control", color: "#007ACC", hint: "calcula las fuerzas para mover el sub" },
  { id: "mision", label: "Misión", color: "#0B9AA8", hint: "decide a dónde ir y qué hacer" },
  { id: "navegacion", label: "Navegación", color: "#10B981", hint: "sabe dónde está el sub" },
  { id: "vision", label: "Visión / IA", color: "#8B5CF6", hint: "reconoce objetos en la cámara" },
  { id: "visualizacion", label: "Visualización", color: "#64748B", hint: "muestra datos para depurar" },
  { id: "simulacion", label: "Simulación", color: "#B7791F", hint: "Gazebo, el sub virtual" },
  { id: "externo", label: "Paquetes externos", color: "#94A3B8", hint: "herramientas de ROS, no del equipo" },
  { id: "hardware", label: "Hardware", color: "#F97316", hint: "cámara, Arduino y motores" },
  { id: "topic", label: "Topics", color: "#9AA5B1", hint: "canales de mensajes entre nodos" },
  { id: "service", label: "Servicios y acciones", color: "#D4A017", hint: "pregunta y respuesta entre nodos" },
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

// Diseño A: los topics y servicios dejan de ser nodos. Cada productor → topic → consumidor se vuelve una flecha
// productor → consumidor con el nombre del topic; si dos nodos comparten varios topics, van en la misma etiqueta.
function flowEdges(nodes: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const owner = (id: string) => ["node", "hardware"].includes(byId.get(id)?.kind ?? "");
  const pairs = new Map<string, GraphEdge>();
  const add = (source: string, target: string, label: string | null | undefined, from: GraphEdge) => {
    if (source === target) return;
    const key = `${source}→${target}`;
    const prev = pairs.get(key);
    if (prev) {
      if (label && !prev.label?.split(", ").includes(label)) prev.label = prev.label ? `${prev.label}, ${label}` : label;
    } else pairs.set(key, { source, target, label: label ?? null, kind: "flow", file: from.file, line: from.line });
  };
  for (const e of edges) if (owner(e.source) && owner(e.target)) add(e.source, e.target, e.label, e);
  for (const mid of nodes.filter((n) => !owner(n.id))) {
    const ins = edges.filter((e) => e.target === mid.id && owner(e.source));
    const outs = edges.filter((e) => e.source === mid.id && owner(e.target));
    for (const a of ins) for (const b of outs) add(a.source, b.target, mid.label, a);
  }
  return [...pairs.values()];
}

// Diseño A: columnas de izquierda a derecha según el camino del dato (camino más largo desde las fuentes, ignorando
// ciclos) y orden dentro de cada columna con dos pasadas de baricentro para cruzar menos flechas.
function layered(nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = new Set(nodes.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const out = new Map<string, string[]>();
  const inc = new Map<string, string[]>();
  for (const e of es) {
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    inc.set(e.target, [...(inc.get(e.target) ?? []), e.source]);
  }
  // Quita las flechas que cierran ciclos (DFS) para poder ordenar.
  const state = new Map<string, number>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of out.get(id) ?? []) {
      if (state.get(t) === 1) back.add(`${id}→${t}`);
      else if (!state.get(t)) visit(t);
    }
    state.set(id, 2);
  };
  const sorted = [...nodes].sort((a, b) => (inc.get(a.id)?.length ?? 0) - (inc.get(b.id)?.length ?? 0) || a.id.localeCompare(b.id));
  for (const n of sorted) if (!state.get(n.id)) visit(n.id);
  const rank = new Map<string, number>();
  // Sin las flechas de regreso queda un grafo acíclico; el 0 provisional solo protege de un ciclo que se escape.
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    rank.set(id, 0);
    const preds = (inc.get(id) ?? []).filter((s) => !back.has(`${s}→${id}`));
    const r = preds.length ? Math.max(...preds.map((s) => rankOf(s) + 1)) : 0;
    rank.set(id, r);
    return r;
  };
  for (const n of nodes) rankOf(n.id);
  // Nodos sueltos (sin flechas) a la última columna, para que no estorben al flujo.
  const maxRank = Math.max(0, ...rank.values());
  for (const n of nodes) if (!out.get(n.id)?.length && !inc.get(n.id)?.length) rank.set(n.id, maxRank + 1);
  const columns: string[][] = [];
  for (const n of nodes) (columns[rank.get(n.id)!] ??= []).push(n.id);
  const order = new Map<string, number>();
  columns.forEach((col) => col.sort().forEach((id, i) => order.set(id, i)));
  const bary = (id: string, neighbors: string[] | undefined) => {
    const ys = (neighbors ?? []).map((x) => order.get(x)!).filter((v) => v !== undefined);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : order.get(id)!;
  };
  for (let pass = 0; pass < 4; pass++) {
    const list = pass % 2 ? [...columns].reverse() : columns;
    for (const col of list) {
      if (!col) continue;
      col.sort((a, b) => bary(a, pass % 2 ? out.get(a) : inc.get(a)) - bary(b, pass % 2 ? out.get(b) : inc.get(b)));
      col.forEach((id, i) => order.set(id, i));
    }
  }
  // Coordenadas: columnas separadas 10, filas 3; cada columna centrada en vertical. Sigma usa y hacia arriba.
  const pos = new Map<string, [number, number]>();
  columns.forEach((col, c) => col?.forEach((id, i) => pos.set(id, [c * 10, round(-(i - (col.length - 1) / 2) * 3)])));
  return pos;
}

// Un layout por filtro: al elegir una configuración, sus ~20 nodos se reparten en todo el lienzo.
// Con flow, además guarda "capas:<filtro>" para el diseño A.
function layoutAll(nodes: GraphNode[], edges: GraphEdge[], groups: GraphCategory[], configs: string[], flow?: GraphEdge[], plan?: { flow: GraphEdge[]; nodes: GraphNode[]; sinPlan: Set<string> }) {
  const old = new Set(["legado", "sin_uso"]);
  const filters: Record<string, (n: GraphNode) => boolean> = {
    all: (n) => !(n.kind === "node" && old.has(n.status ?? "")),
    old: () => true,
  };
  for (const c of configs) filters[c] = (n) => n.configs.includes(c);
  const owners = new Set(["node", "hardware"]);
  for (const [key, pass] of Object.entries(filters)) {
    const s = subset(nodes, edges, pass);
    for (const [id, xy] of layout(s.nodes, s.edges, groups)) {
      const n = nodes.find((x) => x.id === id)!;
      n.pos = { ...n.pos, [key]: xy };
    }
    if (!flow) continue;
    const kept = s.nodes.filter((n) => owners.has(n.kind));
    for (const [id, xy] of layered(kept, flow)) {
      const n = nodes.find((x) => x.id === id)!;
      n.pos = { ...n.pos, [`capas:${key}`]: xy };
    }
    // Con la capa plan: los dueños del filtro más los extremos de las flechas plan, ordenados con ambas flechas.
    if (plan && plan.flow.length && !plan.sinPlan.has(key)) {
      const ids = new Set(kept.map((n) => n.id));
      for (const e of plan.flow) ids.add(e.source).add(e.target);
      const todos = [...nodes, ...plan.nodes].filter((n) => ids.has(n.id) && owners.has(n.kind));
      const soloPlan = new Set(plan.nodes.map((n) => n.id));
      const lbl = new Map(todos.map((n) => [n.id, n.label]));
      const colocados = acomodarPlan(layered(todos, [...(flow ?? []), ...plan.flow]), soloPlan, (id) => lbl.get(id) ?? id);
      for (const [id, xy] of colocados) {
        const n = todos.find((x) => x.id === id)!;
        n.pos = { ...n.pos, [`capas:plan:${key}`]: xy };
      }
    }
  }
  for (const n of nodes) [n.x, n.y] = n.pos?.old ?? n.pos?.all ?? [0, 0];
}

// Layout propio de cada sección: ForceAtlas2 de núcleo + canales + contexto ("seccion:<id>") y columnas por capas con
// solo los dueños ("capas:seccion:<id>"). La variante ":old" cuenta el legado. Lo que no toca la sección no recibe clave.
function layoutSecciones(nodes: GraphNode[], edges: GraphEdge[], groups: GraphCategory[], flow: GraphEdge[], id: string, ids: string[], old: boolean) {
  const sufijo = old ? ":old" : "";
  const set = new Set(ids);
  const dentro = nodes.filter((n) => set.has(n.id));
  const owners = new Set(["node", "hardware"]);
  const asigna = (clave: string, pos: Map<string, [number, number]>) => {
    for (const [nid, xy] of pos) {
      const n = nodes.find((x) => x.id === nid)!;
      n.pos = { ...n.pos, [clave]: xy };
    }
  };
  asigna(`seccion:${id}${sufijo}`, layout(dentro, edges.filter((e) => set.has(e.source) && set.has(e.target)), groups));
  asigna(`capas:seccion:${id}${sufijo}`, layered(dentro.filter((n) => owners.has(n.kind)), flow));
}

export function rosGraph(p: ProjectData): GraphData | null {
  if (!p.ros) return null;
  const docs = new Map(p.pageList.filter((x) => x.path.startsWith("packages/")).map((x) => [x.path.replace(/^packages\/|\.md$/g, ""), x.route]));
  const kindOf = { ros2_node: "node", ros2_topic: "topic", ros2_service: "service", ros2_action: "action", hardware: "hardware" } as const;
  const degree = new Map<string, number>();
  // La capa plan se aparta antes de calcular nada: lo que corre hoy no cambia con ella.
  const sep = separarPlan(p.ros.nodes, p.ros.edges);
  for (const e of sep.edges) for (const id of [e.source, e.target]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const toNode = (n: (typeof p.ros.nodes)[number]): GraphNode => {
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
      ...(n.package ? { package: n.package } : {}),
      ...(n.plan ? { plan: true as const } : {}),
      ...(sep.soloPlan.has(n.id) ? { soloPlan: true as const } : {}),
    };
  };
  const nodes: GraphNode[] = p.ros.nodes.filter((n) => !sep.soloPlan.has(n.id)).map(toNode);
  const soloPlanNodes: GraphNode[] = p.ros.nodes.filter((n) => sep.soloPlan.has(n.id)).map(toNode);
  const toEdge = (e: (typeof p.ros.edges)[number]): GraphEdge => ({ source: e.source, target: e.target, label: e.label, kind: e.kind, file: e.file, line: e.line });
  const edges: GraphEdge[] = sep.edges.map(toEdge);
  const planEdges: GraphEdge[] = sep.planEdges.map(toEdge);
  const used = new Set(nodes.map((n) => n.group));
  const groups = LAYERS.filter((g) => used.has(g.id));
  const flow = flowEdges(nodes, edges);
  // Flechas plan dueño → dueño (con los nodos solo-plan como posibles extremos), sin tocar las de hoy.
  const planFlow = planEdges.length ? flowEdges([...nodes, ...soloPlanNodes], planEdges).map((e) => ({ ...e, kind: "plan" })) : [];
  const sinPlan = new Set(p.ros.configs.filter((c) => c.legado).map((c) => c.id));
  layoutAll(nodes, edges, groups, p.ros.configs.map((c) => c.id), flow, { flow: planFlow, nodes: soloPlanNodes, sinPlan });
  const sections: GraphSection[] = seccionesDe(nodes, edges, LAYERS.map((l) => l.id)).map((id) => {
    const layer = LAYERS.find((l) => l.id === id)!;
    const s = seccion(nodes, edges, id);
    const old = seccion(nodes, edges, id, { showOld: true });
    layoutSecciones(nodes, edges, groups, flow, id, [...s.core, ...s.channels, ...s.context], false);
    layoutSecciones(nodes, edges, groups, flow, id, [...old.core, ...old.channels, ...old.context], true);
    return {
      id,
      label: layer.label,
      color: layer.color,
      hint: layer.hint,
      core: s.core,
      channels: s.channels,
      context: s.context,
      tour: recorridoSeccion(s, nodes, edges, layer, p.secciones?.[id]?.tour),
      old: { core: old.core, channels: old.channels, context: old.context },
    };
  });
  const panorama = panoramaCajas(p.panorama, sections.map((s) => s.id));
  return {
    view: "ros",
    title: "Nodos ROS",
    repoUrl: p.repoUrl ?? "",
    sha: p.sha ?? "",
    configs: p.ros.configs.map((c) => {
      const extra = p.configs?.[c.id];
      const enlace = enlaceInterno(extra?.enlace);
      const { pasos, descartados } = recorridoConfig(c.id, nodes, extra?.tour);
      for (const d of descartados) console.warn(`[grafo] ${p.id}: el paso del recorrido de la configuración "${c.id}" sobre "${d}" se descarta (no existe o no está en esa configuración).`);
      return { id: c.id, label: c.label, ...(c.legado ? { legado: true as const } : {}), ...(enlace ? { enlace } : {}), ...(pasos.length ? { tour: pasos } : {}) };
    }),
    groups,
    nodes: [...nodes, ...soloPlanNodes],
    edges,
    flowEdges: flow,
    ...(planFlow.length ? { planEdges, planFlowEdges: planFlow } : {}),
    tour: (p.tour ?? []).filter((s) => nodes.some((n) => n.id === s.node)),
    sections,
    ...(panorama.length ? { panorama } : {}),
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
