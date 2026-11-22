// Importar páginas: lectura de un .zip con límites. El archivo no es de fiar, así que el directorio central se lee a
// mano y cada entrada se infla por trozos con `new fflate.Inflate()`, contando los bytes que salen de verdad y parando
// en cuanto se pasa un límite (el tamaño que declaran las cabeceras no decide nada). fflate entra como parámetro: en el
// navegador es public/vendor/fflate/fflate.js. Sin DOM ni red; lo cubre tests/c1-importar-zip.test.mjs.
import { clasificarRuta, LIMITES, MOTIVO, tamano, type Aviso, type Limites } from "./importar-plan.ts";

export interface EntradaZip {
  ruta: string;
  tipo: "md" | "imagen";
  bytes: Uint8Array;
}
export type ResultadoZip = { ok: true; entradas: EntradaZip[]; avisos: Aviso[] } | { ok: false; error: string };

// Lo único que se usa de fflate: el inflador síncrono por trozos.
interface Inflador {
  ondata: (trozo: Uint8Array, final: boolean) => void;
  push(trozo: Uint8Array, final?: boolean): void;
}
export interface Fflate {
  Inflate: new () => Inflador;
}

const FIRMA_FIN = 0x06054b50; // fin del directorio central
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;
const TAM_FIN = 22;
const TAM_CENTRAL = 46;
const TAM_LOCAL = 30;
const SIN_DATO_16 = 0xffff; // en zip64 los campos de 16 y 32 bits van a tope y el valor real está en otro sitio
const SIN_DATO_32 = 0xffffffff;
const TROZO = 16 * 1024; // bytes comprimidos por llamada al inflador: acota cuánto se infla antes de poder cortar
const PAUSA_CADA = 4 * 1024 * 1024; // bytes procesados entre dos respiros al navegador

const ERROR_DANADO = "El zip está dañado o no es un archivo .zip.";
const ERROR_ZIP64 = "El zip usa el formato zip64, que no se admite.";

class ZipRechazado extends Error {}

const pausa = () => new Promise<void>((seguir) => setTimeout(seguir, 0));

// Nombre de una entrada: UTF-8 si lo es (lleve o no la marca) y, si no, byte a byte como Windows-1252.
function decodificarNombre(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// Posición del registro de fin del directorio central: al final del archivo, tras un comentario de hasta 64 KB.
function buscarFin(vista: DataView): number {
  const minimo = Math.max(0, vista.byteLength - TAM_FIN - SIN_DATO_16);
  for (let i = vista.byteLength - TAM_FIN; i >= minimo; i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN && i + TAM_FIN + vista.getUint16(i + 20, true) <= vista.byteLength) return i;
  }
  return -1;
}

// Lee el zip y devuelve los .md y las imágenes ya descomprimidos, más los avisos de lo que se omitió. Nunca lanza.
export async function leerZip(bytes: Uint8Array, fflate: Fflate, limites: Partial<Limites> = {}): Promise<ResultadoZip> {
  const L = { ...LIMITES, ...limites };
  try {
    if (bytes.length > L.zip) return { ok: false, error: `El zip pasa de ${tamano(L.zip)}.` };
    const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fin = buscarFin(vista);
    if (fin < 0) return { ok: false, error: ERROR_DANADO };
    const cuantas = vista.getUint16(fin + 10, true);
    let pos = vista.getUint32(fin + 16, true);
    if (cuantas === SIN_DATO_16 || pos === SIN_DATO_32) return { ok: false, error: ERROR_ZIP64 };
    if (cuantas > L.entradas) return { ok: false, error: `El zip tiene más de ${L.entradas} entradas.` };

    const entradas: EntradaZip[] = [];
    const avisos: Aviso[] = [];
    const vistas = new Set<string>();
    let total = 0; // bytes descomprimidos que ya se entregan
    let trabajo = 0; // bytes procesados desde el último respiro

    // Infla una entrada deflate por trozos. Devuelve sus bytes o el motivo por el que se omite; si lo que se pasa es
    // el total del zip, lo rechaza entero.
    const inflar = async (comprimido: Uint8Array, limite: number): Promise<Uint8Array | string> => {
      const partes: Uint8Array[] = [];
      let inflado = 0;
      const inflador = new fflate.Inflate();
      inflador.ondata = (trozo) => {
        inflado += trozo.length;
        if (inflado <= limite && total + inflado <= L.total) partes.push(trozo);
      };
      try {
        for (let i = 0; ; i += TROZO) {
          const ultimo = i + TROZO >= comprimido.length;
          inflador.push(comprimido.subarray(i, i + TROZO), ultimo);
          if (inflado > limite) return MOTIVO.grande(limite);
          if (total + inflado > L.total) throw new ZipRechazado(`El contenido descomprimido pasa de ${tamano(L.total)}.`);
          if (ultimo) break;
          trabajo += TROZO;
          if (trabajo >= PAUSA_CADA) {
            trabajo = 0;
            await pausa();
          }
        }
      } catch (e) {
        if (e instanceof ZipRechazado) throw e;
        return "está dañada";
      }
      const datos = new Uint8Array(inflado);
      let o = 0;
      for (const parte of partes) {
        datos.set(parte, o);
        o += parte.length;
      }
      return datos;
    };

    for (let n = 0; n < cuantas; n++) {
      if (pos + TAM_CENTRAL > bytes.length || vista.getUint32(pos, true) !== FIRMA_CENTRAL) return { ok: false, error: ERROR_DANADO };
      const banderas = vista.getUint16(pos + 8, true);
      const metodo = vista.getUint16(pos + 10, true);
      const tamComprimido = vista.getUint32(pos + 20, true);
      const tamDeclarado = vista.getUint32(pos + 24, true); // solo para reconocer zip64: no decide ningún límite
      const largoNombre = vista.getUint16(pos + 28, true);
      const largoExtra = vista.getUint16(pos + 30, true);
      const largoComentario = vista.getUint16(pos + 32, true);
      const local = vista.getUint32(pos + 42, true);
      if (pos + TAM_CENTRAL + largoNombre > bytes.length) return { ok: false, error: ERROR_DANADO };
      const nombre = decodificarNombre(bytes.subarray(pos + TAM_CENTRAL, pos + TAM_CENTRAL + largoNombre));
      pos += TAM_CENTRAL + largoNombre + largoExtra + largoComentario;

      // Solo se abren los .md y las imágenes con una ruta admitida; lo demás ni se infla.
      const { tipo, ruta } = clasificarRuta(nombre);
      if (tipo === "ignorar") continue;
      const omitir = (motivo: string) => avisos.push({ ruta, motivo });
      if (tipo === "insegura" || tipo === "otro") {
        omitir(tipo === "insegura" ? MOTIVO.ruta : MOTIVO.tipo);
        continue;
      }
      if (vistas.has(ruta.toLowerCase())) {
        omitir(MOTIVO.repetido);
        continue;
      }
      vistas.add(ruta.toLowerCase());
      if (banderas & 1) {
        omitir("está cifrada");
        continue;
      }
      if (tamComprimido === SIN_DATO_32 || tamDeclarado === SIN_DATO_32 || local === SIN_DATO_32) {
        omitir("usa el formato zip64, que no se admite");
        continue;
      }
      if (metodo !== 0 && metodo !== 8) {
        omitir("usa un método de compresión que no se admite");
        continue;
      }
      if (local + TAM_LOCAL > bytes.length || vista.getUint32(local, true) !== FIRMA_LOCAL) {
        omitir("está dañada");
        continue;
      }
      // La cabecera local repite el nombre y los campos extra con sus propios largos; los datos van después.
      const inicio = local + TAM_LOCAL + vista.getUint16(local + 26, true) + vista.getUint16(local + 28, true);
      if (inicio + tamComprimido > bytes.length) {
        omitir("está dañada");
        continue;
      }
      const comprimido = bytes.subarray(inicio, inicio + tamComprimido);
      const limite = tipo === "md" ? L.md : L.imagen;
      let datos: Uint8Array | string;
      if (metodo === 8) datos = await inflar(comprimido, limite);
      else if (comprimido.length > limite) datos = MOTIVO.grande(limite);
      else datos = comprimido.slice(); // sin comprimir: copia propia, para no retener el zip entero
      if (typeof datos === "string") {
        omitir(datos);
        continue;
      }
      total += datos.length;
      if (total > L.total) return { ok: false, error: `El contenido descomprimido pasa de ${tamano(L.total)}.` };
      trabajo += datos.length;
      if (trabajo >= PAUSA_CADA) {
        trabajo = 0;
        await pausa();
      }
      entradas.push({ ruta, tipo, bytes: datos });
    }
    return { ok: true, entradas, avisos };
  } catch (e) {
    return { ok: false, error: e instanceof ZipRechazado ? e.message : ERROR_DANADO };
  }
}
