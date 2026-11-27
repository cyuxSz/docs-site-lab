// Editor visual (Milkdown Crepe), parte pura: configuración y funciones sin Milkdown, para que Node y la lectura las carguen
// sin arrastrar el editor. Aquí se fija qué funciones de Crepe se usan, el estilo de Markdown al serializar, los lenguajes de
// CodeMirror, los textos en español, qué Markdown se guarda y las tarjetas de los bloques del portal (pdf, bom, diagrama).
import { diagramasDe } from "./hardware-md.ts";

// Funciones de Crepe que se montan. Cada una es una subruta `@milkdown/crepe/feature/<nombre>` (la entrada principal de Crepe
// importa KaTeX, remark-math y todos los lenguajes de CodeMirror, y no se usa).
export const FUNCIONES_ACTIVAS: string[] = ["cursor", "list-item", "link-tooltip", "block-edit", "placeholder", "toolbar", "code-mirror", "table"];
// Fuera: el portal no renderiza fórmulas; ImageBlock guarda la proporción en el alt y borra el nombre de la imagen.
export const FUNCIONES_DESACTIVADAS: string[] = ["ai", "top-bar", "latex", "image-block"];

// Mismo estilo de Markdown que usa el portal.
export const OPCIONES_MARKDOWN = { bullet: "-", emphasis: "*", strong: "*", rule: "-" } as const;

// Lenguajes de CodeMirror que se cargan (máximo 16). Cada uno va en su propio chunk y solo se pide al usarse.
export const LENGUAJES_CODEMIRROR: string[] = ["C", "C++", "Python", "JSON", "YAML", "XML", "Shell", "CMake", "Markdown", "JavaScript", "TypeScript", "HTML", "CSS"];

export const ETIQUETA_EDITOR = "Contenido de la página";

export const TEXTOS = {
  placeholder: { text: "Escribe, o teclea / para insertar…", mode: "block" as const },
  blockEdit: {
    textGroup: {
      label: "Texto",
      text: { label: "Párrafo" },
      h1: { label: "Título 1" },
      h2: { label: "Título 2" },
      h3: { label: "Título 3" },
      h4: { label: "Título 4" },
      h5: { label: "Título 5" },
      h6: { label: "Título 6" },
      quote: { label: "Cita" },
      divider: { label: "Separador" },
    },
    listGroup: { label: "Listas", bulletList: { label: "Lista" }, orderedList: { label: "Lista numerada" }, taskList: { label: "Tareas" } },
    advancedGroup: { label: "Avanzado", codeBlock: { label: "Código" }, table: { label: "Tabla" } },
  },
  codeMirror: {
    searchPlaceholder: "Buscar lenguaje",
    noResultText: "Sin resultados",
    copyText: "Copiar",
    previewLabel: "Vista",
    previewLoading: "Cargando…",
    previewOnlyByDefault: true,
    previewToggleText: (soloVista: boolean) => (soloVista ? "Modificar" : "Ocultar vista"),
  },
  toolbar: { boldLabel: "Negrita", italicLabel: "Cursiva", strikethroughLabel: "Tachado", codeLabel: "Código en línea", linkLabel: "Enlace" },
  linkTooltip: { inputPlaceholder: "Pega o escribe el enlace…" },
};

// Qué Markdown se guarda: si en modo visual no se tocó nada, el original byte a byte (el serializador solo rellena tablas, etc.).
export function markdownParaGuardar({ actual, inicialEditor, origen }: { actual: string; inicialEditor: string; origen: string }): string {
  return actual === inicialEditor ? origen : actual;
}

// Tarjeta HTML de un bloque del portal, a partir del renderizador de la lectura (marked + DOMPurify). null = se ve como código.
export function vistaBloque(html: (md: string) => string, lenguaje: string, contenido: string, { editable }: { editable: boolean }): string | null {
  if (lenguaje !== "pdf" && lenguaje !== "kicad" && lenguaje !== "modelo" && lenguaje !== "bom" && lenguaje !== "diagrama") return null;
  // Un título con marcas HTML no se pinta como tarjeta (se ve como código): el saneado lo escaparía, pero así no entra ni como texto.
  if (lenguaje !== "bom" && /^\s*titulo\s*:.*[<>]/im.test(contenido)) return null;
  const corridas = String(contenido).match(/`+/g) ?? [];
  const valla = "`".repeat(Math.max(3, ...corridas.map((c) => c.length + 1)));
  const md = `${valla}${lenguaje}\n${contenido}\n${valla}\n`;
  let salida: string;
  try {
    salida = html(md);
  } catch {
    return null;
  }
  const clase = lenguaje === "pdf" ? "hw-pdf" : lenguaje === "kicad" ? "hw-kicad" : lenguaje === "modelo" ? "hw-modelo" : lenguaje === "bom" ? "hw-bom" : "hw-diagrama";
  if (!salida.startsWith(`<figure class="${clase}">`)) return null; // no parsea: se queda como código
  if (lenguaje === "diagrama" && editable) {
    const d = diagramasDe(md)[0];
    if (!d) return null;
    const fuente = String(d.fuente).replace(/[^\w-]/g, "");
    const editor = d.editor === "drawio" ? "drawio" : "excalidraw";
    const boton = `<button type="button" class="btn hw-diagrama-editar" data-fuente="${fuente}" data-editor="${editor}">Editar diagrama</button>`;
    salida = salida.replace(/<\/figure>\s*$/, `${boton}</figure>`);
  }
  return salida;
}
