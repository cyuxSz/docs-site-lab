// Glosario de la wiki: lee la tabla de openwiki/glosario.md y marca la primera aparición de cada término en cada página
// con <abbr> (el navegador muestra la definición como tooltip). Lógica pura; la usa tools/fetch.mjs.

const plano = (s) => s.replace(/[*`]/g, "").replace(/\s+/g, " ").trim();

// Filas "| **Término / alias (nota)** | definición |" -> [{ term, aliases, def }].
export function parseGlosario(md) {
  const out = [];
  for (const linea of md.split(/\r?\n/)) {
    if (!linea.trim().startsWith("|")) continue;
    const celdas = linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    const m = celdas[0]?.trim().match(/^\*\*(.+)\*\*$/);
    if (!m || celdas.length < 2) continue;
    const term = m[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
    const def = plano(celdas.slice(1).join("|"));
    if (!term || !def) continue;
    out.push({ term, aliases: term.split(" / ").map((a) => a.trim()).filter(Boolean), def });
  }
  return out;
}

const escapa = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const regex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Partes de una línea donde no se marca: código en línea, enlaces e imágenes Markdown (texto y URL), URLs sueltas y
// etiquetas HTML (sus atributos).
const PROTEGIDO = /(`+[^`]*`+|!?\[[^\]]*\]\([^)]*\)|https?:\/\/[^\s)<>]+|<\/?[A-Za-z][^>]*>)/;

// Marca solo la primera aparición por página de cada término (los alias cuentan como el mismo). Los encabezados y los
// bloques ``` / ~~~ no se tocan. Siglas (todo en mayúsculas) distinguen mayúsculas; el resto no.
export function marcarGlosario(body, terms) {
  if (!terms.length) return body;
  const patrones = terms.map((t) => ({
    def: t.def,
    res: t.aliases.map((a) => new RegExp(`(?<![\\p{L}\\p{N}_])${regex(a)}(?![\\p{L}\\p{N}_])`, a === a.toUpperCase() && a !== a.toLowerCase() ? "u" : "iu")),
    hecho: false,
  }));
  const marcar = (texto) => {
    let resto = texto;
    let salida = "";
    for (;;) {
      let mejor = null;
      for (const p of patrones) {
        if (p.hecho) continue;
        for (const re of p.res) {
          const m = re.exec(resto);
          if (m && (!mejor || m.index < mejor.m.index)) mejor = { p, m };
        }
      }
      if (!mejor) return salida + resto;
      const { p, m } = mejor;
      p.hecho = true;
      salida += `${resto.slice(0, m.index)}<abbr class="glosa" tabindex="0" data-def="${escapa(p.def)}">${m[0]}</abbr>`;
      resto = resto.slice(m.index + m[0].length);
    }
  };
  let valla = null;
  return body
    .split("\n")
    .map((linea) => {
      const f = linea.match(/^\s*(`{3,}|~{3,})/);
      if (f) {
        if (!valla) valla = f[1][0];
        else if (f[1][0] === valla) valla = null;
        return linea;
      }
      if (valla || /^\s{0,3}#{1,6}(\s|$)/.test(linea)) return linea;
      return linea.split(PROTEGIDO).map((parte, i) => (i % 2 ? parte : marcar(parte))).join("");
    })
    .join("\n");
}
