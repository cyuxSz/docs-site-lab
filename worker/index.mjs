// Worker de Cloudflare: login de GitHub (lib/login-core.mjs) delante de los static assets de dist/.
// Las cabeceras de vercel.json no existen aquí, así que se aplican a mano.
import { manejarLogin } from "../lib/login-core.mjs";
import { decodificar } from "../lib/decodificar-ruta.mjs";
import { crearHandler as crearComentarios } from "../lib/comentarios-core.mjs";
import { crearHandler as crearArchivos } from "../lib/archivos-core.mjs";
import { crearAlmacenR2 } from "../lib/almacen-r2.mjs";
import { crearHandler as crearHardware } from "../lib/hardware-core.mjs";
import proyectos from "../projects.json" with { type: "json" };
import electronica from "../plantillas/electronica.json" with { type: "json" };
import mecanica from "../plantillas/mecanica.json" with { type: "json" };

const GLOBALES = {
  "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};
const SANDBOX = "sandbox allow-scripts allow-downloads allow-popups; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

// /:project/arch/* (sin distinguir mayúsculas, ruta decodificada). Si no se puede decodificar, falla cerrado: sandbox.
function esArch(pathname) {
  const ruta = decodificar(pathname);
  if (ruta === null) return true;
  // Misma segmentación que canAccess: separa por / y \, descarta vacíos y ".".
  const segs = ruta.split(/[/\\]/).filter((s) => s !== "" && s !== ".");
  return (segs[1] ?? "").toLowerCase() === "arch";
}

// Copia la respuesta (las de ASSETS tienen cabeceras inmutables) y fija las cabeceras.
function conCabeceras(res, fijas, soloFaltantes = false) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(fijas)) {
    if (!soloFaltantes || !out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

// Handlers memoizados por objeto env (nunca se comparten entre env distintos).
const handlers = new WeakMap();
function handlerDe(env, nombre) {
  let h = handlers.get(env);
  if (!h) handlers.set(env, (h = {}));
  if (!h[nombre]) {
    h[nombre] =
      nombre === "comentarios"
        ? crearComentarios({ env, proyectos })
        : nombre === "hardware"
          ? crearHardware({ env, proyectos, plantillas: { electronica, mecanica } })
          : crearArchivos({ env, proyectos, blob: env.ARCHIVOS ? crearAlmacenR2(env.ARCHIVOS) : null });
  }
  return h[nombre];
}

async function atenderApi(request, env, path) {
  if (path === "/api/comentarios" || path === "/api/comentarios/") return handlerDe(env, "comentarios")(request);
  if (path === "/api/archivos" || path === "/api/archivos/") return handlerDe(env, "archivos")(request);
  if (path === "/api/hardware" || path === "/api/hardware/") return handlerDe(env, "hardware")(request);
  return Response.json({ error: "No encontrado" }, { status: 404 });
}

function destinoRedireccion(pathname) {
  let m = /^\/([^/]+)\/wiki\/?$/.exec(pathname);
  if (m) return `/${m[1]}/grafo/`;
  m = /^\/([^/]+)\/content(?:\/.*)?$/.exec(pathname);
  if (m) return `/${m[1]}/software/`;
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const propias = new WeakSet();
    const continuar = async (extra) => {
      const extras = extra instanceof Headers ? Object.fromEntries(extra) : { ...extra };
      const path = url.pathname;
      let res;
      if (path === "/api" || path.startsWith("/api/")) {
        // Las cabeceras propias de la API ganan (CSP sandbox del SVG, Content-Disposition, Allow, Retry-After...).
        const api = await atenderApi(request, env, path);
        const out = conCabeceras(api, GLOBALES, true);
        if (!/no-store/i.test(out.headers.get("Cache-Control") ?? "")) out.headers.set("Cache-Control", "no-store");
        for (const [k, v] of Object.entries(extras)) out.headers.set(k, v);
        propias.add(out);
        return out;
      } else {
        const destino = destinoRedireccion(path);
        if (destino && /^\/(?![/\\])/.test(destino)) res = new Response(null, { status: 301, headers: { Location: destino } });
        else res = await env.ASSETS.fetch(request);
      }
      const fijas = { ...GLOBALES, ...extras };
      if (esArch(path)) fijas["Content-Security-Policy"] = SANDBOX;
      const out = conCabeceras(res, fijas);
      propias.add(out);
      return out;
    };
    const res = await manejarLogin(request, env, { continuar });
    // Las páginas propias del login conservan sus cabeceras; solo se añaden las globales que falten.
    return propias.has(res) ? res : conCabeceras(res, GLOBALES, true);
  },
};
