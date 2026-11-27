// Archivo del token: leer, guardar de forma atómica y borrar.
import { mkdirSync, chmodSync, writeFileSync, renameSync, readFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { tokenValido } from "./config.mjs";

// Devuelve {portal, token} o null si no existe o está dañado.
export function leerToken(ruta) {
  let datos;
  try {
    datos = JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
  if (!datos || typeof datos.portal !== "string" || !tokenValido(datos.token)) return null;
  return { portal: datos.portal, token: datos.token };
}

export function existeArchivo(ruta) {
  return existsSync(ruta);
}

export function guardarToken(ruta, { portal, token }) {
  const dir = dirname(ruta);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(dir, 0o700);
  const tmp = join(dir, `.token.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify({ portal, token }), { flag: "wx", mode: 0o600 });
    if (process.platform !== "win32") chmodSync(tmp, 0o600);
    renameSync(tmp, ruta);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* nada */ }
    throw e;
  }
}

export function borrarToken(ruta) {
  rmSync(ruta, { force: true });
}
