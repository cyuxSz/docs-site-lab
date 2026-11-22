// Cáscara de la app VantTec Docs: una ventana cuyo origen lo sirve el proxy de `nucleo`.
//
// El webview no tiene ningún comando, permiso ni plugin: el origen del protocolo propio cuenta
// como local para el IPC de Tauri, así que cualquier cosa que se le diera a la ventana la
// recibiría también el contenido del portal. El token vive solo en el proxy.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;
use std::sync::Arc;

use nucleo::{
    config_de_arranque, decidir_ventana_nueva, navegacion_permitida, Limites, Proxy, TokenFijo,
    VentanaNueva, ESQUEMA, VAR_DESTINO_DEV, VAR_TOKEN_DEV,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

    let proxy = Arc::new(Proxy::nuevo(
        arranque.destino,
        Arc::new(TokenFijo(arranque.token)),
        Limites::default(),
    ));

    let resultado = tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(ESQUEMA, move |_contexto, peticion, respuesta| {
            // Un hilo por petición: el proxy bloquea mientras espera al servidor.
            let proxy = Arc::clone(&proxy);
            std::thread::spawn(move || respuesta.respond(proxy.atender(peticion)));
        })
        .setup(|app| {
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
