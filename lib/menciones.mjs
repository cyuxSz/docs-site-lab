// @menciones: fuente única para la API y la interfaz. Un login de GitHub tiene 1–39 caracteres alfanuméricos o guiones
// simples, sin guion inicial, final ni doble. El @ va al inicio o tras un carácter que no sea [A-Za-z0-9_.@-] (un correo no
// es mención) y el login no puede continuar con [A-Za-z0-9-].
const LOGIN = "[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}";
const fuente = `(?<![A-Za-z0-9_.@-])@(${LOGIN})(?![A-Za-z0-9-])`;

const texto = (t) => (typeof t === "string" ? t : "");

export function extraerMenciones(t) {
  const out = [];
  for (const m of texto(t).matchAll(new RegExp(fuente, "g"))) {
    const login = m[1].toLowerCase();
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

// Trozos {texto, mencion}: unidos reproducen el texto exacto. mencion es el login en minúsculas o null.
export function partirMenciones(t) {
  const s = texto(t);
  const out = [];
  let pos = 0;
  for (const m of s.matchAll(new RegExp(fuente, "g"))) {
    if (m.index > pos) out.push({ texto: s.slice(pos, m.index), mencion: null });
    out.push({ texto: m[0], mencion: m[1].toLowerCase() });
    pos = m.index + m[0].length;
  }
  if (pos < s.length) out.push({ texto: s.slice(pos), mencion: null });
  return out;
}

export function mencionaA(t, yo) {
  if (typeof yo !== "string" || !yo) return false;
  return extraerMenciones(t).includes(yo.toLowerCase());
}
