// Localización de bloques ```diagrama, ```pdf, ```kicad, ```modelo y ```bom en Markdown, sin DOM: la usan el editor (hardware-md.ts) y el Worker.
import { Marked } from "marked";
import { bloqueDiagrama, parsearBloque } from "./diagramas.ts";
import { parsearBom, parsearKicad, parsearModelo, parsearPdf } from "./visores.ts";

// Bloques ```diagrama, ```pdf, ```kicad, ```modelo y ```bom válidos de primer nivel (los de citas o listas siguen siendo código), con su posición en el texto.
// Marked normaliza los saltos de línea a LF: las posiciones se calculan sobre ese texto y se devuelven sobre el original.
// Cada bloque lleva además su token, que es la clave para el render (sin depender de posiciones). Marked puede consumir
// sin token definiciones de enlace repetidas: ese tramo se salta, sin descartar el resto de la página.
export type TipoBloque = "diagrama" | "pdf" | "kicad" | "modelo" | "bom";
export type Hallado = { inicio: number; fin: number; tipo: TipoBloque; datos: any; token: any };
function datosDe(lang: string, texto: string): any {
  if (lang === "diagrama") return parsearBloque(texto);
  if (lang === "pdf") return parsearPdf(texto);
  if (lang === "kicad") return parsearKicad(texto);
  if (lang === "modelo") return parsearModelo(texto);
  const r = parsearBom(texto);
  return r.ok ? r.bom : null;
}
export function localizarBloques(md: string, tokens?: any[]): Hallado[] {
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
    if (t.type === "code" && (t.lang === "diagrama" || t.lang === "pdf" || t.lang === "kicad" || t.lang === "modelo" || t.lang === "bom") && t.codeBlockStyle !== "indented") {
      const datos = datosDe(t.lang, t.text);
      if (datos) salida.push({ inicio: aOrig(idx), fin: aOrig(idx + raw.replace(/\n+$/, "").length), tipo: t.lang, datos, token: t });
    }
    pos = idx + raw.length;
  }
  return salida;
}

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

