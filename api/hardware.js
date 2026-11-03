// Vercel Function: /api/hardware/ (GET, POST, PUT, DELETE). Delega en lib/hardware-core.mjs.
// Variables de entorno: las mismas que comentarios (SESSION_SECRET y Upstash Redis).
// projects.json y las plantillas van como import estático para que el bundler de Vercel los incluya en la función.
import proyectos from "../projects.json" with { type: "json" };
import electronica from "../plantillas/electronica.json" with { type: "json" };
import mecanica from "../plantillas/mecanica.json" with { type: "json" };
import { crearHandler } from "../lib/hardware-core.mjs";

let handler;
const obtener = () => (handler ??= crearHandler({ env: process.env, proyectos, plantillas: { electronica, mecanica } }));

const delegar = (request) => obtener()(request);
export const GET = delegar;
export const POST = delegar;
export const PUT = delegar;
export const DELETE = delegar;
