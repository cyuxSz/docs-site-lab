// Documentación de hardware (Electrónica / Mecánica): lectura, editor Markdown, índice, historial y subida de archivos.
// Habla con /api/hardware/ (misma sesión) y sube a Vercel Blob con upload() contra /api/archivos/. La lógica pura
// está en src/lib/hardware-editor.ts. El Markdown se renderiza en el navegador (marked + DOMPurify, carga diferida) y entra al DOM por un único punto.
import { upload } from "@vercel/blob/client";
import { fechaRelativa } from "../lib/comentarios";
import { esSvg, insertarBloque, limpiarTitulo, nombresArchivos, type EditorDiagrama } from "../lib/diagramas";
import {
  alAbortar,
  actualizarTituloIndice,
  clavePagina,
  enlaceArchivo,
  insertarEnTexto,
  AVISO_SUBIDAS,
  estadoGuardar,
  mensajeError,
  moverEnOrden,
  paginaActual,
  porcentaje,
  resultadoBorrado,
  resultadoGuardado,
  rutaBlob,
  slugDeTitulo,
  slugUnico,
  urlPagina,
  urlSubidaDirecta,
  validarArchivo,
  type PaginaIndice,
} from "../lib/hardware-editor";

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
}

// Inicialización idempotente: una sola instancia viva por carga de página. Si el script vuelve a ejecutarse (o la
// página se reemplaza), la anterior se limpia por completo (listeners, preguntas pendientes, subidas).
const w = window as unknown as { __hwCtl?: AbortController };
w.__hwCtl?.abort();
const ctlPagina = new AbortController();
w.__hwCtl = ctlPagina;
const senal = ctlPagina.signal;
for (const ev of ["astro:before-swap", "pagehide"]) document.addEventListener(ev, () => ctlPagina.abort(), { once: true });
const escuchar = (el: EventTarget, tipo: string, fn: (e: any) => unknown) => el.addEventListener(tipo, fn, { signal: senal });

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
  const lectura = $("[data-hw-lectura]");
  const listaIndice = $("[data-hw-indice]");
  const soloEditor = [...document.querySelectorAll<HTMLElement>("[data-hw-solo-editor]")];
  const btnEditar = $<HTMLButtonElement>("[data-hw-editar]");
  const btnBorrar = $<HTMLButtonElement>("[data-hw-borrar]");
  const btnNueva = $<HTMLButtonElement>("[data-hw-nueva]");
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
  const btnInsertarDiagrama = $<HTMLButtonElement>("[data-hw-insertar-diagrama]");
  const dlgDiagramaNuevo = $<HTMLDialogElement>("#hw-diagrama-nuevo");

  let indice: PaginaIndice[] = [];
  let editable = false;
  let pagina: PaginaHw | null = null;
  let baseMd = "";
  let editando = false;
  let subidasActivas = 0;
  let guardando = false;
  function actualizarGuardar(avisar = false) {
    const e = estadoGuardar(subidasActivas, guardando);
    btnGuardar.disabled = e.deshabilitado;
    textarea.disabled = guardando;
    inputArchivo.disabled = guardando;
    btnInsertarDiagrama.disabled = guardando;
    btnGuardar.title = e.aviso;
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
    try {
      const res = await fetch(`/api/hardware/${metodo === "GET" ? `?${params}` : ""}`, init);
      let json: any = null;
      try {
        json = await res.json();
      } catch {}
      return { status: res.status, json };
    } catch {
      return { status: 0, json: null };
    }
  }
  const msg = (status: number) => mensajeError(status === 0 ? "red" : status);

  // ---------- DOM ----------
  // Render del Markdown en el navegador (marked + DOMPurify), carga diferida y memoizada. Se dispara al iniciar,
  // en paralelo con el primer fetch del índice.
  let cargaRender: Promise<ReturnType<typeof import("../lib/hardware-md").crearRenderizador>> | null = null;
  function cargarRender() {
    // Con { proyecto } los bloques ```diagrama se ven como figuras; crearRenderizador(window) sin opciones sigue valiendo (los muestra como código).
    cargaRender ??= import("../lib/hardware-md").then((m) => m.crearRenderizador(window, { proyecto }));
    return cargaRender;
  }
  // Único punto por el que entra HTML al DOM: fragmento ya saneado por DOMPurify (sin reparsear strings).
  async function pintarMd(destino: HTMLElement, md: string, titulo?: string): Promise<boolean> {
    let frag: DocumentFragment;
    try {
      frag = (await cargarRender()).fragmento(md);
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
    return true;
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
      mostrarError(msg(r.status));
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

  // Sube la fuente y el SVG como archivos nuevos (UUID nuevos: /api/archivos no sobrescribe) y enlaza el bloque:
  // al crear lo inserta en el cursor del textarea; al editar desde la lectura reemplaza el bloque y hace PUT con la versión vista.
  async function guardarDiagrama(
    ctx: { editor: EditorDiagrama; titulo: string; anterior: string | null },
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
    if (ctx.anterior === null) {
      const res = insertarBloque(textarea.value, textarea.selectionStart, datos);
      textarea.value = res.texto;
      textarea.setSelectionRange(res.cursor, res.cursor);
      lblSubiendo.textContent = "Diagrama insertado. Guarda la página para publicarlo.";
      return { ok: true };
    }
    if (!pagina) return { ok: false, error: TEXTO_CONFLICTO };
    const { reemplazarDiagrama } = await import("../lib/hardware-md");
    const nuevoMd = reemplazarDiagrama(pagina.md, ctx.anterior, datos);
    if (nuevoMd === null) return { ok: false, error: TEXTO_CONFLICTO };
    const res = await api("PUT", { cuerpo: { pagina: pagina.slug, md: nuevoMd, version: pagina.version } });
    if (res.status !== 200 || !res.json?.pagina) return { ok: false, error: resultadoGuardado(res.status).mensaje };
    indice = actualizarTituloIndice(indice, res.json.pagina);
    fuenteNueva = datos.fuente;
    await pintarPagina(res.json.pagina);
    mostrarEstado("Diagrama guardado");
    if (historial.open) void cargarHistorial();
    return { ok: true };
  }

  async function abrirDiagrama(editor: EditorDiagrama, fuente: string | null, titulo: string, anterior: string | null, disparador: HTMLElement) {
    try {
      const { abrirEditorDiagrama } = await import("./diagramas");
      await abrirEditorDiagrama({
        editor,
        fuente,
        titulo,
        disparador,
        alGuardar: (r) => guardarDiagrama({ editor, titulo, anterior }, r),
        confirmarDescartar: () => preguntar(dlgDescartar),
      });
    } catch {
      mostrarError(mensajeError("red"));
    }
  }

  escuchar(lectura, "click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button.hw-diagrama-editar");
    if (!b || !editable || !pagina) return;
    const fuenteId = b.dataset.fuente ?? "";
    const editor = b.dataset.editor === "drawio" ? "drawio" : "excalidraw";
    const titulo = b.closest("figure")?.querySelector("figcaption")?.textContent ?? "";
    mostrarError("");
    b.disabled = true;
    mostrarEstado("Descargando diagrama…");
    let texto: string | null = null;
    try {
      const r = await fetch(`/api/archivos/?${new URLSearchParams({ proyecto, id: fuenteId })}`, { credentials: "same-origin", cache: "no-store" });
      if (r.ok) texto = await r.text();
      else mostrarError(msg(r.status));
    } catch {
      mostrarError(msg(0));
    }
    b.disabled = false;
    mostrarEstado("");
    if (texto === null) return;
    fuenteNueva = "";
    await abrirDiagrama(editor, texto, titulo, fuenteId, b);
    if (!document.activeElement || document.activeElement === document.body) {
      // Tras guardar, la página se repinta y el botón de origen ya no existe: se enfoca el del mismo diagrama (id de fuente nuevo).
      const botones = [...lectura.querySelectorAll<HTMLButtonElement>("button.hw-diagrama-editar")];
      (botones.find((x) => x.dataset.fuente === fuenteNueva || x.dataset.fuente === fuenteId) ?? botones[0] ?? btnEditar).focus();
    }
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
    btnInsertarDiagrama.focus();
  });
  escuchar(formDiagramaNuevo, "submit", async (e) => {
    e.preventDefault();
    const editor = new FormData(formDiagramaNuevo).get("editor") === "drawio" ? "drawio" : "excalidraw";
    const titulo = limpiarTitulo(String(new FormData(formDiagramaNuevo).get("titulo") ?? ""));
    dlgDiagramaNuevo.close();
    await abrirDiagrama(editor, null, titulo, null, btnInsertarDiagrama);
  });

  // ---------- carga ----------
  async function cargarIndice(): Promise<boolean> {
    const r = await api("GET");
    if (r.status !== 200 || !Array.isArray(r.json?.paginas)) {
      mostrarEstado("");
      mostrarError(msg(r.status));
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
        mostrarError(msg(r.status));
      }
      return;
    }
    editable = r.json.editable === true;
    for (const el of soloEditor) el.hidden = !editable;
    vista("pagina");
    mostrarEstado("");
    await pintarPagina(r.json.pagina);
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
      mostrarError(msg(r.status));
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
  const hayCambios = () => editando && textarea.value !== baseMd;

  function modoEditor(modo: "escribir" | "previa") {
    for (const t of pestanas) {
      const activa = t.dataset.hwTab === modo;
      t.setAttribute("aria-selected", String(activa));
      t.tabIndex = activa ? 0 : -1;
    }
    panelEscribir.hidden = modo !== "escribir";
    btnInsertarDiagrama.hidden = modo !== "escribir";
    previa.hidden = modo !== "previa";
  }

  async function mostrarPrevia() {
    modoEditor("previa");
    errorEditor("");
    await pintarMd(previa, textarea.value, pagina?.titulo);
  }

  function abrirEditor() {
    if (!pagina || !editable) return;
    editando = true;
    baseMd = pagina.md;
    textarea.value = pagina.md;
    errorEditor("");
    modoEditor("escribir");
    lectura.hidden = true;
    form.hidden = false;
    for (const el of soloEditor) if (el.closest("[data-hw-pagina]")) el.hidden = true;
    textarea.focus();
  }

  function cerrarEditor() {
    editando = false;
    form.hidden = true;
    lectura.hidden = false;
    previa.textContent = "";
    errorEditor("");
    for (const el of soloEditor) el.hidden = !editable;
    btnEditar.focus();
  }

  escuchar(btnEditar, "click", abrirEditor);
  escuchar(btnCancelar, "click", async () => {
    mostrarEstado("");
    if (hayCambios() && !(await preguntar(dlgDescartar))) {
      textarea.focus();
      return;
    }
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

  escuchar(form, "submit", async (e) => {
    e.preventDefault();
    if (!pagina) return;
    errorEditor("");
    if (subidasActivas > 0) {
      actualizarGuardar(true);
      return;
    }
    mostrarEstado("");
    guardando = true;
    actualizarGuardar();
    const r = await api("PUT", { cuerpo: { pagina: pagina.slug, md: textarea.value, version: pagina.version } });
    guardando = false;
    actualizarGuardar();
    if (r.status !== 200 || !r.json?.pagina) {
      // Con 409 (u otro error) el textarea conserva lo escrito.
      errorEditor(resultadoGuardado(r.status).mensaje);
      return;
    }
    cerrarEditor();
    indice = actualizarTituloIndice(indice, r.json.pagina);
    await pintarPagina(r.json.pagina);
    mostrarEstado("Guardado");
    if (historial.open) void cargarHistorial();
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
      errNueva.textContent = msg(r.status);
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
    const res = resultadoBorrado(r.status);
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
      historialEstado.textContent = msg(r.status);
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
      historialEstado.textContent = msg(r.status);
      return;
    }
    indice = actualizarTituloIndice(indice, r.json.pagina);
    await pintarPagina(r.json.pagina);
    mostrarEstado("Versión restaurada");
    await cargarHistorial();
  });

  // ---------- subida de archivos ----------
  function insertar(texto: string) {
    if (guardando) return;
    const r = insertarEnTexto(textarea.value, textarea.selectionStart, textarea.selectionEnd, texto);
    textarea.value = r.texto;
    textarea.setSelectionRange(r.cursor, r.cursor);
  }

  // Sin avance durante este tiempo se aborta: el SDK reintenta en silencio los fallos de red y, sin esto, la barra
  // se quedaría en 0 sin decir nada.
  const SIN_AVANCE_MS = 45_000;

  // Modo de subida que anuncia el servidor (el HTML es el mismo en Vercel y Cloudflare). Se consulta una vez por página.
  let modoSubida: Promise<"directa" | "blob"> | null = null;
  function modoDeSubida(): Promise<"directa" | "blob"> {
    modoSubida ??= (async () => {
      // Dentro del límite de inactividad: si el servidor no responde, la consulta se corta y no deja la subida colgada.
      const cortar = new AbortController();
      alAbortar(senal, () => cortar.abort());
      const t = setTimeout(() => cortar.abort(), SIN_AVANCE_MS);
      try {
        const r = await fetch("/api/archivos/?capacidades=1", { credentials: "same-origin", signal: cortar.signal });
        if (!r.ok) return "blob";
        const j = await r.json();
        return j?.subida === "directa" ? "directa" : "blob";
      } catch {
        // Un fallo de red no se cachea: la siguiente subida vuelve a consultar.
        modoSubida = null;
        throw new TypeError("red");
      } finally {
        clearTimeout(t);
      }
    })();
    return modoSubida;
  }

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
  async function subir(archivo: File, diagrama?: { id: string; fallo: (texto: string) => void }): Promise<boolean> {
    errorEditor("");
    mostrarEstado("");
    const nombre = String(archivo?.name ?? "archivo");
    const quien = diagrama ? "El diagrama" : nombre; // en diagramas no se muestran nombres de archivo
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const v = validarArchivo(archivo);
      if (!v.ok) {
        if (diagrama) diagrama.fallo(`${quien}: ${v.error}`);
        else errorEditor(`${nombre}: ${v.error}`);
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
        // Cada subida puede cancelar su espera de la consulta compartida (corte), para llegar siempre al finally.
        const cancelada = new Promise<never>((_, rechazar) => {
          if (corte.signal.aborted) return rechazar(new TypeError("abortado"));
          alAbortar(corte.signal, () => rechazar(new TypeError("abortado")));
        });
        cancelada.catch(() => {});
        if ((await Promise.race([modoDeSubida(), cancelada])) === "directa") {
          await subirDirecto(archivo, id, corte.signal, (cargado, total) => {
            armar();
            progreso.value = porcentaje(cargado, total);
          });
        } else {
          await upload(rutaBlob(proyecto, disciplina, id, archivo.name), archivo, {
            access: "private",
            handleUploadUrl: "/api/archivos/",
            clientPayload: JSON.stringify({ proyecto, disciplina, nombre: archivo.name, tamano: archivo.size }),
            abortSignal: corte.signal,
            onUploadProgress: ({ loaded, total }) => {
              armar();
              progreso.value = porcentaje(loaded, total);
            },
          });
        }
      } catch (err) {
        if (sinAvance) throw new TypeError("sin avance");
        throw err;
      }
      if (!diagrama) insertar(enlaceArchivo({ proyecto, id, nombre: archivo.name, imagen: v.imagen }));
      lblSubiendo.textContent = diagrama ? "" : `${nombre} subido`;
      return true;
    } catch (err) {
      // El SDK no expone el estado HTTP del token (400, 403, 413 o 429): se da una causa general.
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

  escuchar(inputArchivo, "change", async () => {
    const archivos = [...(inputArchivo.files ?? [])];
    inputArchivo.value = "";
    await subirVarios(archivos);
    textarea.focus();
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

  escuchar(globalThis, "beforeunload", (e) => {
    if (hayCambios()) e.preventDefault();
  });

  // ---------- arranque ----------
  void cargarRender().catch(() => {});
  if (await cargarIndice()) await mostrar();
}
