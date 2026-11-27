// Cáscara de la app VantTec Docs: una ventana cuyo origen lo sirve el proxy de `nucleo`.
//
// El webview no tiene ningún comando ni permiso: el origen del protocolo propio cuenta como
// local para el IPC de Tauri, así que cualquier cosa que se le diera a la ventana la recibiría
// también el contenido del portal. El único plugin, el de instancia única, no registra comandos.
// El token, el código y el `verifier` viven solo en `nucleo`: aquí no se leen ni se escriben.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Instant;

use nucleo::{
    config_de_arranque, decidir_ventana_nueva, navegacion_permitida, Limites, Login, Navegador,
    Proxy, Recibido, VentanaNueva, ESQUEMA, VAR_DESTINO_DEV, VAR_NOMBRE_EQUIPO, VAR_TOKEN_DEV,
};
use nucleo::Llavero;
#[cfg(windows)]
use nucleo::{nombre_de_llavero, LLAVERO_CUENTA};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
mod llavero;

/// Abre la URL en el navegador del sistema, tal como llega. La construye y la pasa el núcleo.
struct NavegadorDelSistema;

impl Navegador for NavegadorDelSistema {
    fn abrir(&self, url: &str) -> bool { open::that_detached(url).is_ok() }
}

/// Apunta el esquema del enlace de login a este ejecutable, para el usuario actual. Solo en el
/// binario de depuración: en release lo hará el instalador.
#[cfg(all(windows, debug_assertions))]
fn registrar_esquema() -> Option<()> {
    use nucleo::ESQUEMA_ENLACE;
    use windows_registry::CURRENT_USER;
    let exe = std::env::current_exe().ok()?;
    let exe = exe.to_str()?;
    let base = format!("Software\\Classes\\{ESQUEMA_ENLACE}");
    let clave = CURRENT_USER.create(&base).ok()?;
    clave.set_string("", "URL:VantTec Docs").ok()?;
    clave.set_string("URL Protocol", "").ok()?;
    let orden = CURRENT_USER.create(format!("{base}\\shell\\open\\command")).ok()?;
    orden.set_string("", format!("\"{exe}\" \"%1\"")).ok()?;
    Some(())
}

fn main() -> ExitCode {
    // Las variables de desarrollo solo se leen en builds de depuración, y aun así
    // `config_de_arranque` las ignora cuando su primer argumento es falso.
    let (destino_dev, token_dev) = if cfg!(debug_assertions) {
        (std::env::var(VAR_DESTINO_DEV).ok(), std::env::var(VAR_TOKEN_DEV).ok())
    } else {
        (None, None)
    };
    let arranque = match config_de_arranque(
        cfg!(debug_assertions),
        destino_dev.as_deref(),
        token_dev.as_deref(),
    ) {
        Ok(arranque) => arranque,
        Err(_) => {
            eprintln!("destino de desarrollo inválido");
            return ExitCode::FAILURE;
        }
    };

    // El nombre del equipo es el nombre del dispositivo. Lo limpia el núcleo.
    let equipo = std::env::var(VAR_NOMBRE_EQUIPO).ok();
    #[cfg(windows)]
    let llavero: Arc<dyn Llavero> = Arc::new(llavero::LlaveroDelSistema::nuevo(
        nombre_de_llavero(cfg!(debug_assertions)),
        LLAVERO_CUENTA,
    ));
    #[cfg(not(windows))]
    let llavero: Arc<dyn Llavero> = Arc::new(nucleo::SinLlavero);
    let login = Arc::new(Login::con_llavero(
        arranque.destino,
        equipo.as_deref(),
        arranque.token,
        llavero,
    ));
    let proxy = Arc::new(Proxy::con_login(
        Arc::clone(&login),
        Arc::new(NavegadorDelSistema),
        Limites::default(),
    ));

    let resultado = tauri::Builder::default()
        // Va el primero: una segunda instancia entrega sus argumentos a la primera y termina
        // aquí, sin abrir ventana ni llegar a `setup`.
        .plugin(tauri_plugin_single_instance::init(move |app, args, _cwd| {
            // Este cierre corre en el hilo de la ventana y el canje bloquea: va en otro hilo.
            let (login, app) = (Arc::clone(&login), app.clone());
            std::thread::spawn(move || {
                // Solo cuenta una segunda instancia con un único argumento: el enlace. El
                // núcleo decide si lo es; aquí no se mira ni se escribe en ningún sitio.
                let cambio = args.len() == 2
                    && login.recibir(&args[1], Instant::now()) != Recibido::Ignorado;
                if let Some(principal) = app.get_webview_window("main") {
                    if cambio {
                        let _ = principal.reload();
                    }
                    let _ = principal.unminimize();
                    let _ = principal.set_focus();
                }
            });
        }))
        .register_asynchronous_uri_scheme_protocol(ESQUEMA, move |_contexto, peticion, respuesta| {
            // El núcleo admite la petición (con tope) y la atiende en un hilo propio.
            proxy.atender_en_hilo(peticion, move |r| respuesta.respond(r));
        })
        .setup(|app| {
            // Un fallo al registrar el esquema no impide arrancar.
            #[cfg(all(windows, debug_assertions))]
            let _ = registrar_esquema();

            let inicio = format!("{ESQUEMA}://localhost/").parse()?;
            let manejador = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::CustomProtocol(inicio))
                .title("VantTec Docs")
                .inner_size(1280.0, 860.0)
                .use_https_scheme(true)
                .zoom_hotkeys_enabled(true)
                .on_navigation(|url| navegacion_permitida(url.as_str()))
                // Ninguna ventana nueva se abre. Si la pedida es del propio origen, la ventana
                // principal navega a ella; esa navegación pasa por `on_navigation` como todas.
                .on_new_window(move |url, _features| {
                    if decidir_ventana_nueva(url.as_str()) == VentanaNueva::NavegarPrincipal {
                        if let Some(principal) = manejador.get_webview_window("main") {
                            let _ = principal.navigate(url);
                        }
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!());

    match resultado {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => {
            eprintln!("no se pudo abrir la ventana");
            ExitCode::FAILURE
        }
    }
}
