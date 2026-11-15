// Worker de Cloudflare: login de GitHub (lib/login-core.mjs) delante de los static assets de dist/.
// Las cabeceras de vercel.json no existen aquí, así que se aplican a mano. Las APIs llegan en M2 (hoy responden 501).
import { manejarLogin } from "../lib/login-core.mjs";
import { decodificar } from "../lib/decodificar-ruta.mjs";

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
  return (ruta.split("/")[2] ?? "").toLowerCase() === "arch";
}

// Copia la respuesta (las de ASSETS tienen cabeceras inmutables) y fija las cabeceras.
function conCabeceras(res, fijas, soloFaltantes = false) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(fijas)) {
    if (!soloFaltantes || !out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
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
        res = Response.json({ error: "No disponible aún en Cloudflare" }, { status: 501 });
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
