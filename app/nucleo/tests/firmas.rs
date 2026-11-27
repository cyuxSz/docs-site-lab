//! Firmas públicas nuevas de la tercera vuelta: las dos CSP que añade el proxy (criterio 10) y
//! la decisión sobre una ventana nueva (criterio 6).
//!
//! Va en su propio archivo porque usa nombres que aún no existen en `nucleo`: mientras no
//! existan, este archivo no compila (E0432) y los demás archivos de test no cambian. Lo que hace
//! el proxy con las CSP se prueba en `csp.rs`, que sí compila.

use nucleo::{
    decidir_ventana_nueva, navegacion_permitida, VentanaNueva, CSP_AISLADO, CSP_MARCOS, ORIGENES_APP,
};

/// URL del propio origen de la app, tal como las entrega Tauri al cierre de `on_new_window`
/// (ya pasadas por `Url`, así que el origen solo siempre lleva la barra final).
const PROPIAS: [&str; 9] = [
    "https://portal.localhost/",
    "https://portal.localhost/uuv/arch/arquitectura-uuv.html",
    "https://portal.localhost/uuv/electronica/?p=potencia#seccion",
    "https://portal.localhost/api/archivos/?id=1",
    "https://portal.localhost",
    "https://portal.localhost?p=1",
    "https://portal.localhost#f",
    "portal://localhost/",
    "portal://localhost/uuv/arch/a.html",
];

const AJENAS: [&str; 27] = [
    "",
    // `window.open()` sin URL y los esquemas que no son una página del portal.
    "about:blank",
    "about:srcdoc",
    "javascript:alert(1)",
    "data:text/html,<h1>x</h1>",
    "blob:https://portal.localhost/0f1e",
    "file:///C:/Windows/win.ini",
    "mailto:alguien@ejemplo.test",
    "vanttec-docs://auth?code=x",
    // Otros sitios: el destino real, el editor de diagramas, GitHub.
    "https://docs.vanttec.workers.dev/",
    "https://embed.diagrams.net/",
    "https://github.com/vanttec",
    "https://ejemplo.test/?u=https://portal.localhost/",
    // Parecidos al origen de la app.
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
    "portal:localhost/",
    "HTTPS://PORTAL.LOCALHOST/",
    " https://portal.localhost/",
    "https://portal.localhost\\@ejemplo.test/",
];

#[test]
fn c10_las_csp_que_anade_el_proxy_son_constantes_exactas() {
    assert_eq!(CSP_MARCOS, "frame-src 'self'");
    assert_eq!(
        CSP_AISLADO,
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:"
    );
    // Ninguna abre nada hacia la red: ni comodines, ni esquemas de red, ni el propio origen
    // dentro del documento aislado, ni eval.
    for prohibido in ["*", "http", "'self'", "unsafe-eval", "connect-src", "frame-src"] {
        assert!(!CSP_AISLADO.contains(prohibido), "CSP_AISLADO no debe contener {prohibido:?}");
    }
    assert!(!CSP_MARCOS.contains(['*', ',', ';']) && !CSP_AISLADO.contains(','));
}

#[test]
fn c6_una_ventana_nueva_hacia_el_propio_origen_navega_la_ventana_principal() {
    for url in PROPIAS {
        assert_eq!(decidir_ventana_nueva(url), VentanaNueva::NavegarPrincipal, "{url}");
    }
}

#[test]
fn c6_una_ventana_nueva_hacia_cualquier_otro_origen_se_niega() {
    for url in AJENAS {
        assert_eq!(decidir_ventana_nueva(url), VentanaNueva::Negar, "{url:?}");
    }
}

#[test]
fn c6_la_decision_es_la_misma_regla_que_la_navegacion() {
    // Una sola regla de origen: lo que `on_navigation` dejaría pasar es lo único que se navega.
    let extra = ORIGENES_APP.iter().flat_map(|o| [o.to_string(), format!("{o}/x"), format!("{o}x"), format!("{o}:1/")]);
    for url in PROPIAS.iter().chain(AJENAS.iter()).map(|u| u.to_string()).chain(extra) {
        let esperada = if navegacion_permitida(&url) { VentanaNueva::NavegarPrincipal } else { VentanaNueva::Negar };
        assert_eq!(decidir_ventana_nueva(&url), esperada, "{url:?}");
    }
}

#[test]
fn c6_no_hay_una_tercera_decision_que_abra_una_ventana() {
    // Si se añade una variante (por ejemplo, permitir), este `match` deja de compilar.
    let decision: VentanaNueva = decidir_ventana_nueva("https://portal.localhost/");
    match decision {
        VentanaNueva::NavegarPrincipal | VentanaNueva::Negar => {}
    }
    let copia = decision;
    assert_eq!(format!("{copia:?}"), format!("{decision:?}"), "es Copy, Debug y Eq");
}
