// Adaptador de un bucket R2 (binding de Workers) a la interfaz de almacén de archivos-core: { subir, leer, borrar }.
// El core solo admite la subida directa. No importa nada de Node.
export function crearAlmacenR2(bucket) {
  return {
    async subir(clave, stream, { longitud, contentType } = {}) {
      // R2 exige longitud conocida: en workerd FixedLengthStream la fija (y falla si el cuerpo no coincide).
      let cuerpo = stream;
      if (typeof globalThis.FixedLengthStream === "function") cuerpo = stream.pipeThrough(new globalThis.FixedLengthStream(longitud));
      await bucket.put(clave, cuerpo, { httpMetadata: { contentType } });
    },
    async leer(clave) {
      const obj = await bucket.get(clave);
      if (!obj) return null;
      return { stream: obj.body, contentType: obj.httpMetadata?.contentType, size: obj.size };
    },
    async borrar(clave) {
      await bucket.delete(clave);
    },
  };
}
