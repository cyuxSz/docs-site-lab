//! Lo que la cáscara sirve por su cuenta: la pantalla «sin sesión» y la regla de navegación.

use http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS};
use http::{HeaderValue, Response};

use crate::{CSP_PANTALLA, ORIGENES_APP};

/// Mismo aspecto que las páginas de login del portal (`page()` de `lib/login-core.mjs`).
const HTML_SIN_SESION: &str = concat!(
    "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>VantTec Docs</title>\n",
    "<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;",
    "min-height:100vh;margin:0;",
    "background:radial-gradient(120% 80% at 50% -10%,#01165c,#010c3d 45%,#01052a);",
    "color:#eef3fb}main{max-width:420px;padding:24px;text-align:center}",
    "p{margin:0}.nota{margin-top:8px;color:#c5d0e6}</style>\n",
    "<main><h1>VantTec Docs</h1><p>No has iniciado sesión.</p>",
    "<p class=\"nota\">El inicio de sesión desde la app llegará en una próxima versión.</p>",
    "</main></html>",
);

/// Pantalla «sin sesión»: HTML fijo, sin JavaScript, con `CSP_PANTALLA`.
pub fn pantalla_sin_sesion() -> Response<Vec<u8>> {
    let mut respuesta = Response::new(HTML_SIN_SESION.as_bytes().to_vec());
    let cabeceras = respuesta.headers_mut();
    cabeceras.insert(CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
    cabeceras.insert(CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP_PANTALLA));
    cabeceras.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    cabeceras.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    cabeceras.insert(REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    respuesta
}

/// `true` si la URL pertenece a uno de `ORIGENES_APP`. Es la regla de `on_navigation`.
pub fn navegacion_permitida(url: &str) -> bool {
    ORIGENES_APP.iter().any(|origen| match url.strip_prefix(origen) {
        Some(resto) => resto.is_empty() || resto.starts_with(['/', '?', '#']),
        None => false,
    })
}
