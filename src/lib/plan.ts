// Capa "Plan" (arquitectura objetivo): lógica pura. Las aristas kind "plan" y los nodos que solo existen en el plan se
// apartan antes de calcular la vista de lo que corre hoy.
interface NodoPlan {
  id: string;
  plan?: boolean;
}
interface AristaPlan {
  source: string;
  target: string;
  kind: string;
}

export const LEYENDA_PLAN = "Planeado, no corre hoy";

export function separarPlan<N extends NodoPlan, E extends AristaPlan>(nodes: N[], edges: E[]) {
  const planEdges = edges.filter((e) => e.kind === "plan");
  const edgesReales = edges.filter((e) => e.kind !== "plan");
  const conReal = new Set<string>();
  for (const e of edgesReales) {
    conReal.add(e.source);
    conReal.add(e.target);
  }
  const soloPlan = new Set(nodes.filter((n) => n.plan && !conReal.has(n.id)).map((n) => n.id));
  return { edges: edgesReales, planEdges, soloPlan };
}

// Con el plan activo se suman los extremos de las flechas plan; no muta el conjunto recibido.
export function idsConPlan(visibles: Set<string>, planFlow: { source: string; target: string }[], showPlan: boolean) {
  const ids = new Set(visibles);
  if (showPlan) for (const e of planFlow) ids.add(e.source).add(e.target);
  return ids;
}

export const planDisponible = (o: { planFlow: number; seccion: string | null; config?: { id: string; legado?: boolean } }) =>
  o.planFlow > 0 && !o.seccion && !o.config?.legado;

// Clave de posición: igual que antes sin plan; "plan:<filtro>" con plan (las secciones no tienen plan).
export function claveLayout(o: { seccion: string | null; showOld: boolean; config: string; plan: boolean }) {
  if (o.seccion) return `seccion:${o.seccion}${o.showOld ? ":old" : ""}`;
  const base = o.config !== "all" ? o.config : o.showOld ? "old" : "all";
  return o.plan ? `plan:${base}` : base;
}

export const etiquetaPlan = (label?: string | null) => (label ? `plan · ${label}` : "plan");

export function notaPlan(n: { plan?: boolean; soloPlan?: boolean }): string | null {
  if (!n.plan) return null;
  return n.soloPlan
    ? "Planeado, no corre hoy: forma parte de la arquitectura objetivo y todavía no está en el código."
    : "También forma parte de la arquitectura objetivo.";
}
