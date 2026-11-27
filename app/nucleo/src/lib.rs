//! Núcleo de la app VantTec Docs: el proxy que reenvía las peticiones del webview al portal
//! con el token de dispositivo, y las pantallas que la cáscara sirve por su cuenta.
//!
//! No depende de la ventana: se prueba con `cargo test` contra un servidor falso.

mod destino;
mod pantalla;
mod proxy;
mod token;

pub use destino::{config_de_arranque, Arranque, Destino, DestinoInvalido};
pub use pantalla::{decidir_ventana_nueva, navegacion_permitida, pantalla_sin_sesion, VentanaNueva};
pub use proxy::{Limites, Proxy};
pub use token::{FuenteDeToken, Token, TokenFijo};

/// Origen del portal en producción. En release es el único destino posible.
pub const ORIGEN_PRODUCCION: &str = "https://docs.vanttec.workers.dev";

/// Nombre del protocolo propio que sirve el origen de la app.
pub const ESQUEMA: &str = "portal";

/// Orígenes de la app: WebView2 y Android (`useHttpsScheme: true`), y el resto de plataformas.
pub const ORIGENES_APP: [&str; 2] = ["https://portal.localhost", "portal://localhost"];

/// Tope del cuerpo de una petición y de una respuesta: 64 MiB.
pub const TOPE_CUERPO: usize = 64 * 1024 * 1024;

/// Variables de entorno que solo se leen en builds de depuración.
pub const VAR_DESTINO_DEV: &str = "VANTTEC_DOCS_DESTINO_DEV";
pub const VAR_TOKEN_DEV: &str = "VANTTEC_DOCS_TOKEN_DEV";

/// CSP de las pantallas que sirve la cáscara.
pub const CSP_PANTALLA: &str = "default-src 'none'; style-src 'unsafe-inline'";

/// CSP que el proxy añade a toda respuesta: ningún marco de otro origen.
pub const CSP_MARCOS: &str = "frame-src 'self'";

/// CSP que el proxy añade, además, a un documento que el servidor aísla con `sandbox`: nada de
/// la red, solo lo que va en línea.
pub const CSP_AISLADO: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
