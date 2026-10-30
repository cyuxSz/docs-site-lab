// Comparar dos configuraciones del grafo ROS: miembros de cada una, unión clasificada, resumen, estilo y URL (comparar=a,b).
import { FILTROS_INICIALES, ocultoPorEstado, type FiltrosEstado } from "./estados.ts";
import type { GraphEdge, GraphNode } from "./graph";

export type Lado = "a" | "b" | "ambas";
export interface ItemDif {
  id: string;
  label: string;
  kind: GraphNode["kind"];
}
export interface Resumen {
  soloA: number;
  soloB: number;
  comun: number;
}

type N = Pick<GraphNode, "id" | "kind" | "configs"> & { status?: string; soloPlan?: true; label?: string };
type E = Pick<GraphEdge, "source" | "target">;

const esDueno = (k: string) => k === "node" || k === "hardware";

// Dueños de la configuración (o los que pasan los filtros con "all", nunca los solo-plan) y los topics/servicios/
// acciones que tocan algún dueño incluido.
export function miembrosConfig(nodes: N[], edges: E[], config: string, filtros: FiltrosEstado = FILTROS_INICIALES): Set<string> {
  const out = new Set<string>();
  for (const n of nodes) {
    if (!esDueno(n.kind) || n.soloPlan) continue;
    if (config === "all" ? ocultoPorEstado(n, filtros) : !n.configs.includes(config)) continue;
    out.add(n.id);
  }
  const canales = new Set(nodes.filter((n) => !esDueno(n.kind) && n.kind !== "page").map((n) => n.id));
  const duenos = new Set(out);
  for (const e of edges) {
    if (duenos.has(e.source) && canales.has(e.target)) out.add(e.target);
    if (duenos.has(e.target) && canales.has(e.source)) out.add(e.source);
  }
  return out;
}

export function compararConfigs(nodes: N[], edges: E[], a: string, b: string, filtros?: FiltrosEstado) {
  const ma = miembrosConfig(nodes, edges, a, filtros);
  const mb = miembrosConfig(nodes, edges, b, filtros);
  const lado = new Map<string, Lado>();
  const resumen: Resumen = { soloA: 0, soloB: 0, comun: 0 };
  const diferencias: { soloA: ItemDif[]; soloB: ItemDif[] } = { soloA: [], soloB: [] };
  for (const n of nodes) {
    const ea = ma.has(n.id);
    const eb = mb.has(n.id);
    if (!ea && !eb) continue;
    const l: Lado = ea && eb ? "ambas" : ea ? "a" : "b";
    lado.set(n.id, l);
    if (n.kind !== "node" && n.kind !== "topic") continue;
    if (l === "ambas") resumen.comun++;
    else {
      const item = { id: n.id, label: n.label ?? n.id, kind: n.kind };
      if (l === "a") { resumen.soloA++; diferencias.soloA.push(item); }
      else { resumen.soloB++; diferencias.soloB.push(item); }
    }
  }
  const orden = (x: ItemDif, y: ItemDif) => (x.kind === y.kind ? 0 : x.kind === "node" ? -1 : 1) || x.label.localeCompare(y.label);
  diferencias.soloA.sort(orden);
  diferencias.soloB.sort(orden);
  return { lado, resumen, diferencias };
}

export const textoResumen = (r: Resumen, labelA: string, labelB: string) =>
  `${r.soloA} solo en ${labelA}, ${r.soloB} solo en ${labelB}, ${r.comun} en común`;

// Okabe-Ito (seguro para daltonismo) + ícono y texto: el lado nunca depende solo del color.
const ESTILOS: Record<Lado, { color: string; icono: string; texto: string }> = {
  a: { color: "#0072B2", icono: "◀", texto: "Solo en A" },
  b: { color: "#E69F00", icono: "▶", texto: "Solo en B" },
  ambas: { color: "#8b95a1", icono: "=", texto: "En ambas" },
};
export const estiloComparar = (lado: Lado) => ESTILOS[lado];

export function leerCompararUrl(search: string, configIds: string[]): [string, string] | null {
  const v = new URLSearchParams(search).get("comparar");
  if (!v) return null;
  const p = v.split(",");
  if (p.length !== 2) return null;
  const [a, b] = p;
  if (a === b || a === "all" || b === "all" || !configIds.includes(a) || !configIds.includes(b)) return null;
  return [a, b];
}

export function escribirCompararUrl(q: URLSearchParams, par: [string, string] | null): void {
  if (par) q.set("comparar", `${par[0]},${par[1]}`);
  else q.delete("comparar");
}
