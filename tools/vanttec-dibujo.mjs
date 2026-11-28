#!/usr/bin/env node
// CLI vanttec-dibujo: entrar, salir, estado y subir un adjunto (.drawio, .svg, .kicad_sch, .kicad_pcb).
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { statSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PORTAL_POR_DEFECTO, rutaToken, tokenValido, validarPortal } from "./dibujo/config.mjs";
import { leerToken, guardarToken, borrarToken, existeArchivo } from "./dibujo/almacen.mjs";
import { ErrorCli, pedir, mensajeHttp } from "./dibujo/api.mjs";
import { sanearNombre, extension, TIPOS } from "../lib/archivos-nombre.mjs";
import { tipoPorContenido, TIPOS_SUBIDA } from "../lib/contenido-subida.mjs";
import { limpiarTexto } from "./dibujo/texto.mjs";
import { cargarReglas, SLUG, UUID_MIN } from "./dibujo/diagrama.mjs";

const VAR_TOKEN = "VANTTEC_DIBUJO_TOKEN";
const USO_SUBIR = "subir <archivo> --proyecto <proyecto> --disciplina <disciplina> [--pagina <slug> [--svg <archivo.svg>] [--reemplazar <uuid>]] [--portal <url>]";

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
  --pagina <slug>   Sube un .drawio con su .svg y lo pone en esa página (acción diagrama); sin esta opción es un adjunto suelto
  --svg <archivo>   SVG del diagrama (con --pagina). Sin --svg se busca <base>.svg junto al .drawio
  --reemplazar <uuid>  UUID (minúsculas) de la fuente del bloque que se cambia (con --pagina); sin él se añade al final

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
  out(`Sesión iniciada como ${limpiarTexto(r.json.login)} en ${portal}`);
}

async function estado(args) {
  const { opciones, posicionales } = parsear(args, ["--portal"]);
  if (posicionales.length) throw new ErrorCli("`estado` no recibe argumentos.");
  const s = exigirSesion(opciones);
  const r = await pedir(s.portal, "/auth/me", { token: s.token });
  if (r.status !== 200) throw new ErrorCli(mensajeHttp(r));
  if (typeof r.json?.login !== "string") throw new ErrorCli("Respuesta inesperada del portal: no devolvió el login.");
  out(`Sesión: ${limpiarTexto(r.json.login)}`);
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
  else out(!objetivos.length ? "Sesión cerrada." : hayArchivo ? "Sesión cerrada: token revocado y archivo borrado." : "Sesión cerrada: token revocado.");
}

// Valida y lee un archivo local: tipo por extensión, tamaño y contenido. Todo antes de cualquier petición.
function cargarArchivo(ruta, { permitidas, errorTipo }) {
  const nombre = sanearNombre(basename(ruta));
  const ext = extension(nombre);
  if (!ext || !permitidas.includes(ext)) throw new ErrorCli(errorTipo);
  let st;
  try {
    st = statSync(ruta);
  } catch {
    throw new ErrorCli(`El archivo ${nombre} no existe o no se pudo leer.`);
  }
  if (!st.isFile()) throw new ErrorCli(`La ruta de ${nombre} no es un archivo regular.`);
  if (st.size < 1) throw new ErrorCli(`El archivo ${nombre} está vacío.`);
  const tope = TIPOS[ext].max;
  if (st.size > tope) throw new ErrorCli(`El archivo ${nombre} es demasiado grande: el tope para .${ext} es ${Math.floor(tope / 1048576)} MB.`);
  let datos;
  try {
    datos = readFileSync(ruta);
  } catch {
    throw new ErrorCli(`El archivo ${nombre} no existe o no se pudo leer.`);
  }
  if (datos.length < 1 || datos.length > tope) throw new ErrorCli(`El archivo ${nombre} cambió mientras se leía.`);
  if (tipoPorContenido(datos) !== ext) throw new ErrorCli(`El contenido de ${nombre} no corresponde al tipo .${ext}.`);
  return { nombre, ext, datos };
}

function subirAdjunto(s, opciones, id, { nombre, datos }) {
  return pedir(s.portal, "/api/archivos", {
    metodo: "POST",
    token: s.token,
    query: { proyecto: opciones["--proyecto"], disciplina: opciones["--disciplina"], id, nombre },
    cuerpo: datos,
    cabeceras: { "content-type": "application/octet-stream" },
  });
}

async function subirSuelto(opciones, ruta) {
  const f = cargarArchivo(ruta, { permitidas: TIPOS_SUBIDA, errorTipo: `Tipo de archivo no permitido. Tipos admitidos: ${TIPOS_SUBIDA.join(", ")}.` });
  const s = exigirSesion(opciones);
  const r = await subirAdjunto(s, opciones, randomUUID(), f);
  if (r.status !== 201) throw new ErrorCli(mensajeHttp(r));
  out(`Subido: ${typeof r.json?.nombre === "string" ? limpiarTexto(r.json.nombre) : f.nombre}`);
  out(`id: ${typeof r.json?.id === "string" ? limpiarTexto(r.json.id) : ""}`);
}

async function leerPagina(s, opciones, slug) {
  const r = await pedir(s.portal, "/api/hardware", {
    token: s.token,
    query: { proyecto: opciones["--proyecto"], disciplina: opciones["--disciplina"], pagina: slug },
  });
  if (r.status === 404) throw new ErrorCli(`La página ${slug} no existe (o el proyecto o la disciplina).`);
  if (r.status !== 200) throw new ErrorCli(mensajeHttp(r, "hardware"));
  const p = r.json?.pagina;
  if (typeof p?.md !== "string" || !Number.isInteger(p?.version) || p.version < 1) throw new ErrorCli("Respuesta inesperada del portal al leer la página.");
  return { md: p.md, version: p.version };
}

const MAX_REINTENTOS = 2;

async function subirDiagrama(opciones, ruta) {
  const slug = opciones["--pagina"];
  if (!SLUG.test(slug)) throw new ErrorCli("--pagina no es válido: la página usa minúsculas, números y guiones (máximo 60 caracteres).");
  const reemplazar = opciones["--reemplazar"] ?? null;
  if (reemplazar !== null && !UUID_MIN.test(reemplazar)) throw new ErrorCli("--reemplazar tiene que ser un UUID en minúsculas (el de la fuente del bloque).");
  const drawio = cargarArchivo(ruta, { permitidas: ["drawio"], errorTipo: "Con --pagina el archivo principal tiene que ser un .drawio." });
  let rutaSvg = opciones["--svg"];
  if (rutaSvg === undefined) {
    rutaSvg = join(dirname(ruta), basename(ruta).replace(/\.[^.]*$/, "") + ".svg");
    let existe = false;
    try {
      existe = statSync(rutaSvg).isFile();
    } catch { /* no existe */ }
    if (!existe) {
      throw new ErrorCli(`No hay SVG junto al .drawio (se buscó ${basename(rutaSvg)}). Indica uno con --svg <archivo.svg>; exportarlo con draw.io Desktop llegará más adelante.`);
    }
  }
  const svg = cargarArchivo(rutaSvg, { permitidas: ["svg"], errorTipo: "--svg tiene que ser un archivo .svg." });
  const s = exigirSesion(opciones);
  const reglas = await cargarReglas();

  let pagina;
  try {
    pagina = await leerPagina(s, opciones, slug);
  } catch (e) {
    if (e instanceof ErrorCli && !e.uso) throw new ErrorCli(`${e.message} No se subió nada.`);
    throw e;
  }
  if (reemplazar && !reglas.bloqueCambiable(pagina.md, reemplazar)) {
    throw new ErrorCli("La página no tiene un único bloque de diagrama de draw.io con esa fuente (falta, está repetido, es de otro editor o está dentro de una cita); no se puede reemplazar. No se subió nada.");
  }

  const idFuente = randomUUID();
  const idSvg = randomUUID();
  const rf = await subirAdjunto(s, opciones, idFuente, drawio);
  if (rf.status !== 201) throw new ErrorCli(mensajeHttp(rf));
  let rs;
  try {
    rs = await subirAdjunto(s, opciones, idSvg, svg);
  } catch (e) {
    throw new ErrorCli(`${e.message} No se aplicó nada; la fuente ya quedó subida con id ${idFuente}.`);
  }
  if (rs.status !== 201) throw new ErrorCli(`${mensajeHttp(rs)} No se aplicó nada; la fuente ya quedó subida con id ${idFuente}.`);
  const ids = `Adjuntos subidos, quedaron sueltos: fuente ${idFuente}, svg ${idSvg}.`;
  const fallo = (m) => new ErrorCli(`${m} ${ids}`);
  const cuerpo = (version) =>
    JSON.stringify({ proyecto: opciones["--proyecto"], disciplina: opciones["--disciplina"], accion: "diagrama", pagina: slug, version, fuenteAnterior: reemplazar, fuente: idFuente, svg: idSvg });

  for (let intento = 0; ; intento++) {
    let r;
    try {
      r = await pedir(s.portal, "/api/hardware", { metodo: "POST", token: s.token, cuerpo: cuerpo(pagina.version), cabeceras: { "content-type": "application/json" } });
    } catch {
      throw fallo("Se perdió la conexión al aplicar el cambio: no se sabe si se aplicó. Revisa la página antes de reintentar.");
    }
    if (r.status === 200) {
      const v = Number.isInteger(r.json?.pagina?.version) ? r.json.pagina.version : "desconocida";
      out(`Diagrama aplicado en la página ${slug}, versión ${v}.`);
      out(`fuente: ${idFuente}`);
      out(`svg: ${idSvg}`);
      return;
    }
    if (!(r.status === 409 && r.json?.codigo === "version")) throw fallo(mensajeHttp(r, "hardware"));
    if (intento >= MAX_REINTENTOS) throw fallo("La página cambió varias veces mientras se aplicaba y se agotaron los reintentos.");
    try {
      pagina = await leerPagina(s, opciones, slug);
    } catch (e) {
      throw fallo(`La página cambió y no se pudo releer (${e.message.replace(/\.$/, "")}).`);
    }
    if (!reglas.puedeReintentar(pagina.md, { fuenteAnterior: reemplazar, fuente: idFuente, svg: idSvg })) {
      throw fallo("La página cambió y ya no es seguro reintentar solo (el bloque cambió o ya cita estos adjuntos). Enlázalos a mano o reintenta.");
    }
  }
}

async function subir(args) {
  const { opciones, posicionales } = parsear(args, ["--portal", "--proyecto", "--disciplina", "--pagina", "--svg", "--reemplazar"], USO_SUBIR);
  if (posicionales.length !== 1 || !opciones["--proyecto"] || !opciones["--disciplina"]) {
    throw new ErrorCli("Faltan argumentos.", { uso: USO_SUBIR });
  }
  if (!("--pagina" in opciones)) {
    for (const o of ["--svg", "--reemplazar"]) if (o in opciones) throw new ErrorCli(`${o} solo se usa junto con --pagina.`, { uso: USO_SUBIR });
    return subirSuelto(opciones, posicionales[0]);
  }
  return subirDiagrama(opciones, posicionales[0]);
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
