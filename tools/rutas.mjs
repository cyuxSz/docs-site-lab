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

// --- Mini tutoriales: openwiki/rutas/<slug>.md ---
export const DISCIPLINAS_TUTORIAL = ["software", "electronica", "mecanica"];
const SLUG_HARDWARE = /^[a-z0-9][a-z0-9-]*$/;
const PARAMS_GRAFO = ["config", "node", "seccion"];

// Resuelve un destino relativo a una página .md existente de openwiki/. Devuelve { route, page } o { error }.
function resolverWiki(dest, { project, pages, from }) {
  const hash = dest.indexOf("#");
  const target = hash < 0 ? dest : dest.slice(0, hash);
  const anchor = hash < 0 ? "" : dest.slice(hash);
  if (!target) return { error: "no apunta a una página" };
  const abs = posix.normalize(posix.join(posix.dirname(`openwiki/${from}`), target));
  if (!abs.startsWith("openwiki/")) return { error: "apunta fuera de openwiki/" };
  const page = abs.slice("openwiki/".length).replace(/(^|\/)$/, "$1index.md");
  if (!pages.includes(page)) return { error: `apunta a una página que no existe (${page})` };
  return { route: pageRoute(project, page) + anchor.replace(/[^#\w\-.%]/g, ""), page };
}

// Enlace de un paso: wiki, grafo: o hardware:. Devuelve { enlace } o { error }.
function resolverEnlace(texto, opts) {
  const m = texto.trim().match(/^\[([^\]]+)\]\((.+)\)$/);
  if (!m) return { error: "el enlace no tiene la forma [texto](destino)" };
  const [, etiqueta, dest] = m;
  const { project } = opts;
  if (/^grafo:/i.test(dest)) {
    const q = dest.slice(dest.indexOf(":") + 1);
    if (!q.startsWith("?")) return { error: "el enlace grafo: debe ser grafo:?node=…" };
    const src = new URLSearchParams(q.slice(1));
    const out = new URLSearchParams();
    for (const k of new Set(src.keys())) {
      if (!PARAMS_GRAFO.includes(k)) return { error: `el enlace grafo: usa un parámetro no permitido (${k.slice(0, 20)})` };
    }
    for (const k of PARAMS_GRAFO) {
      const v = src.get(k);
      if (v) out.set(k, v);
    }
    if (![...out.keys()].length) return { error: "el enlace grafo: no trae parámetros" };
    return { enlace: { tipo: "grafo", href: `/${project}/grafo/?${out.toString()}`, texto: etiqueta } };
  }
  if (/^hardware:/i.test(dest)) {
    const m2 = dest.slice("hardware:".length).match(/^([a-z0-9-]+)\/([^/?#]+)$/);
    if (!m2) return { error: "el enlace hardware: debe ser hardware:<disciplina>/<slug>" };
    const [, disc, slug] = m2;
    if (!(opts.disciplinas ?? []).includes(disc)) return { error: `la disciplina ${disc} no está configurada en el proyecto` };
    if (!SLUG_HARDWARE.test(slug)) return { error: "el slug de hardware no es válido" };
    return { enlace: { tipo: "hardware", href: `/${project}/${disc}/?p=${slug}`, texto: etiqueta } };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(dest) || dest.startsWith("//")) return { error: "es un enlace externo o con esquema no permitido" };
  const r = resolverWiki(dest, opts);
  if (r.error) return { error: r.error };
  return { enlace: { tipo: "wiki", href: r.route, texto: etiqueta } };
}

const limpiarValor = (v) => (v == null ? "" : String(v).replace(/\s+#.*$/, "").trim());

// meta: frontmatter ya separado (title, description, disciplina, rol). Devuelve { tutorial|null, avisos }.
export function parseTutorial(body, { project, pages, from, meta = {}, disciplinas = [], roles = [] }) {
  const avisos = [];
  const id = from.replace(/^.*\//, "").replace(/\.md$/, "");
  const disciplina = limpiarValor(meta.disciplina);
  if (!DISCIPLINAS_TUTORIAL.includes(disciplina)) {
    avisos.push(`Tutorial ${id}: falta la disciplina o no es válida (software, electronica o mecanica); no se muestra.`);
    return { tutorial: null, avisos };
  }
  let rol = limpiarValor(meta.rol) || null;
  if (rol && !roles.includes(rol)) {
    avisos.push(`Tutorial ${id}: el rol "${rol.slice(0, 40)}" no existe en rutas.md; sale sin rol.`);
    rol = null;
  }
  const pasos = [];
  const usados = new Map();
  const bloques = body.split(/^##\s+Paso:\s*/m).slice(1);
  for (const bloque of bloques) {
    const [primera, ...resto] = bloque.split(/\r?\n/);
    const titulo = primera.trim();
    const campos = {};
    for (const l of resto) {
      const c = l.match(/^(Objetivo|Enlace|Hecho cuando):\s*(.*)$/);
      if (c && campos[c[1]] === undefined) campos[c[1]] = c[2].trim();
    }
    const falta = ["Objetivo", "Enlace", "Hecho cuando"].filter((k) => !campos[k]);
    if (!titulo || falta.length) {
      avisos.push(`Tutorial ${id}, paso "${titulo.slice(0, 60)}": falta ${falta.join(", ") || "el título"} y se ignora.`);
      continue;
    }
    const r = resolverEnlace(campos.Enlace, { project, pages, from: `rutas/${id}.md`, disciplinas });
    if (r.error) {
      avisos.push(`Tutorial ${id}, paso "${titulo.slice(0, 60)}": ${r.error} y se ignora.`);
      continue;
    }
    const base = slugRol(titulo) || "paso";
    const n = (usados.get(base) ?? 0) + 1;
    usados.set(base, n);
    pasos.push({ id: n === 1 ? base : `${base}-${n}`, titulo, objetivo: campos.Objetivo, enlace: r.enlace, hecho: campos["Hecho cuando"] });
  }
  if (!pasos.length) {
    avisos.push(`Tutorial ${id}: no tiene pasos válidos y no se muestra.`);
    return { tutorial: null, avisos };
  }
  const h1 = body.match(/^#\s+(.+?)\s*$/m);
  const page = `rutas/${id}.md`;
  return {
    tutorial: {
      id,
      titulo: String(meta.title || h1?.[1] || id),
      descripcion: String(meta.description || ""),
      rol,
      disciplina,
      page,
      route: pageRoute(project, page),
      pasos,
    },
    avisos,
  };
}
