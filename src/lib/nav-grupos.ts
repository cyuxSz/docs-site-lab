// Lógica pura de los grupos plegables de la SideNav (el script del navegador solo aplica y guarda el estado).
import type { AlmacenBarras } from "./barras";

export const claveGrupos = (proyecto: string): string => `wiki:nav-grupos:${proyecto}`;

export function leerGrupos(alm: AlmacenBarras, proyecto: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  try {
    const v: unknown = JSON.parse(alm.get(claveGrupos(proyecto)) ?? "null");
    if (v === null || typeof v !== "object" || Array.isArray(v)) return {};
    for (const [k, x] of Object.entries(v)) if (k !== "__proto__" && typeof x === "boolean") out[k] = x;
    return out;
  } catch {
    return {};
  }
}

export function guardarGrupo(alm: AlmacenBarras, proyecto: string, id: string, abierto: boolean): void {
  try {
    if (id === "__proto__") return;
    alm.set(claveGrupos(proyecto), JSON.stringify({ ...leerGrupos(alm, proyecto), [id]: abierto }));
  } catch {
    /* almacén no disponible */
  }
}

// El grupo de la página actual nunca queda oculto al cargar; los demás, solo si se guardó abierto.
export const grupoAbierto = (id: string, actual: string | null, guardado: Record<string, boolean>): boolean => id === actual || guardado[id] === true;

export function grupoActual(grupos: { id: string; pages: { route: string }[] }[], ruta?: string): string | null {
  if (!ruta) return null;
  return grupos.find((g) => g.pages.some((p) => p.route === ruta))?.id ?? null;
}
