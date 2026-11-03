// Lógica pura de la carátula del proyecto. Corre en el navegador (sin node:fs): no importar data.ts aquí.

// Bloques de /<id>/software/ que antes colgaban de /<id>/ (cada <section> lleva su id).
export const ANCLAS_SOFTWARE = ["empieza", "configuraciones", "paquetes", "diagramas", "novedades", "favoritos"] as const;

// Destino al que debe llevar un hash de la portada anterior, o null si no hay nada que redirigir.
// El hash viene de la URL: solo se devuelven rutas internas (sin "..", "//", esquema ni caracteres raros).
export function redirigirAncla(id: string, hash: string): string | null {
  if (!/^[\w-]+$/.test(id)) return null;
  const ancla = hash.replace(/^#/, "");
  if ((ANCLAS_SOFTWARE as readonly string[]).includes(ancla)) return `/${id}/software/#${ancla}`;
  const m = hash.match(/^#\/p\/(.+)$/);
  if (!m) return null;
  let ruta: string;
  try {
    ruta = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  // Enlaces del portal anterior: #/p/<ruta>.md -> /<id>/<ruta>/ (el index.md raíz es el resumen de Software).
  const slug = ruta.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
  if (!/^[\w./-]*$/.test(slug) || slug.includes("..") || slug.includes("//") || slug.startsWith("/")) return null;
  return slug ? `/${id}/${slug}/` : `/${id}/software/`;
}

// Pestaña activa en /<id>/software/: Diagramas es un ancla de esa página, el resto es Resumen.
export function pestanaActiva(hash: string): "diagramas" | "resumen" {
  return hash === "#diagramas" ? "diagramas" : "resumen";
}

// Índice de GET /api/hardware/ -> cifras de la tarjeta; null si no tiene la forma esperada.
export function datosTarjeta(json: unknown): { paginas: number; actualizado: string | null } | null {
  if (!json || typeof json !== "object") return null;
  const { paginas, actualizado } = json as { paginas?: unknown; actualizado?: unknown };
  if (!Array.isArray(paginas)) return null;
  const valida = typeof actualizado === "string" && !Number.isNaN(Date.parse(actualizado));
  return { paginas: paginas.length, actualizado: valida ? (actualizado as string) : null };
}

export function textoCifras(d: { paginas: number; actualizado: string | null }): string {
  if (d.paginas === 0) return "Sin páginas todavía";
  const base = d.paginas === 1 ? "1 página" : `${d.paginas} páginas`;
  if (!d.actualizado) return base;
  return `${base} · editado ${new Date(d.actualizado).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: "America/Monterrey" })}`;
}
