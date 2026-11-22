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
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"ok").tras(Duration::from_millis(300)));
    let proxy = Arc::new(con_limites(&servidor, Limites { simultaneas: 2, ..limites() }));
    let estados: Vec<u16> = std::thread::scope(|ambito| {
        let hilos: Vec<_> = (0..6)
            .map(|i| {
                let proxy = proxy.clone();
                ambito.spawn(move || pedir(&proxy, get(&format!("/api/x?n={i}"))).status().as_u16())
            })
            .collect();
        hilos.into_iter().map(|h| h.join().unwrap()).collect()
    });
    assert_eq!(estados, [200; 6], "las peticiones que esperan su turno también se atienden");
    assert_eq!(servidor.recibidas().len(), 6);
    assert_eq!(servidor.max_activas(), 2, "debe haber 2 a la vez, ni más ni una sola");
}

#[test]
fn c4_si_la_espera_por_un_hueco_vence_es_503_local() {
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"ok").tras(Duration::from_millis(1500)));
    let proxy = Arc::new(con_limites(
        &servidor,
        Limites { simultaneas: 1, timeout_total: Duration::from_secs(2), ..limites() },
    ));
    let mut respuestas: Vec<(u16, String)> = std::thread::scope(|ambito| {
        let hilos: Vec<_> = (0..3)
            .map(|i| {
                let proxy = proxy.clone();
                ambito.spawn(move || {
                    let respuesta = pedir(&proxy, get(&format!("/api/x?n={i}")));
                    (respuesta.status().as_u16(), texto(&respuesta))
                })
            })
            .collect();
        hilos.into_iter().map(|h| h.join().unwrap()).collect()
    });
    respuestas.sort();
    let estados: Vec<u16> = respuestas.iter().map(|(estado, _)| *estado).collect();
    assert_eq!(estados, [200, 200, 503], "dos pasan (una espera 1,5 s) y la tercera se rinde a los 2 s");
    assert!(respuestas[2].1.starts_with("{\"error\":\""), "el 503 es JSON local: {}", respuestas[2].1);
    assert_eq!(servidor.recibidas().len(), 2, "la petición que se rinde no llega a la red");
    assert_eq!(servidor.max_activas(), 1);
}

#[test]
fn c4_el_proxy_se_comparte_entre_hilos() {
    fn es_send_y_sync<T: Send + Sync + 'static>() {}
    es_send_y_sync::<Proxy>();
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
