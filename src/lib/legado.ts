// Configuración "Sistema anterior" (legado: true en ros.json): aviso, enlace validado y recorrido propio.
export const AVISO_LEGADO = "Este es el sistema anterior; no es lo que corre hoy.";

type Paso = { node: string; text: string };

// Solo rutas internas del portal: empiezan con "/", sin "//", "\", esquema ni caracteres de control.
export function enlaceInterno(v: unknown): string | null {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

export function recorridoConfig(id: string, nodes: { id: string; configs: string[] }[], tour: unknown): { pasos: Paso[]; descartados: string[] } {
  const pasos: Paso[] = [];
  const descartados: string[] = [];
  if (!Array.isArray(tour)) return { pasos, descartados };
  for (const s of tour) {
    if (!s || typeof s.node !== "string" || !s.node || typeof s.text !== "string" || !s.text.trim()) continue;
    if (nodes.find((n) => n.id === s.node)?.configs.includes(id)) pasos.push({ node: s.node, text: s.text });
    else descartados.push(s.node);
  }
  return { pasos, descartados };
}

type Cfg = { id: string; legado?: boolean };

// Primera configuración que no es legado donde caben todos los pasos del recorrido global.
export const configDelRecorrido = (configs: Cfg[], tour: { node: string }[], nodes: { id: string; configs: string[] }[]) =>
  configs.find((c) => !c.legado && tour.every((s) => nodes.find((n) => n.id === s.node)?.configs.includes(c.id)))?.id ?? null;

export const configInicial = (configs: Cfg[], tour: { node: string }[], nodes: { id: string; configs: string[] }[]) =>
  configDelRecorrido(configs, tour, nodes) ?? configs.find((c) => !c.legado)?.id ?? "all";

// Prioridad: sección, luego configuración con recorrido propio, luego el global.
export function recorridoActivo<P>(o: {
  global: P[];
  config?: { id: string; tour?: P[] };
  seccion: { id: string; tour: P[] } | null;
  enSeccion: boolean;
}): { tipo: "seccion" | "config" | "global"; pasos: P[]; claveSeccion: string | null } {
  if (o.enSeccion && o.seccion) return { tipo: "seccion", pasos: o.seccion.tour, claveSeccion: o.seccion.id };
  if (o.config?.tour?.length) return { tipo: "config", pasos: o.config.tour, claveSeccion: `config:${o.config.id}` };
  return { tipo: "global", pasos: o.global, claveSeccion: null };
}
