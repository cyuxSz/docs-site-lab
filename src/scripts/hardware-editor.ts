// Documentación de hardware (Electrónica / Mecánica): lectura, editor Markdown, índice, historial y subida de archivos.
// Habla con /api/hardware/ (misma sesión) y sube a Vercel Blob con upload() contra /api/archivos/. La lógica pura
// está en src/lib/hardware-editor.ts. El HTML del servidor llega ya saneado y entra al DOM por un único punto.
import { upload } from "@vercel/blob/client";
import { fechaRelativa } from "../lib/comentarios";
import {
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
  html: string;
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
  // Único punto por el que entra HTML del servidor (ya saneado allí; la CSP además bloquea scripts).
  function pintarHtml(destino: HTMLElement, html: string, titulo?: string) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nodos = [...doc.body.childNodes];
    if (titulo && !doc.body.querySelector("h1")) {
      const h1 = document.createElement("h1");
      h1.textContent = titulo;
      nodos.unshift(h1);
    }
    destino.replaceChildren(...nodos);
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

  function pintarPagina(p: PaginaHw) {
    pagina = p;
    pintarHtml(lectura, p.html, p.titulo);
    pintarMetadatos(p);
    document.title = `${p.titulo} · ${etiqueta}`;
    pintarIndice();
  }

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
    pintarPagina(r.json.pagina);
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
    previa.hidden = modo !== "previa";
  }

  async function mostrarPrevia() {
    modoEditor("previa");
    errorEditor("");
    previa.textContent = "Generando vista previa…";
    const r = await api("POST", { cuerpo: { accion: "previsualizar", md: textarea.value } });
    if (r.status !== 200 || typeof r.json?.html !== "string") {
      previa.textContent = "";
      errorEditor(msg(r.status));
      return;
    }
    pintarHtml(previa, r.json.html, pagina?.titulo);
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
    pintarPagina(r.json.pagina);
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
    pintarPagina(r.json.pagina);
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
      try {
        const r = await fetch("/api/archivos/?capacidades=1", { credentials: "same-origin", signal: senal });
        if (!r.ok) return "blob";
        const j = await r.json();
        return j?.subida === "directa" ? "directa" : "blob";
      } catch {
        return "blob";
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
      escuchar(corte, "abort", () => xhr.abort());
      if (corte.aborted) return xhr.abort();
      xhr.send(archivo);
    });
  }
  class ErrorSubida extends Error {
    constructor(readonly status: number) {
      super(`HTTP ${status}`);
    }
  }

  async function subir(archivo: File) {
    errorEditor("");
    mostrarEstado("");
    const nombre = String(archivo?.name ?? "archivo");
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      const v = validarArchivo(archivo);
      if (!v.ok) {
        errorEditor(`${nombre}: ${v.error}`);
        return;
      }
      const id = crypto.randomUUID();
      lblSubiendo.textContent = `Subiendo ${nombre}…`;
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
      escuchar(senal, "abort", () => corte.abort());
      try {
        if ((await modoDeSubida()) === "directa") {
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
      insertar(enlaceArchivo({ proyecto, id, nombre: archivo.name, imagen: v.imagen }));
      lblSubiendo.textContent = `${nombre} subido`;
    } catch (err) {
      // El SDK no expone el estado HTTP del token (400, 403, 413 o 429): se da una causa general.
      const red = err instanceof TypeError;
      lblSubiendo.textContent = "";
      if (err instanceof ErrorSubida) errorEditor(`${nombre}: ${mensajeError(err.status)}`);
      else errorEditor(red ? `${nombre}: ${mensajeError("red")}` : `No se pudo subir ${nombre}. Revisa el tipo y el tamaño, o espera un momento si subiste muchos archivos seguidos.`);
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
  if (await cargarIndice()) await mostrar();
}
