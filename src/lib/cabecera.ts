// Borde inferior de la cabecera fija (top + alto) en px enteros; 67px si algún dato no es un número finito.
export function fondoCabecera(top: number, alto: number): string {
  if (!Number.isFinite(top) || !Number.isFinite(alto)) return "67px";
  return `${Math.round(top + alto)}px`;
}

// Alto del aviso de la vista de lector en px enteros; 57px si no es un número finito positivo (oculto mide 0).
export function altoAviso(alto: number): string {
  if (!Number.isFinite(alto) || alto <= 0) return "57px";
  return `${Math.round(alto)}px`;
}
