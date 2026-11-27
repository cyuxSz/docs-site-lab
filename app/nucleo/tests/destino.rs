//! Criterios 1, 4 y 5 sin red: destino del proxy, arranque, token y límites por defecto.

use std::time::Duration;

use nucleo::{
    config_de_arranque, Destino, DestinoInvalido, Limites, Token, ORIGEN_PRODUCCION, TOPE_CUERPO,
    VAR_DESTINO_DEV, VAR_TOKEN_DEV,
};

const TOKEN: &str = "vtd_PRUEBA0123456789abcdefghijklmnopqrstuvw-_XY";

// ---------- Criterio 1: destino ----------

#[test]
fn c1_el_destino_de_produccion_es_el_worker_fijo() {
    assert_eq!(ORIGEN_PRODUCCION, "https://docs.vanttec.workers.dev");
    assert_eq!(Destino::produccion().origen(), "https://docs.vanttec.workers.dev");
}

#[test]
fn c1_destino_nuevo_acepta_https_y_http_solo_en_loopback() {
    for (entrada, origen) in [
        ("https://docs.vanttec.workers.dev", "https://docs.vanttec.workers.dev"),
        ("https://ejemplo.test:8443", "https://ejemplo.test:8443"),
        ("http://localhost:8792", "http://localhost:8792"),
        ("http://127.0.0.1:8792", "http://127.0.0.1:8792"),
        ("http://localhost:8792/", "http://localhost:8792"),
    ] {
        let destino = Destino::nuevo(entrada).unwrap_or_else(|_| panic!("debe aceptar {entrada:?}"));
        assert_eq!(destino.origen(), origen);
    }
}

#[test]
fn c1_destino_nuevo_rechaza_lo_que_no_es_un_origen_limpio() {
    for entrada in [
        "",
        "docs.vanttec.workers.dev",
        "ftp://ejemplo.test",
        "file:///c:/x",
        "https://",
        "http://ejemplo.test",
        "http://localhost.ejemplo.test:8792",
        "http://127.0.0.1.ejemplo.test:8792",
        "https://usuario:clave@ejemplo.test",
        "https://ejemplo.test@otro.test",
        "https://ejemplo.test/ruta",
        "https://ejemplo.test//",
        "https://ejemplo.test?x=1",
        "https://ejemplo.test#f",
        "https://ejem plo.test",
        "https://ejemplo.test\\otro.test",
        "https://ejemplo.test:99999",
        "https://ejemplo.test:puerto",
        "https://ejemplo.test\r\nX-Mala: 1",
    ] {
        assert_eq!(Destino::nuevo(entrada), Err(DestinoInvalido), "debe rechazar {entrada:?}");
    }
}

#[test]
fn c1_url_para_construye_la_url_sobre_el_origen() {
    let destino = Destino::nuevo("http://127.0.0.1:8792").unwrap();
    for ruta in [
        "/",
        "/uuv/",
        "/uuv/electronica/?p=arquitectura&x=1",
        "/api/archivos/?proyecto=uuv&id=abc-123",
        "/_astro/Base.B1x2.css",
        "/a%20b/c",
        "/uuv/electronica/%24%24%3A0%3A%24%24",
        "/.well-known/x",
        "/a..b/c.d",
        "/usuario@ejemplo.test/x",
        "/x?next=//ejemplo.test/y",
        "/x?ruta=../../y",
        "/x?",
    ] {
        assert_eq!(
            destino.url_para(ruta).as_deref(),
            Some(format!("http://127.0.0.1:8792{ruta}").as_str()),
            "ruta {ruta:?}"
        );
    }
}

#[test]
fn c1_url_para_rechaza_todo_lo_que_podria_salir_del_origen() {
    let destino = Destino::nuevo("http://127.0.0.1:8792").unwrap();
    for ruta in [
        "",
        "x",
        "uuv/",
        "https://ejemplo.test/x",
        "//ejemplo.test/x",
        "/%2Fejemplo.test/x",
        "/%2fejemplo.test/x",
        "/\\ejemplo.test/x",
        "/%5Cejemplo.test/x",
        "/a\\b",
        "/a/%5c/b",
        "/..",
        "/../x",
        "/a/../b",
        "/a/..",
        "/a/..?x=1",
        "/a/./b",
        "/./a",
        "/%2e%2e/x",
        "/%2E%2E/x",
        "/a/.%2e/b",
        "/a/%2e./b",
        "/a/%2e/b",
        "/a b",
        "/a\tb",
        "/a\r\nb",
        "/a\0b",
        "/a#fragmento",
        "/a%0d%0ab",
        "/a%zz",
        "/a%2",
    ] {
        assert_eq!(destino.url_para(ruta), None, "debe rechazar {ruta:?}");
    }
}

// ---------- Criterio 1: el destino y el token de desarrollo no existen en release ----------

#[test]
fn c1_en_release_el_arranque_ignora_las_variables_de_desarrollo() {
    for (destino, token) in [
        (None, None),
        (Some("http://localhost:8792"), Some(TOKEN)),
        (Some("https://ejemplo.test"), None),
        (Some("no es un origen"), Some(TOKEN)),
        (Some(""), Some("")),
    ] {
        let arranque = config_de_arranque(false, destino, token)
            .expect("en release el arranque nunca falla por las variables");
        assert_eq!(arranque.destino.origen(), ORIGEN_PRODUCCION, "destino con {destino:?}");
        assert!(arranque.token.is_none(), "en release no hay token de desarrollo ({token:?})");
    }
}

#[test]
fn c1_en_debug_el_arranque_usa_las_variables_de_desarrollo() {
    let arranque = config_de_arranque(true, None, None).unwrap();
    assert_eq!(arranque.destino.origen(), ORIGEN_PRODUCCION);
    assert!(arranque.token.is_none());

    let arranque = config_de_arranque(true, Some("http://localhost:8792"), Some(TOKEN)).unwrap();
    assert_eq!(arranque.destino.origen(), "http://localhost:8792");
    assert_eq!(arranque.token.as_ref().map(Token::exponer), Some(TOKEN));

    // Vacío cuenta como ausente.
    let arranque = config_de_arranque(true, Some(""), Some("")).unwrap();
    assert_eq!(arranque.destino.origen(), ORIGEN_PRODUCCION);
    assert!(arranque.token.is_none());

    // Un token con forma inválida se descarta: la app arranca sin sesión.
    let arranque = config_de_arranque(true, None, Some("con espacio")).unwrap();
    assert!(arranque.token.is_none());
}

#[test]
fn c1_en_debug_un_destino_invalido_es_un_error_y_no_cae_en_produccion() {
    for destino in ["no es un origen", "http://ejemplo.test", "https://ejemplo.test/ruta"] {
        assert!(
            matches!(config_de_arranque(true, Some(destino), Some(TOKEN)), Err(DestinoInvalido)),
            "debe fallar con {destino:?}"
        );
    }
}

#[test]
fn c1_las_variables_de_desarrollo_tienen_nombre_fijo() {
    assert_eq!(VAR_DESTINO_DEV, "VANTTEC_DOCS_DESTINO_DEV");
    assert_eq!(VAR_TOKEN_DEV, "VANTTEC_DOCS_TOKEN_DEV");
}

// ---------- Criterio 5: el tipo Token ----------

#[test]
fn c5_token_nuevo_solo_acepta_ascii_visible() {
    assert_eq!(Token::nuevo(TOKEN).expect("token con forma válida").exponer(), TOKEN);
    assert!(Token::nuevo(&"a".repeat(512)).is_some());
    for valor in [
        "",
        " ",
        "con espacio",
        "salto\r\nX-Mala: 1",
        "salto\n",
        "tab\tulador",
        "nulo\0",
        "eñe",
        "\u{7f}",
        &"a".repeat(513),
    ] {
        assert!(Token::nuevo(valor).is_none(), "debe rechazar {valor:?}");
    }
}

#[test]
fn c5_el_debug_de_token_y_de_arranque_no_muestra_el_valor() {
    let token = Token::nuevo(TOKEN).unwrap();
    let visto = format!("{token:?} {:#?} {:?}", token, Some(&token));
    assert!(!visto.contains(TOKEN), "Debug de Token muestra el valor: {visto}");
    assert!(!visto.contains(&TOKEN[4..20]), "Debug de Token muestra parte del valor: {visto}");

    let arranque = config_de_arranque(true, None, Some(TOKEN)).unwrap();
    let visto = format!("{arranque:?}");
    assert!(!visto.contains(&TOKEN[4..20]), "Debug de Arranque muestra el token: {visto}");
}

// ---------- Criterio 4: límites por defecto ----------

#[test]
fn c4_los_limites_por_defecto_son_explicitos() {
    assert_eq!(TOPE_CUERPO, 64 * 1024 * 1024);
    let limites = Limites::default();
    assert_eq!(limites.cuerpo_peticion, TOPE_CUERPO);
    assert_eq!(limites.cuerpo_respuesta, TOPE_CUERPO);
    assert!(
        (1..=16).contains(&limites.simultaneas),
        "simultáneas fuera de rango: {}",
        limites.simultaneas
    );
    assert!(limites.timeout_conexion >= Duration::from_secs(1));
    assert!(limites.timeout_conexion <= limites.timeout_total);
    assert!(
        limites.timeout_total >= Duration::from_secs(30) && limites.timeout_total <= Duration::from_secs(300),
        "timeout total fuera de rango: {:?}",
        limites.timeout_total
    );
}
