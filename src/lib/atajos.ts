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
  // La ayuda (dialog#atajos) es el diálogo abierto: «?» la cierra.
  ayudaAbierta?: boolean;
  t: number;
  repetida?: boolean;
}

const SEGUNDA: Record<string, Accion> = { w: "wiki", g: "grafo", n: "novedades" };

// `pendiente` es el instante en que se pulsó "g" (o null).
export function atajo(pendiente: number | null, k: Tecla): { accion: Accion | null; pendiente: number | null } {
  const nada = { accion: null, pendiente: null };
  if (k.escribiendo) return nada;
  if (k.dialogoAbierto) {
    if (k.ayudaAbierta && !k.repetida && !k.altGraph && !k.ctrlKey && !k.metaKey && !k.altKey && k.key === "?") return { accion: "ayuda", pendiente: null };
    return nada;
  }
  if (k.repetida) return { accion: null, pendiente };
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

// Origen real del evento (atraviesa shadow DOM): true si es un campo donde se escribe.
export function escribiendoEn(e: { target?: unknown; composedPath?: () => unknown[] }): boolean {
  const origen = (typeof e.composedPath === "function" ? e.composedPath()[0] : undefined) ?? e.target;
  const el = origen as { closest?: (s: string) => unknown } | null | undefined;
  return typeof el?.closest === "function" && Boolean(el.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="searchbox"], [role="combobox"]'));
}

export function destino(accion: Accion | null, rutas: { wiki?: string; grafo?: string; novedades?: string }): string | null {
  if (accion === "wiki" || accion === "grafo" || accion === "novedades") return rutas[accion] || null;
  return null;
}

export const ATAJOS: { teclas: string[]; descripcion: string }[] = [
  { teclas: ["g", "w"], descripcion: "Ir a la wiki" },
  { teclas: ["g", "g"], descripcion: "Ir al grafo" },
  { teclas: ["g", "n"], descripcion: "Ir a novedades" },
  { teclas: ["?"], descripcion: "Mostrar u ocultar esta ayuda" },
  { teclas: ["["], descripcion: "Mostrar u ocultar la navegación" },
  { teclas: ["]"], descripcion: "Mostrar u ocultar el índice o los datos de la página" },
  { teclas: ["f"], descripcion: "Modo lectura (enfoque: oculta las barras laterales)" },
  { teclas: ["Ctrl", "K"], descripcion: "Buscar en la documentación" },
  { teclas: ["/"], descripcion: "Buscar en la documentación" },
];
