// Página "Novedades" y el "hace N días" de cada página de la wiki.
import type { PageInfo } from "./data";

export interface Novedad {
  route: string;
  title: string;
  updated: string;
  author: string | null;
  commit: string | null;
  commitUrl: string | null;
}

// Más recientes primero, comparando fechas reales (con zonas horarias distintas el texto no ordena bien).
export function novedades(pages: PageInfo[], repoUrl: string, limit = 20): Novedad[] {
  return pages
    .filter((p) => p.type !== "meta" && p.updated && !Number.isNaN(Date.parse(p.updated)))
    .sort((a, b) => Date.parse(b.updated!) - Date.parse(a.updated!) || a.title.localeCompare(b.title, "es"))
    .slice(0, limit)
    .map((p) => ({
      route: p.route,
      title: p.title,
      updated: p.updated!,
      author: p.author,
      commit: p.commit ?? null,
      commitUrl: p.commit ? `${repoUrl}/commit/${p.commit}` : null,
    }));
}

// "hoy", "ayer", "hace N días"; vacío si la fecha falta o no es válida. Una fecha futura (reloj desfasado) cuenta como hoy.
export function haceDias(iso: string | null | undefined, now: Date | number = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "";
  const dias = Math.floor((+now - t) / 864e5);
  if (dias <= 0) return "hoy";
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}
