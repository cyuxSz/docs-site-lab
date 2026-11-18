// Piezas compartidas por las APIs serverless (comentarios, hardware, archivos): cliente Redis (Upstash REST),
// errores/respuestas JSON, lectura de cuerpo acotada, sesión, comprobación de escritura y límite de tasa.
import { COOKIE, cookies, verify } from "./sesion.mjs";

const LIMITE = 10;
const VENTANA = 60;
// Duración del candado de escritura de hardware (segundos) y timeout de cada acceso a Redis (ms). Viven juntos porque
// cada acceso individual no puede durar más que el lease. Una escritura encadena varios accesos y sí puede pasarse:
// esa garantía la da el fencing de hardware-core (el EVAL final solo aplica si seguimos siendo dueños del candado).
export const LEASE_S = 10;
export const TIMEOUT_MS = 5000;

export function clienteRedis(env = {}) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return {
    async exec(comandos) {
      // Los mensajes de error son fijos: nunca incluyen el token ni el detalle de Upstash.
      let res;
      try {
        res = await fetch(`${String(url).replace(/\/+$/, "")}/pipeline`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(comandos),
          // Cada acceso individual no puede durar más que LEASE_S (el lease de los candados); la escritura completa, que encadena
          // varios accesos, la protege el fencing de hardware-core.
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new Error("Almacén no disponible");
      }
      if (!res.ok) throw new Error("Almacén no disponible");
      let data;
      try {
        data = await res.json();
      } catch (e) {
        if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new Error("Almacén no disponible");
        throw new Error("Respuesta inválida del almacén");
      }
      if (!Array.isArray(data) || data.some((r) => !r || r.error !== undefined)) throw new Error("Error del almacén");
      return data.map((r) => r.result);
    },
  };
}

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

// Misma política que middleware.js: sin secreto fuerte no se acepta ninguna cookie. Devuelve el login.
export async function exigirSesion(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, "Login sin configurar");
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

export function exigirMismoOrigen(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new HttpError(403, "Origen no permitido");
}

export async function limitar(almacen, prefijo, login) {
  const k = `${prefijo}:rl:${login.toLowerCase()}`;
  const [n, , ttl] = await almacen.exec([["INCR", k], ["EXPIRE", k, VENTANA, "NX"], ["TTL", k]]);
  if (Number(n) > LIMITE) {
    const espera = Number(ttl) > 0 ? Number(ttl) : VENTANA;
    throw new HttpError(429, "Demasiadas escrituras; espera un momento", { "retry-after": String(espera) });
  }
}
