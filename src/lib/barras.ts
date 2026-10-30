// Lógica pura de las barras laterales de la wiki: plegado en escritorio (persistente), cajones en móvil y modo enfoque
// (no persistente). El script del navegador (src/scripts/barras.ts) solo traduce eventos y aplica el estado.
export type Lado = "izq" | "der";
export interface EstadoBarras {
  izqPlegada: boolean;
  derPlegada: boolean;
  enfoque: boolean;
  cajon: Lado | null;
}
export type EventoBarras =
  | { tipo: "alternar"; lado: Lado; movil: boolean }
  | { tipo: "escape" }
  | { tipo: "fuera" }
  | { tipo: "enfoque" };
export interface AlmacenBarras {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
}

export const CLAVES_BARRA = { izq: "wiki:barra-izq", der: "wiki:barra-der" } as const;
export const ANCHO_CAJON = 900;
export const esMovil = (ancho: number): boolean => ancho < ANCHO_CAJON;

export function barras(e: EstadoBarras, ev: EventoBarras): EstadoBarras {
  switch (ev.tipo) {
    case "alternar": {
      if (e.enfoque) return e;
      if (ev.movil) return { ...e, cajon: e.cajon === ev.lado ? null : ev.lado };
      return ev.lado === "izq" ? { ...e, izqPlegada: !e.izqPlegada } : { ...e, derPlegada: !e.derPlegada };
    }
    case "escape":
      if (e.cajon) return { ...e, cajon: null };
      return e.enfoque ? { ...e, enfoque: false } : e;
    case "fuera":
      return e.cajon ? { ...e, cajon: null } : e;
    case "enfoque":
      return { ...e, enfoque: !e.enfoque, cajon: null };
  }
}

// Valor de aria-expanded del botón de ese lado.
export function visible(e: EstadoBarras, lado: Lado, movil: boolean): boolean {
  if (e.enfoque) return false;
  if (movil) return e.cajon === lado;
  return !(lado === "izq" ? e.izqPlegada : e.derPlegada);
}

export function leerBarras(alm: AlmacenBarras): { izqPlegada: boolean; derPlegada: boolean } {
  try {
    return { izqPlegada: alm.get(CLAVES_BARRA.izq) === "plegada", derPlegada: alm.get(CLAVES_BARRA.der) === "plegada" };
  } catch {
    return { izqPlegada: false, derPlegada: false };
  }
}

// Solo guarda lo plegado; una barra desplegada borra su clave. Nunca el enfoque ni el cajón.
export function guardarBarras(alm: AlmacenBarras, e: EstadoBarras): void {
  try {
    for (const lado of ["izq", "der"] as const) {
      if (lado === "izq" ? e.izqPlegada : e.derPlegada) alm.set(CLAVES_BARRA[lado], "plegada");
      else alm.remove(CLAVES_BARRA[lado]);
    }
  } catch {
    /* almacén no disponible */
  }
}
