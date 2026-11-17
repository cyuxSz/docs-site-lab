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

// Estado inicial del plan al abrir ?node=: un nodo solo-plan solo se ve con el plan activo, que exige una configuración no
// legada y ninguna sección. Devuelve showPlan y la configuración a usar (null = la actual sirve).
export function planInicialParaNodo(o: { nodo?: { soloPlan?: boolean } | null; planFlow: number; seccion: string | null; config?: { id: string; legado?: boolean } }) {
  if (!o.nodo?.soloPlan || o.seccion) return { showPlan: false, config: null as string | null };
  if (planDisponible({ planFlow: o.planFlow, seccion: null, config: o.config })) return { showPlan: true, config: null as string | null };
  return { showPlan: o.planFlow > 0, config: o.planFlow > 0 ? "all" : null };
}

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

// Posiciones de la vista plan: los nodos solo-plan van a una banda propia arriba y, en cada fila, los nodos
// consecutivos se separan según la longitud de su etiqueta para que no se encimen.
const UNIDAD_POR_CHAR = 0.5;
const SEP_BASE = 10;
const BANDA_PLAN = 6;
const sepMin = (a: string, b: string) => Math.max(SEP_BASE, ((a.length + b.length) / 2) * UNIDAD_POR_CHAR + 2);

function espaciarFila(ids: string[], pos: Map<string, [number, number]>, label: (id: string) => string) {
  const fila = [...ids].sort((a, b) => pos.get(a)![0] - pos.get(b)![0] || a.localeCompare(b));
  for (let i = 1; i < fila.length; i++) {
    const prev = pos.get(fila[i - 1])!;
    const cur = pos.get(fila[i])!;
    const x = Math.max(cur[0], prev[0] + sepMin(label(fila[i - 1]), label(fila[i])));
    pos.set(fila[i], [Math.round(x * 100) / 100, cur[1]]);
  }
}

export function acomodarPlan(pos: Map<string, [number, number]>, soloPlan: Set<string>, label: (id: string) => string) {
  const out = new Map(pos);
  const reales = [...out.keys()].filter((id) => !soloPlan.has(id));
  const planes = [...out.keys()].filter((id) => soloPlan.has(id));
  const filas = new Map<number, string[]>();
  for (const id of reales) filas.set(out.get(id)![1], [...(filas.get(out.get(id)![1]) ?? []), id]);
  for (const ids of filas.values()) espaciarFila(ids, out, label);
  if (planes.length) {
    const top = Math.max(0, ...reales.map((id) => out.get(id)![1])) + BANDA_PLAN;
    const xs = reales.map((id) => out.get(id)![0]);
    const min = xs.length ? Math.min(...xs) : 0;
    const max = xs.length ? Math.max(...xs) : 0;
    const orden = [...planes].sort((a, b) => out.get(a)![0] - out.get(b)![0] || a.localeCompare(b));
    orden.forEach((id, i) => {
      const x = orden.length > 1 ? min + ((max - min) * i) / (orden.length - 1) : (min + max) / 2;
      out.set(id, [Math.round(x * 100) / 100, top]);
    });
    espaciarFila(planes, out, (id) => `${label(id)} (plan)`);
  }
  return out;
}
