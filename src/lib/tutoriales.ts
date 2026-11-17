// Mini tutoriales: progreso por tutorial en el navegador. Puro: el almacén (seguro, de ./rutas) se inyecta y nunca lanza.
import { progreso, type Almacen } from "./rutas.ts";

export interface PasoTutorial {
  id: string;
  titulo: string;
  objetivo: string;
  enlace: { tipo: "wiki" | "grafo" | "hardware"; href: string; texto: string };
  hecho: string;
}
export interface Tutorial {
  id: string;
  titulo: string;
  descripcion: string;
  rol: string | null;
  disciplina: string;
  page: string;
  route: string;
  pasos: PasoTutorial[];
}
export type EstadoTutorial = "sin-empezar" | "en-curso" | "completo";

export const claveTutorialPaso = (p: string, t: string, paso: string) => `tutoriales:${p}:${t}:paso:${paso}`;

export function marcarPaso(alm: Almacen, p: string, t: string, paso: string, hecho: boolean) {
  if (hecho) alm.set(claveTutorialPaso(p, t, paso), "1");
  else alm.remove(claveTutorialPaso(p, t, paso));
}

export const hechos = (alm: Almacen, p: string, t: Tutorial): boolean[] => t.pasos.map((s) => alm.get(claveTutorialPaso(p, t.id, s.id)) === "1");

export function estadoTutorial(alm: Almacen, p: string, t: Tutorial) {
  const pr = progreso(hechos(alm, p, t));
  const estado: EstadoTutorial = pr.hechos === 0 ? "sin-empezar" : pr.siguiente === null ? "completo" : "en-curso";
  return { ...pr, estado };
}

type Estado = { siguiente: number | null };
export function enlaceReanudar(t: Tutorial, e: Estado): string {
  return e.siguiente === null ? t.route : `${t.route}#paso-${t.pasos[e.siguiente].id}`;
}

export function textoAccion(e: { estado: EstadoTutorial }): string {
  return e.estado === "completo" ? "Tutorial completo" : e.estado === "en-curso" ? "Reanudar" : "Empezar";
}

export function reiniciarTutorial(alm: Almacen, p: string, t: Tutorial) {
  for (const s of t.pasos) alm.remove(claveTutorialPaso(p, t.id, s.id));
  const prefijo = claveTutorialPaso(p, t.id, "");
  for (const k of alm.claves?.() ?? []) if (k.startsWith(prefijo)) alm.remove(k);
}

// Los sin rol siempre salen; "todas"/"todos"/vacío no filtran.
export function filtrarTutoriales(ts: Tutorial[], { rol, disciplina }: { rol?: string | null; disciplina?: string | null } = {}): Tutorial[] {
  const d = disciplina && disciplina !== "todas" && disciplina !== "todos" ? disciplina : null;
  return ts.filter((t) => (!rol || !t.rol || t.rol === rol) && (!d || t.disciplina === d));
}

export const DISCIPLINAS = [
  { id: "software", etiqueta: "Software" },
  { id: "electronica", etiqueta: "Electrónica" },
  { id: "mecanica", etiqueta: "Mecánica" },
];

export function agruparPorDisciplina(ts: Tutorial[]) {
  return DISCIPLINAS.map((d) => ({ ...d, tutoriales: ts.filter((t) => t.disciplina === d.id) })).filter((g) => g.tutoriales.length);
}
