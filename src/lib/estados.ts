// Estados "legado" y "sin uso" del grafo ROS: dos filtros independientes, su URL, su estilo y sus insignias.
export interface FiltrosEstado {
  legado: boolean;
  sinUso: boolean;
}

export const FILTROS_INICIALES: FiltrosEstado = { legado: false, sinUso: false };
export const GRIS_SIN_USO = "#8b95a1";

export function ocultoPorEstado(n: { kind: string; status?: string }, f: FiltrosEstado): boolean {
  if (n.kind !== "node") return false;
  if (n.status === "legado") return !f.legado;
  if (n.status === "sin_uso") return !f.sinUso;
  return false;
}

export function leerFiltrosUrl(search: string): FiltrosEstado {
  const q = new URLSearchParams(search);
  return { legado: q.get("legado") === "1", sinUso: q.get("sinuso") === "1" };
}

export function escribirFiltrosUrl(q: URLSearchParams, f: FiltrosEstado): void {
  if (f.legado) q.set("legado", "1");
  else q.delete("legado");
  if (f.sinUso) q.set("sinuso", "1");
  else q.delete("sinuso");
}

export function estiloEstado(status: string | undefined, colorCapa: string): { color: string; prefijo: string } {
  if (status === "legado") return { color: colorCapa, prefijo: "◷ " };
  if (status === "sin_uso") return { color: GRIS_SIN_USO, prefijo: "" };
  return { color: colorCapa, prefijo: "" };
}

const ESTADOS: Record<string, [string, string]> = {
  legado: ["Legado", "Solo lo lanzan launch files o configuraciones del sistema anterior; no corre en la configuración actual."],
  sin_uso: ["Sin uso", "Ningún launch file lo lanza; es candidato a borrar."],
  en_uso: ["En uso", "Lo lanza la configuración actual."],
  roto: ["Roto", "Un launch file lo lanza, pero su ejecutable no existe."],
  externo: ["Externo", "Vive fuera de este repositorio."],
};

export function insignias(n: { status?: string; plan?: boolean; soloPlan?: boolean }): { clase: string; texto: string; titulo: string }[] {
  const out: { clase: string; texto: string; titulo: string }[] = [];
  const e = n.status ? ESTADOS[n.status] : undefined;
  if (n.status && e) out.push({ clase: `badge-${n.status}`, texto: e[0], titulo: e[1] });
  if (n.soloPlan) out.push({ clase: "badge-plan", texto: "Solo plan", titulo: "Existe solo en el plan, aún no en el código" });
  else if (n.plan) out.push({ clase: "badge-plan", texto: "Plan", titulo: "Aparece en el plan" });
  return out;
}
