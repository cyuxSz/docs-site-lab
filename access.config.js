// Proyectos restringidos: única fuente de verdad. Lo importan middleware.js y las páginas Astro del build.
// Clave: id del proyecto (projects.json). Valor: logins de GitHub con acceso (sin distinguir mayúsculas).
//
// Limitación aceptada: el contenido de un proyecto restringido no entra al índice de Pagefind (que es público
// en /pagefind/), así que el usuario autorizado tampoco puede buscar dentro de ese proyecto.
export const RESTRICTED = { "proyecto-x": ["cyuxSz"] };

const lower = (s) => String(s).toLowerCase();

export const isRestricted = (id) => Object.keys(RESTRICTED).some((k) => k === lower(id ?? ""));

// Función pura: ¿puede este login ver esta ruta? Solo restringe el primer segmento de la ruta.
export function canAccess(login, pathname) {
  const raw = String(pathname ?? "").split("/").find(Boolean) ?? "";
  let seg = raw;
  try {
    seg = decodeURIComponent(raw);
  } catch {}
  const id = Object.keys(RESTRICTED).find((k) => k === lower(seg));
  if (!id) return true;
  if (!login) return false;
  return RESTRICTED[id].some((l) => lower(l) === lower(login));
}
