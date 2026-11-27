// Ayudantes de los tests del lote G1 (token de subida, `vts_…`). Amplían los del 1A y del 1B-1 sin tocarlos.
// En G1 no hay ruta que emita tokens de subida (eso es G2): las filas se insertan directamente en D1, con la misma
// forma que escribe `canjear` para los de dispositivo (hash = SHA-256 en hexadecimal del token completo, con prefijo).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { EDITOR, TREINTA_DIAS, sha256hex } from "./tokens-1b.mjs";

export * from "./tokens-1b.mjs";

export const RE_TOKEN_SUBIDA = /^vts_[A-Za-z0-9_-]{43}$/;
export const CODIGO_ALCANCE = "alcance";

// Inserta una fila en `tokens` y devuelve el token en claro. Por omisión, un token de subida bien formado y vivo.
// `prefijo`, `tipo` y `alcance` se pueden descuadrar a propósito para probar que el servidor falla cerrado.
export function insertarToken(env, { login = EDITOR, prefijo = "vts_", tipo = "subida", alcance = "subida", nombre = "CLI de prueba", plataforma = "cli", creado = Date.now(), expira = creado + TREINTA_DIAS } = {}) {
  const token = prefijo + randomBytes(32).toString("base64url");
  const id = randomBytes(16).toString("base64url");
  const hash = sha256hex(token);
  env.DB.sqlite
    .prepare("INSERT INTO tokens (hash, id, login, nombre, plataforma, tipo, alcance, creado, ultimo_uso, expira) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)")
    .run(hash, id, login, nombre, plataforma, tipo, alcance, creado, expira);
  return { token, id, hash };
}

export const tokenSubidaFalso = () => `vts_${randomBytes(32).toString("base64url")}`;

// Fila de un token tal cual está en D1 (sin pasar por el core), o undefined si ya no existe.
export const filaToken = (env, id) => {
  const f = env.DB.sqlite.prepare("SELECT id, login, tipo, alcance, ultimo_uso, expira FROM tokens WHERE id = ?").get(id);
  return f ? { ...f } : undefined;
};
export const cuantosTokens = (env) => Number(env.DB.sqlite.prepare("SELECT count(*) AS n FROM tokens").get().n);

// El 403 de la puerta de alcance: JSON con `codigo: "alcance"`, sin redirección, sin cookies y sin caché.
export async function esDenegada(res, que) {
  assert.equal(res.status, 403, `${que}: debe responder 403`);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/, `${que}: JSON`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${que}: no-store`);
  assert.equal(res.headers.get("location"), null, `${que}: sin redirección`);
  assert.equal(res.headers.get("set-cookie"), null, `${que}: sin cookies`);
  const json = JSON.parse(await res.text());
  assert.equal(json.codigo, CODIGO_ALCANCE, `${que}: el 403 es el de la puerta (codigo "alcance")`);
  assert.equal(typeof json.error, "string", `${que}: con mensaje`);
  return json;
}

// Un 403 que NO es de la puerta: lo pone la ruta al aplicar los permisos del login (canAccess, editores).
export async function esDenegadaPorPermiso(res, que) {
  assert.equal(res.status, 403, `${que}: debe responder 403`);
  const json = JSON.parse(await res.text());
  assert.notEqual(json.codigo, CODIGO_ALCANCE, `${que}: lo niega el permiso del login, no la puerta`);
  return json;
}
