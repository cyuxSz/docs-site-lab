// Vercel Function: /api/comentarios/ (GET, POST, PATCH, DELETE). Delega en lib/comentarios-core.mjs.
// Variables de entorno:
//   SESSION_SECRET                                   el mismo que usa middleware.js (verifica la cookie docs_session)
//   KV_REST_API_URL, KV_REST_API_TOKEN               Upstash Redis (los crea la integración de Vercel)
//   o UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
// projects.json va como import estático para que el bundler de Vercel lo incluya en la función.
import proyectos from "../projects.json" with { type: "json" };
import { crearHandler } from "../lib/comentarios-core.mjs";

let handler;
const obtener = () => (handler ??= crearHandler({ env: process.env, proyectos }));

const delegar = (request) => obtener()(request);
export const GET = delegar;
export const POST = delegar;
export const PATCH = delegar;
export const DELETE = delegar;
