// Lógica pura de la interfaz de comentarios (sin DOM): hilos, fechas, tipos, mensajes y peticiones.
export interface Comentario {
  id: string;
  padre: string | null;
  autor: string | null;
  tipo: string;
  texto: string;
  creado: string;
  editado: string | null;
  resuelto: boolean;
  resueltoPor: string | null;
  borrado: boolean;
}
export type Hilo = Comentario & { respuestas: Comentario[] };

export const MAX_TEXTO = 2000;
export const TIPOS_COMENTARIO = [
  { id: "duda", etiqueta: "Duda" },
  { id: "aclaracion", etiqueta: "Aclaración" },
  { id: "sugerencia", etiqueta: "Sugerencia" },
  { id: "bug", etiqueta: "Bug" },
] as const;

const porCreado = (a: Comentario, b: Comentario) => Date.parse(a.creado) - Date.parse(b.creado) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Raíces por fecha, cada una con sus respuestas directas. Huérfanas y de segundo nivel se descartan.
export function armarHilos(lista: Comentario[] | null | undefined): Hilo[] {
  if (!Array.isArray(lista)) return [];
  const raices = lista.filter((c) => !c.padre);
  return raices
    .map((r) => ({ ...r, respuestas: lista.filter((c) => c.padre === r.id).sort(porCreado) }))
    .filter((h) => !(h.borrado && h.respuestas.length === 0))
    .sort(porCreado);
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function fechaRelativa(iso: string | null | undefined, ahora: Date | number = Date.now()): string {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const ms = +ahora - t;
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return min === 1 ? "hace 1 minuto" : `hace ${min} minutos`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;
  const dias = Math.floor(ms / 864e5);
  if (dias < 2) return "ayer";
  if (dias < 30) return `hace ${dias} días`;
  const d = new Date(t);
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function tipoInfo(t: unknown): { etiqueta: string; clase: string } {
  const f = typeof t === "string" ? TIPOS_COMENTARIO.find((x) => x.id === t) : undefined;
  return f ? { etiqueta: f.etiqueta, clase: `chip-${f.id}` } : { etiqueta: "Comentario", clase: "chip-otro" };
}

export const textoValido = (t: string): boolean => typeof t === "string" && t.trim().length >= 1 && t.trim().length <= MAX_TEXTO;
export const contador = (t: string): string => `${t.trim().length}/${MAX_TEXTO}`;

// Comentarios no borrados fuera de hilos resueltos (las huérfanas no cuentan, como en armarHilos).
export function contarAbiertos(lista: Comentario[] | null | undefined): number {
  let n = 0;
  for (const h of armarHilos(lista)) {
    if (h.resuelto) continue;
    if (!h.borrado) n++;
    n += h.respuestas.filter((r) => !r.borrado).length;
  }
  return n;
}

// Ancla que abre la sección de comentarios: #comentarios (sin destino) o #comentario-<uuid> (y ese comentario).
const RE_COMENTARIO = /^#comentario-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
export function abrirPorHash(hash: string | null | undefined): { abrir: boolean; id: string | null } {
  if (hash === "#comentarios") return { abrir: true, id: null };
  const id = typeof hash === "string" ? (RE_COMENTARIO.exec(hash)?.[1] ?? null) : null;
  return id ? { abrir: true, id } : { abrir: false, id: null };
}

// Deja el comentario arriba (bajo la cabecera, por el scroll-padding del documento) y con foco. El tabindex es temporal.
interface ElementoFoco {
  setAttribute(n: string, v: string): void;
  removeAttribute(n: string): void;
  addEventListener(t: string, f: () => void, o?: { once: boolean }): void;
  scrollIntoView?: (o: { block: "start" }) => void;
  focus(o?: { preventScroll: boolean }): void;
}
export function enfocarComentario(doc: { getElementById(id: string): ElementoFoco | null }, id: string | null | undefined): boolean {
  if (typeof id !== "string" || !RE_COMENTARIO.test(`#comentario-${id}`)) return false;
  const el = doc.getElementById(`comentario-${id}`);
  if (!el) return false;
  el.setAttribute("tabindex", "-1");
  el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
  el.scrollIntoView?.({ block: "start" });
  el.focus({ preventScroll: true });
  return true;
}

export const etiquetaComentarios = (n: number | null): string => (n === null ? "Comentarios" : `Comentarios (${n})`);

export function mensajeError(codigo: number | string, opts: { retryAfter?: string | number | null; servidor?: unknown } = {}): string {
  switch (codigo) {
    case 503: return "Comentarios no configurados";
    case "red": return "Comentarios no disponibles en local";
    case 401: return "Tu sesión no es válida: inicia sesión de nuevo para comentar.";
    case 403: return "No tienes permiso para hacer esto.";
    case 404: return "El comentario ya no existe.";
    case 413: return "El comentario es demasiado largo.";
    case 415: return "No se pudo enviar el comentario.";
    case 429: {
      const n = Number(opts.retryAfter);
      const s = opts.retryAfter != null && opts.retryAfter !== "" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60;
      return `Demasiados envíos seguidos: espera ${s} s e inténtalo de nuevo.`;
    }
    case 400: {
      const e = opts.servidor;
      return typeof e === "string" && e.length > 0 && e.length <= 200 ? e : "No se pudo guardar el comentario.";
    }
    default: return "Algo falló; intenta de nuevo en unos minutos.";
  }
}

export function acciones(c: Comentario, yo: string | null | undefined) {
  if (c.borrado) return { responder: false, editar: false, borrar: false, resolver: null as string | null };
  const raiz = !c.padre;
  const mio = Boolean(yo) && typeof c.autor === "string" && c.autor.toLowerCase() === String(yo).toLowerCase();
  return { responder: raiz, editar: mio, borrar: mio, resolver: raiz ? (c.resuelto ? "Reabrir" : "Marcar resuelto") : (null as string | null) };
}

export const urlComentarios = (pagina?: string): string => "/api/comentarios/" + (pagina ? `?pagina=${encodeURIComponent(pagina)}` : "");

export const opcionesEscritura = (metodo: string, cuerpo: unknown): RequestInit => ({
  method: metodo,
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
});

// ---------- @menciones (fuente única en lib/menciones.mjs, compartida con la API) ----------
export { extraerMenciones, partirMenciones, mencionaA } from "../../lib/menciones.mjs";

// ---------- Panel de comentarios abiertos del proyecto y contador de la SideNav ----------
export interface HiloPanel {
  id: string;
  tipo: string;
  autor: string | null;
  creado: string;
  extracto: string;
  menciones: string[];
}
export interface PaginaPanel {
  pagina: string;
  abiertos: number;
  hilos: HiloPanel[];
}
export interface RespuestaPanel {
  yo?: string;
  proyecto?: string;
  truncado?: boolean;
  paginas: PaginaPanel[];
}
export interface FiltrosPanel {
  tipo: string;
  quien: string;
}

// Valores desconocidos de los filtros equivalen a "todos". No muta la entrada y descarta páginas sin hilos.
export function filtrarPanel(paginas: PaginaPanel[] | null | undefined, filtros: FiltrosPanel, yo: string | null | undefined): PaginaPanel[] {
  if (!Array.isArray(paginas)) return [];
  const tipo = TIPOS_COMENTARIO.some((t) => t.id === filtros?.tipo) ? filtros.tipo : null;
  const quien = filtros?.quien === "mios" || filtros?.quien === "mencion" ? filtros.quien : null;
  const minuscula = typeof yo === "string" && yo ? yo.toLowerCase() : null;
  const pasa = (h: HiloPanel) => {
    if (tipo && h.tipo !== tipo) return false;
    if (quien === "mios") return minuscula !== null && typeof h.autor === "string" && h.autor.toLowerCase() === minuscula;
    if (quien === "mencion") return minuscula !== null && Array.isArray(h.menciones) && h.menciones.some((m) => typeof m === "string" && m.toLowerCase() === minuscula);
    return true;
  };
  return paginas.map((p) => ({ ...p, hilos: (p.hilos ?? []).filter(pasa) })).filter((p) => p.hilos.length > 0);
}

export const urlProyecto = (id: string): string => `/api/comentarios/?proyecto=${encodeURIComponent(id)}`;
// Los hilos de páginas de hardware (/<p>/<disc>/<slug>/) viven en /<p>/<disc>/?p=<slug>; el resto va a su propia ruta.
export function enlaceHilo(pagina: string, id: string, disciplinas: string[] = []): string {
  const m = /^\/([^/]+)\/([^/]+)\/([^/]+)\/$/.exec(pagina);
  if (m && disciplinas.includes(m[2])) return `/${m[1]}/${m[2]}/?p=${m[3]}#comentario-${id}`;
  return `${pagina}#comentario-${id}`;
}

// { ruta: n } con solo enteros > 0 y rutas string.
export function contadoresNav(resp: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const paginas = (resp as RespuestaPanel | null)?.paginas;
  if (!Array.isArray(paginas)) return out;
  for (const p of paginas) {
    if (p && typeof p.pagina === "string" && typeof p.abiertos === "number" && Number.isInteger(p.abiertos) && p.abiertos > 0) out[p.pagina] = p.abiertos;
  }
  return out;
}

export const etiquetaContador = (n: number): string => (n === 1 ? "1 comentario abierto" : `${n} comentarios abiertos`);

const TTL_NAV = 60_000;
export const claveCacheNav = (id: string): string => `comentarios:nav:${id}`;
export const escribirCacheNav = (datos: Record<string, number>, ahora: number = Date.now()): string => JSON.stringify({ t: ahora, d: datos });
export function leerCacheNav(raw: string | null | undefined, ahora: number = Date.now()): Record<string, number> | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || typeof o.t !== "number" || !o.d || typeof o.d !== "object" || Array.isArray(o.d)) return null;
    const edad = ahora - o.t;
    if (!(edad >= 0 && edad <= TTL_NAV)) return null;
    return o.d as Record<string, number>;
  } catch {
    return null;
  }
}
