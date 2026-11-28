// Reglas puras del flujo `subir --pagina`, sobre localizarBloques (la misma regla que el servidor).
// El import es dinámico: solo `--pagina` necesita node_modules (marked).
import { ErrorCli } from "./api.mjs";

export const SLUG = /^[a-z0-9-]{1,60}$/;
export const UUID_MIN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function cargarReglas() {
  let localizarBloques;
  try {
    ({ localizarBloques } = await import("../../src/lib/bloques-md.ts"));
  } catch {
    throw new ErrorCli("No se pudo cargar la lectura de bloques de la página. Para usar --pagina hace falta ejecutar `npm install` en el repositorio.");
  }
  const diagramas = (md) => localizarBloques(md).filter((b) => b.tipo === "diagrama");
  // Exactamente un bloque con esa fuente, y de draw.io.
  const bloqueCambiable = (md, uuid) => {
    const c = diagramas(md).filter((b) => b.datos.fuente === uuid);
    return c.length === 1 && c[0].datos.editor === "drawio";
  };
  // Seguro reintentar: el bloque sigue siendo cambiable (si hay fuenteAnterior) y la página no cita ya los UUID nuevos.
  const puedeReintentar = (md, { fuenteAnterior, fuente, svg }) => {
    if (fuenteAnterior && !bloqueCambiable(md, fuenteAnterior)) return false;
    return !diagramas(md).some((b) => [fuente, svg].includes(b.datos.fuente) || [fuente, svg].includes(b.datos.svg));
  };
  return { bloqueCambiable, puedeReintentar };
}
