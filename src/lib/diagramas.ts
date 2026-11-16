// Diagramas editables en hardware (C1): lógica pura, sin dependencias (la usan el navegador, el renderizador y los tests).
// Contrato "fuente + SVG": cada diagrama son dos archivos de /api/archivos (la fuente del editor y el SVG exportado)
// y un bloque ```diagrama en el Markdown que los enlaza.

export type EditorDiagrama = "excalidraw" | "drawio";
export interface Diagrama {
  editor: EditorDiagrama;
  fuente: string;
  svg: string;
  titulo: string;
}

export const MAX_TITULO = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLAVES = new Set(["editor", "fuente", "svg", "titulo"]);
const esEditor = (v: unknown): v is EditorDiagrama => v === "excalidraw" || v === "drawio";

// Cuerpo del bloque -> datos, o null si algo no cuadra (el bloque se muestra entonces como código normal).
export function parsearBloque(cuerpo: string): Diagrama | null {
  const vistas = new Map<string, string>();
  for (const cruda of String(cuerpo ?? "").split(/\r\n|\r|\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const i = linea.indexOf(":");
    if (i < 1) return null;
    const clave = linea.slice(0, i).trim();
    if (!CLAVES.has(clave) || vistas.has(clave)) return null;
    vistas.set(clave, linea.slice(i + 1).trim());
  }
  const editor = vistas.get("editor");
  const fuente = vistas.get("fuente")?.toLowerCase();
  const svg = vistas.get("svg")?.toLowerCase();
  const titulo = vistas.get("titulo") ?? "";
  if (!esEditor(editor) || !fuente || !svg || !UUID.test(fuente) || !UUID.test(svg) || fuente === svg) return null;
  if (titulo.length > MAX_TITULO) return null;
  return { editor, fuente, svg, titulo };
}

// Título en una sola línea, sin caracteres de control ni comillas invertidas: no puede abrir claves ni cerrar el bloque.
export function limpiarTitulo(titulo: string): string {
  return String(titulo ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITULO)
    .trim();
}

export function bloqueDiagrama(d: { editor: string; fuente: string; svg: string; titulo?: string }): string {
  if (!esEditor(d.editor)) throw new Error("Editor de diagrama no válido");
  if (!UUID.test(String(d.fuente)) || !UUID.test(String(d.svg)) || d.fuente === d.svg) throw new Error("Identificadores de diagrama no válidos");
  const titulo = limpiarTitulo(d.titulo ?? "");
  return `\`\`\`diagrama\neditor: ${d.editor}\nfuente: ${d.fuente}\nsvg: ${d.svg}\n${titulo ? `titulo: ${titulo}\n` : ""}\`\`\`\n`;
}

// Inserta el bloque en la posición del cursor separado por líneas en blanco del texto vecino.
export function insertarBloque(texto: string, cursor: number, d: Parameters<typeof bloqueDiagrama>[0]): { texto: string; cursor: number } {
  const c = Math.max(0, Math.min(cursor, texto.length));
  const antes = texto.slice(0, c);
  const despues = texto.slice(c);
  const prefijo = !antes || antes.endsWith("\n\n") ? "" : antes.endsWith("\n") ? "\n" : "\n\n";
  const sufijo = !despues || despues.startsWith("\n") ? "" : "\n";
  const nuevo = antes + prefijo + bloqueDiagrama(d) + sufijo;
  return { texto: nuevo + despues, cursor: nuevo.length };
}

// Nombres de los dos archivos que se suben (se saniean otra vez en el servidor).
export function nombresArchivos({ editor, titulo }: { editor: string; titulo?: string }): { fuente: string; svg: string } {
  const base =
    String(titulo ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "diagrama";
  if (!esEditor(editor)) throw new Error("Editor de diagrama no válido");
  return { fuente: `${base}.${editor === "drawio" ? "drawio" : "excalidraw"}`, svg: `${base}.svg` };
}

// ---------- diagrams.net (iframe + postMessage, proto=json) ----------
export const ORIGEN_DRAWIO = "https://embed.diagrams.net";
const EVENTOS_DRAWIO = new Set(["init", "load", "save", "export", "exit", "autosave", "configure"]);

export function urlDrawio(): string {
  return `${ORIGEN_DRAWIO}/?embed=1&proto=json&spin=1&lang=es&saveAndExit=0&noExitBtn=0`;
}

// Mensaje de diagrams.net ya validado, o null. Exige origen exacto, que venga del iframe abierto y un JSON en texto con un `event` conocido.
export function mensajeDrawio(evento: { origin?: string; source?: unknown; data?: unknown }, marco: unknown): Record<string, any> | null {
  if (!marco || !evento || evento.origin !== ORIGEN_DRAWIO || evento.source !== marco || typeof evento.data !== "string") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(evento.data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return null;
  const ev = (msg as { event?: unknown }).event;
  return typeof ev === "string" && EVENTOS_DRAWIO.has(ev) ? (msg as Record<string, any>) : null;
}

// Respuesta al iframe: targetOrigin exacto, nunca "*".
export function enviarDrawio(ventana: { postMessage: (m: string, o: string) => void } | null | undefined, mensaje: Record<string, unknown>): void {
  if (!ventana) return;
  ventana.postMessage(JSON.stringify(mensaje), ORIGEN_DRAWIO);
}

// ---------- SVG ----------
// ¿El documento tiene <svg> como elemento raíz? (admite prólogo XML, comentarios y doctype)
export function esSvg(texto: unknown): boolean {
  if (typeof texto !== "string") return false;
  let s = texto.replace(/^\uFEFF/, "").trimStart();
  for (let i = 0; i < 20; i++) {
    const m = /^(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>)\s*/i.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return /^<svg[\s>/]/.test(s);
}

// `data` del evento export de diagrams.net (data URI base64) -> texto SVG, o null.
export function svgDeExport(data: unknown): string | null {
  if (typeof data !== "string") return null;
  const m = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return esSvg(texto) ? texto : null;
  } catch {
    return null;
  }
}

// ---------- Excalidraw ----------
// Las fuentes de Excalidraw salen de este origen (tools/postbuild.mjs las copia a dist/excalidraw/fonts/).
export const RUTA_ASSETS_EXCALIDRAW = "/excalidraw/";

// `src` de un FontFace ("url(a) format('woff2'), url(b) ...") -> solo las fuentes de `origen` (o data:). Si no queda ninguna, el original.
export function fuentesSoloDeOrigen(src: string, origen: string): string {
  const partes = String(src).split(/,\s*(?=url\()/);
  const propias = partes.filter((p) => {
    const m = /^url\(\s*["']?([^"')]+)["']?\s*\)/.exec(p.trim());
    return !!m && (m[1].startsWith("data:") || m[1].startsWith(origen + "/"));
  });
  return propias.length ? propias.join(", ") : src;
}

// ---------- Cambios sin guardar ----------
export interface EstadoEditor {
  sucio: boolean;
  guardando: boolean;
  cambioDurante?: boolean;
}
export const ESTADO_INICIAL: Readonly<EstadoEditor> = Object.freeze({ sucio: false, guardando: false });

export function estadoEditor(e: EstadoEditor, evento: "cambio" | "guardando" | "guardado" | "error"): EstadoEditor {
  switch (evento) {
    case "cambio":
      return e.guardando ? { ...e, sucio: true, cambioDurante: true } : { sucio: true, guardando: false };
    case "guardando":
      return { sucio: e.sucio, guardando: true, cambioDurante: false };
    case "guardado":
      return { sucio: e.cambioDurante === true, guardando: false };
    case "error":
      return { sucio: true, guardando: false };
  }
}

export const confirmarCierre = (e: EstadoEditor): boolean => e.sucio || e.guardando;
