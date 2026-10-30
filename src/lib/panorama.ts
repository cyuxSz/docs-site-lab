// Panorama (nivel 0): cajas Misión → Navegación → Control → Thrusters que abren su sección del grafo.
export interface PanoramaCaja {
  seccion: string;
  titulo: string;
  texto: string;
}

export function panoramaCajas(panorama: unknown, secciones: string[]): PanoramaCaja[] {
  if (!Array.isArray(panorama)) return [];
  const vistas = new Set<string>();
  const out: PanoramaCaja[] = [];
  for (const c of panorama) {
    if (!c || typeof c !== "object") continue;
    const { seccion, titulo, texto } = c as Record<string, unknown>;
    if (typeof seccion !== "string" || typeof titulo !== "string" || typeof texto !== "string") continue;
    if (!titulo.trim() || !secciones.includes(seccion) || vistas.has(seccion)) continue;
    vistas.add(seccion);
    out.push({ seccion, titulo, texto });
  }
  return out;
}
