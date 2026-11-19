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

const ETIQUETAS_VISOR = new Set(["kc-schematic-viewer", "kc-board-viewer"]);
function buscarVisor(raiz: any, prof: number): any | null {
  if (!raiz || prof > 8 || typeof raiz.querySelectorAll !== "function") return null;
  for (const el of raiz.querySelectorAll("*")) {
    if (ETIQUETAS_VISOR.has(String(el.tagName).toLowerCase())) return el;
  }
  for (const el of raiz.querySelectorAll("*")) {
    if (el.shadowRoot) {
      const v = buscarVisor(el.shadowRoot, prof + 1);
      if (v) return v;
    }
  }
  return null;
}
// Único lugar que conoce los internos del bundle de KiCanvas: el visor interno vive en shadow roots abiertos anidados.
export function visorInternoKicad(embed: any): any | null {
  try {
    return buscarVisor(embed?.shadowRoot, 0);
  } catch {
    return null;
  }
}
export function aplicarTemaVisorKicad(visor: any, tema: string): boolean {
  try {
    if (!visor || !visor.loaded) return false;
    if (typeof visor.update_theme !== "function") return false;
    if (typeof visor.viewer?.paint !== "function" || typeof visor.viewer?.draw !== "function") return false;
    visor.theme = tema;
    visor.update_theme();
    visor.viewer.paint();
    visor.viewer.draw();
    return true;
  } catch {
    return false;
  }
}
// Espera (acotada) a que el visor interno exista y esté cargado. Sin shadowRoot al conectar se abandona sin temporizadores.
export function esperarVisorKicad(embed: any, win: any, ms: number): Promise<any | null> {
  return new Promise((resolver) => {
    if (!embed?.shadowRoot || !win) return resolver(null);
    let fin = false;
    let sondeo: any;
    let plazo: any;
    const terminar = (v: any | null) => {
      if (fin) return;
      fin = true;
      win.clearInterval(sondeo);
      win.clearTimeout(plazo);
      embed.removeEventListener("kicanvas:load", comprobar);
      resolver(v);
    };
    function comprobar() {
      const v = visorInternoKicad(embed);
      if (v && v.loaded) terminar(v);
    }
    embed.addEventListener("kicanvas:load", comprobar);
    comprobar();
    if (fin) return;
    sondeo = win.setInterval(comprobar, 200);
    plazo = win.setTimeout(() => terminar(null), ms);
  });
}
