// Tipo de un archivo por su contenido, para las subidas con token de subida (`vts_…`). Función pura, sin E/S.
// Solo mira los primeros VENTANA_CONTENIDO bytes y es estricta a propósito: lo que no reconoce da null.
export const TIPOS_SUBIDA = Object.freeze(["drawio", "svg", "kicad_sch", "kicad_pcb"]);
export const VENTANA_CONTENIDO = 4096;

const ESP = /[ \t\r\n]*/y;
const KICAD = /\((kicad_sch|kicad_pcb)(?=[ \t\r\n)])/y;
const DECLARACION = /<\?xml[ \t\r\n][^]*?\?>/y;
const MXFILE = /<mxfile(?=[ \t\r\n>/])/y;
const SVG = /<svg(?=[ \t\r\n>/])/y;
const COMENTARIO = /<!--[^]*?-->/y;
const DOCTYPE = /<!DOCTYPE[^[>]*>/y;

function en(re, texto, pos) {
  re.lastIndex = pos;
  const m = re.exec(texto);
  return m ? pos + m[0].length : -1;
}
const saltar = (texto, pos) => en(ESP, texto, pos);

export function tipoPorContenido(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  const texto = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes.subarray(0, VENTANA_CONTENIDO));
  let i = texto.charCodeAt(0) === 0xfeff ? 1 : 0;
  i = saltar(texto, i);

  KICAD.lastIndex = i;
  const k = KICAD.exec(texto);
  if (k) return k[1];

  const d = en(DECLARACION, texto, i);
  if (d >= 0) i = saltar(texto, d);

  if (en(MXFILE, texto, i) >= 0) return "drawio";

  let doctype = false;
  for (;;) {
    const c = en(COMENTARIO, texto, i);
    if (c >= 0) {
      i = saltar(texto, c);
      continue;
    }
    if (!doctype) {
      const t = en(DOCTYPE, texto, i);
      if (t >= 0) {
        doctype = true;
        i = saltar(texto, t);
        continue;
      }
    }
    break;
  }
  return en(SVG, texto, i) >= 0 ? "svg" : null;
}
