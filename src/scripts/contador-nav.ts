// Contador de comentarios abiertos junto a cada enlace de la SideNav. Una sola petición por carga, con caché de 60 s en
// sessionStorage. Errores y 403: sin badges, en silencio. En la página del panel no pide: lo pinta panel-comentarios.ts.
import { claveCacheNav, contadoresNav, escribirCacheNav, etiquetaContador, leerCacheNav, urlProyecto } from "../lib/comentarios";

// Reemplaza los badges de todas las SideNav del proyecto. El hueco lo reserva el CSS, así que no mueve el layout.
export function pintarBadges(proyecto: string, contadores: Record<string, number>) {
  for (const nav of document.querySelectorAll<HTMLElement>("nav.sidenav[data-proyecto]")) {
    if (nav.dataset.proyecto !== proyecto) continue;
    nav.querySelectorAll(".nav-contador").forEach((b) => b.remove());
    for (const a of nav.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const n = contadores[new URL(a.href, location.href).pathname];
      if (!n || a.closest(".extra")) continue;
      const badge = document.createElement("span");
      badge.className = "nav-contador";
      badge.setAttribute("role", "img");
      badge.setAttribute("aria-label", etiquetaContador(n));
      badge.textContent = `💬 ${n}`;
      a.append(badge);
    }
  }
}

export function guardarCache(proyecto: string, contadores: Record<string, number>) {
  try {
    sessionStorage.setItem(claveCacheNav(proyecto), escribirCacheNav(contadores));
  } catch {
    /* sessionStorage no disponible */
  }
}

async function iniciar() {
  const nav = document.querySelector<HTMLElement>("nav.sidenav[data-proyecto]");
  const proyecto = nav?.dataset.proyecto;
  if (!proyecto || document.querySelector("[data-panel-comentarios]")) return;

  let cache: Record<string, number> | null = null;
  try {
    cache = leerCacheNav(sessionStorage.getItem(claveCacheNav(proyecto)));
  } catch {
    /* sessionStorage no disponible */
  }
  if (cache) return pintarBadges(proyecto, cache);

  try {
    const res = await fetch(urlProyecto(proyecto), { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return;
    const contadores = contadoresNav(await res.json());
    guardarCache(proyecto, contadores);
    pintarBadges(proyecto, contadores);
  } catch {
    /* sin badges */
  }
}

void iniciar();
