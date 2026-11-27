#!/usr/bin/env node
// CLI vanttec-dibujo: entrar, salir, estado y subir un adjunto (.drawio, .svg, .kicad_sch, .kicad_pcb).
import { homedir } from "node:os";
import { basename } from "node:path";
import { statSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PORTAL_POR_DEFECTO, rutaToken, tokenValido, validarPortal } from "./dibujo/config.mjs";
import { leerToken, guardarToken, borrarToken, existeArchivo } from "./dibujo/almacen.mjs";
import { ErrorCli, pedir, mensajeHttp } from "./dibujo/api.mjs";
import { sanearNombre, extension, TIPOS } from "../lib/archivos-nombre.mjs";

const TIPOS_SUBIDA = ["drawio", "svg", "kicad_sch", "kicad_pcb"];
const VAR_TOKEN = "VANTTEC_DIBUJO_TOKEN";
const USO_SUBIR = "subir <archivo> --proyecto <proyecto> --disciplina <disciplina> [--portal <url>]";

const AYUDA = `vanttec-dibujo: sube diagramas y esquemas al portal de documentación.

Uso:
  node tools/vanttec-dibujo.mjs entrar [--portal <url>]   Guarda el token de subida (vts_) leído de stdin o de un prompt sin eco
  node tools/vanttec-dibujo.mjs salir [--portal <url>]    Revoca el token y borra el archivo local
  node tools/vanttec-dibujo.mjs estado [--portal <url>]   Muestra la sesión actual
  node tools/vanttec-dibujo.mjs ${USO_SUBIR}
                                                          Tipos admitidos: ${TIPOS_SUBIDA.join(", ")}
  node tools/vanttec-dibujo.mjs ayuda | --help | -h

Opciones:
  --portal <url>    Portal (por defecto ${PORTAL_POR_DEFECTO}; también VANTTEC_DIBUJO_PORTAL). Solo https, salvo localhost.
  --proyecto <p>    Proyecto de destino (subir)
  --disciplina <d>  Disciplina de destino (subir)

Token:
  Emite un token de subida (vts_) en <portal>/auth/dispositivos. Nunca se pasa como argumento:
  entrar lo lee de stdin o lo pide sin eco. Para usarlo sin guardarlo, define ${VAR_TOKEN}.`;

// ---------- salida (con redacción de cualquier token conocido) ----------
const secretos = new Set();
function recordar(token) {
  if (typeof token === "string" && token.length > 4) secretos.add(token).add(token.slice(4));
}
function limpio(texto) {
  let s = String(texto);
  for (const t of secretos) s = s.split(t).join("[oculto]");
  return s.replace(/vt[ds]_[A-Za-z0-9_-]{10,}/g, "[oculto]");
}
const out = (t) => process.stdout.write(limpio(t) + "\n");
const err = (t) => process.stderr.write(limpio(t) + "\n");

// ---------- argumentos ----------
function revisarArgv(args) {
  for (const a of args) {
    if (a === "--token" || a.startsWith("--token=") || /vt[ds]_[A-Za-z0-9_-]{8,}/.test(a)) {
      throw new ErrorCli("El token no se pasa como argumento (queda en el historial y en la lista de procesos). Usa `entrar`, que lo lee de stdin o lo pide sin eco.");
    }
  }
}

function parsear(args, conocidas, uso) {
  const opciones = {};
  const posicionales = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      if (!conocidas.includes(a)) throw new ErrorCli(`Opción desconocida: ${a.slice(0, 30)}.`, { uso });
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new ErrorCli(`La opción ${a} necesita un valor.`, { uso });
      if (a in opciones) throw new ErrorCli(`La opción ${a} está repetida.`, { uso });
      opciones[a] = v;
      i++;
    } else posicionales.push(a);
  }
  return { opciones, posicionales };
}

function portalSolicitado(opciones) {
  const texto = opciones["--portal"] ?? (process.env.VANTTEC_DIBUJO_PORTAL || undefined);
  if (texto === undefined) return null;
  try {
    return validarPortal(texto);
  } catch (e) {
    throw new ErrorCli(e.message);
  }
}

// ---------- token ----------
const RUTA = () => rutaToken({ plataforma: process.platform, env: process.env, home: homedir() });

// Devuelve {token, portal, origen} o null si no hay sesión.
function resolverSesion(opciones) {
  const solicitado = portalSolicitado(opciones);
  const deVar = process.env[VAR_TOKEN];
  if (deVar) {
    if (!tokenValido(deVar)) {
      throw new ErrorCli(`${VAR_TOKEN} no tiene un formato válido: hace falta un token de subida que empiece por vts_ (se emite en /auth/dispositivos).`);
    }
    recordar(deVar);
    return { token: deVar, portal: solicitado ?? PORTAL_POR_DEFECTO, origen: `variable ${VAR_TOKEN}` };
  }
  const ruta = RUTA();
  const g = leerToken(ruta);
  if (!g) return null;
  recordar(g.token);
  let guardado;
  try {
    guardado = validarPortal(g.portal);
  } catch {
    throw new ErrorCli("El portal guardado en el archivo del token no es válido. Ejecuta `salir` y vuelve a `entrar`.");
  }
  if (solicitado && solicitado !== guardado) {
    throw new ErrorCli(`El token guardado pertenece a otro portal (${guardado}) y no se envía a ${solicitado}. Ejecuta \`salir\` y vuelve a \`entrar\` con ese portal.`);
  }
  return { token: g.token, portal: guardado, origen: `archivo ${ruta}` };
}

function exigirSesion(opciones) {
  const s = resolverSesion(opciones);
  if (!s) throw new ErrorCli("Sin sesión. Ejecuta `entrar` para guardar un token de subida.");
  return s;
}

function validarFormato(token) {
  if (tokenValido(token)) return;
  if (typeof token === "string" && token.startsWith("vtd_")) {
    throw new ErrorCli("Ese es un token de dispositivo (vtd_), de alcance completo, y no se acepta. Hace falta un token de subida (vts_) emitido en /auth/dispositivos.");
  }
  throw new ErrorCli("Token no válido: debe ser un token de subida que empiece por vts_ (se emite en /auth/dispositivos).");
}

// ---------- entrada del token ----------
function leerStdin() {
  return new Promise((ok) => {
    let buf = "";
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      process.stdin.removeAllListeners("data");
      process.stdin.pause();
      ok(buf.split(/\r?\n/, 1)[0].trim());
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => {
      buf += d;
      if (buf.includes("\n") || buf.length > 4096) fin();
    });
    process.stdin.on("end", fin);
    process.stdin.on("error", fin);
  });
}

function pedirSinEco() {
  return new Promise((ok, mal) => {
    process.stderr.write("Token de subida (vts_…, no se muestra): ");
    let buf = "";
    const stdin = process.stdin;
    const terminar = (fn) => {
      stdin.setRawMode(false);
      stdin.removeListener("data", alDato);
      stdin.pause();
      process.stderr.write("\n");
      fn();
    };
    const alDato = (d) => {
      for (const c of d.toString("utf8")) {
        if (c === "\x03" || c === "\x04") return terminar(() => mal(new ErrorCli("Cancelado.")));
        if (c === "\r" || c === "\n") return terminar(() => ok(buf.trim()));
        if (c === "\x7f" || c === "\b") buf = buf.slice(0, -1);
        else if (c >= " ") buf += c;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", alDato);
  });
}

// ---------- comandos ----------
async function entrar(args) {
  const { opciones, posicionales } = parsear(args, ["--portal"]);
  if (posicionales.length) throw new ErrorCli("`entrar` no recibe argumentos; el token se lee de stdin.");
  const portal = portalSolicitado(opciones) ?? PORTAL_POR_DEFECTO;
  const token = process.stdin.isTTY ? await pedirSinEco() : await leerStdin();
  recordar(token);
  validarFormato(token);
  const r = await pedir(portal, "/auth/me", { token });
  if (r.status !== 200) throw new ErrorCli(mensajeHttp(r));
  if (typeof r.json?.login !== "string" || !r.json.login) throw new ErrorCli("Respuesta inesperada del portal: no devolvió el login.");
  guardarToken(RUTA(), { portal, token });
  out(`Sesión iniciada como ${r.json.login} en ${portal}`);
}

async function estado(args) {
  const { opciones, posicionales } = parsear(args, ["--portal"]);
  if (posicionales.length) throw new ErrorCli("`estado` no recibe argumentos.");
  const s = exigirSesion(opciones);
  const r = await pedir(s.portal, "/auth/me", { token: s.token });
  if (r.status !== 200) throw new ErrorCli(mensajeHttp(r));
  if (typeof r.json?.login !== "string") throw new ErrorCli("Respuesta inesperada del portal: no devolvió el login.");
  out(`Sesión: ${r.json.login}`);
  out(`Portal: ${s.portal}`);
  out(`Token: ${s.origen}`);
  out(`Caducidad: no disponible desde la CLI; consúltala en ${s.portal}/auth/dispositivos`);
}

async function revocar(portal, token) {
  try {
    const r = await pedir(portal, "/auth/app/revocar", { metodo: "POST", token });
    if (r.status === 200 || r.status === 401) return null;
    return mensajeHttp(r);
  } catch (e) {
    return e instanceof ErrorCli ? e.message : "No se pudo revocar el token.";
  }
}

async function salir(args) {
  const { opciones, posicionales } = parsear(args, ["--portal"]);
  if (posicionales.length) throw new ErrorCli("`salir` no recibe argumentos.");
  const ruta = RUTA();
  const hayArchivo = existeArchivo(ruta);
  const g = hayArchivo ? leerToken(ruta) : null;
  let solicitado = null;
  const problemas = [];
  try {
    solicitado = portalSolicitado(opciones);
  } catch (e) {
    problemas.push(e.message);
  }
  const deVar = process.env[VAR_TOKEN] || null;
  const objetivos = [];
  if (g) {
    recordar(g.token);
    try {
      objetivos.push({ portal: validarPortal(g.portal), token: g.token });
    } catch {
      problemas.push("El portal guardado en el archivo no es válido; no se pudo revocar ese token.");
    }
  }
  if (deVar) {
    recordar(deVar);
    if (!tokenValido(deVar)) problemas.push(`${VAR_TOKEN} no tiene formato vts_; no se revocó.`);
    else if (!objetivos.some((o) => o.token === deVar)) objetivos.push({ portal: solicitado ?? PORTAL_POR_DEFECTO, token: deVar });
  }
  if (!hayArchivo && !deVar && !problemas.length) return out("No había sesión.");
  let fallo = problemas.length > 0;
  for (const p of problemas) err(p);
  for (const o of objetivos) {
    const motivo = await revocar(o.portal, o.token);
    if (motivo) {
      fallo = true;
      err(motivo);
      err(`El token sigue vivo hasta que lo revoques en ${o.portal}/auth/dispositivos o caduque.`);
    }
  }
  if (hayArchivo) {
    try {
      borrarToken(ruta);
    } catch {
      err("No se pudo borrar el archivo del token.");
      fallo = true;
    }
  }
  if (deVar) err(`Recuerda quitar la variable ${VAR_TOKEN} de tu entorno.`);
  if (fallo) process.exitCode = 1;
  else out(objetivos.length ? "Sesión cerrada: token revocado y archivo borrado." : "Sesión cerrada.");
}

async function subir(args) {
  const { opciones, posicionales } = parsear(args, ["--portal", "--proyecto", "--disciplina"], USO_SUBIR);
  if (posicionales.length !== 1 || !opciones["--proyecto"] || !opciones["--disciplina"]) {
    throw new ErrorCli("Faltan argumentos.", { uso: USO_SUBIR });
  }
  const ruta = posicionales[0];
  const nombre = sanearNombre(basename(ruta));
  const ext = extension(nombre);
  if (!ext || !TIPOS_SUBIDA.includes(ext)) {
    throw new ErrorCli(`Tipo de archivo no permitido. Tipos admitidos: ${TIPOS_SUBIDA.join(", ")}.`);
  }
  let st;
  try {
    st = statSync(ruta);
  } catch {
    throw new ErrorCli("El archivo no existe o no se pudo leer.");
  }
  if (!st.isFile()) throw new ErrorCli("La ruta no es un archivo regular.");
  if (st.size < 1) throw new ErrorCli("El archivo está vacío.");
  const tope = TIPOS[ext].max;
  if (st.size > tope) throw new ErrorCli(`El archivo es demasiado grande: el tope para .${ext} es ${Math.floor(tope / 1048576)} MB.`);
  const s = exigirSesion(opciones);
  let datos;
  try {
    datos = readFileSync(ruta);
  } catch {
    throw new ErrorCli("El archivo no existe o no se pudo leer.");
  }
  if (datos.length < 1 || datos.length > tope) throw new ErrorCli("El archivo cambió mientras se leía.");
  const r = await pedir(s.portal, "/api/archivos", {
    metodo: "POST",
    token: s.token,
    query: { proyecto: opciones["--proyecto"], disciplina: opciones["--disciplina"], id: randomUUID(), nombre },
    cuerpo: datos,
    cabeceras: { "content-type": "application/octet-stream" },
  });
  if (r.status !== 201) throw new ErrorCli(mensajeHttp(r));
  out(`Subido: ${typeof r.json?.nombre === "string" ? r.json.nombre : nombre}`);
  out(`id: ${typeof r.json?.id === "string" ? r.json.id : ""}`);
}

const COMANDOS = { entrar, salir, estado, subir };

async function main(args) {
  revisarArgv(args);
  const [cmd, ...resto] = args;
  if (cmd === "ayuda" || cmd === "--help" || cmd === "-h") return out(AYUDA);
  if (!cmd || !Object.hasOwn(COMANDOS, cmd)) {
    err(cmd ? `Comando desconocido: ${cmd.slice(0, 30)}\n` : "Falta el comando.\n");
    err(AYUDA);
    process.exitCode = 2;
    return;
  }
  await COMANDOS[cmd](resto);
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  if (e instanceof ErrorCli) {
    err(`Error: ${e.message}`);
    if (e.uso) err(`Uso: node tools/vanttec-dibujo.mjs ${e.uso}`);
  } else {
    err(`Error inesperado${e instanceof Error && /^[\w .,:'-]{1,80}$/.test(e.message) ? `: ${e.message}` : "."}`);
  }
  process.exitCode = process.exitCode || 1;
}
