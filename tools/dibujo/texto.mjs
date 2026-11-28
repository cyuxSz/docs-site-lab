// Saneado de texto que viene del portal antes de imprimirlo en la terminal.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const CONTROLES = /[\x00-\x1f\x7f-\x9f]/g;
const BIDI = /[؜‎‏‪-‮⁦-⁩]/g;

// Quita secuencias ANSI (CSI y OSC), controles C0/C1 (incluidos \r y \n) y controles bidi.
export function limpiarTexto(texto) {
  return String(texto ?? "").replace(OSC, "").replace(CSI, "").replace(CONTROLES, "").replace(BIDI, "");
}

// Reemplaza por [oculto] todo lo que parezca un token.
export function ocultarTokens(texto) {
  return String(texto).replace(/vt[ds]_[A-Za-z0-9_-]*/g, "[oculto]").replace(/[A-Za-z0-9_-]{32,}/g, "[oculto]");
}
