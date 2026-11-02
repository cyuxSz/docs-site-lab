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

export function moverEnOrden(orden: string[], slug: string, delta: -1 | 1): string[] {
  const i = orden.indexOf(slug);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= orden.length) return [...orden];
  const copia = [...orden];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

// Pathname exacto que exige el servidor: hw/<proyecto>/<disciplina>/<uuid>-<nombre saneado>.
export const rutaBlob = (proyecto: string, disciplina: string, id: string, nombre: string): string => `hw/${proyecto}/${disciplina}/${id}-${sanearNombre(nombre)}`;

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
    case "red": return "No hay conexión con el servidor. Revisa tu red e inténtalo de nuevo.";
    default: return "Algo salió mal. Inténtalo de nuevo.";
  }
}
