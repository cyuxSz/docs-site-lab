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
  claves?(): string[];
}
interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  length?: number;
  key?(i: number): string | null;
}

export function almacenSeguro(obtener: () => Storage | null | undefined): Almacen {
  // Un almacén que ya respondió se reutiliza (en el navegador localStorage es siempre el mismo objeto); si falla o
  // devuelve null se vuelve a pedir en la siguiente operación.
  let guardado: Storage | null | undefined;
  const getStorage = () => (guardado ??= obtener());
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
    claves() {
      try {
        const st = getStorage();
        if (!st || typeof st.key !== "function" || typeof st.length !== "number") return [];
        const out: string[] = [];
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

export const claveRol = (p: string) => `rutas:${p}:rol`;
export const clavePaso = (p: string, rol: string, page: string) => `rutas:${p}:${rol}:pagina:${page}`;
export const clavePasoIndice = (p: string, rol: string, i: number) => `rutas:${p}:${rol}:${i}`;

// Discriminador estable de un paso: la página con su #anchor tal como aparece en la ruta (page no trae el anchor; route sí).
export function idPaso(s: PasoRuta): string {
  const h = s.route.indexOf("#");
  return h >= 0 && !s.page.includes("#") ? s.page + s.route.slice(h) : s.page;
}

// Lee un paso; si solo existe la clave vieja por índice con "1", la migra a la clave nueva.
// Límite: un índice viejo se asigna al paso que hoy ocupa ese índice (sin el rutas.md antiguo no se puede saber su página original).
function leido(alm: Almacen, p: string, rol: string, i: number, id: string): boolean {
  try {
    const nueva = clavePaso(p, rol, id);
    const vieja = clavePasoIndice(p, rol, i);
    const v = alm.get(nueva);
    if (v === "1") {
      alm.remove(vieja); // que al desmarcar no se re-migre
      return true;
    }
    if (v === null && alm.get(vieja) === "1") {
      alm.set(nueva, "1");
      // Solo borrar la clave vieja si la nueva quedó realmente escrita (el almacén traga errores de cuota).
      if (alm.get(nueva) === "1") alm.remove(vieja);
      return true;
    }
  } catch {}
  return false;
}

export const leidos = (alm: Almacen, p: string, ruta: Ruta): boolean[] => ruta.pasos.map((s, i) => leido(alm, p, ruta.id, i, idPaso(s)));

// `paso` es el PasoRuta; `i` es su índice para borrar también la clave vieja.
export function marcar(alm: Almacen, p: string, rol: string, paso: PasoRuta, hecho: boolean, i?: number) {
  const id = idPaso(paso);
  if (hecho) alm.set(clavePaso(p, rol, id), "1");
  else {
    alm.remove(clavePaso(p, rol, id));
    if (i !== undefined) alm.remove(clavePasoIndice(p, rol, i));
  }
}

export function reiniciar(alm: Almacen, p: string, ruta: Ruta) {
  ruta.pasos.forEach((s, i) => {
    alm.remove(clavePaso(p, ruta.id, idPaso(s)));
    alm.remove(clavePaso(p, ruta.id, s.page)); // clave intermedia, sin anchor
    alm.remove(clavePasoIndice(p, ruta.id, i));
  });
  // Claves viejas por índice más allá de la longitud actual (la ruta pudo encogerse).
  const viejas = new RegExp(`^rutas:${escRe(p)}:${escRe(ruta.id)}:\\d+$`);
  // Claves por página de pasos que ya no están en la ruta.
  const paginas = new RegExp(`^rutas:${escRe(p)}:${escRe(ruta.id)}:pagina:`);
  for (const k of alm.claves?.() ?? []) if (viejas.test(k) || paginas.test(k)) alm.remove(k);
}
const escRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function progreso(l: boolean[]) {
  const hechos = l.filter(Boolean).length;
  const i = l.indexOf(false);
  return { hechos, total: l.length, texto: `${hechos} de ${l.length}`, siguiente: i < 0 ? null : i };
}

const decodificar = (x: string) => {
  try {
    return decodeURIComponent(x);
  } catch {
    return x;
  }
};

// `hash` es location.hash: si coincide con el anchor de un paso de la página, ese paso; si no, el primero no leído.
export function pasoEnPagina(ruta: Ruta, page: string, l: boolean[], hash = ""): number {
  const idx = ruta.pasos.flatMap((s, i) => (s.page === page ? [i] : []));
  if (!idx.length) return -1;
  if (hash) {
    const h = hash.startsWith("#") ? hash : `#${hash}`;
    const objetivo = decodificar(page + h);
    const exacto = idx.find((i) => decodificar(idPaso(ruta.pasos[i])) === objetivo);
    if (exacto !== undefined) return exacto;
  }
  return idx.find((i) => !l[i]) ?? idx[0];
}

export function rolGuardado(alm: Almacen, p: string, rutas: Ruta[]): string | null {
  const id = alm.get(claveRol(p));
  return id && rutas.some((r) => r.id === id) ? id : null;
}

// --- Ruta activa (lote 9a): la barra de ruta al pie solo sale si el usuario la activó con "Empezar" ---
export const claveRutaActiva = (p: string) => `rutas:${p}:activa`;

export function activarRuta(alm: Almacen, p: string, rol: string) {
  alm.set(claveRutaActiva(p), rol);
}

export function desactivarRuta(alm: Almacen, p: string) {
  alm.remove(claveRutaActiva(p));
}

// Solo vale un id que sea una ruta del proyecto (lista blanca); cualquier otro valor guardado se ignora.
export function rutaActiva(alm: Almacen, p: string, rutas: Ruta[]): string | null {
  const id = alm.get(claveRutaActiva(p));
  return id && rutas.some((r) => r.id === id) ? id : null;
}

export function pasoActivo(alm: Almacen, p: string, rutas: Ruta[], page: string, hash = ""): { ruta: Ruta; i: number } | null {
  const id = rutaActiva(alm, p, rutas);
  const ruta = rutas.find((r) => r.id === id);
  if (!ruta) return null;
  const i = pasoEnPagina(ruta, page, leidos(alm, p, ruta), hash);
  return i >= 0 ? { ruta, i } : null;
}

export function textoContinuar(pr: { hechos: number; siguiente: number | null }): { texto: string; deshabilitado: boolean } {
  if (pr.siguiente === null) return { texto: "Ruta completa", deshabilitado: true };
  return { texto: pr.hechos === 0 ? "Empezar" : "Continuar con el siguiente paso", deshabilitado: false };
}
