// Proyectos restringidos: única fuente de verdad. Lo importan middleware.js y las páginas Astro del build.
// Clave: id del proyecto (projects.json). Valor: logins de GitHub con acceso (sin distinguir mayúsculas).
//
// Limitación aceptada: el contenido de un proyecto restringido no entra al índice de Pagefind (que es público
// en /pagefind/), así que el usuario autorizado tampoco puede buscar dentro de ese proyecto.
// La exclusión es explícita: Base.astro pone data-pagefind-ignore="all" en el <body> de toda página de un proyecto
// restringido (además de no usar data-pagefind-body), para que un cambio futuro en una página no filtre contenido.
export const RESTRICTED = { "proyecto-x": ["cyuxSz"] };

const lower = (s) => String(s).toLowerCase();

export const isRestricted = (id) => Object.keys(RESTRICTED).some((k) => lower(k) === lower(id ?? ""));

// Función pura: ¿puede este login ver esta ruta? Decodifica la ruta, separa por / y \, descarta segmentos vacíos
// y ".", y restringe según el primer segmento. Con ".." o un % mal formado falla cerrado: se deniega si
// cualquier segmento coincide con un proyecto restringido.
export function canAccess(login, pathname) {
  const path = String(pathname ?? "");
  let decoded = path;
  let ok = true;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    ok = false;
  }
  const segs = decoded.split(/[/\\]/).filter((s) => s && s !== ".");
  const match = (s) => Object.keys(RESTRICTED).find((k) => lower(k) === lower(s));
  const strict = !ok || segs.includes("..");
  const id = strict ? segs.map(match).find(Boolean) : match(segs[0] ?? "");
  if (!id) return true;
  if (!login) return false;
  return RESTRICTED[id].some((l) => lower(l) === lower(login));
}
