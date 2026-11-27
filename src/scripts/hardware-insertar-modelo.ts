// Ítem «Modelo 3D (STL o GLB)» del menú «Insertar»: valida el archivo, lo sube e inserta el bloque ```modelo.
// Módulo aparte del script del editor, con todo lo del editor inyectado (así se prueba sin navegador).
import { archivoModelo, bloqueModelo, tituloDeArchivo } from "../lib/visores.ts";

type ArchivoElegido = { name: string; size: number };

export interface ConexionInsertarModelo {
  boton: EventTarget;
  input: { files: ArrayLike<ArchivoElegido> | null; value: string; click(): void } & EventTarget;
  escuchar(el: EventTarget, tipo: string, fn: (e: any) => unknown): void;
  guardando(): boolean;
  subir(archivo: ArchivoElegido, bloque: { tipos: string[]; alSubir: (id: string) => void }): Promise<boolean>;
  insertar(bloque: string): void;
  error(texto: string): void;
  // Suma o resta una subida activa (mientras haya alguna, Guardar queda bloqueado).
  subidas(delta: 1 | -1): void;
  enfocar(): void;
}

export function conectarInsertarModelo(o: ConexionInsertarModelo): void {
  o.escuchar(o.boton, "click", () => {
    if (!o.guardando()) o.input.click();
  });
  o.escuchar(o.input, "change", async () => {
    const lista = Array.from(o.input.files ?? []);
    o.input.value = "";
    if (!lista.length || o.guardando()) return;
    const sel = archivoModelo(lista);
    if (!sel.ok) {
      o.error(sel.error);
      return;
    }
    const archivo = sel.archivo;
    o.subidas(1);
    try {
      await o.subir(archivo, {
        tipos: ["stl", "glb"],
        alSubir: (id) => o.insertar(bloqueModelo({ archivo: id, titulo: tituloDeArchivo(archivo.name) })),
      });
    } finally {
      o.subidas(-1);
    }
    o.enfocar();
  });
}
