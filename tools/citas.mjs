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

// Etiqueta del bloque de código según el nombre del archivo ("" si no se reconoce).
const LENGUAJES = {
  py: "python", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", h: "cpp", c: "cpp", ino: "cpp",
  js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", json: "json", yaml: "yaml", yml: "yaml",
  xml: "xml", launch: "xml", urdf: "xml", xacro: "xml", sdf: "xml", sh: "bash", bash: "bash", md: "markdown", m: "matlab",
};
export function lenguajeDe(file) {
  if (typeof file !== "string") return "";
  const nombre = file.split("/").pop();
  if (nombre === "CMakeLists.txt") return "cmake";
  const i = nombre.lastIndexOf(".");
  if (i < 0) return "";
  const ext = nombre.slice(i + 1).toLowerCase();
  return Object.hasOwn(LENGUAJES, ext) ? LENGUAJES[ext] : "";
}

// Cita lista para pegar en Markdown: enlace con el rango y bloque de código. null si los datos no son válidos.
export function citaMarkdown({ file, start, end, lines, truncated, href } = {}) {
  if (typeof file !== "string" || typeof href !== "string" || !href.startsWith("https://github.com/")) return null;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l === "string")) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) return null;
  const rango = start === end ? `L${start}` : `L${start}-L${end}`;
  const etiqueta = `${file}:${rango}`.replace(/[\\\[\]]/g, (c) => "\\" + c);
  const url = href.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\s/g, "%20");
  const racha = Math.max(0, ...lines.flatMap((l) => (l.match(/`+/g) ?? []).map((r) => r.length)));
  const fence = "`".repeat(Math.max(3, racha + 1));
  return `[${etiqueta}](${url})\n\n${fence}${lenguajeDe(file)}\n${lines.join("\n")}${truncated ? "\n…" : ""}\n${fence}\n`;
}
