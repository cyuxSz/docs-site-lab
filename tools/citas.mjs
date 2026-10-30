// Vista previa de citas al código: qué enlaces de la wiki apuntan a líneas del repo y cuáles se extraen en el build.
// Lógica pura (sin git ni disco): la usa tools/fetch.mjs y la prueban los tests.

// Solo `${repoUrl}/blob/${sha}/<ruta>#L<a>[-L<b>]`. Devuelve null si no es una cita de este repo y commit, si falta el
// ancla de líneas o si la ruta intenta salir del repo ("..").
export function parseCita(href, repoUrl, sha) {
  const prefijo = `${repoUrl}/blob/${sha}/`;
  if (typeof href !== "string" || !href.startsWith(prefijo)) return null;
  const [ruta, ancla = ""] = href.slice(prefijo.length).split("#");
  const m = ancla.match(/^L(\d+)(?:-L(\d+))?$/);
  if (!m || !ruta) return null;
  let file;
  try {
    file = decodeURIComponent(ruta);
  } catch {
    return null;
  }
  if (file.startsWith("/") || file.includes("\\") || file.split("/").some((s) => s === ".." || s === "." || s === "")) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  const [start, end] = a <= b ? [a, b] : [b, a];
  return { file, start, end, key: `${file}#L${start}-L${end}` };
}

// Líneas start..end (1-based, inclusivo) de un texto, sin \r. Recorta end al archivo y corta a max líneas.
export function extraerLineas(texto, start, end, max = 30) {
  const todas = texto.split(/\r?\n/);
  if (todas[todas.length - 1] === "") todas.pop(); // el salto de línea final no es una línea más
  if (start < 1 || start > todas.length) return null;
  let fin = Math.min(end, todas.length);
  const truncated = fin - start + 1 > max;
  if (truncated) fin = start + max - 1;
  return { start, end: fin, lines: todas.slice(start - 1, fin), truncated };
}

// Citas únicas (por key) de un Markdown con los enlaces ya reescritos, en orden de aparición.
export function citasDe(markdown, repoUrl, sha) {
  const vistas = new Map();
  for (const m of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const cita = parseCita(m[1], repoUrl, sha);
    if (cita && !vistas.has(cita.key)) vistas.set(cita.key, cita);
  }
  return [...vistas.values()];
}
