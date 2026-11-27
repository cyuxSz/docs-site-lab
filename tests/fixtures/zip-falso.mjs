// Escritor de zips para pruebas, independiente de fflate (usa node:zlib). Permite fabricar zips honestos y también
// tramposos: tamaño declarado falso, entrada cifrada, zip64, método de compresión no soportado o datos comprimidos rotos.
import { deflateRawSync, crc32 } from "node:zlib";

const u8 = (v) => (typeof v === "string" ? new TextEncoder().encode(v) : v);

// entradas: [{ nombre, datos, metodo = 8, declarado, cifrado, zip64, crudo }]
//   nombre:    string (UTF-8, bit 11) o Uint8Array (bytes tal cual, sin bit 11)
//   datos:     string o Uint8Array con el contenido real
//   metodo:    8 deflate, 0 stored, otro = se escribe ese número con los datos sin comprimir
//   declarado: tamaño descomprimido que DICEN las cabeceras (por defecto, el real)
//   cifrado:   pone el bit 0 de las banderas
//   zip64:     tamaños 0xFFFFFFFF y campo extra 0x0001 con los reales; versión necesaria 45
//   crudo:     bytes comprimidos a escribir en lugar de comprimir `datos` (para datos rotos)
export function crearZip(entradas) {
  const partes = [];
  const central = [];
  let pos = 0;
  for (const e of entradas) {
    const nombre = u8(e.nombre);
    const datos = u8(e.datos ?? "");
    const metodo = e.metodo ?? 8;
    const comprimido = e.crudo ?? (metodo === 8 ? new Uint8Array(deflateRawSync(datos, { level: 9 })) : datos);
    const banderas = (typeof e.nombre === "string" ? 0x800 : 0) | (e.cifrado ? 1 : 0);
    const real = e.declarado ?? datos.length;
    let extra = new Uint8Array(0);
    if (e.zip64) {
      extra = new Uint8Array(20);
      const x = new DataView(extra.buffer);
      x.setUint16(0, 1, true);
      x.setUint16(2, 16, true);
      x.setBigUint64(4, BigInt(real), true);
      x.setBigUint64(12, BigInt(comprimido.length), true);
    }
    const sc = e.zip64 ? 0xffffffff : comprimido.length;
    const su = e.zip64 ? 0xffffffff : real;
    const version = e.zip64 ? 45 : 20;
    const suma = crc32(datos);

    const local = new Uint8Array(30 + nombre.length + extra.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, version, true);
    l.setUint16(6, banderas, true);
    l.setUint16(8, metodo, true);
    l.setUint32(14, suma, true);
    l.setUint32(18, sc, true);
    l.setUint32(22, su, true);
    l.setUint16(26, nombre.length, true);
    l.setUint16(28, extra.length, true);
    local.set(nombre, 30);
    local.set(extra, 30 + nombre.length);

    const cd = new Uint8Array(46 + nombre.length + extra.length);
    const c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, version, true);
    c.setUint16(6, version, true);
    c.setUint16(8, banderas, true);
    c.setUint16(10, metodo, true);
    c.setUint32(16, suma, true);
    c.setUint32(20, sc, true);
    c.setUint32(24, su, true);
    c.setUint16(28, nombre.length, true);
    c.setUint16(30, extra.length, true);
    c.setUint32(42, pos, true);
    cd.set(nombre, 46);
    cd.set(extra, 46 + nombre.length);

    partes.push(local, comprimido);
    central.push(cd);
    pos += local.length + comprimido.length;
  }
  const tamCentral = central.reduce((n, x) => n + x.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, entradas.length, true);
  f.setUint16(10, entradas.length, true);
  f.setUint32(12, tamCentral, true);
  f.setUint32(16, pos, true);
  const todo = [...partes, ...central, fin];
  const zip = new Uint8Array(todo.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of todo) {
    zip.set(x, o);
    o += x.length;
  }
  return zip;
}
