// Interfaz del editor de diagramas de hardware (C1): un <dialog> modal a pantalla completa con Excalidraw (import() diferido)
// o diagrams.net (iframe + postMessage). Este módulo solo se carga al pulsar "Insertar diagrama" o "Editar diagrama".
// No sube nada: entrega la fuente y el SVG a `alGuardar` (src/scripts/hardware-editor.ts) y cierra si responde ok.
import {
  confirmarCierre,
  enviarDrawio,
  ESTADO_INICIAL,
  estadoEditor,
  esSvg,
  mensajeDrawio,
  RUTA_ASSETS_EXCALIDRAW,
  fuentesSoloDeOrigen,
  svgDeExport,
  urlDrawio,
  type EditorDiagrama,
  type EstadoEditor,
} from "../lib/diagramas";

export interface OpcionesEditor {
  editor: EditorDiagrama;
  fuente: string | null; // texto de la fuente existente (null: diagrama nuevo)
  titulo: string;
  disparador: HTMLElement | null; // botón que lo abrió: recibe el foco al cerrar
  alGuardar: (r: { fuente: string; svg: string }) => Promise<{ ok: true } | { ok: false; error: string }>;
  confirmarDescartar: () => Promise<boolean>;
}

// Excalidraw 0.18 añade siempre https://esm.sh/... como última fuente de cada FontFace y Chrome comprueba la CSP de todas al
// construirla (230 errores aunque la local exista). Se envuelve FontFace para quitar las fuentes de otros orígenes.
function soloFuentesLocales(): void {
  const w = window as unknown as { FontFace: typeof FontFace; __fuentesLocales?: boolean };
  if (w.__fuentesLocales) return;
  w.__fuentesLocales = true;
  const Original = w.FontFace;
  w.FontFace = class extends Original {
    constructor(familia: string, origen: string | BufferSource, descriptores?: FontFaceDescriptors) {
      super(familia, typeof origen === "string" ? fuentesSoloDeOrigen(origen, location.origin) : origen, descriptores);
    }
  };
}

const NOMBRES: Record<EditorDiagrama, string> = { excalidraw: "Excalidraw", drawio: "diagrams.net" };

// Abre el editor y se resuelve cuando el diálogo se cierra (guardado, cerrado o descartado).
export function abrirEditorDiagrama(o: OpcionesEditor): Promise<void> {
  const dlg = document.querySelector<HTMLDialogElement>("#hw-diagrama")!;
  const lienzo = dlg.querySelector<HTMLElement>("[data-hw-diag-lienzo]")!;
  const btnGuardar = dlg.querySelector<HTMLButtonElement>("[data-hw-diag-guardar]")!;
  const btnCerrar = dlg.querySelector<HTMLButtonElement>("[data-hw-diag-cerrar]")!;
  const lblEstado = dlg.querySelector<HTMLElement>("[data-hw-diag-estado]")!;
  const lblError = dlg.querySelector<HTMLElement>("[data-hw-diag-error]")!;
  const titulo = dlg.querySelector<HTMLElement>("#hw-diagrama-titulo")!;

  return new Promise<void>((resolver) => {
    const ctl = new AbortController();
    const { signal } = ctl;
    let estado: EstadoEditor = ESTADO_INICIAL;
    let listo = false;
    let cerrado = false;
    let preguntando = false;
    let limpiarEditor: () => void = () => {};
    let guardarActual: () => void = () => {};

    const anunciar = (texto: string) => (lblEstado.textContent = texto);
    const fallo = (texto: string) => {
      lblError.textContent = texto;
      lblError.hidden = !texto;
    };
    const evento = (e: "cambio" | "guardando" | "guardado" | "error") => {
      estado = estadoEditor(estado, e);
      btnGuardar.disabled = !listo || estado.guardando;
    };

    function cerrar() {
      if (cerrado) return;
      cerrado = true;
      ctl.abort();
      limpiarEditor();
      lienzo.replaceChildren();
      if (dlg.open) dlg.close();
      anunciar("");
      fallo("");
      if (o.disparador?.isConnected) o.disparador.focus();
      resolver();
    }

    async function pedirCierre() {
      if (cerrado || preguntando) return;
      if (confirmarCierre(estado)) {
        preguntando = true;
        let descartar = false;
        try {
          descartar = await o.confirmarDescartar();
        } finally {
          preguntando = false;
        }
        if (!descartar) return;
      }
      cerrar();
    }

    // Entrega el dibujo a quien sube los archivos. Si falla, el editor sigue abierto con el dibujo.
    async function entregar(r: { fuente: string; svg: string }, alFallar: () => void): Promise<void> {
      fallo("");
      if (!esSvg(r.svg)) {
        evento("error");
        fallo("El SVG exportado no es válido: no se subió nada.");
        alFallar();
        return;
      }
      anunciar("Guardando diagrama…");
      let res: Awaited<ReturnType<OpcionesEditor["alGuardar"]>>;
      try {
        res = await o.alGuardar(r);
      } catch {
        res = { ok: false, error: "No se pudo guardar el diagrama. Inténtalo de nuevo." };
      }
      if (cerrado) return;
      if (!res.ok) {
        evento("error");
        anunciar("");
        fallo(res.error);
        alFallar();
        return;
      }
      evento("guardado");
      anunciar("Diagrama guardado");
      cerrar();
    }

    titulo.textContent = `${o.fuente === null ? "Nuevo diagrama" : "Editar diagrama"} · ${NOMBRES[o.editor]}${o.titulo ? ` · ${o.titulo}` : ""}`;
    fallo("");
    anunciar(`Cargando ${NOMBRES[o.editor]}…`);
    btnGuardar.disabled = true;
    lienzo.replaceChildren();

    btnGuardar.addEventListener("click", () => guardarActual(), { signal });
    btnCerrar.addEventListener("click", () => void pedirCierre(), { signal });
    dlg.addEventListener(
      "cancel",
      (e) => {
        e.preventDefault(); // Escape: pasa por la confirmación
        void pedirCierre();
      },
      { signal },
    );
    window.addEventListener("beforeunload", (e) => (confirmarCierre(estado) ? e.preventDefault() : undefined), { signal });

    dlg.showModal();

    if (o.editor === "excalidraw") {
      void (async () => {
        try {
          (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = RUTA_ASSETS_EXCALIDRAW;
          soloFuentesLocales();
          const m = await import("../components/EditorExcalidraw");
          if (cerrado) return;
          const montado = m.montarExcalidraw(lienzo, { fuente: o.fuente, alCambiar: () => evento("cambio") });
          limpiarEditor = () => montado.desmontar();
          guardarActual = () => {
            if (!listo || estado.guardando) return;
            evento("guardando");
            btnGuardar.disabled = true;
            void (async () => {
              try {
                const r = await montado.exportar();
                await entregar(r, () => {});
              } catch {
                evento("error");
                anunciar("");
                fallo("No se pudo exportar el dibujo. Inténtalo de nuevo.");
              }
            })();
          };
          listo = true;
          btnGuardar.disabled = false;
          anunciar("Editor listo");
        } catch {
          anunciar("");
          fallo("No se pudo cargar Excalidraw. Revisa la conexión e inténtalo de nuevo.");
        }
      })();
      return;
    }

    // diagrams.net: init → load, save → export (svg) → export, exit.
    const marco = document.createElement("iframe");
    marco.title = "Editor diagrams.net";
    marco.className = "hw-diag-marco";
    marco.src = urlDrawio();
    let xml = o.fuente ?? "";
    let xmlConocido = o.fuente === null ? false : true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const quitarSpinner = () => enviarDrawio(marco.contentWindow, { action: "spinner", show: false });
    // Solo `export` con spinKey: diagrams.net muestra su propio spinner. Un {action:"spinner"} previo lo deja ocupado e ignora el export.
    const pedirExport = () => {
      evento("guardando");
      enviarDrawio(marco.contentWindow, { action: "export", format: "svg", spinKey: "saving" });
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        if (cerrado || !estado.guardando) return;
        quitarSpinner();
        evento("error");
        fallo("diagrams.net no respondió al guardar: no se subió nada. Inténtalo de nuevo.");
      }, 20000);
    };
    guardarActual = () => {
      if (!listo || estado.guardando) return;
      pedirExport();
    };
    window.addEventListener(
      "message",
      (e) => {
        const msg = mensajeDrawio(e, marco.contentWindow);
        if (!msg) return;
        switch (msg.event) {
          case "init":
            enviarDrawio(marco.contentWindow, { action: "load", xml: o.fuente ?? "", autosave: 1 });
            break;
          case "load":
            listo = true;
            btnGuardar.disabled = estado.guardando;
            anunciar("Editor listo");
            break;
          case "autosave":
            if (typeof msg.xml === "string") {
              xml = msg.xml;
              xmlConocido = true;
            }
            evento("cambio");
            break;
          case "save":
            if (typeof msg.xml === "string") {
              xml = msg.xml;
              xmlConocido = true;
            }
            if (!estado.guardando) pedirExport();
            break;
          case "export": {
            clearTimeout(temporizador);
            if (typeof msg.xml === "string") {
              xml = msg.xml;
              xmlConocido = true;
            }
            const svg = svgDeExport(msg.data);
            if (svg === null || !xmlConocido) {
              quitarSpinner();
              evento("error");
              fallo("diagrams.net no devolvió un SVG válido: no se subió nada.");
              break;
            }
            void entregar({ fuente: xml, svg }, quitarSpinner).then(() => (cerrado ? undefined : quitarSpinner()));
            break;
          }
          case "exit":
            if (msg.modified === true && !estado.sucio) evento("cambio");
            void pedirCierre();
            break;
        }
      },
      { signal },
    );
    limpiarEditor = () => {
      clearTimeout(temporizador);
      marco.remove();
    };
    lienzo.append(marco);
  });
}
