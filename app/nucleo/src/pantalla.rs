//! Lo que la cáscara sirve por su cuenta: la pantalla de login y la regla de navegación.

use http::header::{CACHE_CONTROL, CONTENT_SECURITY_POLICY, CONTENT_TYPE, REFERRER_POLICY, X_CONTENT_TYPE_OPTIONS};
use http::{HeaderValue, Response};

use crate::login::EstadoLogin;
use crate::{CSP_PANTALLA, ORIGENES_APP, RUTA_INICIAR};

/// Mismo aspecto que las páginas de login del portal (`page()` de `lib/login-core.mjs`), con el
/// botón del consentimiento (`ESTILOS_APP` de `lib/app-paginas.mjs`). Llega hasta el título.
const CABEZA: &str = concat!(
    "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    "<title>VantTec Docs</title>\n",
    "<style>body{font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;",
    "min-height:100vh;margin:0;",
    "background:radial-gradient(120% 80% at 50% -10%,#01165c,#010c3d 45%,#01052a);",
    "color:#eef3fb}main{box-sizing:border-box;width:100%;max-width:420px;padding:24px;",
    "text-align:center;overflow-wrap:anywhere}",
    "p{margin:0}.nota{margin-top:8px;color:#c5d0e6}[role=alert]{font-weight:600}",
    "form{margin:24px 0 0}",
    "button{box-sizing:border-box;font:inherit;font-weight:600;min-height:44px;padding:9px 24px;",
    "border:1px solid #49c1d2;border-radius:8px;background:#49c1d2;color:#01052a;cursor:pointer}",
    "button:hover{background:#6fd0de}",
    "button:focus-visible{outline:2px solid #eef3fb;outline-offset:2px}</style>\n",
    "<main><h1>VantTec Docs</h1>",
);

const BOTON_INICIAR: &str = "Iniciar sesión";

/// Pantalla «sin sesión»: la de login en el estado `SinSesion`.
pub fn pantalla_sin_sesion() -> Response<Vec<u8>> {
    pantalla_de_login(EstadoLogin::SinSesion)
}

/// Pantalla de login según el estado: HTML sin JavaScript, con `CSP_PANTALLA`. Su único control
/// es el formulario del botón. Todos los textos son fijos: aquí no entra ningún dato del login.
pub fn pantalla_de_login(estado: EstadoLogin) -> Response<Vec<u8>> {
    let (mensaje, boton) = match estado {
        EstadoLogin::SinSesion | EstadoLogin::ConSesion => {
            ("<p>No has iniciado sesión.</p>".to_string(), BOTON_INICIAR)
        }
        EstadoLogin::EnCurso => (
            concat!(
                "<p>Sigue en el navegador para iniciar sesión.</p>",
                "<p class=\"nota\">Esta ventana cambiará sola al terminar.</p>",
            )
            .to_string(),
            "Abrir el navegador otra vez",
        ),
        EstadoLogin::Fallo(aviso) => {
            (format!("<p role=\"alert\">{}</p>", aviso.texto()), BOTON_INICIAR)
        }
    };
    let html = format!(
        "{CABEZA}{mensaje}<form method=\"post\" action=\"{RUTA_INICIAR}\">\
         <button type=\"submit\">{boton}</button></form></main></html>"
    );
    let mut respuesta = Response::new(html.into_bytes());
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

/// Qué hace la cáscara cuando el contenido pide una ventana nueva. Nunca se abre ninguna.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VentanaNueva {
    /// La URL es del propio origen: la ventana principal navega a ella.
    NavegarPrincipal,
    /// Cualquier otra URL: no pasa nada.
    Negar,
}

/// Decide una petición de ventana nueva con la misma regla que `on_navigation`.
pub fn decidir_ventana_nueva(url: &str) -> VentanaNueva {
    if navegacion_permitida(url) {
        VentanaNueva::NavegarPrincipal
    } else {
        VentanaNueva::Negar
    }
}
