// Progreso de las rutas por rol en el navegador. Puro: el almacén se inyecta y nunca lanza (modo privado, cuota, bloqueado).
export interface PasoRuta {
  route: string;
  page: string;
  title: string;
  nota: string;
}
export interface Ruta {
  id: string;
  nombre: string;
  pasos: PasoRuta[];
}
export interface Almacen {
  get(k: string): string | null;
  set(k: string, v: string): void;
  remove(k: string): void;
}
interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export function almacenSeguro(getStorage: () => Storage | null | undefined): Almacen {
  return {
    get(k) {
      try {
        return getStorage()?.getItem(k) ?? null;
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        getStorage()?.setItem(k, v);
      } catch {}
    },
    remove(k) {
      try {
        getStorage()?.removeItem(k);
      } catch {}
    },
  };
}

export const claveRol = (p: string) => `rutas:${p}:rol`;
export const clavePaso = (p: string, rol: string, i: number) => `rutas:${p}:${rol}:${i}`;

export const leidos = (alm: Almacen, p: string, ruta: Ruta): boolean[] => ruta.pasos.map((_, i) => alm.get(clavePaso(p, ruta.id, i)) === "1");

export function marcar(alm: Almacen, p: string, rol: string, i: number, hecho: boolean) {
  if (hecho) alm.set(clavePaso(p, rol, i), "1");
  else alm.remove(clavePaso(p, rol, i));
}

export function reiniciar(alm: Almacen, p: string, ruta: Ruta) {
  ruta.pasos.forEach((_, i) => alm.remove(clavePaso(p, ruta.id, i)));
}

export function progreso(l: boolean[]) {
  const hechos = l.filter(Boolean).length;
  const i = l.indexOf(false);
  return { hechos, total: l.length, texto: `${hechos} de ${l.length}`, siguiente: i < 0 ? null : i };
}

export function pasoEnPagina(ruta: Ruta, page: string, l: boolean[]): number {
  const idx = ruta.pasos.flatMap((s, i) => (s.page === page ? [i] : []));
  if (!idx.length) return -1;
  return idx.find((i) => !l[i]) ?? idx[0];
}

export function rolGuardado(alm: Almacen, p: string, rutas: Ruta[]): string | null {
  const id = alm.get(claveRol(p));
  return id && rutas.some((r) => r.id === id) ? id : null;
}
