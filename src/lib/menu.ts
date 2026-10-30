// Teclado de los menús desplegables de la barra del grafo y del listbox del buscador.

// Siguiente elemento activo al pulsar una tecla de navegación (con vuelta). null: la tecla no se maneja.
export function navegarLista(key: string, actual: number, total: number): number | null {
  if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return null;
  if (total <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return total - 1;
  if (key === "ArrowDown") return actual < 0 || actual >= total - 1 ? 0 : actual + 1;
  return actual <= 0 ? total - 1 : actual - 1;
}

export function accionMenu(key: string): "cerrar" | "salir" | "activar" | null {
  if (key === "Escape") return "cerrar";
  if (key === "Tab") return "salir";
  if (key === "Enter" || key === " ") return "activar";
  return null;
}
