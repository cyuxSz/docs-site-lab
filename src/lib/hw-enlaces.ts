// Enlaces entre los nodos hw:* del grafo ROS y las páginas de hardware (Electrónica / Mecánica). Lógica pura, sin DOM.
// El mapa sale de projects.json → hwPaginas ({"hw:zed": "electronica/sensores-actuadores"}); el build lo valida y avisa.
import { urlPagina } from "./hardware-editor.ts";

// <disciplina>/<slug>, con el mismo slug que valida la API de hardware.
export const HW_PAGINA = /^([a-z][a-z0-9-]*)\/([a-z0-9-]{1,60})$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
// Solo enlaces internos al grafo con ?node=; nada de javascript: ni //host.
const HREF_NODO = /^\/[A-Za-z0-9_-]+\/grafo\/\?node=[A-Za-z0-9%._~!*'()-]+$/;

const ETIQUETAS: Record<string, string> = { electronica: "Electrónica", mecanica: "Mecánica" };
const nombreDisciplina = (d: string) => ETIQUETAS[d] ?? d.charAt(0).toUpperCase() + d.slice(1);

export interface EnlaceHw {
  disciplina: string;
  slug: string;
  href: string;
  etiqueta: string;
}
export interface NodoUso {
  id: string;
  label: string;
  href: string;
  plan?: true;
}
export interface UsoHw {
  id: string;
  label: string;
  nodos: NodoUso[];
}

interface RosMin {
  nodes: { id: string; label?: string; category: string }[];
  edges: { source: string; target: string; kind: string }[];
}

const es = (a: string, b: string) => a.localeCompare(b, "es");

export function enlacesHardware(
  p: { id: string; disciplinas?: unknown; hwPaginas?: unknown },
  nodos: { id: string; category: string }[],
): { enlaces: Record<string, EnlaceHw>; avisos: string[] } {
  const avisos: string[] = [];
  const out = new Map<string, EnlaceHw>();
  const raw = p.hwPaginas;
  if (raw === undefined || raw === null) return { enlaces: {}, avisos };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { enlaces: {}, avisos: [`${p.id}: hwPaginas debe ser un objeto { "hw:id": "<disciplina>/<slug>" }; se ignora.`] };
  }
  const discs = p.disciplinas && typeof p.disciplinas === "object" ? (p.disciplinas as Record<string, unknown>) : {};
  const hw = new Set(nodos.filter((n) => n.category === "hardware").map((n) => n.id));
  for (const [id, valor] of Object.entries(raw as Record<string, unknown>)) {
    const aviso = (motivo: string) => avisos.push(`${p.id}: hwPaginas "${id}" se ignora (${motivo}).`);
    if (!hw.has(id)) {
      aviso("no es un nodo de hardware de ros.json");
      continue;
    }
    const m = typeof valor === "string" ? HW_PAGINA.exec(valor) : null;
    if (!m) {
      aviso("debe ser texto con el formato <disciplina>/<slug>");
      continue;
    }
    const [, disciplina, slug] = m;
    if (!Object.hasOwn(discs, disciplina)) {
      aviso(`la disciplina "${disciplina}" no está configurada`);
      continue;
    }
    out.set(id, { disciplina, slug, href: urlPagina(p.id, disciplina, slug), etiqueta: `Ver en ${nombreDisciplina(disciplina)}` });
  }
  return { enlaces: Object.fromEntries(out), avisos };
}

// Por slug de la disciplina: cada hw:* enlazado con los nodos ROS que lo tocan (en cualquier dirección).
export function usadoPor(idProyecto: string, ros: RosMin | null | undefined, enlaces: Record<string, EnlaceHw>, disciplina: string): Record<string, UsoHw[]> {
  if (!ros) return {};
  const porId = new Map(ros.nodes.map((n) => [n.id, n]));
  const res = new Map<string, UsoHw[]>();
  for (const [id, enlace] of Object.entries(enlaces)) {
    if (enlace.disciplina !== disciplina) continue;
    const pieza = porId.get(id);
    if (!pieza) continue;
    // vecino → true si todas las aristas que lo unen con la pieza son plan
    const vecinos = new Map<string, boolean>();
    for (const e of ros.edges) {
      const otro = e.source === id ? e.target : e.target === id ? e.source : null;
      if (otro === null || porId.get(otro)?.category !== "ros2_node") continue;
      vecinos.set(otro, (vecinos.get(otro) ?? true) && e.kind === "plan");
    }
    const nodos: NodoUso[] = [...vecinos].map(([nid, soloPlan]) => ({
      id: nid,
      label: porId.get(nid)!.label ?? nid,
      href: `/${idProyecto}/grafo/?node=${encodeURIComponent(nid)}`,
      ...(soloPlan ? { plan: true as const } : {}),
    }));
    nodos.sort((a, b) => es(a.label, b.label));
    const lista = res.get(enlace.slug) ?? [];
    lista.push({ id, label: pieza.label ?? id, nodos });
    res.set(enlace.slug, lista);
  }
  for (const l of res.values()) l.sort((a, b) => es(a.label, b.label));
  return Object.fromEntries(res);
}

// Cliente: lee el atributo data-hw-usado-por y devuelve, ya saneada, la lista de la página. Nunca lanza.
export function usoDePagina(texto: string | null | undefined, slug: string): UsoHw[] {
  if (typeof texto !== "string" || !SLUG.test(slug)) return [];
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!datos || typeof datos !== "object" || Array.isArray(datos) || !Object.hasOwn(datos, slug)) return [];
  const lista = (datos as Record<string, unknown>)[slug];
  if (!Array.isArray(lista)) return [];
  const salida: UsoHw[] = [];
  for (const u of lista as any[]) {
    if (!u || typeof u !== "object" || typeof u.id !== "string" || typeof u.label !== "string" || !Array.isArray(u.nodos)) continue;
    const nodos: NodoUso[] = [];
    for (const n of u.nodos as any[]) {
      if (!n || typeof n !== "object" || typeof n.id !== "string" || typeof n.label !== "string" || typeof n.href !== "string" || !HREF_NODO.test(n.href)) continue;
      nodos.push({ id: n.id, label: n.label, href: n.href, ...(n.plan === true ? { plan: true as const } : {}) });
    }
    salida.push({ id: u.id, label: u.label, nodos });
  }
  return salida;
}
