// Importar páginas desde .md o .zip en el editor de hardware: único módulo con DOM de la importación. Lee los archivos
// en el navegador, enseña la revisión, ejecuta la cola y cuenta el resultado en el diálogo de
// src/components/HwImportar.astro. La lógica está en src/lib/importar-plan.ts, importar-zip.ts e importar-cola.ts.
// Todo lo que viene del archivo del usuario (títulos, rutas, avisos) entra al DOM como texto, nunca como HTML.
import { alAbortar, urlPagina } from "../lib/hardware-editor";
import { analizar, clasificarSeleccion, LIMITES, MENSAJE_EDICION_ABIERTA, MOTIVO, tamano, textoResumen, type Aviso, type Entrada, type Plan } from "../lib/importar-plan";
import { leerZip } from "../lib/importar-zip";
import { crearImportacion, resumenResultado, textoProgreso, type EstadoImportacion, type Progreso } from "../lib/importar-cola";

export interface OpcionesImportar {
  proyecto: string;
  disciplina: string;
  senal: AbortSignal; // la de la página: al abortarse se sueltan los listeners y se corta la importación
  slugs: () => string[]; // los del índice, para no repetir ninguno
  hayCambios: () => boolean; // hay una edición abierta con cambios sin guardar
  mostrarEstado: (texto: string) => void;
  mostrarError: (texto: string) => void;
  recargar: () => Promise<unknown>; // vuelve a cargar el índice y la vista
}

// fflate va en public/vendor y solo se descarga al importar un zip. La ruta va en una variable para que Vite no
// intente empaquetarla.
const URL_FFLATE = "/vendor/fflate/fflate.js";
const MAX_AVISOS_VISIBLES = 200;

const MENSAJE_LECTURA = "No se pudo leer el archivo. Vuelve a elegirlo.";
const MENSAJE_FFLATE = "No se pudo cargar el lector de archivos .zip. Revisa tu conexión e inténtalo de nuevo.";

type Bloque = "revision" | "progreso" | "resultado";

// Temporizador que también se resuelve si la señal se aborta.
function esperar(ms: number, senal: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    const reloj = setTimeout(resolver, ms);
    alAbortar(senal, () => {
      clearTimeout(reloj);
      resolver();
    });
  });
}

// Fila de una lista del diálogo: texto principal y, debajo, un detalle en pequeño.
function fila(principal: string, detalle: string): HTMLLIElement {
  const li = document.createElement("li");
  const a = document.createElement("span");
  a.textContent = principal;
  const b = document.createElement("span");
  b.className = "hw-ayuda";
  b.textContent = detalle;
  li.append(a, b);
  return li;
}

// Llena una lista y oculta su grupo (título incluido) si queda vacía.
function pintarLista(lista: HTMLElement, filas: HTMLLIElement[]) {
  lista.replaceChildren(...filas);
  const grupo = lista.closest<HTMLElement>("[data-hw-imp-grupo]");
  if (grupo) grupo.hidden = !filas.length;
}

function filasDeAvisos(avisos: Aviso[]): HTMLLIElement[] {
  const filas = avisos.slice(0, MAX_AVISOS_VISIBLES).map((a) => fila(a.ruta, a.motivo));
  const resto = avisos.length - filas.length;
  if (resto > 0) filas.push(fila(resto === 1 ? "Y 1 aviso más" : `Y ${resto} avisos más`, ""));
  return filas;
}

export function conectarImportar({ proyecto, disciplina, senal, slugs, hayCambios, mostrarEstado, mostrarError, recargar }: OpcionesImportar) {
  const dlg = document.querySelector<HTMLDialogElement>("#hw-importar");
  const entrada = document.querySelector<HTMLInputElement>("[data-hw-importar-archivos]");
  const botones = [...document.querySelectorAll<HTMLButtonElement>("button[data-hw-importar]")];
  if (!dlg || !entrada || !botones.length) return;
  const $ = <T extends HTMLElement>(sel: string) => dlg.querySelector<T>(sel)!;
  const escuchar = (el: EventTarget, tipo: string, fn: (e: any) => unknown) => el.addEventListener(tipo, fn, { signal: senal });

  const titulo = $("#hw-importar-titulo");
  const bloques = [...dlg.querySelectorAll<HTMLElement>("[data-hw-imp]")];
  const resumen = $("[data-hw-imp-resumen]");
  const listaPaginas = $("[data-hw-imp-paginas]");
  const listaAvisos = $("[data-hw-imp-avisos-lista]");
  const btnOk = $<HTMLButtonElement>("[data-hw-imp-ok]");
  const btnCancelar = $<HTMLButtonElement>("[data-hw-imp-cancelar]");
  const barra = $<HTMLProgressElement>("[data-hw-imp-barra]");
  const linea = $("[data-hw-imp-linea]");
  const cuenta = $("[data-hw-imp-cuenta]");
  const btnDetener = $<HTMLButtonElement>("[data-hw-imp-detener]");
  const resultado = $("[data-hw-imp-resultado]");
  const errorFinal = $("[data-hw-imp-error]");
  const listaPendientes = $("[data-hw-imp-pendientes]");
  const listaAvisosFinales = $("[data-hw-imp-avisos-finales]");
  const btnReintentar = $<HTMLButtonElement>("[data-hw-imp-reintentar]");
  const btnCerrar = $<HTMLButtonElement>("[data-hw-imp-cerrar]");

  let origen: HTMLButtonElement | null = null; // el botón que abrió: recupera el foco al cerrar
  let preparando = false;
  let plan: Plan | null = null; // en memoria (con las imágenes) mientras el diálogo está abierto
  let importacion: ReturnType<typeof crearImportacion> | null = null;
  let corte: AbortController | null = null; // distinto de null mientras se importa
  let relojCuenta: ReturnType<typeof setInterval> | undefined;

  function mostrarBloque(cual: Bloque) {
    for (const b of bloques) b.hidden = b.dataset.hwImp !== cual;
  }

  // ---------- elegir y leer los archivos ----------

  for (const boton of botones) {
    escuchar(boton, "click", () => {
      if (preparando || dlg.open) return;
      mostrarError("");
      if (hayCambios()) {
        mostrarError(MENSAJE_EDICION_ABIERTA);
        return;
      }
      origen = boton;
      entrada.value = "";
      entrada.click();
    });
  }

  escuchar(entrada, "change", async () => {
    const archivos = [...(entrada.files ?? [])];
    entrada.value = "";
    if (!archivos.length || preparando || dlg.open) return;
    preparando = true;
    mostrarError("");
    mostrarEstado("Leyendo los archivos…");
    const leido = await leer(archivos);
    preparando = false;
    if (senal.aborted) return;
    mostrarEstado("");
    if (typeof leido === "string") {
      mostrarError(leido);
      return;
    }
    plan = leido;
    abrirRevision(leido);
  });

  // De los archivos elegidos al plan, o el mensaje de por qué no se puede. El tamaño se mira antes de leer nada.
  async function leer(archivos: File[]): Promise<Plan | string> {
    const seleccion = clasificarSeleccion(archivos.map((a) => a.name));
    if (seleccion.tipo === "error") return seleccion.mensaje;
    if (archivos.length > LIMITES.entradas) return `Elige como mucho ${LIMITES.entradas} archivos.`;
    try {
      if (seleccion.tipo === "sueltos") {
        const entradas: Entrada[] = [];
        const avisos: Aviso[] = [];
        for (const archivo of archivos) {
          if (archivo.size > LIMITES.md) avisos.push({ ruta: archivo.name, motivo: MOTIVO.grande(LIMITES.md) });
          else entradas.push({ ruta: archivo.name, bytes: new Uint8Array(await archivo.arrayBuffer()) });
        }
        return analizar({ entradas, existentes: slugs(), avisos });
      }
      const [zip] = archivos;
      if (zip.size > LIMITES.zip) return `El zip pasa de ${tamano(LIMITES.zip)}.`;
      let fflate: Parameters<typeof leerZip>[1];
      try {
        fflate = await import(/* @vite-ignore */ URL_FFLATE);
      } catch {
        return MENSAJE_FFLATE;
      }
      const r = await leerZip(new Uint8Array(await zip.arrayBuffer()), fflate);
      return r.ok ? analizar({ entradas: r.entradas, existentes: slugs(), avisos: r.avisos }) : r.error;
    } catch {
      return MENSAJE_LECTURA;
    }
  }

  // ---------- revisión ----------

  function abrirRevision(p: Plan) {
    resumen.textContent = textoResumen(p);
    pintarLista(
      listaPaginas,
      p.paginas.map((pagina) => fila(pagina.titulo, pagina.ruta)),
    );
    listaPaginas.hidden = !p.paginas.length;
    pintarLista(listaAvisos, filasDeAvisos(p.avisos));
    btnOk.disabled = !p.paginas.length;
    mostrarBloque("revision");
    dlg.showModal();
    (btnOk.disabled ? btnCancelar : btnOk).focus();
  }

  escuchar(btnCancelar, "click", () => dlg.close());
  escuchar(btnOk, "click", () => {
    if (!plan || importacion) return;
    importacion = crearImportacion({ plan, proyecto, disciplina, fetch: (url, init) => fetch(url, init), esperar, uuid: () => crypto.randomUUID(), alProgreso });
    void importar();
  });

  // ---------- progreso ----------

  function pintarBarra(e: EstadoImportacion) {
    barra.max = Math.max(1, e.total);
    barra.value = e.hechas;
  }

  function pararCuenta() {
    clearInterval(relojCuenta);
    cuenta.textContent = "";
    linea.classList.remove("sr-only");
  }

  // La línea viva dice la espera una sola vez; la cuenta atrás, que cambia cada segundo, va aparte y el lector de
  // pantalla no la oye.
  function alProgreso(evento: Progreso) {
    if (importacion) pintarBarra(importacion.estado());
    const texto = textoProgreso(evento);
    if (linea.textContent !== texto) linea.textContent = texto;
    pararCuenta();
    if (evento.tipo !== "espera") return;
    linea.classList.add("sr-only");
    const fin = Date.now() + evento.segundos * 1000;
    const pintar = () => {
      cuenta.textContent = `Esperando al límite de escrituras: ${Math.max(0, Math.ceil((fin - Date.now()) / 1000))} s`;
    };
    pintar();
    relojCuenta = setInterval(pintar, 1000);
  }

  async function importar() {
    if (!importacion || corte) return;
    corte = new AbortController();
    linea.textContent = "";
    btnDetener.disabled = false;
    pintarBarra(importacion.estado());
    mostrarBloque("progreso");
    btnDetener.focus();
    let estado: EstadoImportacion;
    try {
      estado = await importacion.ejecutar(corte.signal);
    } finally {
      corte = null;
      pararCuenta();
    }
    if (!senal.aborted) mostrarResultado(estado);
  }

  function detener() {
    if (!corte || corte.signal.aborted) return;
    btnDetener.disabled = true;
    pararCuenta();
    linea.textContent = "Deteniendo…";
    corte.abort();
  }

  escuchar(btnDetener, "click", detener);
  alAbortar(senal, () => corte?.abort());

  // ---------- resultado ----------

  function mostrarResultado(estado: EstadoImportacion) {
    const r = resumenResultado(estado);
    resultado.textContent = r.texto;
    errorFinal.textContent = estado.detenido?.mensaje ?? "";
    errorFinal.hidden = !estado.detenido;
    const voluntaria = estado.detenido?.causa === "usuario";
    errorFinal.classList.toggle("hw-error", !voluntaria);
    errorFinal.classList.toggle("hw-ayuda", voluntaria);
    if (voluntaria) errorFinal.removeAttribute("role");
    else errorFinal.setAttribute("role", "alert");
    pintarLista(
      listaPendientes,
      r.pendientes.map((p) => fila(p.titulo, p.motivo)),
    );
    const sinSubir = r.imagenes.map((i) => ({ ruta: i.nombre, motivo: `la imagen no se subió: ${i.motivo}` }));
    pintarLista(listaAvisosFinales, filasDeAvisos([...sinSubir, ...(plan?.avisos ?? [])]));
    btnReintentar.hidden = !(r.reintentable && plan);
    mostrarBloque("resultado");
    if (!dlg.open) dlg.showModal();
    titulo.focus();
  }

  escuchar(btnReintentar, "click", () => void importar());
  escuchar(btnCerrar, "click", () => dlg.close());

  // ---------- cerrar y salir ----------

  // Escape mientras importa equivale a «Detener»: no cierra el diálogo.
  escuchar(dlg, "cancel", (e: Event) => {
    if (!corte) return;
    e.preventDefault();
    detener();
  });

  escuchar(dlg, "close", () => {
    // Si el navegador lo cierra de todos modos a media importación, se detiene y se reabre para enseñar el resultado.
    if (corte) {
      detener();
      dlg.showModal();
      return;
    }
    const estado = importacion?.estado() ?? null;
    plan = null;
    importacion = null;
    const primera = estado ? resumenResultado(estado).primera : null;
    if (primera) {
      location.assign(urlPagina(proyecto, disciplina, primera));
      return;
    }
    const volver = () => (origen?.offsetParent ? origen : botones[0]).focus();
    // Sin ninguna página completa pero con algo ya escrito (una página creada sin contenido): el índice cambió.
    if (estado && estado.hechas > 0) void recargar().then(volver, volver);
    else volver();
  });

  escuchar(globalThis, "beforeunload", (e: BeforeUnloadEvent) => {
    if (!corte) return;
    e.preventDefault();
    e.returnValue = "";
  });
}
