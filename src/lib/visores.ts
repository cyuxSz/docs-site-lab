// Visores de hardware (D1a): lógica pura de los bloques ```pdf, ```kicad, ```modelo y ```bom, sin dependencias (la usan el navegador, el renderizador y los tests).
//   ```pdf                            ```bom
//   archivo: <uuid>                   referencia,descripcion,cantidad,costo_unitario[,proveedor][,enlace]
//   titulo: Manual (opcional)         R1,Resistencia 10k,10,0.0032
//   ```                               ```
import { limpiarTitulo, MAX_TITULO } from "./diagramas.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------- PDF ----------
export interface DatosPdf {
  archivo: string;
  titulo: string;
}

const CLAVES_PDF = new Set(["archivo", "titulo"]);

// Cuerpo del bloque -> datos, o null si algo no cuadra (el bloque se muestra entonces como código normal).
export function parsearPdf(cuerpo: string): DatosPdf | null {
  const vistas = new Map<string, string>();
  for (const cruda of String(cuerpo ?? "").split(/\r\n|\r|\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const i = linea.indexOf(":");
    if (i < 1) return null;
    const clave = linea.slice(0, i).trim();
    if (!CLAVES_PDF.has(clave) || vistas.has(clave)) return null;
    vistas.set(clave, linea.slice(i + 1).trim());
  }
  const archivo = vistas.get("archivo")?.toLowerCase();
  const titulo = vistas.get("titulo") ?? "";
  if (!archivo || !UUID.test(archivo) || titulo.length > MAX_TITULO) return null;
  return { archivo, titulo };
}

export function bloquePdf(d: { archivo: string; titulo?: string }): string {
  const archivo = String(d?.archivo ?? "").toLowerCase();
  if (!UUID.test(archivo)) throw new Error("Identificador de PDF no válido");
  const titulo = limpiarTitulo(d.titulo ?? "");
  return `\`\`\`pdf\narchivo: ${archivo}\n${titulo ? `titulo: ${titulo}\n` : ""}\`\`\`\n`;
}

// ---------- KiCad ----------
export interface DatosKicad {
  archivo: string;
  respaldo: string;
  titulo: string;
}

export const MAX_KICAD_VISOR = 20 * 1024 * 1024;
const CLAVES_KICAD = new Set(["archivo", "respaldo", "titulo"]);

export function parsearKicad(cuerpo: string): DatosKicad | null {
  const vistas = new Map<string, string>();
  for (const cruda of String(cuerpo ?? "").split(/\r\n|\r|\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const i = linea.indexOf(":");
    if (i < 1) return null;
    const clave = linea.slice(0, i).trim();
    if (!CLAVES_KICAD.has(clave) || vistas.has(clave)) return null;
    vistas.set(clave, linea.slice(i + 1).trim());
  }
  const archivo = vistas.get("archivo")?.toLowerCase();
  const respaldo = vistas.get("respaldo")?.toLowerCase() ?? "";
  const titulo = vistas.get("titulo") ?? "";
  if (!archivo || !UUID.test(archivo) || titulo.length > MAX_TITULO) return null;
  if (vistas.has("respaldo") && (!UUID.test(respaldo) || respaldo === archivo)) return null;
  return { archivo, respaldo, titulo };
}

export function bloqueKicad(d: { archivo: string; respaldo?: string; titulo?: string }): string {
  const archivo = String(d?.archivo ?? "").toLowerCase();
  const respaldo = String(d?.respaldo ?? "").toLowerCase();
  if (!UUID.test(archivo)) throw new Error("Identificador de archivo de KiCad no válido");
  if (respaldo && !UUID.test(respaldo)) throw new Error("Identificador de respaldo no válido");
  const titulo = limpiarTitulo(d.titulo ?? "");
  return `\`\`\`kicad\narchivo: ${archivo}\n${respaldo ? `respaldo: ${respaldo}\n` : ""}${titulo ? `titulo: ${titulo}\n` : ""}\`\`\`\n`;
}

// Esquemático o PCB por el prefijo S-expression, tras quitar BOM y espacios iniciales.
export function tipoKicad(texto: string): "esquematico" | "pcb" | null {
  const t = String(texto ?? "").replace(/^[\uFEFF\s]+/, "");
  if (/^\(kicad_sch(?=[\s()])/.test(t)) return "esquematico";
  if (/^\(kicad_pcb(?=[\s()])/.test(t)) return "pcb";
  return null;
}

type ArchivoLista = { name: string; size: number };
export function archivosKicad(
  lista: ArchivoLista[],
): { ok: true; kicad: ArchivoLista; respaldo?: ArchivoLista } | { ok: false; error: string } {
  const archivos = Array.from(lista ?? []);
  const kicad = archivos.filter((a) => /\.kicad_(sch|pcb)$/i.test(String(a?.name ?? "")));
  const respaldo = archivos.filter((a) => /\.(pdf|svg)$/i.test(String(a?.name ?? "")));
  if (kicad.length !== 1) return { ok: false, error: "Elige exactamente un archivo .kicad_sch o .kicad_pcb" };
  if (respaldo.length > 1) return { ok: false, error: "Como respaldo elige como máximo un PDF o SVG" };
  if (kicad.length + respaldo.length !== archivos.length) return { ok: false, error: "Solo se admiten un .kicad_sch o .kicad_pcb y, opcionalmente, un PDF o SVG de respaldo" };
  return respaldo.length ? { ok: true, kicad: kicad[0], respaldo: respaldo[0] } : { ok: true, kicad: kicad[0] };
}

// ---------- Modelo 3D ----------
// Bloque ```modelo: mismas claves que ```pdf (archivo, titulo). El archivo es un STL o un GLB ya subido como adjunto.
export interface DatosModelo {
  archivo: string;
  titulo: string;
}

export const MAX_MODELO_VISOR = 20 * 1024 * 1024;
// Tope del chunk JSON de un GLB: por encima no se decodifica ni se parsea.
export const MAX_JSON_GLB = 4 * 1024 * 1024;
// Topes de complejidad: por encima el modelo no se muestra (queda el enlace de descarga). Los triángulos son la suma de todo
// lo que se dibuja; las texturas, el lado mayor de cada imagen y la suma de píxeles de las imágenes distintas.
export const MAX_TRIANGULOS_MODELO = 500_000;
export const MAX_LADO_TEXTURA_MODELO = 4096;
export const MAX_PIXELES_TEXTURAS_MODELO = 4 * 4096 * 4096;
// Presupuesto de memoria de un GLB: suma de los bytes que declaran todos sus accessors (count × componentes × bytes).
export const MAX_BYTES_ACCESSORS_GLB = 64 * 1024 * 1024;

export const parsearModelo = (cuerpo: string): DatosModelo | null => parsearPdf(cuerpo);

export function bloqueModelo(d: { archivo: string; titulo?: string }): string {
  const archivo = String(d?.archivo ?? "").toLowerCase();
  if (!UUID.test(archivo)) throw new Error("Identificador de modelo no válido");
  const titulo = limpiarTitulo(d.titulo ?? "");
  return `\`\`\`modelo\narchivo: ${archivo}\n${titulo ? `titulo: ${titulo}\n` : ""}\`\`\`\n`;
}

// Validación previa a la subida desde el menú «Insertar»: un solo .stl o .glb que el visor pueda cargar.
export function archivoModelo(lista: ArchivoLista[]): { ok: true; archivo: ArchivoLista } | { ok: false; error: string } {
  const archivos = Array.from(lista ?? []);
  if (archivos.length !== 1 || !/\.(stl|glb)$/i.test(String(archivos[0]?.name ?? ""))) return { ok: false, error: "Elige exactamente un archivo .stl o .glb" };
  const archivo = archivos[0];
  if (!Number.isFinite(archivo.size) || archivo.size > MAX_MODELO_VISOR) return { ok: false, error: 'El visor muestra modelos de hasta 20 MB. Súbelo con "Adjuntar archivo".' };
  return { ok: true, archivo };
}

const MAGIA_GLB = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"

// Tipo por contenido, no por extensión: magia glTF, STL binario (84 + 50·n bytes exactos) o STL ASCII (empieza por «solid»).
export function tipoModelo(bytes: ArrayBuffer): "glb" | "stl" | null {
  const largo = bytes?.byteLength ?? 0;
  if (largo < 5) return null;
  const v = new DataView(bytes);
  if (v.getUint32(0, true) === MAGIA_GLB) return "glb";
  if (largo >= 84 && 84 + 50 * v.getUint32(80, true) === largo) return "stl";
  const inicio = new TextDecoder().decode(new Uint8Array(bytes, 0, Math.min(largo, 512))).replace(/^[﻿\s]+/, "");
  return /^solid(?:\s|$)/.test(inicio) ? "stl" : null;
}

const COMPRESION_GLB = new Set(["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_texture_basisu"]);
// Las dos tablas de glTF 2 (las mismas que usa GLTFLoader). Map, para que «constructor» o «__proto__» no pasen por válidos.
const COMPONENTES_ACCESSOR = new Map<unknown, number>([["SCALAR", 1], ["VEC2", 2], ["VEC3", 3], ["VEC4", 4], ["MAT2", 4], ["MAT3", 9], ["MAT4", 16]]);
const BYTES_COMPONENTE = new Map<unknown, number>([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);
export type InspeccionGlb = { ok: true } | { ok: false; motivo: "formato" | "externo" | "comprimido" | "complejo" };

// Un GLB es contenido no confiable: se revisa antes de dárselo a GLTFLoader. Debe ser glTF 2 autocontenido (ninguna uri en
// buffers ni images: una relativa haría un GET con cookies al portal) y sin compresión que necesite decodificadores aparte.
export function inspeccionarGlb(bytes: ArrayBuffer): InspeccionGlb {
  const formato: InspeccionGlb = { ok: false, motivo: "formato" };
  const largo = bytes?.byteLength ?? 0;
  if (largo < 20) return formato;
  const v = new DataView(bytes);
  if (v.getUint32(0, true) !== MAGIA_GLB || v.getUint32(4, true) !== 2 || v.getUint32(8, true) !== largo) return formato;
  const largoJson = v.getUint32(12, true);
  if (v.getUint32(16, true) !== CHUNK_JSON || largoJson > MAX_JSON_GLB || 20 + largoJson > largo) return formato;
  // GLTFLoader recorre todos los chunks y se queda con el último JSON: aquí se admite uno solo, el primero, y el resto
  // (BIN o desconocidos) tiene que cubrir exactamente el archivo.
  for (let o = 20 + largoJson; o < largo; ) {
    if (largo - o < 8) return formato;
    const largoChunk = v.getUint32(o, true);
    if (v.getUint32(o + 4, true) === CHUNK_JSON || largoChunk > largo - o - 8) return formato;
    o += 8 + largoChunk;
  }
  let json: any;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes, 20, largoJson)));
  } catch {
    return formato;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return formato;
  for (const clave of ["buffers", "images", "extensionsUsed", "extensionsRequired"]) {
    if (json[clave] !== undefined && !Array.isArray(json[clave])) return formato;
  }
  for (const clave of ["buffers", "images"]) {
    for (const x of json[clave] ?? []) {
      if (!x || typeof x !== "object") return formato;
      if ("uri" in x) return { ok: false, motivo: "externo" };
    }
  }
  for (const clave of ["extensionsUsed", "extensionsRequired"]) {
    if ((json[clave] ?? []).some((e: unknown) => COMPRESION_GLB.has(e as string))) return { ok: false, motivo: "comprimido" };
  }
  // Tamaño declarado, lo último: GLTFLoader reserva `count` elementos por accessor (sin bufferView, un arreglo a ceros; si es
  // disperso, una copia), así que un JSON de pocos bytes puede pedir gigas antes de que se pueda medir nada. Dos topes: los
  // elementos de cada accessor y los bytes de todos juntos. Se recorren todos antes de decidir: uno mal formado gana.
  if (json.accessors !== undefined && !Array.isArray(json.accessors)) return formato;
  let complejo = false;
  let declarados = 0;
  for (const a of json.accessors ?? []) {
    if (!a || typeof a !== "object" || Array.isArray(a) || !Number.isInteger(a.count) || a.count < 0) return formato;
    const componentes = COMPONENTES_ACCESSOR.get(a.type);
    const porComponente = BYTES_COMPONENTE.get(a.componentType);
    if (componentes === undefined || porComponente === undefined) return formato;
    if (a.count > 3 * MAX_TRIANGULOS_MODELO) complejo = true;
    declarados += a.count * componentes * porComponente;
  }
  if (complejo || !(declarados <= MAX_BYTES_ACCESSORS_GLB)) return { ok: false, motivo: "complejo" };
  return { ok: true };
}

// ---------- BOM ----------
export const MAX_FILAS_BOM = 500;
export const MAX_CELDA_BOM = 200;
export const MAX_BOM_BYTES = 64 * 1024;
const MAX_CANTIDAD = 1_000_000;

export interface FilaBom {
  referencia: string;
  descripcion: string;
  cantidad: number;
  costoUnitario: number;
  subtotal: number;
  proveedor?: string;
  enlace?: string;
}
export interface Bom {
  filas: FilaBom[];
  totales: { cantidad: number; costo: number };
  opcionales: { proveedor: boolean; enlace: boolean };
}
export type ResultadoBom = { ok: true; bom: Bom } | { ok: false; error: string };

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const normalizarCabecera = (s: string) => sinAcentos(s).toLowerCase().replace(/[_\s]+/g, " ").trim();
const limpiarCelda = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();

// CSV (RFC 4180) -> registros. null si una comilla queda sin cerrar.
function leerCsv(texto: string, sep: string): string[][] | null {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
    } else if (c === '"' && campo === "") enComillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else campo += c;
  }
  if (enComillas) return null;
  if (campo !== "" || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

const COSTO = /^\$?(\d{1,9})(?:\.(\d{1,4}))?$/;
const fallo = (e: string): { ok: false; error: string } => ({ ok: false, error: e });

function enlaceValido(v: string): boolean {
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Costo en diezmilésimos (entero), o null.
const costoEntero = (v: string): bigint | null => {
  const m = COSTO.exec(v);
  return m ? BigInt(m[1]) * 10000n + BigInt((m[2] ?? "").padEnd(4, "0")) : null;
};

// Diezmilésimos -> pesos redondeados a centavos.
const centavos = (diezmilesimas: bigint): number => Number((diezmilesimas + 50n) / 100n) / 100;

// Separador de la cabecera: cuenta "," y ";" solo fuera de comillas (misma regla que leerCsv: comillas dobladas, apertura al inicio del campo).
export function detectarSeparador(texto: string): "," | ";" {
  let comas = 0;
  let puntos = 0;
  let enComillas = false;
  let inicioCampo = true;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') i++;
        else enComillas = false;
      }
      continue;
    }
    if (c === '"' && inicioCampo) {
      enComillas = true;
      inicioCampo = false;
    } else if (c === "\r" || c === "\n") break;
    else if (c === ",") {
      comas++;
      inicioCampo = true;
    } else if (c === ";") {
      puntos++;
      inicioCampo = true;
    } else inicioCampo = false;
  }
  return puntos > comas ? ";" : ",";
}

export function parsearBom(csv: string): ResultadoBom {
  const texto = String(csv ?? "").replace(/^﻿/, "");
  if (!texto.trim()) return fallo("El CSV está vacío");
  const registros = leerCsv(texto, detectarSeparador(texto));
  if (!registros) return fallo("El CSV tiene comillas sin cerrar");
  if (!registros.length) return fallo("El CSV no tiene registros");

  const idx = new Map<string, number>();
  registros[0].forEach((h, i) => {
    const n = normalizarCabecera(h);
    if (!idx.has(n)) idx.set(n, i);
  });
  for (const n of ["referencia", "descripcion", "cantidad", "costo unitario"]) {
    if (!idx.has(n)) return fallo(`Falta la columna obligatoria: ${n}`);
  }
  const iRef = idx.get("referencia")!;
  const iDes = idx.get("descripcion")!;
  const iCan = idx.get("cantidad")!;
  const iCos = idx.get("costo unitario")!;
  const iPro = idx.get("proveedor");
  const iEnl = idx.get("enlace");
  const usadas = [iRef, iDes, iCan, iCos, iPro, iEnl].filter((i): i is number => i !== undefined);

  const filas: FilaBom[] = [];
  let totalCantidad = 0;
  let totalCosto = 0n;
  for (let n = 1; n < registros.length; n++) {
    const reg = registros[n];
    if (reg.every((c) => !limpiarCelda(c))) continue; // línea en blanco
    if (filas.length >= MAX_FILAS_BOM) return fallo(`El BOM admite como máximo ${MAX_FILAS_BOM} filas`);
    const num = n + 1; // la cabecera es la fila 1
    const celda = (i: number | undefined) => limpiarCelda(i === undefined ? "" : (reg[i] ?? ""));
    for (const i of usadas) if (celda(i).length > MAX_CELDA_BOM) return fallo(`Fila ${num}: una celda supera ${MAX_CELDA_BOM} caracteres`);
    const referencia = celda(iRef);
    if (!referencia) return fallo(`Fila ${num}: referencia vacía`);
    const cantTexto = celda(iCan);
    const cantidad = /^\d{1,7}$/.test(cantTexto) ? Number(cantTexto) : -1;
    if (cantidad < 0 || cantidad > MAX_CANTIDAD) return fallo(`Fila ${num}: cantidad no válida`);
    const costo = costoEntero(celda(iCos));
    if (costo === null) return fallo(`Fila ${num}: costo unitario no válido`);
    const enlace = celda(iEnl);
    if (enlace && !enlaceValido(enlace)) return fallo(`Fila ${num}: enlace no válido (solo http o https)`);
    const sub = BigInt(cantidad) * costo;
    const fila: FilaBom = { referencia, descripcion: celda(iDes), cantidad, costoUnitario: Number(costo) / 10000, subtotal: Number(sub) / 10000 };
    if (iPro !== undefined) fila.proveedor = celda(iPro);
    if (iEnl !== undefined) fila.enlace = enlace;
    filas.push(fila);
    totalCantidad += cantidad;
    totalCosto += sub;
  }
  if (!filas.length) return fallo(`El BOM necesita entre 1 y ${MAX_FILAS_BOM} filas de datos`);
  return {
    ok: true,
    bom: { filas, totales: { cantidad: totalCantidad, costo: centavos(totalCosto) }, opcionales: { proveedor: iPro !== undefined, enlace: iEnl !== undefined } },
  };
}

// Celda del CSV canónico del bloque: entre comillas si hace falta; una celda que empiece por ` o ~ nunca puede cerrar el bloque.
const celdaBloque = (v: string) => (/[",;]|^[`~]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function bloqueBom(bom: Bom): string {
  const { proveedor, enlace } = bom.opcionales;
  const cab = ["referencia", "descripcion", "cantidad", "costo_unitario", ...(proveedor ? ["proveedor"] : []), ...(enlace ? ["enlace"] : [])];
  const lineas = [cab.join(",")];
  for (const f of bom.filas) {
    const c = [celdaBloque(f.referencia), celdaBloque(f.descripcion), String(f.cantidad), String(f.costoUnitario)];
    if (proveedor) c.push(celdaBloque(f.proveedor ?? ""));
    if (enlace) c.push(celdaBloque(f.enlace ?? ""));
    lineas.push(c.join(","));
  }
  return `\`\`\`bom\n${lineas.join("\n")}\n\`\`\`\n`;
}

// Inyección de fórmulas (Excel, LibreOffice, Sheets): un apóstrofo delante si la celda empieza por = + - @ (aunque lleve espacios antes).
export const celdaSegura = (v: string): string => (/^\s*[=+\-@]/.test(v) ? `'${v}` : v);

export function csvBom(bom: Bom): string {
  const { proveedor, enlace } = bom.opcionales;
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const texto = (v: string | undefined) => q(celdaSegura(v ?? ""));
  const cab = ["Referencia", "Descripción", "Cantidad", "Costo unitario", ...(proveedor ? ["Proveedor"] : []), ...(enlace ? ["Enlace"] : [])];
  const lineas = [cab.map(q).join(",")];
  for (const f of bom.filas) {
    const c = [texto(f.referencia), texto(f.descripcion), q(String(f.cantidad)), q(String(f.costoUnitario))];
    if (proveedor) c.push(texto(f.proveedor));
    if (enlace) c.push(texto(f.enlace));
    lineas.push(c.join(","));
  }
  return "﻿" + lineas.map((l) => l + "\r\n").join("");
}

export function nombreCsvBom(slug: string, i: number): string {
  const base = sinAcentos(String(slug ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `bom${base ? `-${base}` : ""}${i > 0 ? `-${i + 1}` : ""}.csv`;
}

const conMiles = (entero: string) => entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// Dos decimales y separador de miles (es-MX).
export function formatoCosto(n: number): string {
  const [e, d] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${conMiles(e)}.${d}`;
}
export const formatoCantidad = (n: number): string => conMiles(String(Math.trunc(n)));
// Costo unitario: de 2 a 4 decimales, sin ceros de más.
export function formatoUnitario(n: number): string {
  const [e, d = ""] = n.toFixed(4).split(".");
  return `${conMiles(e)}.${d.replace(/0{1,2}$/, "").padEnd(2, "0")}`;
}

// ---------- Editor ----------
// Inserta el bloque en la posición del cursor separado por líneas en blanco del texto vecino.
export function insertarBloqueTexto(texto: string, cursor: number, bloque: string): { texto: string; cursor: number } {
  const c = Math.max(0, Math.min(cursor, texto.length));
  const antes = texto.slice(0, c);
  const despues = texto.slice(c);
  const prefijo = !antes || antes.endsWith("\n\n") ? "" : antes.endsWith("\n") ? "\n" : "\n\n";
  const sufijo = !despues || despues.startsWith("\n") ? "" : "\n";
  const nuevo = antes + prefijo + bloque + sufijo;
  return { texto: nuevo + despues, cursor: nuevo.length };
}

export const tituloDeArchivo = (nombre: string): string => limpiarTitulo(String(nombre ?? "").replace(/\.[^.]*$/, ""));

export function bomDeArchivo(archivo: { name: string; size: number }, texto: string): ResultadoBom {
  if (!/\.csv$/i.test(String(archivo?.name ?? ""))) return fallo("Solo se admiten archivos .csv");
  const contenido = String(texto ?? "");
  if (!Number.isFinite(archivo.size) || archivo.size > MAX_BOM_BYTES || new TextEncoder().encode(contenido).length > MAX_BOM_BYTES) {
    return fallo(`El archivo es demasiado grande (máximo ${MAX_BOM_BYTES / 1024} KB)`);
  }
  return parsearBom(contenido.replace(/^﻿/, ""));
}
