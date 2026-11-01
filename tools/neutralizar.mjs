// Neutraliza el HTML de las wikis y convierte los emojis de estado en íconos, solo fuera de código. Sin efectos al
// importarse (lo usa tools/fetch.mjs y lo prueban los tests).

// Aplica fn al texto de un bloque (líneas unidas con \n) que no está en `código en línea`, al estilo CommonMark:
// un span solo se cierra con una racha de backticks de la misma longitud que la de apertura; sin cierre, la racha es
// texto literal. Un backtick precedido de "\" no abre span. Ante la duda se detecta menos código (lo seguro).
function conSpans(texto, fn) {
  let out = "";
  let buf = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "\\") {
      buf += texto.slice(i, i + 2);
      i += 2;
    } else if (c === "`") {
      let j = i;
      while (texto[j] === "`") j++;
      const n = j - i;
      let k = j;
      let fin = -1;
      while (k < texto.length) {
        if (texto[k] !== "`") {
          k++;
          continue;
        }
        let m = k;
        while (texto[m] === "`") m++;
        if (m - k === n) {
          fin = m;
          break;
        }
        k = m;
      }
      if (fin < 0) {
        buf += texto.slice(i, j);
        i = j;
      } else {
        out += fn(buf) + texto.slice(i, fin);
        buf = "";
        i = fin;
      }
    } else {
      buf += c;
      i++;
    }
  }
  return out + fn(buf);
}

const ATX = /^\s{0,3}#{1,6}(\s|$)/;
const ITEM = /^\s{0,3}([-*+]|\d{1,9}[.)])(\s|$)|^\s{0,3}>/;
const CORTE = /^\s{0,3}(?:(?:-[ \t]*)+|(?:\*[ \t]*)+|(?:_[ \t]*)+|=+)\s*$/;
const HTML_INI = /^\s{0,3}<[A-Za-z\/!?]/;
const CELDA = /(?<!\\)\|/;

// Aplica fn solo al texto que no está en bloques ``` / ~~~ ni en `código en línea`. Los spans no cruzan bloques: cortan
// una línea vacía, un encabezado ATX, un marcador de lista o cita y una línea con "|" sin escapar (tabla, por celdas).
export function outsideCode(body, fn) {
  const out = [];
  let bloque = [];
  const cerrar = () => {
    if (bloque.length) out.push(conSpans(bloque.join("\n"), fn));
    bloque = [];
  };
  let fence = null;
  for (const line of body.split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      cerrar();
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      out.push(line);
    } else if (fence) {
      out.push(line);
    } else if (line.trim() === "") {
      cerrar();
      out.push(line);
    } else if (CORTE.test(line)) {
      cerrar();
      out.push(conSpans(line, fn));
    } else if (HTML_INI.test(line)) {
      cerrar();
      bloque.push(line);
    } else if (ATX.test(line) || CELDA.test(line)) {
      cerrar();
      out.push(CELDA.test(line) ? line.split(CELDA).map((c) => conSpans(c, fn)).join("|") : conSpans(line, fn));
    } else {
      if (ITEM.test(line)) cerrar();
      bloque.push(line);
    }
  }
  cerrar();
  return out.join("\n");
}

// Las wikis son Markdown puro (la auditoría no encontró HTML incrustado). Cualquier etiqueta HTML fuera de bloques de
// código se escapa y se muestra como texto: así nadie mete <script>, <iframe> o formularios en el portal desde un repo.
// La CSP del sitio es la segunda barrera.
export function neutralizeHtml(body) {
  // Fuera de `código en línea`, "<" seguido de letra, "/", "!" o "?" abre HTML: se escapa.
  return outsideCode(body, (text) => text.replace(/<(?=[A-Za-z\/!?])/g, "&lt;"));
}

// Los emojis de estado de las tablas de la wiki se vuelven íconos del portal (mismos colores que el grafo); el texto
// que sigue al emoji ya explica el estado, así que el ícono solo lleva el nombre para lectores de pantalla.
// Va después de neutralizeHtml: este HTML lo genera el portal, no el repo.
const STATUS_EMOJI = { "✅": ["en_uso", "En uso"], "🟡": ["legado", "Legado"], "⚪": ["sin_uso", "Sin uso"], "❌": ["roto", "Roto"] };
export function statusBadges(body) {
  return outsideCode(body, (text) =>
    text.replace(/(✅|🟡|⚪|❌)️?/gu, (_, e) => `<span class="st st-${STATUS_EMOJI[e][0]}" role="img" aria-label="${STATUS_EMOJI[e][1]}" title="${STATUS_EMOJI[e][1]}"></span>`),
  );
}
