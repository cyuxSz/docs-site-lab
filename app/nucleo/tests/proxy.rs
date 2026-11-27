//! Criterios 1 a 5 del proxy contra un servidor HTTP falso en loopback.

mod comun;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use comun::*;
use nucleo::{pantalla_sin_sesion, FuenteDeToken, Limites, Proxy, Token, CSP_PANTALLA};

// ---------- Criterio 1: alcance ----------

#[test]
fn c1_reenvia_la_ruta_y_la_consulta_tal_cual() {
    let servidor = Servidor::ok();
    let ruta = "/api/comentarios/?proyecto=uuv&pagina=a%2Fb&q=%C3%B1&s=a+b";
    let respuesta = pedir(&proxy(&servidor), get(ruta));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(texto(&respuesta), "ok");
    let recibida = servidor.unica();
    assert_eq!(recibida.metodo, "GET");
    assert_eq!(recibida.destino, ruta);
}

#[test]
fn c1_el_esquema_y_el_host_de_la_peticion_no_cambian_el_destino() {
    let servidor = Servidor::ok();
    let ajeno = Servidor::ok();
    let proxy = proxy(&servidor);
    for uri in [
        format!("http://127.0.0.1:{}/x?y=1", ajeno.puerto),
        format!("https://127.0.0.1:{}/x?y=1", ajeno.puerto),
        format!("portal://usuario:clave@127.0.0.1:{}/x?y=1", ajeno.puerto),
        "https://ejemplo.test/x?y=1".to_string(),
    ] {
        let peticion = http::Request::builder().uri(&uri).body(Vec::new()).unwrap();
        let respuesta = pedir(&proxy, peticion);
        assert_eq!(respuesta.status().as_u16(), 200, "uri {uri}");
    }
    let recibidas = servidor.recibidas();
    assert_eq!(recibidas.len(), 4);
    for recibida in recibidas {
        assert_eq!(recibida.destino, "/x?y=1");
        assert_eq!(recibida.todas("authorization"), [format!("Bearer {TOKEN}")]);
    }
    assert_eq!(ajeno.conexiones(), 0, "nada debe llegar a otro host");
}

#[test]
fn c1_una_ruta_que_podria_salir_del_origen_es_400_local_sin_red() {
    let servidor = Servidor::ok();
    let ajeno = Servidor::ok();
    let proxy = proxy(&servidor);
    for ruta in [
        format!("//127.0.0.1:{}/x", ajeno.puerto),
        format!("/%2F127.0.0.1:{}/x", ajeno.puerto),
        "/a/../b".to_string(),
        "/../auth/login".to_string(),
        "/%2e%2e/auth/login".to_string(),
        "/a/.%2E/auth/login".to_string(),
        "/a/./b".to_string(),
        "/a/%5Cb".to_string(),
        "/%5c%5cejemplo.test/x".to_string(),
        "/a%0d%0ab".to_string(),
    ] {
        let respuesta = pedir(&proxy, get(&ruta));
        es_error_local(&respuesta, 400);
    }
    assert_eq!(servidor.conexiones(), 0, "una ruta rechazada no llega a la red");
    assert_eq!(ajeno.conexiones(), 0);
}

#[test]
fn c1_auth_no_se_reenvia_es_404_local() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    for (metodo, ruta) in [
        ("GET", "/auth"),
        ("GET", "/auth/"),
        ("GET", "/auth/login"),
        ("GET", "/auth/login?next=%2Fuuv%2F"),
        ("GET", "/auth/callback?code=x&state=y"),
        ("GET", "/auth/logout"),
        ("GET", "/auth/signed-out"),
        ("GET", "/auth/app/iniciar?challenge=x"),
        ("POST", "/auth/app/autorizar"),
        ("POST", "/auth/app/canje"),
        ("GET", "/auth/dispositivos"),
        ("GET", "/AUTH/login"),
        ("GET", "/Auth/Logout"),
        ("GET", "/%61uth/login"),
        ("GET", "/%41UTH/login"),
        ("GET", "/auth%2Flogin"),
        ("GET", "/auth//login"),
        ("GET", "/auth/me/x"),
        ("GET", "/auth/mex"),
        ("GET", "/auth/ME"),
        ("POST", "/auth/me"),
        ("DELETE", "/auth/me"),
    ] {
        let respuesta = pedir(&proxy, peticion(metodo, ruta).body(Vec::new()).unwrap());
        assert_eq!(respuesta.status().as_u16(), 404, "{metodo} {ruta}");
        es_error_local(&respuesta, 404);
    }
    assert_eq!(servidor.conexiones(), 0, "/auth/* no llega a la red");
}

#[test]
fn c1_auth_me_y_las_rutas_parecidas_a_auth_si_se_reenvian() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    let rutas = ["/auth/me", "/auth/me/", "/auth/me?x=1", "/authors/", "/uuv/auth/login", "/api/auth"];
    for ruta in rutas {
        assert_eq!(pedir(&proxy, get(ruta)).status().as_u16(), 200, "GET {ruta}");
    }
    let recibidas = servidor.recibidas();
    assert_eq!(recibidas.iter().map(|r| r.destino.as_str()).collect::<Vec<_>>(), rutas);
    for recibida in recibidas {
        assert_eq!(recibida.todas("authorization"), [format!("Bearer {TOKEN}")]);
    }
}

#[test]
fn c1_solo_se_reenvian_los_metodos_del_portal() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    let reenviados = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
    for metodo in reenviados {
        let respuesta = pedir(&proxy, peticion(metodo, "/api/x").body(Vec::new()).unwrap());
        assert_eq!(respuesta.status().as_u16(), 200, "{metodo}");
    }
    assert_eq!(servidor.recibidas().iter().map(|r| r.metodo.as_str()).collect::<Vec<_>>(), reenviados);

    for metodo in ["OPTIONS", "TRACE", "CONNECT", "PROPFIND"] {
        let respuesta = pedir(&proxy, peticion(metodo, "/api/x").body(Vec::new()).unwrap());
        es_error_local(&respuesta, 405);
        assert!(cabecera(&respuesta, "allow").is_some(), "405 con cabecera Allow ({metodo})");
    }
    assert_eq!(servidor.recibidas().len(), reenviados.len(), "un método rechazado no llega a la red");
}

// ---------- Criterio 2: cabeceras de ida ----------

#[test]
fn c2_anade_el_bearer_y_quita_las_credenciales_y_el_origen_del_webview() {
    let servidor = Servidor::ok();
    let peticion = peticion("POST", "/api/comentarios/")
        .header("Cookie", "docs_session=valor-de-cookie; otra=1")
        .header("Origin", "https://portal.localhost")
        .header("Referer", "https://portal.localhost/uuv/?p=potencia")
        .header("Authorization", "Bearer puesto-por-el-js")
        .header("Proxy-Authorization", "Basic dXN1YXJpbzpjbGF2ZQ==")
        .header("Host", "portal.localhost")
        .header("Content-Type", "application/json")
        .body(b"{}".to_vec())
        .unwrap();
    assert_eq!(pedir(&proxy(&servidor), peticion).status().as_u16(), 200);
    let recibida = servidor.unica();
    assert_eq!(recibida.todas("authorization"), [format!("Bearer {TOKEN}")]);
    for quitada in ["cookie", "origin", "referer", "proxy-authorization"] {
        assert!(!recibida.tiene(quitada), "no debe reenviarse {quitada}: {:?}", recibida.todas(quitada));
    }
    assert_eq!(recibida.todas("host"), [format!("127.0.0.1:{}", servidor.puerto)]);
    let todo = format!("{:?}", recibida.cabeceras);
    assert!(!todo.contains("puesto-por-el-js") && !todo.contains("valor-de-cookie"), "{todo}");
}

#[test]
fn c2_quita_las_cabeceras_de_salto_y_recalcula_content_length() {
    let servidor = Servidor::ok();
    let peticion = peticion("PUT", "/api/hardware/")
        .header("Connection", "keep-alive, X-Solo-Este-Salto")
        .header("Keep-Alive", "timeout=5")
        .header("TE", "trailers")
        .header("Trailer", "X-Cola")
        .header("Upgrade", "websocket")
        .header("X-Solo-Este-Salto", "1")
        .header("Content-Length", "999")
        .header("Content-Type", "text/plain")
        .body(b"hola".to_vec())
        .unwrap();
    assert_eq!(pedir(&proxy(&servidor), peticion).status().as_u16(), 200);
    let recibida = servidor.unica();
    for quitada in ["keep-alive", "te", "trailer", "upgrade", "x-solo-este-salto"] {
        assert!(!recibida.tiene(quitada), "no debe reenviarse {quitada}");
    }
    if let Some(conexion) = recibida.una("connection") {
        let conexion = conexion.to_ascii_lowercase();
        assert!(conexion == "close" || conexion == "keep-alive", "Connection reenviada: {conexion}");
    }
    assert_eq!(recibida.cuerpo, b"hola");
    assert_eq!(recibida.todas("content-length"), ["4"]);
    assert!(!recibida.tiene("transfer-encoding"), "el cuerpo va con Content-Length, no troceado");
}

#[test]
fn c2_conserva_el_resto_de_cabeceras_y_el_cuerpo_exacto() {
    let servidor = Servidor::ok();
    let cuerpo = "{\"texto\":\"señal ñ 🚀\",\"version\":7}".as_bytes().to_vec();
    let peticion = peticion("POST", "/api/comentarios/?proyecto=uuv")
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "application/json")
        .header("Accept-Language", "es-MX,es;q=0.9")
        .header("X-Propia", "valor propio")
        .body(cuerpo.clone())
        .unwrap();
    assert_eq!(pedir(&proxy(&servidor), peticion).status().as_u16(), 200);
    let recibida = servidor.unica();
    assert_eq!(recibida.metodo, "POST");
    assert_eq!(recibida.cuerpo, cuerpo);
    assert_eq!(recibida.todas("content-type"), ["application/json; charset=utf-8"]);
    assert_eq!(recibida.todas("accept"), ["application/json"]);
    assert_eq!(recibida.todas("accept-language"), ["es-MX,es;q=0.9"]);
    assert_eq!(recibida.todas("x-propia"), ["valor propio"]);
    assert_eq!(recibida.todas("content-length"), [cuerpo.len().to_string()]);
}

#[test]
fn c2_un_cuerpo_binario_llega_identico() {
    let servidor = Servidor::ok();
    let cuerpo: Vec<u8> = (0..300_000u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8).collect();
    let peticion = peticion("PUT", "/api/archivos/?proyecto=uuv&id=abc")
        .header("Content-Type", "application/octet-stream")
        .body(cuerpo.clone())
        .unwrap();
    assert_eq!(pedir(&proxy(&servidor), peticion).status().as_u16(), 200);
    let recibida = servidor.unica();
    assert_eq!(recibida.cuerpo.len(), cuerpo.len());
    assert!(recibida.cuerpo == cuerpo, "el cuerpo binario no coincide");
    assert_eq!(recibida.todas("content-type"), ["application/octet-stream"]);
}

#[test]
fn c2_no_reenvia_el_accept_encoding_del_webview() {
    let servidor = Servidor::ok();
    let peticion = peticion("GET", "/uuv/")
        .header("Accept-Encoding", "gzip, deflate, br, zstd")
        .body(Vec::new())
        .unwrap();
    assert_eq!(pedir(&proxy(&servidor), peticion).status().as_u16(), 200);
    for valor in servidor.unica().todas("accept-encoding") {
        for codificacion in valor.split(',') {
            let codificacion = codificacion.split(';').next().unwrap().trim().to_ascii_lowercase();
            assert!(
                codificacion == "gzip" || codificacion == "identity",
                "el proxy solo puede pedir lo que sabe descomprimir, no {codificacion:?}"
            );
        }
    }
}

#[test]
fn c2_sin_token_no_hay_peticion_de_red() {
    let servidor = Servidor::ok();
    let proxy = Proxy::nuevo(servidor.destino(), sin_token(), limites());

    es_error_local(&pedir(&proxy, get("/api/comentarios/?proyecto=uuv")), 401);
    es_error_local(&pedir(&proxy, get("/uuv/")), 401);
    es_error_local(&pedir(&proxy, get("/auth/me")), 401);
    let escritura = peticion("POST", "/api/comentarios/")
        .header("Accept", "text/html")
        .body(b"{}".to_vec())
        .unwrap();
    es_error_local(&pedir(&proxy, escritura), 401);

    // Una navegación (GET que acepta HTML) recibe la pantalla «sin sesión».
    for ruta in ["/", "/uuv/", "/uuv/electronica/?p=potencia", "/api/comentarios/"] {
        let respuesta = pedir(&proxy, navegar(ruta));
        assert_eq!(respuesta.status().as_u16(), 200, "navegación a {ruta}");
        assert_eq!(respuesta.body(), pantalla_sin_sesion().body());
        assert_eq!(cabecera(&respuesta, "content-security-policy").as_deref(), Some(CSP_PANTALLA));
        assert!(cabecera(&respuesta, "content-type").unwrap_or_default().starts_with("text/html"));
    }
    // /auth/* sigue siendo 404 también sin token.
    es_error_local(&pedir(&proxy, navegar("/auth/login")), 404);

    assert_eq!(servidor.conexiones(), 0, "sin token no se abre ninguna conexión");
    assert!(!proxy.sesion_perdida(), "no tener token no es haber perdido la sesión");
}

struct FuenteCambiante(Mutex<Option<Token>>);

impl FuenteDeToken for FuenteCambiante {
    fn token(&self) -> Option<Token> {
        self.0.lock().unwrap().clone()
    }
}

#[test]
fn c2_la_fuente_de_token_se_consulta_en_cada_peticion() {
    let servidor = Servidor::ok();
    let fuente = Arc::new(FuenteCambiante(Mutex::new(None)));
    let proxy = Proxy::nuevo(servidor.destino(), fuente.clone(), limites());

    es_error_local(&pedir(&proxy, get("/api/x")), 401);
    assert_eq!(servidor.conexiones(), 0);

    *fuente.0.lock().unwrap() = Some(token());
    assert_eq!(pedir(&proxy, get("/api/x")).status().as_u16(), 200);
    assert_eq!(servidor.unica().todas("authorization"), [format!("Bearer {TOKEN}")]);

    *fuente.0.lock().unwrap() = None;
    es_error_local(&pedir(&proxy, get("/api/x")), 401);
    assert_eq!(servidor.recibidas().len(), 1);
}

// ---------- Criterio 3: respuesta ----------

#[test]
fn c3_pasa_el_estado_el_cuerpo_y_las_cabeceras() {
    for estado in [200u16, 201, 400, 403, 404, 409, 429, 500, 503] {
        let cuerpo = format!("{{\"error\":\"versión\",\"estado\":{estado}}}");
        let servidor = Servidor::fijo(
            Respuesta::nueva(estado, cuerpo.as_bytes())
                .con("Content-Type", "application/json; charset=utf-8")
                .con("Cache-Control", "private, no-store")
                .con("Content-Security-Policy", "default-src 'self'; frame-src https://embed.diagrams.net")
                .con("X-Content-Type-Options", "nosniff")
                .con("Retry-After", "7")
                .con("X-Propia", "desde el servidor"),
        );
        let respuesta = pedir(&proxy(&servidor), get("/api/x"));
        assert_eq!(respuesta.status().as_u16(), estado);
        assert_eq!(texto(&respuesta), cuerpo);
        assert_eq!(cabecera(&respuesta, "content-type").as_deref(), Some("application/json; charset=utf-8"));
        assert_eq!(cabecera(&respuesta, "cache-control").as_deref(), Some("private, no-store"));
        assert_eq!(
            cabecera(&respuesta, "content-security-policy").as_deref(),
            Some("default-src 'self'; frame-src https://embed.diagrams.net")
        );
        assert_eq!(cabecera(&respuesta, "x-content-type-options").as_deref(), Some("nosniff"));
        assert_eq!(cabecera(&respuesta, "retry-after").as_deref(), Some("7"));
        assert_eq!(cabecera(&respuesta, "x-propia").as_deref(), Some("desde el servidor"));
    }
}

#[test]
fn c3_pasa_un_cuerpo_binario_y_una_respuesta_vacia() {
    let binario: Vec<u8> = (0..200_000u32).map(|i| (i.wrapping_mul(40_503) >> 7) as u8).collect();
    let servidor = Servidor::fijo(Respuesta::nueva(200, &binario).con("Content-Type", "application/pdf"));
    let respuesta = pedir(&proxy(&servidor), get("/api/archivos/?id=1"));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert!(respuesta.body() == &binario, "el cuerpo binario de la respuesta no coincide");

    let servidor = Servidor::fijo(Respuesta::nueva(204, b"").sin_longitud());
    let respuesta = pedir(&proxy(&servidor), peticion("DELETE", "/api/x").body(Vec::new()).unwrap());
    assert_eq!(respuesta.status().as_u16(), 204);
    assert!(respuesta.body().is_empty());

    // Sin Content-Length: el cuerpo acaba al cerrar la conexión.
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"hasta el cierre").sin_longitud());
    assert_eq!(texto(&pedir(&proxy(&servidor), get("/x"))), "hasta el cierre");
}

#[test]
fn c3_conserva_las_cabeceras_repetidas() {
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"ok").con("X-Doble", "uno").con("X-Doble", "dos"));
    let respuesta = pedir(&proxy(&servidor), get("/x"));
    let valores: Vec<String> = respuesta
        .headers()
        .get_all("x-doble")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect();
    assert_eq!(valores.join(", "), "uno, dos");
}

#[test]
fn c3_quita_set_cookie_y_las_cabeceras_de_salto() {
    let servidor = Servidor::fijo(
        Respuesta::nueva(200, b"ok")
            .con("Set-Cookie", "docs_session=x; Path=/; HttpOnly; Secure")
            .con("Set-Cookie", "otra=1")
            .con("Keep-Alive", "timeout=5")
            .con("Proxy-Authenticate", "Basic")
            .con("Trailer", "X-Cola")
            .con("Upgrade", "h2c")
            .con("X-Queda", "si"),
    );
    // `pedir` comprueba que no llegan Set-Cookie ni cabeceras de salto.
    let respuesta = pedir(&proxy(&servidor), get("/x"));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(texto(&respuesta), "ok");
    assert_eq!(cabecera(&respuesta, "x-queda").as_deref(), Some("si"));
}

#[test]
fn c3_entrega_descomprimida_una_respuesta_gzip() {
    let original = "línea de texto que se repite en la respuesta comprimida\n".repeat(40);
    let plano = original.clone().into_bytes();
    let servidor = Servidor::nuevo(move |recibida| {
        let acepta_gzip = recibida
            .todas("accept-encoding")
            .iter()
            .any(|v| v.to_ascii_lowercase().contains("gzip"));
        let base = if acepta_gzip {
            Respuesta::nueva(200, &gzip(&plano)).con("Content-Encoding", "gzip")
        } else {
            Respuesta::nueva(200, &plano)
        };
        base.con("Content-Type", "text/html; charset=utf-8").con("Vary", "Accept-Encoding")
    });
    // `pedir` comprueba que no queda Content-Encoding y que Content-Length, si viene, cuadra.
    let respuesta = pedir(&proxy(&servidor), navegar("/uuv/"));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(texto(&respuesta), original);
    assert_eq!(cabecera(&respuesta, "content-type").as_deref(), Some("text/html; charset=utf-8"));
}

#[test]
fn c3_una_codificacion_que_no_sabe_descomprimir_es_502() {
    for codificacion in ["br", "zstd", "deflate", "gzip, br"] {
        let servidor = Servidor::fijo(
            Respuesta::nueva(200, b"\x0b\x02\x80hola\x03").con("Content-Encoding", codificacion),
        );
        es_error_local(&pedir(&proxy(&servidor), get("/x")), 502);
    }
}

#[test]
fn c3_no_sigue_redirecciones_y_una_relativa_pasa() {
    for estado in [301u16, 302, 303, 307, 308] {
        for destino in ["/uuv/", "/uuv/electronica/?p=potencia#seccion", "/"] {
            let servidor = Servidor::fijo(Respuesta::nueva(estado, b"").con("Location", destino));
            let respuesta = pedir(&proxy(&servidor), get("/uuv"));
            assert_eq!(respuesta.status().as_u16(), estado);
            assert_eq!(cabecera(&respuesta, "location").as_deref(), Some(destino));
            assert_eq!(servidor.recibidas().len(), 1, "la redirección la sigue el webview, no el proxy");
        }
    }
}

/// Servidor que redirige a lo que devuelva `destino` a partir de su propio `Host`.
fn redirige_a(destino: fn(&str) -> String) -> Servidor {
    Servidor::nuevo(move |recibida| {
        let host = recibida.una("host").expect("la petición debe llevar Host");
        Respuesta::nueva(302, b"").con("Location", &destino(&host))
    })
}

#[test]
fn c3_una_redireccion_absoluta_al_propio_origen_se_vuelve_relativa() {
    let casos: [(fn(&str) -> String, &str); 4] = [
        (|host| format!("http://{host}/uuv/?p=1#f"), "/uuv/?p=1#f"),
        (|host| format!("http://{host}/"), "/"),
        (|host| format!("http://{host}"), "/"),
        (|host| format!("http://{host}?p=1"), "/?p=1"),
    ];
    for (destino, esperado) in casos {
        let servidor = redirige_a(destino);
        let respuesta = pedir(&proxy(&servidor), get("/x"));
        assert_eq!(respuesta.status().as_u16(), 302);
        assert_eq!(cabecera(&respuesta, "location").as_deref(), Some(esperado));
        assert_eq!(servidor.recibidas().len(), 1);
    }
}

#[test]
fn c3_una_redireccion_fuera_del_origen_es_502() {
    let casos: [fn(&str) -> String; 16] = [
        |_| "https://ejemplo.test/x".into(),
        |_| "http://ejemplo.test/x".into(),
        |_| "//ejemplo.test/x".into(),
        |_| "/\\ejemplo.test/x".into(),
        |_| "\\\\ejemplo.test/x".into(),
        |_| "/a\\b".into(),
        |_| "javascript:alert(1)".into(),
        |_| "data:text/html,hola".into(),
        |_| "vanttec-docs://auth?code=x".into(),
        |_| "relativa/sin/barra".into(),
        |_| "".into(),
        |host| format!("https://{host}/x"),
        |host| format!("http://{host}.ejemplo.test/x"),
        |host| format!("http://{host}0/x"),
        |host| format!("http://{host}@ejemplo.test/x"),
        |host| format!("http://usuario@{host}/x"),
    ];
    for destino in casos {
        let servidor = redirige_a(destino);
        let respuesta = pedir(&proxy(&servidor), get("/x"));
        es_error_local(&respuesta, 502);
        assert!(cabecera(&respuesta, "location").is_none(), "un 502 local no lleva Location");
        assert_eq!(servidor.recibidas().len(), 1, "no se sigue la redirección ({:?})", destino("HOST"));
    }
}

#[test]
fn c3_un_401_del_servidor_pasa_y_marca_la_sesion_perdida() {
    for desafio in ["Bearer", "bearer realm=\"docs\""] {
        let servidor = Servidor::fijo(
            Respuesta::nueva(401, "{\"error\":\"Token inválido\"}".as_bytes())
                .con("Content-Type", "application/json")
                .con("WWW-Authenticate", desafio)
                .con("Cache-Control", "no-store"),
        );
        let proxy = proxy(&servidor);
        assert!(!proxy.sesion_perdida());

        let respuesta = pedir(&proxy, get("/api/comentarios/"));
        assert_eq!(respuesta.status().as_u16(), 401);
        assert_eq!(texto(&respuesta), "{\"error\":\"Token inválido\"}");
        assert!(proxy.sesion_perdida(), "un 401 con WWW-Authenticate: {desafio} marca la sesión perdida");

        // Desde ese momento el token rechazado no vuelve a salir: todo se responde en local.
        es_error_local(&pedir(&proxy, get("/api/comentarios/")), 401);
        let pantalla = pedir(&proxy, navegar("/uuv/"));
        assert_eq!(pantalla.status().as_u16(), 200);
        assert_eq!(pantalla.body(), pantalla_sin_sesion().body());
        assert_eq!(servidor.recibidas().len(), 1, "tras perder la sesión no hay más peticiones de red");
    }
}

#[test]
fn c3_otros_errores_del_servidor_no_marcan_la_sesion_perdida() {
    let casos = [
        Respuesta::nueva(401, b"{\"login\":null}"),
        Respuesta::nueva(401, b"x").con("WWW-Authenticate", "Basic realm=\"x\""),
        Respuesta::nueva(403, b"{\"error\":\"Sin acceso\"}").con("WWW-Authenticate", "Bearer"),
        Respuesta::nueva(400, b"{\"error\":\"x\"}"),
        Respuesta::nueva(500, b"x"),
    ];
    for caso in casos {
        let estado = caso.estado;
        let servidor = Servidor::fijo(caso);
        let proxy = proxy(&servidor);
        assert_eq!(pedir(&proxy, get("/api/x")).status().as_u16(), estado);
        assert!(!proxy.sesion_perdida(), "un {estado} así no es un token rechazado");
        assert_eq!(pedir(&proxy, get("/api/x")).status().as_u16(), estado);
        assert_eq!(servidor.recibidas().len(), 2);
    }
}

#[test]
fn c3_un_error_de_red_es_502_json_sin_detalles_internos() {
    let puerto = puerto_cerrado();
    let destino = nucleo::Destino::nuevo(&format!("http://127.0.0.1:{puerto}")).unwrap();
    let proxy = Proxy::nuevo(destino, con_token(), limites());
    for peticion in [get("/api/x"), navegar("/uuv/")] {
        let respuesta = pedir(&proxy, peticion);
        es_error_local(&respuesta, 502);
        let cuerpo = texto(&respuesta).to_ascii_lowercase();
        for interno in [puerto.to_string().as_str(), "127.0.0.1", "os error", "connection", "ureq", "refused", "tcp"] {
            assert!(!cuerpo.contains(interno), "el 502 enseña detalles internos ({interno}): {cuerpo}");
        }
    }
    assert!(!proxy.sesion_perdida(), "un fallo de red no es una sesión perdida");
}

#[test]
fn c3_una_respuesta_cortada_a_medias_es_502() {
    let servidor = Servidor::fijo(
        Respuesta::nueva(200, b"solo llega el principio").con("Content-Length", "5000").sin_longitud(),
    );
    es_error_local(&pedir(&proxy(&servidor), get("/x")), 502);
}

// ---------- Criterio 4: límites ----------

fn con_limites(servidor: &Servidor, limites: Limites) -> Proxy {
    Proxy::nuevo(servidor.destino(), con_token(), limites)
}

#[test]
fn c4_un_cuerpo_de_peticion_por_encima_del_tope_es_413_sin_red() {
    let servidor = Servidor::ok();
    let proxy = con_limites(&servidor, Limites { cuerpo_peticion: 1000, ..limites() });

    let justo = peticion("PUT", "/api/archivos/").body(vec![7u8; 1000]).unwrap();
    assert_eq!(pedir(&proxy, justo).status().as_u16(), 200);
    assert_eq!(servidor.unica().cuerpo.len(), 1000);

    let pasado = peticion("PUT", "/api/archivos/").body(vec![7u8; 1001]).unwrap();
    es_error_local(&pedir(&proxy, pasado), 413);
    assert_eq!(servidor.recibidas().len(), 1, "el cuerpo demasiado grande no llega a la red");
}

#[test]
fn c4_una_respuesta_por_encima_del_tope_es_502() {
    let tope = Limites { cuerpo_respuesta: 1000, ..limites() };

    let servidor = Servidor::fijo(Respuesta::nueva(200, &[b'a'; 1000]));
    let respuesta = pedir(&con_limites(&servidor, tope.clone()), get("/x"));
    assert_eq!(respuesta.status().as_u16(), 200);
    assert_eq!(respuesta.body().len(), 1000);

    let servidor = Servidor::fijo(Respuesta::nueva(200, &[b'a'; 1001]));
    es_error_local(&pedir(&con_limites(&servidor, tope.clone()), get("/x")), 502);

    let servidor = Servidor::fijo(Respuesta::nueva(200, &[b'a'; 5000]).sin_longitud());
    es_error_local(&pedir(&con_limites(&servidor, tope.clone()), get("/x")), 502);

    // También cuenta el cuerpo de una respuesta de error del servidor.
    let servidor = Servidor::fijo(Respuesta::nueva(500, &[b'a'; 5000]));
    es_error_local(&pedir(&con_limites(&servidor, tope.clone()), get("/x")), 502);

    // El tope se mide sobre el cuerpo ya descomprimido: 39 bytes en la red, 3000 al abrirlos.
    let servidor = Servidor::nuevo(|recibida| {
        let acepta_gzip = recibida.todas("accept-encoding").iter().any(|v| v.contains("gzip"));
        if acepta_gzip {
            Respuesta::nueva(200, &GZIP_3000_A).con("Content-Encoding", "gzip")
        } else {
            Respuesta::nueva(200, &[b'a'; 3000])
        }
    });
    es_error_local(&pedir(&con_limites(&servidor, tope), get("/x")), 502);
}

#[test]
fn c4_un_servidor_que_no_contesta_es_502_al_vencer_el_timeout() {
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"tarde").tras(Duration::from_secs(6)));
    let proxy = con_limites(
        &servidor,
        Limites {
            timeout_conexion: Duration::from_millis(500),
            timeout_total: Duration::from_millis(700),
            ..limites()
        },
    );
    let inicio = Instant::now();
    let respuesta = pedir(&proxy, get("/api/x"));
    let tardo = inicio.elapsed();
    es_error_local(&respuesta, 502);
    assert!(tardo < Duration::from_secs(4), "el timeout de 0,7 s no se aplicó: tardó {tardo:?}");
    assert!(!proxy.sesion_perdida());
}

#[test]
fn c4_no_hay_mas_peticiones_simultaneas_que_el_maximo() {
    // Hilo 9 de CodeRabbit en el PR 72: la contención se establece y se observa antes de
    // comprobar nada. Dos peticiones retenidas en el servidor ocupan los dos huecos y las otras
    // cuatro están en la cola (gancho `Proxy::en_cola`, criterio 17) sin haber llegado a la red.
    let compuerta = Compuerta::nueva();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let proxy = Arc::new(con_limites(&servidor, Limites { simultaneas: 2, ..limites() }));
    let estados: Vec<u16> = std::thread::scope(|ambito| {
        // Dentro del ámbito: si el test falla, abre antes de esperar a los hilos.
        let _abrir = compuerta.abrir_al_salir();
        let hilos: Vec<_> = (0..6)
            .map(|i| {
                let proxy = proxy.clone();
                ambito.spawn(move || pedir(&proxy, get(&format!("/api/x?n={i}"))).status().as_u16())
            })
            .collect();
        compuerta.esperar_llegadas(2);
        esperar_hasta("las otras cuatro esperan en la cola", || proxy.en_cola() == 4);
        assert_eq!(compuerta.llegadas().len(), 2, "con los dos huecos ocupados no llega ninguna más");
        assert_eq!(servidor.max_activas(), 2);
        compuerta.abrir();
        hilos.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert_eq!(estados, [200; 6], "las peticiones que esperan su turno también se atienden");
    assert_eq!(servidor.recibidas().len(), 6);
    assert_eq!(servidor.max_activas(), 2, "nunca más de 2 a la vez");
    assert_eq!(proxy.en_cola(), 0, "la cola queda vacía");
}

#[test]
fn c4_si_la_espera_por_un_hueco_vence_es_503_local() {
    // Hilo 9 de CodeRabbit en el PR 72. El plazo de la espera es `timeout_total`, el mismo que
    // el de la petición, así que solo puede vencer detrás de dos: A ocupa el hueco; B y C
    // esperan (observado con `en_cola`); al soltar A, una de las dos (X) toma el hueco y se
    // queda retenida; la otra (Y) se rinde al cumplir su plazo, sin llegar a la red.
    let total = Duration::from_millis(1500);
    let compuerta = Compuerta::nueva();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let proxy = Arc::new(con_limites(&servidor, Limites { simultaneas: 1, timeout_total: total, ..limites() }));
    std::thread::scope(|ambito| {
        // Dentro del ámbito: si el test falla, abre antes de esperar a los hilos.
        let _abrir = compuerta.abrir_al_salir();
        let a = ambito.spawn(|| pedir(&proxy, get("/api/x?n=a")).status().as_u16());
        compuerta.esperar_llegadas(1);
        let (tx, rx) = std::sync::mpsc::channel();
        for nombre in ["b", "c"] {
            let (tx, proxy) = (tx.clone(), &proxy);
            ambito.spawn(move || {
                let inicio = Instant::now();
                let respuesta = pedir(proxy, get(&format!("/api/x?n={nombre}")));
                let _ = tx.send((nombre, respuesta, inicio.elapsed()));
            });
        }
        esperar_hasta("B y C esperan un hueco", || proxy.en_cola() == 2);
        // Margen, no prueba de estado: X empieza su petición (y su plazo de red) al menos un
        // tercio del plazo después de que Y empezara a esperar, así que Y vence antes que X.
        std::thread::sleep(total / 3);
        compuerta.soltar(1);
        assert_eq!(a.join().unwrap(), 200);
        let x = compuerta.esperar_llegadas(2)[1].clone();

        let (y, respuesta, tardo) = rx.recv_timeout(total + PLAZO).expect("la segunda en la cola debe rendirse");
        assert!(!x.ends_with(&format!("n={y}")), "la que se rinde no es la que tomó el hueco");
        es_error_local(&respuesta, 503);
        assert!(tardo >= total, "se rinde al cumplir el plazo, no antes: tardó {tardo:?}");
        assert_eq!(compuerta.llegadas().len(), 2, "la que se rinde no llega a la red");

        compuerta.abrir();
        let (_, respuesta, _) = rx.recv_timeout(PLAZO).expect("X debe responder");
        assert_eq!(respuesta.status().as_u16(), 200);
    });
    assert_eq!(servidor.recibidas().len(), 2, "la petición que se rinde no llega a la red");
    assert_eq!(servidor.max_activas(), 1);
    assert_eq!(proxy.en_cola(), 0);
}

#[test]
fn c4_el_proxy_se_comparte_entre_hilos() {
    fn es_send_y_sync<T: Send + Sync + 'static>() {}
    es_send_y_sync::<Proxy>();
}

// ---------- Criterio 9: origen de la petición ----------

/// Petición con las cabeceras que pone el navegador (`Origin`, `Sec-Fetch-*`…).
fn con_cabeceras(metodo: &str, ruta: &str, cabeceras: &[(&str, &str)]) -> http::Request<Vec<u8>> {
    let mut peticion = peticion(metodo, ruta);
    for (nombre, valor) in cabeceras {
        peticion = peticion.header(*nombre, *valor);
    }
    let cuerpo = if metodo == "GET" || metodo == "HEAD" { Vec::new() } else { b"a=1".to_vec() };
    peticion.body(cuerpo).unwrap()
}

/// Un rechazo por origen: 403 JSON local, sin nada que abra la respuesta a otro origen.
/// En un HEAD el cuerpo va vacío: se reconoce por el caso, que empieza por el método.
fn es_rechazo_por_origen(respuesta: &http::Response<Vec<u8>>, caso: &str) {
    assert_eq!(respuesta.status().as_u16(), 403, "{caso}");
    if caso.starts_with("HEAD ") {
        assert!(respuesta.body().is_empty(), "{caso}: un HEAD no lleva cuerpo");
        let tipo = cabecera(respuesta, "content-type").unwrap_or_default();
        assert!(tipo.starts_with("application/json"), "{caso}: content-type {tipo:?}");
    } else {
        es_error_local(respuesta, 403);
    }
    for abierta in ["access-control-allow-origin", "access-control-allow-credentials", "location"] {
        assert!(cabecera(respuesta, abierta).is_none(), "{caso}: el 403 no lleva {abierta}");
    }
}

/// Fuente que cuenta cuántas veces se le pide el token.
struct FuenteContada(std::sync::atomic::AtomicUsize);

impl FuenteDeToken for FuenteContada {
    fn token(&self) -> Option<Token> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Some(token())
    }
}

#[test]
fn c9_un_origin_que_no_es_el_de_la_app_es_403_local_sin_red() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    for origen in [
        "https://embed.diagrams.net",
        "null",
        "",
        "https://ejemplo.test",
        "http://portal.localhost",
        "https://portal.localhost:8443",
        "https://portal.localhost/",
        "https://portal.localhost.ejemplo.test",
        "https://xportal.localhost",
        "https://PORTAL.LOCALHOST",
        "portal://localhost.ejemplo.test",
        "portal://otro",
        "https://portal.localhost, https://embed.diagrams.net",
    ] {
        for (metodo, ruta) in
            [("GET", "/api/comentarios/?proyecto=uuv"), ("POST", "/api/comentarios/"), ("HEAD", "/uuv/")]
        {
            let caso = format!("{metodo} {ruta} con Origin {origen:?}");
            let peticion =
                con_cabeceras(metodo, ruta, &[("Origin", origen), ("Content-Type", "text/plain")]);
            es_rechazo_por_origen(&pedir(&proxy, peticion), &caso);
        }
    }
    // Un `Sec-Fetch-Site` favorable no salva un `Origin` ajeno.
    let peticion = con_cabeceras(
        "POST",
        "/api/comentarios/",
        &[("Origin", "null"), ("Sec-Fetch-Site", "same-origin"), ("Content-Type", "text/plain")],
    );
    es_rechazo_por_origen(&pedir(&proxy, peticion), "Origin null con Sec-Fetch-Site same-origin");
    // Dos cabeceras `Origin`: basta una ajena.
    let peticion = con_cabeceras(
        "POST",
        "/api/comentarios/",
        &[("Origin", "https://portal.localhost"), ("Origin", "https://embed.diagrams.net")],
    );
    es_rechazo_por_origen(&pedir(&proxy, peticion), "Origin repetido");

    assert_eq!(servidor.conexiones(), 0, "una petición de otro origen no abre ninguna conexión");
}

#[test]
fn c9_sec_fetch_site_de_otro_sitio_es_403_local_sin_red() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    // (método, Sec-Fetch-Site, Sec-Fetch-Mode, Sec-Fetch-Dest)
    for (metodo, sitio, modo, destino) in [
        ("GET", "cross-site", "no-cors", "image"),
        ("GET", "cross-site", "no-cors", "script"),
        ("GET", "cross-site", "no-cors", "style"),
        ("GET", "cross-site", "cors", "empty"),
        ("GET", "same-site", "no-cors", "image"),
        ("GET", "same-site", "cors", "empty"),
        ("POST", "cross-site", "no-cors", "empty"),
        ("POST", "same-site", "no-cors", "empty"),
        ("HEAD", "cross-site", "no-cors", "empty"),
        // Un iframe ajeno que se navega a sí mismo hacia el portal.
        ("GET", "cross-site", "navigate", "iframe"),
        ("GET", "cross-site", "navigate", "frame"),
        ("GET", "cross-site", "navigate", "embed"),
        ("GET", "cross-site", "navigate", "object"),
        ("GET", "cross-site", "nested-navigate", "document"),
        // Un formulario enviado desde otro sitio al marco principal.
        ("POST", "cross-site", "navigate", "document"),
        ("POST", "same-site", "navigate", "document"),
        // La excepción de navegación exige GET y el destino `document`.
        ("GET", "cross-site", "navigate", "empty"),
        ("HEAD", "cross-site", "navigate", "document"),
        // Sin distinguir mayúsculas, y un valor desconocido o vacío se rechaza.
        ("GET", "Cross-Site", "no-cors", "image"),
        ("GET", "otro-valor", "no-cors", "image"),
        ("GET", "", "no-cors", "image"),
    ] {
        let caso = format!("{metodo} con Sec-Fetch-Site {sitio:?}, modo {modo}, destino {destino}");
        let peticion = con_cabeceras(
            metodo,
            "/api/comentarios/?proyecto=uuv",
            &[
                ("Sec-Fetch-Site", sitio),
                ("Sec-Fetch-Mode", modo),
                ("Sec-Fetch-Dest", destino),
                ("Accept", "text/html,*/*"),
                ("Content-Type", "text/plain"),
            ],
        );
        es_rechazo_por_origen(&pedir(&proxy, peticion), &caso);
    }
    // Ni el `Origin` de la app ni un `Referer` de la app salvan un `Sec-Fetch-Site` de otro sitio.
    let peticion = con_cabeceras(
        "POST",
        "/api/comentarios/",
        &[
            ("Origin", "https://portal.localhost"),
            ("Referer", "https://portal.localhost/uuv/"),
            ("Sec-Fetch-Site", "cross-site"),
            ("Sec-Fetch-Mode", "cors"),
            ("Sec-Fetch-Dest", "empty"),
        ],
    );
    es_rechazo_por_origen(&pedir(&proxy, peticion), "Origin propio con Sec-Fetch-Site cross-site");
    // Una navegación de primer nivel desde otro sitio que además trae `Origin` no entra en la
    // excepción.
    let peticion = con_cabeceras(
        "GET",
        "/uuv/",
        &[
            ("Origin", "https://portal.localhost"),
            ("Sec-Fetch-Site", "cross-site"),
            ("Sec-Fetch-Mode", "navigate"),
            ("Sec-Fetch-Dest", "document"),
        ],
    );
    es_rechazo_por_origen(&pedir(&proxy, peticion), "navegación de otro sitio con Origin");
    // `Sec-Fetch-Site` repetido: basta un valor de otro sitio.
    let peticion = con_cabeceras(
        "GET",
        "/api/x",
        &[("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Site", "cross-site")],
    );
    es_rechazo_por_origen(&pedir(&proxy, peticion), "Sec-Fetch-Site repetido");

    assert_eq!(servidor.conexiones(), 0, "una petición de otro sitio no abre ninguna conexión");
}

#[test]
fn c9_el_origen_se_comprueba_antes_que_el_metodo_la_ruta_auth_el_token_y_el_cuerpo() {
    let servidor = Servidor::ok();
    let ajeno: [(&str, &str); 2] =
        [("Origin", "https://embed.diagrams.net"), ("Sec-Fetch-Site", "cross-site")];

    // Con token: la fuente ni se consulta, y el 403 gana al 405, al 400, al 404 y al 413.
    let fuente = Arc::new(FuenteContada(std::sync::atomic::AtomicUsize::new(0)));
    let proxy = Proxy::nuevo(servidor.destino(), fuente.clone(), limites());
    for (metodo, ruta) in [
        ("OPTIONS", "/api/comentarios/"),
        ("TRACE", "/api/comentarios/"),
        ("GET", "//ejemplo.test/x"),
        ("GET", "/a/../b"),
        ("GET", "/auth/login"),
        ("POST", "/auth/app/canje"),
        ("GET", "/auth/me"),
        ("GET", "/api/comentarios/"),
    ] {
        let caso = format!("{metodo} {ruta} desde otro origen");
        es_rechazo_por_origen(&pedir(&proxy, con_cabeceras(metodo, ruta, &ajeno)), &caso);
    }
    let grande = peticion("PUT", "/api/archivos/")
        .header("Origin", "https://embed.diagrams.net")
        .body(vec![7u8; 2 * 1024 * 1024])
        .unwrap();
    es_rechazo_por_origen(&pedir(&proxy, grande), "cuerpo por encima del tope desde otro origen");
    assert_eq!(
        fuente.0.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "una petición de otro origen no llega a consultar el token"
    );

    // Sin token: ni la pantalla «sin sesión» ni el 401, que dirían a otro origen si hay sesión.
    let proxy = Proxy::nuevo(servidor.destino(), sin_token(), limites());
    let navegacion = con_cabeceras(
        "GET",
        "/uuv/",
        &[
            ("Accept", "text/html"),
            ("Sec-Fetch-Site", "cross-site"),
            ("Sec-Fetch-Mode", "navigate"),
            ("Sec-Fetch-Dest", "iframe"),
        ],
    );
    es_rechazo_por_origen(&pedir(&proxy, navegacion), "navegación de un iframe ajeno sin token");
    es_rechazo_por_origen(&pedir(&proxy, con_cabeceras("GET", "/api/x", &ajeno)), "fetch ajeno sin token");

    assert_eq!(servidor.conexiones(), 0);
}

/// Guarda: lo que hace el propio portal en el webview sigue pasando.
#[test]
fn c9_las_peticiones_del_propio_portal_siguen_pasando() {
    let servidor = Servidor::ok();
    let proxy = proxy(&servidor);
    let html = "text/html,application/xhtml+xml,*/*;q=0.8";
    let propio = "https://portal.localhost";
    let sitio = "Sec-Fetch-Site";
    let modo = "Sec-Fetch-Mode";
    let dest = "Sec-Fetch-Dest";
    let casos: Vec<(&str, &str, Vec<(&str, &str)>)> = vec![
        // Sin ninguna de las dos cabeceras.
        ("GET", "/sin-cabeceras", vec![]),
        ("POST", "/sin-cabeceras-post", vec![("Content-Type", "application/json")]),
        // Navegación de primer nivel: arranque, recarga, barra de direcciones.
        ("GET", "/directa", vec![("Accept", html), (sitio, "none"), (modo, "navigate"), (dest, "document")]),
        // Enlace dentro del portal, y el iframe del visor de PDF.
        ("GET", "/enlace", vec![("Accept", html), (sitio, "same-origin"), (modo, "navigate"), (dest, "document")]),
        ("GET", "/visor-pdf", vec![("Accept", html), (sitio, "same-origin"), (modo, "navigate"), (dest, "iframe")]),
        // fetch del portal: GET sin Origin, escrituras con el Origin de la app.
        ("GET", "/fetch-get", vec![(sitio, "same-origin"), (modo, "cors"), (dest, "empty")]),
        ("POST", "/fetch-post", vec![("Origin", propio), (sitio, "same-origin"), (modo, "cors"), (dest, "empty")]),
        ("DELETE", "/fetch-delete", vec![("Origin", propio), (sitio, "same-origin")]),
        ("PUT", "/origin-sin-sec-fetch", vec![("Origin", propio)]),
        ("POST", "/origin-del-esquema-propio", vec![("Origin", "portal://localhost")]),
        // Subrecursos: imagen y CSS sin Origin; fuente y módulo con el Origin de la app.
        ("GET", "/imagen", vec![(sitio, "same-origin"), (modo, "no-cors"), (dest, "image")]),
        ("GET", "/estilos", vec![(sitio, "same-origin"), (modo, "no-cors"), (dest, "style")]),
        ("GET", "/fuente", vec![("Origin", propio), (sitio, "same-origin"), (modo, "cors"), (dest, "font")]),
        ("GET", "/modulo", vec![("Origin", propio), (sitio, "same-origin"), (modo, "cors"), (dest, "script")]),
        // Excepción: navegación GET del marco principal iniciada desde un documento de origen
        // opaco del propio portal (los diagramas de /:proyecto/arch/ llevan CSP `sandbox`).
        ("GET", "/desde-arch", vec![("Accept", html), (sitio, "cross-site"), (modo, "navigate"), (dest, "document")]),
        ("GET", "/desde-arch-2", vec![("Accept", html), (sitio, "same-site"), (modo, "navigate"), (dest, "document")]),
    ];
    for (metodo, ruta, cabeceras) in &casos {
        let mut con_referer = cabeceras.clone();
        con_referer.push(("Referer", "https://portal.localhost/uuv/"));
        let respuesta = pedir(&proxy, con_cabeceras(metodo, ruta, &con_referer));
        assert_eq!(respuesta.status().as_u16(), 200, "{metodo} {ruta}: {}", texto(&respuesta));
    }
    let recibidas = servidor.recibidas();
    assert_eq!(
        recibidas.iter().map(|r| r.destino.as_str()).collect::<Vec<_>>(),
        casos.iter().map(|(_, ruta, _)| *ruta).collect::<Vec<_>>()
    );
    // Después del filtro, `Origin` y `Referer` se quitan como siempre.
    for recibida in recibidas {
        assert_eq!(recibida.todas("authorization"), [format!("Bearer {TOKEN}")]);
        assert!(!recibida.tiene("origin") && !recibida.tiene("referer"), "{}", recibida.destino);
    }
}

/// Guarda: sin token, la navegación propia sigue viendo la pantalla y el fetch propio un 401.
#[test]
fn c9_sin_token_lo_propio_sigue_viendo_la_pantalla_o_el_401() {
    let servidor = Servidor::ok();
    let proxy = Proxy::nuevo(servidor.destino(), sin_token(), limites());
    for sitio in ["none", "same-origin", "cross-site"] {
        let navegacion = con_cabeceras(
            "GET",
            "/uuv/",
            &[
                ("Accept", "text/html"),
                ("Sec-Fetch-Site", sitio),
                ("Sec-Fetch-Mode", "navigate"),
                ("Sec-Fetch-Dest", "document"),
            ],
        );
        let respuesta = pedir(&proxy, navegacion);
        assert_eq!(respuesta.status().as_u16(), 200, "navegación con Sec-Fetch-Site {sitio}");
        assert_eq!(respuesta.body(), pantalla_sin_sesion().body());
    }
    let propio = con_cabeceras(
        "POST",
        "/api/comentarios/",
        &[("Origin", "https://portal.localhost"), ("Sec-Fetch-Site", "same-origin")],
    );
    es_error_local(&pedir(&proxy, propio), 401);
    assert_eq!(servidor.conexiones(), 0);
}

// ---------- Criterio 5: el secreto ----------

#[test]
fn c5_el_token_no_sale_en_ninguna_respuesta_local() {
    // `pedir` busca el token en el cuerpo y en todas las cabeceras de cada respuesta.
    let servidor = Servidor::fijo(
        Respuesta::nueva(401, b"{\"error\":\"x\"}").con("WWW-Authenticate", "Bearer"),
    );
    let proxy = proxy(&servidor);
    pedir(&proxy, get("/auth/login"));
    pedir(&proxy, get("//ejemplo.test/x"));
    pedir(&proxy, peticion("TRACE", "/x").body(Vec::new()).unwrap());
    pedir(&proxy, peticion("POST", "/api/x").body(vec![0u8; 2 * 1024 * 1024]).unwrap());
    pedir(&proxy, get("/api/x"));
    pedir(&proxy, get("/api/x"));
    pedir(&proxy, navegar("/uuv/"));

    let cerrado = nucleo::Destino::nuevo(&format!("http://127.0.0.1:{}", puerto_cerrado())).unwrap();
    pedir(&Proxy::nuevo(cerrado, con_token(), limites()), get("/api/x"));
}

#[test]
fn c5_la_peticion_al_servidor_lleva_el_token_solo_en_authorization() {
    let servidor = Servidor::ok();
    let peticion = peticion("POST", "/api/comentarios/?proyecto=uuv")
        .header("Content-Type", "application/json")
        .header("X-Propia", "valor")
        .body(b"{\"texto\":\"hola\"}".to_vec())
        .unwrap();
    pedir(&proxy(&servidor), peticion);
    let recibida = servidor.unica();
    assert!(!recibida.destino.contains(TOKEN), "el token no va en la URL");
    assert!(!contiene(&recibida.cuerpo, TOKEN.as_bytes()), "el token no va en el cuerpo");
    let con_token: Vec<&str> = recibida
        .cabeceras
        .iter()
        .filter(|(_, valor)| valor.contains(TOKEN))
        .map(|(nombre, _)| nombre.as_str())
        .collect();
    assert_eq!(con_token.len(), 1, "el token va en una sola cabecera: {con_token:?}");
    assert!(con_token[0].eq_ignore_ascii_case("authorization"));
}

// ---------- Hilos de CodeRabbit en el PR 72 ----------

#[test]
fn c13_mas_de_una_codificacion_en_la_respuesta_es_502() {
    // Hilo 3. Con dos `Content-Encoding`, ureq 2.12.1 abre solo la primera capa y quita los dos
    // campos (`response.rs:598-609`): el webview recibiría datos aún comprimidos. El proxy solo
    // entrega una respuesta con exactamente una codificación, y esa es gzip.
    let plano = b"<!doctype html><p>texto de la respuesta</p>".to_vec();
    let doble = gzip(&gzip(&plano));
    let casos: [(&[&str], Vec<u8>); 4] = [
        (&["gzip", "gzip"], doble.clone()),
        (&["x-gzip", "gzip"], doble.clone()),
        (&["gzip", "br"], gzip(&plano)),
        (&["gzip", "identity"], gzip(&plano)),
    ];
    for (codificaciones, cuerpo) in casos {
        let mut respuesta = Respuesta::nueva(200, &cuerpo).con("Content-Type", "text/html");
        for c in codificaciones {
            respuesta = respuesta.con("Content-Encoding", c);
        }
        let servidor = Servidor::fijo(respuesta);
        let recibida = pedir(&proxy(&servidor), navegar("/uuv/"));
        es_error_local(&recibida, 502);
        assert!(!contiene(recibida.body(), &[0x1f, 0x8b]), "{codificaciones:?}: no llega nada comprimido");
    }

    // Una sola capa gzip sigue llegando abierta, y el tope se sigue midiendo sobre lo abierto.
    let servidor = Servidor::fijo(Respuesta::nueva(200, &gzip(&plano)).con("Content-Encoding", "gzip"));
    assert_eq!(pedir(&proxy(&servidor), navegar("/uuv/")).body(), &plano);
    let servidor = Servidor::fijo(Respuesta::nueva(200, &GZIP_3000_A).con("Content-Encoding", "gzip"));
    let tope = Limites { cuerpo_respuesta: 1000, ..limites() };
    es_error_local(&pedir(&con_limites(&servidor, tope), get("/x")), 502);
}

#[test]
fn c14_head_204_y_304_con_content_encoding_no_leen_cuerpo() {
    // Hilo 4. Estas respuestas no tienen cuerpo aunque declaren `Content-Encoding: gzip`; abrir
    // un cuerpo vacío como gzip falla (fin de datos inesperado) y no es un error del servidor.
    let servidor = Servidor::fijo(
        Respuesta::nueva(200, &gzip(b"<p>hola</p>"))
            .con("Content-Type", "text/html")
            .con("Content-Encoding", "gzip")
            .con("ETag", "\"v1\""),
    );
    let cabeza = pedir(&proxy(&servidor), peticion("HEAD", "/uuv/").body(Vec::new()).unwrap());
    assert_eq!(cabeza.status().as_u16(), 200, "HEAD: {}", texto(&cabeza));
    assert!(cabeza.body().is_empty());
    assert_eq!(cabecera(&cabeza, "etag").as_deref(), Some("\"v1\""));
    assert_eq!(cabecera(&cabeza, "content-type").as_deref(), Some("text/html"));
    // El tamaño que anuncia el servidor es el del cuerpo comprimido: no describe lo que entrega
    // el proxy, así que no se reenvía.
    assert_eq!(cabecera(&cabeza, "content-length"), None);

    let servidor = Servidor::fijo(Respuesta::nueva(204, b"").sin_longitud().con("Content-Encoding", "gzip"));
    let borrado = pedir(&proxy(&servidor), peticion("DELETE", "/api/x").body(Vec::new()).unwrap());
    assert_eq!(borrado.status().as_u16(), 204, "204: {}", texto(&borrado));
    assert!(borrado.body().is_empty());

    let servidor = Servidor::fijo(
        Respuesta::nueva(304, b"").sin_longitud().con("Content-Encoding", "gzip").con("ETag", "\"v1\""),
    );
    let condicional = peticion("GET", "/uuv/").header("If-None-Match", "\"v1\"").body(Vec::new()).unwrap();
    let igual = pedir(&proxy(&servidor), condicional);
    assert_eq!(igual.status().as_u16(), 304, "304: {}", texto(&igual));
    assert!(igual.body().is_empty());
    assert_eq!(cabecera(&igual, "etag").as_deref(), Some("\"v1\""));

    // Una codificación desconocida en una respuesta sin cuerpo sigue siendo 502 (criterio 3).
    let servidor = Servidor::fijo(Respuesta::nueva(204, b"").sin_longitud().con("Content-Encoding", "br"));
    es_error_local(&pedir(&proxy(&servidor), peticion("DELETE", "/api/x").body(Vec::new()).unwrap()), 502);
}

#[test]
fn c16_un_401_con_bearer_marca_la_sesion_perdida_aunque_el_cuerpo_no_se_pueda_entregar() {
    // Hilo 6. El servidor ya dijo que el token no vale en el estado y las cabeceras; que luego
    // el cuerpo no se pueda entregar (demasiado grande, cortado o con una codificación que no
    // se sabe abrir) no cambia eso. La respuesta sigue siendo 502 local.
    let tope = Limites { cuerpo_respuesta: 1000, ..limites() };
    let rechazo = |cuerpo: &[u8]| {
        Respuesta::nueva(401, cuerpo).con("Content-Type", "application/json").con("WWW-Authenticate", "Bearer")
    };
    let casos = [
        ("cuerpo por encima del tope", rechazo(&[b'a'; 5000])),
        ("cuerpo cortado", rechazo(b"{\"error\":").con("Content-Length", "500").sin_longitud()),
        ("codificación desconocida", rechazo(b"\x0b\x02\x80x\x03").con("Content-Encoding", "br")),
    ];
    for (caso, respuesta) in casos {
        let servidor = Servidor::fijo(respuesta);
        let proxy = con_limites(&servidor, tope.clone());
        es_error_local(&pedir(&proxy, get("/api/x")), 502);
        assert!(proxy.sesion_perdida(), "{caso}: el 401 con Bearer marca la sesión perdida");
        // Desde ahí, el token no vuelve a salir.
        es_error_local(&pedir(&proxy, get("/api/x")), 401);
        assert_eq!(servidor.recibidas().len(), 1, "{caso}");
    }
}

// ---------- Segunda vuelta de CodeRabbit en el PR 72 ----------

#[test]
fn c21_un_content_encoding_que_no_se_puede_leer_es_502() {
    // Un valor con bytes que no son ASCII visible (aquí, ni siquiera UTF-8) no sale en
    // `ureq::Response::all`: sin contar los campos con `headers_names`, el proxy vería menos
    // codificaciones de las que mandó el servidor y entregaría el cuerpo sin abrir.
    let plano = b"<!doctype html><p>texto de la respuesta</p>".to_vec();
    let ilegibles: [&[u8]; 3] = [b"gzip\xff", b"\xe9", b"br\x80"];
    for ilegible in ilegibles {
        // Sola, con el cuerpo sin comprimir: hoy `de("content-encoding")` está vacío.
        let servidor = Servidor::fijo(
            Respuesta::nueva(200, &plano).con("Content-Type", "text/html").con_bytes("Content-Encoding", ilegible),
        );
        let recibida = pedir(&proxy(&servidor), navegar("/uuv/"));
        es_error_local(&recibida, 502);
        assert!(!contiene(recibida.body(), b"texto de la respuesta"), "{ilegible:?}: el cuerpo no llega");

        // Junto a un `gzip` legible, con el cuerpo comprimido dos veces: hoy se abre una capa.
        let servidor = Servidor::fijo(
            Respuesta::nueva(200, &gzip(&gzip(&plano)))
                .con("Content-Type", "text/html")
                .con("Content-Encoding", "gzip")
                .con_bytes("Content-Encoding", ilegible),
        );
        let recibida = pedir(&proxy(&servidor), navegar("/uuv/"));
        es_error_local(&recibida, 502);
        assert!(!contiene(recibida.body(), &[0x1f, 0x8b]), "{ilegible:?}: no llega nada comprimido");
    }

    // Guarda: un único `gzip` legible se sigue abriendo.
    let servidor = Servidor::fijo(Respuesta::nueva(200, &gzip(&plano)).con("Content-Encoding", "gzip"));
    assert_eq!(pedir(&proxy(&servidor), navegar("/uuv/")).body(), &plano);
}
