// Rutas por rol: convierte openwiki/rutas.md en rutas de lectura. Puro: sin efectos al importarse (lo usa tools/fetch.mjs).
//   ## <Rol>                      abre una ruta
//   N. [Título](destino#ancla): nota   es un paso
import { posix } from "node:path";

// Ruta de una página en el portal: openwiki/packages/index.md -> /<id>/packages/
export function pageRoute(id, rel) {
  // El index.md raíz de la wiki es el resumen de Software (la carátula de /<id>/ no sale de la wiki).
  if (rel === "index.md") return `/${id}/software/`;
  const slug = rel.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
  return `/${id}/${slug ? `${slug}/` : ""}`;
}

// Id ASCII en minúsculas, sin acentos y con guiones.
export function slugRol(nombre) {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseRutas(body, { project, pages, from = "rutas.md" }) {
  const known = new Set(pages);
  const avisos = [];
  const roles = [];
  let actual = null;
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (h) {
      actual = { id: slugRol(h[1]), nombre: h[1], pasos: [] };
      roles.push(actual);
      continue;
    }
    const item = line.match(/^\s*\d+\.\s+(.*)$/);
    if (!item || !actual) continue;
    const m = item[1].match(/^\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/);
    if (!m) {
      avisos.push(`Rol ${actual.nombre}: paso sin enlace ignorado ("${item[1].slice(0, 60)}").`);
      continue;
    }
    const [, title, dest, nota = ""] = m;
    if (/^(https?:|mailto:)/i.test(dest)) {
      avisos.push(`Rol ${actual.nombre}: "${title}" es un enlace externo y se ignora.`);
      continue;
    }
    const hash = dest.indexOf("#");
    const target = hash < 0 ? dest : dest.slice(0, hash);
    const anchor = hash < 0 ? "" : dest.slice(hash);
    const abs = posix.normalize(posix.join(posix.dirname(`openwiki/${from}`), target));
    if (!target || !abs.startsWith("openwiki/")) {
      avisos.push(`Rol ${actual.nombre}: "${title}" apunta fuera de openwiki/ y se ignora.`);
      continue;
    }
    const page = abs.slice("openwiki/".length).replace(/(^|\/)$/, "$1index.md");
    if (!known.has(page)) {
      avisos.push(`Rol ${actual.nombre}: "${title}" apunta a una página que no existe (${page}) y se ignora.`);
      continue;
    }
    actual.pasos.push({ route: pageRoute(project, page) + anchor, page, title, nota: nota.trim() });
  }
  const rutas = [];
  for (const r of roles) {
    if (r.pasos.length) rutas.push(r);
    else avisos.push(`Rol ${r.nombre}: no tiene pasos válidos y no se muestra.`);
  }
  return { rutas, avisos };
}
