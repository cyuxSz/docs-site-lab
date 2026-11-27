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

export const ID_BIBLIOTECAS = "integrados";

// Sin bibliotecas es la URL de siempre. Con ellas se añade la sección y configure=1, a mano: diagrams.net no decodifica la URL.
export function urlDrawio(conBibliotecas = false): string {
  const base = `${ORIGEN_DRAWIO}/?embed=1&proto=json&spin=1&lang=es&saveAndExit=0&noExitBtn=0&libraries=1&libs=general;electrical`;
  return conBibliotecas === true ? `${base};${ID_BIBLIOTECAS}&configure=1` : base;
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

// Huella de lo que cuenta como cambio del dibujo en Excalidraw: ids y versiones de los elementos y el color de fondo
// (no la selección ni el desplazamiento).
export const huellaDibujo = (elementos: readonly { id: string; version: number }[], appState?: { viewBackgroundColor?: string } | null): string =>
  elementos.map((e) => `${e.id}:${e.version}`).join(",") + "|" + String(appState?.viewBackgroundColor ?? "");

export const confirmarCierre = (e: EstadoEditor): boolean => e.sucio || e.guardando;

// ---------- Biblioteca de integrados (E2) ----------
export const LIMITES_BIBLIOTECA = { bytes: 1048576, porDisciplina: 10, formas: 1000 };
// Tope de la carga antes de crear el iframe: si se supera, el editor abre sin bibliotecas.
export const ESPERA_BIBLIOTECAS_MS = 5000;

export interface FormaBiblioteca {
  xml: string;
  w: number;
  h: number;
  aspect?: "fixed";
  title: string;
}
export interface BibliotecaCargada {
  titulo: string;
  formas: FormaBiblioteca[];
}
export interface ResultadoBibliotecas {
  bibliotecas: BibliotecaCargada[];
  avisos: string[];
}
export interface OpcionesBibliotecas {
  disciplina: string;
  listar: () => Promise<unknown> | unknown;
  descargar: (id: string) => Promise<string> | string;
}

// Decodifica entidades (básicas y numéricas) hasta que el texto no cambie (máx. 5 pasadas): lo que acabaría viendo el navegador.
function decodificarEntidades(t: string): string {
  const una = (s: string) =>
    s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi, (_m, hex, dec, nombre) => {
      if (nombre) return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[String(nombre).toLowerCase() as "lt"];
      const n = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    });
  let actual = t;
  for (let i = 0; i < 5; i++) {
    const sig = una(actual);
    if (sig === actual) break;
    actual = sig;
  }
  return actual;
}

// ¿Es seguro meter este mxGraphModel en la paleta? Descarta imágenes, enlaces, objetos con metadatos, javascript: y HTML en las etiquetas.
export function formaSegura(xml: unknown): boolean {
  if (typeof xml !== "string") return false;
  const decodificado = decodificarEntidades(xml);
  for (const t of [xml, decodificado]) {
    if (/<\s*(UserObject|object)\b/i.test(t)) return false;
    if (/(^|[\s"';])(image|link)\s*=/i.test(t)) return false;
    if (/[\s"']\s*(href|src|xlink:href)\s*=/i.test(t)) return false;
  }
  if (/javascript:/i.test(decodificado.replace(/[\u0000- \u007f-\u009f]+/g, ""))) return false;
  const html = /(^|[\s";])html\s*=\s*1/i.test(decodificado);
  for (const m of xml.matchAll(/\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const v = decodificarEntidades(m[1] ?? m[2] ?? "");
    if (/<[a-z/!?]/i.test(v)) return false;
    if (html && v.includes("<")) return false;
  }
  return true;
}

const medida = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 40);

// <mxlibrary> -> formas saneadas (lista blanca de campos) y cuántas se quitaron; null si no es exactamente una biblioteca.
export function leerBiblioteca(texto: unknown): { formas: FormaBiblioteca[]; descartadas: number } | null {
  if (typeof texto !== "string") return null;
  const m = /^\s*<mxlibrary>([\s\S]*)<\/mxlibrary>\s*$/.exec(texto);
  if (!m) return null;
  let lista: unknown;
  try {
    lista = JSON.parse(m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  if (!Array.isArray(lista)) return null;
  const formas: FormaBiblioteca[] = [];
  let descartadas = 0;
  for (const e of lista) {
    const x = e && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>) : null;
    if (!x || typeof x.xml !== "string" || !x.xml.startsWith("<mxGraphModel") || !formaSegura(x.xml)) {
      descartadas++;
      continue;
    }
    const f: FormaBiblioteca = { xml: x.xml, w: medida(x.w), h: medida(x.h), title: limpiarTitulo((typeof x.title === "string" ? x.title : "").replace(/[<>]/g, "")) };
    if (x.aspect === "fixed") f.aspect = "fixed";
    formas.push(f);
  }
  return { formas, descartadas };
}

export function formasDeBiblioteca(texto: unknown): FormaBiblioteca[] | null {
  return leerBiblioteca(texto)?.formas ?? null;
}

// Solo la clave `libraries`; de cada biblioteca solo entran título y formas.
export function configDrawio(bibliotecas: readonly BibliotecaCargada[] | null | undefined): Record<string, unknown> {
  if (!bibliotecas || bibliotecas.length === 0) return {};
  return {
    libraries: [
      {
        title: { main: "Proyecto" },
        entries: [
          {
            id: ID_BIBLIOTECAS,
            title: { main: "Integrados" },
            libs: bibliotecas.map((b) => ({ title: { main: b.titulo }, data: b.formas, expand: true })),
          },
        ],
      },
    ],
  };
}

export function respuestaConfigure(bibliotecas: readonly BibliotecaCargada[] | null | undefined): { action: "configure"; config: Record<string, unknown> } {
  return { action: "configure", config: configDrawio(bibliotecas ?? []) };
}

const bytesUtf8 = (t: string) => new TextEncoder().encode(t).length;

// Descarga y sanea las bibliotecas .xml de la disciplina. Nunca lanza: lo que falla se omite y se avisa.
export async function cargarBibliotecas(o: OpcionesBibliotecas): Promise<ResultadoBibliotecas> {
  const avisos: string[] = [];
  const bibliotecas: BibliotecaCargada[] = [];
  try {
    let lista: unknown;
    try {
      lista = await o.listar();
    } catch {
      lista = null;
    }
    if (!Array.isArray(lista)) {
      return { bibliotecas, avisos: ["No se pudo consultar la lista de bibliotecas de integrados: el editor abre sin ellas."] };
    }
    const entradas = lista.filter(
      (e): e is { id: string; nombre: string; tamano?: unknown } =>
        !!e && typeof e === "object" && (e as any).tipo === "xml" && (e as any).disciplina === o.disciplina && typeof (e as any).id === "string" && typeof (e as any).nombre === "string",
    );
    const aptas = entradas.filter((e) => {
      if (typeof e.tamano === "number" && e.tamano > LIMITES_BIBLIOTECA.bytes) {
        avisos.push(`La biblioteca «${limpiarTitulo(e.nombre.replace(/[<>]/g, ""))}» pesa más de 1 MB y no se cargó.`);
        return false;
      }
      return true;
    });
    const usadas = aptas.slice(0, LIMITES_BIBLIOTECA.porDisciplina);
    if (aptas.length > usadas.length) {
      avisos.push(`Solo se cargan ${LIMITES_BIBLIOTECA.porDisciplina} bibliotecas por disciplina; se omitieron: ${aptas.slice(usadas.length).map((e) => limpiarTitulo(e.nombre.replace(/[<>]/g, ""))).join(", ")}.`);
    }
    const textos = await Promise.all(
      usadas.map(async (e) => {
        try {
          const t = await o.descargar(e.id);
          return typeof t === "string" ? t : null;
        } catch {
          return null;
        }
      }),
    );
    usadas.forEach((e, i) => {
      const nombre = limpiarTitulo(e.nombre.replace(/[<>]/g, ""));
      const titulo = limpiarTitulo(e.nombre.replace(/[<>]/g, "").replace(/\.xml$/i, ""));
      const texto = textos[i];
      if (texto === null) {
        avisos.push(`No se pudo descargar la biblioteca «${nombre}».`);
        return;
      }
      if (bytesUtf8(texto) > LIMITES_BIBLIOTECA.bytes) {
        avisos.push(`La biblioteca «${nombre}» pesa más de 1 MB y no se cargó.`);
        return;
      }
      const r = leerBiblioteca(texto);
      if (!r) return; // un .xml que no es biblioteca se ignora sin aviso
      let formas = r.formas;
      if (formas.length > LIMITES_BIBLIOTECA.formas) {
        avisos.push(`La biblioteca «${nombre}» tiene más de ${LIMITES_BIBLIOTECA.formas} formas: se recortó.`);
        formas = formas.slice(0, LIMITES_BIBLIOTECA.formas);
      }
      if (r.descartadas > 0) avisos.push(`De la biblioteca «${nombre}» se descartaron ${r.descartadas} formas por no ser seguras o no ser válidas.`);
      if (formas.length === 0) {
        avisos.push(`La biblioteca «${nombre}» no tiene formas válidas y no se cargó.`);
        return;
      }
      bibliotecas.push({ titulo, formas });
    });
  } catch {
    avisos.push("No se pudieron cargar las bibliotecas de integrados.");
  }
  return { bibliotecas, avisos };
}

// Igual que cargarBibliotecas, pero si pasa `ms` devuelve sin bibliotecas y con aviso (el editor no espera más).
export async function cargarBibliotecasConTope(o: OpcionesBibliotecas, ms: number = ESPERA_BIBLIOTECAS_MS): Promise<ResultadoBibliotecas> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<ResultadoBibliotecas>((res) => {
    temporizador = setTimeout(() => res({ bibliotecas: [], avisos: ["Las bibliotecas de integrados tardaron demasiado: el editor abre sin ellas."] }), ms);
  });
  try {
    return await Promise.race([cargarBibliotecas(o), tope]);
  } catch {
    return { bibliotecas: [], avisos: ["No se pudieron cargar las bibliotecas de integrados."] };
  } finally {
    clearTimeout(temporizador);
  }
}
