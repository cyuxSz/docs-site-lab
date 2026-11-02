// Vercel Function: /api/archivos/ (GET, POST, DELETE). Delega en lib/archivos-core.mjs.
// Variables de entorno:
//   SESSION_SECRET                                   el mismo que usa middleware.js
//   KV_REST_API_URL, KV_REST_API_TOKEN               Upstash Redis (metadatos de los archivos)
//   BLOB_READ_WRITE_TOKEN                            lo crea Vercel al conectar un Blob store PRIVADO
// El cliente de @vercel/blob (handleUpload de @vercel/blob/client, get y del de @vercel/blob) se carga con import
// dinámico dentro de lib/archivos-core.mjs solo si hay token.
import proyectos from "../projects.json" with { type: "json" };
import { crearHandler } from "../lib/archivos-core.mjs";

let handler;
const obtener = () => (handler ??= crearHandler({ env: process.env, proyectos }));

const delegar = (request) => obtener()(request);
export const GET = delegar;
export const POST = delegar;
export const DELETE = delegar;
