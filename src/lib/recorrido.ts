// Retomar el recorrido guiado y teclas del modo presentación del grafo.
import type { Almacen } from "./rutas";

export const claveRecorrido = (proyecto: string, vista: string, seccion: string | null) =>
  `recorrido-paso:${proyecto}:${vista}:${seccion ?? "-"}`;

export function guardarPaso(alm: Almacen, k: string, paso: number, total: number) {
  try {
    alm.set(k, JSON.stringify({ paso, total }));
  } catch {}
}

export function pasoGuardado(alm: Almacen, k: string, total: number): number | null {
  try {
    const raw = alm.get(k);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.paso !== "number" || !Number.isInteger(v.paso) || v.total !== total) return null;
    return v.paso >= 1 && v.paso < total ? v.paso : null;
  } catch {
    return null;
  }
}

export function borrarPaso(alm: Almacen, k: string) {
  try {
    alm.remove(k);
  } catch {}
}

export const textoRetomar = (i: number, total: number) => `Retomar recorrido (paso ${i + 1} de ${total})`;

export interface TeclaInfo {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  escribiendo: boolean;
}

export function accionTecla(t: TeclaInfo, presentando: boolean): "alternar" | "siguiente" | "anterior" | "salir" | null {
  if (t.ctrlKey || t.metaKey || t.altKey) return null;
  if ((t.key === "p" || t.key === "P") && !t.escribiendo) return "alternar";
  if (!presentando) return null;
  if (t.key === "ArrowRight" || t.key === " " || t.key === "PageDown") return "siguiente";
  if (t.key === "ArrowLeft" || t.key === "PageUp") return "anterior";
  if (t.key === "Escape") return "salir";
  return null;
}
