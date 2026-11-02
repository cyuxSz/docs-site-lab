// Lógica de la API de documentación de hardware (Electrónica y Mecánica) sobre Upstash Redis. Páginas Markdown con
// versiones, revisiones y papelera. Redis se inyecta: { exec(cmds) → results[] }.
import { randomUUID } from "node:crypto";
import { markdownToHtml } from "satteri";
import { canAccess } from "../access.config.js";
import { neutralizeHtml } from "../tools/neutralizar.mjs";
import { clienteRedis, HttpError, respuesta, leerCuerpo, exigirSesion, exigirEscritura, limitar, LEASE_S } from "./api-comun.mjs";

const MAX_BODY = 256 * 1024;
const MAX_MD = 200 * 1024;
const MAX_REVISIONES = 50;
// Tope de bytes de revisiones en la entrada de la papelera (mantiene el EVAL de fencing bajo el límite de petición de Upstash).
export const PRESUPUESTO_PAPELERA_BYTES = 256 * 1024;
const ID_PROYECTO = /^[A-Za-z0-9_-]+$/;
const DISCIPLINA = /^[a-z0-9-]{1,30}$/;
const SLUG = /^[a-z0-9-]{1,60}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const PARSE = { features: { gfm: true, frontmatter: false } };
const METODOS = ["GET", "POST", "PUT", "DELETE"];

// Detecta href/src con esquema javascript:, vbscript: o data: (tras decodificar entidades y descartar espacios y
// caracteres de control, que los navegadores ignoran al interpretar el esquema).
const cp = (n) => (n >= 0xd800 && n <= 0xdfff ? "" : String.fromCodePoint(Math.min(n, 0x10ffff)));
function esquemaPeligroso(valor) {
  const limpio = valor
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => cp(Number(d)))
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

  // Candado SET NX EX LEASE_S con token de dueño; se libera solo si sigue siendo nuestro (compare-and-del), para no
  // borrar el candado de otro si el lease expiró mientras fn corría.
  const LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  // Fencing: las escrituras finales van en un único EVAL que comprueba que seguimos siendo dueños de TODOS los
  // candados tomados (slug e índice) y solo entonces ejecuta los comandos (codificados en ARGV sin cjson:
  // n comandos y, por cada uno, su número de argumentos seguido de los argumentos).
  const FENCING =
    "for i=1,#KEYS do if redis.call('get', KEYS[i]) ~= ARGV[i] then return 'FENCED' end end " +
    "local p=#KEYS+1 local n=tonumber(ARGV[p]) p=p+1 " +
    "for c=1,n do local k=tonumber(ARGV[p]) p=p+1 local a={} for j=1,k do a[j]=ARGV[p] p=p+1 end redis.call(unpack(a)) end " +
    "return 'APLICADO'";
  async function atender(request) {
    // Las tenencias son estado de PETICIÓN (el handler se memoiza y atiende peticiones concurrentes): cada una comprueba
    // solo sus candados en el fencing.
    const tenencias = [];
    async function conCandado(clave, fn) {
      const dueno = randomUUID();
      const [ok] = await exec(["SET", clave, dueno, "NX", "EX", LEASE_S]);
      if (ok !== "OK") throw new HttpError(409, "Hay otro guardado en curso; intenta de nuevo");
      const tenencia = { clave, dueno };
      tenencias.push(tenencia);
      try {
        return await fn();
      } finally {
        tenencias.splice(tenencias.indexOf(tenencia), 1);
        await exec(["EVAL", LIBERAR, 1, clave, dueno]).catch(() => {});
      }
    }
    async function escribir(cmds) {
      if (!tenencias.length) throw new Error("escribir sin candado");
      const [r] = await exec(["EVAL", FENCING, tenencias.length, ...tenencias.map((t) => t.clave), ...tenencias.map((t) => t.dueno), cmds.length, ...cmds.flatMap((c) => [c.length, ...c])]);
      if (r !== "APLICADO") throw new HttpError(409, "Hay otro guardado en curso; intenta de nuevo");
    }

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
    // Suelo de versión por página: al borrar guarda la última versión, para que una página recreada con el mismo slug
    // nunca reutilice versiones ya vistas (una petición atrasada no puede coincidir con la página nueva).
    const kVersion = (s) => `hw:version:${proyecto}:${disciplina}:${s}`;
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
        operacion = () =>
          conCandado(kLock("__indice"), async () => {
            const existente = await leerIndice();
            if (existente.length) return respuesta(200, { inicializado: false, paginas: existente });
            const plantilla = plantillas[conf.plantilla];
            if (!Array.isArray(plantilla)) throw new Error("Plantilla no disponible");
            const t = iso();
            // No pisa páginas que ya tengan hash (p. ej. de una inicialización a medias).
            const existen = await almacen.exec(plantilla.map((p) => ["EXISTS", kPag(p.slug)]));
            const nuevas = plantilla.filter((_, i) => !(Number(existen[i]) > 0));
            const suelos = nuevas.length ? await almacen.exec(nuevas.map((p) => ["GET", kVersion(p.slug)])) : [];
            const cmds = nuevas.map((p, i) => ["HSET", kPag(p.slug), "titulo", p.titulo, "md", p.md, "autor", login, "actualizado", t, "version", (Number(suelos[i]) || 0) + 1]);
            // Para slugs con hash existente, el índice usa su título guardado (puede haber sido editado).
            const previos = plantilla.filter((_, i) => Number(existen[i]) > 0);
            const guardados = previos.length ? await almacen.exec(previos.map((p) => ["HGET", kPag(p.slug), "titulo"])) : [];
            const tituloGuardado = new Map(previos.map((p, i) => [p.slug, guardados[i]]));
            const paginas = plantilla.map(({ slug, titulo }) => ({ slug, titulo: typeof tituloGuardado.get(slug) === "string" && tituloGuardado.get(slug) ? tituloGuardado.get(slug) : titulo }));
            await escribir([...cmds, ["SET", kIndice, JSON.stringify(paginas)]]);
            return respuesta(201, { inicializado: true, paginas });
          });
      } else if (accion === "crear") {
        const slug = validarSlug(body.pagina);
        const titulo = validarTitulo(body.titulo);
        operacion = () =>
          conCandado(kLock("__indice"), async () => {
            const indice = await leerIndice();
            const [existe] = await exec(["EXISTS", kPag(slug)]);
            if (Number(existe) > 0 || indice.some((p) => p.slug === slug)) throw new HttpError(409, "La página ya existe");
            const [suelo] = await exec(["GET", kVersion(slug)]);
            const p = { titulo, md: `# ${titulo}\n`, autor: login, actualizado: iso(), version: (Number(suelo) || 0) + 1 };
            await escribir([
              ["HSET", kPag(slug), "titulo", p.titulo, "md", p.md, "autor", p.autor, "actualizado", p.actualizado, "version", p.version],
              ["SET", kIndice, JSON.stringify([...indice, { slug, titulo }])],
            ]);
            return respuesta(201, { pagina: await publica(slug, p) });
          });
      } else if (accion === "reordenar") {
        const orden = body.orden;
        if (!Array.isArray(orden) || orden.some((s) => typeof s !== "string")) throw new HttpError(400, "Orden inválido");
        operacion = () =>
          conCandado(kLock("__indice"), async () => {
            const indice = await leerIndice();
            if (orden.length !== indice.length || new Set(orden).size !== orden.length || !orden.every((s) => indice.some((p) => p.slug === s))) {
              throw new HttpError(400, "El orden debe ser una permutación exacta del índice");
            }
            const paginas = orden.map((s) => indice.find((p) => p.slug === s));
            await escribir([["SET", kIndice, JSON.stringify(paginas)]]);
            return respuesta(200, { paginas });
          });
      } else if (accion === "restaurar") {
        const slug = validarSlug(body.pagina);
        if (!entero(body.revision, 0) || !entero(body.version, 1)) throw new HttpError(400, "Revisión o versión inválidas");
        const { revision, version } = body;
        operacion = () =>
          conCandado(kLock("__indice"), () =>
          conCandado(kLock(slug), async () => {
            const actual = await leerPag(slug);
            if (!actual) throw new HttpError(404, "Página no encontrada");
            if (Number(actual.version) !== version) throw new HttpError(409, "La página cambió", undefined, { version: Number(actual.version) });
            const [crudo] = await exec(["LINDEX", kRev(slug), revision]);
            const rev = typeof crudo === "string" ? parsear(crudo) : null;
            if (!rev || typeof rev.md !== "string") throw new HttpError(404, "Revisión no encontrada");
            const nueva = { titulo: String(rev.titulo ?? actual.titulo), md: rev.md, autor: login, actualizado: iso(), version: version + 1 };
            const cmds = [
              ["LPUSH", kRev(slug), JSON.stringify(estado(actual))],
              ["LTRIM", kRev(slug), 0, MAX_REVISIONES - 1],
              ["HSET", kPag(slug), "titulo", nueva.titulo, "md", nueva.md, "autor", nueva.autor, "actualizado", nueva.actualizado, "version", nueva.version],
            ];
            if (nueva.titulo !== actual.titulo) {
              const indice = await leerIndice();
              cmds.push(["SET", kIndice, JSON.stringify(indice.map((p) => (p.slug === slug ? { slug, titulo: nueva.titulo } : p)))]);
            }
            await escribir(cmds);
            return respuesta(200, { pagina: await publica(slug, nueva) });
          }));
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
        conCandado(kLock("__indice"), () =>
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
          await escribir(cmds);
          return respuesta(200, { pagina: await publica(slug, nueva) });
        }));
    } else {
      const slug = validarSlug(body.pagina);
      if (!entero(body.version, 1)) throw new HttpError(400, "Versión inválida");
      const version = body.version;
      operacion = () =>
        conCandado(kLock("__indice"), () =>
          conCandado(kLock(slug), async () => {
            const actual = await leerPag(slug);
            if (!actual) throw new HttpError(404, "Página no encontrada");
            if (Number(actual.version) !== version) throw new HttpError(409, "La página cambió; recárgala antes de borrar", undefined, { version: Number(actual.version) });
            const indice = (await leerIndice()).filter((p) => p.slug !== slug);
            // Las revisiones viajan con la entrada de la papelera y se borran: un slug recreado no hereda historial ajeno.
            const [lista, suelo] = await Promise.all([exec(["LRANGE", kRev(slug), 0, MAX_REVISIONES - 1]), exec(["GET", kVersion(slug)])]).then((r) => [r[0][0], r[1][0]]);
            const todas = (Array.isArray(lista) ? lista : []).map((r) => parsear(r)).filter(Boolean);
            // Más recientes primero hasta el presupuesto de bytes; las más antiguas que no caben se descartan.
            const revisiones = [];
            let usados = 0;
            for (const r of todas) {
              usados += Buffer.byteLength(JSON.stringify(r));
              if (usados > PRESUPUESTO_PAPELERA_BYTES) break;
              revisiones.push(r);
            }
            const borrada = { ...estado(actual), borradoPor: login, borrado: iso(), revisiones, revisionesOmitidas: todas.length - revisiones.length };
            const piso = Math.max(Number(suelo) || 0, Number(actual.version) || 0);
            await escribir([
              ["HSET", kPapelera, `${slug}:${ahora()}`, JSON.stringify(borrada)],
              ["SET", kIndice, JSON.stringify(indice)],
              ["SET", kVersion(slug), piso],
              ["DEL", kPag(slug)],
              ["DEL", kRev(slug)],
            ]);
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
