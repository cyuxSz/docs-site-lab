// Tipos de archivo permitidos y saneado de nombres: sin dependencias, lo usan el servidor y el navegador (src/lib/hardware-editor.ts).
const MB = 1024 * 1024;
const IMAGEN = 10 * MB;
const GENERAL = 50 * MB;
const DIAGRAMA = 10 * MB;
const EXCALIDRAW = 20 * MB;

const tipo = (mime, max, inline = false) => ({ mime, max, inline });
export const TIPOS = {
  png: tipo("image/png", IMAGEN, true),
  jpg: tipo("image/jpeg", IMAGEN, true),
  jpeg: tipo("image/jpeg", IMAGEN, true),
  webp: tipo("image/webp", IMAGEN, true),
  svg: tipo("image/svg+xml", IMAGEN),
  pdf: tipo("application/pdf", GENERAL, true),
  kicad_sch: tipo("application/octet-stream", GENERAL),
  kicad_pcb: tipo("application/octet-stream", GENERAL),
  kicad_pro: tipo("application/octet-stream", GENERAL),
  sldprt: tipo("application/octet-stream", GENERAL),
  sldasm: tipo("application/octet-stream", GENERAL),
  slddrw: tipo("application/octet-stream", GENERAL),
  step: tipo("model/step", GENERAL),
  stp: tipo("model/step", GENERAL),
  stl: tipo("model/stl", GENERAL),
  glb: tipo("model/gltf-binary", GENERAL),
  "3mf": tipo("model/3mf", GENERAL),
  zip: tipo("application/zip", GENERAL),
  csv: tipo("text/csv", GENERAL),
  // C1: fuentes de los diagramas (el SVG exportado va como "svg"). Nunca en línea.
  excalidraw: tipo("application/octet-stream", EXCALIDRAW),
  drawio: tipo("application/octet-stream", DIAGRAMA),
};

// Nombre seguro: sin rutas, solo [A-Za-z0-9._-], sin ".." ni inicio en "." o "-", ≤ 100 caracteres con su extensión.
export function sanearNombre(nombre) {
  let s = String(nombre ?? "");
  s = s.slice(Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\")) + 1);
  s = s.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-{2,}/g, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+/, "");
  if (s.length > 100) {
    const punto = s.lastIndexOf(".");
    const ext = punto > 0 && s.length - punto <= 20 ? s.slice(punto) : "";
    s = s.slice(0, 100 - ext.length).replace(/\.+$/, "");
    // Sin extensión final conservable, un ".png" de en medio no debe quedar como extensión por el corte.
    if (!ext) s = s.replace(/\./g, "-");
    s += ext;
  }
  // Un nombre cuyo único contenido eran "." o "-" iniciales queda vacío; tras recortar ya no empieza por ellos.
  return s || "archivo";
}

// Extensión (minúsculas) del nombre saneado, o null si no tiene punto.
export function extension(nombreSaneado) {
  const i = nombreSaneado.lastIndexOf(".");
  return i > 0 ? nombreSaneado.slice(i + 1).toLowerCase() : null;
}


// Clave del hash de metadatos de adjuntos de un proyecto (id → JSON). La comparten archivos-core y hardware-core.
export const claveArchivos = (proyecto) => `hw:arch:${proyecto}`;
