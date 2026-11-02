// Lógica de la API de documentación de hardware (Electrónica y Mecánica) sobre Upstash Redis. Páginas Markdown con
// versiones, revisiones y papelera. Redis se inyecta: { exec(cmds) → results[] }.
import { markdownToHtml } from "satteri";
import { canAccess } from "../access.config.js";
import { neutralizeHtml } from "../tools/neutralizar.mjs";
import { clienteRedis, HttpError, respuesta, leerCuerpo, exigirSesion, exigirEscritura, limitar } from "./api-comun.mjs";

const MAX_BODY = 256 * 1024;
const MAX_MD = 200 * 1024;
const MAX_REVISIONES = 50;
const ID_PROYECTO = /^[A-Za-z0-9_-]+$/;
const DISCIPLINA = /^[a-z0-9-]{1,30}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const PARSE = { features: { gfm: true, frontmatter: false } };
const METODOS = ["GET", "POST", "PUT", "DELETE"];

// Detecta href/src con esquema javascript:, vbscript: o data: (tras decodificar entidades y descartar espacios y
// caracteres de control, que los navegadores ignoran al interpretar el esquema).
function esquemaPeligroso(valor) {
  const limpio = valor
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
    .replace(/&(colon|tab|newline);?/gi, (_, n) => ({ colon: ":", tab: "\t", newline: "\n" })[n.toLowerCase()])
    .replace(/[\u0000- \u007f-\u009f]/g, "")
    .toLowerCase();
  return /^(javascript|vbscript|data):/.test(limpio);
}

export async function renderizarMd(md) {
  const { html } = markdownToHtml(neutralizeHtml(String(md)), PARSE);
  return html.replace(/(\s(?:href|src))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (todo, attr, a, b, c) =>
    esquemaPeligroso(a ?? b ?? c ?? "") ? `${attr}="#"` : todo,
  );
}

const plano = (flat) => {
  const o = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) o[flat[i]] = flat[i + 1];
  return o;
};
const parsear = (texto) => {
  try {
    const v = JSON.parse(texto);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};
const entero = (v, min) => Number.isInteger(v) && v >= min;

function validarSlug(v) {
  if (typeof v !== "string" || !SLUG.test(v)) throw new HttpError(400, "Slug inválido");
  return v;
}
function validarTitulo(v) {
  if (typeof v !== "string") throw new HttpError(400, "Título inválido");
  const t = v.trim();
  if (t.length < 1 || t.length > 120 || CONTROL.test(t)) throw new HttpError(400, "Título inválido");
  return t;
}
function validarMd(v) {
  if (typeof v !== "string") throw new HttpError(400, "md inválido");
  if (Buffer.byteLength(v, "utf8") > MAX_MD) throw new HttpError(413, "Contenido demasiado grande");
  return v;
}

export function crearHandler({ env = {}, redis, proyectos = [], plantillas = {}, ahora = Date.now } = {}) {
  const almacen = redis === undefined ? clienteRedis(env) : redis;
  const exec = async (...cmds) => almacen.exec(cmds);

  const publica = async (slug, p) => ({
    slug,
    titulo: p.titulo,
    md: p.md,
    html: await renderizarMd(p.md),
    autor: p.autor,
    actualizado: p.actualizado,
    version: Number(p.version),
  });

  // Candado SET NX EX 10 mientras dura fn; siempre se libera.
  async function conCandado(clave, fn) {
    const [ok] = await exec(["SET", clave, "1", "NX", "EX", 10]);
    if (ok !== "OK") throw new HttpError(409, "Hay otro guardado en curso; intenta de nuevo");
    try {
      return await fn();
    } finally {
      await exec(["DEL", clave]).catch(() => {});
    }
  }

  async function atender(request) {
    const metodo = request.method;
    if (!METODOS.includes(metodo)) throw new HttpError(405, "Método no permitido", { allow: METODOS.join(", ") });
    const login = await exigirSesion(request, env);
    if (!almacen) throw new HttpError(503, "Documentación no configurada");

    const url = new URL(request.url);
    let body;
    if (metodo === "GET") {
      body = { proyecto: url.searchParams.get("proyecto"), disciplina: url.searchParams.get("disciplina") };
    } else {
      exigirEscritura(request);
      body = await leerCuerpo(request, MAX_BODY);
    }

    const { proyecto, disciplina } = body;
    if (typeof proyecto !== "string" || !ID_PROYECTO.test(proyecto) || typeof disciplina !== "string" || !DISCIPLINA.test(disciplina)) {
      throw new HttpError(400, "Proyecto o disciplina inválidos");
    }
    const proy = proyectos.find((p) => p.id === proyecto);
    if (!proy) throw new HttpError(404, "Proyecto no encontrado");
    // Antes de revelar si la disciplina existe.
    if (!canAccess(login, `/${proyecto}/`)) throw new HttpError(403, "Sin acceso a este proyecto");
    const conf = proy.disciplinas && Object.hasOwn(proy.disciplinas, disciplina) ? proy.disciplinas[disciplina] : null;
    if (!conf) throw new HttpError(404, "Disciplina no encontrada");
    const editable = Array.isArray(conf.editores) && conf.editores.some((e) => typeof e === "string" && e.toLowerCase() === login.toLowerCase());
    if (metodo !== "GET" && !editable) throw new HttpError(403, "Solo los editores pueden escribir");

    const kIndice = `hw:${proyecto}:${disciplina}:indice`;
    const kPag = (s) => `hw:pag:${proyecto}:${disciplina}:${s}`;
    const kRev = (s) => `hw:rev:${proyecto}:${disciplina}:${s}`;
    const kPapelera = `hw:papelera:${proyecto}:${disciplina}`;
    const kLock = (s) => `hw:lock:${proyecto}:${disciplina}:${s}`;

    const leerIndice = async () => {
      const [crudo] = await exec(["GET", kIndice]);
      const v = typeof crudo === "string" ? parsear(crudo) : null;
      return Array.isArray(v) ? v.filter((p) => p && typeof p.slug === "string").map((p) => ({ slug: p.slug, titulo: String(p.titulo ?? "") })) : [];
    };
    const leerPag = async (slug) => {
      const [flat] = await exec(["HGETALL", kPag(slug)]);
      const p = plano(flat);
      return p.md === undefined ? null : p;
    };
    const estado = (p) => ({ titulo: p.titulo, md: p.md, autor: p.autor, actualizado: p.actualizado, version: Number(p.version) });
    const iso = () => new Date(ahora()).toISOString();

    if (metodo === "GET") {
      const q = url.searchParams;
      if (!q.has("pagina")) {
        return respuesta(200, { yo: login, proyecto, disciplina, editable, paginas: await leerIndice() });
      }
      const slug = validarSlug(q.get("pagina"));
      const p = await leerPag(slug);
      if (!p) throw new HttpError(404, "Página no encontrada");
      if (q.get("revisiones") === "1") {
        const [lista] = await exec(["LRANGE", kRev(slug), 0, MAX_REVISIONES - 1]);
        const revisiones = (Array.isArray(lista) ? lista : [])
          .map((r) => parsear(r))
          .filter(Boolean)
          .map((r, n) => ({ n, titulo: r.titulo, autor: r.autor, actualizado: r.actualizado, version: Number(r.version) }));
        return respuesta(200, { revisiones });
      }
      return respuesta(200, { yo: login, editable, pagina: await publica(slug, p) });
    }

    // ----- escrituras: validar campos -> límite de tasa -> operación -----
    let operacion;
    if (metodo === "POST") {
      const accion = body.accion;
      if (accion === "inicializar") {
        operacion = async () => {
          const existente = await leerIndice();
          if (existente.length) return respuesta(200, { inicializado: false, paginas: existente });
          const plantilla = plantillas[conf.plantilla];
          if (!Array.isArray(plantilla)) throw new Error("Plantilla no disponible");
          const t = iso();
          const cmds = plantilla.map((p) => ["HSET", kPag(p.slug), "titulo", p.titulo, "md", p.md, "autor", login, "actualizado", t, "version", 1]);
          const paginas = plantilla.map(({ slug, titulo }) => ({ slug, titulo }));
          await almacen.exec([...cmds, ["SET", kIndice, JSON.stringify(paginas)]]);
          return respuesta(201, { inicializado: true, paginas });
        };
      } else if (accion === "crear") {
        const slug = validarSlug(body.pagina);
        const titulo = validarTitulo(body.titulo);
        operacion = () =>
          conCandado(kLock("indice"), async () => {
            const indice = await leerIndice();
            const [existe] = await exec(["EXISTS", kPag(slug)]);
            if (Number(existe) > 0 || indice.some((p) => p.slug === slug)) throw new HttpError(409, "La página ya existe");
            const p = { titulo, md: `# ${titulo}\n`, autor: login, actualizado: iso(), version: 1 };
            await almacen.exec([
              ["HSET", kPag(slug), "titulo", p.titulo, "md", p.md, "autor", p.autor, "actualizado", p.actualizado, "version", 1],
              ["SET", kIndice, JSON.stringify([...indice, { slug, titulo }])],
            ]);
            return respuesta(201, { pagina: await publica(slug, p) });
          });
      } else if (accion === "reordenar") {
        const orden = body.orden;
        if (!Array.isArray(orden) || orden.some((s) => typeof s !== "string")) throw new HttpError(400, "Orden inválido");
        operacion = () =>
          conCandado(kLock("indice"), async () => {
            const indice = await leerIndice();
            if (orden.length !== indice.length || new Set(orden).size !== orden.length || !orden.every((s) => indice.some((p) => p.slug === s))) {
              throw new HttpError(400, "El orden debe ser una permutación exacta del índice");
            }
            const paginas = orden.map((s) => indice.find((p) => p.slug === s));
            await exec(["SET", kIndice, JSON.stringify(paginas)]);
            return respuesta(200, { paginas });
          });
      } else if (accion === "restaurar") {
        const slug = validarSlug(body.pagina);
        if (!entero(body.revision, 0) || !entero(body.version, 1)) throw new HttpError(400, "Revisión o versión inválidas");
        const { revision, version } = body;
        operacion = () =>
          conCandado(kLock(slug), async () => {
            const actual = await leerPag(slug);
            if (!actual) throw new HttpError(404, "Página no encontrada");
            if (Number(actual.version) !== version) throw new HttpError(409, "La página cambió", undefined, { version: Number(actual.version) });
            const [crudo] = await exec(["LINDEX", kRev(slug), revision]);
            const rev = typeof crudo === "string" ? parsear(crudo) : null;
            if (!rev || typeof rev.md !== "string") throw new HttpError(404, "Revisión no encontrada");
            const nueva = { titulo: String(rev.titulo ?? actual.titulo), md: rev.md, autor: login, actualizado: iso(), version: version + 1 };
            await almacen.exec([
              ["LPUSH", kRev(slug), JSON.stringify(estado(actual))],
              ["LTRIM", kRev(slug), 0, MAX_REVISIONES - 1],
              ["HSET", kPag(slug), "titulo", nueva.titulo, "md", nueva.md, "autor", nueva.autor, "actualizado", nueva.actualizado, "version", nueva.version],
            ]);
            return respuesta(200, { pagina: await publica(slug, nueva) });
          });
      } else {
        throw new HttpError(400, "Acción inválida");
      }
    } else if (metodo === "PUT") {
      const slug = validarSlug(body.pagina);
      const md = validarMd(body.md);
      if (!entero(body.version, 1)) throw new HttpError(400, "Versión inválida");
      const version = body.version;
      const titulo = body.titulo === undefined ? undefined : validarTitulo(body.titulo);
      operacion = () =>
        conCandado(kLock(slug), async () => {
          const actual = await leerPag(slug);
          if (!actual) throw new HttpError(404, "Página no encontrada");
          if (Number(actual.version) !== version) throw new HttpError(409, "La página cambió", undefined, { version: Number(actual.version) });
          const nueva = { titulo: titulo ?? actual.titulo, md, autor: login, actualizado: iso(), version: version + 1 };
          const cmds = [
            ["LPUSH", kRev(slug), JSON.stringify(estado(actual))],
            ["LTRIM", kRev(slug), 0, MAX_REVISIONES - 1],
            ["HSET", kPag(slug), "titulo", nueva.titulo, "md", nueva.md, "autor", nueva.autor, "actualizado", nueva.actualizado, "version", nueva.version],
          ];
          if (titulo !== undefined && titulo !== actual.titulo) {
            const indice = await leerIndice();
            cmds.push(["SET", kIndice, JSON.stringify(indice.map((p) => (p.slug === slug ? { slug, titulo } : p)))]);
          }
          await almacen.exec(cmds);
          return respuesta(200, { pagina: await publica(slug, nueva) });
        });
    } else {
      const slug = validarSlug(body.pagina);
      operacion = () =>
        conCandado(kLock("indice"), () =>
          conCandado(kLock(slug), async () => {
            const actual = await leerPag(slug);
            if (!actual) throw new HttpError(404, "Página no encontrada");
            const indice = (await leerIndice()).filter((p) => p.slug !== slug);
            const borrada = { ...estado(actual), borradoPor: login, borrado: iso() };
            await almacen.exec([["HSET", kPapelera, slug, JSON.stringify(borrada)], ["SET", kIndice, JSON.stringify(indice)], ["DEL", kPag(slug)]]);
            return respuesta(200, { ok: true });
          }),
        );
    }

    await limitar(almacen, "hw", login);
    return await operacion();
  }

  return async function handler(request) {
    try {
      return await atender(request);
    } catch (e) {
      if (e instanceof HttpError) return respuesta(e.status, { error: e.message, ...e.extra }, e.headers);
      // Fallo del almacén u otro error interno: sin detalles al cliente.
      return respuesta(503, { error: "Documentación no disponible" });
    }
  };
}
