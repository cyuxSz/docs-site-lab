// Grupos plegables de la SideNav: aplica lo guardado al cargar y guarda cada cambio. localStorage siempre envuelto.
import { filtroEcoToggle, grupoAbierto, guardarGrupo, leerGrupos } from "../lib/nav-grupos";
import type { AlmacenBarras } from "../lib/barras";

const alm: AlmacenBarras = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* bloqueado */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* bloqueado */
    }
  },
};

document.querySelectorAll<HTMLElement>(".sidenav[data-proyecto]").forEach((nav) => {
  const proyecto = nav.dataset.proyecto ?? "";
  const detalles = [...nav.querySelectorAll<HTMLDetailsElement>("details[data-nav-grupo]")];
  // El servidor ya abrió el grupo de la página actual (atributo open); de ahí sale `actual`.
  const actual = detalles.find((d) => d.open)?.dataset.navGrupo ?? null;
  const guardado = leerGrupos(alm, proyecto);
  for (const d of detalles) {
    const aplicado = grupoAbierto(d.dataset.navGrupo ?? "", actual, guardado);
    const guardar = filtroEcoToggle(aplicado);
    d.open = aplicado;
    // Solo los cambios del usuario se guardan: el eco asíncrono de `open` al cargar se ignora.
    d.addEventListener("toggle", () => {
      if (guardar(d.open)) guardarGrupo(alm, proyecto, d.dataset.navGrupo ?? "", d.open);
    });
  }
});
