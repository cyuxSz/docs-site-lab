// Login con GitHub para todo el portal (Routing Middleware de Vercel, corre antes de servir cada archivo).
// Solo entra quien pertenece a ALLOWED_ORG o está en ALLOWED_USERS.
//
// Variables de entorno (Vercel → Settings → Environment Variables):
//   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET  OAuth App de GitHub (callback: https://<dominio>/auth/callback)
//   SESSION_SECRET                          32+ caracteres aleatorios para firmar la cookie
//   ALLOWED_ORG                             p. ej. vanttec (requiere que la org permita la OAuth App)
//   ALLOWED_USERS                           opcional, logins separados por coma (respaldo si la org restringe apps)
//   PREVIEW_TRUST_VERCEL_AUTH               "1" para dejar pasar los Preview sin login de GitHub. Solo si Vercel → Settings →
//                                           Deployment Protection tiene activado Vercel Authentication (el valor por defecto).
//
// Los Preview tienen otro dominio y la OAuth App solo acepta el callback de producción. Un pase firmado de producción
// al preview obligaba a aceptar cualquier *.vercel.app parecido (cualquiera puede registrar ese nombre), así que los
// Preview se protegen con el login de Vercel y, si no se confía en él, responden 403.
import { next } from "@vercel/functions";
import { manejarLogin } from "./lib/login-core.mjs";
// La sesión (lib/sesion.mjs) la firma y verifica el core; este import fija que el formato de la cookie es el compartido.
import { COOKIE as _COOKIE_SESION } from "./lib/sesion.mjs";

export const config = {
  matcher: ["/((?!favicon\\.ico$).*)"],
};

// Envoltorio de Vercel: la lógica del login vive en lib/login-core.mjs.
// `restringidos` solo lo inyectan los tests; en producción se usa la tabla de access.config.js.
export function crearMiddleware({ restringidos } = {}) {
  return function middleware(request) {
    return manejarLogin(request, process.env, { continuar: (h) => next({ headers: h }), vercel: true, restringidos });
  };
}

export default crearMiddleware();
