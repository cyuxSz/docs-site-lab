//! La parte de la ventana que no necesita ventana: la pantalla de login en sus tres estados
//! (lote `app-login`, criterio 7) y la regla de navegación (lote `app-cascara`, criterio 6).

use nucleo::{
    navegacion_permitida, pantalla_de_login, pantalla_sin_sesion, Aviso, EstadoLogin, CSP_PANTALLA, ESQUEMA,
    ORIGENES_APP, RUTA_INICIAR,
};

const AVISOS: [Aviso; 4] =
    [Aviso::NavegadorNoAbre, Aviso::NoSePudo, Aviso::DemasiadosIntentos, Aviso::SinConexion];

fn cabecera(respuesta: &http::Response<Vec<u8>>, nombre: &str) -> Option<String> {
    respuesta.headers().get(nombre).map(|v| v.to_str().unwrap().to_string())
}

fn html_de(estado: EstadoLogin) -> String {
    String::from_utf8(pantalla_de_login(estado).body().clone()).expect("la pantalla es UTF-8")
}

fn estados() -> Vec<EstadoLogin> {
    let mut estados = vec![EstadoLogin::SinSesion, EstadoLogin::EnCurso, EstadoLogin::ConSesion];
    estados.extend(AVISOS.map(EstadoLogin::Fallo));
    estados
}

#[test]
fn c7_la_pantalla_lleva_su_csp_con_form_action_y_las_cabeceras_de_las_paginas_de_login() {
    // Lo mínimo que necesita el botón: enviar un formulario al propio origen. Nada más se abre.
    assert_eq!(CSP_PANTALLA, "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
    for estado in estados() {
        let respuesta = pantalla_de_login(estado);
        assert_eq!(respuesta.status().as_u16(), 200, "{estado:?}");
        let csp: Vec<_> = respuesta.headers().get_all("content-security-policy").iter().collect();
        assert_eq!(csp, [CSP_PANTALLA], "{estado:?}: una sola CSP, la de la pantalla");
        assert_eq!(cabecera(&respuesta, "content-type").as_deref(), Some("text/html; charset=utf-8"));
        assert_eq!(cabecera(&respuesta, "cache-control").as_deref(), Some("no-store"));
        assert_eq!(cabecera(&respuesta, "x-content-type-options").as_deref(), Some("nosniff"));
    }
}

#[test]
fn c7_la_pantalla_se_sirve_con_referrer_policy_same_origin_en_todas_sus_vistas() {
    // Medido en WebView2 157: con `no-referrer` el POST del formulario sale con `Origin: null` y
    // la ruta del botón lo rechaza con 403. Con `same-origin` lleva el origen de la app. La
    // pantalla no enlaza a nada externo ni carga subrecursos, así que no filtra nada.
    for estado in estados() {
        let respuesta = pantalla_de_login(estado);
        let politicas: Vec<_> = respuesta.headers().get_all("referrer-policy").iter().collect();
        assert_eq!(politicas, ["same-origin"], "{estado:?}: una sola Referrer-Policy, same-origin");
    }
    let politicas: Vec<_> = pantalla_sin_sesion().headers().get_all("referrer-policy").iter().cloned().collect();
    assert_eq!(politicas, ["same-origin"], "pantalla_sin_sesion");
}

#[test]
fn c7_la_pantalla_tiene_un_solo_control_y_nada_de_javascript() {
    for estado in estados() {
        let html = html_de(estado);
        let minusculas = html.to_lowercase();

        assert!(minusculas.starts_with("<!doctype html>"), "{estado:?}");
        assert!(html.contains("<html lang=\"es\""), "{estado:?}: falta lang=\"es\"");
        assert!(minusculas.contains("<meta charset=\"utf-8\""));
        assert!(html.contains("name=\"viewport\"") && html.contains("width=device-width"));
        assert!(html.contains("<title>VantTec Docs</title>"));
        assert_eq!(html.matches("<h1").count(), 1, "{estado:?}: un solo título");
        assert!(html.contains(">VantTec Docs</h1>"));
        assert!(html.contains("<main"), "el contenido va en <main>");

        // Mismo aspecto que las páginas de login del portal: fondo marino y columna de 420 px.
        assert!(html.contains("#01165c") && html.contains("#010c3d") && html.contains("#01052a"));
        assert!(html.contains("max-width:420px") || html.contains("max-width: 420px"));

        // Un formulario hacia la ruta reservada, con un botón y ningún campo.
        assert_eq!(minusculas.matches("<form").count(), 1, "{estado:?}: un solo formulario");
        assert!(
            html.contains(&format!("<form method=\"post\" action=\"{RUTA_INICIAR}\">")),
            "{estado:?}: el formulario es <form method=\"post\" action=\"/__app/iniciar\">"
        );
        assert_eq!(minusculas.matches("<button").count(), 1, "{estado:?}: un solo botón");
        assert!(html.contains("<button type=\"submit\">"), "{estado:?}");
        assert_eq!(minusculas.matches("action=").count(), 1, "{estado:?}: una sola acción");
        assert!(!minusculas.contains("formaction"), "{estado:?}");
        // Tamaño táctil y foco visible, como el botón del consentimiento del portal.
        assert!(html.contains("min-height:44px") || html.contains("min-height: 44px"), "{estado:?}");
        assert!(html.contains(":focus-visible"), "{estado:?}: el foco del botón se ve");

        // Sin JavaScript, sin más acciones y sin nada que cargue de fuera.
        for prohibido in [
            "<script", "<a ", "<input", "<select", "<textarea", "<img", "<iframe", "<link", "<base",
            "http-equiv", "http://", "https://", "url(", "@import", "javascript:", " onclick",
            " onload", " onsubmit", " style=\"", "autofocus", "target=",
        ] {
            assert!(!minusculas.contains(prohibido), "{estado:?}: la pantalla no debe contener {prohibido:?}");
        }
        assert!(html.len() < 4096, "{estado:?}: la pantalla es mínima: {} bytes", html.len());
    }
}

#[test]
fn c7_cada_estado_dice_lo_suyo_y_nada_mas() {
    let sin = html_de(EstadoLogin::SinSesion);
    assert!(sin.contains("No has iniciado sesión."));
    assert!(sin.contains("<button type=\"submit\">Iniciar sesión</button>"));
    assert!(!sin.contains("role=\"alert\"") && !sin.contains("navegador"));
    assert!(!sin.contains("próxima versión"), "el texto del lote anterior ya no va");

    let curso = html_de(EstadoLogin::EnCurso);
    assert!(curso.contains("Sigue en el navegador para iniciar sesión."));
    assert!(curso.contains("Esta ventana cambiará sola al terminar."));
    assert!(curso.contains("<button type=\"submit\">Abrir el navegador otra vez</button>"));
    assert!(!curso.contains("No has iniciado sesión.") && !curso.contains("role=\"alert\""));

    for aviso in AVISOS {
        let fallo = html_de(EstadoLogin::Fallo(aviso));
        assert!(
            fallo.contains(&format!("<p role=\"alert\">{}</p>", aviso.texto())),
            "{aviso:?}: el aviso va en un párrafo con role=\"alert\""
        );
        assert_eq!(fallo.matches("role=\"alert\"").count(), 1);
        assert!(fallo.contains("<button type=\"submit\">Iniciar sesión</button>"), "{aviso:?}");
        assert!(!fallo.contains("Sigue en el navegador"), "{aviso:?}");
        for otro in AVISOS.iter().filter(|otro| **otro != aviso) {
            assert!(!fallo.contains(otro.texto()), "{aviso:?} no muestra el texto de {otro:?}");
        }
    }

    // Con sesión no hay pantalla propia: si alguien la pide, es la de «sin sesión».
    assert_eq!(html_de(EstadoLogin::ConSesion), sin);
    // La función del lote anterior sigue existiendo y es esa misma pantalla.
    assert_eq!(pantalla_sin_sesion().body(), pantalla_de_login(EstadoLogin::SinSesion).body());
    assert_eq!(pantalla_sin_sesion().headers(), pantalla_de_login(EstadoLogin::SinSesion).headers());
}

#[test]
fn c6_el_protocolo_propio_y_los_origenes_de_la_app_son_fijos() {
    assert_eq!(ESQUEMA, "portal");
    assert_eq!(ORIGENES_APP, ["https://portal.localhost", "portal://localhost"]);
}

#[test]
fn c6_la_navegacion_se_permite_solo_dentro_del_origen_de_la_app() {
    for url in [
        "https://portal.localhost/",
        "https://portal.localhost/uuv/electronica/?p=potencia#seccion",
        "https://portal.localhost/api/archivos/?id=1",
        "https://portal.localhost",
        "https://portal.localhost?p=1",
        "https://portal.localhost#f",
        "portal://localhost/",
        "portal://localhost/uuv/",
    ] {
        assert!(navegacion_permitida(url), "debe permitir {url}");
    }
    for url in [
        "",
        "https://docs.vanttec.workers.dev/",
        "https://github.com/login/oauth/authorize?client_id=x",
        "https://embed.diagrams.net/",
        "http://portal.localhost/",
        "https://portal.localhost.ejemplo.test/",
        "https://portal.localhostx/",
        "https://portal.localhost:444/",
        "https://portal.localhost@ejemplo.test/",
        "https://usuario@portal.localhost/",
        "https://otro.localhost/",
        "https://tauri.localhost/",
        "tauri://localhost/",
        "portal://ejemplo.test/",
        "portal://localhost.ejemplo.test/",
        "portal:localhost/",
        "vanttec-docs://auth?code=x",
        "file:///C:/Windows/win.ini",
        "javascript:alert(1)",
        "data:text/html,<h1>x</h1>",
        "blob:https://portal.localhost/0f1e",
        "HTTPS://PORTAL.LOCALHOST.ejemplo.test/",
        " https://portal.localhost/",
        "https://portal.localhost\\@ejemplo.test/",
    ] {
        assert!(!navegacion_permitida(url), "debe bloquear {url:?}");
    }
}
