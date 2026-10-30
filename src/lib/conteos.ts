// Una sola definición de "nodo del repo": ros2_node que no es externo (igual que la tabla de grafo.astro).
export interface NodoLike {
  category: string;
  status?: string;
}

export function conteoNodos(nodes: NodoLike[]) {
  const ros = nodes.filter((n) => n.category === "ros2_node");
  const propios = ros.filter((n) => n.status !== "externo");
  const por = (s: string) => propios.filter((n) => n.status === s).length;
  return {
    total: propios.length,
    enUso: por("en_uso"),
    legado: por("legado"),
    sinUso: por("sin_uso"),
    rotos: por("roto"),
    externos: ros.length - propios.length,
  };
}

export type ConteoNodos = ReturnType<typeof conteoNodos>;

export const etiquetaNodos = (c: ConteoNodos) => `${c.enUso} en uso de ${c.total} nodos del repo`;

export const etiquetaVisibles = (v: number, t: number) => `${v} de ${t} ${t === 1 ? "elemento visible" : "elementos visibles"}`;
