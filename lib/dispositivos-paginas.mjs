// Página /auth/dispositivos: HTML de la lista y de la sección «Tokens de subida», tokens anti-CSRF de sus formularios
// (revocar y crear), página «Token creado» y lectura acotada del formulario. La pinta el Worker con el ayudante page()
// de login-core.mjs; no lleva JavaScript.
// - Nombre y plataforma salen de D1 y los eligió el cliente: todo pasa por esc() y la plataforma se pinta con una
//   etiqueta de una tabla fija, nunca con su valor crudo.
// - Aquí no entra ningún hash, y el único token en claro es el argumento de htmlTokenCreado, que solo lo escribe en
//   el HTML que devuelve: no se guarda en ninguna variable de módulo ni se registra. Las listas solo llevan el id público.
// Sin imports de node:* ni paquetes: corre en workerd (Buffer sí, por nodejs_compat).

export const RUTA_PAGINA = "/auth/dispositivos";
export const RUTA_REVOCAR = "/auth/dispositivos/revocar";
export const RUTA_TOKEN = "/auth/dispositivos/token";
export const RE_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const TEXTO_VACIO = "Ningún dispositivo tiene acceso. Se añaden al iniciar sesión desde la app.";
export const TEXTO_TOPE = "Tienes 5 tokens de subida, el máximo. Revoca uno para crear otro.";
// «Para crear un token, inicia sesión de nuevo.», con el enlace al login de vuelta a esta página. HTML fijo.
export const HTML_LOGIN_DE_NUEVO = `Para crear un token, <a href="/auth/login?next=${encodeURIComponent(RUTA_PAGINA)}">inicia sesión de nuevo</a>.`;

const MAX_NOMBRE = 60;
// Etiqueta visible de cada plataforma: tabla fija, la usa también el consentimiento de la app (lib/app-paginas.mjs).
export const ETIQUETAS = new Map([
  ["windows", "Windows"],
  ["macos", "macOS"],
  ["linux", "Linux"],
  ["android", "Android"],
  ["ios", "iOS"],
  // Solo la escribe la emisión de tokens de subida; no está en PLATAFORMAS: la app no puede declararse así.
  ["cli", "Línea de comandos"],
]);
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const enc = new TextEncoder();

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------- Anti-CSRF sin estado ----------

// base64url(HMAC-SHA256(SESSION_SECRET, "csrf:v1:dispositivos:" + valor de la cookie de sesión)). Va ligado a la sesión
// (no solo al login) y a este formulario: el prefijo de propósito impide reutilizarlo en otro.
const PROPOSITO = "csrf:v1:dispositivos:";

// base64url(HMAC-SHA256(secreto, mensaje)). Quien llama pone el prefijo de propósito al principio del mensaje.
export async function hmacB64url(secreto, mensaje) {
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Buffer.from(await crypto.subtle.sign("HMAC", clave, enc.encode(mensaje))).toString("base64url");
}

export const tokenCsrf = (secreto, valorCookie) => hmacB64url(secreto, PROPOSITO + valorCookie);

// Comparación en tiempo constante (el largo del token es fijo y público).
export function igualConstante(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function csrfValido(secreto, valorCookie, recibido) {
  if (typeof valorCookie !== "string" || !valorCookie || typeof recibido !== "string" || !recibido) return false;
  return igualConstante(await tokenCsrf(secreto, valorCookie), recibido);
}

// Anti-CSRF del formulario «Crear token»: base64url(HMAC-SHA256(SESSION_SECRET, "csrf:v1:token-subida:" +
// JSON([valor de la cookie, id del formulario]))). Prefijo de propósito propio: no vale el de «Revocar» ni al revés.
// Va ligado a la sesión y al id que el servidor generó al pintar la página, que será el id público de la fila.
const PROPOSITO_TOKEN = "csrf:v1:token-subida:";

export const csrfToken = (secreto, valorCookie, id) => hmacB64url(secreto, PROPOSITO_TOKEN + JSON.stringify([valorCookie, id]));

// `id` es el valor recibido tal cual: si falta, está mal formado o no es el que se pintó, el token no casa.
export async function csrfTokenValido(secreto, valorCookie, id, recibido) {
  if (typeof valorCookie !== "string" || !valorCookie || typeof recibido !== "string" || !recibido) return false;
  if (typeof id !== "string" || !RE_ID.test(id)) return false;
  return igualConstante(await csrfToken(secreto, valorCookie, id), recibido);
}

// ---------- Formulario ----------

// Lee un cuerpo application/x-www-form-urlencoded de `max` bytes como mucho (el límite se aplica mientras se lee el
// stream, también sin Content-Length). Devuelve URLSearchParams, o null si se pasa del límite.
export async function leerFormulario(request, max) {
  if (Number(request.headers.get("content-length")) > max) return null;
  const trozos = [];
  let total = 0;
  if (request.body) {
    const lector = request.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel().catch(() => {});
        return null;
      }
      trozos.push(value);
    }
  }
  return new URLSearchParams(Buffer.concat(trozos).toString("utf8"));
}

// ---------- HTML ----------

// Estilos de la lista, añadidos a los de page(): columna de 420 px, filas a la izquierda separadas por una línea
// fina, botón de contorno a la derecha (debajo del texto en pantallas estrechas).
export const ESTILOS =
  "main{box-sizing:border-box;width:100%;max-width:468px}" +
  "ul{list-style:none;margin:24px 0;padding:0;text-align:left}" +
  "li{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid rgba(238,243,251,.18)}" +
  "li:first-child{border-top:0}" +
  ".d{min-width:0;overflow-wrap:anywhere}" +
  ".d strong{display:block;font-weight:600}" +
  ".d span{display:block;font-size:14px;color:#b9c6dc}" +
  "form{margin:0;flex:none}" +
  "button{font:inherit;min-height:44px;padding:8px 16px;border:1px solid #49c1d2;border-radius:8px;background:transparent;color:#eef3fb;cursor:pointer}" +
  "button:hover{background:rgba(73,193,210,.16)}" +
  "button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #49c1d2;outline-offset:2px}" +
  // Sección «Tokens de subida» y página «Token creado»: subtítulo, texto secundario, etiqueta sobre el campo y
  // controles de texto con borde fino. El token (monoespaciado) se parte en vez de desbordar.
  "section{margin:32px 0 24px;text-align:left}" +
  "h2{font-size:18px;line-height:1.3;margin:0 0 4px}" +
  ".s{font-size:14px;color:#b9c6dc}" +
  "section .s{margin:0}" +
  "section ul{margin:12px 0 0}" +
  ".n{margin:20px 0 0}" +
  "label{display:block;margin-bottom:6px;text-align:left;overflow-wrap:anywhere}" +
  ".d time{white-space:nowrap}" +
  "input[type=text],textarea{display:block;box-sizing:border-box;width:100%;font:inherit;min-height:44px;padding:9px 12px;border:1px solid rgba(238,243,251,.45);border-radius:8px;background:transparent;color:#eef3fb}" +
  "textarea{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;resize:none}" +
  ".n button{margin-top:12px}" +
  "@media (max-width:480px){li{flex-direction:column;align-items:flex-start;gap:10px}}";

// «21 nov 2026» en UTC, o null si el valor de D1 no es una fecha.
function fechaTexto(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return null;
  const f = new Date(Number(ms));
  if (Number.isNaN(f.getTime())) return null;
  return `${f.getUTCDate()} ${MESES[f.getUTCMonth()]} ${f.getUTCFullYear()}`;
}

// La misma fecha dentro de <time datetime="ISO">, o null.
function fecha(ms) {
  const t = fechaTexto(ms);
  return t === null ? null : `<time datetime="${esc(new Date(Number(ms)).toISOString())}">${t}</time>`;
}

const nombreVisible = (v) => esc([...String(v ?? "")].slice(0, MAX_NOMBRE).join(""));
const oculto = (nombre, valor) => `<input type="hidden" name="${nombre}" value="${esc(valor)}">`;
// `etiqueta` llega ya escapada.
const formRevocar = (id, csrf, etiqueta) =>
  `<form method="post" action="${RUTA_REVOCAR}">${oculto("id", id)}${oculto("csrf", csrf)}<button type="submit" aria-label="${etiqueta}">Revocar</button></form>`;

function fila(d, csrf) {
  const nombre = nombreVisible(d.nombre);
  const plataforma = ETIQUETAS.get(d.plataforma) ?? "Otro";
  const uso = fecha(d.ultimoUso);
  return (
    `<li><div class="d"><strong>${nombre}</strong><span>${plataforma} · ${uso ? `Último uso: ${uso}` : "Sin usar todavía"}</span></div>` +
    `${formRevocar(d.id, csrf, `Revocar «${nombre}»`)}</li>`
  );
}

// Fila de un token de subida: mismo marcado que un dispositivo. No pinta la plataforma (lo dice el título de la
// sección) y añade cuándo se creó y cuándo caduca.
function filaToken(t, csrf) {
  const nombre = nombreVisible(t.nombre);
  const creado = fecha(t.creado);
  const uso = fecha(t.ultimoUso);
  const caduca = fecha(t.expira);
  const datos = [creado ? `Creado: ${creado}` : null, uso ? `Último uso: ${uso}` : "Sin usar todavía", caduca ? `Caduca: ${caduca}` : null].filter(Boolean).join(" · ");
  return `<li><div class="d"><strong>${nombre}</strong><span>${datos}</span></div>${formRevocar(t.id, csrf, `Revocar el token «${nombre}»`)}</li>`;
}

// Sección «Tokens de subida». `tokens` es la salida de listarTokensSubida y `csrf` el anti-CSRF de «Revocar».
// `crear` decide qué va bajo la lista:
//   { id, csrf }  el formulario «Crear token» (id nuevo generado por el servidor y su anti-CSRF propio)
//   "tope"        el aviso del tope
//   "login"       el enlace al login (sesión antigua)
//   null          nada (quien dejó de ser editor y conserva tokens)
function htmlSeccion(tokens, csrf, crear) {
  const lista = tokens.length ? `<ul>${tokens.map((t) => filaToken(t, csrf)).join("")}</ul>` : "";
  let pie = "";
  if (crear === "tope") pie = `<p class="n">${TEXTO_TOPE}</p>`;
  else if (crear === "login") pie = `<p class="n">${HTML_LOGIN_DE_NUEVO}</p>`;
  else if (crear && typeof crear === "object") {
    pie =
      `<form class="n" method="post" action="${RUTA_TOKEN}"><label for="nt">Nombre</label>` +
      `<div class="s" id="nt-ayuda">Para reconocer el token en esta lista; p. ej., el equipo o el script que lo usa.</div>` +
      `<input id="nt" name="nombre" type="text" required maxlength="${MAX_NOMBRE}" autocomplete="off" aria-describedby="nt-ayuda">` +
      `${oculto("id", crear.id)}${oculto("csrf", crear.csrf)}<button type="submit">Crear token</button></form>`;
  }
  return (
    `<section aria-labelledby="ts"><h2 id="ts">Tokens de subida</h2>` +
    `<p class="s">Para subir archivos de hardware desde la línea de comandos. Duran 30 días.</p>${lista}${pie}</section>`
  );
}

// Cuerpo de la página (va dentro de page(), bajo el <h1>). `dispositivos` es la salida de listarDispositivos.
// `subida` es null (la sección no aparece) o { tokens, crear } (ver htmlSeccion).
export function htmlDispositivos(dispositivos, csrf, subida = null) {
  const lista = dispositivos.length ? `<ul>${dispositivos.map((d) => fila(d, csrf)).join("")}</ul>` : `<p>${TEXTO_VACIO}</p>`;
  return `${lista}${subida ? htmlSeccion(subida.tokens, csrf, subida.crear) : ""}<p><a href="/">Volver al portal</a></p>`;
}

// Cuerpo de «Token creado» (respuesta 200 de POST /auth/dispositivos/token): único sitio donde el token va en claro.
// Sin formulario, sin botón y sin JavaScript: un <textarea readonly> con etiqueta, sin espacios alrededor del token.
export function htmlTokenCreado({ nombre, token, expira }) {
  const caduca = fechaTexto(expira);
  return (
    `<p>Cópialo ahora. No se volverá a mostrar.</p>` +
    `<label for="tk">Token de «${nombreVisible(nombre)}»</label>` +
    `<textarea id="tk" readonly rows="2" autocomplete="off" spellcheck="false">${esc(token)}</textarea>` +
    (caduca ? `<p class="s">Caduca el ${caduca}.</p>` : "") +
    `<p><a href="${RUTA_PAGINA}">Volver a Dispositivos</a></p>`
  );
}
