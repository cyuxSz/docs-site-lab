// Lógica de la API de comentarios por página (sin dependencias). Redis (Upstash REST) se inyecta: { exec(cmds) → results[] }.
import { canAccess } from "../access.config.js";
import { COOKIE, cookies, verify } from "./sesion.mjs";

export const TIPOS = ["duda", "aclaracion", "sugerencia", "bug"];
const MAX_BODY = 16 * 1024;
const MAX_TEXTO = 2000;
const LIMITE = 10;
const VENTANA = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

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
        });
      } catch {
        throw new Error("Almacén no disponible");
      }
      if (!res.ok) throw new Error("Almacén no disponible");
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Respuesta inválida del almacén");
      }
      if (!Array.isArray(data) || data.some((r) => !r || r.error !== undefined)) throw new Error("Error del almacén");
      return data.map((r) => r.result);
    },
  };
}

class HttpError extends Error {
  constructor(status, mensaje, headers) {
    super(mensaje);
    this.status = status;
    this.headers = headers;
  }
}

const respuesta = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  });

function validarPagina(pagina, proyectos) {
  if (typeof pagina !== "string" || pagina.length > 200) return false;
  return proyectos.some((p) => typeof p.id === "string" && /^[A-Za-z0-9_-]+$/.test(p.id) && new RegExp(`^/${p.id}(/[A-Za-z0-9_-]+)+/$`).test(pagina));
}

function validarTexto(t) {
  if (typeof t !== "string") return null;
  const s = t.replace(/\r\n/g, "\n").trim();
  if (s.length < 1 || s.length > MAX_TEXTO || CONTROL.test(s)) return null;
  return s;
}

const esUuid = (v) => typeof v === "string" && UUID.test(v);

function parsearHash(flat) {
  const out = [];
  if (!Array.isArray(flat)) return out;
  for (let i = 0; i + 1 < flat.length; i += 2) {
    try {
      const c = JSON.parse(flat[i + 1]);
      if (c && typeof c === "object") out.push(c);
    } catch {}
  }
  return out;
}

const publico = (c) => ({
  id: c.id,
  padre: c.padre ?? null,
  autor: c.autor ?? null,
  tipo: c.tipo,
  texto: c.texto ?? "",
  creado: c.creado,
  editado: c.editado ?? null,
  resuelto: !!c.resuelto,
  resueltoPor: c.resueltoPor ?? null,
  borrado: !!c.borrado,
});

export function crearHandler({ env = {}, redis, proyectos = [], ahora = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  const almacen = redis === undefined ? clienteRedis(env) : redis;
  const clave = (pagina) => `com:${pagina}`;

  async function leerPagina(pagina) {
    const [flat] = await almacen.exec([["HGETALL", clave(pagina)]]);
    return parsearHash(flat);
  }

  async function leerCuerpo(request) {
    // Un cuerpo chunked sin Content-Length se lee entero: lo acota el límite de cuerpo de Vercel (~4.5 MB) y exige sesión.
    const declarado = Number(request.headers.get("content-length"));
    if (declarado > MAX_BODY) throw new HttpError(413, "Cuerpo demasiado grande");
    const texto = await request.text();
    if (Buffer.byteLength(texto, "utf8") > MAX_BODY) throw new HttpError(413, "Cuerpo demasiado grande");
    let body;
    try {
      body = JSON.parse(texto);
    } catch {
      throw new HttpError(400, "JSON inválido");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "El cuerpo debe ser un objeto JSON");
    return body;
  }

  async function limitar(login) {
    const k = `com:rl:${login.toLowerCase()}`;
    const [n, , ttl] = await almacen.exec([["INCR", k], ["EXPIRE", k, VENTANA, "NX"], ["TTL", k]]);
    if (Number(n) > LIMITE) {
      const espera = Number(ttl) > 0 ? Number(ttl) : VENTANA;
      throw new HttpError(429, "Demasiadas escrituras; espera un momento", { "retry-after": String(espera) });
    }
  }

  async function atender(request) {
    const metodo = request.method;
    if (!["GET", "POST", "PATCH", "DELETE"].includes(metodo)) {
      throw new HttpError(405, "Método no permitido", { allow: "GET, POST, PATCH, DELETE" });
    }
    // Misma política que middleware.js: sin secreto fuerte no se acepta ninguna cookie.
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new HttpError(503, "Login sin configurar");
    const sesion = await verify(cookies(request)[COOKIE], env.SESSION_SECRET);
    const login = sesion && typeof sesion.login === "string" && sesion.login ? sesion.login : null;
    if (!login) throw new HttpError(401, "Sesión requerida");
    if (!almacen) throw new HttpError(503, "Comentarios no configurados");

    const url = new URL(request.url);
    let body = {};
    if (metodo === "GET") {
      body = { pagina: url.searchParams.get("pagina") };
    } else {
      if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") || "")) throw new HttpError(415, "Se requiere application/json");
      const origin = request.headers.get("origin");
      if (!origin || origin !== url.origin) throw new HttpError(403, "Origen no permitido");
      body = await leerCuerpo(request);
    }

    const pagina = body.pagina;
    if (!validarPagina(pagina, proyectos)) throw new HttpError(400, "Página inválida");

    let texto, tipo, padre, id, resuelto;
    if (metodo === "POST") {
      tipo = body.tipo;
      if (typeof tipo !== "string" || !TIPOS.includes(tipo)) throw new HttpError(400, "Tipo inválido");
      texto = validarTexto(body.texto);
      if (texto === null) throw new HttpError(400, "Texto inválido");
      padre = body.padre ?? null;
      if (padre !== null && !esUuid(padre)) throw new HttpError(400, "Comentario padre inválido");
    } else if (metodo !== "GET") {
      id = body.id;
      if (!esUuid(id)) throw new HttpError(400, "Id inválido");
      if (metodo === "PATCH") {
        const tieneTexto = "texto" in body;
        const tieneResuelto = "resuelto" in body;
        if (tieneTexto === tieneResuelto) throw new HttpError(400, "Envía texto o resuelto");
        if (tieneTexto) {
          texto = validarTexto(body.texto);
          if (texto === null) throw new HttpError(400, "Texto inválido");
        } else {
          if (typeof body.resuelto !== "boolean") throw new HttpError(400, "Valor de resuelto inválido");
          resuelto = body.resuelto;
        }
      }
    }

    if (!canAccess(login, pagina)) throw new HttpError(403, "Sin acceso a este proyecto");

    if (metodo === "GET") {
      const lista = (await leerPagina(pagina)).map((c, i) => [c, i]);
      lista.sort((a, b) => (a[0].creado < b[0].creado ? -1 : a[0].creado > b[0].creado ? 1 : a[1] - b[1]));
      return respuesta(200, { yo: login, comentarios: lista.map(([c]) => publico(c)) });
    }

    if (metodo === "POST" && padre !== null) {
      const p = (await leerPagina(pagina)).find((c) => c.id === padre);
      if (!p || p.padre || p.borrado) throw new HttpError(400, "Comentario padre inválido");
    }

    await limitar(login);

    if (metodo === "POST") {
      const comentario = { id: uuid(), padre, autor: login, tipo, texto, creado: new Date(ahora()).toISOString(), editado: null, resuelto: false, resueltoPor: null, borrado: false };
      await almacen.exec([["HSET", clave(pagina), comentario.id, JSON.stringify(comentario)]]);
      return respuesta(201, { comentario: publico(comentario) });
    }

    const todos = await leerPagina(pagina);
    const actual = todos.find((c) => c.id === id);
    if (!actual) throw new HttpError(404, "Comentario no encontrado");
    const esAutor = typeof actual.autor === "string" && actual.autor.toLowerCase() === login.toLowerCase();

    if (metodo === "PATCH") {
      if (texto !== undefined) {
        if (actual.borrado || !esAutor) throw new HttpError(403, "Solo el autor puede editar");
        actual.texto = texto;
        actual.editado = new Date(ahora()).toISOString();
      } else {
        if (actual.padre) throw new HttpError(400, "Solo se resuelven comentarios raíz");
        if (actual.borrado) throw new HttpError(403, "Comentario borrado");
        actual.resuelto = resuelto;
        actual.resueltoPor = resuelto ? login : null;
      }
      await almacen.exec([["HSET", clave(pagina), id, JSON.stringify(actual)]]);
      return respuesta(200, { comentario: publico(actual) });
    }

    // DELETE
    if (!esAutor) throw new HttpError(403, "Solo el autor puede borrar");
    const tieneRespuestas = !actual.padre && todos.some((c) => c.padre === id);
    if (tieneRespuestas) {
      actual.borrado = true;
      actual.texto = "";
      actual.autor = null;
      await almacen.exec([["HSET", clave(pagina), id, JSON.stringify(actual)]]);
    } else {
      await almacen.exec([["HDEL", clave(pagina), id]]);
    }
    return respuesta(200, { ok: true });
  }

  return async function handler(request) {
    try {
      return await atender(request);
    } catch (e) {
      if (e instanceof HttpError) return respuesta(e.status, { error: e.message }, e.headers);
      // Fallo del almacén u otro error interno: sin detalles al cliente.
      return respuesta(503, { error: "Comentarios no disponibles" });
    }
  };
}
