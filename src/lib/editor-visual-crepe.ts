// Montaje de Milkdown Crepe para las páginas de hardware (sin CSS: corre también en Node/jsdom). Usa CrepeBuilder y solo las
// subrutas de las funciones activas (nunca la entrada completa de Crepe), para no arrastrar las funciones que no se usan.
import { CrepeBuilder } from "@milkdown/crepe/builder";
import { blockEdit } from "@milkdown/crepe/feature/block-edit";
import { codeMirror } from "@milkdown/crepe/feature/code-mirror";
import { cursor } from "@milkdown/crepe/feature/cursor";
import { linkTooltip } from "@milkdown/crepe/feature/link-tooltip";
import { listItem } from "@milkdown/crepe/feature/list-item";
import { placeholder } from "@milkdown/crepe/feature/placeholder";
import { table } from "@milkdown/crepe/feature/table";
import { toolbar } from "@milkdown/crepe/feature/toolbar";
import { editorViewCtx, editorViewOptionsCtx, parserCtx, remarkStringifyOptionsCtx } from "@milkdown/kit/core";
import { indentPlugin } from "@milkdown/kit/plugin/indent";
import { uploadConfig } from "@milkdown/kit/plugin/upload";
import { Slice } from "@milkdown/kit/prose/model";
import { insert, replaceAll } from "@milkdown/kit/utils";
import { languages } from "@codemirror/language-data";
import { defaultHandlers } from "mdast-util-to-markdown";
import { ETIQUETA_EDITOR, LENGUAJES_CODEMIRROR, OPCIONES_MARKDOWN, TEXTOS } from "./editor-visual.ts";

type Manejador = (node: any, parent: any, state: any, info: any) => string;

// Milkdown escribe una barra invertida delante de cada & en las URLs de /api/archivos/?proyecto=...&id=..., y eso cambiaría
// el Markdown guardado. Solo para esas URLs (caracteres seguros) se serializa con un marcador y se devuelve la URL tal cual;
// el resto sigue con el manejador por defecto.
const URL_ARCHIVO = /^\/api\/archivos\/\?[\w=&%.~-]*$/;
function manejadorConUrlIntacta(base: Manejador): Manejador {
  return (node, parent, state, info) => {
    const url = String(node?.url ?? "");
    if (!URL_ARCHIVO.test(url)) return base(node, parent, state, info);
    const marca = "zzurlintacta0zz";
    return base({ ...node, url: marca }, parent, state, info).replace(marca, () => url);
  };
}

export interface OpcionesCrepe {
  // Tarjeta HTML de un bloque de código (pdf, bom, diagrama) o null para dejarlo como código.
  renderizarBloque?: (lenguaje: string, contenido: string) => string | null;
  alCambiar?: (markdown: string) => void;
}

export async function montarCrepe(raiz: HTMLElement, md: string, opciones: OpcionesCrepe = {}) {
  const crepe = new CrepeBuilder({ root: raiz, defaultValue: md });
  const lenguajes = languages.filter((l) => LENGUAJES_CODEMIRROR.includes(l.name));
  crepe
    .addFeature(cursor)
    .addFeature(listItem)
    .addFeature(linkTooltip, TEXTOS.linkTooltip)
    .addFeature(blockEdit, TEXTOS.blockEdit as any)
    .addFeature(placeholder, TEXTOS.placeholder)
    .addFeature(toolbar, TEXTOS.toolbar)
    .addFeature(codeMirror, {
      ...TEXTOS.codeMirror,
      languages: lenguajes,
      renderPreview: (lenguaje: string, contenido: string) => opciones.renderizarBloque?.(lenguaje, contenido) ?? null,
    } as any)
    .addFeature(table);

  crepe.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev: any) => ({
      ...prev,
      ...OPCIONES_MARKDOWN,
      handlers: {
        ...prev.handlers,
        link: manejadorConUrlIntacta((prev.handlers?.link ?? defaultHandlers.link) as Manejador),
        image: manejadorConUrlIntacta((prev.handlers?.image ?? defaultHandlers.image) as Manejador),
      },
    }));
    // Las subidas van por el flujo del portal (pegar y soltar se interceptan antes): nunca entra una imagen blob:.
    ctx.update(uploadConfig.key, (prev: any) => ({ ...prev, uploader: async () => [] }));
    ctx.update(editorViewOptionsCtx, (prev: any) => ({
      ...prev,
      attributes: { ...(typeof prev.attributes === "object" ? prev.attributes : {}), "aria-label": ETIQUETA_EDITOR, role: "textbox", "aria-multiline": "true" },
    }));
  });
  // Sin el atajo Tab del plugin indent: en un párrafo Tab sale del editor hacia los botones de acción.
  crepe.editor.remove(indentPlugin);
  if (opciones.alCambiar) {
    const alCambiar = opciones.alCambiar;
    crepe.on((l) => l.markdownUpdated((_ctx: unknown, markdown: string) => alCambiar(markdown)));
  }
  await crepe.create();
  const editor = crepe.editor;
  const vista = editor.action((ctx) => ctx.get(editorViewCtx));
  return {
    editor,
    vista,
    getMarkdown: () => crepe.getMarkdown(),
    insertarMarkdown: (texto: string, { enLinea = false }: { enLinea?: boolean } = {}) =>
      void editor.action((ctx) => {
        // En línea (enlaces e imágenes de archivo): se inserta el contenido del párrafo ya parseado. `insert(..., true)` pasa por el DOM
        // y Milkdown copiaría el alt de la imagen a su título; así el Markdown sale tal cual.
        const doc = enLinea ? ctx.get(parserCtx)(texto) : null;
        const parrafo = doc && doc.childCount === 1 && doc.firstChild?.type.name === "paragraph" ? doc.firstChild : null;
        if (!parrafo) return insert(texto, false)(ctx);
        vista.dispatch(vista.state.tr.replaceSelection(new Slice(parrafo.content, 0, 0)).scrollIntoView());
      }),
    reemplazarTodo: (texto: string) => void editor.action(replaceAll(texto)),
    enfocar: () => vista.focus(),
    setSoloLectura: (v: boolean) => void crepe.setReadonly(v),
    destruir: async () => void (await crepe.destroy()),
  };
}
export type EditorVisual = Awaited<ReturnType<typeof montarCrepe>>;
