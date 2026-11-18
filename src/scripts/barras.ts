// Barras laterales de la wiki: plegado en escritorio, cajones en móvil y modo enfoque. La lógica está en src/lib/barras.ts.
import { ANCHO_CAJON, anuncioLectura, barras, etiquetaBarra, guardarBarras, leerBarras, visible, type EstadoBarras, type EventoBarras, type Lado } from "../lib/barras.ts";
import { almacenSeguro } from "../lib/rutas.ts";

const hay = document.querySelector("[data-barra]");
if (hay) iniciar();

function iniciar() {
  const html = document.documentElement;
  const alm = almacenSeguro(() => localStorage);
  // Cada lado tiene el botón del riel (escritorio) y el de la cabecera (móvil); solo uno se ve a la vez.
  const botones: Record<Lado, HTMLButtonElement[]> = {
    izq: [...document.querySelectorAll<HTMLButtonElement>("[data-barra=izq]")],
    der: [...document.querySelectorAll<HTMLButtonElement>("[data-barra=der]")],
  };
  const velo = document.querySelector<HTMLElement>("[data-barras-velo]");
  const paneles: Record<Lado, HTMLElement | null> = { izq: document.getElementById("barra-izq"), der: document.getElementById("barra-der") };
  // El botón que el usuario ve (los ocultos con display:none no tienen caja).
  const botonVisible = (lado: Lado) => botones[lado].find((b) => b.offsetParent !== null) ?? botones[lado][0];

  const mq = window.matchMedia(`(max-width: ${ANCHO_CAJON - 0.02}px)`);
  let movil = mq.matches;
  let estado: EstadoBarras = { ...leerBarras(alm), enfoque: false, cajon: null };

  function aplicar() {
    if (estado.izqPlegada) html.dataset.barraIzq = "plegada";
    else delete html.dataset.barraIzq;
    if (estado.derPlegada) html.dataset.barraDer = "plegada";
    else delete html.dataset.barraDer;
    if (estado.enfoque) html.dataset.enfoque = "1";
    else delete html.dataset.enfoque;
    if (estado.cajon) html.dataset.cajon = estado.cajon;
    else delete html.dataset.cajon;
    for (const lado of ["izq", "der"] as const) {
      const etiqueta = etiquetaBarra(estado, lado, movil);
      for (const b of botones[lado]) {
        b.setAttribute("aria-expanded", String(visible(estado, lado, movil)));
        b.setAttribute("aria-label", etiqueta);
        b.setAttribute("title", etiqueta);
      }
    }
    if (velo) velo.hidden = !(movil && estado.cajon);
  }

  // `foco`: mover el foco al abrir o cerrar un cajón (no al cambiar de ancho ni al entrar en enfoque).
  function despachar(ev: EventoBarras, foco = true) {
    const antes = estado;
    estado = barras(antes, ev);
    if (estado === antes) return false;
    aplicar();
    const anuncio = anuncioLectura(antes, estado);
    const vivo = document.querySelector<HTMLElement>("[data-anuncio-lectura]");
    if (anuncio !== null && vivo) vivo.textContent = anuncio;
    if (!movil && ev.tipo !== "enfoque") guardarBarras(alm, estado);
    if (movil && foco && antes.cajon !== estado.cajon) {
      if (estado.cajon) paneles[estado.cajon]?.querySelector<HTMLElement>("a[href]")?.focus();
      else if (antes.cajon) botonVisible(antes.cajon)?.focus();
    }
    return true;
  }

  for (const lado of ["izq", "der"] as const) for (const b of botones[lado]) b.addEventListener("click", () => despachar({ tipo: "alternar", lado, movil }));
  velo?.addEventListener("click", () => despachar({ tipo: "fuera" }));

  document.addEventListener("wiki:barras", (e) => {
    const accion = (e as CustomEvent<string>).detail;
    if (accion === "izquierda") despachar({ tipo: "alternar", lado: "izq", movil });
    else if (accion === "derecha") despachar({ tipo: "alternar", lado: "der", movil });
    else if (accion === "enfoque") despachar({ tipo: "enfoque" }, false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.key !== "Escape" || document.querySelector("dialog[open]")) return;
    if (despachar({ tipo: "escape" })) e.preventDefault();
  });

  mq.addEventListener("change", (e) => {
    movil = e.matches;
    despachar({ tipo: "fuera" }, false);
    aplicar();
  });

  aplicar();
}
