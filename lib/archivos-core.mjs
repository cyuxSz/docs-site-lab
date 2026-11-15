// Lógica de la API de archivos de hardware sobre Vercel Blob (store privado, client uploads) y Upstash Redis.
// Los metadatos viven en hw:arch:<proyecto> (id → JSON); la URL del Blob nunca sale al cliente: los archivos se sirven
// por un proxy autenticado. Redis y Blob se inyectan: blob = { handleUpload(opts), leer(url), borrar(url) }.
import { extension, sanearNombre, TIPOS } from "./archivos-nombre.mjs";
import { canAccess } from "../access.config.js";
import { clienteRedis, HttpError, respuesta, leerCuerpo, exigirSesion, exigirEscritura, exigirMismoOrigen, limitar } from "./api-comun.mjs";

export { sanearNombre, TIPOS };

const MAX_BODY = 64 * 1024;
const ID_PROYECTO = /^[A-Za-z0-9_-]+$/;
const DISCIPLINA = /^[a-z0-9-]{1,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIJO_UUID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(.*)$/is;

const esUuid = (v) => typeof v === "string" && UUID.test(v);
const parsear = (texto) => {
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

// Cliente real de Vercel Blob (store privado). Import dinámico: solo se carga si hay token.
function blobReal(token) {
  return {
    async handleUpload(opciones) {
      const { handleUpload } = await import("@vercel/blob/client");
      return handleUpload({ token, ...opciones });
    },
    async leer(url) {
      const { get } = await import("@vercel/blob");
      const r = await get(url, { access: "private", token });
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      return { stream: r.stream, contentType: r.blob.contentType, size: r.blob.size };
    },
    async borrar(url) {
      const { del } = await import("@vercel/blob");
      await del(url, { token });
    },
  };
}

const octetStream = (request) => /^application\/octet-stream\s*(;|$)/i.test(request.headers.get("content-type") || "");

// KEYS: hash de archivos, set de borrados. ARGV: id, meta. HSETNX nunca pisa un existente.
const INSERTAR_SI_NO_BORRADO =
  "if redis.call('sismember', KEYS[2], ARGV[1]) == 1 then return 0 end return redis.call('hsetnx', KEYS[1], ARGV[1], ARGV[2])";

export function crearHandler({ env = {}, redis, blob, proyectos = [], ahora = Date.now } = {}) {
  const almacen = redis === undefined ? clienteRedis(env) : redis;
  const nube = blob === undefined ? (env.BLOB_READ_WRITE_TOKEN ? blobReal(env.BLOB_READ_WRITE_TOKEN) : null) : blob;
  // "directa": el almacén tiene subir() (R2, el navegador sube al Worker). "blob": handleUpload (Vercel Blob, client uploads).
  const modo = nube && typeof nube.subir === "function" ? "directa" : nube && typeof nube.handleUpload === "function" ? "blob" : null;
  const iso = () => new Date(ahora()).toISOString();
  const kArch = (proyecto) => `hw:arch:${proyecto}`;
  const kBorrados = (proyecto) => `hw:arch:borrados:${proyecto}`;

  function disciplinaDe(proyecto, disciplina) {
    const p = proyectos.find((x) => x.id === proyecto);
    const d = p?.disciplinas && typeof disciplina === "string" && Object.hasOwn(p.disciplinas, disciplina) ? p.disciplinas[disciplina] : null;
    return d;
  }
  const esEditor = (conf, login) => Array.isArray(conf?.editores) && conf.editores.some((e) => typeof e === "string" && e.toLowerCase() === login.toLowerCase());

  // Proyecto con formato válido, existente y accesible para el login (el 403 va antes de revelar si existe).
  function proyectoAccesible(proyecto, login) {
    if (typeof proyecto !== "string" || !ID_PROYECTO.test(proyecto)) throw new HttpError(400, "Proyecto inválido");
    if (!canAccess(login, `/${proyecto}/`)) throw new HttpError(403, "Sin acceso a este proyecto");
    if (!proyectos.some((p) => p.id === proyecto)) throw new HttpError(404, "Proyecto no encontrado");
  }

  async function leerMeta(proyecto, id) {
    const [crudo] = await almacen.exec([["HGET", kArch(proyecto), id]]);
    return typeof crudo === "string" ? parsear(crudo) : null;
  }

  // Debe pasarse también al generar el token: el SDK solo incluye callbackUrl si onUploadCompleted está definido.
  async function alCompletar({ blob: subido, tokenPayload }) {
    const tp = typeof tokenPayload === "string" ? parsear(tokenPayload) : null;
    if (!tp || !subido || typeof subido.pathname !== "string" || subido.pathname !== tp.pathname) throw new Error("Pathname inesperado");
    const conf = disciplinaDe(tp.proyecto, tp.disciplina);
    if (!conf || !esUuid(tp.id) || !Object.hasOwn(TIPOS, tp.tipo) || typeof subido.url !== "string") throw new Error("Carga inválida");
    // Se ignora el Content-Type que declare el Blob: el proxy sirve el de la lista blanca.
    const meta = { nombre: tp.nombre, tipo: tp.tipo, tamano: tp.tamano, blobUrl: subido.url, subidoPor: tp.subidoPor, fecha: iso(), disciplina: tp.disciplina };
    // Idempotente y sin pisar: si el id ya existe o fue borrado (replay del callback) no se toca nada.
    // Un único EVAL atómico: comprobar la lápida e insertar no admiten un DELETE entre medias.
    await almacen.exec([["EVAL", INSERTAR_SI_NO_BORRADO, 2, kArch(tp.proyecto), kBorrados(tp.proyecto), tp.id, JSON.stringify(meta)]]);
  }

  // ----- Callback de Vercel Blob (sin cookie): la firma la valida handleUpload -----
  async function callback(request, body) {
    try {
      await nube.handleUpload({
        body,
        request,
        onBeforeGenerateToken: async () => {
          throw new Error("No es una petición de token");
        },
        onUploadCompleted: alCompletar,
      });
    } catch {
      // Sin detalles: ni la causa ni el contenido del callback salen al exterior.
      throw new HttpError(400, "Solicitud inválida");
    }
  }

  // ----- Token de subida -----
  async function pedirToken(request, body, login) {
    if (body.type !== "blob.generate-client-token") throw new HttpError(400, "Tipo de evento inválido");
    const p = body.payload;
    if (!p || typeof p !== "object" || typeof p.pathname !== "string" || typeof p.clientPayload !== "string") throw new HttpError(400, "Solicitud inválida");
    const cp = parsear(p.clientPayload);
    if (!cp || typeof cp.proyecto !== "string" || typeof cp.disciplina !== "string") throw new HttpError(400, "Solicitud inválida");

    if (!canAccess(login, `/${cp.proyecto}/`)) throw new HttpError(403, "Sin acceso a este proyecto");
    const conf = disciplinaDe(cp.proyecto, cp.disciplina);
    if (!conf) throw new HttpError(404, "Proyecto o disciplina no encontrados");
    if (!esEditor(conf, login)) throw new HttpError(403, "Solo los editores pueden subir archivos");

    if (typeof cp.nombre !== "string") throw new HttpError(400, "Nombre inválido");
    const nombre = sanearNombre(cp.nombre);
    const ext = extension(nombre);
    if (!ext || !Object.hasOwn(TIPOS, ext)) throw new HttpError(400, "Tipo de archivo no permitido");
    const t = TIPOS[ext];
    if (!Number.isInteger(cp.tamano) || cp.tamano < 1) throw new HttpError(400, "Tamaño inválido");
    if (cp.tamano > t.max) throw new HttpError(413, "Archivo demasiado grande");

    // pathname canónico: hw/<proyecto>/<disciplina>/<uuid>-<nombre saneado>. Cubre ../, otros proyectos y nombres sin sanear.
    const prefijo = `hw/${cp.proyecto}/${cp.disciplina}/`;
    const resto = p.pathname.startsWith(prefijo) ? p.pathname.slice(prefijo.length) : "";
    const m = PREFIJO_UUID.exec(resto);
    if (!m || m[2] !== nombre) throw new HttpError(400, "Ruta de archivo inválida");
    const id = m[1];
    const pathname = p.pathname;

    // El id lo elige el cliente: no puede coincidir con un archivo existente (de cualquier disciplina) ni con uno borrado.
    const [existe, borrado] = await almacen.exec([["HEXISTS", kArch(cp.proyecto), id], ["SISMEMBER", kBorrados(cp.proyecto), id]]);
    if (Number(existe) === 1 || Number(borrado) === 1) throw new HttpError(409, "Ese id de archivo ya existe");

    await limitar(almacen, "hw", login);
    const tokenPayload = JSON.stringify({ proyecto: cp.proyecto, disciplina: cp.disciplina, id, nombre, tipo: ext, tamano: cp.tamano, subidoPor: login, pathname });
    const permitidos = t.mime.startsWith("image/") || t.mime === "application/octet-stream" ? [t.mime] : [t.mime, "application/octet-stream"];
    const resultado = await nube.handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (ruta) => {
        if (ruta !== pathname) throw new Error("Pathname inesperado");
        return { allowedContentTypes: permitidos, maximumSizeInBytes: t.max, addRandomSuffix: false, allowOverwrite: false, tokenPayload };
      },
      onUploadCompleted: alCompletar,
    });
    return respuesta(200, resultado);
  }

  // ----- Subida directa (modo R2): cuerpo binario. Nada llega al almacén hasta pasar todas las validaciones. -----
  async function subirDirecta(request, login) {
    if (!octetStream(request)) throw new HttpError(415, "Se requiere application/octet-stream");
    exigirMismoOrigen(request);
    const q = new URL(request.url).searchParams;
    const proyecto = q.get("proyecto");
    proyectoAccesible(proyecto, login);
    const disciplina = q.get("disciplina");
    const conf = disciplinaDe(proyecto, disciplina);
    if (!conf) throw new HttpError(404, "Proyecto o disciplina no encontrados");
    if (!esEditor(conf, login)) throw new HttpError(403, "Solo los editores pueden subir archivos");
    const id = q.get("id");
    if (!esUuid(id)) throw new HttpError(400, "Id inválido");
    const crudoNombre = q.get("nombre");
    if (typeof crudoNombre !== "string") throw new HttpError(400, "Nombre inválido");
    const nombre = sanearNombre(crudoNombre);
    const ext = extension(nombre);
    if (!ext || !Object.hasOwn(TIPOS, ext)) throw new HttpError(400, "Tipo de archivo no permitido");
    const t = TIPOS[ext];
    const declarado = request.headers.get("content-length");
    if (declarado === null || declarado === "") throw new HttpError(411, "Se requiere Content-Length");
    if (!/^\d+$/.test(declarado)) throw new HttpError(400, "Tamaño inválido");
    const longitud = Number(declarado);
    if (!Number.isSafeInteger(longitud) || longitud < 1) throw new HttpError(400, "Tamaño inválido");
    if (longitud > t.max) throw new HttpError(413, "Archivo demasiado grande");
    if (!request.body) throw new HttpError(400, "Cuerpo vacío");

    const [existe, borrado] = await almacen.exec([["HEXISTS", kArch(proyecto), id], ["SISMEMBER", kBorrados(proyecto), id]]);
    if (Number(existe) === 1 || Number(borrado) === 1) throw new HttpError(409, "Ese id de archivo ya existe");
    await limitar(almacen, "hw", login);

    const clave = `hw/${proyecto}/${disciplina}/${id}-${nombre}`;
    let total = 0;
    const contador = new TransformStream({
      transform(trozo, ctl) {
        total += trozo.byteLength;
        if (total > longitud) ctl.error(new HttpError(400, "El cuerpo supera el Content-Length declarado"));
        else ctl.enqueue(trozo);
      },
    });
    try {
      await nube.subir(clave, request.body.pipeThrough(contador), { longitud, contentType: t.mime });
      if (total !== longitud) throw new HttpError(400, "El cuerpo no coincide con el Content-Length declarado");
    } catch (e) {
      await nube.borrar(clave).catch(() => {});
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Cuerpo inválido");
    }
    const meta = { nombre, tipo: ext, tamano: longitud, blobUrl: clave, subidoPor: login, fecha: iso(), disciplina };
    let insertado;
    try {
      [insertado] = await almacen.exec([["EVAL", INSERTAR_SI_NO_BORRADO, 2, kArch(proyecto), kBorrados(proyecto), id, JSON.stringify(meta)]]);
    } catch (e) {
      await nube.borrar(clave).catch(() => {});
      throw e;
    }
    if (Number(insertado) !== 1) {
      await nube.borrar(clave).catch(() => {});
      throw new HttpError(409, "Ese id de archivo ya existe");
    }
    return respuesta(201, { id, nombre, tipo: ext });
  }

  async function atender(request) {
    const metodo = request.method;
    if (!["GET", "POST", "DELETE"].includes(metodo)) throw new HttpError(405, "Método no permitido", { allow: "GET, POST, DELETE" });
    if (!almacen || !nube) {
      // Sin configuración no hay nada que servir; igualmente se exige sesión válida salvo en el callback firmado.
      if (metodo !== "POST") await exigirSesion(request, env);
      throw new HttpError(503, "Archivos no configurados");
    }

    if (metodo === "POST") {
      if (modo === "directa") {
        const login = await exigirSesion(request, env);
        return await subirDirecta(request, login);
      }
      if (octetStream(request)) throw new HttpError(415, "Subida directa no disponible");
      // El callback de Vercel Blob no trae cookie ni Origin: se distingue por el cuerpo y lo valida la firma.
      const body = await leerCuerpo(request, MAX_BODY);
      if (body.type === "blob.upload-completed") {
        await callback(request, body);
        return respuesta(200, { ok: true });
      }
      const login = await exigirSesion(request, env);
      exigirEscritura(request);
      return await pedirToken(request, body, login);
    }

    const login = await exigirSesion(request, env);
    const url = new URL(request.url);

    if (metodo === "GET") {
      const q = url.searchParams;
      if (q.get("capacidades") === "1") return respuesta(200, { subida: modo });
      const proyecto = q.get("proyecto");
      proyectoAccesible(proyecto, login);
      if (q.get("lista") === "1") {
        const disciplina = q.get("disciplina");
        if (disciplina !== null && !DISCIPLINA.test(disciplina)) throw new HttpError(400, "Disciplina inválida");
        const [flat] = await almacen.exec([["HGETALL", kArch(proyecto)]]);
        const archivos = [];
        for (let i = 0; Array.isArray(flat) && i + 1 < flat.length; i += 2) {
          const m = parsear(flat[i + 1]);
          if (!m || (disciplina !== null && m.disciplina !== disciplina)) continue;
          archivos.push({ id: flat[i], nombre: m.nombre, tipo: m.tipo, tamano: m.tamano, subidoPor: m.subidoPor, fecha: m.fecha, disciplina: m.disciplina });
        }
        archivos.sort((a, b) => (String(a.fecha) < String(b.fecha) ? 1 : String(a.fecha) > String(b.fecha) ? -1 : 0));
        return respuesta(200, { archivos });
      }
      const id = q.get("id");
      if (!esUuid(id)) throw new HttpError(400, "Id inválido");
      const meta = await leerMeta(proyecto, id);
      const t = meta && Object.hasOwn(TIPOS, meta.tipo) ? TIPOS[meta.tipo] : null;
      if (!meta || !t || typeof meta.blobUrl !== "string") throw new HttpError(404, "Archivo no encontrado");
      const obj = await nube.leer(meta.blobUrl);
      if (!obj || !obj.stream) throw new HttpError(404, "Archivo no encontrado");
      const nombre = sanearNombre(meta.nombre);
      const headers = {
        "content-type": t.mime,
        "x-content-type-options": "nosniff",
        "content-disposition": `${t.inline ? "inline" : "attachment"}; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
        "cache-control": "no-store",
      };
      if (meta.tipo === "svg") headers["content-security-policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
      if (Number.isInteger(obj.size) && obj.size >= 0) headers["content-length"] = String(obj.size);
      return new Response(obj.stream, { status: 200, headers });
    }

    // DELETE
    exigirEscritura(request);
    const body = await leerCuerpo(request, MAX_BODY);
    proyectoAccesible(body.proyecto, login);
    if (!esUuid(body.id)) throw new HttpError(400, "Id inválido");
    const meta = await leerMeta(body.proyecto, body.id);
    if (!meta || typeof meta.blobUrl !== "string") throw new HttpError(404, "Archivo no encontrado");
    if (!esEditor(disciplinaDe(body.proyecto, meta.disciplina), login)) throw new HttpError(403, "Solo los editores pueden borrar archivos");
    await limitar(almacen, "hw", login);
    // Orden deliberado: si falla el borrado del Blob queda un blob huérfano privado (nunca un registro apuntando a nada).
    await almacen.exec([["SADD", kBorrados(body.proyecto), body.id], ["HDEL", kArch(body.proyecto), body.id]]);
    await nube.borrar(meta.blobUrl);
    return respuesta(200, { ok: true });
  }

  return async function handler(request) {
    try {
      return await atender(request);
    } catch (e) {
      if (e instanceof HttpError) return respuesta(e.status, { error: e.message, ...e.extra }, e.headers);
      return respuesta(503, { error: "Archivos no disponibles" });
    }
  };
}
