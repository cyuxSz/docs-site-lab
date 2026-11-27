// Página /auth/dispositivos: HTML de la lista, token anti-CSRF del formulario de revocación y lectura acotada del
// formulario. La pinta el Worker con el ayudante page() de login-core.mjs; no lleva JavaScript.
// - Nombre y plataforma salen de D1 y los eligió el cliente: todo pasa por esc() y la plataforma se pinta con una
//   etiqueta de una tabla fija, nunca con su valor crudo.
// - Aquí no entra ningún token ni hash: solo el id público de cada dispositivo.
// Sin imports de node:* ni paquetes: corre en workerd (Buffer sí, por nodejs_compat).

export const RUTA_PAGINA = "/auth/dispositivos";
export const RUTA_REVOCAR = "/auth/dispositivos/revocar";
export const RE_ID = /^[A-Za-z0-9_-]{16,64}$/;
export const TEXTO_VACIO = "Ningún dispositivo tiene acceso. Se añaden al iniciar sesión desde la app.";

const MAX_NOMBRE = 60;
// Etiqueta visible de cada plataforma: tabla fija, la usa también el consentimiento de la app (lib/app-paginas.mjs).
export const ETIQUETAS = new Map([
  ["windows", "Windows"],
  ["macos", "macOS"],
  ["linux", "Linux"],
  ["android", "Android"],
  ["ios", "iOS"],
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
  "button:focus-visible,a:focus-visible{outline:2px solid #49c1d2;outline-offset:2px}" +
  "@media (max-width:480px){li{flex-direction:column;align-items:flex-start;gap:10px}}";

// «21 nov 2026» en UTC dentro de <time datetime="ISO">, o null si el valor de D1 no es una fecha.
function ultimoUso(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return null;
  const f = new Date(Number(ms));
  if (Number.isNaN(f.getTime())) return null;
  return `<time datetime="${esc(f.toISOString())}">${f.getUTCDate()} ${MESES[f.getUTCMonth()]} ${f.getUTCFullYear()}</time>`;
}

function fila(d, csrf) {
  const nombre = esc([...String(d.nombre ?? "")].slice(0, MAX_NOMBRE).join(""));
  const plataforma = ETIQUETAS.get(d.plataforma) ?? "Otro";
  const uso = ultimoUso(d.ultimoUso);
  return (
    `<li><div class="d"><strong>${nombre}</strong><span>${plataforma} · ${uso ? `Último uso: ${uso}` : "Sin usar todavía"}</span></div>` +
    `<form method="post" action="${RUTA_REVOCAR}"><input type="hidden" name="id" value="${esc(d.id)}"><input type="hidden" name="csrf" value="${esc(csrf)}">` +
    `<button type="submit" aria-label="Revocar «${nombre}»">Revocar</button></form></li>`
  );
}

// Cuerpo de la página (va dentro de page(), bajo el <h1>). `dispositivos` es la salida de listarDispositivos.
export function htmlDispositivos(dispositivos, csrf) {
  const lista = dispositivos.length ? `<ul>${dispositivos.map((d) => fila(d, csrf)).join("")}</ul>` : `<p>${TEXTO_VACIO}</p>`;
  return `${lista}<p><a href="/">Volver al portal</a></p>`;
}
