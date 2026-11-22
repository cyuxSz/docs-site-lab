//! Lote `app-login`: la ruta local reservada del botón «Iniciar sesión» (criterio 5) y la sesión
//! que vuelve sin reiniciar la app (criterio 6), a través del proxy.

mod comun;

use std::sync::Arc;
use std::time::Instant;

use comun::login::*;
use comun::*;
use http::{Request, Response};
use nucleo::{
    pantalla_de_login, Aviso, EstadoLogin, FuenteDeToken, Limites, Login, Proxy, Recibido, Token,
    CSP_MARCOS, CSP_PANTALLA, RUTA_INICIAR,
};

/// La app entera sin ventana: login, navegador falso y proxy hacia el servidor falso.
fn app(
    servidor: &Servidor,
    inicial: Option<Token>,
    navegador: Arc<NavegadorFalso>,
) -> (Arc<Login>, Proxy) {
    let login = Arc::new(Login::nuevo(servidor.destino(), Some(EQUIPO), inicial));
    let proxy = Proxy::con_login(Arc::clone(&login), navegador, limites());
    (login, proxy)
}

/// El envío del formulario de la pantalla, como lo entrega WebView2: POST con `Origin` propio.
fn pulsar_en(ruta: &str) -> http::request::Builder {
    peticion("POST", ruta)
        .header("Origin", "https://portal.localhost")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
}

fn pulsar() -> Request<Vec<u8>> {
    pulsar_en(RUTA_INICIAR).body(Vec::new()).unwrap()
}

fn csps(respuesta: &Response<Vec<u8>>) -> Vec<String> {
    respuesta
        .headers()
        .get_all("content-security-policy")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect()
}

/// La respuesta al botón: 303 a la raíz, sin cuerpo y sin caché.
fn es_vuelta_a_la_raiz(respuesta: &Response<Vec<u8>>) {
    assert_eq!(respuesta.status().as_u16(), 303, "cuerpo: {}", texto(respuesta));
    assert_eq!(cabecera(respuesta, "location").as_deref(), Some("/"));
    assert_eq!(cabecera(respuesta, "cache-control").as_deref(), Some("no-store"));
    assert!(respuesta.body().is_empty(), "el 303 no lleva cuerpo");
    assert_eq!(csps(respuesta), [CSP_MARCOS]);
}

// ---------- Criterio 5: la ruta reservada ----------

#[test]
fn c5_el_boton_abre_el_navegador_en_la_url_de_inicio_y_vuelve_a_la_raiz() {
    for origen in ["https://portal.localhost", "portal://localhost"] {
        let servidor = Servidor::ok();
        let navegador = NavegadorFalso::nuevo();
        let (login, proxy) = app(&servidor, None, navegador.clone());

        let envio = peticion("POST", RUTA_INICIAR).header("Origin", origen).body(Vec::new()).unwrap();
        es_vuelta_a_la_raiz(&pedir(&proxy, envio));

        let abiertas = navegador.abiertas();
        assert_eq!(abiertas.len(), 1, "una sola apertura del navegador");
        // `partir_url` exige la forma exacta sobre el origen del destino.
        partir_url(&servidor.origen, &abiertas[0]);
        assert_eq!(login.estado(Instant::now()), EstadoLogin::EnCurso);
        assert_eq!(servidor.conexiones(), 0, "el botón no llega al servidor");

        // La raíz pinta ahora «Sigue en el navegador…», sin red.
        let pantalla = pedir(&proxy, navegar("/"));
        assert_eq!(pantalla.status().as_u16(), 200);
        assert_eq!(pantalla.body(), pantalla_de_login(EstadoLogin::EnCurso).body());
        assert_eq!(csps(&pantalla), [CSP_PANTALLA, CSP_MARCOS]);
        assert_eq!(servidor.conexiones(), 0);
    }
}

#[test]
fn c5_la_peticion_no_influye_en_la_url_que_se_abre() {
    let servidor = Servidor::ok();
    let navegador = NavegadorFalso::nuevo();
    let (_login, proxy) = app(&servidor, None, navegador.clone());

    let cuerpo = "url=https://evil.example/&next=//evil.example&nombre=EVIL&state=EVIL&challenge=EVIL\
                  &plataforma=ios&destino=https://evil.example";
    let envio = Request::builder()
        .method("POST")
        .uri("https://evil.example/__app/iniciar?url=https://evil.example/&destino=evil.example&state=EVIL")
        .header("Origin", "https://portal.localhost")
        .header("Host", "evil.example")
        .header("X-Forwarded-Host", "evil.example")
        .header("Referer", "https://evil.example/")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(cuerpo.as_bytes().to_vec())
        .unwrap();
    es_vuelta_a_la_raiz(&pedir(&proxy, envio));

    let abiertas = navegador.abiertas();
    assert_eq!(abiertas.len(), 1);
    let intento = partir_url(&servidor.origen, &abiertas[0]);
    assert_eq!(intento.nombre, EQUIPO);
    let minusculas = intento.url.to_lowercase();
    assert!(!minusculas.contains("evil") && !minusculas.contains("ios"), "{}", intento.url);
    assert_eq!(servidor.conexiones(), 0);
}

#[test]
fn c5_dos_pulsaciones_seguidas_abren_el_navegador_una_sola_vez() {
    let servidor = Servidor::ok();
    let navegador = NavegadorFalso::nuevo();
    let (login, proxy) = app(&servidor, None, navegador.clone());
    for _ in 0..5 {
        es_vuelta_a_la_raiz(&pedir(&proxy, pulsar()));
    }
    assert_eq!(navegador.abiertas().len(), 1, "dentro de la pausa no se abre otra pestaña");
    assert_eq!(login.estado(Instant::now()), EstadoLogin::EnCurso);

    assert_eq!(servidor.conexiones(), 0);
}

#[test]
fn c5_con_sesion_el_boton_no_abre_nada() {
    let servidor = Servidor::ok();
    let navegador = NavegadorFalso::nuevo();
    let (login, proxy) = app(&servidor, Some(token()), navegador.clone());
    es_vuelta_a_la_raiz(&pedir(&proxy, pulsar()));
    assert!(navegador.abiertas().is_empty(), "el contenido del portal no puede abrir el navegador");
    assert_eq!(login.estado(Instant::now()), EstadoLogin::ConSesion);
    assert_eq!(servidor.conexiones(), 0, "tampoco se reenvía");
}

#[test]
fn c5_sin_un_origin_propio_el_boton_no_abre_nada() {
    let servidor = Servidor::ok();
    let navegador = NavegadorFalso::nuevo();
    let (login, proxy) = app(&servidor, None, navegador.clone());

    let sin_origin = peticion("POST", RUTA_INICIAR).body(Vec::new()).unwrap();
    let repetido = pulsar_en(RUTA_INICIAR)
        .header("Origin", "https://portal.localhost")
        .body(Vec::new())
        .unwrap();
    let otro_sitio = peticion("POST", RUTA_INICIAR)
        .header("Origin", "https://portal.localhost")
        .header("Sec-Fetch-Site", "cross-site")
        .body(Vec::new())
        .unwrap();
    let mut envios = vec![sin_origin, repetido, otro_sitio];
    for ajeno in ["null", "", "https://embed.diagrams.net", "https://docs.vanttec.workers.dev", "https://portal.localhost/"] {
        envios.push(peticion("POST", RUTA_INICIAR).header("Origin", ajeno).body(Vec::new()).unwrap());
    }
    for envio in envios {
        let descripcion = format!("{:?}", envio.headers());
        es_error_local(&pedir(&proxy, envio), 403);
        assert!(navegador.abiertas().is_empty(), "no debe abrir nada: {descripcion}");
    }
    assert_eq!(login.estado(Instant::now()), EstadoLogin::SinSesion);
    assert_eq!(servidor.conexiones(), 0);
}

#[test]
fn c5_la_ruta_reservada_nunca_se_reenvia() {
    let servidor = Servidor::ok();
    let propio = |metodo: &str, ruta: &str| {
        peticion(metodo, ruta).header("Origin", "https://portal.localhost").body(Vec::new()).unwrap()
    };
    for inicial in [Some(token()), None] {
        let navegador = NavegadorFalso::nuevo();
        let (_login, proxy) = app(&servidor, inicial.clone(), navegador.clone());
        for (metodo, ruta) in [
            ("GET", "/__app/iniciar"),
            ("PUT", "/__app/iniciar"),
            ("PATCH", "/__app/iniciar"),
            ("DELETE", "/__app/iniciar"),
            ("POST", "/__app"),
            ("POST", "/__app/"),
            ("POST", "/__app/iniciar/"),
            ("POST", "/__app/iniciar/x"),
            ("POST", "/__app/otra"),
            ("POST", "/__APP/iniciar"),
            ("POST", "/__app/INICIAR"),
            ("POST", "/%5F%5Fapp/iniciar"),
            ("POST", "/__app/%69niciar"),
            ("GET", "/__app"),
            ("GET", "/__app/estilos.css"),
            ("GET", "/__App/x?y=1"),
        ] {
            es_error_local(&pedir(&proxy, propio(metodo, ruta)), 404);
        }
        // Una navegación a la ruta tampoco pinta la pantalla ni llega al servidor.
        es_error_local(&pedir(&proxy, navegar("/__app/iniciar")), 404);
        assert!(navegador.abiertas().is_empty(), "solo el POST exacto abre el navegador");
    }
    assert_eq!(servidor.conexiones(), 0, "nada bajo /__app llega al servidor");

    // Guarda: lo que solo se parece a la ruta reservada se sigue reenviando.
    let (_login, proxy) = app(&servidor, Some(token()), NavegadorFalso::nuevo());
    for ruta in ["/__apple/x", "/__app2", "/x/__app/iniciar", "/_app/iniciar"] {
        assert_eq!(pedir(&proxy, get(ruta)).status().as_u16(), 200, "{ruta} es del portal");
    }
    assert_eq!(servidor.recibidas().len(), 4);
}

#[test]
fn c5_un_proxy_sin_login_no_tiene_boton() {
    let servidor = Servidor::ok();
    for fuente in [con_token(), sin_token()] {
        let proxy = Proxy::nuevo(servidor.destino(), fuente, limites());
        es_error_local(&pedir(&proxy, pulsar()), 404);
        es_error_local(&pedir(&proxy, get("/__app/x")), 404);
    }
    assert_eq!(servidor.conexiones(), 0);
}

#[test]
fn c5_si_el_navegador_no_abre_la_pantalla_lo_dice() {
    let servidor = Servidor::ok();
    let navegador = NavegadorFalso::roto();
    let (login, proxy) = app(&servidor, None, navegador.clone());
    es_vuelta_a_la_raiz(&pedir(&proxy, pulsar()));
    assert_eq!(navegador.abiertas().len(), 1);
    let fallo = EstadoLogin::Fallo(Aviso::NavegadorNoAbre);
    assert_eq!(login.estado(Instant::now()), fallo);
    let pantalla = pedir(&proxy, navegar("/"));
    assert_eq!(pantalla.body(), pantalla_de_login(fallo).body());
    assert_eq!(servidor.conexiones(), 0);
}

// ---------- Criterio 6: la sesión vuelve sin reiniciar ----------

/// Servidor que solo acepta `TOKEN_NUEVO`, y que lo entrega en el canje.
fn portal_que_exige_el_token_nuevo() -> Servidor {
    Servidor::nuevo(|peticion| {
        if peticion.destino == "/auth/app/canje" {
            canje_ok(TOKEN_NUEVO)
        } else if peticion.una("authorization").as_deref() == Some(&format!("Bearer {TOKEN_NUEVO}")) {
            Respuesta::nueva(200, b"<h1>portal</h1>").con("Content-Type", "text/html; charset=utf-8")
        } else {
            Respuesta::nueva(401, b"{\"error\":\"Token inv\\u00e1lido\"}")
                .con("Content-Type", "application/json")
                .con("WWW-Authenticate", "Bearer")
        }
    })
}

fn sin_el_token_nuevo(respuesta: &Response<Vec<u8>>) {
    assert!(!contiene(respuesta.body(), TOKEN_NUEVO.as_bytes()), "el token nuevo aparece en el cuerpo");
    for (nombre, valor) in respuesta.headers() {
        assert!(!contiene(valor.as_bytes(), TOKEN_NUEVO.as_bytes()), "el token nuevo aparece en {nombre}");
    }
}

#[test]
fn c6_tras_perder_la_sesion_un_login_nuevo_la_devuelve_sin_reiniciar() {
    let servidor = portal_que_exige_el_token_nuevo();
    let navegador = NavegadorFalso::nuevo();
    // Arranca con un token que el servidor ya no acepta.
    let (login, proxy) = app(&servidor, Some(token()), navegador.clone());

    // 1. El servidor lo rechaza: la sesión se pierde y el token viejo se olvida.
    let rechazo = pedir(&proxy, get("/api/comentarios/"));
    assert_eq!(rechazo.status().as_u16(), 401, "un fetch sigue viendo el 401 del servidor");
    assert!(proxy.sesion_perdida());
    assert!(login.token().is_none(), "el token rechazado no se guarda");
    assert_eq!(login.estado(Instant::now()), EstadoLogin::SinSesion);

    // 2. La navegación pinta la pantalla, sin red.
    let pantalla = pedir(&proxy, navegar("/uuv/"));
    assert_eq!(pantalla.body(), pantalla_de_login(EstadoLogin::SinSesion).body());
    assert_eq!(servidor.recibidas().len(), 1);

    // 3. Botón, navegador y enlace de vuelta.
    assert_eq!(pedir(&proxy, pulsar()).status().as_u16(), 303);
    let intento = partir_url(&servidor.origen, &navegador.abiertas()[0]);
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), Instant::now()), Recibido::Sesion);
    assert_eq!(servidor.recibidas().len(), 2, "el canje es la segunda petición");

    // 4. Sin reiniciar nada, el mismo proxy envía ya el token nuevo.
    assert!(!proxy.sesion_perdida(), "con un token distinto del rechazado vuelve a haber sesión");
    let portal = pedir(&proxy, navegar("/uuv/"));
    assert_eq!(portal.status().as_u16(), 200);
    assert_eq!(texto(&portal), "<h1>portal</h1>");
    let ultima = servidor.recibidas().pop().unwrap();
    assert_eq!(ultima.destino, "/uuv/");
    assert_eq!(ultima.todas("authorization"), [format!("Bearer {TOKEN_NUEVO}")]);
    assert_eq!(servidor.recibidas().len(), 3);

    // El token nuevo tampoco llega al webview, y el botón ya no abre nada.
    sin_el_token_nuevo(&portal);
    let boton = pedir(&proxy, pulsar());
    sin_el_token_nuevo(&boton);
    assert_eq!(navegador.abiertas().len(), 1);
}

#[test]
fn c6_un_canje_fallido_vuelve_a_la_pantalla_con_el_aviso() {
    let servidor = Servidor::fijo(
        Respuesta::nueva(400, "{\"error\":\"Código inválido o caducado\"}".as_bytes())
            .con("Content-Type", "application/json; charset=utf-8"),
    );
    let navegador = NavegadorFalso::nuevo();
    let (login, proxy) = app(&servidor, None, navegador.clone());
    assert_eq!(pedir(&proxy, pulsar()).status().as_u16(), 303);
    let intento = partir_url(&servidor.origen, &navegador.abiertas()[0]);
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), Instant::now()), Recibido::Fallo);

    let pantalla = pedir(&proxy, navegar("/"));
    assert_eq!(pantalla.status().as_u16(), 200);
    assert_eq!(pantalla.body(), pantalla_de_login(EstadoLogin::Fallo(Aviso::NoSePudo)).body());
    let html = texto(&pantalla);
    for interno in [CODIGO, intento.state.as_str(), intento.challenge.as_str(), "inválido o caducado", "400"] {
        assert!(!html.contains(interno), "la pantalla no lleva detalles internos: {interno:?}");
    }
    // Sin sesión, un fetch sigue recibiendo el 401 local.
    es_error_local(&pedir(&proxy, get("/api/x")), 401);
    assert_eq!(servidor.recibidas().len(), 1, "solo el canje llegó al servidor");
}

#[test]
fn c6_un_401_del_servidor_en_una_navegacion_pinta_la_pantalla_de_login() {
    let servidor = Servidor::fijo(
        Respuesta::nueva(401, b"{\"error\":\"token\"}")
            .con("Content-Type", "application/json")
            .con("WWW-Authenticate", "Bearer error=\"invalid_token\""),
    );
    let (login, proxy) = app(&servidor, Some(token()), NavegadorFalso::nuevo());

    let pantalla = pedir(&proxy, navegar("/uuv/"));
    assert_eq!(pantalla.status().as_u16(), 200, "la navegación no ve el JSON del 401");
    assert_eq!(pantalla.body(), pantalla_de_login(EstadoLogin::SinSesion).body());
    assert_eq!(cabecera(&pantalla, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert_eq!(csps(&pantalla), [CSP_PANTALLA, CSP_MARCOS]);
    assert!(!pantalla.headers().contains_key("www-authenticate"));
    assert!(proxy.sesion_perdida());
    assert!(login.token().is_none());
    assert_eq!(servidor.recibidas().len(), 1);

    // Un 401 sin desafío Bearer no es un rechazo del token: pasa tal cual y la sesión sigue.
    let otro = Servidor::fijo(Respuesta::nueva(401, b"{\"login\":null}").con("Content-Type", "application/json"));
    let (login, proxy) = app(&otro, Some(token()), NavegadorFalso::nuevo());
    let respuesta = pedir(&proxy, navegar("/uuv/"));
    assert_eq!(respuesta.status().as_u16(), 401);
    assert_eq!(texto(&respuesta), "{\"login\":null}");
    assert!(!proxy.sesion_perdida());
    assert_eq!(login.token(), Some(token()));
}

#[test]
fn c6_el_proxy_con_login_sigue_siendo_el_proxy() {
    fn es_send_sync<T: Send + Sync>() {}
    es_send_sync::<Proxy>();

    // Con sesión reenvía con el Bearer; sin sesión, pantalla o 401 local, como en A0.
    let servidor = Servidor::ok();
    let (_login, proxy) = app(&servidor, Some(token()), NavegadorFalso::nuevo());
    assert_eq!(pedir(&proxy, get("/api/x?y=1")).status().as_u16(), 200);
    let recibida = servidor.unica();
    assert_eq!(recibida.destino, "/api/x?y=1");
    assert_eq!(recibida.todas("authorization"), [format!("Bearer {TOKEN}")]);
    es_error_local(&pedir(&proxy, get("/auth/login")), 404);

    let (_login, sin) = app(&servidor, None, NavegadorFalso::nuevo());
    es_error_local(&pedir(&sin, get("/api/x")), 401);
    let pantalla = pedir(&sin, navegar("/uuv/"));
    assert_eq!(pantalla.body(), pantalla_de_login(EstadoLogin::SinSesion).body());
    assert_eq!(servidor.recibidas().len(), 1);

    // Los límites son los que se le pasan.
    let (_login, justo) = {
        let login = Arc::new(Login::nuevo(servidor.destino(), Some(EQUIPO), Some(token())));
        let limites = Limites { cuerpo_peticion: 8, ..limites() };
        (Arc::clone(&login), Proxy::con_login(login, NavegadorFalso::nuevo(), limites))
    };
    let grande = peticion("POST", "/api/x").body(vec![0u8; 9]).unwrap();
    es_error_local(&pedir(&justo, grande), 413);
}
