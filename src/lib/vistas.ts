// Vistas guardadas del grafo (por proyecto, en localStorage). Todo lo leído se valida: lo corrupto se descarta y solo
// se copian campos conocidos. Al aplicar se descarta lo que ya no existe en los datos.
export const MAX_VISTAS = 20;
const MAX_NOMBRE = 60;

export interface CamaraVista {
  x: number;
  y: number;
  ratio: number;
}

export interface EstadoVista {
  vista: string;
  config: string;
  seccion: string | null;
  legado: boolean;
  sinUso: boolean;
  plan: boolean;
  ocultos: string[];
  nodo: string | null;
  camara?: CamaraVista;
}

export interface VistaGuardada {
  id: string;
  nombre: string;
  creada: number;
  estado: EstadoVista;
}

export type ResultadoAgregar = { ok: true; lista: VistaGuardada[] } | { ok: false; motivo: "nombre" | "lleno" };

export const claveVistas = (projectId: string) => `grafo-vistas-${projectId}`;

const nombreLimpio = (n: unknown) => (typeof n === "string" ? n.trim().slice(0, MAX_NOMBRE) : "");
const clave = (n: string) => n.toLowerCase();
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const texto = (v: unknown): v is string => typeof v === "string";

function estadoValido(raw: unknown): EstadoVista | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (!texto(e.vista) || !texto(e.config)) return null;
  if (e.seccion !== null && !texto(e.seccion)) return null;
  if (e.nodo !== null && !texto(e.nodo)) return null;
  if (typeof e.legado !== "boolean" || typeof e.plan !== "boolean") return null;
  if (!Array.isArray(e.ocultos) || !e.ocultos.every(texto)) return null;
  const sinUso = e.sinUso === undefined ? e.legado : e.sinUso;
  if (typeof sinUso !== "boolean") return null;
  const out: EstadoVista = {
    vista: e.vista,
    config: e.config,
    seccion: e.seccion as string | null,
    legado: e.legado,
    sinUso,
    plan: e.plan,
    ocultos: [...(e.ocultos as string[])],
    nodo: e.nodo as string | null,
  };
  if (e.camara !== undefined && e.camara !== null) {
    const c = e.camara as Record<string, unknown>;
    if (typeof c !== "object" || !num(c.x) || !num(c.y) || !num(c.ratio) || c.ratio <= 0) return null;
    out.camara = { x: c.x, y: c.y, ratio: c.ratio };
  }
  return out;
}

export function leerVistas(raw: string | null): VistaGuardada[] {
  if (!raw) return [];
  let datos: unknown;
  try {
    datos = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(datos)) return [];
  const out: VistaGuardada[] = [];
  const ids = new Set<string>();
  for (const x of datos) {
    if (out.length >= MAX_VISTAS) break;
    if (!x || typeof x !== "object") continue;
    const v = x as Record<string, unknown>;
    const nombre = nombreLimpio(v.nombre);
    const estado = estadoValido(v.estado);
    if (!texto(v.id) || !v.id || ids.has(v.id) || !nombre || !num(v.creada) || !estado) continue;
    ids.add(v.id);
    out.push({ id: v.id, nombre, creada: v.creada, estado });
  }
  return out;
}

export const serializarVistas = (lista: VistaGuardada[]): string => JSON.stringify(lista);

export function agregarVista(lista: VistaGuardada[], nombre: string, estado: EstadoVista, id: string, ahora: number): ResultadoAgregar {
  const n = nombreLimpio(nombre);
  const limpio = estadoValido(estado);
  if (!n || !limpio) return { ok: false, motivo: "nombre" };
  const i = lista.findIndex((v) => clave(v.nombre) === clave(n));
  if (i >= 0) {
    const copia = [...lista];
    copia[i] = { ...lista[i], nombre: n, creada: ahora, estado: limpio };
    return { ok: true, lista: copia };
  }
  if (lista.length >= MAX_VISTAS) return { ok: false, motivo: "lleno" };
  return { ok: true, lista: [...lista, { id, nombre: n, creada: ahora, estado: limpio }] };
}

export function renombrarVista(lista: VistaGuardada[], id: string, nombre: string): VistaGuardada[] {
  const n = nombreLimpio(nombre);
  if (!n || lista.some((v) => v.id !== id && clave(v.nombre) === clave(n))) return lista;
  return lista.map((v) => (v.id === id ? { ...v, nombre: n } : v));
}

export const borrarVista = (lista: VistaGuardada[], id: string): VistaGuardada[] => lista.filter((v) => v.id !== id);

export function vistaAplicable(estado: EstadoVista, ctx: { configs: string[]; secciones: string[]; nodos: Set<string>; grupos: string[] }): EstadoVista {
  return {
    ...estado,
    config: estado.config === "all" || ctx.configs.includes(estado.config) ? estado.config : "all",
    seccion: estado.seccion && ctx.secciones.includes(estado.seccion) ? estado.seccion : null,
    nodo: estado.nodo && ctx.nodos.has(estado.nodo) ? estado.nodo : null,
    ocultos: estado.ocultos.filter((g) => ctx.grupos.includes(g)),
  };
}
