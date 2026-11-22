// Inicio de sesión de la app de escritorio en el navegador del sistema: HTML del consentimiento (/auth/app/iniciar) y
// de la página «Listo» (respuesta de POST /auth/app/autorizar), y el token anti-CSRF del formulario de consentimiento.
// Las pinta el Worker con el ayudante page() de login-core.mjs; no llevan JavaScript.
// - El nombre del dispositivo y el login son entrada no confiable: pasan por esc() en el texto y en los atributos.
//   La plataforma se pinta con la etiqueta de la tabla fija, nunca con su valor crudo.
// - El destino de la app es una constante de este módulo: esquema, host y nombres de parámetro no salen de la petición.
// - Aquí no se registra nada: el código solo existe en el HTML de «Listo».
// Sin imports de node:* ni paquetes: corre en workerd.
import { esc, ETIQUETAS, RUTA_PAGINA, hmacB64url, igualConstante } from "./dispositivos-paginas.mjs";

export const RUTA_INICIAR = "/auth/app/iniciar";
export const RUTA_AUTORIZAR = "/auth/app/autorizar";
// Los cuatro datos que viajan de la query al formulario, en el orden en que se reconstruye el `next` del login.
export const DATOS_APP = ["challenge", "state", "nombre", "plataforma"];

const DESTINO_APP = "vanttec-docs://auth?code=";

// ---------- Anti-CSRF sin estado ----------

// base64url(HMAC-SHA256(SESSION_SECRET, "csrf:v1:autorizar:" + JSON([cookie, challenge, state, plataforma, nombre]))).
// Va ligado a la sesión (el valor de la cookie, no solo el login), a este formulario (prefijo de propósito propio: no
// vale el de /auth/dispositivos ni al revés) y a lo que se mostró en la página. La lista se serializa con JSON, que
// delimita y escapa cada elemento: dos listas distintas nunca dan el mismo mensaje. Los de alfabeto fijo van primero y
// el nombre, de texto libre, al final.
const PROPOSITO = "csrf:v1:autorizar:";

export function csrfAutorizar(secreto, valorCookie, { challenge, state, plataforma, nombre }) {
  return hmacB64url(secreto, PROPOSITO + JSON.stringify([valorCookie, challenge, state, plataforma, nombre]));
}

// `datos` son los valores recibidos tal cual (sin recortar ni normalizar): si alguno falta o no es el que se pintó,
// el token no casa. Comparación en tiempo constante.
export async function csrfAutorizarValido(secreto, valorCookie, datos, recibido) {
  if (typeof valorCookie !== "string" || !valorCookie || typeof recibido !== "string" || !recibido) return false;
  if (!datos || DATOS_APP.some((k) => typeof datos[k] !== "string")) return false;
  return igualConstante(await csrfAutorizar(secreto, valorCookie, datos), recibido);
}

// ---------- HTML ----------

// Añadidos a los estilos de page(): columna de 420 px, texto secundario atenuado, un botón principal y foco visible.
// Un nombre largo sin espacios se parte en vez de desbordar la columna.
export const ESTILOS_APP =
  "main{box-sizing:border-box;width:100%;max-width:468px;overflow-wrap:anywhere}" +
  ".s{font-size:14px;color:#b9c6dc}" +
  "form{margin:24px 0 8px}" +
  "button,.b{display:inline-block;box-sizing:border-box;font:inherit;font-weight:600;min-height:44px;padding:9px 24px;border:1px solid #49c1d2;border-radius:8px;background:#49c1d2;color:#01052a;text-decoration:none;cursor:pointer}" +
  "button:hover,.b:hover{background:#6fd0de}" +
  "button:focus-visible,a:focus-visible{outline:2px solid #eef3fb;outline-offset:2px}";

const oculto = (nombre, valor) => `<input type="hidden" name="${nombre}" value="${esc(valor)}">`;

// Cuerpo del consentimiento (va dentro de page(), bajo el <h1>). `datos` ya está validado y el nombre recortado.
// Un solo formulario con un solo botón, sin autofocus: abrir la página y pulsar Enter no autoriza nada.
export function htmlConsentimiento({ login, datos, csrf }) {
  const plataforma = ETIQUETAS.get(datos.plataforma) ?? "Otro";
  return (
    `<p>VantTec Docs en «${esc(datos.nombre)}» (${plataforma}) quiere entrar como @${esc(login)}.</p>` +
    `<p class="s">El acceso dura 30 días. Puedes quitarlo cuando quieras en <a href="${RUTA_PAGINA}">Dispositivos</a>.</p>` +
    `<form method="post" action="${RUTA_AUTORIZAR}">${DATOS_APP.map((k) => oculto(k, datos[k])).join("")}${oculto("csrf", csrf)}` +
    `<button type="submit">Autorizar</button></form>` +
    `<p><a href="/">Cancelar</a></p>`
  );
}

// Página «Listo»: el mismo destino va en el enlace (cuerpo) y en un <meta http-equiv="refresh"> (cabecera del
// documento) que abre la app sin JavaScript. `codigo` lo acaba de crear el servidor y `state` ya pasó su validación
// (los dos son base64url); aun así se escapan como cualquier atributo.
export function htmlListo(codigo, state) {
  const destino = esc(`${DESTINO_APP}${codigo}&state=${state}`);
  return {
    cabeza: `<meta http-equiv="refresh" content="0;url=${destino}">`,
    cuerpo: `<p>Vuelve a VantTec Docs para continuar. Si no se abre sola, pulsa el botón.</p><p><a class="b" href="${destino}">Abrir VantTec Docs</a></p>`,
  };
}
