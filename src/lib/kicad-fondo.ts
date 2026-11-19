// Preferencia del fondo del visor KiCanvas (clave propia; "kc:prefs" es de KiCanvas). Tolerante a localStorage roto.
export const CLAVE_FONDO_KICAD = "vt:kicad-fondo";
export type FondoKicad = "claro" | "oscuro";

export function leerFondoKicad(win: any): FondoKicad {
  try {
    return win?.localStorage?.getItem(CLAVE_FONDO_KICAD) === "oscuro" ? "oscuro" : "claro";
  } catch {
    return "claro";
  }
}
export function guardarFondoKicad(win: any, valor: FondoKicad): void {
  try {
    win?.localStorage?.setItem(CLAVE_FONDO_KICAD, valor === "oscuro" ? "oscuro" : "claro");
  } catch {
    /* sin almacenamiento: la preferencia vive solo en la página */
  }
}
export const temaKicad = (f: FondoKicad): string => (f === "oscuro" ? "witchhazel" : "kicad");
