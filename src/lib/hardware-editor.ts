// Lógica pura de la interfaz de hardware (Electrónica/Mecánica): slugs, URLs, reordenar, subida de archivos y mensajes.
// Sin DOM: la usa src/scripts/hardware-editor.ts y la cubren tests/hardware-ui-logica.test.mjs.
import { extension, sanearNombre, TIPOS } from "../../lib/archivos-nombre.mjs";

export interface PaginaIndice {
  slug: string;
  titulo: string;
}

const MAX_SLUG = 60;
const SLUG = /^[a-z0-9-]{1,60}$/;
const IMAGENES = new Set(["png", "jpg", "jpeg", "webp"]);

// "Placa de potencia v2" -> "placa-de-potencia-v2"; vacío si el título no tiene letras ni números.
export function slugDeTitulo(titulo: string): string {
  return String(titulo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

// Si el slug ya existe añade -2, -3… recortando la base para no pasar de 60.
export function slugUnico(base: string, existentes: string[]): string {
  if (!existentes.includes(base)) return base;
  for (let n = 2; ; n++) {
    const sufijo = `-${n}`;
    const candidato = base.slice(0, MAX_SLUG - sufijo.length).replace(/-+$/, "") + sufijo;
    if (!existentes.includes(candidato)) return candidato;
  }
}

// Slug de ?p=: el pedido si está en el índice; sin ?p (o vacío) la primera; desconocido o inválido -> null.
export function paginaActual(search: string, indice: PaginaIndice[]): string | null {
  const p = new URLSearchParams(search).get("p");
  if (p === null || p === "") return indice[0]?.slug ?? null;
  return SLUG.test(p) && indice.some((x) => x.slug === p) ? p : null;
}

export const urlPagina = (proyecto: string, disciplina: string, slug: string): string => `/${proyecto}/${disciplina}/?p=${encodeURIComponent(slug)}`;
// Clave de comentarios de la página (la acepta validarPagina del servidor).
export const clavePagina = (proyecto: string, disciplina: string, slug: string): string => `/${proyecto}/${disciplina}/${slug}/`;

// Índice con el título de la página actualizado (sin mutar); si el slug no está, devuelve una copia igual.
export function actualizarTituloIndice(indice: PaginaIndice[], pagina: { slug: string; titulo: string }): PaginaIndice[] {
  return indice.map((p) => (p.slug === pagina.slug ? { ...p, titulo: pagina.titulo } : p));
}

export function moverEnOrden(orden: string[], slug: string, delta: -1 | 1): string[] {
  const i = orden.indexOf(slug);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= orden.length) return [...orden];
  const copia = [...orden];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

// URL de la subida directa al Worker: el archivo va como cuerpo binario, los metadatos en la query.
export function urlSubidaDirecta(proyecto: string, disciplina: string, id: string, nombre: string): string {
  return `/api/archivos/?${new URLSearchParams({ proyecto, disciplina, id, nombre: sanearNombre(nombre) }).toString()}`;
}

const mb = (n: number): string => `${Math.round(n / (1024 * 1024))} MB`;

export type ResultadoArchivo = { ok: true; tipo: string; imagen: boolean } | { ok: false; error: string };

export function validarArchivo(archivo: { name: string; size: number }): ResultadoArchivo {
  const tipo = extension(sanearNombre(archivo.name));
  if (!tipo || !Object.hasOwn(TIPOS, tipo)) return { ok: false, error: "Tipo de archivo no permitido" };
  if (!Number.isFinite(archivo.size) || archivo.size < 1) return { ok: false, error: "El archivo está vacío" };
  const max = (TIPOS as Record<string, { max: number }>)[tipo].max;
  if (archivo.size > max) return { ok: false, error: `El archivo es demasiado grande (máximo ${mb(max)})` };
  return { ok: true, tipo, imagen: IMAGENES.has(tipo) };
}

// Markdown para el archivo subido. El texto visible sale del nombre saneado (sin corchetes ni paréntesis).
export function enlaceArchivo({ proyecto, id, nombre, imagen }: { proyecto: string; id: string; nombre: string; imagen: boolean }): string {
  const url = `/api/archivos/?proyecto=${encodeURIComponent(proyecto)}&id=${id}`;
  return `${imagen ? "!" : ""}[${sanearNombre(nombre)}](${url})`;
}

export function insertarEnTexto(texto: string, inicio: number, fin: number, insertar: string): { texto: string; cursor: number } {
  return { texto: texto.slice(0, inicio) + insertar + texto.slice(fin), cursor: inicio + insertar.length };
}

// Subidas activas: mientras haya alguna, Guardar queda deshabilitado (el enlace aún no está en el Markdown).
export const AVISO_SUBIDAS = "Espera a que terminen las subidas";
export function estadoGuardar(subidasActivas: number, guardando: boolean, cargandoVisual = false): { deshabilitado: boolean; aviso: string } {
  const subiendo = subidasActivas > 0;
  return { deshabilitado: subiendo || guardando || cargandoVisual, aviso: subiendo ? AVISO_SUBIDAS : "" };
}

export const MENSAJE_CARGANDO_EDITOR = "Cargando editor…";
export const MENSAJE_FALLO_VISUAL = "No se pudo cargar el editor visual. Sigues en modo Markdown.";
// Adjuntar e Insertar quedan bloqueados mientras se guarda o mientras carga el editor visual.
export function insercionBloqueada(guardando: boolean, cargandoVisual: boolean): boolean {
  return guardando || cargandoVisual;
}

// Mientras hay un guardado en vuelo no se puede cancelar ni cerrar: la respuesta debe llegar a la misma sesión de edición.
export function estadoCancelar(guardando: boolean): { deshabilitado: boolean; ariaDisabled: "true" | "false" } {
  return { deshabilitado: guardando, ariaDisabled: guardando ? "true" : "false" };
}

export const MENSAJE_CANDADO = "Hay otro guardado en curso. Tu texto sigue aquí; intenta guardar de nuevo en unos segundos.";

export interface RespuestaApi {
  status: number;
  json: any;
  fallo?: "red" | "timeout";
}

// Mensaje según el estado: el 409 por candado (codigo "candado") invita a reintentar; el de versión pide recargar.
export function mensajeRespuesta(status: number, extra?: { json?: any; fallo?: string }): string {
  if (status === 409 && extra?.json?.codigo === "candado") return MENSAJE_CANDADO;
  if (status === 0) return mensajeError(extra?.fallo === "timeout" ? "timeout" : "red");
  return mensajeError(status);
}

// Ante un 409 se conserva el texto del editor y se muestra el mensaje de conflicto.
export function resultadoGuardado(status: number, extra?: { json?: any; fallo?: string }): { conservarTexto: boolean; mensaje: string } {
  return { conservarTexto: status !== 200, mensaje: status === 200 ? "" : mensajeRespuesta(status, extra) };
}

export const MENSAJE_PAPELERA_EXISTE = "Ya hay una página con ese nombre. Renombra o borra la actual antes de restaurar esta.";
export const MENSAJE_PAPELERA_404 = "Esa entrada ya no está en la papelera (puede que otra persona la restaurara).";

export function resultadoRestaurarPapelera(status: number, extra?: { json?: any; fallo?: string }): { ok: boolean; mensaje: string } {
  if (status === 200) return { ok: true, mensaje: "" };
  if (status === 409 && extra?.json?.codigo === "existe") return { ok: false, mensaje: MENSAJE_PAPELERA_EXISTE };
  if (status === 404) return { ok: false, mensaje: MENSAJE_PAPELERA_404 };
  return { ok: false, mensaje: mensajeRespuesta(status, extra) };
}

export const MENSAJE_BORRADO_409 = "Alguien cambió la página; recárgala antes de borrar";

// Borrado: solo 200 quita la página del índice local; un 409 muestra su texto propio y no toca nada.
export function resultadoBorrado(status: number, extra?: { json?: any; fallo?: string }): { quitarDelIndice: boolean; mensaje: string } {
  if (status === 200) return { quitarDelIndice: true, mensaje: "" };
  return { quitarDelIndice: false, mensaje: status === 409 && extra?.json?.codigo !== "candado" ? MENSAJE_BORRADO_409 : mensajeRespuesta(status, extra) };
}

export function porcentaje(cargado: number, total: number): number {
  if (!(total > 0) || !(cargado > 0)) return 0;
  return Math.min(100, Math.round((cargado / total) * 100));
}

export function mensajeError(estado: number | string): string {
  switch (estado) {
    case 400: return "La solicitud no es válida.";
    case 401: return "Tu sesión caducó. Vuelve a iniciar sesión.";
    case 403: return "Solo los editores pueden hacer esto.";
    case 404: return "No se encontró la página.";
    case 409: return "Alguien cambió la página mientras editabas. Copia tu texto si lo necesitas y recarga la página para ver la versión nueva.";
    case 413: return "El contenido es demasiado grande.";
    case 429: return "Demasiadas acciones seguidas. Espera un momento y vuelve a intentarlo.";
    case 503: return "El servicio no está disponible. Inténtalo más tarde.";
    case "timeout": return "El servidor tardó demasiado en responder (más de 20 s). Inténtalo de nuevo.";
    case "red": return "No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.";
    default: return "Algo salió mal. Inténtalo de nuevo.";
  }
}

// Ejecuta fn cuando la señal se aborta (o ya lo está). No sirve addEventListener(..., { signal: senal }) sobre la propia
// senal: la especificación DOM quita ese listener antes de despachar "abort", así que nunca se ejecutaría.
export function alAbortar(senal: AbortSignal, fn: () => void): void {
  if (senal.aborted) return fn();
  senal.addEventListener("abort", fn, { once: true });
}

export const TIMEOUT_API_MS = 20_000;

// fetch con plazo: un AbortController propio (que también obedece a la señal de la página) cubre la petición y la lectura
// del JSON. Nunca lanza: devuelve { status: 0, fallo } si no hay red o se agota el tiempo.
export async function pedirApi(
  fetchFn: (url: string, init: RequestInit) => Promise<any>,
  url: string,
  init: RequestInit = {},
  { timeoutMs = TIMEOUT_API_MS, senal }: { timeoutMs?: number; senal?: AbortSignal } = {},
): Promise<RespuestaApi> {
  const ctl = new AbortController();
  let agotado = false;
  const plazo = setTimeout(() => {
    agotado = true;
    ctl.abort();
  }, timeoutMs);
  if (senal) alAbortar(senal, () => ctl.abort());
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal });
    let json: any = null;
    try {
      json = await res.json();
    } catch (e) {
      if (agotado) throw e;
      json = null;
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null, fallo: agotado ? "timeout" : "red" };
  } finally {
    clearTimeout(plazo);
  }
}

// Un solo guardado a la vez: mientras hay uno en curso, intentar() devuelve null y no llama a fn.
export function crearCerrojoGuardado(): { intentar: <T>(fn: () => Promise<T>) => Promise<T> | null; ocupado: () => boolean } {
  let ocupado = false;
  return {
    ocupado: () => ocupado,
    intentar<T>(fn: () => Promise<T>): Promise<T> | null {
      if (ocupado) return null;
      ocupado = true;
      return (async () => {
        try {
          return await fn();
        } finally {
          ocupado = false;
        }
      })();
    },
  };
}

// Ctrl+S / Cmd+S (también con Bloq Mayús); no con Alt (AltGr), Mayús ni durante una composición IME.
export function esAtajoGuardar(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; isComposing?: boolean }): boolean {
  return !!(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing && String(e.key).toLowerCase() === "s";
}

export function debeAvisarSalida({ editando, actual, base }: { editando: boolean; actual: string; base: string }): boolean {
  return editando && actual !== base;
}

// Enlace que navega dentro de la misma disciplina (mismo origen y ruta /<proyecto>/<disciplina>/), sin anclas.
export function esEnlaceDeLaDisciplina(href: string, actual: string, proyecto: string, disciplina: string): boolean {
  try {
    const destino = new URL(href, actual);
    const origen = new URL(actual);
    if (destino.origin !== origen.origin || destino.hash) return false;
    return destino.pathname === `/${proyecto}/${disciplina}/`;
  } catch {
    return false;
  }
}

export const MEDIA_LADO_A_LADO = "(min-width: 64rem)";
export const DEBOUNCE_PREVIA_MS = 150;

export function crearDebounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancelar: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null;
  const d = ((...args: A) => {
    if (t !== null) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  }) as ((...args: A) => void) & { cancelar: () => void };
  d.cancelar = () => {
    if (t !== null) clearTimeout(t);
    t = null;
  };
  return d;
}
