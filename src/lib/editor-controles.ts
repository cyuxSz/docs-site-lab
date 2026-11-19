// Controles del editor de hardware: menú «Insertar» (botón + menú de acciones) y paneles plegables («Atajos»).
// La lógica del menú es pura (menuInsertar); conectarMenuInsertar y conectarPlegable solo la llevan al DOM.

export type EventoMenuInsertar = "alternar" | "abajo" | "arriba" | "inicio" | "fin" | "escape" | "elegir" | "tab" | "fuera";
export interface EstadoMenuInsertar {
  abierto: boolean;
  activo: number;
}
export interface ResultadoMenuInsertar {
  abierto: boolean;
  activo: number;
  foco: "item" | "boton" | null;
}

// Devuelve el nuevo estado, o null si el evento no se maneja (menú cerrado, sin acciones o evento desconocido).
export function menuInsertar(estado: EstadoMenuInsertar, evento: string, total: number): ResultadoMenuInsertar | null {
  const cierra = (foco: "boton" | null): ResultadoMenuInsertar => ({ abierto: false, activo: -1, foco });
  const en = (activo: number): ResultadoMenuInsertar => ({ abierto: true, activo, foco: "item" });
  if (!estado.abierto) {
    if (total <= 0) return null;
    if (evento === "alternar" || evento === "abajo") return en(0);
    if (evento === "arriba") return en(total - 1);
    return null;
  }
  switch (evento) {
    case "alternar":
    case "escape":
    case "elegir":
    case "tab":
      return cierra("boton");
    case "fuera":
      return cierra(null);
    case "abajo":
      return total > 0 ? en((estado.activo + 1) % total) : null;
    case "arriba":
      return total > 0 ? en((estado.activo - 1 + total) % total) : null;
    case "inicio":
      return total > 0 ? en(0) : null;
    case "fin":
      return total > 0 ? en(total - 1) : null;
    default:
      return null;
  }
}

export function conectarMenuInsertar(boton: HTMLElement, menu: HTMLElement, senal?: AbortSignal): { cerrar: () => void } {
  const doc = boton.ownerDocument;
  const opts = { signal: senal };
  const disponibles = () => [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter((i) => !i.hidden && !i.disabled);
  const estaAbierto = () => boton.getAttribute("aria-expanded") === "true" && !menu.hidden;
  const deshabilitado = () => (boton as HTMLButtonElement).disabled === true;
  let estado: EstadoMenuInsertar = { abierto: false, activo: -1 };

  function aplicar(r: ResultadoMenuInsertar) {
    estado = { abierto: r.abierto, activo: r.activo };
    menu.hidden = !r.abierto;
    boton.setAttribute("aria-expanded", String(r.abierto));
    if (r.foco === "item") disponibles()[r.activo]?.focus();
    else if (r.foco === "boton") boton.focus();
  }
  function evento(ev: EventoMenuInsertar): ResultadoMenuInsertar | null {
    if (deshabilitado() && !estado.abierto) return null;
    estado = { abierto: estaAbierto(), activo: estado.abierto ? estado.activo : -1 };
    const r = menuInsertar(estado, ev, disponibles().length);
    if (r) aplicar(r);
    return r;
  }
  // Mantiene el índice activo en sincronía cuando el foco entra en una acción por otra vía.
  const sincronizar = () => {
    const i = disponibles().indexOf(doc.activeElement as HTMLButtonElement);
    if (estado.abierto && i >= 0) estado = { abierto: true, activo: i };
  };

  boton.addEventListener(
    "click",
    () => {
      evento("alternar");
    },
    opts,
  );
  boton.addEventListener(
    "keydown",
    (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== "ArrowDown" && k !== "ArrowUp") return;
      if (deshabilitado()) return;
      e.preventDefault();
      evento(k === "ArrowDown" ? "abajo" : "arriba");
    },
    opts,
  );
  menu.addEventListener(
    "keydown",
    (e) => {
      const k = (e as KeyboardEvent).key;
      sincronizar();
      const mapa: Record<string, EventoMenuInsertar> = { ArrowDown: "abajo", ArrowUp: "arriba", Home: "inicio", End: "fin", Escape: "escape", Tab: "tab" };
      const ev = mapa[k];
      if (!ev) return;
      if (ev === "escape") {
        e.preventDefault();
        e.stopPropagation();
      } else if (ev !== "tab") e.preventDefault();
      evento(ev);
    },
    opts,
  );
  // Elegir: en captura, antes que el manejador de la acción, para que el foco ya esté en el botón y no le quite el foco a un diálogo.
  menu.addEventListener(
    "click",
    (e) => {
      if (!(e.target as Element).closest('[role="menuitem"]')) return;
      evento("elegir");
    },
    { signal: senal, capture: true },
  );
  doc.addEventListener(
    "click",
    (e) => {
      if (!estaAbierto()) return;
      const t = e.target as Node;
      if (boton.parentElement?.contains(t) ?? (boton.contains(t) || menu.contains(t))) return;
      evento("fuera");
    },
    opts,
  );
  return { cerrar: () => void (estaAbierto() && aplicar({ abierto: false, activo: -1, foco: null })) };
}

// Botón que pliega y despliega el elemento de aria-controls (hidden + aria-expanded). El estado no se persiste.
export function conectarPlegable(boton: HTMLElement, senal?: AbortSignal): void {
  boton.addEventListener(
    "click",
    () => {
      const panel = boton.ownerDocument.getElementById(boton.getAttribute("aria-controls") ?? "");
      if (!panel) return;
      const abrir = panel.hidden;
      panel.hidden = !abrir;
      boton.setAttribute("aria-expanded", String(abrir));
    },
    { signal: senal },
  );
}
