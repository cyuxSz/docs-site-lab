#!/usr/bin/env node
// Valida proyecto, sha y remitente antes de construir en deploy-cloudflare.yml. Sin dependencias.
// CLI: node tools/proyecto-valido.mjs <proyecto> <sha> <remitente>  (sha puede ser ""). Sale con 0 si es válido, con 1 si no.
// Los mensajes de error nunca repiten la entrada (evita inyectar comandos de workflow en el log).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function esProyectoValido(id, proyectos) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id) && Array.isArray(proyectos) && proyectos.some((p) => p && p.id === id);
}

export function esShaValido(sha) {
  return typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha);
}

export function puedeDisparar(login, id, proyectos) {
  if (typeof login !== "string" || !login || !esProyectoValido(id, proyectos)) return false;
  const p = proyectos.find((x) => x.id === id);
  if (!Array.isArray(p.editoresDocs)) return false;
  const l = login.toLowerCase();
  return p.editoresDocs.some((e) => typeof e === "string" && e.toLowerCase() === l);
}

export function validarDisparo({ proyecto, sha, remitente } = {}, proyectos) {
  if (!esProyectoValido(proyecto, proyectos)) return { ok: false, error: "El proyecto no es válido o no existe en projects.json." };
  if (sha !== undefined && sha !== null && sha !== "" && !esShaValido(sha)) return { ok: false, error: "El sha no es válido (40 hex en minúsculas)." };
  if (!puedeDisparar(remitente, proyecto, proyectos)) return { ok: false, error: "El remitente no está autorizado para disparar este proyecto (editoresDocs)." };
  return { ok: true };
}

function cli() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error("Uso: node tools/proyecto-valido.mjs <proyecto> <sha> <remitente> (el sha puede ser \"\").");
    return 1;
  }
  let proyectos;
  try {
    proyectos = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "projects.json"), "utf8"));
  } catch {
    console.error("No se pudo leer projects.json.");
    return 1;
  }
  const r = validarDisparo({ proyecto: args[0], sha: args[1], remitente: args[2] }, proyectos);
  if (!r.ok) console.error(r.error);
  return r.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(cli());
