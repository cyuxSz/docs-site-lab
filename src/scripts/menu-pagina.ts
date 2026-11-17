// Menú "⋯" de la página de la wiki y colocación de la línea de metadatos bajo el título. La lógica está en src/lib/menu-pagina.ts.
import { menuPagina } from "../lib/menu-pagina.ts";

// La línea viene en el artículo (sin JS queda encima del título): se mueve tras el H1 o la fila del título (estrella).
const linea = document.querySelector<HTMLElement>("[data-pagina-meta]");
if (linea) {
  const ancla = document.querySelector<HTMLElement>(".prose .titulo-pagina") ?? document.querySelector<HTMLElement>(".prose h1");
  if (ancla) ancla.after(linea);
}

const btn = document.querySelector<HTMLButtonElement>("[data-pagina-menu-btn]");
const panel = document.getElementById("pagina-menu");
if (btn && panel) {
  // Solo con el script listo se oculta el panel y se muestra el botón (sin JS el panel queda visible).
  btn.parentElement?.setAttribute("data-js", "");
  let abierto = false;
  const aplicar = (a: boolean) => {
    abierto = a;
    btn.setAttribute("aria-expanded", String(a));
    panel.hidden = !a;
  };
  const evento = (ev: string) => {
    const r = menuPagina(abierto, ev);
    if (!r) return false;
    aplicar(r.abierto);
    if (r.foco === "primero") panel.querySelector<HTMLElement>("a[href]")?.focus();
    else if (r.foco === "boton") btn.focus();
    return true;
  };

  btn.addEventListener("click", () => evento("alternar"));
  document.addEventListener("click", (e) => {
    const t = e.target as Node;
    if (!btn.contains(t) && !panel.contains(t)) evento("fuera");
  });
  // En captura y con stopPropagation: el Escape que cierra el menú no llega al de las barras (no sale del modo lectura).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || e.repeat) return;
      if (evento("escape")) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  // El foco que sale del botón y del panel (Tab) cierra el menú sin mover el foco.
  document.addEventListener("focusin", (e) => {
    const t = e.target as Node;
    if (abierto && !btn.contains(t) && !panel.contains(t)) evento("salir");
  });
}
