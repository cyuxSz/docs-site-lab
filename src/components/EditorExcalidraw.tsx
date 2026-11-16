// Editor Excalidraw para los diagramas de hardware (C1). Solo se alcanza con import() desde src/scripts/diagramas.ts:
// la lectura de una página nunca descarga estos trozos. Las fuentes salen de este origen (window.EXCALIDRAW_ASSET_PATH,
// que fija quien llama antes de importar este módulo) y el SVG se exporta sin incrustar fuentes (skipInliningFonts),
// así no corre el subsetting WASM/embind que necesitaría 'unsafe-eval'.
import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, exportToSvg, serializeAsJSON } from "@excalidraw/excalidraw";
// ?url: el CSS no se eleva a la página (Astro lo enlazaría en la lectura); se inyecta al montar el editor.
import estilos from "@excalidraw/excalidraw/index.css?url";

export interface ExcalidrawMontado {
  // Fuente (.excalidraw, JSON) y SVG de lo que hay ahora en el lienzo.
  exportar(): Promise<{ fuente: string; svg: string }>;
  desmontar(): void;
}

function Lienzo({ fuente, alCambiar, alListo }: { fuente: string | null; alCambiar: () => void; alListo: (api: any) => void }) {
  const base = useRef<string | null>(null);
  let inicial: any;
  if (fuente) {
    const d = JSON.parse(fuente);
    inicial = { elements: d.elements ?? [], appState: { viewBackgroundColor: d.appState?.viewBackgroundColor }, files: d.files ?? {}, scrollToContent: true };
  }
  return (
    <Excalidraw
      excalidrawAPI={alListo}
      initialData={inicial}
      langCode="es-ES"
      onChange={(elementos: readonly any[]) => {
        // Cambios reales del dibujo (no selección ni desplazamiento): huella de ids y versiones.
        const huella = elementos.map((e) => `${e.id}:${e.version}`).join(",");
        if (base.current === null) base.current = huella;
        else if (huella !== base.current) {
          base.current = huella;
          alCambiar();
        }
      }}
    />
  );
}

export function montarExcalidraw(contenedor: HTMLElement, { fuente, alCambiar }: { fuente: string | null; alCambiar: () => void }): ExcalidrawMontado {
  if (!document.head.querySelector("link[data-excalidraw-css]")) {
    const enlace = document.createElement("link");
    enlace.rel = "stylesheet";
    enlace.href = estilos;
    enlace.dataset.excalidrawCss = "";
    document.head.append(enlace);
  }
  let api: any = null;
  const raiz = createRoot(contenedor);
  raiz.render(<Lienzo fuente={fuente} alCambiar={alCambiar} alListo={(a) => (api = a)} />);
  return {
    async exportar() {
      if (!api) throw new Error("El editor todavía no está listo");
      const elementos = api.getSceneElements();
      const appState = api.getAppState();
      const archivos = api.getFiles();
      const json = serializeAsJSON(elementos, appState, archivos, "local");
      const svg = await exportToSvg({ elements: elementos, appState: { ...appState, exportBackground: true }, files: archivos, skipInliningFonts: true } as any);
      return { fuente: json, svg: new XMLSerializer().serializeToString(svg) };
    },
    desmontar() {
      raiz.unmount();
    },
  };
}
