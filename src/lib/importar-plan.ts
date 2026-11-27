// Importar páginas desde .md o .zip: lógica pura del plan. De las entradas ya leídas sale qué páginas se crean, qué
// imágenes se suben y qué se omite (avisos). Sin DOM ni red: la usan importar-zip.ts, importar-cola.ts y
// src/scripts/hardware-importar.ts, y la cubre tests/c1-importar-plan.test.mjs.
import { sanearNombre } from "../../lib/archivos-nombre.mjs";
import { enlaceArchivo, slugDeTitulo, slugUnico, urlPagina } from "./hardware-editor.ts";

const KB = 1024;
const MB = 1024 * KB;
export const LIMITES = Object.freeze({ zip: 50 * MB, entradas: 500, md: 200 * KB, imagen: 10 * MB, total: 100 * MB, paginas: 50 });
export type Limites = { -readonly [K in keyof typeof LIMITES]: number };
export const EXT_IMAGEN = ["png", "jpg", "jpeg", "webp", "svg"];

export const MENSAJE_SELECCION = "Elige uno o varios .md, o un solo .zip.";
export const MENSAJE_EDICION_ABIERTA = "Guarda o cancela la edición antes de importar";

// "50 MB", "200 KB": para los mensajes de límite.
export const tamano = (bytes: number): string => (bytes >= MB ? `${Math.round(bytes / MB)} MB` : `${Math.round(bytes / KB)} KB`);

// Motivos por los que una entrada se omite. Los comparten la lectura del zip y el análisis.
export const MOTIVO = {
  ruta: "ruta no permitida",
  tipo: "tipo de archivo no admitido",
  repetido: "nombre repetido",
  utf8: "no está en UTF-8",
  grande: (limite: number) => `pasa de ${tamano(limite)}`,
  paginas: (limite: number) => `solo se importan ${limite} páginas a la vez`,
};

export interface Aviso {
  ruta: string;
  motivo: string;
}
export interface Entrada {
  ruta: string;
  bytes: Uint8Array;
}
export interface PaginaPlan {
  ruta: string;
  titulo: string;
  slug: string;
  md: string;
  imagenes: string[];
}
export interface ImagenPlan {
  ruta: string;
  nombre: string;
  bytes: Uint8Array;
}
export interface Plan {
  paginas: PaginaPlan[];
  imagenes: ImagenPlan[];
  avisos: Aviso[];
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const extensionDe = (nombre: string): string => {
  const i = nombre.lastIndexOf(".");
  return i > 0 ? nombre.slice(i + 1).toLowerCase() : "";
};
const nombreDe = (ruta: string): string => ruta.slice(ruta.lastIndexOf("/") + 1);
const carpetaDe = (ruta: string): string => ruta.slice(0, Math.max(0, ruta.lastIndexOf("/")));
const sinExtensionMd = (ruta: string): string => nombreDe(ruta).replace(/\.md$/i, "");

// ---------- selección y rutas ----------

export type Seleccion = { tipo: "sueltos" } | { tipo: "zip" } | { tipo: "error"; mensaje: string };

// Uno o varios .md, o un solo .zip. Cualquier otra combinación es un error.
export function clasificarSeleccion(nombres: string[]): Seleccion {
  const ext = nombres.map(extensionDe);
  if (ext.length === 1 && ext[0] === "zip") return { tipo: "zip" };
  if (ext.length >= 1 && ext.every((e) => e === "md")) return { tipo: "sueltos" };
  return { tipo: "error", mensaje: MENSAJE_SELECCION };
}

export type TipoRuta = "md" | "imagen" | "otro" | "ignorar" | "insegura";

// Ruta de una entrada: normalizada (\ → /, sin segmentos vacíos ni «.») y clasificada. «insegura» va antes que
// «ignorar»: un «..» o una ruta absoluta se avisan aunque estén en una carpeta oculta.
export function clasificarRuta(cruda: string): { tipo: TipoRuta; ruta: string } {
  const barras = String(cruda ?? "").replace(/\\/g, "/");
  const segmentos = barras.split("/");
  if (CONTROL.test(barras) || barras.startsWith("/") || /^[A-Za-z]:/.test(barras) || segmentos.includes("..")) return { tipo: "insegura", ruta: barras };
  const limpios = segmentos.filter((s) => s !== "" && s !== ".");
  const ruta = limpios.join("/");
  const esCarpeta = barras.endsWith("/");
  if (!limpios.length || esCarpeta || limpios[0] === "__MACOSX" || limpios.some((s) => s.startsWith("."))) return { tipo: "ignorar", ruta };
  const ext = extensionDe(limpios[limpios.length - 1]);
  return { tipo: ext === "md" ? "md" : EXT_IMAGEN.includes(ext) ? "imagen" : "otro", ruta };
}

// ---------- texto del .md ----------

// UTF-8 estricto (no se adivina otra codificación). El decodificador ya quita el BOM; aquí solo se unifican los saltos.
export function decodificarMd(bytes: Uint8Array): { ok: true; texto: string } | { ok: false } {
  try {
    return { ok: true, texto: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n/g, "\n") };
  } catch {
    return { ok: false };
  }
}

const MAX_TITULO = 120;
// Sin caracteres de control, sin espacios en los extremos y como mucho 120 (sin partir un par suplente).
function limpiarTitulo(texto: string): string {
  return texto
    .replace(/\t/g, " ")
    .replace(new RegExp(CONTROL.source, "g"), "")
    .trim()
    .slice(0, MAX_TITULO)
    .replace(/[\ud800-\udbff]$/, "")
    .trim();
}

interface Tramo {
  texto: string;
  codigo: boolean;
}

// Parte el md en tramos de texto y bloques de código cercados (``` o ~~~). Unidos con "\n" dan el md original.
function tramos(md: string): Tramo[] {
  const salida: Tramo[] = [];
  let lineas: string[] = [];
  let cerca: string | null = null; // la cerca que abrió el bloque en curso
  const cerrar = (codigo: boolean) => {
    if (lineas.length) salida.push({ texto: lineas.join("\n"), codigo });
    lineas = [];
  };
  for (const linea of md.split("\n")) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(linea);
    if (cerca === null) {
      // Tras una cerca de ``` no puede haber más acentos graves: eso es código en línea, no un bloque.
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        cerrar(false);
        cerca = m[1];
      }
      lineas.push(linea);
    } else {
      lineas.push(linea);
      if (m && m[1][0] === cerca[0] && m[1].length >= cerca.length && m[2].trim() === "") {
        cerrar(true);
        cerca = null;
      }
    }
  }
  cerrar(cerca !== null);
  return salida;
}

// Título de la página: el primer encabezado «# » fuera de bloques de código; si no hay o queda vacío, el nombre del archivo.
export function tituloDeMd(md: string, archivo: string): string {
  const delArchivo = () => limpiarTitulo(sinExtensionMd(String(archivo ?? "").replace(/\\/g, "/"))) || "Página";
  for (const tramo of tramos(md)) {
    if (tramo.codigo) continue;
    for (const linea of tramo.texto.split("\n")) {
      const m = /^ {0,3}#[ \t]+(.*)$/.exec(linea);
      // Se quita la secuencia de cierre opcional («# Título #»).
      if (m) return limpiarTitulo(` ${m[1]}`.replace(/[ \t]+#+[ \t]*$/, "")) || delArchivo();
    }
  }
  return delArchivo();
}

// ---------- imágenes y enlaces ----------

// Un tramo de código en línea (acentos graves) o el principio de un enlace o imagen: «[texto](» o «![alt](».
const INICIO = /(`+)|(!?)\[([^\]\n]{0,1000})\]\(/g;
// Destino entre <…>, con título opcional, hasta el paréntesis de cierre.
const DESTINO_ANGULOS = /[ \t]*<([^<>\n]{0,2048})>(?:[ \t]+(?:"[^"\n]{0,2048}"|'[^'\n]{0,2048}'))?[ \t]*\)/y;
const TOPE_DESTINO = 2048;

interface Enlace {
  imagen: boolean;
  texto: string;
  destino: string;
}
type Cambio = (enlace: Enlace) => string | null;

// Busca `c` desde `desde` recordando el último resultado: como las consultas van hacia delante, el coste total es lineal.
function buscador(texto: string, c: string): (desde: number) => number {
  let visto = -2;
  return (desde) => (visto === -1 || visto >= desde ? visto : (visto = texto.indexOf(c, desde)));
}

// Recorre los enlaces e imágenes de un tramo de texto (nunca dentro de código en línea) y sustituye los que `cambio`
// devuelva distintos de null. El resto del texto queda idéntico.
function sustituir(texto: string, cambio: Cambio): string {
  const inicio = new RegExp(INICIO.source, "g");
  const cierre = buscador(texto, ")");
  const salto = buscador(texto, "\n");
  const parrafo = buscador(texto, "\n\n");

  // Destino sin <…>: hasta el «)» que cierra, con paréntesis emparejados dentro («foto (1).png») y sin el título final.
  const leerDestino = (desde: number): { destino: string; fin: number } | null => {
    DESTINO_ANGULOS.lastIndex = desde;
    const angulos = DESTINO_ANGULOS.exec(texto);
    if (angulos) return { destino: angulos[1].trim(), fin: DESTINO_ANGULOS.lastIndex };
    let nivel = 0;
    let i = desde;
    for (; i < texto.length && i - desde <= TOPE_DESTINO; i++) {
      const c = texto[i];
      if (c === "\n") return null;
      if (c === "(") nivel++;
      else if (c === ")" && nivel-- === 0) break;
    }
    if (i - desde > TOPE_DESTINO) {
      // Destino muy largo (una imagen data: incrustada): vale el primer «)» de la línea, sin más análisis.
      i = cierre(desde);
      const finLinea = salto(desde);
      if (i < 0 || (finLinea >= 0 && finLinea < i)) return null;
      return { destino: texto.slice(desde, i), fin: i + 1 };
    }
    if (i >= texto.length) return null;
    let destino = texto.slice(desde, i).trim();
    const comilla = destino[destino.length - 1];
    if (comilla === '"' || comilla === "'") {
      const abre = destino.lastIndexOf(comilla, destino.length - 2);
      if (abre > 0 && /[ \t]/.test(destino[abre - 1])) destino = destino.slice(0, abre).trimEnd();
    }
    return { destino, fin: i + 1 };
  };

  // Fin del código en línea que abre una racha de `n` acentos: la siguiente racha igual dentro del mismo párrafo.
  const finDeCodigo = (desde: number, n: number): number => {
    const limite = parrafo(desde) < 0 ? texto.length : parrafo(desde);
    const rachas = /`+/g;
    rachas.lastIndex = desde;
    for (let m; (m = rachas.exec(texto)) && m.index < limite; ) if (m[0].length === n) return rachas.lastIndex;
    return -1;
  };

  let salida = "";
  let copiado = 0;
  for (let m; (m = inicio.exec(texto)); ) {
    if (m[1]) {
      const fin = finDeCodigo(inicio.lastIndex, m[1].length);
      if (fin >= 0) inicio.lastIndex = fin;
      continue;
    }
    const leido = leerDestino(inicio.lastIndex);
    if (!leido) continue;
    inicio.lastIndex = leido.fin;
    const nuevo = cambio({ imagen: m[2] === "!", texto: m[3], destino: leido.destino });
    if (nuevo === null) continue;
    salida += texto.slice(copiado, m.index) + nuevo;
    copiado = leido.fin;
  }
  return salida + texto.slice(copiado);
}

// Aplica `cambio` a los enlaces e imágenes del md, saltando los bloques de código.
function recorrer(md: string, cambio: Cambio): string {
  return tramos(md)
    .map((t) => (t.codigo ? t.texto : sustituir(t.texto, cambio)))
    .join("\n");
}

const esExterna = (destino: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(destino) || destino.startsWith("//");

// Ruta dentro del lote a la que apunta un destino relativo a `carpeta`; null si sale de la raíz.
function resolver(carpeta: string, destino: string): string | null {
  let relativo = destino;
  try {
    relativo = decodeURIComponent(destino);
  } catch {
    // Un % suelto no es una secuencia válida: se toma el destino tal cual.
  }
  const pila = carpeta ? carpeta.split("/") : [];
  for (const segmento of relativo.replace(/\\/g, "/").split("/")) {
    if (segmento === "" || segmento === ".") continue;
    if (segmento !== "..") pila.push(segmento);
    else if (!pila.length) return null;
    else pila.pop();
  }
  return pila.join("/");
}

// Búsqueda de rutas del lote: coincidencia exacta y, si no, sin distinguir mayúsculas (gana la primera).
function indiceDeRutas(rutas: Iterable<string>): (ruta: string | null) => string | null {
  const exactas = new Set<string>();
  const minusculas = new Map<string, string>();
  for (const r of rutas) {
    exactas.add(r);
    if (!minusculas.has(r.toLowerCase())) minusculas.set(r.toLowerCase(), r);
  }
  return (ruta) => (ruta === null ? null : exactas.has(ruta) ? ruta : (minusculas.get(ruta.toLowerCase()) ?? null));
}

const MAX_DESTINO_AVISO = 80;
const abreviar = (destino: string): string => (destino.length > MAX_DESTINO_AVISO ? `${destino.slice(0, MAX_DESTINO_AVISO)}…` : destino);

// ---------- análisis ----------

// De las entradas (del zip o de .md sueltos) al plan. Vuelve a aplicar las reglas de ruta aunque el zip ya las pasó.
// Todos los títulos y slugs quedan decididos aquí, antes de la primera escritura.
export function analizar({ entradas, existentes, avisos: previos = [] }: { entradas: Entrada[]; existentes: string[]; avisos?: Aviso[] }): Plan {
  const avisos = [...previos];
  const vistas = new Set<string>();
  const imagenes = new Map<string, Uint8Array>();
  let textos: { ruta: string; md: string }[] = [];

  for (const entrada of entradas) {
    const { tipo, ruta } = clasificarRuta(entrada.ruta);
    if (tipo === "ignorar") continue;
    if (tipo === "insegura" || tipo === "otro") {
      avisos.push({ ruta, motivo: tipo === "insegura" ? MOTIVO.ruta : MOTIVO.tipo });
      continue;
    }
    if (vistas.has(ruta.toLowerCase())) {
      avisos.push({ ruta, motivo: MOTIVO.repetido });
      continue;
    }
    vistas.add(ruta.toLowerCase());
    const limite = tipo === "md" ? LIMITES.md : LIMITES.imagen;
    if (entrada.bytes.length > limite) {
      avisos.push({ ruta, motivo: MOTIVO.grande(limite) });
      continue;
    }
    if (tipo === "imagen") {
      imagenes.set(ruta, entrada.bytes);
      continue;
    }
    const md = decodificarMd(entrada.bytes);
    if (md.ok) textos.push({ ruta, md: md.texto });
    else avisos.push({ ruta, motivo: MOTIVO.utf8 });
  }

  // Orden por unidades de código (sin locale): el mismo en cualquier navegador.
  textos.sort((a, b) => (a.ruta < b.ruta ? -1 : a.ruta > b.ruta ? 1 : 0));
  for (const sobra of textos.slice(LIMITES.paginas)) avisos.push({ ruta: sobra.ruta, motivo: MOTIVO.paginas(LIMITES.paginas) });
  textos = textos.slice(0, LIMITES.paginas);

  const buscarImagen = indiceDeRutas(imagenes.keys());
  const slugs = [...existentes];
  const usadas = new Set<string>();
  const paginas = textos.map(({ ruta, md }): PaginaPlan => {
    const titulo = tituloDeMd(md, ruta);
    const slug = slugUnico(slugDeTitulo(titulo) || slugDeTitulo(sinExtensionMd(ruta)) || "pagina", slugs);
    slugs.push(slug);
    const propias = new Set<string>();
    const avisadas = new Set<string>();
    const avisar = (destino: string, motivo: string) => {
      if (!avisadas.has(destino)) avisos.push({ ruta, motivo });
      avisadas.add(destino);
    };
    recorrer(md, ({ imagen, destino }) => {
      if (!imagen || !destino || destino.startsWith("#") || destino.startsWith("/api/archivos/")) return null;
      if (esExterna(destino)) {
        avisar(destino, `«${abreviar(destino)}»: las imágenes externas no se muestran`);
        return null;
      }
      const hallada = destino.startsWith("/") ? null : buscarImagen(resolver(carpetaDe(ruta), destino));
      if (hallada === null) avisar(destino, `la imagen «${abreviar(destino)}» no venía en el archivo`);
      else {
        propias.add(hallada);
        usadas.add(hallada);
      }
      return null;
    });
    return { ruta, titulo, slug, md, imagenes: [...propias] };
  });

  return { paginas, imagenes: [...usadas].map((ruta) => ({ ruta, nombre: sanearNombre(ruta), bytes: imagenes.get(ruta)! })), avisos };
}

// ---------- reescritura ----------

export interface ContextoReescritura {
  ruta: string; // la del .md, para resolver los destinos relativos
  proyecto: string;
  disciplina: string;
  slugs: Map<string, string>; // ruta del .md → slug de su página
  subidas: Map<string, { id: string; nombre: string }>; // ruta de la imagen → adjunto ya subido
}

// Cambia las imágenes ya subidas por su enlace de /api/archivos/ y los enlaces a otros .md del lote por la URL de su
// página. Lo demás (imágenes sin subir, externas, HTML, código) queda byte a byte como estaba.
export function reescribirMd(md: string, { ruta, proyecto, disciplina, slugs, subidas }: ContextoReescritura): string {
  const carpeta = carpetaDe(ruta);
  const buscarSubida = indiceDeRutas(subidas.keys());
  const buscarPagina = indiceDeRutas(slugs.keys());
  return recorrer(md, ({ imagen, texto, destino }) => {
    if (!destino || esExterna(destino) || destino.startsWith("/") || destino.startsWith("#")) return null;
    if (imagen) {
      const hallada = buscarSubida(resolver(carpeta, destino));
      if (hallada === null) return null;
      const { id, nombre } = subidas.get(hallada)!;
      // El svg no se muestra en línea en el portal: queda como enlace normal, igual que al adjuntarlo a mano.
      const enlace = enlaceArchivo({ proyecto, id, nombre, imagen: !/\.svg$/i.test(nombre) });
      const alt = texto.replace(/[[\]\r\n]/g, "").trim();
      return alt ? enlace.replace(/\[[^\]]*\]/, () => `[${alt}]`) : enlace;
    }
    const sinAncla = destino.replace(/#.*$/, "");
    if (!/\.md$/i.test(sinAncla)) return null;
    const hallada = buscarPagina(resolver(carpeta, sinAncla));
    return hallada === null ? null : `[${texto}](${urlPagina(proyecto, disciplina, slugs.get(hallada)!)})`;
  });
}

// ---------- resumen de la revisión ----------

// Escrituras que hará la importación: crear y guardar cada página, y subir cada imagen.
export const escrituras = (plan: Pick<Plan, "paginas" | "imagenes">): number => plan.paginas.length * 2 + plan.imagenes.length;

// El servidor admite 10 escrituras por minuto: las 10 primeras no esperan y cada 10 más cuestan un minuto.
export const minutosEstimados = (n: number): number => Math.floor(Math.max(0, n - 1) / 10);

export function textoResumen(plan: Pick<Plan, "paginas" | "imagenes">): string {
  const paginas = plan.paginas.length;
  const imagenes = plan.imagenes.length;
  if (!paginas) return "No hay ninguna página para importar.";
  let texto = paginas === 1 ? "Se creará 1 página" : `Se crearán ${paginas} páginas`;
  if (imagenes) texto += imagenes === 1 ? " y se subirá 1 imagen" : ` y se subirán ${imagenes} imágenes`;
  const minutos = minutosEstimados(escrituras(plan));
  return minutos >= 2 ? `${texto}. Tardará unos ${minutos} min por el límite de escrituras.` : `${texto}.`;
}
