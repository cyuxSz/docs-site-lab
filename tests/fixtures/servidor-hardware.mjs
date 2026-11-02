// Servidor local de usar y tirar para probar la interfaz de hardware en un navegador real (no lo recoge `npm test`).
//   npm run build && node tests/fixtures/servidor-hardware.mjs [--puerto 4330] [--login cyuxSz]
// Sirve dist/ con las cabeceras de vercel.json y monta los handlers reales de /api/hardware/, /api/archivos/ y
// /api/comentarios/ con un único Redis en memoria. /auth/me devuelve el login; la cookie firmada se pone sola y
// `?como=<login>` cambia de usuario (por ejemplo ?como=ana para probar como lector). Escucha solo en 127.0.0.1.
//
// Blob falso: handleUpload devuelve un clientToken de prueba tras llamar a onBeforeGenerateToken (así se ejercita la
// validación real del pathname); PUT /__blob/?pathname=… guarda el cuerpo en memoria, ejecuta onUploadCompleted y
// responde el JSON de PutBlobResult. Para que upload() use este Blob, en la consola del navegador antes de subir:
//   window.process = { env: { VERCEL_BLOB_API_URL: location.origin + "/__blob" } }
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { fakeRedis } from "./redis-memoria.mjs";
import { sign } from "../../lib/sesion.mjs";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(raiz, "dist");
const arg = (nombre, defecto) => {
  const i = process.argv.indexOf(`--${nombre}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defecto;
};
const PUERTO = Number(arg("puerto", "4330"));
const LOGIN = arg("login", "cyuxSz");
const SECRET = "servidor-local-hardware-".padEnd(40, "x");
process.env.SESSION_SECRET = SECRET;

const leerJson = (ruta) => JSON.parse(readFileSync(join(raiz, ruta), "utf8"));
const proyectos = leerJson("projects.json");
const plantillas = { electronica: leerJson("plantillas/electronica.json"), mecanica: leerJson("plantillas/mecanica.json") };
const cabecerasVercel = (leerJson("vercel.json").headers ?? [])[0]?.headers ?? [];

const redis = fakeRedis();

// ---------- Blob falso ----------
const archivos = new Map(); // pathname -> { cuerpo: Buffer, tipo }
const tokens = new Map(); // clientToken -> { pathname, tokenPayload, completado }
const URL_BLOB = "https://blob.invalido.local/";
const blob = {
  async handleUpload({ body, onBeforeGenerateToken, onUploadCompleted }) {
    if (body.type === "blob.generate-client-token") {
      const { pathname, clientPayload, multipart } = body.payload;
      const opciones = await onBeforeGenerateToken(pathname, clientPayload, multipart);
      const clientToken = `vercel_blob_client_local_${Buffer.from(`${tokens.size}-${Date.now()}`).toString("hex")}`;
      tokens.set(clientToken, { pathname, tokenPayload: opciones.tokenPayload });
      console.log(`[blob] token para ${pathname}`, opciones.tokenPayload);
      return { type: "blob.generate-client-token", clientToken };
    }
    if (body.type === "blob.upload-completed") {
      await onUploadCompleted?.(body.payload);
      return { type: "blob.upload-completed", response: "ok" };
    }
    throw new Error("Evento no soportado");
  },
  async leer(url) {
    const hallado = archivos.get(String(url).replace(URL_BLOB, ""));
    if (!hallado) return null;
    return { stream: Readable.toWeb(Readable.from(hallado.cuerpo)), contentType: hallado.tipo, size: hallado.cuerpo.length };
  },
  async borrar(url) {
    archivos.delete(String(url).replace(URL_BLOB, ""));
  },
};

const { crearHandler: crearHardware } = await import("../../lib/hardware-core.mjs");
const { crearHandler: crearArchivos } = await import("../../lib/archivos-core.mjs");
const { crearHandler: crearComentarios } = await import("../../lib/comentarios-core.mjs");
const env = { SESSION_SECRET: SECRET };
const handlers = {
  "/api/hardware/": crearHardware({ env, redis, proyectos, plantillas }),
  "/api/archivos/": crearArchivos({ env, redis, blob, proyectos }),
  "/api/comentarios/": crearComentarios({ env, redis, proyectos }),
};

// ---------- utilidades HTTP ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon" };

async function cuerpoDe(req) {
  const trozos = [];
  for await (const t of req) trozos.push(t);
  return Buffer.concat(trozos);
}

function loginDe(req, url) {
  const como = url.searchParams.get("como");
  if (como && /^[A-Za-z0-9-]{1,39}$/.test(como)) return como;
  const m = /(?:^|;\s*)login_local=([A-Za-z0-9-]{1,39})/.exec(req.headers.cookie ?? "");
  return m ? m[1] : LOGIN;
}

async function enviar(res, respuesta, extra = []) {
  const cab = {};
  respuesta.headers.forEach((v, k) => (cab[k] = v));
  res.writeHead(respuesta.status, { ...cab, "set-cookie": extra });
  if (!respuesta.body) return res.end();
  Readable.fromWeb(respuesta.body).pipe(res);
}

function servirEstatico(req, res, url) {
  let ruta = normalize(decodeURIComponent(url.pathname));
  let archivo = join(dist, ruta);
  if (archivo !== dist && !archivo.startsWith(dist + sep)) {
    res.writeHead(403).end("Prohibido");
    return;
  }
  if (existsSync(archivo) && statSync(archivo).isDirectory()) archivo = join(archivo, "index.html");
  if (!existsSync(archivo)) {
    const e404 = join(dist, "404.html");
    res.writeHead(404, { "content-type": MIME[".html"] });
    res.end(existsSync(e404) ? readFileSync(e404) : "No encontrado");
    return;
  }
  const cab = { "content-type": MIME[extname(archivo)] ?? "application/octet-stream" };
  for (const h of cabecerasVercel) cab[h.key.toLowerCase()] = h.value;
  res.writeHead(200, cab);
  res.end(readFileSync(archivo));
}

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`);
    const login = loginDe(req, url);
    const cookie = `docs_session=${encodeURIComponent(await sign({ login, exp: Date.now() + 864e5 }, SECRET))}`;
    const setCookie = [`${cookie}; Path=/; HttpOnly; SameSite=Lax`, `login_local=${login}; Path=/; SameSite=Lax`];

    if (url.pathname === "/auth/me") {
      return enviar(res, Response.json({ login }), setCookie);
    }
    // Blob falso: PUT /__blob/?pathname=…
    if (url.pathname.startsWith("/__blob")) {
      const pathname = url.searchParams.get("pathname");
      const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
      const t = token && tokens.get(token);
      if (req.method !== "PUT" || !pathname || !t || t.pathname !== pathname) return enviar(res, Response.json({ error: "Token inválido" }, { status: 403 }));
      const cuerpo = await cuerpoDe(req);
      const tipo = String(req.headers["x-content-type"] ?? "application/octet-stream");
      archivos.set(pathname, { cuerpo, tipo });
      const resultado = { url: URL_BLOB + pathname, downloadUrl: `${URL_BLOB}${pathname}?download=1`, pathname, contentType: tipo, contentDisposition: "inline", etag: `"local"` };
      // Equivale al callback de Vercel: lo recibe el handler real de /api/archivos/ (sin cookie ni Origin) y escribe hw:arch:<p>.
      const aviso = await handlers["/api/archivos/"](new Request(new URL("/api/archivos/", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "blob.upload-completed", payload: { blob: resultado, tokenPayload: t.tokenPayload } }) }));
      if (!aviso.ok) console.warn(`[blob] onUploadCompleted falló: ${aviso.status}`);
      console.log(`[blob] guardado ${pathname} (${cuerpo.length} bytes)`);
      return enviar(res, Response.json(resultado));
    }
    const handler = handlers[url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`];
    if (handler && url.pathname.startsWith("/api/")) {
      const cuerpo = ["GET", "HEAD"].includes(req.method) ? undefined : await cuerpoDe(req);
      const cabeceras = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && k !== "cookie") cabeceras.set(k, v);
      cabeceras.set("cookie", cookie);
      url.searchParams.delete("como");
      const peticion = new Request(url, { method: req.method, headers: cabeceras, body: cuerpo });
      return enviar(res, await handler(peticion), setCookie);
    }
    res.setHeader("set-cookie", setCookie);
    return servirEstatico(req, res, url);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end("Error interno del servidor de prueba");
  }
});

if (!existsSync(dist)) console.warn("Aviso: no existe dist/. Ejecuta `npm run build` (o `npx astro build`) antes.");
servidor.listen(PUERTO, "127.0.0.1", () => {
  console.log(`Servidor de hardware en http://127.0.0.1:${PUERTO}/  (usuario: ${LOGIN}; cambia con ?como=<login>)`);
  console.log(`Prueba: http://127.0.0.1:${PUERTO}/uuv/electronica/`);
  console.log('Para subir con el Blob falso, en la consola: window.process = { env: { VERCEL_BLOB_API_URL: location.origin + "/__blob" } }');
});
