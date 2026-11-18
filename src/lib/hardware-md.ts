import { Marked } from "marked";
import createDOMPurify from "dompurify";
import { bloqueDiagrama, parsearBloque, type Diagrama } from "./diagramas.ts";
import { csvBom, formatoCantidad, formatoCosto, formatoUnitario, nombreCsvBom, parsearBom, parsearPdf, type Bom, type DatosPdf } from "./visores.ts";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const esc2 = (s: string) => esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const cp = (n: number) => (n >= 0xd800 && n <= 0xdfff ? "" : String.fromCodePoint(Math.min(n, 0x10ffff)));
function normal(v: string) {
  return v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => cp(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => cp(Number(d)))
    .replace(/&(colon|tab|newline);?/gi, (_, n) => ({ colon: ":", tab: "\t", newline: "\n" } as any)[n.toLowerCase()])
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}
export function urlSegura(valor: string, tipo: "href" | "src"): string | null {
  const v = String(valor ?? "").trim();
  const n = normal(v);
  if (!n) return null;
  if (tipo === "src") return /^\/api\/archivos\/?\?/.test(n) && n === v ? v : null;
  if (["//", "\\\\", "/\\", "\\/"].some((p) => n.startsWith(p))) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(n);
  if (m) return /^(https?|mailto)$/i.test(m[1]) ? v : null;
  if (/&colon;|&#/i.test(v)) return null;
  return v;
}
const TAGS = ["a","p","br","hr","h1","h2","h3","h4","h5","h6","strong","em","del","s","code","pre","blockquote","ul","ol","li","table","thead","tbody","tfoot","tr","th","td","img","input","figure","figcaption"];
const ATTR = ["href","src","alt","title","align","start","type","checked","disabled","class"];
const PROYECTO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// Bloques ```diagrama, ```pdf y ```bom válidos de primer nivel (los de citas o listas siguen siendo código), con su posición en el texto.
// Marked normaliza los saltos de línea a LF: las posiciones se calculan sobre ese texto y se devuelven sobre el original.
// Cada bloque lleva además su token, que es la clave para el render (sin depender de posiciones). Marked puede consumir
// sin token definiciones de enlace repetidas: ese tramo se salta, sin descartar el resto de la página.
type TipoBloque = "diagrama" | "pdf" | "bom";
type Hallado = { inicio: number; fin: number; tipo: TipoBloque; datos: any; token: any };
function datosDe(lang: string, texto: string): any {
  if (lang === "diagrama") return parsearBloque(texto);
  if (lang === "pdf") return parsearPdf(texto);
  const r = parsearBom(texto);
  return r.ok ? r.bom : null;
}
function localizarBloques(md: string, tokens?: any[]): Hallado[] {
  const texto = String(md ?? "");
  const lista = tokens ?? new Marked({ gfm: true }).lexer(texto);
  const normalizado = texto.replace(/\r\n|\r/g, "\n");
  const orig: number[] = [];
  if (normalizado !== texto) for (let i = 0, j = 0; i <= texto.length; i++, j++) { orig[j] = i; if (texto[i] === "\r" && texto[i + 1] === "\n") i++; }
  const aOrig = (n: number) => (normalizado === texto ? n : orig[n]);
  const salida: Hallado[] = [];
  let pos = 0;
  for (const t of lista) {
    const raw = String(t.raw ?? "");
    const idx = normalizado.indexOf(raw, pos);
    if (idx < 0 || (idx > pos && !/^\s*\[/.test(normalizado.slice(pos, idx)))) continue; // no se puede situar: se ignora este token
    if (t.type === "code" && (t.lang === "diagrama" || t.lang === "pdf" || t.lang === "bom") && t.codeBlockStyle !== "indented") {
      const datos = datosDe(t.lang, t.text);
      if (datos) salida.push({ inicio: aOrig(idx), fin: aOrig(idx + raw.replace(/\n+$/, "").length), tipo: t.lang, datos, token: t });
    }
    pos = idx + raw.length;
  }
  return salida;
}

export const diagramasDe = (md: string): Diagrama[] => localizarBloques(md).filter((x) => x.tipo === "diagrama").map((x) => x.datos as Diagrama);

export type Visor = { tipo: "pdf"; datos: DatosPdf } | { tipo: "bom"; datos: Bom };
export const visoresDe = (md: string): Visor[] => localizarBloques(md).filter((x) => x.tipo !== "diagrama").map((x) => ({ tipo: x.tipo, datos: x.datos }) as Visor);

// Cambia solo el bloque cuya fuente es `fuenteAnterior`; null si no está o aparece más de una vez (otra persona editó la página).
export function reemplazarDiagrama(md: string, fuenteAnterior: string, nuevo: Parameters<typeof bloqueDiagrama>[0]): string | null {
  const coincidencias = localizarBloques(md).filter((x) => x.tipo === "diagrama" && x.datos.fuente === String(fuenteAnterior).toLowerCase());
  if (coincidencias.length !== 1) return null;
  const { inicio, fin } = coincidencias[0];
  return md.slice(0, inicio) + bloqueDiagrama(nuevo).replace(/\n$/, "") + md.slice(fin);
}

// true solo si reemplazarDiagrama(md, fuente, …) no daría null: bloque de primer nivel con fuente única.
export function diagramaReemplazable(md: string, fuente: string): boolean {
  return localizarBloques(md).filter((x) => x.tipo === "diagrama" && x.datos.fuente === String(fuente).toLowerCase()).length === 1;
}

const urlArchivo = (proyecto: string, id: string) => `/api/archivos/?proyecto=${encodeURIComponent(proyecto)}&id=${id}`;
const nombreEnlace = (url: string) => { try { return new URL(url).hostname || url; } catch { return url; } };

// Tabla del BOM: todo el texto va escapado; el único atributo dinámico es el href http(s) ya validado por parsearBom.
function tablaBom(b: Bom): string {
  const { proveedor, enlace } = b.opcionales;
  const extra = (proveedor ? 1 : 0) + (enlace ? 1 : 0);
  const cab = ["Referencia", "Descripción", "Cantidad", "Costo unitario", "Subtotal", ...(proveedor ? ["Proveedor"] : []), ...(enlace ? ["Enlace"] : [])];
  const filas = b.filas.map((f) => {
    const link = f.enlace ? `<a href="${esc2(f.enlace)}">${esc(nombreEnlace(f.enlace))}</a>` : "";
    return `<tr><td>${esc(f.referencia)}</td><td>${esc(f.descripcion)}</td><td>${formatoCantidad(f.cantidad)}</td><td>${formatoUnitario(f.costoUnitario)}</td><td>${formatoCosto(f.subtotal)}</td>${proveedor ? `<td>${esc(f.proveedor ?? "")}</td>` : ""}${enlace ? `<td>${link}</td>` : ""}</tr>`;
  });
  const pie = `<tr><th>Total</th> <td></td> <td>${formatoCantidad(b.totales.cantidad)}</td> <td></td> <td>${formatoCosto(b.totales.costo)}</td>${"<td></td>".repeat(extra)}</tr>`;
  return `<figure class="hw-bom"><table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas.join("")}</tbody><tfoot>${pie}</tfoot></table></figure>\n`;
}

export function crearRenderizador(win: any, opciones: { proyecto?: string } = {}) {
  const proyecto = typeof opciones?.proyecto === "string" && PROYECTO.test(opciones.proyecto) ? opciones.proyecto : "";
  const figura = {
    name: "diagrama",
    renderer(t: any) {
      const d = t.datos as Diagrama;
      const src = `/api/archivos/?proyecto=${encodeURIComponent(proyecto)}&id=${d.svg}`;
      const alt = d.titulo ? `Diagrama: ${d.titulo}` : "Diagrama";
      return `<figure class="hw-diagrama"><img src="${src}" alt="${esc2(alt)}">${d.titulo ? `<figcaption>${esc(d.titulo)}</figcaption>` : ""}</figure>\n`;
    },
  };
  const pdf = {
    name: "pdf",
    renderer(t: any) {
      const d = t.datos as DatosPdf;
      return `<figure class="hw-pdf"><a href="${esc2(urlArchivo(proyecto, d.archivo))}">Abrir PDF</a>${d.titulo ? `<figcaption>${esc(d.titulo)}</figcaption>` : ""}</figure>\n`;
    },
  };
  const bom = { name: "bom", renderer: (t: any) => tablaBom(t.datos as Bom) };
  const marked = new Marked({ gfm: true, renderer: { html({ text }: any) { return esc(text); } }, extensions: [figura, pdf, bom] as any });
  // Solo bloques de primer nivel y con proyecto: el resto de bloques ```diagrama sigue siendo código.
  const analizar = (md: string) => {
    const tokens = marked.lexer(String(md));
    if (!proyecto) return tokens;
    const buenos = new Map(localizarBloques(String(md), tokens).map((x) => [x.token, x]));
    if (!buenos.size) return tokens;
    return tokens.map((t: any) => {
      const b = buenos.get(t);
      return b ? { type: b.tipo, raw: t.raw, datos: b.datos } : t;
    });
  };
  const convertir = (md: string) => marked.parser(analizar(md) as any) as string;
  const P = createDOMPurify(win);
  P.addHook("afterSanitizeAttributes", (el: any) => {
    for (const a of ["href", "src"]) if (el.hasAttribute(a)) { const s = urlSegura(el.getAttribute(a), a as any); if (s === null) el.removeAttribute(a); }
    if (el.tagName === "A" && /^https?:/i.test(el.getAttribute("href") ?? "")) el.setAttribute("rel", "noopener noreferrer");
    if (el.tagName === "INPUT") { if (el.getAttribute("type") !== "checkbox") el.remove(); else el.setAttribute("disabled", ""); }
    if (el.hasAttribute("class") && !(el.tagName === "CODE" && /^language-[\w+#-]+$/.test(el.getAttribute("class"))) && !(el.tagName === "FIGURE" && ["hw-diagrama", "hw-pdf", "hw-bom"].includes(el.getAttribute("class")))) el.removeAttribute("class");
  });
  const conf = { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false };
  return {
    html: (md: string) => P.sanitize(convertir(md), conf) as string,
    fragmento: (md: string) => P.sanitize(convertir(md), { ...conf, RETURN_DOM_FRAGMENT: true }) as DocumentFragment,
  };
}

// Añade a los visores ya pintados (y saneados) lo que no puede venir del Markdown: el <iframe> del PDF y el botón "Exportar CSV".
// Empareja por orden las figuras con los bloques de `md`; si no coinciden no toca nada. Todo se crea con createElement a partir de
// los datos del bloque (nunca del DOM). Es idempotente. En la vista previa no se crean iframes (no recargar el PDF en cada tecla).
export function montarVisores(
  raiz: any,
  md: string,
  { proyecto, slug, vistaPrevia, descargar }: { proyecto: string; slug: string; vistaPrevia: boolean; descargar: (nombre: string, csv: string) => void },
): void {
  if (!raiz || !PROYECTO.test(String(proyecto ?? ""))) return;
  const visores = visoresDe(md);
  const figuras: any[] = [...raiz.querySelectorAll("figure.hw-pdf, figure.hw-bom")];
  if (figuras.length !== visores.length) return;
  if (figuras.some((f, i) => !f.classList.contains(visores[i].tipo === "pdf" ? "hw-pdf" : "hw-bom"))) return;
  const doc = raiz.ownerDocument ?? raiz;
  const total = visores.filter((v) => v.tipo === "bom").length;
  let n = 0;
  visores.forEach((v, i) => {
    const fig = figuras[i];
    if (v.tipo === "pdf") {
      // Sin visor de PDF integrado (móvil) el iframe sería un recuadro en blanco: queda solo "Abrir PDF".
      if (vistaPrevia || fig.querySelector("iframe") || doc.defaultView?.navigator?.pdfViewerEnabled === false) return;
      const marco = doc.createElement("iframe");
      marco.setAttribute("src", urlArchivo(proyecto, v.datos.archivo));
      marco.setAttribute("title", v.datos.titulo ? `PDF: ${v.datos.titulo}` : "PDF");
      marco.setAttribute("loading", "lazy");
      fig.insertBefore(marco, fig.firstChild);
      return;
    }
    const k = n++;
    // La figura es la región desplazable: se puede mover con el teclado.
    fig.setAttribute("tabindex", "0");
    fig.setAttribute("role", "region");
    fig.setAttribute("aria-label", total > 1 ? `Tabla BOM ${k + 1}` : "Tabla BOM");
    if (fig.querySelector("button")) return;
    const boton = doc.createElement("button");
    boton.setAttribute("type", "button");
    boton.className = "btn hw-bom-exportar";
    boton.textContent = "Exportar CSV";
    if (total > 1) boton.setAttribute("aria-label", `Exportar CSV de la tabla ${k + 1}`);
    const bom = v.datos;
    boton.addEventListener("click", () => descargar(nombreCsvBom(slug, k), csvBom(bom)));
    fig.appendChild(boton);
  });
}
