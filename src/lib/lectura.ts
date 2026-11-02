// QoL de lectura, lógica pura (sin document, window ni localStorage): búsquedas recientes y sugerencias, términos a
// resaltar, tiempo de lectura, nivel de la página y ajustes de letra y ancho. El almacén se inyecta (rutas.ts).
import type { Almacen } from "./rutas";

// --- Búsquedas recientes ---
export const CLAVE_RECIENTES = "busqueda:recientes";
export const MAX_RECIENTES = 5;
export const MAX_TERMINO = 80;
export const PARAM_RESALTADO = "q";

export function limpiarTermino(x: unknown): string {
  if (typeof x !== "string") return "";
  const t = x
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERMINO)
    .trim();
  return t.length < 2 ? "" : t;
}

function unicos(lista: unknown[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const v of lista) {
    const t = limpiarTermino(v);
    const k = t.toLowerCase();
    if (!t || vistos.has(k)) continue;
    vistos.add(k);
    out.push(t);
    if (out.length >= MAX_RECIENTES) break;
  }
  return out;
}

// El almacén no es confiable: JSON roto, tipos raros o demasiados elementos se normalizan.
export function recientes(alm: Almacen): string[] {
  try {
    const v = JSON.parse(alm.get(CLAVE_RECIENTES) ?? "[]");
    return Array.isArray(v) ? unicos(v) : [];
  } catch {
    return [];
  }
}

export function agregarReciente(alm: Almacen, t: string): string[] {
  const limpio = limpiarTermino(t);
  const actuales = recientes(alm);
  if (!limpio) return actuales;
  const lista = unicos([limpio, ...actuales]);
  alm.set(CLAVE_RECIENTES, JSON.stringify(lista));
  return lista;
}

export function borrarRecientes(alm: Almacen): void {
  alm.remove(CLAVE_RECIENTES);
}

// --- Sugerencias ---
export const SUGERIDAS = ["quickstart.md", "onboarding.md", "architecture/overview.md", "operations/estado.md", "glosario.md", "rutas.md"];

export interface Sugerencia {
  title: string;
  route: string;
}
interface PaginaMin {
  path: string;
  route: string;
  title: string;
  type: string;
}

export function sugerenciasBusqueda(pages: PaginaMin[], max = 6): Sugerencia[] {
  const out: Sugerencia[] = [];
  const vistas = new Set<string>();
  const poner = (p: PaginaMin | undefined) => {
    if (!p || p.type === "meta" || vistas.has(p.path)) return;
    vistas.add(p.path);
    out.push({ title: p.title, route: p.route });
  };
  for (const s of SUGERIDAS) poner(pages.find((p) => p.path === s));
  for (const p of pages) if (p.type === "index" && p.path !== "index.md") poner(p);
  return out.slice(0, max);
}

// --- Resaltado ---
export function terminosResaltado(q: string | null | undefined): string[] {
  if (typeof q !== "string") return [];
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const w of q.split(/\s+/)) {
    const t = w.slice(0, MAX_TERMINO);
    if (t.length < 2 || vistos.has(t.toLowerCase())) continue;
    vistos.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

const plegarCar = (c: string) => c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Pliega el texto carácter por carácter y guarda a qué carácter original corresponde cada unidad plegada.
function plegar(texto: string) {
  let s = "";
  const origen: number[] = []; // índice plegado -> inicio del carácter original
  const fin: number[] = []; // índice plegado -> fin del carácter original
  let i = 0;
  for (const c of texto) {
    const f = plegarCar(c);
    for (let k = 0; k < f.length; k++) {
      origen.push(i);
      fin.push(i + c.length);
    }
    s += f;
    i += c.length;
  }
  return { s, origen, fin };
}

export function coincidencias(texto: string, terminos: string[]): Array<[number, number]> {
  if (!texto || !terminos.length) return [];
  const { s, origen, fin } = plegar(texto);
  const todas: Array<[number, number]> = [];
  for (const t of terminos) {
    const f = plegar(t).s;
    if (!f) continue;
    let desde = 0;
    for (;;) {
      const i = s.indexOf(f, desde);
      if (i < 0) break;
      todas.push([origen[i], fin[i + f.length - 1]]);
      desde = i + 1;
    }
  }
  // En la misma posición gana el término más largo; luego se descartan los que se solapan.
  todas.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Array<[number, number]> = [];
  let tope = 0;
  for (const m of todas) {
    if (m[0] < tope) continue;
    out.push(m);
    tope = m[1];
  }
  return out;
}

// --- Tiempo de lectura ---
export const PALABRAS_POR_MINUTO = 200;

export function contarPalabras(md: string): number {
  let dentro = false;
  let marca = "";
  const lineas: string[] = [];
  for (const l of (md ?? "").split(/\r?\n/)) {
    const m = l.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!dentro) {
        dentro = true;
        marca = m[1][0];
      } else if (m[1][0] === marca) dentro = false;
      continue;
    }
    if (!dentro) lineas.push(l);
  }
  const limpio = lineas
    .join("\n")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\]\([^)\s]*(?:\s+"[^"]*")?\)/g, "] ")
    .replace(/(?:https?:\/\/|www\.)\S+/g, " ");
  return limpio.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export const minutosLectura = (md: string): number => Math.max(1, Math.ceil(contarPalabras(md) / PALABRAS_POR_MINUTO));

// --- Nivel ---
export const UMBRAL_CITAS = 5;

export interface Nivel {
  nivel: "basico" | "avanzado";
  etiqueta: "Básico" | "Avanzado";
  fuente: "frontmatter" | "heuristica";
}
const BASICO = { nivel: "basico", etiqueta: "Básico" } as const;
const AVANZADO = { nivel: "avanzado", etiqueta: "Avanzado" } as const;

/**
 * Nivel de una página. Heurística, en este orden:
 * 1. `level` del frontmatter (trim, minúsculas, sin acentos) igual a `basico` o `avanzado`: manda el frontmatter.
 * 2. Está en una ruta por rol (`enRuta`): Básico.
 * 3. `type` es guide, index o meta, o `path` es quickstart.md, onboarding.md, glosario.md, rutas.md o index.md: Básico.
 * 4. `type` es package, component o reference, o `path` empieza con `packages/`, y `claims >= UMBRAL_CITAS`: Avanzado.
 * 5. Cualquier otro caso: Básico.
 */
export function nivelPagina(d: { level?: string | null; type?: string; path?: string; claims?: number; enRuta?: boolean }): Nivel {
  const lv = typeof d.level === "string" ? plegar(d.level.trim()).s : "";
  if (lv === "basico") return { ...BASICO, fuente: "frontmatter" };
  if (lv === "avanzado") return { ...AVANZADO, fuente: "frontmatter" };
  const type = d.type ?? "";
  const path = d.path ?? "";
  if (d.enRuta) return { ...BASICO, fuente: "heuristica" };
  if (["guide", "index", "meta"].includes(type) || ["quickstart.md", "onboarding.md", "glosario.md", "rutas.md", "index.md"].includes(path)) return { ...BASICO, fuente: "heuristica" };
  if ((["package", "component", "reference"].includes(type) || path.startsWith("packages/")) && (d.claims ?? 0) >= UMBRAL_CITAS) return { ...AVANZADO, fuente: "heuristica" };
  return { ...BASICO, fuente: "heuristica" };
}

// --- Ajustes de lectura ---
export const CLAVE_LETRA = "lectura:letra";
export const CLAVE_ANCHO = "lectura:ancho";
export const LETRAS = ["s", "m", "l"] as const;
export const ANCHOS = ["estrecho", "normal", "ancho"] as const;
export type Letra = (typeof LETRAS)[number];
export type Ancho = (typeof ANCHOS)[number];

export const normalizarLetra = (v: unknown): Letra => ((LETRAS as readonly unknown[]).includes(v) ? (v as Letra) : "m");
export const normalizarAncho = (v: unknown): Ancho => ((ANCHOS as readonly unknown[]).includes(v) ? (v as Ancho) : "normal");

// --- Ancla de la URL ---
// Quita el "#" inicial y decodifica; una ancla mal formada (%E0%A4%A) no debe romper el script.
export function decodificarAncla(hash: unknown): string {
  if (typeof hash !== "string") return "";
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return "";
  }
}

// URL del enlace "Ver glosario" (viene de un atributo data-*, no confiable): solo http(s) absoluta o ruta interna "/x".
export function enlaceGlosario(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw || /[\s\u0000-\u001f\u007f-\u009f]/u.test(raw)) return null;
  if (raw.startsWith("/")) return raw[1] === "/" || raw[1] === "\\" ? null : raw;
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? raw : null;
  } catch {
    return null;
  }
}
