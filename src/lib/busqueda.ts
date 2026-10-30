// Búsqueda de nodos y topics en la barra del grafo: candidatos, filtrado y destino al elegir un resultado.
import type { GraphEdge, GraphNode } from "./graph";

export interface ItemBusqueda {
  id: string;
  label: string;
  kind: GraphNode["kind"];
  tipo: string;
  paquete: string;
}

const TIPOS: Record<GraphNode["kind"], string> = {
  node: "nodo",
  topic: "topic",
  service: "servicio",
  action: "acción",
  hardware: "hardware",
  page: "página",
};

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Lo visible, más los topics/servicios/acciones que tocan algún elemento visible.
export function candidatosBusqueda(nodes: GraphNode[], edges: GraphEdge[], visibles: Set<string>): ItemBusqueda[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const toca = new Set<string>();
  for (const e of edges) {
    if (visibles.has(e.source)) toca.add(e.target);
    if (visibles.has(e.target)) toca.add(e.source);
  }
  const out: ItemBusqueda[] = [];
  const vistos = new Set<string>();
  for (const n of nodes) {
    if (vistos.has(n.id)) continue;
    const propio = n.kind === "node" || n.kind === "hardware" || n.kind === "page";
    if (!(visibles.has(n.id) || (!propio && toca.has(n.id)))) continue;
    vistos.add(n.id);
    let paquete = n.kind === "node" ? n.package ?? "" : "";
    if (!paquete && (n.kind === "topic" || n.kind === "service" || n.kind === "action")) {
      const pub = edges.find((e) => e.target === n.id && byId.get(e.source)?.package);
      paquete = (pub && byId.get(pub.source)?.package) || "";
    }
    out.push({ id: n.id, label: n.label, kind: n.kind, tipo: TIPOS[n.kind] ?? n.kind, paquete });
  }
  return out;
}

export function filtrarBusqueda(items: ItemBusqueda[], query: string, max = 12): ItemBusqueda[] {
  const q = normalizar(query.trim());
  if (!q) return [];
  type Par = { i: ItemBusqueda; l: string };
  const coinciden: Par[] = items.map((i) => ({ i, l: normalizar(i.label) })).filter(({ l }) => l.includes(q));
  const orden = (a: Par, b: Par) => a.l.localeCompare(b.l);
  // Los topics empiezan por "/": el prefijo se mira también sin la barra.
  const prefijo = coinciden.filter(({ l }) => l.startsWith(q) || l.replace(/^\//, "").startsWith(q)).sort(orden);
  const resto = coinciden.filter((c) => !prefijo.includes(c)).sort(orden);
  return [...prefijo, ...resto].slice(0, max).map(({ i }) => i);
}

// A qué elemento ir al elegir un resultado: el propio si está visible; si no (topic en la vista por capas), su
// primer publicador visible o, si no hay, un suscriptor visible.
export function destinoBusqueda(id: string, edges: GraphEdge[], visibles: Set<string>): string | null {
  if (visibles.has(id)) return id;
  const pub = edges.find((e) => e.target === id && visibles.has(e.source));
  if (pub) return pub.source;
  const sub = edges.find((e) => e.source === id && visibles.has(e.target));
  return sub ? sub.target : null;
}
