// Grafos por sección (capa ROS): qué nodos y canales entran en cada una y el recorrido automático. Lógica pura, sin
// dependencias del navegador, para que graph.ts la use en el build y los tests la importen directo.
import type { GraphCategory, GraphEdge, GraphNode } from "./graph";

export interface Seccion {
  id: string;
  core: string[]; // nodos de la capa (o hardware)
  channels: string[]; // topics/servicios/acciones que tocan el núcleo
  context: string[]; // el otro lado: dueños fuera del núcleo conectados a esos canales o directo al núcleo
}

export interface PasoRecorrido {
  node: string;
  text: string;
}

const OWNERS = new Set(["node", "hardware"]);
const OLD = new Set(["legado", "sin_uso"]);
const orden = (ids: Iterable<string>) => [...ids].sort((a, b) => a.localeCompare(b));
const unico = <T>(xs: T[]) => [...new Set(xs)];

// Mismo criterio que HIDDEN_BY_DEFAULT del componente: legado y sin uso se ocultan salvo que se pida verlos.
const oculto = (n: GraphNode, showOld?: boolean) => !showOld && n.kind === "node" && OLD.has(n.status ?? "");

export function seccion(nodes: GraphNode[], edges: GraphEdge[], layer: string, opts: { showOld?: boolean } = {}): Seccion {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const core = new Set(
    nodes.filter((n) => (layer === "hardware" ? n.kind === "hardware" : n.kind === "node" && n.group === layer) && !oculto(n, opts.showOld)).map((n) => n.id),
  );
  // Canales: no dueños unidos al núcleo por una arista en cualquier sentido.
  const channels = new Set<string>();
  for (const e of edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      const other = byId.get(b);
      if (core.has(a) && other && !OWNERS.has(other.kind)) channels.add(b);
    }
  }
  // Contexto: dueños visibles fuera del núcleo, unidos a un canal de la sección o directo a un nodo del núcleo.
  const context = new Set<string>();
  for (const e of edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
      const other = byId.get(b);
      if ((core.has(a) || channels.has(a)) && other && OWNERS.has(other.kind) && !core.has(b) && !oculto(other, opts.showOld)) context.add(b);
    }
  }
  return { id: layer, core: orden(core), channels: orden(channels), context: orden(context) };
}

// Capas con al menos un nodo propio (contando legado), sin topics ni servicios, en el orden dado.
export function seccionesDe(nodes: GraphNode[], edges: GraphEdge[], layerIds: string[]): string[] {
  return layerIds.filter((id) => id !== "topic" && id !== "service" && seccion(nodes, edges, id, { showOld: true }).core.length > 0);
}

// "a", "a y b", "a, b y c", "a, b, c y 2 más".
export function listaCorta(items: string[], max = 3): string {
  if (items.length <= 1) return items.join("");
  if (items.length <= max) return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
  return `${items.slice(0, max).join(", ")} y ${items.length - max} más`;
}

export function recorridoSeccion(
  s: Seccion,
  nodes: GraphNode[],
  edges: GraphEdge[],
  layer: GraphCategory,
  override?: PasoRecorrido[],
): PasoRecorrido[] {
  const visibles = new Set([...s.core, ...s.context]);
  const custom = (override ?? []).filter((p) => visibles.has(p.node));
  if (custom.length) return custom;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const label = (id: string) => byId.get(id)?.label ?? id;
  const dueno = (id: string) => OWNERS.has(byId.get(id)?.kind ?? "");

  // Flechas entre nodos del núcleo: directas o pasando por un topic/servicio.
  const core = new Set(s.core);
  const next = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (a !== b) next.set(a, unico([...(next.get(a) ?? []), b]));
  };
  for (const e of edges) if (core.has(e.source) && core.has(e.target)) link(e.source, e.target);
  for (const mid of nodes.filter((n) => !OWNERS.has(n.kind))) {
    const ins = edges.filter((e) => e.target === mid.id && core.has(e.source)).map((e) => e.source);
    const outs = edges.filter((e) => e.source === mid.id && core.has(e.target)).map((e) => e.target);
    for (const a of ins) for (const b of outs) link(a, b);
  }
  // Se descartan las flechas que cierran ciclos (DFS); el rango es el camino más largo desde las fuentes.
  const state = new Map<string, number>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const t of next.get(id) ?? []) {
      if (state.get(t) === 1) back.add(`${id}→${t}`);
      else if (!state.get(t)) visit(t);
    }
    state.set(id, 2);
  };
  for (const id of s.core) if (!state.get(id)) visit(id);
  const rank = new Map<string, number>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    rank.set(id, 0); // provisional: protege de un ciclo que se escape
    const preds = s.core.filter((p) => (next.get(p) ?? []).includes(id) && !back.has(`${p}→${id}`));
    const r = preds.length ? Math.max(...preds.map((p) => rankOf(p) + 1)) : 0;
    rank.set(id, r);
    return r;
  };
  for (const id of s.core) rankOf(id);
  const ordenados = [...s.core].sort((a, b) => rank.get(a)! - rank.get(b)! || label(a).localeCompare(label(b), "es"));

  const canales = new Set(s.channels);
  return ordenados.map((id, i) => {
    const recibe: string[] = [];
    const usa: string[] = [];
    const publica: string[] = [];
    const atiende: string[] = [];
    // Quién está al otro lado de un canal, solo entre nodos visibles de la sección y sin repetir.
    const otros = (canal: string, lado: "source" | "target") => {
      const otro = lado === "source" ? "target" : "source";
      return unico(edges.filter((e) => e[otro] === canal && e[lado] !== id && visibles.has(e[lado])).map((e) => label(e[lado])));
    };
    const con = (item: string, prep: string, quienes: string[]) => (quienes.length ? `${item} (${prep} ${listaCorta(quienes)})` : item);
    for (const e of edges) {
      if (e.target === id && canales.has(e.source)) {
        const canal = byId.get(e.source)!;
        (canal.kind === "topic" ? recibe : usa).push(con(canal.label, "de", otros(e.source, "source")));
      } else if (e.source === id && canales.has(e.target)) {
        const canal = byId.get(e.target)!;
        (canal.kind === "topic" ? publica : atiende).push(con(canal.label, "para", otros(e.target, "target")));
      } else if (e.target === id && dueno(e.source) && visibles.has(e.source)) recibe.push(label(e.source));
      else if (e.source === id && dueno(e.target) && visibles.has(e.target)) publica.push(label(e.target));
    }
    const clausulas = [
      recibe.length && `recibe ${listaCorta(unico(recibe))}`,
      usa.length && `usa ${listaCorta(unico(usa))}`,
      publica.length && `publica ${listaCorta(unico(publica))}`,
      atiende.length && `atiende ${listaCorta(unico(atiende))}`,
    ].filter(Boolean);
    const frase = clausulas.length ? `${label(id)} ${clausulas.join("; ")}.` : `${label(id)} no se conecta con otros nodos visibles.`;
    return { node: id, text: i === 0 && layer.hint ? `${layer.label}: ${layer.hint}. ${frase}` : frase };
  });
}
