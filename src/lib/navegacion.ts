// Anterior/Siguiente y migas de la wiki, en el mismo orden y con las mismas etiquetas que la navegación lateral.
import { sections } from "./data.ts";
import type { PageInfo } from "./data";

export interface Enlace {
  route: string;
  label: string;
}

// Los índices se llaman "Resumen de <sección>" (igual que SideNav).
const etiqueta = (p: PageInfo, seccion: string) => (p.type === "index" ? `Resumen de ${seccion.toLowerCase()}` : p.title);

export function anteriorSiguiente(pages: PageInfo[], route: string): { prev: Enlace | null; next: Enlace | null } {
  const lista = sections(pages).flatMap((g) => g.pages.map((p) => ({ route: p.route, label: etiqueta(p, g.label) })));
  const i = lista.findIndex((x) => x.route === route);
  if (i < 0) return { prev: null, next: null };
  return { prev: lista[i - 1] ?? null, next: lista[i + 1] ?? null };
}

// Proyecto (carátula) › Software › sección (enlazada a su índice si existe y no es esta página) › página actual. "Empezar" no aparece.
export function migas(pages: PageInfo[], route: string, project: { id: string; name: string }): { label: string; href?: string }[] {
  const out: { label: string; href?: string }[] = [{ label: project.name, href: `/${project.id}/` }, { label: "Software", href: `/${project.id}/software/` }];
  for (const g of sections(pages)) {
    const actual = g.pages.find((p) => p.route === route);
    if (!actual) continue;
    const raiz = !actual.path.includes("/");
    if (raiz) {
      out.push({ label: actual.title });
      break;
    }
    const indice = g.pages.find((p) => p.type === "index");
    if (indice?.route === route) out.push({ label: g.label });
    else out.push(indice ? { label: g.label, href: indice.route } : { label: g.label }, { label: actual.title });
    break;
  }
  return out;
}
