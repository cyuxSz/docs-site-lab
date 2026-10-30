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
