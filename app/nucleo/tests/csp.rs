//! Criterio 10: el proxy añade su propia `Content-Security-Policy` a toda respuesta.
//!
//! WebView2 no entrega `Sec-Fetch-*` al manejador del protocolo, así que el proxy no puede
//! distinguir un GET `no-cors` de un iframe de otro origen. El cierre es que no haya marcos de
//! otro origen (`frame-src 'self'`) y que un documento aislado con `sandbox` no pueda cargar nada
//! del portal. Varias CSP se intersectan: añadir una cabecera solo restringe.
//!
//! Los valores van escritos aquí como literales, a propósito: este archivo compila con el código
//! de hoy y falla al ejecutarse. Las constantes públicas nuevas se comprueban en `firmas.rs`.

mod comun;

use std::sync::Arc;

use comun::*;
use nucleo::{pantalla_sin_sesion, Destino, Limites, Proxy, CSP_PANTALLA};

const MARCOS: &str = "frame-src 'self'";
const AISLADO: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; \
                       img-src data: blob:; font-src data:; media-src data: blob:";

/// CSP de cabecera que el Worker pone a todas las páginas, y la de los diagramas de `arch`.
const DEL_PORTAL: &str = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
const DE_ARCH: &str =
    "sandbox allow-scripts allow-downloads allow-popups; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

/// Todas las cabeceras `Content-Security-Policy` de la respuesta, en el orden en que van.
fn csps(respuesta: &http::Response<Vec<u8>>) -> Vec<String> {
    respuesta
        .headers()
        .get_all("content-security-policy")
        .iter()
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
        .collect()
}

fn html(csp: &[&str]) -> Respuesta {
    let mut respuesta = Respuesta::nueva(200, b"<!doctype html><title>x</title><p>hola</p>")
        .con("Content-Type", "text/html; charset=utf-8");
    for valor in csp {
        respuesta = respuesta.con("Content-Security-Policy", valor);
    }
    respuesta
}

/// Las CSP que llegan al webview cuando el servidor contesta `respuesta` a una navegación.
fn csps_de(respuesta: Respuesta) -> Vec<String> {
    let servidor = Servidor::fijo(respuesta);
    csps(&pedir(&proxy(&servidor), navegar("/uuv/")))
}

#[test]
fn c10_una_pagina_html_lleva_la_csp_de_marcos_detras_de_la_del_servidor() {
    let servidor = Servidor::fijo(html(&[DEL_PORTAL]).con("X-Frame-Options", "DENY"));
    let respuesta = pedir(&proxy(&servidor), navegar("/uuv/"));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(csps(&respuesta), [DEL_PORTAL, MARCOS], "la del servidor intacta y la añadida detrás");
    // El resto de la respuesta no cambia.
    assert_eq!(texto(&respuesta), "<!doctype html><title>x</title><p>hola</p>");
    assert_eq!(cabecera(&respuesta, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert_eq!(cabecera(&respuesta, "x-frame-options").as_deref(), Some("DENY"));
}

#[test]
fn c10_varias_csp_del_servidor_se_conservan_intactas_y_en_su_orden() {
    let primera = "default-src 'self'; img-src 'self' data: blob:; frame-src 'self' https://embed.diagrams.net";
    assert_eq!(csps_de(html(&[primera, DEL_PORTAL])), [primera, DEL_PORTAL, MARCOS]);
    assert_eq!(csps_de(html(&[DEL_PORTAL, primera])), [DEL_PORTAL, primera, MARCOS]);
    // No se deduplica ni se fusiona: si el servidor ya manda la misma, van las dos.
    assert_eq!(csps_de(html(&[MARCOS, DEL_PORTAL, MARCOS])), [MARCOS, DEL_PORTAL, MARCOS, MARCOS]);
    // Los espacios y las mayúsculas del valor del servidor no se tocan.
    let rara = "Default-Src  'self' ;Frame-Src https://embed.diagrams.net;";
    assert_eq!(csps_de(html(&[rara])), [rara, MARCOS]);
}

#[test]
fn c10_sin_csp_del_servidor_la_respuesta_lleva_solo_la_anadida() {
    assert_eq!(csps_de(html(&[])), [MARCOS]);
}

#[test]
fn c10_una_csp_con_sandbox_lleva_ademas_la_csp_del_documento_aislado() {
    let casos: &[&[&str]] = &[
        // Las dos reales del portal: diagramas de arch y SVG subidos.
        &[DE_ARCH],
        &["sandbox; default-src 'none'; style-src 'unsafe-inline'"],
        // Posición de la directiva: en medio, al final, sin valor y sin espacios.
        &["default-src 'none'; sandbox allow-scripts; object-src 'none'"],
        &["default-src 'self';sandbox"],
        &["default-src 'self'; sandbox;"],
        &[";; sandbox allow-scripts ;;"],
        &["object-src 'none';   sandbox   ;"],
        // Mayúsculas y separadores.
        &["SANDBOX allow-scripts"],
        &["default-src 'self'; Sandbox allow-popups"],
        &["default-src 'self';\tsAnDbOx\tallow-scripts"],
        // Una cabecera puede traer varias políticas separadas por comas.
        &["default-src 'self', sandbox allow-scripts"],
        &["default-src 'self'; object-src 'none' ,sandbox"],
        // En cualquiera de las cabeceras.
        &[DEL_PORTAL, DE_ARCH],
        &[DE_ARCH, DEL_PORTAL],
        &[DEL_PORTAL, "default-src 'self'", "sandbox"],
    ];
    for caso in casos {
        let mut esperadas: Vec<&str> = caso.to_vec();
        esperadas.extend([MARCOS, AISLADO]);
        assert_eq!(csps_de(html(caso)), esperadas, "CSP del servidor: {caso:?}");
    }
}

#[test]
fn c10_la_palabra_sandbox_fuera_del_nombre_de_una_directiva_no_cuenta() {
    for csp in [
        "default-src 'self'; frame-src https://sandbox.ejemplo.test",
        "default-src 'self'; report-uri /sandbox",
        "script-src 'self' sandbox",
        "x-sandbox allow-scripts",
        "sandboxed allow-scripts",
        "sandbox-x",
        DEL_PORTAL,
    ] {
        assert_eq!(csps_de(html(&[csp])), [csp, MARCOS], "CSP del servidor: {csp:?}");
    }
    // Lo que no es `Content-Security-Policy` no cuenta, ni se confunde con ella.
    let servidor = Servidor::fijo(
        html(&[DEL_PORTAL])
            .con("Content-Security-Policy-Report-Only", "sandbox")
            .con("X-Content-Security-Policy", "sandbox"),
    );
    let respuesta = pedir(&proxy(&servidor), navegar("/uuv/"));
    assert_eq!(csps(&respuesta), [DEL_PORTAL, MARCOS]);
    assert_eq!(cabecera(&respuesta, "content-security-policy-report-only").as_deref(), Some("sandbox"));
}

#[test]
fn c15_una_csp_del_servidor_que_no_se_puede_leer_es_502() {
    // Hilo 5 de CodeRabbit en el PR 72. Un valor con bytes que no son ASCII no se puede
    // entregar al webview tal cual, y no se sabe si traía `sandbox`. `CSP_AISLADO` no sustituye
    // a `sandbox` (el documento correría en el origen de la app), así que no se entrega: 502
    // local, con solo la CSP de marcos. Sustituye a la decisión 19 anterior.
    for ilegible in ["sandbox allow-scripts; report-uri /informe-é", "default-src 'self'; report-uri /informe-é"] {
        for servidor in [html(&[ilegible]), html(&[DEL_PORTAL, ilegible]), html(&[ilegible, DE_ARCH])] {
            let servidor = Servidor::fijo(servidor);
            let respuesta = pedir(&proxy(&servidor), navegar("/uuv/arch/a.html"));
            es_error_local(&respuesta, 502);
            assert_eq!(csps(&respuesta), [MARCOS], "{ilegible:?}");
            assert!(!texto(&respuesta).contains("hola"), "el documento no llega al webview");
        }
    }
    // También en HEAD: la respuesta se decide igual, sin cuerpo.
    let servidor = Servidor::fijo(html(&["sandbox; report-uri /é"]));
    let cabeza = pedir(&proxy(&servidor), peticion("HEAD", "/uuv/arch/a.html").body(Vec::new()).unwrap());
    assert_eq!(cabeza.status().as_u16(), 502);
    assert_eq!(csps(&cabeza), [MARCOS]);
}

#[test]
fn c15_si_el_servidor_nombra_su_csp_en_connection_es_502() {
    // Hilo 5 de CodeRabbit en el PR 72. El proxy quita lo que `Connection` nombra (cabeceras de
    // salto). Si nombra la CSP, la política del servidor (con o sin `sandbox`) no llegaría
    // intacta: 502 local en lugar de entregar el documento sin ella.
    for (csp, connection) in [
        (DE_ARCH, "content-security-policy"),
        (DE_ARCH, "Content-Security-Policy"),
        (DE_ARCH, "close, Content-Security-Policy"),
        (DEL_PORTAL, "Content-Security-Policy"),
    ] {
        let servidor = Servidor::fijo(html(&[csp]).con("Connection", connection));
        let respuesta = pedir(&proxy(&servidor), navegar("/uuv/arch/a.html"));
        es_error_local(&respuesta, 502);
        assert_eq!(csps(&respuesta), [MARCOS], "{csp:?} con Connection: {connection}");
    }
    // Sin CSP del servidor no hay nada que perder: nombrarla en `Connection` no cambia nada.
    let servidor = Servidor::fijo(html(&[]).con("Connection", "Content-Security-Policy"));
    let respuesta = pedir(&proxy(&servidor), navegar("/uuv/"));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(csps(&respuesta), [MARCOS]);
}

#[test]
fn c10_la_csp_se_anade_a_toda_respuesta_del_servidor_no_solo_a_documentos() {
    // Decisión: a todas, sin mirar `Content-Type`, el estado ni el método. El proxy no decide
    // qué va a pintar el webview como documento (un SVG, un tipo ausente o mal puesto, un error
    // con HTML), y en lo que no es un documento la cabecera no hace nada.
    for tipo in [
        Some("application/json; charset=utf-8"),
        Some("image/png"),
        Some("image/svg+xml"),
        Some("application/pdf"),
        Some("text/javascript"),
        Some("text/css"),
        Some("application/octet-stream"),
        Some("TEXT/HTML"),
        Some("application/xhtml+xml"),
        None,
    ] {
        let mut respuesta = Respuesta::nueva(200, b"datos");
        if let Some(tipo) = tipo {
            respuesta = respuesta.con("Content-Type", tipo);
        }
        let servidor = Servidor::fijo(respuesta);
        let recibida = pedir(&proxy(&servidor), get("/api/archivos/?id=1"));
        assert_eq!(csps(&recibida), [MARCOS], "Content-Type {tipo:?}");
        assert_eq!(cabecera(&recibida, "content-type").as_deref(), tipo, "el tipo no cambia");
    }

    for estado in [201u16, 400, 401, 403, 404, 409, 500, 503] {
        let servidor = Servidor::fijo(Respuesta::nueva(estado, b"<h1>error</h1>").con("Content-Type", "text/html"));
        assert_eq!(csps(&pedir(&proxy(&servidor), navegar("/uuv/"))), [MARCOS], "estado {estado}");
    }
    let servidor = Servidor::fijo(Respuesta::nueva(204, b"").sin_longitud());
    let borrado = pedir(&proxy(&servidor), peticion("DELETE", "/api/x").body(Vec::new()).unwrap());
    assert_eq!((borrado.status().as_u16(), csps(&borrado)), (204, vec![MARCOS.to_string()]));

    let servidor = Servidor::fijo(Respuesta::nueva(302, b"").con("Location", "/uuv/"));
    let redireccion = pedir(&proxy(&servidor), navegar("/uuv"));
    assert_eq!((redireccion.status().as_u16(), csps(&redireccion)), (302, vec![MARCOS.to_string()]));
    assert_eq!(cabecera(&redireccion, "location").as_deref(), Some("/uuv/"));

    // También en HEAD y en las escrituras, y la regla de `sandbox` no depende del tipo.
    let servidor = Servidor::fijo(html(&[DE_ARCH]));
    let cabeza = pedir(&proxy(&servidor), peticion("HEAD", "/uuv/arch/a.html").body(Vec::new()).unwrap());
    assert_eq!(csps(&cabeza), [DE_ARCH, MARCOS, AISLADO]);
    let servidor = Servidor::fijo(
        Respuesta::nueva(200, b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>")
            .con("Content-Type", "image/svg+xml")
            .con("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'"),
    );
    let svg = pedir(&proxy(&servidor), get("/api/archivos/?id=2"));
    assert_eq!(csps(&svg), ["sandbox; default-src 'none'; style-src 'unsafe-inline'", MARCOS, AISLADO]);
    let servidor = Servidor::fijo(Respuesta::nueva(201, b"{}").con("Content-Type", "application/json"));
    let escritura = pedir(&proxy(&servidor), peticion("POST", "/api/comentarios/").body(b"{}".to_vec()).unwrap());
    assert_eq!(csps(&escritura), [MARCOS]);
}

#[test]
fn c10_los_errores_locales_llevan_la_csp_de_marcos_y_ninguna_mas() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    let local = |respuesta: http::Response<Vec<u8>>, estado: u16| {
        es_error_local(&respuesta, estado);
        assert_eq!(csps(&respuesta), [MARCOS], "error local {estado}");
    };

    let ajena = peticion("GET", "/api/x").header("Origin", "https://embed.diagrams.net").body(Vec::new()).unwrap();
    local(pedir(&proxy, ajena), 403);
    local(pedir(&proxy, peticion("OPTIONS", "/api/x").body(Vec::new()).unwrap()), 405);
    local(pedir(&proxy, get("/%2e%2e/x")), 400);
    local(pedir(&proxy, navegar("/auth/login")), 404);
    let grande = peticion("PUT", "/api/archivos/").body(vec![0u8; 1024 * 1024 + 1]).unwrap();
    local(pedir(&proxy, grande), 413);
    assert_eq!(servidor.conexiones(), 0, "ninguno de estos llega a la red");

    // 401: sin token, lo que no es una navegación.
    let sin = Proxy::nuevo(servidor.destino(), sin_token(), limites());
    local(pedir(&sin, get("/api/x")), 401);

    // 502: sin conexión, y respuesta del servidor que no se puede entregar.
    let cerrado = Destino::nuevo(&format!("http://127.0.0.1:{}", puerto_cerrado())).unwrap();
    local(pedir(&Proxy::nuevo(cerrado, con_token(), limites()), get("/api/x")), 502);
    let comprimido = Servidor::fijo(
        html(&[DE_ARCH]).con("Content-Encoding", "br"),
    );
    local(pedir(&comun::proxy(&comprimido), navegar("/uuv/arch/a.html")), 502);
    let fuera = Servidor::fijo(Respuesta::nueva(302, b"").con("Location", "https://ejemplo.test/"));
    local(pedir(&comun::proxy(&fuera), navegar("/uuv")), 502);

    // 503: sin hueco libre y sin sitio en la cola. A se queda retenida en el servidor hasta
    // que el test la suelta, así que el hueco está ocupado cuando pide B (hilo 8 de CodeRabbit).
    let compuerta = Compuerta::nueva();
    let lento = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let limites = Limites { simultaneas: 1, en_espera: 0, ..limites() };
    let ocupado = Arc::new(Proxy::nuevo(lento.destino(), con_token(), limites));
    std::thread::scope(|ambito| {
        // Dentro del ámbito: si el test falla, abre antes de esperar a los hilos.
        let _abrir = compuerta.abrir_al_salir();
        let a = ambito.spawn(|| pedir(&ocupado, get("/api/x?n=a")).status().as_u16());
        compuerta.esperar_llegadas(1);
        local(pedir(&ocupado, get("/api/x?n=b")), 503);
        assert_eq!(compuerta.llegadas(), ["/api/x?n=a"], "A seguía ocupando el hueco");
        compuerta.abrir();
        assert_eq!(a.join().unwrap(), 200);
    });
}

#[test]
fn c10_la_pantalla_sin_sesion_conserva_su_csp_y_gana_la_de_marcos() {
    // La función sola no cambia: una CSP, la suya.
    assert_eq!(csps(&pantalla_sin_sesion()), [CSP_PANTALLA]);

    // Servida por el proxy: la suya primero e intacta, y la añadida detrás. La suma sigue sin
    // permitir nada más que el estilo en línea; no se añade la del documento aislado.
    let servidor = Servidor::ok();
    let sin = Proxy::nuevo(servidor.destino(), sin_token(), limites());
    let pantalla = pedir(&sin, navegar("/uuv/"));
    assert_eq!(pantalla.status().as_u16(), 200);
    assert_eq!(pantalla.body(), pantalla_sin_sesion().body());
    assert_eq!(csps(&pantalla), [CSP_PANTALLA, MARCOS]);
    assert_eq!(servidor.conexiones(), 0);

    // Igual cuando la sesión se perdió por un 401 del servidor.
    let rechaza = Servidor::fijo(
        Respuesta::nueva(401, b"{\"error\":\"token\"}").con("WWW-Authenticate", "Bearer error=\"invalid_token\""),
    );
    let proxy = proxy(&rechaza);
    assert_eq!(csps(&pedir(&proxy, get("/api/x"))), [MARCOS], "el 401 del servidor también la lleva");
    assert!(proxy.sesion_perdida());
    assert_eq!(csps(&pedir(&proxy, navegar("/uuv/"))), [CSP_PANTALLA, MARCOS]);
}

#[test]
fn c10_el_servidor_no_puede_suprimir_ni_sustituir_la_csp_anadida() {
    // Una CSP del servidor más laxa no sustituye a la añadida: van las dos y la añadida detrás.
    for laxa in ["frame-src *", "frame-src https://embed.diagrams.net", "default-src *; frame-src * data: blob:"] {
        assert_eq!(csps_de(html(&[laxa])), [laxa, MARCOS], "{laxa:?}");
    }

    // `Connection` puede nombrar cabeceras que el proxy quita por ser de salto. Si nombra la
    // CSP, la política del servidor no puede llegar intacta: eso es el criterio 15 (502 local),
    // en `c15_si_el_servidor_nombra_su_csp_en_connection_es_502`. Nombrar otra cabecera no
    // cambia las CSP.
    assert_eq!(csps_de(html(&[DEL_PORTAL]).con("Connection", "X-Algo")), [DEL_PORTAL, MARCOS]);
    assert_eq!(csps_de(html(&[DE_ARCH]).con("Connection", "x-algo")), [DE_ARCH, MARCOS, AISLADO]);

    // El nombre de la cabecera no distingue mayúsculas.
    let gritona = Respuesta::nueva(200, b"<p>x</p>")
        .con("Content-Type", "text/html")
        .con("CONTENT-SECURITY-POLICY", "sandbox allow-scripts");
    assert_eq!(csps_de(gritona), ["sandbox allow-scripts", MARCOS, AISLADO]);

    // La respuesta nunca queda sin la añadida, y nunca la lleva dos veces por culpa del proxy.
    for respuesta in [html(&[]), html(&[DEL_PORTAL]), html(&[DE_ARCH]), html(&[DE_ARCH, DE_ARCH])] {
        let llegan = csps_de(respuesta.clone());
        let del_servidor = respuesta.cabeceras.len() - 1;
        assert_eq!(llegan.iter().filter(|v| *v == MARCOS).count(), 1, "{llegan:?}");
        assert_eq!(llegan.iter().filter(|v| *v == AISLADO).count(), usize::from(llegan.len() > del_servidor + 1));
        assert_eq!(llegan.get(del_servidor).map(String::as_str), Some(MARCOS), "{llegan:?}");
    }
}

#[test]
fn c10_la_peticion_del_webview_no_cambia_la_csp_anadida() {
    // Lo que decide es la respuesta del servidor; ninguna cabecera de la petición la quita, la
    // cambia ni hace aparecer la del documento aislado.
    let servidor = Servidor::fijo(html(&[DEL_PORTAL]));
    let proxy = proxy(&servidor);
    for (nombre, valor) in [
        ("Content-Security-Policy", "sandbox"),
        ("Content-Security-Policy", "frame-src *"),
        ("Connection", "Content-Security-Policy"),
        ("Sec-Fetch-Dest", "iframe"),
        ("Sec-Fetch-Dest", "image"),
        ("Accept", "image/avif,image/webp,*/*"),
        ("X-Requested-With", "XMLHttpRequest"),
    ] {
        let peticion = peticion("GET", "/uuv/").header(nombre, valor).body(Vec::new()).unwrap();
        assert_eq!(csps(&pedir(&proxy, peticion)), [DEL_PORTAL, MARCOS], "petición con {nombre}: {valor}");
    }
}
