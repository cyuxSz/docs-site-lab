// QoL de navegación personal: última visita, favoritos y aviso de cambios. Puro: el almacén se inyecta y nunca lanza.
// Todo lo que se lee del almacén se trata como no confiable: las rutas deben ser internas del proyecto.
import type { Almacen } from "./rutas.ts";

export interface Visita {
  route: string;
  title: string;
  scroll: number;
}
export interface Favorito {
  route: string;
  title: string;
}

export const MAX_FAVORITOS = 50;

export const claveUltima = (p: string) => `personal:${p}:ultima`;
export const claveFavoritos = (p: string) => `personal:${p}:favoritos`;
export const claveVisto = (p: string, route: string) => `personal:${p}:visto:${route}`;

// Decodifica en rondas (tope 5) hasta estabilizar; null si hay escape mal formado o no se estabiliza.
// Copia de la lógica de access.config.js (canAccess). No se importa de allí: este archivo va al bundle del cliente y
// expondría los logins de RESTRICTED. Si cambia una, cambia la otra.
function decodificar(ruta: string): string | null {
  let actual = ruta;
  try {
    for (let i = 0; i < 5; i++) {
      const sig = decodeURIComponent(actual);
      if (sig === actual) return actual;
      actual = sig;
    }
    return decodeURIComponent(actual) === actual ? actual : null;
  } catch {
    return null;
  }
}

// Ruta interna del proyecto: "/<p>/..." sin "//", sin esquemas ni barras invertidas ni caracteres de control, y que
// tampoco los tenga (ni ".." ni "//") una vez decodificada.
const rutaValida = (p: string, route: unknown): route is string => {
  if (typeof route !== "string" || !route.startsWith(`/${p}/`) || route.startsWith("//") || /[\\\u0000-\u001f]/u.test(route)) return false;
  const d = decodificar(route);
  if (d === null || d.includes("//") || /[\\\u0000-\u001f]/u.test(d)) return false;
  return !d.split("/").includes("..");
};

const parsear = (s: string | null): unknown => {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const acotar = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function guardarVisita(alm: Almacen, p: string, v: Visita) {
  if (!rutaValida(p, v.route) || typeof v.title !== "string") return;
  alm.set(claveUltima(p), JSON.stringify({ route: v.route, title: v.title, scroll: acotar(v.scroll) }));
}

export function ultimaVisita(alm: Almacen, p: string): Visita | null {
  const v = parsear(alm.get(claveUltima(p)));
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const { route, title, scroll } = v as Record<string, unknown>;
  if (!rutaValida(p, route) || typeof title !== "string") return null;
  return { route, title, scroll: acotar(scroll) };
}

export function fraccionScroll(y: number, altoDoc: number, altoVista: number): number {
  const max = altoDoc - altoVista;
  if (!(max > 0) || !Number.isFinite(y)) return 0;
  return Math.round(Math.min(1, Math.max(0, y / max)) * 100) / 100;
}
export function posicionScroll(f: number, altoDoc: number, altoVista: number): number {
  const max = altoDoc - altoVista;
  return max > 0 ? Math.round(acotar(f) * max) : 0;
}

export const urlContinuar = (v: Visita) => `${v.route}?continuar=1`;
export function debeRestaurar(v: Visita | null, pathname: string, search: string): boolean {
  return v !== null && v.route === pathname && new URLSearchParams(search).get("continuar") === "1" && v.scroll > 0;
}

// --- Favoritos ---
export function favoritos(alm: Almacen, p: string): Favorito[] {
  const l = parsear(alm.get(claveFavoritos(p)));
  if (!Array.isArray(l)) return [];
  const vistos = new Set<string>();
  const out: Favorito[] = [];
  for (const f of l) {
    if (!f || typeof f !== "object") continue;
    const { route, title } = f as Record<string, unknown>;
    if (!rutaValida(p, route) || typeof title !== "string" || vistos.has(route)) continue;
    vistos.add(route);
    out.push({ route, title });
    if (out.length >= MAX_FAVORITOS) break;
  }
  return out;
}
const guardarFavoritos = (alm: Almacen, p: string, l: Favorito[]) => alm.set(claveFavoritos(p), JSON.stringify(l));

export const esFavorito = (alm: Almacen, p: string, route: string) => favoritos(alm, p).some((f) => f.route === route);

export function alternarFavorito(alm: Almacen, p: string, f: Favorito): boolean {
  const l = favoritos(alm, p);
  if (l.some((x) => x.route === f.route)) {
    guardarFavoritos(alm, p, l.filter((x) => x.route !== f.route));
    return false;
  }
  if (!rutaValida(p, f.route) || typeof f.title !== "string") return false;
  guardarFavoritos(alm, p, [...l, { route: f.route, title: f.title }].slice(-MAX_FAVORITOS));
  return true;
}

export function quitarFavorito(alm: Almacen, p: string, route: string) {
  const l = favoritos(alm, p);
  if (l.some((x) => x.route === route)) guardarFavoritos(alm, p, l.filter((x) => x.route !== route));
}

// --- Cambió desde tu última visita ---
export const firmaPagina = (updated?: string | null, commit?: string | null): string => commit || updated || "";

export function revisarCambio(alm: Almacen, p: string, route: string, firma: string): boolean {
  if (!firma) return false;
  const k = claveVisto(p, route);
  const previa = alm.get(k);
  alm.set(k, firma);
  return previa !== null && previa !== firma;
}
