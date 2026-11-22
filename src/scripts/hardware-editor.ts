// Documentación de hardware (Electrónica / Mecánica): lectura, editor Markdown, índice, historial y subida de archivos.
// Habla con /api/hardware/ (misma sesión) y sube los archivos directo al Worker (/api/archivos/). La lógica pura
// está en src/lib/hardware-editor.ts. El Markdown se renderiza en el navegador (marked + DOMPurify, carga diferida) y entra al DOM por un único punto.
import { fechaRelativa } from "../lib/comentarios";
import { usoDePagina } from "../lib/hw-enlaces";
import { conectarMenuInsertar, conectarPlegable, tomarReferenciaVisual } from "../lib/editor-controles";
import { bloqueDiagrama, esSvg, insertarBloque, limpiarTitulo, nombresArchivos, type EditorDiagrama } from "../lib/diagramas";
import {
  alAbortar,
  actualizarTituloIndice,
  clavePagina,
  crearCerrojoGuardado,
  crearDebounce,
  debeAvisarSalida,
  DEBOUNCE_PREVIA_MS,
  enlaceArchivo,
  esAtajoGuardar,
  esEnlaceDeLaDisciplina,
  insertarEnTexto,
  AVISO_SUBIDAS,
  estadoGuardar,
  insercionBloqueada,
  MENSAJE_CARGANDO_EDITOR,
  MENSAJE_FALLO_VISUAL,
  estadoCancelar,
  MEDIA_LADO_A_LADO,
  mensajeError,
  mensajeRespuesta,
  moverEnOrden,
  paginaActual,
  pedirApi,
  porcentaje,
  resultadoBorrado,
  resultadoGuardado,
  resultadoRestaurarPapelera,
  slugDeTitulo,
  slugUnico,
  textoSinGuardar,
  urlPagina,
  urlSubidaDirecta,
  validarArchivo,
  type PaginaIndice,
} from "../lib/hardware-editor";
import { archivosKicad, bloqueKicad, bloquePdf, bomDeArchivo, bloqueBom, insertarBloqueTexto, tituloDeArchivo } from "../lib/visores";
import { conectarImportar } from "./hardware-importar";

interface PaginaHw {
  slug: string;
  titulo: string;
  md: string;
  autor: string;
  actualizado: string;
  version: number;
}
interface Respuesta {
  status: number;
  json: any;
  fallo?: "red" | "timeout";
}

// Inicialización idempotente: una sola instancia viva por carga de página. Si el script vuelve a ejecutarse (o la
// página se reemplaza), la anterior se limpia por completo (listeners, preguntas pendientes, subidas).
const w = window as unknown as { __hwCtl?: AbortController };
w.__hwCtl?.abort();
const ctlPagina = new AbortController();
w.__hwCtl = ctlPagina;
const senal = ctlPagina.signal;
for (const ev of ["astro:before-swap", "pagehide"]) document.addEventListener(ev, () => ctlPagina.abort(), { once: true });
const escuchar = (el: EventTarget, tipo: string, fn: (e: any) => unknown, capture = false) => el.addEventListener(tipo, fn, { signal: senal, capture });

const raiz = document.querySelector<HTMLElement>("[data-hw-proyecto][data-hw-disciplina]");
if (raiz) void iniciar(raiz);

async function iniciar(root: HTMLElement) {
  const proyecto = root.dataset.hwProyecto ?? "";
  const disciplina = root.dataset.hwDisciplina ?? "";
  const etiqueta = root.dataset.hwEtiqueta ?? disciplina;
  const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

  const lblEstado = $("[data-hw-estado]");
  const lblError = $("[data-hw-error]");
  const secVacio = $("[data-hw-vacio]");
  const btnInicializar = $<HTMLButtonElement>("[data-hw-inicializar]");
  const secNoEncontrada = $("[data-hw-no-encontrada]");
  const enlacePrimera = $<HTMLAnchorElement>("[data-hw-primera]");
  const secPagina = $("[data-hw-pagina]");
  const secUsado = $("[data-hw-usado-por-seccion]");
  const listaUsado = $("[data-hw-usado-por-lista]");
  const lectura = $("[data-hw-lectura]");
  const listaIndice = $("[data-hw-indice]");
  const soloEditor = [...document.querySelectorAll<HTMLElement>("[data-hw-solo-editor]")];
  const btnEditar = $<HTMLButtonElement>("[data-hw-editar]");
  const btnBorrar = $<HTMLButtonElement>("[data-hw-borrar]");
  const btnVerLector = $<HTMLButtonElement>("[data-hw-ver-lector]");
  const btnSalirLector = $<HTMLButtonElement>("[data-hw-salir-lector]");
  const btnNueva = $<HTMLButtonElement>("[data-hw-nueva]");
  const btnPapelera = $<HTMLButtonElement>("[data-hw-abrir-papelera]");
  const dlgPapelera = $<HTMLDialogElement>("#hw-papelera");
  const listaPapelera = dlgPapelera.querySelector<HTMLElement>("[data-hw-papelera-lista]")!;
  const estadoPapelera = dlgPapelera.querySelector<HTMLElement>("[data-hw-papelera-estado]")!;
  const form = $<HTMLFormElement>("[data-hw-editor]");
  const textarea = $<HTMLTextAreaElement>("#hw-md");
  const previa = $("[data-hw-previa]");
  const panelEscribir = $("#hw-panel-escribir");
  const pestanas = [...document.querySelectorAll<HTMLButtonElement>("[data-hw-tab]")];
  const errEditor = $("[data-hw-editor-error]");
  const btnGuardar = $<HTMLButtonElement>("[data-hw-guardar]");
  const btnCancelar = $<HTMLButtonElement>("[data-hw-cancelar]");
  const inputArchivo = $<HTMLInputElement>("#hw-archivo");
  const progreso = $<HTMLProgressElement>("[data-hw-progreso]");
  const lblSubiendo = $("[data-hw-subiendo]");
  const metaAutor = $("[data-hw-autor]");
  const metaFecha = $<HTMLTimeElement>("[data-hw-actualizado]");
  const metaVersion = $("[data-hw-version]");
  const historial = $<HTMLDetailsElement>("[data-hw-historial]");
  const historialEstado = $("[data-hw-historial-estado]");
  const listaRevisiones = $("[data-hw-revisiones]");
  const dlgNueva = $<HTMLDialogElement>("#hw-nueva");
  const dlgBorrar = $<HTMLDialogElement>("#hw-borrar");
  const dlgDescartar = $<HTMLDialogElement>("#hw-descartar");
  const btnMenuInsertar = $<HTMLButtonElement>("[data-hw-menu-insertar]");
  const menuInsertarEl = $("#hw-insertar-menu");
  const btnAdjuntar = $<HTMLButtonElement>("[data-hw-adjuntar]");
  const btnAtajos = $<HTMLButtonElement>("[data-hw-atajos]");
  const lblSinGuardar = $("[data-hw-sin-guardar]");
  const btnInsertarDiagrama = $<HTMLButtonElement>("[data-hw-insertar-diagrama]");
  const btnInsertarPdf = $<HTMLButtonElement>("[data-hw-insertar-pdf]");
  const btnInsertarBom = $<HTMLButtonElement>("[data-hw-insertar-bom]");
  const btnInsertarKicad = $<HTMLButtonElement>("[data-hw-insertar-kicad]");
  const inputKicad = $<HTMLInputElement>("[data-hw-archivo-kicad]");
  const inputPdf = $<HTMLInputElement>("[data-hw-archivo-pdf]");
  const inputBom = $<HTMLInputElement>("[data-hw-archivo-bom]");
  const dlgDiagramaNuevo = $<HTMLDialogElement>("#hw-diagrama-nuevo");
  const btnModoMarkdown = $<HTMLButtonElement>("[data-hw-modo-markdown]");
  const contVisual = $("[data-hw-visual]");
  const ayudaVisual = $("[data-hw-ayuda-visual]");
  const indicadorCarga = $("[data-hw-cargando-visual]");
  const anuncioCarga = $("[data-hw-anuncio-carga]"); // región viva fuera del formulario oculto: el lector anuncia la carga
  let sesionEdicion = 0; // sube al abrir y al cerrar el editor: una descarga de otra sesión no aplica su resultado
  let cargandoVisual = false;
  let generacionCarga = -1;
  const pestanasCaja = $(".hw-pestanas");
  const cuerpoEditor = $(".hw-editor-cuerpo");

  let indice: PaginaIndice[] = [];
  let editable = false;
  let pagina: PaginaHw | null = null;
  let baseMd = "";
  let editando = false;
  let subidasActivas = 0;
  let guardando = false;
  let salidaConfirmada = false; // el usuario eligió "Descartar": no debe salir además el aviso nativo
  // Editor visual (carga diferida al pulsar «Editar»). Modo por defecto: visual; el conmutador «Markdown» vuelve al textarea.
  type ModuloVisual = typeof import("./editor-visual");
  let modVisual: ModuloVisual | null = null;
  let visual: Awaited<ReturnType<ModuloVisual["montarCrepe"]>> | null = null;
  let modoMarkdown = false;
  let generacionEditor = 0; // invalida un montaje que acaba tras cerrar el editor
  let origen = ""; // Markdown original de la página (o el del textarea al volver a visual)
  let inicialEditor = ""; // lo que devolvió getMarkdown() al cargar: si no cambia, se guarda `origen` tal cual
  // Contenido del modo activo: es lo que se guarda, lo que compara hayCambios y lo que conserva el 409.
  function contenidoActivo(): string {
    if (modoMarkdown) return textarea.value;
    if (!visual || !modVisual) return origen;
    return modVisual.markdownParaGuardar({ actual: visual.getMarkdown(), inicialEditor, origen });
  }
  const enfocarActivo = () => (modoMarkdown || !visual ? textarea.focus() : visual.enfocar());
  // «Cambios sin guardar» en la barra fija: solo se escribe si el texto cambia, para no repetir el anuncio de la región viva.
  function actualizarSinGuardar() {
    const t = textoSinGuardar({ editando, actual: contenidoActivo(), base: baseMd });
    if (lblSinGuardar.textContent !== t) lblSinGuardar.textContent = t;
  }
  const menuInsertarCtl = conectarMenuInsertar(btnMenuInsertar, menuInsertarEl, senal);
  conectarPlegable(btnAtajos, senal);
  escuchar(btnAdjuntar, "click", () => {
    if (!insercionBloqueada(guardando, cargandoVisual)) inputArchivo.click();
  });
  const cerrojo = crearCerrojoGuardado();
  function actualizarGuardar(avisar = false) {
    const e = estadoGuardar(subidasActivas, guardando, cargandoVisual);
    btnGuardar.disabled = e.deshabilitado;
    textarea.disabled = guardando;
    visual?.setSoloLectura(guardando);
    inputArchivo.disabled = insercionBloqueada(guardando, cargandoVisual);
    btnInsertarDiagrama.disabled = insercionBloqueada(guardando, cargandoVisual);
    btnInsertarPdf.disabled = insercionBloqueada(guardando, cargandoVisual);
    btnInsertarBom.disabled = insercionBloqueada(guardando, cargandoVisual);
    btnInsertarKicad.disabled = insercionBloqueada(guardando, cargandoVisual);
    btnMenuInsertar.disabled = insercionBloqueada(guardando, cargandoVisual);
    if (btnMenuInsertar.disabled) menuInsertarCtl.cerrar();
    btnGuardar.title = e.aviso;
    const c = estadoCancelar(guardando);
    btnCancelar.disabled = c.deshabilitado;
    btnCancelar.setAttribute("aria-disabled", c.ariaDisabled);
    if (e.aviso && avisar) mostrarEstado(e.aviso);
    else if (!e.aviso && lblEstado.textContent === AVISO_SUBIDAS) mostrarEstado("");
  }
  let comentariosListos = false;

  // ---------- red ----------
  async function api(metodo: string, opciones: { query?: Record<string, string>; cuerpo?: Record<string, unknown> } = {}): Promise<Respuesta> {
    const params = new URLSearchParams(metodo === "GET" ? { proyecto, disciplina, ...opciones.query } : {});
    const init: RequestInit = { method: metodo, credentials: "same-origin", cache: "no-store" };
    if (metodo !== "GET") {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify({ proyecto, disciplina, ...opciones.cuerpo });
    }
    return pedirApi(fetch, `/api/hardware/${metodo === "GET" ? `?${params}` : ""}`, init, { senal });
  }
  const msg = (r: number | { status: number; json?: any; fallo?: string }) => (typeof r === "number" ? mensajeRespuesta(r) : mensajeRespuesta(r.status, r));

  // ---------- DOM ----------
  // Render del Markdown en el navegador (marked + DOMPurify), carga diferida y memoizada. Se dispara al iniciar,
  // en paralelo con el primer fetch del índice.
  let cargaRender: Promise<ReturnType<typeof import("../lib/hardware-md").crearRenderizador> & { montarVisores: typeof import("../lib/hardware-md").montarVisores }> | null = null;
  // Contador de generación por destino: una pintura que esperaba la carga y ya fue superada no publica ni monta nada.
  const generacionPintura = new WeakMap<HTMLElement, number>();
  function cargarRender() {
    // Con { proyecto } los bloques ```diagrama se ven como figuras; crearRenderizador(window) sin opciones sigue valiendo (los muestra como código).
    cargaRender ??= import("../lib/hardware-md").then((m) => ({ ...m.crearRenderizador(window, { proyecto }), montarVisores: m.montarVisores }));
    return cargaRender;
  }
  // Único punto por el que entra HTML al DOM: fragmento ya saneado por DOMPurify (sin reparsear strings).
  async function pintarMd(destino: HTMLElement, md: string, titulo?: string): Promise<boolean> {
    const generacion = (generacionPintura.get(destino) ?? 0) + 1;
    generacionPintura.set(destino, generacion);
    let frag: DocumentFragment;
    let montarVisores: (typeof import("../lib/hardware-md"))["montarVisores"];
    try {
      const r = await cargarRender();
      if (generacionPintura.get(destino) !== generacion) return false; // respuesta obsoleta
      frag = r.fragmento(md);
      montarVisores = r.montarVisores;
    } catch {
      cargaRender = null;
      const texto = mensajeError("red");
      if (destino === previa) errorEditor(texto);
      else mostrarError(texto);
      return false;
    }
    if (titulo && !frag.querySelector("h1")) {
      const h1 = document.createElement("h1");
      h1.textContent = titulo;
      frag.prepend(h1);
    }
    destino.replaceChildren(frag);
    // Iframe del PDF y botón "Exportar CSV": los crea montarVisores con createElement a partir de los bloques (no vienen del HTML).
    try {
      void montarVisores(destino, md, { proyecto, slug: pagina?.slug ?? "", vistaPrevia: destino === previa, descargar: descargarCsv });
    } catch {
      /* sin visores: quedan el enlace "Abrir PDF" y la tabla */
    }
    return true;
  }
  function descargarCsv(nombre: string, csv: string) {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  function mostrarEstado(texto: string) {
    lblEstado.textContent = texto;
    lblEstado.hidden = !texto;
  }
  function mostrarError(texto: string) {
    lblError.textContent = texto;
    lblError.hidden = !texto;
  }
  function errorEditor(texto: string) {
    errEditor.textContent = texto;
    errEditor.hidden = !texto;
  }
  function vista(cual: "ninguna" | "vacio" | "no-encontrada" | "pagina") {
    secVacio.hidden = cual !== "vacio";
    secNoEncontrada.hidden = cual !== "no-encontrada";
    secPagina.hidden = cual !== "pagina";
    if (cual !== "pagina") secUsado.hidden = true;
  }

  // «Usado por»: nodos ROS que usan las piezas enlazadas a esta página (datos del build, solo createElement/textContent).
  function pintarUsadoPor(slug: string) {
    const usos = usoDePagina(root.dataset.hwUsadoPor, slug);
    listaUsado.replaceChildren(
      ...usos.map((u) => {
        const li = document.createElement("li");
        const nombre = document.createElement("strong");
        nombre.textContent = u.label;
        li.append(nombre);
        if (!u.nodos.length) {
          const p = document.createElement("span");
          p.className = "hw-usado-nodos";
          p.textContent = "Ningún nodo ROS lo usa directamente";
          li.append(p);
          return li;
        }
        const nodos = document.createElement("span");
        nodos.className = "hw-usado-nodos";
        for (const n of u.nodos) {
          const a = document.createElement("a");
          a.href = n.href;
          a.textContent = n.label;
          nodos.append(a);
          if (n.plan) nodos.append(" (planeado)");
        }
        li.append(nodos);
        return li;
      }),
    );
    secUsado.hidden = editando || !usos.length;
  }
  const primera = () => (indice[0] ? urlPagina(proyecto, disciplina, indice[0].slug) : `/${proyecto}/${disciplina}/`);

  // ---------- barra lateral ----------
  function pintarIndice(foco?: { slug: string; dir: -1 | 1 }) {
    const actual = pagina?.slug ?? paginaActual(location.search, indice);
    const items = indice.map((p, i) => {
      const li = document.createElement("li");
      li.className = "hw-item";
      const a = document.createElement("a");
      a.href = urlPagina(proyecto, disciplina, p.slug);
      a.textContent = p.titulo;
      if (p.slug === actual) a.setAttribute("aria-current", "page");
      li.append(a);
      if (editable) {
        const grupo = document.createElement("span");
        grupo.className = "hw-mover";
        for (const dir of [-1, 1] as const) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "hw-mover-btn";
          b.dataset.slug = p.slug;
          b.dataset.dir = String(dir);
          b.textContent = dir < 0 ? "↑" : "↓";
          b.setAttribute("aria-label", `${dir < 0 ? "Subir" : "Bajar"} ${p.titulo}`);
          b.title = dir < 0 ? "Subir" : "Bajar";
          if ((dir < 0 && i === 0) || (dir > 0 && i === indice.length - 1)) b.setAttribute("aria-disabled", "true");
          grupo.append(b);
        }
        li.append(grupo);
      }
      return li;
    });
    listaIndice.replaceChildren(...items);
    if (foco) listaIndice.querySelector<HTMLElement>(`button[data-slug="${foco.slug}"][data-dir="${foco.dir}"]`)?.focus();
  }

  escuchar(listaIndice, "click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button.hw-mover-btn");
    if (!b || b.getAttribute("aria-disabled") === "true") return;
    const slug = b.dataset.slug!;
    const dir = Number(b.dataset.dir) as -1 | 1;
    const orden = moverEnOrden(
      indice.map((p) => p.slug),
      slug,
      dir,
    );
    mostrarError("");
    mostrarEstado("");
    const r = await api("POST", { cuerpo: { accion: "reordenar", orden } });
    if (r.status !== 200 || !Array.isArray(r.json?.paginas)) {
      mostrarError(msg(r));
      return;
    }
    indice = r.json.paginas;
    pintarIndice({ slug, dir });
  });

  // ---------- metadatos ----------
  function pintarMetadatos(p: PaginaHw | null) {
    metaAutor.textContent = p?.autor || "—";
    metaVersion.textContent = p ? String(p.version) : "—";
    if (p) {
      metaFecha.dateTime = p.actualizado;
      metaFecha.textContent = fechaRelativa(p.actualizado) || p.actualizado;
    } else {
      metaFecha.removeAttribute("datetime");
      metaFecha.textContent = "—";
    }
  }

  async function pintarPagina(p: PaginaHw) {
    pagina = p;
    if (await pintarMd(lectura, p.md, p.titulo)) await anadirBotonesDiagrama(p.md);
    vigilarImagenesDiagrama();
    pintarMetadatos(p);
    document.title = `${p.titulo} · ${etiqueta}`;
    pintarIndice();
  }

  // ---------- diagramas (C1) ----------
  // Cada figure.hw-diagrama de la lectura lleva debajo "Editar diagrama" (solo quien puede escribir). El orden de los bloques del
  // Markdown es el de las figuras renderizadas.
  async function anadirBotonesDiagrama(md: string) {
    if (!editable) return;
    const { diagramasDe } = await import("../lib/hardware-md");
    const lista = diagramasDe(md);
    const figuras = [...lectura.querySelectorAll<HTMLElement>("figure.hw-diagrama")];
    figuras.forEach((fig, i) => {
      const d = lista[i];
      if (!d) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn hw-diagrama-editar";
      b.dataset.fuente = d.fuente;
      b.dataset.editor = d.editor;
      b.textContent = "Editar diagrama";
      b.setAttribute("aria-label", d.titulo ? `Editar diagrama: ${d.titulo}` : "Editar diagrama");
      fig.append(b);
    });
  }

  let fuenteNueva = ""; // id de fuente del último diagrama guardado desde la lectura (para devolverle el foco)
  // Si el SVG de un diagrama no carga, se muestra un texto en su lugar en vez de una tarjeta blanca vacía.
  function vigilarImagenesDiagrama() {
    for (const img of lectura.querySelectorAll<HTMLImageElement>("figure.hw-diagrama img")) {
      const sustituir = () => {
        const p = document.createElement("p");
        p.className = "hw-diagrama-fallo";
        p.textContent = "No se pudo mostrar el diagrama";
        img.replaceWith(p);
      };
      if (img.complete && img.naturalWidth === 0 && img.currentSrc) sustituir();
      else escuchar(img, "error", sustituir);
    }
  }

  const TEXTO_CONFLICTO = resultadoGuardado(409).mensaje;
  const TEXTO_DIAGRAMA_NO_EDITABLE = "Este diagrama no se puede editar desde aquí (está dentro de una cita o una lista). Edítalo en modo Markdown.";

  // Sube la fuente y el SVG como archivos nuevos (UUID nuevos: /api/archivos no sobrescribe) y enlaza el bloque:
  // al crear lo inserta en el cursor del textarea; al editar desde la lectura reemplaza el bloque y hace PUT con la versión vista.
  async function guardarDiagrama(
    ctx: { editor: EditorDiagrama; titulo: string; anterior: string | null; enTexto: boolean; sesion: number },
    r: { fuente: string; svg: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!esSvg(r.svg)) return { ok: false, error: "El SVG exportado no es válido: no se guardó nada." };
    const nombres = nombresArchivos(ctx);
    const fuente = new File([r.fuente], nombres.fuente, { type: "application/octet-stream" });
    const svg = new File([r.svg], nombres.svg, { type: "image/svg+xml" });
    for (const a of [fuente, svg]) {
      const v = validarArchivo(a);
      if (!v.ok) return { ok: false, error: `El diagrama no se puede guardar: ${v.error}` };
    }
    if (ctx.enTexto && ctx.anterior !== null) {
      // Bloque dentro de una cita o lista, o con la fuente repetida: no se puede reemplazar, así que no se sube nada.
      const { diagramaReemplazable } = await import("../lib/hardware-md");
      const actual = !modoMarkdown && visual !== null ? visual.getMarkdown() : textarea.value;
      if (!diagramaReemplazable(actual, ctx.anterior)) return { ok: false, error: TEXTO_DIAGRAMA_NO_EDITABLE };
    }
    const datos = { editor: ctx.editor, fuente: crypto.randomUUID(), svg: crypto.randomUUID(), titulo: limpiarTitulo(ctx.titulo) };
    subidasActivas++;
    actualizarGuardar();
    let error = "";
    const fallo = (texto: string) => (error = texto);
    try {
      if (!(await subir(fuente, { id: datos.fuente, fallo })) || !(await subir(svg, { id: datos.svg, fallo }))) return { ok: false, error };
    } finally {
      subidasActivas--;
      actualizarGuardar();
    }
    if (ctx.enTexto) {
      if (ctx.sesion !== sesionEdicion) return { ok: false, error: "Se cerró o se reabrió el editor mientras se guardaba el diagrama. No se aplicó el cambio." };
      // Editor visual: el bloque nuevo entra en el cursor; si ya existía (segundo guardado o «Editar diagrama» de la tarjeta), se reemplaza.
      const enVisual = !modoMarkdown && visual !== null;
      const contenidoBuffer = () => (enVisual ? visual!.getMarkdown() : textarea.value);
      let res: { texto: string; cursor: number } | null;
      if (ctx.anterior === null) res = enVisual ? { texto: "", cursor: 0 } : insertarBloque(contenidoBuffer(), textarea.selectionStart, datos);
      else {
        // Segundo guardado sin cerrar el editor: reemplaza el bloque que se insertó antes, no lo duplica.
        const { reemplazarDiagrama } = await import("../lib/hardware-md");
        const t = reemplazarDiagrama(contenidoBuffer(), ctx.anterior, datos);
        res = t === null ? null : { texto: t, cursor: textarea.selectionStart };
      }
      if (res === null) return { ok: false, error: "El bloque del diagrama ya no está en la página. Revisa el texto antes de guardar." };
      if (enVisual) {
        if (ctx.anterior === null) visual!.insertarMarkdown(bloqueDiagrama(datos));
        else visual!.reemplazarTodo(res.texto);
      } else {
        textarea.value = res.texto;
        textarea.setSelectionRange(res.cursor, res.cursor);
        previaViva();
        actualizarSinGuardar();
      }
      ctx.anterior = datos.fuente; // referencia vigente para el siguiente guardado
      lblSubiendo.textContent = "Diagrama insertado. Guarda la página para publicarlo.";
      return { ok: true };
    }
    if (ctx.anterior === null) return { ok: false, error: TEXTO_CONFLICTO };
    if (!pagina) return { ok: false, error: TEXTO_CONFLICTO };
    const { reemplazarDiagrama } = await import("../lib/hardware-md");
    const nuevoMd = reemplazarDiagrama(pagina.md, ctx.anterior, datos);
    if (nuevoMd === null) return { ok: false, error: TEXTO_CONFLICTO };
    const res = await api("PUT", { cuerpo: { pagina: pagina.slug, md: nuevoMd, version: pagina.version } });
    if (res.status !== 200 || !res.json?.pagina) return { ok: false, error: resultadoGuardado(res.status, res).mensaje };
    indice = actualizarTituloIndice(indice, res.json.pagina);
    ctx.anterior = datos.fuente; // referencia vigente para el siguiente guardado
    fuenteNueva = datos.fuente;
    await pintarPagina(res.json.pagina);
    mostrarEstado("Diagrama guardado");
    if (historial.open) void cargarHistorial();
    return { ok: true };
  }

  async function abrirDiagrama(editor: EditorDiagrama, fuente: string | null, titulo: string, anterior: string | null, disparador: HTMLElement, enTexto = anterior === null) {
    const ctx = { editor, titulo, anterior, enTexto, sesion: sesionEdicion };
    try {
      const { abrirEditorDiagrama } = await import("./diagramas");
      await abrirEditorDiagrama({
        editor,
        fuente,
        titulo,
        disparador,
        alGuardar: (r) => guardarDiagrama(ctx, r),
        confirmarDescartar: () => preguntar(dlgDescartar),
      });
    } catch {
      mostrarError(mensajeError("red"));
    }
  }

  // «Editar diagrama»: desde la lectura reemplaza el bloque con un PUT; desde la tarjeta del editor visual lo reemplaza en el editor.
  async function editarDiagramaDeBoton(b: HTMLButtonElement, enEditor: boolean) {
    const fuenteId = b.dataset.fuente ?? "";
    const editor = b.dataset.editor === "drawio" ? "drawio" : "excalidraw";
    const titulo = b.closest("figure")?.querySelector("figcaption")?.textContent ?? "";
    mostrarError("");
    if (enEditor) {
      const { diagramaReemplazable } = await import("../lib/hardware-md");
      if (!visual || !diagramaReemplazable(visual.getMarkdown(), fuenteId)) {
        errorEditor(TEXTO_DIAGRAMA_NO_EDITABLE);
        return;
      }
    }
    const sesion = sesionEdicion;
    b.disabled = true;
    mostrarEstado("Descargando diagrama…");
    let texto: string | null = null;
    try {
      const r = await fetch(`/api/archivos/?${new URLSearchParams({ proyecto, id: fuenteId })}`, { credentials: "same-origin", cache: "no-store" });
      if (r.ok) texto = await r.text();
      else mostrarError(msg(r));
    } catch {
      mostrarError(msg(0));
    }
    b.disabled = false;
    mostrarEstado("");
    if (texto === null) return;
    if (enEditor && sesion !== sesionEdicion) return;
    fuenteNueva = "";
    await abrirDiagrama(editor, texto, titulo, fuenteId, b, enEditor);
    if (enEditor) {
      if (!document.activeElement || document.activeElement === document.body) enfocarActivo();
      return;
    }
    if (!document.activeElement || document.activeElement === document.body) {
      // Tras guardar, la página se repinta y el botón de origen ya no existe: se enfoca el del mismo diagrama (id de fuente nuevo).
      const botones = [...lectura.querySelectorAll<HTMLButtonElement>("button.hw-diagrama-editar")];
      (botones.find((x) => x.dataset.fuente === fuenteNueva || x.dataset.fuente === fuenteId) ?? botones[0] ?? btnEditar).focus();
    }
  }
  escuchar(lectura, "click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button.hw-diagrama-editar");
    if (!b || !editable || !pagina) return;
    if (document.documentElement.hasAttribute("data-vista-lector")) return;
    await editarDiagramaDeBoton(b, false);
  });
  // Delegación en la raíz del editor visual: las tarjetas las pinta CodeMirror y se recrean.
  escuchar(contVisual, "click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button.hw-diagrama-editar");
    if (!b || !editable || !pagina || !visual || guardando) return;
    e.preventDefault();
    await editarDiagramaDeBoton(b, true);
  });

  // Insertar un diagrama nuevo desde el editor de la página: elegir editor y título, dibujar y guardar.
  const formDiagramaNuevo = dlgDiagramaNuevo.querySelector<HTMLFormElement>("[data-hw-diag-form]")!;
  escuchar(btnInsertarDiagrama, "click", () => {
    if (guardando) return;
    formDiagramaNuevo.reset();
    dlgDiagramaNuevo.showModal();
    formDiagramaNuevo.querySelector<HTMLInputElement>("input[name=editor]:checked")?.focus();
  });
  escuchar(dlgDiagramaNuevo.querySelector("[data-hw-no]")!, "click", () => {
    dlgDiagramaNuevo.close();
    btnMenuInsertar.focus();
  });
  escuchar(formDiagramaNuevo, "submit", async (e) => {
    e.preventDefault();
    const editor = new FormData(formDiagramaNuevo).get("editor") === "drawio" ? "drawio" : "excalidraw";
    const titulo = limpiarTitulo(String(new FormData(formDiagramaNuevo).get("titulo") ?? ""));
    dlgDiagramaNuevo.close();
    await abrirDiagrama(editor, null, titulo, null, btnMenuInsertar);
  });

  // ---------- carga ----------
  async function cargarIndice(): Promise<boolean> {
    const r = await api("GET");
    if (r.status !== 200 || !Array.isArray(r.json?.paginas)) {
      mostrarEstado("");
      mostrarError(msg(r));
      return false;
    }
    indice = r.json.paginas;
    editable = r.json.editable === true;
    for (const el of soloEditor) el.hidden = !editable;
    return true;
  }

  async function mostrar() {
    mostrarError("");
    pagina = null;
    historial.open = false;
    historial.hidden = true;
    pintarMetadatos(null);
    if (!indice.length) {
      pintarIndice();
      mostrarEstado("");
      vista("vacio");
      $("[data-hw-vacio-texto]").textContent = `Todavía no hay páginas en ${etiqueta}`;
      btnInicializar.hidden = !editable;
      return;
    }
    const slug = paginaActual(location.search, indice);
    pintarIndice();
    if (!slug) {
      mostrarEstado("");
      enlacePrimera.href = primera();
      vista("no-encontrada");
      return;
    }
    mostrarEstado("Cargando página…");
    const r = await api("GET", { query: { pagina: slug } });
    if (r.status !== 200 || !r.json?.pagina) {
      mostrarEstado("");
      if (r.status === 404) {
        enlacePrimera.href = primera();
        vista("no-encontrada");
      } else {
        vista("ninguna");
        mostrarError(msg(r));
      }
      return;
    }
    editable = r.json.editable === true;
    for (const el of soloEditor) el.hidden = !editable;
    vista("pagina");
    mostrarEstado("");
    await pintarPagina(r.json.pagina);
    pintarUsadoPor(r.json.pagina.slug);
    historial.hidden = false;
    await activarComentarios(r.json.pagina.slug);
  }

  async function activarComentarios(slug: string) {
    if (comentariosListos) return;
    const seccion = document.querySelector<HTMLElement>("section.comentarios");
    const caja = document.querySelector<HTMLElement>("[data-hw-comentarios]");
    if (!seccion || !caja) return;
    // La clave se fija antes de cargar el script de comentarios: él lee data-pagina al iniciar.
    seccion.dataset.pagina = clavePagina(proyecto, disciplina, slug);
    caja.hidden = false;
    comentariosListos = true;
    try {
      await import("./comentarios");
    } catch {
      caja.hidden = true;
    }
  }

  // ---------- vacío: inicializar ----------
  escuchar(btnInicializar, "click", async () => {
    btnInicializar.disabled = true;
    mostrarError("");
    mostrarEstado("Creando páginas desde la plantilla…");
    const r = await api("POST", { cuerpo: { accion: "inicializar" } });
    btnInicializar.disabled = false;
    if (r.status !== 200 && r.status !== 201) {
      mostrarEstado("");
      mostrarError(msg(r));
      return;
    }
    if (await cargarIndice()) {
      history.replaceState(null, "", `/${proyecto}/${disciplina}/`);
      await mostrar();
    }
  });

  // ---------- diálogos ----------
  // Siempre se resuelve: con clic, con Escape/cierre, si el diálogo no puede abrirse o si la página se limpia.
  function preguntar(dlg: HTMLDialogElement): Promise<boolean> {
    return new Promise((resolver) => {
      const ctl = new AbortController();
      let hecho = false;
      const fin = (valor: boolean) => {
        if (hecho) return;
        hecho = true;
        ctl.abort();
        if (dlg.open) dlg.close();
        resolver(valor);
      };
      dlg.querySelector("[data-hw-ok]")!.addEventListener(
        "click",
        () => {
          dlg.returnValue = "ok";
          fin(true);
        },
        { signal: ctl.signal },
      );
      dlg.querySelector("[data-hw-no]")!.addEventListener("click", () => fin(false), { signal: ctl.signal });
      dlg.addEventListener("close", () => (dlg.open ? undefined : fin(dlg.returnValue === "ok")), { signal: ctl.signal });
      if (senal.aborted) return fin(false);
      senal.addEventListener("abort", () => fin(false), { signal: ctl.signal });
      dlg.returnValue = "no";
      try {
        if (!dlg.open) dlg.showModal();
      } catch {
        fin(false);
      }
    });
  }

  // ---------- editor ----------
  const hayCambios = () => debeAvisarSalida({ editando, actual: contenidoActivo(), base: baseMd });

  // Escritorio: los dos paneles lado a lado (las pestañas se ocultan por CSS y nada lleva hidden). Móvil: pestañas.
  const mqLado = window.matchMedia(MEDIA_LADO_A_LADO);
  let modoActual: "escribir" | "previa" = "escribir";
  function modoEditor(modo: "escribir" | "previa") {
    modoActual = modo;
    for (const t of pestanas) {
      const activa = t.dataset.hwTab === modo;
      t.setAttribute("aria-selected", String(activa));
      t.tabIndex = activa ? 0 : -1;
    }
    const lado = mqLado.matches;
    panelEscribir.hidden = !lado && modo !== "escribir";
    btnInsertarDiagrama.hidden = !lado && modo !== "escribir";
    btnInsertarPdf.hidden = !lado && modo !== "escribir";
    btnInsertarBom.hidden = !lado && modo !== "escribir";
    btnInsertarKicad.hidden = !lado && modo !== "escribir";
    previa.hidden = !lado && modo !== "previa";
  }

  const previaVisible = () => editando && modoMarkdown && (mqLado.matches || modoActual === "previa");
  // Vista previa en vivo: se repinta al escribir, con debounce, con el mismo renderizador de la lectura.
  const previaViva = crearDebounce(() => {
    if (previaVisible()) void pintarMd(previa, textarea.value, pagina?.titulo);
  }, DEBOUNCE_PREVIA_MS);
  escuchar(textarea, "input", () => {
    previaViva();
    actualizarSinGuardar();
  });
  // Al cruzar el umbral se pasa de un modo al otro sin tocar el texto; el foco se conserva si su panel sigue visible.
  escuchar(mqLado, "change", () => {
    if (!editando || !modoMarkdown) return;
    const foco = document.activeElement;
    modoEditor(modoActual);
    if (previaVisible()) void pintarMd(previa, textarea.value, pagina?.titulo);
    if (foco === textarea || foco === previa) (previa.hidden && foco === previa ? textarea : (foco as HTMLElement)).focus();
  });

  async function mostrarPrevia() {
    modoEditor("previa");
    errorEditor("");
    await pintarMd(previa, textarea.value, pagina?.titulo);
  }

  // Muestra el modo activo: el editor visual, o el textarea con sus pestañas y su vista previa (solo en modo Markdown).
  function mostrarModo() {
    contVisual.hidden = modoMarkdown;
    // «Atajos» y su lista solo existen en modo visual; la lista se ve si «Atajos» está expandido.
    btnAtajos.hidden = modoMarkdown;
    if (modoMarkdown) ayudaVisual.hidden = true;
    else ayudaVisual.hidden = btnAtajos.getAttribute("aria-expanded") !== "true";
    pestanasCaja.hidden = !modoMarkdown;
    cuerpoEditor.hidden = !modoMarkdown;
    btnModoMarkdown.setAttribute("aria-pressed", String(modoMarkdown));
    if (modoMarkdown) {
      modoEditor("escribir");
      if (mqLado.matches) void pintarMd(previa, textarea.value, pagina?.titulo);
    } else {
      for (const x of [btnInsertarDiagrama, btnInsertarPdf, btnInsertarBom, btnInsertarKicad]) x.hidden = false;
      previaViva.cancelar();
    }
    actualizarSinGuardar();
  }

  function fijarReferencia(ref: { origen: string; inicialEditor: string }) {
    origen = ref.origen;
    inicialEditor = ref.inicialEditor;
  }

  // Monta el editor visual con `md`. Si el chunk no carga, se queda el modo Markdown con un aviso.
  async function montarVisual(md: string, generacion: number) {
    cargandoVisual = true;
    generacionCarga = generacion;
    anuncioCarga.textContent = MENSAJE_CARGANDO_EDITOR;
    indicadorCarga.textContent = MENSAJE_CARGANDO_EDITOR;
    indicadorCarga.hidden = false;
    contVisual.setAttribute("aria-busy", "true");
    actualizarGuardar();
    try {
      const [mod, { html }] = await Promise.all([import("./editor-visual"), cargarRender()]);
      if (generacion !== generacionEditor) return;
      const montado = await mod.montarCrepe(contVisual, md, {
        alCambiar: () => actualizarSinGuardar(),
        renderizarBloque: (lenguaje, contenido) => mod.vistaBloque(html, lenguaje, contenido, { editable }),
      });
      if (generacion !== generacionEditor) {
        void montado.destruir();
        return;
      }
      modVisual = mod;
      visual = montado;
    } catch {
      if (generacion !== generacionEditor) return;
      cargaRender = null;
      modoMarkdown = true;
      mostrarModo();
      errorEditor(MENSAJE_FALLO_VISUAL);
      textarea.focus();
      return;
    } finally {
      // Si ya empezó otra generación, ella es la dueña del estado de carga.
      if (generacionCarga === generacion) {
        cargandoVisual = false;
        indicadorCarga.hidden = true;
        anuncioCarga.textContent = "";
        contVisual.removeAttribute("aria-busy");
        actualizarGuardar();
      }
    }
    tomarReferenciaVisual(visual, md, fijarReferencia, actualizarSinGuardar);
    visual.setSoloLectura(guardando);
    visual.enfocar();
  }

  function destruirVisual() {
    generacionEditor++;
    const v = visual;
    visual = null;
    void v?.destruir().catch(() => {});
    contVisual.replaceChildren();
  }

  function entrarVistaLector() {
    if (editando) return;
    document.documentElement.setAttribute("data-vista-lector", "");
    btnVerLector.setAttribute("aria-pressed", "true");
    btnSalirLector.focus();
  }
  function salirVistaLector() {
    document.documentElement.removeAttribute("data-vista-lector");
    btnVerLector.setAttribute("aria-pressed", "false");
    btnVerLector.focus();
  }
  escuchar(btnVerLector, "click", entrarVistaLector);
  escuchar(btnSalirLector, "click", salirVistaLector);
  escuchar(document, "keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || e.defaultPrevented) return;
    if (!document.documentElement.hasAttribute("data-vista-lector")) return;
    if (document.querySelector("dialog[open]")) return;
    salirVistaLector();
  });

  function abrirEditor() {
    if (document.documentElement.hasAttribute("data-vista-lector")) return;
    if (guardando) return;
    if (!pagina || !editable) return;
    editando = true;
    document.documentElement.setAttribute("data-hw-editando", "");
    sesionEdicion++;
    baseMd = pagina.md;
    origen = pagina.md;
    inicialEditor = pagina.md;
    textarea.value = pagina.md;
    modoMarkdown = false;
    errorEditor("");
    lectura.hidden = true;
    secUsado.hidden = true;
    form.hidden = false;
    for (const el of soloEditor) if (el.closest("[data-hw-pagina]")) el.hidden = true;
    mostrarModo();
    void montarVisual(pagina.md, ++generacionEditor);
  }

  async function cambiarModo() {
    if (!editando || guardando) return;
    errorEditor("");
    if (!modoMarkdown) {
      // Visual → Markdown: el textarea recibe lo que se guardaría; sin tocar nada es el original.
      if (!visual) return;
      textarea.value = modVisual!.markdownParaGuardar({ actual: visual.getMarkdown(), inicialEditor, origen });
      modoMarkdown = true;
      mostrarModo();
      textarea.focus();
    } else {
      // Markdown → visual: se carga lo escrito y se toma una referencia nueva.
      if (!visual && subidasActivas > 0) {
        errorEditor(AVISO_SUBIDAS);
        return;
      }
      const md = textarea.value;
      modoMarkdown = false;
      mostrarModo();
      if (visual) {
        visual.reemplazarTodo(md);
        tomarReferenciaVisual(visual, md, fijarReferencia, actualizarSinGuardar);
        visual.enfocar();
      } else void montarVisual(md, ++generacionEditor);
    }
  }
  escuchar(btnModoMarkdown, "click", () => void cambiarModo());

  function cerrarEditor() {
    sesionEdicion++;
    previaViva.cancelar();
    destruirVisual();
    editando = false;
    document.documentElement.removeAttribute("data-hw-editando");
    actualizarSinGuardar();
    form.hidden = true;
    lectura.hidden = false;
    if (pagina) pintarUsadoPor(pagina.slug);
    previa.textContent = "";
    errorEditor("");
    for (const el of soloEditor) el.hidden = !editable;
    btnEditar.focus();
  }

  escuchar(btnEditar, "click", abrirEditor);
  escuchar(btnCancelar, "click", async () => {
    if (guardando) return;
    mostrarEstado("");
    if (hayCambios() && !(await preguntar(dlgDescartar))) {
      enfocarActivo();
      return;
    }
    if (guardando) return;
    cerrarEditor();
  });

  for (const t of pestanas) {
    escuchar(t, "click", () => (t.dataset.hwTab === "previa" ? void mostrarPrevia() : (modoEditor("escribir"), textarea.focus())));
    escuchar(t, "keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const otra = pestanas.find((x) => x !== t)!;
      otra.focus();
      otra.click();
    });
  }

  // salir: true (botón Guardar) cierra el editor; salir: false (Ctrl/Cmd+S) lo deja abierto con texto, cursor y foco.
  async function guardar({ salir }: { salir: boolean }) {
    if (cargandoVisual) return;
    if (!pagina || !editando) return;
    errorEditor("");
    if (subidasActivas > 0) {
      actualizarGuardar(true);
      return;
    }
    let serializado = ""; // lo que se envía en el PUT, para tomarlo como referencia tras guardar
    const inicio = textarea.selectionStart;
    const fin = textarea.selectionEnd;
    const scroll = textarea.scrollTop;
    const envio = cerrojo.intentar(async () => {
      const actual = pagina!;
      const actualVisual = !modoMarkdown && visual && modVisual ? visual.getMarkdown() : null;
      const md = actualVisual !== null ? modVisual!.markdownParaGuardar({ actual: actualVisual, inicialEditor, origen }) : contenidoActivo();
      serializado = actualVisual ?? "";
      mostrarEstado("Guardando…");
      guardando = true;
      actualizarGuardar();
      const r = await api("PUT", { cuerpo: { pagina: actual.slug, md: md, version: actual.version } });
      guardando = false;
      actualizarGuardar();
      return r;
    });
    if (!envio) return;
    const r = await envio;
    if (r.status !== 200 || !r.json?.pagina) {
      // Con 409 (u otro error) el editor del modo activo conserva lo escrito.
      mostrarEstado("");
      errorEditor(resultadoGuardado(r.status, r).mensaje);
      enfocarActivo();
      return;
    }
    indice = actualizarTituloIndice(indice, r.json.pagina);
    if (salir) {
      cerrarEditor();
      await pintarPagina(r.json.pagina);
    } else {
      baseMd = r.json.pagina.md;
      if (!modoMarkdown && visual) {
        origen = r.json.pagina.md;
        inicialEditor = serializado;
      }
      actualizarSinGuardar();
      await pintarPagina(r.json.pagina);
      enfocarActivo();
      if (modoMarkdown) {
        textarea.setSelectionRange(inicio, fin);
        textarea.scrollTop = scroll;
      }
    }
    mostrarEstado("Guardado");
    if (historial.open) void cargarHistorial();
  }
  escuchar(form, "submit", (e) => {
    e.preventDefault();
    mostrarEstado("");
    void guardar({ salir: true });
  });
  // Ctrl/Cmd+S: nunca se deja pasar al «Guardar como» del navegador, aunque ahora no se pueda guardar.
  escuchar(document, "keydown", (e) => {
    if (!editando || !esAtajoGuardar(e)) return;
    e.preventDefault();
    if (!document.querySelector("dialog[open]")) void guardar({ salir: false });
  });

  // Enlaces de la disciplina con cambios sin guardar: se pregunta antes de salir (los externos los cubre beforeunload).
  escuchar(document, "click", async (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !hayCambios()) return;
    const a = (e.target as Element).closest?.("a[href]") as HTMLAnchorElement | null;
    if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    if (!esEnlaceDeLaDisciplina(a.href, location.href, proyecto, disciplina)) return;
    e.preventDefault();
    if (!(await preguntar(dlgDescartar))) {
      enfocarActivo();
      return;
    }
    salidaConfirmada = true;
    location.assign(a.href);
  });

  // ---------- crear página ----------
  const formNueva = dlgNueva.querySelector<HTMLFormElement>("[data-hw-nueva-form]")!;
  const inputNueva = $<HTMLInputElement>("#hw-nueva-nombre");
  const errNueva = $("[data-hw-nueva-error]");
  escuchar(btnNueva, "click", () => {
    mostrarEstado("");
    inputNueva.value = "";
    errNueva.hidden = true;
    dlgNueva.showModal();
    inputNueva.focus();
  });
  escuchar(dlgNueva.querySelector("[data-hw-no]")!, "click", () => dlgNueva.close());
  escuchar(formNueva, "submit", async (e) => {
    e.preventDefault();
    const titulo = inputNueva.value.trim();
    const base = slugDeTitulo(titulo);
    if (!base) {
      errNueva.textContent = "Escribe un título con letras o números.";
      errNueva.hidden = false;
      inputNueva.focus();
      return;
    }
    const slug = slugUnico(
      base,
      indice.map((p) => p.slug),
    );
    const r = await api("POST", { cuerpo: { accion: "crear", pagina: slug, titulo } });
    if (r.status !== 201) {
      errNueva.textContent = msg(r);
      errNueva.hidden = false;
      return;
    }
    dlgNueva.close();
    location.assign(urlPagina(proyecto, disciplina, slug));
  });

  // ---------- borrar ----------
  escuchar(btnBorrar, "click", async () => {
    if (!pagina) return;
    const { slug, titulo } = pagina;
    $("[data-hw-borrar-texto]").textContent = `«${titulo}» irá a la papelera.`;
    mostrarEstado("");
    mostrarError("");
    if (!(await preguntar(dlgBorrar))) return;
    const r = await api("DELETE", { cuerpo: { pagina: slug, version: pagina.version } });
    const res = r.json?.codigo === "candado" ? { quitarDelIndice: false, mensaje: msg(r) } : resultadoBorrado(r.status);
    if (!res.quitarDelIndice) {
      mostrarError(res.mensaje);
      return;
    }
    indice = indice.filter((p) => p.slug !== slug);
    if (indice.length) location.assign(primera());
    else {
      history.replaceState(null, "", `/${proyecto}/${disciplina}/`);
      await mostrar();
    }
  });

  // ---------- historial ----------
  async function cargarHistorial() {
    if (!pagina) return;
    historialEstado.textContent = "Cargando historial…";
    listaRevisiones.replaceChildren();
    const r = await api("GET", { query: { pagina: pagina.slug, revisiones: "1" } });
    if (r.status !== 200 || !Array.isArray(r.json?.revisiones)) {
      historialEstado.textContent = msg(r);
      return;
    }
    const revs = r.json.revisiones as { n: number; titulo: string; autor: string; actualizado: string; version: number }[];
    historialEstado.textContent = revs.length ? "" : "Todavía no hay versiones anteriores.";
    listaRevisiones.replaceChildren(
      ...revs.map((rev) => {
        const li = document.createElement("li");
        const linea = document.createElement("span");
        linea.textContent = `Versión ${rev.version} · ${rev.autor} · `;
        const t = document.createElement("time");
        t.dateTime = rev.actualizado;
        t.textContent = fechaRelativa(rev.actualizado) || rev.actualizado;
        linea.append(t);
        li.append(linea);
        if (editable) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn hw-restaurar";
          b.dataset.n = String(rev.n);
          b.textContent = "Restaurar";
          b.setAttribute("aria-label", `Restaurar la versión ${rev.version}`);
          li.append(b);
        }
        return li;
      }),
    );
  }
  escuchar(historial, "toggle", () => {
    if (historial.open) void cargarHistorial();
  });
  escuchar(listaRevisiones, "click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button.hw-restaurar");
    if (!b || !pagina) return;
    b.disabled = true;
    mostrarEstado("");
    mostrarError("");
    historialEstado.textContent = "";
    const r = await api("POST", { cuerpo: { accion: "restaurar", pagina: pagina.slug, revision: Number(b.dataset.n), version: pagina.version } });
    b.disabled = false;
    if (r.status !== 200 || !r.json?.pagina) {
      historialEstado.textContent = msg(r);
      return;
    }
    indice = actualizarTituloIndice(indice, r.json.pagina);
    await pintarPagina(r.json.pagina);
    mostrarEstado("Versión restaurada");
    await cargarHistorial();
  });

  // ---------- subida de archivos ----------
  function insertar(texto: string): boolean {
    if (guardando) return false;
    if (!modoMarkdown && visual) {
      const ok = visual.insertarMarkdown(texto, { enLinea: true });
      actualizarSinGuardar();
      return ok;
    }
    const r = insertarEnTexto(textarea.value, textarea.selectionStart, textarea.selectionEnd, texto);
    textarea.value = r.texto;
    textarea.setSelectionRange(r.cursor, r.cursor);
    previaViva();
    actualizarSinGuardar();
    return true;
  }

  // Sin avance durante este tiempo se aborta: si la subida se queda parada, la barra
  // se quedaría en 0 sin decir nada.
  const SIN_AVANCE_MS = 45_000;

  // Subida directa al Worker con XHR (para tener upload.onprogress). Rechaza con TypeError si no hay red.
  function subirDirecto(archivo: File, id: string, corte: AbortSignal, alAvanzar: (cargado: number, total: number) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", urlSubidaDirecta(proyecto, disciplina, id, archivo.name));
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => alAvanzar(e.loaded, e.lengthComputable ? e.total : archivo.size);
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new ErrorSubida(xhr.status));
      };
      xhr.onerror = () => reject(new TypeError("red"));
      xhr.onabort = () => reject(new TypeError("abortado"));
      alAbortar(corte, () => xhr.abort());
      if (corte.aborted) return reject(new TypeError("abortado"));
      xhr.send(archivo);
    });
  }
  class ErrorSubida extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }

  // `diagrama`: la subida es de un diagrama (C1): usa el id dado, no inserta enlace en el textarea y entrega el error a `fallo`.
  // `bloque` (D1a): la subida es de un PDF para un bloque ```pdf: exige uno de `tipos`, no inserta el enlace normal y entrega el id a `alSubir`.
  async function subir(archivo: File, diagrama?: { id: string; fallo: (texto: string) => void }, bloque?: { tipos: string[]; alSubir: (id: string) => void }): Promise<boolean> {
    errorEditor("");
    mostrarEstado("");
    const nombre = String(archivo?.name ?? "archivo");
    const quien = diagrama ? "El diagrama" : nombre; // en diagramas no se muestran nombres de archivo
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const v = validarArchivo(archivo);
      if (!v.ok || (bloque && !bloque.tipos.includes(v.tipo))) {
        const motivo = !v.ok ? v.error : "Tipo de archivo no admitido aquí";
        if (diagrama) diagrama.fallo(`${quien}: ${motivo}`);
        else errorEditor(`${nombre}: ${motivo}`);
        return false;
      }
      const id = diagrama?.id ?? crypto.randomUUID();
      lblSubiendo.textContent = diagrama ? "Guardando el diagrama…" : `Subiendo ${nombre}…`;
      progreso.value = 0;
      progreso.hidden = false;
      const corte = new AbortController();
      let sinAvance = false;
      const armar = () => {
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
          sinAvance = true;
          corte.abort();
        }, SIN_AVANCE_MS);
      };
      armar();
      alAbortar(senal, () => corte.abort());
      try {
        await subirDirecto(archivo, id, corte.signal, (cargado, total) => {
          armar();
          progreso.value = porcentaje(cargado, total);
        });
      } catch (err) {
        if (sinAvance) throw new TypeError("sin avance");
        throw err;
      }
      if (bloque) bloque.alSubir(id);
      else if (!diagrama && !insertar(enlaceArchivo({ proyecto, id, nombre: archivo.name, imagen: v.imagen }))) {
        lblSubiendo.textContent = "";
        errorEditor(`${nombre} se subió, pero no se pudo insertar el enlace en el cursor. Colócalo fuera del bloque de código e inténtalo de nuevo.`);
        return false;
      }
      lblSubiendo.textContent = diagrama ? "" : `${nombre} subido`;
      return true;
    } catch (err) {
      // Si el error no trae un estado HTTP conocido se da una causa general.
      const red = err instanceof TypeError;
      lblSubiendo.textContent = "";
      const texto = err instanceof ErrorSubida ? `${quien}: ${mensajeError(err.status)}` : red ? `${quien}: ${mensajeError("red")}` : `No se pudo ${diagrama ? "guardar el diagrama" : `subir ${nombre}`}. Revisa el tipo y el tamaño, o espera un momento si subiste muchos archivos seguidos.`;
      if (diagrama) diagrama.fallo(texto);
      else errorEditor(texto);
      return false;
    } finally {
      clearTimeout(temporizador);
      progreso.value = 0;
      progreso.hidden = true;
    }
  }

  async function subirVarios(archivos: FileList | File[]) {
    if (insercionBloqueada(guardando, cargandoVisual)) return;
    if (guardando) return;
    const lista = [...archivos];
    subidasActivas += lista.length;
    actualizarGuardar();
    for (const a of lista) {
      try {
        await subir(a);
      } finally {
        subidasActivas--;
        actualizarGuardar();
      }
    }
  }

  // Inserta un bloque (```pdf o ```bom) en el cursor, separado por líneas en blanco, y refresca la vista previa.
  function insertarBloqueEnTexto(bloque: string) {
    if (guardando) return;
    if (!modoMarkdown && visual) {
      visual.insertarMarkdown(bloque);
      actualizarSinGuardar();
      return;
    }
    const r = insertarBloqueTexto(textarea.value, textarea.selectionStart, bloque);
    textarea.value = r.texto;
    textarea.setSelectionRange(r.cursor, r.cursor);
    textarea.dispatchEvent(new Event("input"));
  }
  escuchar(btnInsertarPdf, "click", () => {
    if (!guardando) inputPdf.click();
  });
  escuchar(inputPdf, "change", async () => {
    const archivo = inputPdf.files?.[0];
    inputPdf.value = "";
    if (!archivo || guardando) return;
    subidasActivas++;
    actualizarGuardar();
    try {
      await subir(archivo, undefined, { tipos: ["pdf"], alSubir: (id) => insertarBloqueEnTexto(bloquePdf({ archivo: id, titulo: tituloDeArchivo(archivo.name) })) });
    } finally {
      subidasActivas--;
      actualizarGuardar();
    }
    enfocarActivo();
  });
  escuchar(btnInsertarKicad, "click", () => {
    if (!guardando) inputKicad.click();
  });
  escuchar(inputKicad, "change", async () => {
    const lista = [...(inputKicad.files ?? [])];
    inputKicad.value = "";
    if (!lista.length || guardando) return;
    errorEditor("");
    mostrarEstado("");
    const sel = archivosKicad(lista);
    if (!sel.ok) {
      errorEditor(sel.error);
      return;
    }
    const sesion = sesionEdicion;
    subidasActivas++;
    actualizarGuardar();
    try {
      let archivo = "";
      let respaldo = "";
      if (!(await subir(sel.kicad as File, undefined, { tipos: ["kicad_sch", "kicad_pcb"], alSubir: (id) => (archivo = id) }))) return;
      if (sesion !== sesionEdicion || !editando) return;
      if (sel.respaldo && !(await subir(sel.respaldo as File, undefined, { tipos: ["pdf", "svg"], alSubir: (id) => (respaldo = id) }))) return;
      if (sesion !== sesionEdicion || !editando) return;
      insertarBloqueEnTexto(bloqueKicad({ archivo, respaldo, titulo: tituloDeArchivo(sel.kicad.name) }));
    } finally {
      subidasActivas--;
      actualizarGuardar();
    }
    enfocarActivo();
  });
  escuchar(btnInsertarBom, "click", () => {
    if (!guardando) inputBom.click();
  });
  escuchar(inputBom, "change", async () => {
    const archivo = inputBom.files?.[0];
    inputBom.value = "";
    if (!archivo || guardando) return;
    errorEditor("");
    mostrarEstado("");
    let texto = "";
    subidasActivas++; // bloquea Guardar mientras se lee el archivo
    actualizarGuardar();
    try {
      texto = archivo.size <= 64 * 1024 ? await archivo.text() : "";
    } catch {
      errorEditor(`${archivo.name}: no se pudo leer el archivo`);
      return;
    } finally {
      subidasActivas--;
      actualizarGuardar();
    }
    const r = bomDeArchivo(archivo, texto);
    if (!r.ok) {
      errorEditor(`${archivo.name}: ${r.error}`);
      return;
    }
    insertarBloqueEnTexto(bloqueBom(r.bom));
    lblSubiendo.textContent = "BOM insertado. Guarda la página para publicarlo.";
    enfocarActivo();
  });

  escuchar(inputArchivo, "change", async () => {
    const archivos = [...(inputArchivo.files ?? [])];
    inputArchivo.value = "";
    await subirVarios(archivos);
    enfocarActivo();
  });
  escuchar(textarea, "paste", (e) => {
    const archivos = [...(e.clipboardData?.files ?? [])];
    if (!archivos.length) return;
    e.preventDefault();
    void subirVarios(archivos);
  });
  escuchar(textarea, "dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  });
  escuchar(textarea, "drop", (e) => {
    const archivos = [...(e.dataTransfer?.files ?? [])];
    if (!archivos.length) return;
    e.preventDefault();
    void subirVarios(archivos);
  });

  // Editor visual: pegar y soltar archivos se interceptan en captura, antes que ProseMirror, y van por el mismo flujo de subida
  // (barra de progreso, errores y corte por falta de avance). Pegar o soltar texto sigue su camino normal.
  const enCaptura = (tipo: string, fn: (e: any) => void) => escuchar(contVisual, tipo, fn, true /* capture: true */);
  enCaptura("paste", (e) => {
    const archivos = [...(e.clipboardData?.files ?? [])];
    if (!archivos.length) return;
    e.preventDefault();
    e.stopPropagation();
    void subirVarios(archivos);
  });
  enCaptura("dragover", (e) => {
    if (e.dataTransfer?.types.includes("Files")) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  enCaptura("drop", (e) => {
    const archivos = [...(e.dataTransfer?.files ?? [])];
    if (!archivos.length) return;
    e.preventDefault();
    e.stopPropagation();
    void subirVarios(archivos);
  });

  // Al volver desde la bfcache la página sigue viva: el aviso de salida debe volver a funcionar.
  escuchar(globalThis, "pageshow", () => {
    salidaConfirmada = false;
  });
  escuchar(globalThis, "beforeunload", (e) => {
    if (!salidaConfirmada && hayCambios()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // ---------- papelera ----------
  function filaPapelera(e: { id: string; titulo: string; borradoPor: string; borrado: string }) {
    const li = document.createElement("li");
    li.className = "hw-papelera-item";
    const info = document.createElement("span");
    info.className = "hw-papelera-info";
    const titulo = document.createElement("strong");
    titulo.textContent = e.titulo;
    const quien = document.createElement("span");
    quien.className = "hw-papelera-meta";
    quien.append(`Borrada por ${e.borradoPor} · `);
    const t = document.createElement("time");
    t.dateTime = e.borrado;
    t.textContent = fechaRelativa(e.borrado) || e.borrado;
    quien.append(t);
    info.append(titulo, quien);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn hw-papelera-restaurar";
    b.dataset.id = e.id;
    b.textContent = "Restaurar";
    b.setAttribute("aria-label", `Restaurar «${e.titulo}»`);
    li.append(info, b);
    return li;
  }
  escuchar(btnPapelera, "click", async () => {
    listaPapelera.replaceChildren();
    estadoPapelera.textContent = "Cargando…";
    if (!dlgPapelera.open) dlgPapelera.showModal();
    const r = await api("GET", { query: { papelera: "1" } });
    if (!dlgPapelera.open) return;
    if (r.status !== 200 || !Array.isArray(r.json?.papelera)) {
      estadoPapelera.textContent = msg(r);
      return;
    }
    const entradas = r.json.papelera as { id: string; slug: string; titulo: string; borradoPor: string; borrado: string }[];
    estadoPapelera.textContent = entradas.length ? "" : "La papelera está vacía";
    listaPapelera.replaceChildren(...entradas.map(filaPapelera));
  });
  escuchar(listaPapelera, "click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button.hw-papelera-restaurar");
    if (!b || b.disabled) return;
    b.disabled = true;
    estadoPapelera.textContent = "Restaurando…";
    const r = await api("POST", { cuerpo: { accion: "restaurar-papelera", id: b.dataset.id } });
    const res = resultadoRestaurarPapelera(r.status, r);
    if (!res.ok || !r.json?.pagina) {
      b.disabled = false;
      estadoPapelera.textContent = res.mensaje || msg(r);
      return;
    }
    estadoPapelera.textContent = "Página restaurada";
    dlgPapelera.close();
    location.assign(urlPagina(proyecto, disciplina, r.json.pagina.slug));
  });
  escuchar(dlgPapelera.querySelector("[data-hw-no]")!, "click", () => dlgPapelera.close());
  escuchar(dlgPapelera, "close", () => btnPapelera.focus());

  // ---------- importar páginas ----------
  conectarImportar({ proyecto, disciplina, senal, slugs: () => indice.map((p) => p.slug), hayCambios, mostrarEstado, mostrarError, recargar: async () => (await cargarIndice()) && mostrar() });

  // ---------- arranque ----------
  void cargarRender().catch(() => {});
  if (await cargarIndice()) await mostrar();
}
