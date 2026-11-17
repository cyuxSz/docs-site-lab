// Lógica pura del menú "⋯" de la página (patrón disclosure de enlaces, sin role=menu). Devuelve el nuevo estado y
// dónde va el foco, o null si el evento no se maneja (así el Escape con el menú cerrado sigue a las barras / modo lectura).
export type EventoMenuPagina = "alternar" | "escape" | "fuera" | "salir";
export interface ResultadoMenuPagina {
  abierto: boolean;
  foco: "primero" | "boton" | null;
}

export function menuPagina(abierto: boolean, evento: string): ResultadoMenuPagina | null {
  switch (evento) {
    case "alternar":
      return abierto ? { abierto: false, foco: "boton" } : { abierto: true, foco: "primero" };
    case "escape":
      return abierto ? { abierto: false, foco: "boton" } : null;
    case "fuera":
    case "salir":
      return abierto ? { abierto: false, foco: null } : null;
    default:
      return null;
  }
}
