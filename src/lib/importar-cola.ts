// Importar páginas: ejecución del plan contra las APIs que ya existen (/api/archivos/ y /api/hardware/). Una operación
// a la vez; por cada página, sus imágenes pendientes, luego crear y luego guardar el md reescrito. Respeta el límite de
// escrituras del servidor (espera ante el 429) y se puede detener y reanudar sin duplicar nada. `fetch`, `esperar` y
// `uuid` van inyectados; sin DOM. Lo cubre tests/c1-importar-cola.test.mjs.
import { MENSAJE_CANDADO, mensajeError, TIMEOUT_API_MS, urlSubidaDirecta } from "./hardware-editor.ts";
import { reescribirMd, type PaginaPlan, type Plan } from "./importar-plan.ts";

export type EstadoPagina = "pendiente" | "creada" | "hecha" | "fallida";
export type EstadoImagen = "pendiente" | "subida" | "fallida";
export type CausaParada = "usuario" | "red" | "timeout" | "sesion" | "permiso" | "servidor" | "limite";

export interface EstadoImportacion {
  paginas: { slug: string; titulo: string; ruta: string; estado: EstadoPagina; motivo: string }[];
  imagenes: { ruta: string; nombre: string; id: string; estado: EstadoImagen; motivo: string }[];
  hechas: number; // operaciones resueltas, para la barra de progreso
  total: number;
  detenido: { causa: CausaParada; mensaje: string } | null;
}

export type Progreso = { tipo: "imagen"; n: number; de: number } | { tipo: "pagina"; n: number; de: number; titulo: string } | { tipo: "espera"; segundos: number };

export interface OpcionesImportacion {
  plan: Plan;
  proyecto: string;
  disciplina: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  esperar: (ms: number, senal: AbortSignal) => Promise<unknown>; // debe resolverse también si la señal se aborta
  uuid: () => string;
  alProgreso?: (evento: Progreso) => void;
  plazos?: { api?: number; subida?: number };
}

const PLAZO_SUBIDA_MS = 120_000;
const MAX_ESPERAS = 5; // esperas seguidas por el límite de escrituras antes de rendirse con una operación
const ESPERA_POR_DEFECTO_S = 60;
const ESPERA_MAXIMA_S = 120;

const MOTIVO_EXISTE = "ya existe una página con ese nombre";
const MOTIVO_CAMBIO = "alguien cambió la página";
const MOTIVO_GRANDE = "demasiado grande";

export function textoProgreso(evento: Progreso): string {
  if (evento.tipo === "imagen") return `Subiendo imagen ${evento.n} de ${evento.de}…`;
  if (evento.tipo === "pagina") return `Página ${evento.n} de ${evento.de}: «${evento.titulo}»`;
  return `Esperando al límite de escrituras: ${evento.segundos} s`;
}

// Lo que el diálogo cuenta al terminar o al detenerse.
export function resumenResultado(estado: EstadoImportacion) {
  const hechas = estado.paginas.filter((p) => p.estado === "hecha");
  const de = estado.paginas.length;
  return {
    texto: `${hechas.length === 1 ? "Se importó" : "Se importaron"} ${hechas.length} de ${de} ${de === 1 ? "página" : "páginas"}.`,
    pendientes: estado.paginas
      .filter((p) => p.estado !== "hecha")
      .map((p) => ({ titulo: p.titulo, motivo: p.estado === "pendiente" ? "sin empezar" : p.estado === "creada" ? "creada sin contenido" : p.motivo })),
    imagenes: estado.imagenes.filter((i) => i.estado === "fallida").map((i) => ({ nombre: i.nombre, motivo: i.motivo })),
    reintentable: estado.paginas.some((p) => p.estado === "pendiente" || p.estado === "creada"),
    primera: hechas[0]?.slug ?? null,
  };
}

// Algo que detiene toda la importación y deja lo pendiente para reintentar.
class Parada extends Error {
  causa: CausaParada;
  constructor(causa: CausaParada, mensaje: string) {
    super(mensaje);
    this.causa = causa;
  }
}

// Segundos de `retry-after`: un entero de 1 a 120; si falta o no lo es, 60.
function segundosDeEspera(cabecera: string | null): number {
  const n = /^\d+$/.test(cabecera ?? "") ? Number(cabecera) : 0;
  return n >= 1 ? Math.min(n, ESPERA_MAXIMA_S) : ESPERA_POR_DEFECTO_S;
}

interface Respuesta {
  status: number;
  json: any;
  retryAfter: string | null;
}
// `dudosa`: la última escritura de este elemento se cortó sin respuesta y no se sabe si el servidor la aplicó.
interface Dudable {
  dudosa: boolean;
}

export function crearImportacion({ plan, proyecto, disciplina, fetch, esperar, uuid, alProgreso = () => {}, plazos = {} }: OpcionesImportacion) {
  const plazoApi = plazos.api ?? TIMEOUT_API_MS;
  const plazoSubida = plazos.subida ?? PLAZO_SUBIDA_MS;
  const paginas = plan.paginas.map((p) => ({ slug: p.slug, titulo: p.titulo, ruta: p.ruta, estado: "pendiente" as EstadoPagina, motivo: "", version: 0, dudosa: false }));
  // El id de cada imagen se fija desde el principio: reintentar una subida con el mismo id no puede duplicarla.
  const imagenes = plan.imagenes.map((i) => ({ ruta: i.ruta, nombre: i.nombre, id: uuid(), estado: "pendiente" as EstadoImagen, motivo: "", dudosa: false }));
  type Pagina = (typeof paginas)[number];
  const slugs = new Map(plan.paginas.map((p) => [p.ruta, p.slug]));
  let detenido: EstadoImportacion["detenido"] = null;
  let enCurso: Promise<EstadoImportacion> | null = null;

  const estado = (): EstadoImportacion => ({
    paginas: paginas.map(({ slug, titulo, ruta, estado, motivo }) => ({ slug, titulo, ruta, estado, motivo })),
    imagenes: imagenes.map(({ ruta, nombre, id, estado, motivo }) => ({ ruta, nombre, id, estado, motivo })),
    hechas: imagenes.filter((i) => i.estado !== "pendiente").length + paginas.reduce((n, p) => n + (p.estado === "pendiente" ? 0 : p.estado === "creada" ? 1 : 2), 0),
    total: paginas.length * 2 + imagenes.length,
    detenido,
  });

  // Una petición con plazo. Si se corta sin respuesta (la detienen, vence el plazo o falla la red) lanza una Parada.
  async function pedir(url: string, init: RequestInit, plazo: number, senal: AbortSignal): Promise<Respuesta> {
    const ctl = new AbortController();
    let vencido = false;
    const reloj = setTimeout(() => {
      vencido = true;
      ctl.abort();
    }, plazo);
    const cortar = () => ctl.abort();
    senal.addEventListener("abort", cortar, { once: true });
    try {
      const res = await fetch(url, { ...init, credentials: "same-origin", signal: ctl.signal });
      let json: any = null;
      try {
        json = await res.json();
      } catch (e) {
        if (ctl.signal.aborted) throw e; // cortada a media respuesta: cuenta como sin respuesta
      }
      return { status: res.status, json, retryAfter: res.headers.get("retry-after") };
    } catch {
      if (senal.aborted) throw new Parada("usuario", "Importación detenida.");
      throw new Parada(vencido ? "timeout" : "red", mensajeError(vencido ? "timeout" : "red"));
    } finally {
      clearTimeout(reloj);
      senal.removeEventListener("abort", cortar);
    }
  }

  // Una operación hasta tener una respuesta sobre la que decidir: ante el 429 espera y la repite tal cual, y lo que
  // detiene todo (sesión, permiso, candado, 5xx, corte) sale como Parada. `elemento` es lo que se está escribiendo.
  async function operar(elemento: Dudable | null, url: string, init: RequestInit, plazo: number, senal: AbortSignal): Promise<Respuesta> {
    for (let esperas = 0; ; esperas++) {
      if (senal.aborted) throw new Parada("usuario", "Importación detenida.");
      let r: Respuesta;
      try {
        r = await pedir(url, init, plazo, senal);
      } catch (e) {
        if (elemento) elemento.dudosa = true;
        throw e;
      }
      if (r.status === 429) {
        if (esperas >= MAX_ESPERAS) throw new Parada("limite", "El límite de escrituras del servidor no se libera. Espera unos minutos y reintenta lo pendiente.");
        const segundos = segundosDeEspera(r.retryAfter);
        alProgreso({ tipo: "espera", segundos });
        await esperar(segundos * 1000, senal);
        continue;
      }
      if (r.status === 401) throw new Parada("sesion", mensajeError(401));
      if (r.status === 403) throw new Parada("permiso", mensajeError(403));
      if (r.status === 409 && r.json?.codigo === "candado") throw new Parada("servidor", MENSAJE_CANDADO);
      if (r.status >= 500) {
        if (elemento) elemento.dudosa = true;
        throw new Parada("servidor", mensajeError(503));
      }
      return r;
    }
  }

  const escribir = (elemento: Dudable, metodo: "POST" | "PUT", cuerpo: Record<string, unknown>, senal: AbortSignal) =>
    operar(elemento, "/api/hardware/", { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify({ proyecto, disciplina, ...cuerpo }) }, plazoApi, senal);

  // Cómo está la página en el servidor, para resolver una escritura dudosa.
  const consultar = (slug: string, senal: AbortSignal) => operar(null, `/api/hardware/?${new URLSearchParams({ proyecto, disciplina, pagina: slug })}`, { method: "GET" }, plazoApi, senal);

  async function subir(ruta: string, senal: AbortSignal) {
    const k = imagenes.findIndex((i) => i.ruta === ruta);
    const imagen = imagenes[k];
    if (!imagen || imagen.estado !== "pendiente") return;
    alProgreso({ tipo: "imagen", n: k + 1, de: imagenes.length });
    const init = { method: "POST", headers: { "content-type": "application/octet-stream" }, body: plan.imagenes[k].bytes };
    const eraDudosa = imagen.dudosa;
    const r = await operar(imagen, urlSubidaDirecta(proyecto, disciplina, imagen.id, imagen.nombre), init, plazoSubida, senal);
    imagen.dudosa = false;
    // Con el mismo id, un 409 tras un corte significa que la primera subida sí llegó.
    if (r.status === 201 || (r.status === 409 && eraDudosa)) imagen.estado = "subida";
    else {
      imagen.estado = "fallida";
      // El texto de mensajeError(409) habla de páginas: para una imagen vale el genérico.
      imagen.motivo = r.status === 413 ? MOTIVO_GRANDE : mensajeError(r.status === 409 ? 0 : r.status);
    }
  }

  const fallar = (pagina: Pagina, motivo: string) => {
    pagina.estado = "fallida";
    pagina.motivo = motivo;
  };

  async function crear(pagina: Pagina, senal: AbortSignal) {
    const eraDudosa = pagina.dudosa;
    const r = await escribir(pagina, "POST", { accion: "crear", pagina: pagina.slug, titulo: pagina.titulo }, senal);
    let version: unknown = r.status === 201 ? r.json?.pagina?.version : null;
    if (r.status === 409 && eraDudosa) {
      // Puede que el crear cortado sí llegara: solo se adopta la página si es el esbozo recién creado por mí.
      const c = await consultar(pagina.slug, senal);
      const actual = c.status === 200 ? c.json?.pagina : null;
      if (actual && actual.md === `# ${pagina.titulo}\n` && typeof c.json.yo === "string" && actual.autor === c.json.yo) version = actual.version;
    }
    pagina.dudosa = false;
    if (typeof version === "number") {
      pagina.version = version;
      pagina.estado = "creada";
    } else if (r.status === 409) fallar(pagina, MOTIVO_EXISTE);
    else if (r.status === 413) fallar(pagina, MOTIVO_GRANDE);
    else fallar(pagina, mensajeError(r.status === 201 ? 0 : r.status));
  }

  async function guardar(pagina: Pagina, origen: PaginaPlan, senal: AbortSignal) {
    const subidas = new Map(imagenes.filter((i) => i.estado === "subida").map((i) => [i.ruta, { id: i.id, nombre: i.nombre }]));
    const md = reescribirMd(origen.md, { ruta: origen.ruta, proyecto, disciplina, slugs, subidas });
    const eraDudosa = pagina.dudosa;
    const r = await escribir(pagina, "PUT", { pagina: pagina.slug, md, version: pagina.version }, senal);
    let hecha = r.status === 200;
    if (r.status === 409 && eraDudosa) {
      // Puede que el guardado cortado sí llegara: si la página ya tiene este md, está hecha.
      const c = await consultar(pagina.slug, senal);
      hecha = c.status === 200 && c.json?.pagina?.md === md;
    }
    pagina.dudosa = false;
    if (hecha) pagina.estado = "hecha";
    else if (r.status === 409) fallar(pagina, MOTIVO_CAMBIO);
    else if (r.status === 413) fallar(pagina, MOTIVO_GRANDE);
    else fallar(pagina, mensajeError(r.status));
  }

  async function recorrer(senal: AbortSignal): Promise<EstadoImportacion> {
    detenido = null;
    try {
      for (const [n, pagina] of paginas.entries()) {
        if (pagina.estado === "hecha" || pagina.estado === "fallida") continue;
        const origen = plan.paginas[n];
        for (const ruta of origen.imagenes) await subir(ruta, senal);
        const progreso: Progreso = { tipo: "pagina", n: n + 1, de: paginas.length, titulo: pagina.titulo };
        if (pagina.estado === "pendiente") {
          alProgreso(progreso);
          await crear(pagina, senal);
        }
        if (pagina.estado === "creada") {
          alProgreso(progreso);
          await guardar(pagina, origen, senal);
        }
      }
    } catch (e) {
      if (!(e instanceof Parada)) throw e;
      detenido = { causa: e.causa, mensaje: e.message };
    }
    return estado();
  }

  return {
    estado,
    // Hace lo que quede pendiente. Abortar `senal` la detiene; llamarla otra vez continúa donde se quedó.
    ejecutar(senal: AbortSignal = new AbortController().signal): Promise<EstadoImportacion> {
      enCurso ??= recorrer(senal).finally(() => {
        enCurso = null;
      });
      return enCurso;
    },
  };
}
