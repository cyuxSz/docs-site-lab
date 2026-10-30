// Barras laterales de la wiki: plegado en escritorio, cajones en móvil y modo enfoque. La lógica está en src/lib/barras.ts.
import { ANCHO_CAJON, barras, guardarBarras, leerBarras, visible, type EstadoBarras, type EventoBarras, type Lado } from "../lib/barras.ts";
import { almacenSeguro } from "../lib/rutas.ts";

const control = document.querySelector<HTMLElement>("[data-barras-control]");
if (control) iniciar(control);

function iniciar(ctrl: HTMLElement) {
  const html = document.documentElement;
  const alm = almacenSeguro(() => localStorage);
  const botones: Record<Lado, HTMLButtonElement | null> = {
    izq: ctrl.querySelector<HTMLButtonElement>("[data-barra=izq]"),
    der: ctrl.querySelector<HTMLButtonElement>("[data-barra=der]"),
  };
  const enfoqueBtn = ctrl.querySelector<HTMLButtonElement>("[data-enfoque-btn]");
  const salir = document.querySelector<HTMLButtonElement>("[data-salir-enfoque]");
  const velo = document.querySelector<HTMLElement>("[data-barras-velo]");
  const paneles: Record<Lado, HTMLElement | null> = { izq: document.getElementById("barra-izq"), der: document.getElementById("barra-der") };

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
    for (const lado of ["izq", "der"] as const) botones[lado]?.setAttribute("aria-expanded", String(visible(estado, lado, movil)));
    enfoqueBtn?.setAttribute("aria-pressed", String(estado.enfoque));
    if (velo) velo.hidden = !(movil && estado.cajon);
    if (salir) salir.hidden = !estado.enfoque;
  }

  // `foco`: mover el foco al abrir o cerrar un cajón (no al cambiar de ancho ni al entrar en enfoque).
  function despachar(ev: EventoBarras, foco = true) {
    const antes = estado;
    estado = barras(antes, ev);
    if (estado === antes) return false;
    aplicar();
    if (!movil && ev.tipo !== "enfoque") guardarBarras(alm, estado);
    if (movil && foco && antes.cajon !== estado.cajon) {
      if (estado.cajon) paneles[estado.cajon]?.querySelector<HTMLElement>("a[href]")?.focus();
      else if (antes.cajon) botones[antes.cajon]?.focus();
    }
    return true;
  }

  function alternarEnfoque(desdeBoton: boolean) {
    const salia = estado.enfoque;
    despachar({ tipo: "enfoque" }, false);
    if (!desdeBoton) return;
    if (salia) enfoqueBtn?.focus();
    else salir?.focus();
  }

  for (const lado of ["izq", "der"] as const) botones[lado]?.addEventListener("click", () => despachar({ tipo: "alternar", lado, movil }));
  enfoqueBtn?.addEventListener("click", () => alternarEnfoque(true));
  salir?.addEventListener("click", () => alternarEnfoque(true));
  velo?.addEventListener("click", () => despachar({ tipo: "fuera" }));

  document.addEventListener("wiki:barras", (e) => {
    const accion = (e as CustomEvent<string>).detail;
    if (accion === "izquierda") despachar({ tipo: "alternar", lado: "izq", movil });
    else if (accion === "derecha") despachar({ tipo: "alternar", lado: "der", movil });
    else if (accion === "enfoque") alternarEnfoque(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
    const salia = estado.enfoque && !estado.cajon;
    if (despachar({ tipo: "escape" })) {
      e.preventDefault();
      if (salia) enfoqueBtn?.focus();
    }
  });

  mq.addEventListener("change", (e) => {
    movil = e.matches;
    despachar({ tipo: "fuera" }, false);
    aplicar();
  });

  aplicar();
}
