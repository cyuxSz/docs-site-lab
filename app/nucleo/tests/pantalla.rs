//! Criterio 6, la parte que no necesita ventana: pantalla «sin sesión» y regla de navegación.

use nucleo::{navegacion_permitida, pantalla_sin_sesion, CSP_PANTALLA, ESQUEMA, ORIGENES_APP};

fn cabecera(respuesta: &http::Response<Vec<u8>>, nombre: &str) -> Option<String> {
    respuesta.headers().get(nombre).map(|v| v.to_str().unwrap().to_string())
}

#[test]
fn c6_la_pantalla_sin_sesion_lleva_la_csp_y_las_cabeceras_de_las_paginas_de_login() {
    let respuesta = pantalla_sin_sesion();
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(CSP_PANTALLA, "default-src 'none'; style-src 'unsafe-inline'");
    assert_eq!(cabecera(&respuesta, "content-security-policy").as_deref(), Some(CSP_PANTALLA));
    assert_eq!(cabecera(&respuesta, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert_eq!(cabecera(&respuesta, "cache-control").as_deref(), Some("no-store"));
    assert_eq!(cabecera(&respuesta, "x-content-type-options").as_deref(), Some("nosniff"));
    assert_eq!(cabecera(&respuesta, "referrer-policy").as_deref(), Some("no-referrer"));
}

#[test]
fn c6_la_pantalla_sin_sesion_dice_lo_acordado_y_nada_mas() {
    let respuesta = pantalla_sin_sesion();
    let html = String::from_utf8(respuesta.body().clone()).expect("la pantalla es UTF-8");
    let minusculas = html.to_lowercase();

    assert!(minusculas.starts_with("<!doctype html>"));
    assert!(html.contains("<html lang=\"es\""), "falta lang=\"es\"");
    assert!(minusculas.contains("<meta charset=\"utf-8\""));
    assert!(html.contains("name=\"viewport\"") && html.contains("width=device-width"));
    assert!(html.contains("<title>VantTec Docs</title>"));
    assert_eq!(html.matches("<h1").count(), 1, "un solo título");
    assert!(html.contains("<main"), "el contenido va en <main>");
    assert!(html.contains(">VantTec Docs</h1>"));
    assert!(html.contains("No has iniciado sesión."));
    assert!(html.contains("El inicio de sesión desde la app llegará en una próxima versión."));

    // Mismo aspecto que las páginas de login del portal: fondo marino y columna de 420 px.
    assert!(html.contains("#01165c") && html.contains("#010c3d") && html.contains("#01052a"));
    assert!(html.contains("max-width:420px") || html.contains("max-width: 420px"));

    // Sin JavaScript, sin acciones y sin nada que cargue de fuera.
    for prohibido in [
        "<script", "<a ", "<button", "<form", "<input", "<img", "<iframe", "<link", "http://",
        "https://", "url(", "@import", "javascript:", " onclick", " onload", " style=\"",
    ] {
        assert!(!minusculas.contains(prohibido), "la pantalla no debe contener {prohibido:?}");
    }
    assert!(html.len() < 4096, "la pantalla es mínima: {} bytes", html.len());
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
