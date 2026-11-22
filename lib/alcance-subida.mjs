// Lista blanca del token de subida (`vts_…`, tipo `subida`): lo único que ese token puede pedir.
// Función pura: no lee la petición, D1 ni el reloj. La usa la puerta de manejarLogin (lib/login-core.mjs).
//
// - La clave es «MÉTODO ruta», con la ruta ya normalizada por manejarLogin (sin barra final). Se compara por igualdad:
//   otra capitalización, `%2F`, `//` o un segmento de más no coinciden.
// - `null` = la ruta no lee la query: vale cualquiera.
// - Una lista de conjuntos = las claves de la query tienen que ser exactamente uno de ellos, cada clave una sola vez.
//   Los valores los valida la ruta, igual que con cualquier otra credencial.
// - Lo que no está aquí no pasa. Una ruta nueva queda cerrada hasta que alguien la añada a propósito.
export const CODIGO_ALCANCE = "alcance";
export const ERROR_ALCANCE = "Este token no permite esta operación";

const LISTA = new Map([
  ["GET /auth/me", null],
  ["POST /auth/app/revocar", null],
  ["GET /api/archivos", [["capacidades"], ["lista", "proyecto"], ["lista", "proyecto", "disciplina"], ["proyecto", "id"]]],
  ["POST /api/archivos", [["proyecto", "disciplina", "id", "nombre"]]],
  ["GET /api/hardware", [["proyecto", "disciplina"], ["proyecto", "disciplina", "pagina"]]],
]);

// `metodo` tal cual llega (GET no es HEAD), `ruta` normalizada, `params` el URLSearchParams de la petición.
export function permitidaConSubida(metodo, ruta, params) {
  if (typeof metodo !== "string" || typeof ruta !== "string") return false;
  const conjuntos = LISTA.get(`${metodo} ${ruta}`);
  if (conjuntos === undefined) return false;
  if (conjuntos === null) return true;
  if (!(params instanceof URLSearchParams)) return false;
  const claves = [...params.keys()];
  return conjuntos.some((c) => claves.length === c.length && c.every((k) => claves.filter((x) => x === k).length === 1));
}
