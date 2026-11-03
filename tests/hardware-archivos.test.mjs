// Lote 1a: archivos de hardware (api/archivos.js → lib/archivos-core.mjs) sobre Vercel Blob con client uploads.
// El cliente Blob se inyecta ({ handleUpload, leer, borrar }); aquí es un fake que imita a @vercel/blob:
//   - handleUpload con "blob.generate-client-token" llama a onBeforeGenerateToken(pathname, clientPayload, multipart)
//     y devuelve { type, clientToken };
//   - con "blob.upload-completed" exige la firma (x-vercel-signature) y llama a onUploadCompleted(payload).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fakeRedis } from "./fixtures/redis-memoria.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/archivos/`;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const EDITOR = "edi";
const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const ID2 = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const MB = 1024 * 1024;
const BLOB_HOST = "https://abc123.private.blob.vercel-storage.com";

const PROYECTOS = [
  { id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] }, mecanica: { plantilla: "mecanica", editores: ["meca"] } } },
  { id: "proyecto-x", disciplinas: { electronica: { plantilla: "electronica", editores: ["cyuxSz"] } } },
  { id: "usv" },
];

const core = () => import("../lib/archivos-core.mjs");

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function cookieDe(login, { exp = Date.now() + 864e5, secret = SECRET } = {}) {
  const body = Buffer.from(JSON.stringify({ login, exp })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

function fakeBlob() {
  return {
    tokens: [],
    leidos: [],
    borrados: [],
    objetos: new Map(),
    async handleUpload({ body, request, onBeforeGenerateToken, onUploadCompleted }) {
      if (body?.type === "blob.generate-client-token") {
        const { pathname, clientPayload, multipart } = body.payload;
        const opciones = await onBeforeGenerateToken(pathname, clientPayload, multipart);
        // Como el SDK real: callbackUrl solo viaja en el token si el servidor pasó onUploadCompleted.
        this.tokens.push({ pathname, opciones, callbackUrl: onUploadCompleted ? "https://docs.example/api/archivos/" : undefined });
        return { type: "blob.generate-client-token", clientToken: "vercel_blob_client_falso" };
      }
      if (body?.type === "blob.upload-completed") {
        if (request.headers.get("x-vercel-signature") !== "firma-valida") throw new Error("Invalid callback signature");
        await onUploadCompleted?.(body.payload);
        return { type: "blob.upload-completed", response: "ok" };
      }
      throw new Error("Invalid event type");
    },
    async leer(url) {
      this.leidos.push(url);
      const o = this.objetos.get(url);
      if (!o) return null;
      return { stream: new Response(o.bytes).body, contentType: o.contentType, size: o.bytes.length };
    },
    async borrar(url) {
      this.borrados.push(url);
      this.objetos.delete(url);
    },
  };
}

async function montar({ redis = fakeRedis(), blob = fakeBlob(), env = {} } = {}) {
  const { crearHandler } = await core();
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET, ...env }, redis, blob, proyectos: PROYECTOS, ahora: () => T0 });
  return { handler, redis, blob };
}

function req(method, { login, cookie, body, query = {}, origin = ORIGIN, ct = "application/json", headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (login) headers.cookie = cookieDe(login);
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    if (ct) headers["content-type"] = ct;
    if (origin) headers.origin = origin;
  }
  const qs = new URLSearchParams(query).toString();
  return new Request(qs ? `${URL_API}?${qs}` : URL_API, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

const payload = (extra = {}) => ({ proyecto: "uuv", disciplina: "electronica", nombre: "placa.png", tamano: 1000, ...extra });
const pedirToken = (h, { login = EDITOR, pathname, cp = payload(), ...extra } = {}) =>
  h(req("POST", { login, body: { type: "blob.generate-client-token", payload: { pathname: pathname ?? `hw/${cp.proyecto}/${cp.disciplina}/${ID}-${cp.nombre}`, multipart: false, clientPayload: JSON.stringify(cp) } }, ...extra }));

// Simula el callback de Vercel Blob: sin cookie ni Origin, con firma.
const completar = (h, { tokenPayload, pathname, url, firma = "firma-valida", contentType = "image/png" }) =>
  h(req("POST", { origin: null, headers: firma ? { "x-vercel-signature": firma } : {}, body: { type: "blob.upload-completed", payload: { blob: { url, downloadUrl: `${url}?download=1`, pathname, contentType, contentDisposition: "inline" }, tokenPayload } } }));

// Sube un archivo completo (token + callback + objeto en el fake). Devuelve el id.
async function subir(m, { nombre = "placa.png", disciplina = "electronica", login = EDITOR, id = ID, bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]), contentType = "image/png" } = {}) {
  const cp = payload({ nombre, disciplina, tamano: bytes.length });
  const pathname = `hw/uuv/${disciplina}/${id}-${nombre}`;
  const res = await pedirToken(m.handler, { login, pathname, cp });
  assert.equal(res.status, 200, `token para ${nombre}`);
  const { opciones } = m.blob.tokens.at(-1);
  const url = `${BLOB_HOST}/${pathname}`;
  m.blob.objetos.set(url, { bytes, contentType });
  const fin = await completar(m.handler, { tokenPayload: opciones.tokenPayload, pathname, url, contentType });
  assert.equal(fin.status, 200, `callback de ${nombre}`);
  return { id, url, pathname };
}

const getArchivo = (h, id, login = "ana", proyecto = "uuv") => h(req("GET", { login, query: { proyecto, id } }));
const listar = (h, login = "ana", proyecto = "uuv") => h(req("GET", { login, query: { proyecto, lista: "1" } }));

// ---------- Nombres y tipos ----------

test("sanearNombre: quita rutas (../, \\), caracteres raros y deja un nombre seguro con la extensión", async () => {
  const { sanearNombre } = await core();
  assert.equal(sanearNombre("../../etc/passwd.png"), "passwd.png");
  assert.equal(sanearNombre("..\\..\\windows\\x.step"), "x.step");
  for (const raw of ["../../etc/passwd.png", "..\\..\\x.step", "mi placa (v2).kicad_pcb", "....png", ".oculto.pdf", "a\u0000b\r\n.csv", "a/../../b.stl", "%2e%2e%2fx.png", "x".repeat(300) + ".glb", "señal ñ.pdf"]) {
    const s = sanearNombre(raw);
    assert.equal(typeof s, "string", raw);
    assert.ok(s.length >= 1 && s.length <= 100, `${raw} → longitud ${s.length}`);
    assert.match(s, /^[A-Za-z0-9][A-Za-z0-9._-]*$/, `${JSON.stringify(raw)} → ${s}`);
    assert.ok(!s.includes(".."), `${raw} → ${s} sin ..`);
    assert.ok(sanearNombre(s) === s, `idempotente: ${s}`);
  }
  assert.match(sanearNombre("mi placa (v2).kicad_pcb"), /\.kicad_pcb$/);
  assert.match(sanearNombre("x".repeat(300) + ".glb"), /\.glb$/, "al recortar conserva la extensión");
});

test("lista blanca de tipos: extensión → Content-Type, tamaño máximo (imágenes 10 MB, resto 50 MB) e inline", async () => {
  const { TIPOS } = await core();
  const esperadas = ["png", "jpg", "jpeg", "webp", "svg", "pdf", "kicad_sch", "kicad_pcb", "kicad_pro", "step", "stp", "stl", "glb", "3mf", "sldprt", "sldasm", "slddrw", "zip", "csv"];
  assert.deepEqual(Object.keys(TIPOS).sort(), [...esperadas].sort());
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) assert.equal(TIPOS[ext].max, 10 * MB, ext);
  for (const ext of esperadas.filter((e) => !["png", "jpg", "jpeg", "webp", "svg"].includes(e))) assert.equal(TIPOS[ext].max, 50 * MB, ext);
  for (const ext of ["png", "jpg", "jpeg", "webp", "pdf"]) assert.equal(TIPOS[ext].inline, true, `${ext} inline`);
  for (const ext of esperadas.filter((e) => !["png", "jpg", "jpeg", "webp", "pdf"].includes(e))) assert.equal(TIPOS[ext].inline, false, `${ext} attachment`);
  assert.equal(TIPOS.png.mime, "image/png");
  assert.equal(TIPOS.jpg.mime, "image/jpeg");
  assert.equal(TIPOS.svg.mime, "image/svg+xml");
  assert.equal(TIPOS.pdf.mime, "application/pdf");
  for (const ext of esperadas) assert.doesNotMatch(TIPOS[ext].mime, /html|javascript|ecmascript/i, `${ext}: ${TIPOS[ext].mime}`);
});

// ---------- Token de subida (client upload) ----------

test("token: 401 sin sesión, 403 no editor, 403 proyecto restringido, 404 disciplina no configurada; sin token emitido", async () => {
  const m = await montar();
  assert.equal((await pedirToken(m.handler, { login: null })).status, 401);
  assert.equal((await pedirToken(m.handler, { login: "ana" })).status, 403, "no editor");
  assert.equal((await pedirToken(m.handler, { login: "meca" })).status, 403, "editor de otra disciplina");
  assert.equal((await pedirToken(m.handler, { login: "ana", cp: payload({ proyecto: "proyecto-x" }) })).status, 403, "restringido");
  assert.equal((await pedirToken(m.handler, { cp: payload({ disciplina: "software" }) })).status, 404);
  assert.equal((await pedirToken(m.handler, { cp: payload({ proyecto: "usv" }) })).status, 404);
  assert.equal(m.blob.tokens.length, 0);
});

test("token: el editor recibe clientToken con tipos y tamaño máximo según la extensión, sin sobrescribir", async () => {
  const m = await montar();
  const res = await pedirToken(m.handler);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await res.json()).clientToken, "vercel_blob_client_falso");
  const { pathname, opciones } = m.blob.tokens[0];
  assert.equal(pathname, `hw/uuv/electronica/${ID}-placa.png`);
  assert.equal(opciones.maximumSizeInBytes, 10 * MB);
  assert.ok(opciones.allowedContentTypes.includes("image/png"));
  assert.ok(!opciones.allowedContentTypes.some((t) => /html|\*/.test(t)), "sin comodines ni html");
  assert.equal(opciones.addRandomSuffix, false);
  assert.notEqual(opciones.allowOverwrite, true);
  const tp = JSON.parse(opciones.tokenPayload);
  assert.equal(tp.proyecto, "uuv");
  assert.equal(tp.disciplina, "electronica");
  assert.equal(tp.id, ID);
  assert.equal(tp.subidoPor, EDITOR);

  await pedirToken(m.handler, { cp: payload({ nombre: "casco.step", tamano: 40 * MB }) });
  assert.equal(m.blob.tokens[1].opciones.maximumSizeInBytes, 50 * MB, "CAD: 50 MB");
});

test("token: tipos fuera de la lista blanca → 400; tamaño declarado mayor al máximo → 413", async () => {
  const m = await montar();
  for (const nombre of ["virus.exe", "pagina.html", "x.js", "x.svgz", "sin-extension", "x.png.exe", "x.htm", "x.mjs"]) {
    const res = await pedirToken(m.handler, { cp: payload({ nombre }) });
    assert.equal(res.status, 400, nombre);
  }
  assert.equal((await pedirToken(m.handler, { cp: payload({ nombre: "foto.png", tamano: 10 * MB + 1 }) })).status, 413);
  assert.equal((await pedirToken(m.handler, { cp: payload({ nombre: "casco.step", tamano: 50 * MB + 1 }) })).status, 413);
  for (const tamano of [-1, "10", null, 1.5]) assert.equal((await pedirToken(m.handler, { cp: payload({ tamano }) })).status, 400, `tamano ${tamano}`);
  assert.equal(m.blob.tokens.length, 0);
  // La extensión se compara sin distinguir mayúsculas.
  assert.equal((await pedirToken(m.handler, { cp: payload({ nombre: "Foto.PNG" }), pathname: `hw/uuv/electronica/${ID}-Foto.PNG` })).status, 200);
});

test("token: el pathname debe ser exactamente hw/<proy>/<disc>/<uuid>-<nombre saneado>; con ../ u otro proyecto → 400", async () => {
  const m = await montar();
  const malos = [
    `hw/uuv/electronica/${ID}-../../x.png`,
    `hw/uuv/electronica/../mecanica/${ID}-placa.png`,
    `hw/proyecto-x/electronica/${ID}-placa.png`,
    `hw/uuv/mecanica/${ID}-placa.png`,
    `hw/uuv/electronica/no-uuid-placa.png`,
    `hw/uuv/electronica/${ID}-otra.png`,
    `/hw/uuv/electronica/${ID}-placa.png`,
    `otro/uuv/electronica/${ID}-placa.png`,
  ];
  for (const pathname of malos) assert.equal((await pedirToken(m.handler, { pathname })).status, 400, pathname);
  const { sanearNombre } = await core();
  const cp = payload({ nombre: "../../etc/passwd.png" });
  assert.equal((await pedirToken(m.handler, { cp, pathname: `hw/uuv/electronica/${ID}-../../etc/passwd.png` })).status, 400, "nombre sin sanear");
  assert.equal((await pedirToken(m.handler, { cp, pathname: `hw/uuv/electronica/${ID}-${sanearNombre(cp.nombre)}` })).status, 200, "nombre saneado");
  assert.equal(m.blob.tokens.length, 1);
  assert.ok(!m.blob.tokens[0].pathname.includes(".."));
});

test("token: solo JSON y mismo origen (415 / 403)", async () => {
  const m = await montar();
  assert.equal((await pedirToken(m.handler, { ct: "text/plain" })).status, 415);
  assert.equal((await pedirToken(m.handler, { origin: "https://evil.example" })).status, 403);
  assert.equal(m.blob.tokens.length, 0);
});

// ---------- Callback de Vercel Blob (onUploadCompleted) ----------

test("callback firmado guarda metadatos en hw:arch:<proy> (id → JSON) sin cookie de sesión", async () => {
  const m = await montar();
  const { url } = await subir(m);
  const h = m.redis.data.get("hw:arch:uuv");
  assert.ok(h instanceof Map, "hash de archivos por proyecto");
  const meta = JSON.parse(h.get(ID));
  assert.equal(meta.nombre, "placa.png");
  assert.equal(meta.tipo, "png");
  assert.equal(meta.tamano, 7);
  assert.equal(meta.blobUrl, url);
  assert.equal(meta.subidoPor, EDITOR);
  assert.equal(meta.fecha, new Date(T0).toISOString());
  assert.equal(meta.disciplina, "electronica");
});

test("el token incluye callbackUrl (handleUpload recibe onUploadCompleted al generarlo); sin él Vercel nunca llamaría al callback", async () => {
  const m = await montar();
  await pedirToken(m.handler);
  assert.ok(m.blob.tokens.at(-1).callbackUrl, "token con callbackUrl");
});

test("callback sin firma válida o con pathname distinto al del token → error y no guarda nada", async () => {
  const m = await montar();
  await pedirToken(m.handler);
  const { opciones } = m.blob.tokens[0];
  const pathname = `hw/uuv/electronica/${ID}-placa.png`;
  const url = `${BLOB_HOST}/${pathname}`;
  for (const firma of [null, "falsa"]) {
    const res = await completar(m.handler, { tokenPayload: opciones.tokenPayload, pathname, url, firma });
    assert.ok(res.status >= 400, `firma ${firma} → ${res.status}`);
  }
  const otro = `hw/uuv/electronica/${ID2}-otra.png`;
  const res = await completar(m.handler, { tokenPayload: opciones.tokenPayload, pathname: otro, url: `${BLOB_HOST}/${otro}` });
  assert.ok(res.status >= 400, "pathname que no corresponde al token");
  assert.ok(!m.redis.data.has("hw:arch:uuv"), "nada guardado");
});

// ---------- Lectura: lista y proxy ----------

test("lista: GET ?proyecto&lista=1 devuelve metadatos sin blobUrl; 401 sin sesión; 403 restringido", async () => {
  const m = await montar();
  const { url } = await subir(m);
  const res = await listar(m.handler);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  const texto = await res.text();
  assert.ok(!texto.includes(url) && !texto.includes("blob.vercel-storage.com") && !texto.includes("blobUrl"), "nunca expone la URL del Blob");
  const { archivos } = JSON.parse(texto);
  assert.deepEqual(Object.keys(archivos[0]).sort(), ["disciplina", "fecha", "id", "nombre", "subidoPor", "tamano", "tipo"]);
  assert.equal((await m.handler(req("GET", { query: { proyecto: "uuv", lista: "1" } }))).status, 401);
  assert.equal((await listar(m.handler, "ana", "proyecto-x")).status, 403);
});

test("proxy: GET ?proyecto&id sirve los bytes con Content-Type de la lista blanca, nosniff e inline (png); nunca la URL del Blob", async () => {
  const m = await montar();
  const bytes = new Uint8Array([137, 80, 78, 71, 9, 9]);
  // El Blob dice text/html: el proxy no le hace caso.
  const { url } = await subir(m, { bytes, contentType: "text/html" });
  const res = await getArchivo(m.handler, ID);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("content-disposition") ?? "", /^inline;/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("location"), null);
  for (const [k, v] of res.headers) assert.ok(!v.includes(url) && !v.includes("blob.vercel-storage.com"), `cabecera ${k} expone el Blob`);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
  assert.deepEqual(m.blob.leidos, [url]);
});

test("proxy: svg va como attachment con CSP sandbox; CAD y otros como attachment", async () => {
  const m = await montar();
  await subir(m, { nombre: "logo.svg", id: ID, bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), contentType: "image/svg+xml" });
  const svg = await getArchivo(m.handler, ID);
  assert.equal(svg.status, 200);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.match(svg.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.equal(svg.headers.get("content-security-policy"), "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  assert.equal(svg.headers.get("x-content-type-options"), "nosniff");

  await subir(m, { nombre: "casco.step", id: ID2, bytes: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream" });
  const step = await getArchivo(m.handler, ID2);
  assert.equal(step.status, 200);
  assert.match(step.headers.get("content-disposition") ?? "", /^attachment;/);
  assert.match(step.headers.get("content-disposition") ?? "", /casco\.step/);
});

test("proxy: Content-Disposition con el nombre saneado (sin comillas, CR/LF, / ni ..)", async () => {
  const m = await montar();
  const { sanearNombre } = await core();
  const nombre = sanearNombre('../a"b\r\nSet-Cookie: x=1.pdf');
  await subir(m, { nombre, bytes: new Uint8Array([37, 80, 68, 70]), contentType: "application/pdf" });
  const res = await getArchivo(m.handler, ID);
  assert.equal(res.status, 200);
  const cd = res.headers.get("content-disposition") ?? "";
  assert.match(cd, /^inline;/, "pdf inline");
  assert.ok(!/[\r\n]|\.\.|\//.test(cd), cd);
  assert.equal((cd.match(/"/g) ?? []).length % 2, 0, "comillas balanceadas");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("proxy: 401 sin sesión, 403 proyecto restringido, 400 id no uuid, 404 id inexistente; no lee el Blob", async () => {
  const m = await montar();
  await subir(m);
  assert.equal((await m.handler(req("GET", { query: { proyecto: "uuv", id: ID } }))).status, 401);
  assert.equal((await getArchivo(m.handler, ID, "ana", "proyecto-x")).status, 403);
  for (const id of ["../x", "123", ""]) assert.equal((await getArchivo(m.handler, id)).status, 400, id);
  assert.equal((await getArchivo(m.handler, ID2)).status, 404);
  assert.equal(m.blob.leidos.length, 0);
});

// ---------- Borrado ----------

test("DELETE {proyecto, id}: solo editores de la disciplina del archivo; borra el Blob y los metadatos", async () => {
  const m = await montar();
  const { url } = await subir(m);
  const del = (login, body = { proyecto: "uuv", id: ID }, extra = {}) => m.handler(req("DELETE", { login, body, ...extra }));
  assert.equal((await del(null)).status, 401);
  assert.equal((await del("ana")).status, 403);
  assert.equal((await del("meca")).status, 403, "editor de otra disciplina");
  assert.equal((await del(EDITOR, { proyecto: "uuv", id: ID }, { origin: "https://evil.example" })).status, 403);
  assert.equal(m.blob.borrados.length, 0);
  const res = await del(EDITOR);
  assert.equal(res.status, 200);
  assert.deepEqual(m.blob.borrados, [url]);
  assert.ok(!(m.redis.data.get("hw:arch:uuv")?.has(ID)), "metadatos borrados");
  assert.equal((await del(EDITOR)).status, 404);
});

// ---------- Configuración ----------

test("503 si no hay Blob ni Redis configurados", async () => {
  const { crearHandler } = await core();
  const sinBlob = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: fakeRedis(), blob: null, proyectos: PROYECTOS });
  assert.equal((await sinBlob(req("GET", { login: "ana", query: { proyecto: "uuv", id: ID } }))).status, 503);
  const sinRedis = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: null, blob: fakeBlob(), proyectos: PROYECTOS });
  assert.equal((await sinRedis(req("GET", { login: "ana", query: { proyecto: "uuv", lista: "1" } }))).status, 503);
});

test("api/archivos.js delega en lib/archivos-core.mjs y usa @vercel/blob (handleUpload de @vercel/blob/client)", () => {
  const src = readFileSync(new URL("../api/archivos.js", import.meta.url), "utf8");
  assert.match(src, /lib\/archivos-core\.mjs/);
  assert.match(src, /projects\.json["']\s+with\s+\{\s*type:\s*["']json["']\s*\}/);
  for (const m of ["GET", "POST", "DELETE"]) assert.match(src, new RegExp(`export const ${m}\\b`));
  const coreSrc = readFileSync(new URL("../lib/archivos-core.mjs", import.meta.url), "utf8");
  assert.match(coreSrc + src, /@vercel\/blob\/client/);
  assert.doesNotMatch(coreSrc, /\/pipeline/, "reutiliza clienteRedis del módulo compartido");
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.dependencies?.["@vercel/blob"] ?? "", /^\d+\.\d+\.\d+$/, "@vercel/blob fijada a versión exacta");
});

// ---------- Unicidad de id y replay ----------

test("un editor de mecanica no puede pisar el id de un archivo de electronica (409) y los metadatos no cambian", async () => {
  const m = await montar();
  await subir(m);
  const antes = m.redis.data.get("hw:arch:uuv").get(ID);
  const cp = payload({ disciplina: "mecanica" });
  const res = await pedirToken(m.handler, { login: "meca", pathname: `hw/uuv/mecanica/${ID}-placa.png`, cp });
  assert.equal(res.status, 409);
  // Callback directo con tokenPayload propio: HSETNX no sobrescribe.
  const tokenPayload = JSON.stringify({ proyecto: "uuv", disciplina: "mecanica", id: ID, nombre: "placa.png", tipo: "png", tamano: 5, subidoPor: "meca", pathname: `hw/uuv/mecanica/${ID}-placa.png` });
  const fin = await completar(m.handler, { tokenPayload, pathname: `hw/uuv/mecanica/${ID}-placa.png`, url: `${BLOB_HOST}/otro` });
  assert.equal(fin.status, 200);
  assert.equal(m.redis.data.get("hw:arch:uuv").get(ID), antes);
});

test("replay del callback tras DELETE no reinserta el archivo", async () => {
  const m = await montar();
  const { url, pathname } = await subir(m);
  const { opciones } = m.blob.tokens.at(-1);
  assert.equal((await m.handler(req("DELETE", { login: EDITOR, body: { proyecto: "uuv", id: ID } }))).status, 200);
  const fin = await completar(m.handler, { tokenPayload: opciones.tokenPayload, pathname, url });
  assert.equal(fin.status, 200);
  assert.ok(!m.redis.data.get("hw:arch:uuv")?.has(ID));
  assert.equal((await pedirToken(m.handler, { pathname: `hw/uuv/electronica/${ID}-placa.png` })).status, 409);
});

test("callback: lápida + inserción en un único EVAL; un DELETE justo antes de la inserción no se reinserta", async () => {
  const m = await montar();
  const { url, pathname } = await subir(m);
  const { opciones } = m.blob.tokens.at(-1);
  m.redis.data.get("hw:arch:uuv").delete(ID); // callback aún en vuelo
  const orig = m.redis.exec.bind(m.redis);
  m.redis.exec = async (cmds) => {
    // El DELETE se cuela justo antes de que llegue el check+insert.
    if (cmds.some((c) => c[0] === "EVAL")) m.redis.data.set("hw:arch:borrados:uuv", new Set([ID]));
    return orig(cmds);
  };
  m.redis.comandos.length = 0;
  const fin = await completar(m.handler, { tokenPayload: opciones.tokenPayload, pathname, url });
  assert.equal(fin.status, 200);
  assert.ok(!m.redis.data.get("hw:arch:uuv")?.has(ID), "no se reinserta");
  assert.ok(!m.redis.comandos.some((c) => ["SISMEMBER", "HSETNX"].includes(String(c[0]).toUpperCase())), "sin SISMEMBER/HSETNX sueltos");
});

test("callback sin lápida inserta con EVAL y no pisa un existente", async () => {
  const m = await montar();
  const { url, pathname } = await subir(m);
  const { opciones } = m.blob.tokens.at(-1);
  const antes = m.redis.data.get("hw:arch:uuv").get(ID);
  assert.ok(antes);
  const fin = await completar(m.handler, { tokenPayload: opciones.tokenPayload, pathname, url: `${url}-otro` });
  assert.equal(fin.status, 200);
  assert.equal(m.redis.data.get("hw:arch:uuv").get(ID), antes);
});

test("sin acceso al proyecto el 403 va antes del 404 de disciplina", async () => {
  const m = await montar();
  const cp = payload({ proyecto: "proyecto-x", disciplina: "inexistente" });
  const res = await pedirToken(m.handler, { login: "ana", pathname: `hw/proyecto-x/inexistente/${ID}-placa.png`, cp });
  assert.equal(res.status, 403);
});
