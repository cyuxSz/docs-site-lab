// Decodifica una ruta en rondas hasta que deja de cambiar (tope de 5). Devuelve null si la ruta ORIGINAL tiene un escape
// mal formado, si el UTF-8 es inválido o si tras 5 rondas todavía cambiaría: quien llama deniega (fail-closed).
// Un `%` suelto que aparece al decodificar (`/100%25/` → `/100%/`) es literal y válido: no lo rechaces.
// Módulo sin logins ni dependencias: lo importan el middleware/API (vía la config de acceso) y el cliente de Astro.
// No debe importar nada ni listar accesos: los logins llegarían al bundle del cliente.
const MAX_RONDAS = 5;

export function decodificar(path) {
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) return null;
  let actual = path;
  try {
    for (let i = 0; i < MAX_RONDAS; i++) {
      const sig = actual.replace(/(?:%[0-9A-Fa-f]{2})+/g, (r) => decodeURIComponent(r));
      if (sig === actual) return actual;
      actual = sig;
    }
    return /%[0-9A-Fa-f]{2}/.test(actual) ? null : actual;
  } catch {
    return null;
  }
}
