// Títulos legibles: una página cuyo título es solo el nombre de su carpeta/archivo ("architecture") se humaniza.
// Los nombres de paquete con guion bajo (uuv_vision) son legítimos y no se tocan.

export const DICCIONARIO = {
  architecture: "Arquitectura",
  packages: "Paquetes",
  operations: "Operación",
};

const CRUDO = /^[a-z]+(-[a-z]+)*$/;

function slugDe(rel) {
  const partes = String(rel).split("/");
  const archivo = partes[partes.length - 1].replace(/\.md$/, "");
  return archivo === "index" && partes.length > 1 ? partes[partes.length - 2] : archivo;
}

export function esTituloCrudo(titulo, rel) {
  const slug = slugDe(rel);
  return typeof titulo === "string" && titulo === slug && CRUDO.test(slug);
}

export function humanizar(slug) {
  if (Object.hasOwn(DICCIONARIO, slug)) return DICCIONARIO[slug];
  const t = String(slug).replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const H1 = /^#[ \t]+(.+?)[ \t]*$/m;

export function tituloPagina(fields, body, rel) {
  const fm = (fields?.title ?? "").trim();
  if (fm && !esTituloCrudo(fm, rel)) return fm;
  const h1 = (body.match(H1) || [])[1];
  if (h1 && !esTituloCrudo(h1, rel)) return h1;
  return humanizar(slugDe(rel));
}

export function corregirH1(body, titulo, rel) {
  const m = body.match(H1);
  if (!m || !esTituloCrudo(m[1], rel)) return body;
  return body.slice(0, m.index) + `# ${titulo}` + body.slice(m.index + m[0].length);
}
