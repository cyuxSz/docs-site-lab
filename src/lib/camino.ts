// Camino entre dos nodos del grafo ROS: BFS dirigido (en el sentido de los mensajes) con alternativa no dirigida,
// texto de los pasos y parámetros de URL (desde=, hasta=).
import { leerCompararUrl } from "./comparar.ts";
import type { GraphEdge, GraphNode } from "./graph";

type N = Pick<GraphNode, "id" | "label" | "kind">;
type E = Pick<GraphEdge, "source" | "target">;

function bfs(origen: string, destino: string, vecinos: Map<string, string[]>, permitidos?: Set<string>): string[] | null {
  const previo = new Map<string, string | null>([[origen, null]]);
  const cola = [origen];
  for (let i = 0; i < cola.length && !previo.has(destino); i++) {
    for (const v of vecinos.get(cola[i]) ?? []) {
      if (previo.has(v) || (permitidos && !permitidos.has(v))) continue;
      previo.set(v, cola[i]);
      cola.push(v);
    }
  }
  if (!previo.has(destino)) return null;
  const pasos: string[] = [];
  for (let c: string | null = destino; c !== null; c = previo.get(c) ?? null) pasos.unshift(c);
  return pasos;
}

export function caminoMasCorto(nodes: N[], edges: E[], origen: string, destino: string, permitidos?: Set<string>): { dirigido: boolean; pasos: string[] } | null {
  const conocidos = new Set(nodes.map((n) => n.id));
  for (const id of [origen, destino]) if (!conocidos.has(id) || (permitidos && !permitidos.has(id))) return null;
  if (origen === destino) return { dirigido: true, pasos: [origen] };
  const salientes = new Map<string, string[]>();
  const ambos = new Map<string, string[]>();
  const add = (m: Map<string, string[]>, k: string, v: string) => {
    const l = m.get(k);
    if (l) l.push(v);
    else m.set(k, [v]);
  };
  for (const e of edges) {
    if (!conocidos.has(e.source) || !conocidos.has(e.target)) continue;
    add(salientes, e.source, e.target);
    add(ambos, e.source, e.target);
    add(ambos, e.target, e.source);
  }
  const d = bfs(origen, destino, salientes, permitidos);
  if (d) return { dirigido: true, pasos: d };
  const u = bfs(origen, destino, ambos, permitidos);
  return u ? { dirigido: false, pasos: u } : null;
}

// Claves "source>target" de las aristas del camino, en el sentido real de cada arista.
export function aristasCamino(pasos: string[], edges: E[]): string[] {
  const claves = new Set(edges.map((e) => `${e.source}>${e.target}`));
  const out: string[] = [];
  for (let i = 0; i + 1 < pasos.length; i++) {
    const [a, b] = [pasos[i], pasos[i + 1]];
    if (claves.has(`${a}>${b}`)) out.push(`${a}>${b}`);
    else if (claves.has(`${b}>${a}`)) out.push(`${b}>${a}`);
  }
  return out;
}

// "camera_opener —/pose→ asmc": el topic intermedio nombra el tramo; sin flecha si va contra el sentido.
export function textoCamino(pasos: string[], nodes: N[], edges: E[]): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const claves = new Set(edges.map((e) => `${e.source}>${e.target}`));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const canal = (id: string) => ["topic", "service", "action"].includes(byId.get(id)?.kind ?? "");
  const interior = (i: number) => i > 0 && i < pasos.length - 1 && canal(pasos[i]);
  let t = "";
  for (let i = 0; i < pasos.length; i++) {
    const id = pasos[i];
    if (interior(i)) {
      const adelante = claves.has(`${pasos[i - 1]}>${id}`) && claves.has(`${id}>${pasos[i + 1]}`);
      t += ` —${label(id)}${adelante ? "→" : "—"} `;
      continue;
    }
    if (i > 0 && !interior(i - 1)) t += claves.has(`${pasos[i - 1]}>${id}`) ? " → " : " — ";
    t += label(id);
  }
  return t;
}

const param = (search: string, k: string) => new URLSearchParams(search).get(k);

export function leerCaminoUrl(search: string, validos: Set<string>): { desde: string; hasta: string } | null {
  const desde = param(search, "desde");
  const hasta = param(search, "hasta");
  return desde && hasta && validos.has(desde) && validos.has(hasta) ? { desde, hasta } : null;
}

export function escribirCaminoUrl(q: URLSearchParams, c: { desde: string; hasta: string } | null): void {
  if (c) {
    q.set("desde", c.desde);
    q.set("hasta", c.hasta);
  } else {
    q.delete("desde");
    q.delete("hasta");
  }
}

export type ModoInicial = { tipo: "comparar"; a: string; b: string } | { tipo: "camino"; desde: string; hasta: string } | null;

// Si el enlace trae los dos modos, gana comparar.
export function modoInicialUrl(search: string, configIds: string[], validos: Set<string>): ModoInicial {
  const par = leerCompararUrl(search, configIds);
  if (par) return { tipo: "comparar", a: par[0], b: par[1] };
  const c = leerCaminoUrl(search, validos);
  return c ? { tipo: "camino", ...c } : null;
}
