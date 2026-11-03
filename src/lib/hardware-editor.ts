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

// Subidas activas: mientras haya alguna, Guardar queda deshabilitado (el enlace aún no está en el Markdown).
export const AVISO_SUBIDAS = "Espera a que terminen las subidas";
export function estadoGuardar(subidasActivas: number, guardando: boolean): { deshabilitado: boolean; aviso: string } {
  const subiendo = subidasActivas > 0;
  return { deshabilitado: subiendo || guardando, aviso: subiendo ? AVISO_SUBIDAS : "" };
}

// Ante un 409 se conserva el texto del editor y se muestra el mensaje de conflicto.
export function resultadoGuardado(status: number): { conservarTexto: boolean; mensaje: string } {
  return { conservarTexto: status !== 200, mensaje: status === 200 ? "" : mensajeError(status === 0 ? "red" : status) };
}

export const MENSAJE_BORRADO_409 = "Alguien cambió la página; recárgala antes de borrar";

// Borrado: solo 200 quita la página del índice local; un 409 muestra su texto propio y no toca nada.
export function resultadoBorrado(status: number): { quitarDelIndice: boolean; mensaje: string } {
  if (status === 200) return { quitarDelIndice: true, mensaje: "" };
  return { quitarDelIndice: false, mensaje: status === 409 ? MENSAJE_BORRADO_409 : mensajeError(status === 0 ? "red" : status) };
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
