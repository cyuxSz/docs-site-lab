import { Marked } from "marked";
import createDOMPurify from "dompurify";
import { bloqueDiagrama, parsearBloque, type Diagrama } from "./diagramas.ts";
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
const TAGS = ["a","p","br","hr","h1","h2","h3","h4","h5","h6","strong","em","del","s","code","pre","blockquote","ul","ol","li","table","thead","tbody","tr","th","td","img","input","figure","figcaption"];
const ATTR = ["href","src","alt","title","align","start","type","checked","disabled","class"];
const PROYECTO = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

// Bloques ```diagrama válidos de primer nivel (los de citas o listas siguen siendo código), con su posición en el texto.
// Marked normaliza los saltos de línea a LF; los desplazamientos se devuelven sobre el texto original.
function localizarDiagramas(md: string, tokens?: any[]): { inicio: number; fin: number; datos: Diagrama }[] {
  const texto = String(md ?? "");
  const lista = tokens ?? new Marked({ gfm: true }).lexer(texto);
  const normalizado = texto.replace(/\r\n|\r/g, "\n");
  if (lista.map((t: any) => t.raw).join("") !== normalizado) return [];
  const orig: number[] = [];
  if (normalizado !== texto) for (let i = 0, j = 0; i <= texto.length; i++, j++) { orig[j] = i; if (texto[i] === "\r" && texto[i + 1] === "\n") i++; }
  const aOrig = (n: number) => (normalizado === texto ? n : orig[n]);
  const salida: { inicio: number; fin: number; datos: Diagrama }[] = [];
  let pos = 0;
  for (const t of lista) {
    if (t.type === "code" && t.lang === "diagrama" && t.codeBlockStyle !== "indented") {
      const datos = parsearBloque(t.text);
      if (datos) salida.push({ inicio: aOrig(pos), fin: aOrig(pos + t.raw.replace(/\n+$/, "").length), datos });
    }
    pos += t.raw.length;
  }
  return salida;
}

export const diagramasDe = (md: string): Diagrama[] => localizarDiagramas(md).map((x) => x.datos);

// Cambia solo el bloque cuya fuente es `fuenteAnterior`; null si no está o aparece más de una vez (otra persona editó la página).
export function reemplazarDiagrama(md: string, fuenteAnterior: string, nuevo: Parameters<typeof bloqueDiagrama>[0]): string | null {
  const coincidencias = localizarDiagramas(md).filter((x) => x.datos.fuente === String(fuenteAnterior).toLowerCase());
  if (coincidencias.length !== 1) return null;
  const { inicio, fin } = coincidencias[0];
  return md.slice(0, inicio) + bloqueDiagrama(nuevo).replace(/\n$/, "") + md.slice(fin);
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
  const marked = new Marked({ gfm: true, renderer: { html({ text }: any) { return esc(text); } }, extensions: [figura] as any });
  // Solo bloques de primer nivel y con proyecto: el resto de bloques ```diagrama sigue siendo código.
  const analizar = (md: string) => {
    const tokens = marked.lexer(String(md));
    if (!proyecto) return tokens;
    const buenos = new Map(localizarDiagramas(String(md), tokens).map((x) => [x.inicio, x.datos]));
    if (!buenos.size) return tokens;
    let pos = 0;
    return tokens.map((t: any) => {
      const datos = t.type === "code" ? buenos.get(pos) : undefined;
      pos += t.raw.length;
      return datos ? { type: "diagrama", raw: t.raw, datos } : t;
    });
  };
  const convertir = (md: string) => marked.parser(analizar(md) as any) as string;
  const P = createDOMPurify(win);
  P.addHook("afterSanitizeAttributes", (el: any) => {
    for (const a of ["href", "src"]) if (el.hasAttribute(a)) { const s = urlSegura(el.getAttribute(a), a as any); if (s === null) el.removeAttribute(a); }
    if (el.tagName === "A" && /^https?:/i.test(el.getAttribute("href") ?? "")) el.setAttribute("rel", "noopener noreferrer");
    if (el.tagName === "INPUT") { if (el.getAttribute("type") !== "checkbox") el.remove(); else el.setAttribute("disabled", ""); }
    if (el.hasAttribute("class") && !(el.tagName === "CODE" && /^language-[\w+#-]+$/.test(el.getAttribute("class"))) && !(el.tagName === "FIGURE" && el.getAttribute("class") === "hw-diagrama")) el.removeAttribute("class");
  });
  const conf = { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false };
  return {
    html: (md: string) => P.sanitize(convertir(md), conf) as string,
    fragmento: (md: string) => P.sanitize(convertir(md), { ...conf, RETURN_DOM_FRAGMENT: true }) as DocumentFragment,
  };
}
