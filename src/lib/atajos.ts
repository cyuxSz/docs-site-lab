// Atajos globales de teclado. Puro: el script del navegador traduce el evento y navega.
export const VENTANA_ATAJO = 1500;
export type Accion = "wiki" | "grafo" | "novedades" | "ayuda" | "izquierda" | "derecha" | "enfoque";
export interface Tecla {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  // AltGr (en Windows con teclado español llega como Ctrl+Alt): vale para [ y ].
  altGraph?: boolean;
  escribiendo: boolean;
  dialogoAbierto: boolean;
  t: number;
}

const SEGUNDA: Record<string, Accion> = { w: "wiki", g: "grafo", n: "novedades" };

// `pendiente` es el instante en que se pulsó "g" (o null).
export function atajo(pendiente: number | null, k: Tecla): { accion: Accion | null; pendiente: number | null } {
  const nada = { accion: null, pendiente: null };
  if (k.escribiendo || k.dialogoAbierto) return nada;
  const key = (k.key ?? "").toLowerCase();
  if (k.altGraph) {
    if (k.metaKey) return nada;
    if (k.key === "[") return { accion: "izquierda", pendiente: null };
    if (k.key === "]") return { accion: "derecha", pendiente: null };
    return nada;
  }
  if (k.ctrlKey || k.metaKey || k.altKey) return nada;
  if (k.key === "[") return { accion: "izquierda", pendiente: null };
  if (k.key === "]") return { accion: "derecha", pendiente: null };
  if (key === "f") return { accion: "enfoque", pendiente: null };
  if (pendiente !== null && k.t - pendiente < VENTANA_ATAJO && SEGUNDA[key]) return { accion: SEGUNDA[key], pendiente: null };
  if (key === "g") return { accion: null, pendiente: k.t };
  if (k.key === "?") return { accion: "ayuda", pendiente: null };
  return nada;
}

export function destino(accion: Accion | null, rutas: { wiki?: string; grafo?: string; novedades?: string }): string | null {
  if (accion === "wiki" || accion === "grafo" || accion === "novedades") return rutas[accion] || null;
  return null;
}

export const ATAJOS: { teclas: string[]; descripcion: string }[] = [
  { teclas: ["g", "w"], descripcion: "Ir a la wiki" },
  { teclas: ["g", "g"], descripcion: "Ir al grafo" },
  { teclas: ["g", "n"], descripcion: "Ir a novedades" },
  { teclas: ["?"], descripcion: "Mostrar esta ayuda" },
  { teclas: ["["], descripcion: "Mostrar u ocultar la navegación" },
  { teclas: ["]"], descripcion: "Mostrar u ocultar el índice" },
  { teclas: ["f"], descripcion: "Modo enfoque" },
  { teclas: ["Ctrl", "K"], descripcion: "Buscar en la documentación" },
  { teclas: ["/"], descripcion: "Buscar en la documentación" },
];
