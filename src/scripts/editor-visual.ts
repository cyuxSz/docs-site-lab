// Entrada del chunk diferido del editor visual: solo la pide hardware-editor.ts al pulsar «Editar» (import dinámico), así que
// la lectura no descarga el editor. El CSS de Crepe se importa por partes (no se usa su hoja completa, que trae KaTeX, ni sus
// temas) y con ?inline: así Astro no lo enlaza en el HTML de la lectura y se añade como <style> solo al abrir el editor.
import prosemirror from "@milkdown/crepe/theme/common/prosemirror.css?inline";
import reset from "@milkdown/crepe/theme/common/reset.css?inline";
import blockEdit from "@milkdown/crepe/theme/common/block-edit.css?inline";
import codeMirror from "@milkdown/crepe/theme/common/code-mirror.css?inline";
import cursor from "@milkdown/crepe/theme/common/cursor.css?inline";
import linkTooltip from "@milkdown/crepe/theme/common/link-tooltip.css?inline";
import listItem from "@milkdown/crepe/theme/common/list-item.css?inline";
import placeholder from "@milkdown/crepe/theme/common/placeholder.css?inline";
import toolbar from "@milkdown/crepe/theme/common/toolbar.css?inline";
import table from "@milkdown/crepe/theme/common/table.css?inline";
import "../styles/editor-visual.css";

if (!document.querySelector("style[data-editor-visual]")) {
  const estilo = document.createElement("style");
  estilo.dataset.editorVisual = "";
  estilo.textContent = [prosemirror, reset, blockEdit, codeMirror, cursor, linkTooltip, listItem, placeholder, toolbar, table].join("\n");
  document.head.prepend(estilo); // antes que el CSS del portal: sus reglas (editor-visual.css) deben poder ganar
}

export { montarCrepe } from "../lib/editor-visual-crepe";
export { markdownParaGuardar, vistaBloque } from "../lib/editor-visual.ts";
