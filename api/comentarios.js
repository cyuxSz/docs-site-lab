// Vercel Function: /api/comentarios/ (GET, POST, PATCH, DELETE). Delega en lib/comentarios-core.mjs.
// Variables de entorno:
//   SESSION_SECRET                                   el mismo que usa middleware.js (verifica la cookie docs_session)
//   KV_REST_API_URL, KV_REST_API_TOKEN               Upstash Redis (los crea la integración de Vercel)
//   o UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
import { readFileSync } from "node:fs";
import { crearHandler } from "../lib/comentarios-core.mjs";

let handler;
function obtener() {
  if (!handler) {
    const proyectos = JSON.parse(readFileSync(new URL("../projects.json", import.meta.url), "utf8"));
    handler = crearHandler({ env: process.env, proyectos });
  }
  return handler;
}

const delegar = (request) => obtener()(request);
export const GET = delegar;
export const POST = delegar;
export const PATCH = delegar;
export const DELETE = delegar;
