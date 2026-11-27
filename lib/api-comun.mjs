// Piezas compartidas por las APIs (comentarios, hardware, archivos): errores/respuestas JSON, lectura de cuerpo acotada,
// sesión, comprobación de escritura y límite de tasa.
import { COOKIE, cookies, verify } from "./sesion.mjs";
import { resolverBearer, validadaConBearer, pasoPuerta } from "./dispositivos-core.mjs";
import { ERROR_ALCANCE, CODIGO_ALCANCE } from "./alcance-subida.mjs";

const LIMITE = 10;
const VENTANA = 60;
// Duración del candado de escritura de hardware (segundos). Una escritura encadena varios accesos al almacén y sí puede pasarse:
// esa garantía la da el fencing de hardware-core (el EVAL final solo aplica si seguimos siendo dueños del candado).
export const LEASE_S = 10;

export class HttpError extends Error {
  constructor(status, mensaje, headers, extra) {
    super(mensaje);
    this.status = status;
    this.headers = headers;
    this.extra = extra;
  }
}

export const respuesta = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });

// El límite de bytes se aplica mientras se lee el stream (también sin Content-Length): se aborta en cuanto se pasa.
export async function leerCuerpo(request, max) {
  const declarado = Number(request.headers.get("content-length"));
  if (declarado > max) throw new HttpError(413, "Cuerpo demasiado grande");
  const trozos = [];
  let total = 0;
  if (request.body) {
    const lector = request.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel().catch(() => {});
        throw new HttpError(413, "Cuerpo demasiado grande");
      }
      trozos.push(value);
    }
  }
  const texto = Buffer.concat(trozos).toString("utf8");
  let body;
  try {
    body = JSON.parse(texto);
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "El cuerpo debe ser un objeto JSON");
  return body;
}

// Errores de la credencial Bearer (token de dispositivo): los mismos en el Worker y en las APIs.
export const ERROR_TOKEN = "Token inválido";
export const ERROR_AMBOS = "Envía la cookie de sesión o el token, no ambos";
export const ERROR_TOKENS_NO_DISPONIBLES = "Tokens no disponibles";
export const CABECERAS_401_BEARER = { "www-authenticate": "Bearer" };

// Misma política que el login del Worker: sin secreto fuerte no se acepta ninguna credencial. Devuelve el login.
// Con `Authorization: Bearer` la petición se autentica solo con el token (nunca se mira la cookie).
// Refuerzo de la puerta de alcance: un token que no es de dispositivo solo entra si ESTA petición pasó por la puerta
// de manejarLogin. No se mira la URL: quien decide es la puerta. Sin la marca, 403 con `codigo: "alcance"`.
export async function exigirSesion(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, "Login sin configurar");
  const bearer = await resolverBearer(request, env);
  if (bearer.estado === "ok") {
    if (bearer.tipo !== "dispositivo" && !pasoPuerta(request)) throw new HttpError(403, ERROR_ALCANCE, undefined, { codigo: CODIGO_ALCANCE });
    return bearer.login;
  }
  if (bearer.estado === "ambos") throw new HttpError(400, ERROR_AMBOS);
  if (bearer.estado === "no-disponible") throw new HttpError(503, ERROR_TOKENS_NO_DISPONIBLES);
  if (bearer.estado !== "ninguno") throw new HttpError(401, ERROR_TOKEN, CABECERAS_401_BEARER);
  const sesion = await verify(cookies(request)[COOKIE], env.SESSION_SECRET);
  const login = sesion && typeof sesion.login === "string" && sesion.login ? sesion.login : null;
  if (!login) throw new HttpError(401, "Sesión requerida");
  return login;
}

// Escrituras: solo JSON y desde el mismo origen.
export function exigirEscritura(request) {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") || "")) throw new HttpError(415, "Se requiere application/json");
  exigirMismoOrigen(request);
}

// Con cookie, Origin es obligatorio y debe ser el propio. Si ESTA petición ya se validó con Bearer (exigirSesion),
// no hay cookie que un tercero pueda aprovechar: Origin puede faltar, pero si viene tiene que ser el propio.
export function exigirMismoOrigen(request) {
  const origin = request.headers.get("origin");
  const propio = new URL(request.url).origin;
  if (validadaConBearer(request)) {
    if (origin && origin !== propio) throw new HttpError(403, "Origen no permitido");
    return;
  }
  if (!origin || origin !== propio) throw new HttpError(403, "Origen no permitido");
}

export async function limitar(almacen, prefijo, login) {
  const k = `${prefijo}:rl:${login.toLowerCase()}`;
  const [n, , ttl] = await almacen.exec([["INCR", k], ["EXPIRE", k, VENTANA, "NX"], ["TTL", k]]);
  if (Number(n) > LIMITE) {
    const espera = Number(ttl) > 0 ? Number(ttl) : VENTANA;
    throw new HttpError(429, "Demasiadas escrituras; espera un momento", { "retry-after": String(espera) });
  }
}
