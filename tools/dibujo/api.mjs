import { limpiarTexto, ocultarTokens } from "./texto.mjs";
// Peticiones al portal: Bearer, sin redirecciones, errores traducidos al español.
export class ErrorCli extends Error {
  constructor(mensaje, { uso = false } = {}) {
    super(mensaje);
    this.uso = uso;
  }
}

const TIEMPO_MS = 60_000;

export async function pedir(portal, ruta, { metodo = "GET", token, query, cuerpo, cabeceras = {} } = {}) {
  const url = new URL(ruta, portal);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      redirect: "manual",
      headers: { authorization: `Bearer ${token}`, ...cabeceras },
      body: cuerpo,
      signal: AbortSignal.timeout(TIEMPO_MS),
    });
  } catch {
    throw new ErrorCli(`No se pudo conectar con ${portal}.`);
  }
  let texto = "";
  try {
    texto = (await res.text()).slice(0, 4096);
  } catch { /* cuerpo ilegible */ }
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: res.status, json, retryAfter: res.headers.get("retry-after") };
}

export const MSG_401 = "El token caducó o fue revocado. Vuelve a ejecutar `entrar`.";

// Mensaje en español para una respuesta que no es éxito. contexto: "archivos" (por defecto) o "hardware".
export function mensajeHttp(r, contexto = "archivos") {
  const s = r.status;
  const crudo = typeof r.json?.error === "string" && r.json.error.length <= 200 ? r.json.error : null;
  const texto = crudo === null ? null : ocultarTokens(limpiarTexto(crudo));
  const codigo = r.json?.codigo;
  const hw = contexto === "hardware";
  if (s === 401) return `Error 401: ${MSG_401}`;
  if (s === 400 && hw && codigo === "adjunto") return "Error 400: el portal no aceptó los adjuntos subidos.";
  if (s === 400 && !hw && codigo === "contenido") return "Error 400: el contenido del archivo no corresponde a su tipo.";
  if (s === 400 && !hw && codigo === "tipo") return "Error 400: el portal no admite ese tipo de archivo.";
  if (s === 403) {
    if (codigo === "alcance") return "Error 403: este token de subida no permite esa operación.";
    return `Error 403: sin permiso en ese proyecto o disciplina${texto ? ` (${texto})` : ""}.`;
  }
  if (s === 404 && hw) return "Error 404: la página no existe (o el proyecto o la disciplina).";
  if (s === 409) {
    if (!hw) return "Error 409: el id del archivo ya existía; puedes reintentar la subida.";
    if (codigo === "bloque") return "Error 409: el bloque del diagrama no está o cambió en la página.";
    if (codigo === "candado") return "Error 409: hay otro guardado en curso; vuelve a intentarlo en unos segundos.";
    if (codigo === "version") return "Error 409: la página cambió mientras se subía.";
    return "Error 409: la página cambió.";
  }
  if (s === 413) return hw ? "Error 413: la página quedaría demasiado grande." : "Error 413: el archivo es demasiado grande para el portal.";
  if (s === 429) {
    const seg = /^\d{1,6}$/.test(r.retryAfter ?? "") ? ` Espera ${r.retryAfter} segundos.` : "";
    return `Error 429: ${hw ? "demasiadas escrituras" : "demasiadas subidas"}.${seg}`;
  }
  if (s >= 300 && s < 400) return `Respuesta inesperada del portal (código ${s}); no se siguen redirecciones.`;
  return `El portal respondió con el código ${s}.`;
}
