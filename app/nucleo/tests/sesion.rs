//! Lote `app-sesion`: el llavero (criterios 1 a 3), cerrar sesión (4), el enlace «Salir» en el
//! proxy (5), el 401 completo (6), los avisos de la pantalla (7) y los secretos (8).
//!
//! El llavero es un doble en memoria (`comun::sesion::LlaveroFalso`) y el servidor es el falso de
//! siempre: nada de esto toca el almacén de credenciales del sistema.

mod comun;

use std::sync::Arc;
use std::time::{Duration, Instant};

use comun::login::*;
use comun::sesion::*;
use comun::*;
use http::{Request, Response};
use nucleo::{
    nombre_de_llavero, pantalla_de_login, Aviso, Cierre, EstadoLogin, FalloDeLlavero, Fin,
    FuenteDeToken, Llavero, Login, Proxy, Recibido, SinLlavero, CSP_MARCOS, CSP_PANTALLA,
    LLAVERO_CUENTA, LLAVERO_SERVICIO, LLAVERO_SERVICIO_DEV, RUTA_INICIAR, RUTA_SALIR,
};

const FINES: [Fin; 3] = [Fin::Cerrada, Fin::CerradaSinServidor, Fin::Caducada];

/// La app entera sin ventana: login con ese llavero, navegador falso y proxy.
fn app(servidor: &Servidor, llavero: &Arc<LlaveroFalso>) -> (Arc<Login>, Proxy, Arc<NavegadorFalso>) {
    let login = login_con(servidor, llavero);
    let navegador = NavegadorFalso::nuevo();
    let proxy = Proxy::con_login(Arc::clone(&login), navegador.clone(), limites());
    (login, proxy, navegador)
}

/// Llavero con el token de prueba ya guardado: la app arranca con sesión.
fn con_sesion_guardada() -> Arc<LlaveroFalso> {
    LlaveroFalso::con_secreto(TOKEN.as_bytes())
}

/// Servidor del portal: revoca, canjea, y solo sirve páginas al token que se le diga.
fn portal(acepta: &'static str) -> Servidor {
    Servidor::nuevo(move |peticion| {
        if peticion.destino == "/auth/app/revocar" {
            revocado()
        } else if peticion.destino == "/auth/app/canje" {
            canje_ok(TOKEN_NUEVO)
        } else if peticion.una("authorization").as_deref() == Some(&format!("Bearer {acepta}")) {
            Respuesta::nueva(200, b"<h1>portal</h1>").con("Content-Type", "text/html; charset=utf-8")
        } else {
            token_invalido()
        }
    })
}

fn csps(respuesta: &Response<Vec<u8>>) -> Vec<String> {
    respuesta
        .headers()
        .get_all("content-security-policy")
        .iter()
        .map(|v| v.to_str().unwrap().to_string())
        .collect()
}

fn es_vuelta_a_la_raiz(respuesta: &Response<Vec<u8>>) {
    assert_eq!(respuesta.status().as_u16(), 303, "cuerpo: {}", texto(respuesta));
    assert_eq!(cabecera(respuesta, "location").as_deref(), Some("/"));
    assert_eq!(cabecera(respuesta, "cache-control").as_deref(), Some("no-store"));
    assert!(respuesta.body().is_empty(), "el 303 no lleva cuerpo");
    assert_eq!(csps(respuesta), [CSP_MARCOS]);
}

fn es_la_pantalla(respuesta: &Response<Vec<u8>>, estado: EstadoLogin) {
    assert_eq!(respuesta.status().as_u16(), 200, "cuerpo: {}", texto(respuesta));
    assert_eq!(cabecera(respuesta, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert_eq!(texto(respuesta), html_de(estado), "la pantalla es la de {estado:?}");
    assert_eq!(csps(respuesta), [CSP_PANTALLA, CSP_MARCOS]);
    assert!(!respuesta.headers().contains_key("www-authenticate"));
}

fn html_de(estado: EstadoLogin) -> String {
    String::from_utf8(pantalla_de_login(estado).body().clone()).expect("la pantalla es UTF-8")
}

/// Pulsar «Salir» en el portal: navegación GET del marco principal, como la entrega WebView2.
fn salir() -> Request<Vec<u8>> {
    navegar(RUTA_SALIR)
}

/// Navegación con las cabeceras `Sec-Fetch-*` que mandan las plataformas que sí las entregan.
fn navegar_con(ruta: &str, extra: &[(&str, &str)]) -> Request<Vec<u8>> {
    let mut peticion = peticion("GET", ruta)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    for (nombre, valor) in extra {
        peticion = peticion.header(*nombre, *valor);
    }
    peticion.body(Vec::new()).unwrap()
}

// ---------- Criterio 1: el llavero y sus nombres ----------

#[test]
fn c1_los_nombres_del_llavero_son_fijos_y_distintos_en_debug_y_en_release() {
    assert_eq!(LLAVERO_SERVICIO, "VantTec Docs");
    assert_eq!(LLAVERO_SERVICIO_DEV, "VantTec Docs (desarrollo)");
    assert_eq!(LLAVERO_CUENTA, "token-de-dispositivo");
    assert_ne!(LLAVERO_SERVICIO, LLAVERO_SERVICIO_DEV);
    assert_eq!(RUTA_SALIR, "/auth/logout");

    assert_eq!(nombre_de_llavero(false), LLAVERO_SERVICIO, "release");
    assert_eq!(nombre_de_llavero(true), LLAVERO_SERVICIO_DEV, "debug");
    // Windows compara los nombres de credencial sin distinguir mayúsculas.
    assert_ne!(nombre_de_llavero(false).to_lowercase(), nombre_de_llavero(true).to_lowercase());
    for nombre in [LLAVERO_SERVICIO, LLAVERO_SERVICIO_DEV, LLAVERO_CUENTA] {
        assert!(
            nombre.bytes().all(|b| (0x20..=0x7E).contains(&b)) && nombre.trim() == nombre,
            "{nombre:?}: solo ASCII visible, sin espacios en los extremos"
        );
        assert!(!nombre.contains("vtd_") && !nombre.contains("http"), "{nombre:?} es una etiqueta fija");
    }
}

#[test]
fn c1_sin_llavero_la_sesion_vive_solo_en_memoria() {
    fn es_send_sync<T: Send + Sync + ?Sized>() {}
    es_send_sync::<dyn Llavero>();
    es_send_sync::<Login>();

    assert_eq!(SinLlavero.leer(), Ok(None));
    assert_eq!(SinLlavero.guardar(TOKEN.as_bytes()), Err(FalloDeLlavero));
    assert_eq!(SinLlavero.leer(), Ok(None), "no guarda nada");
    assert_eq!(SinLlavero.borrar(), Ok(()));

    // `Login::nuevo` sigue existiendo y es un login con `SinLlavero`.
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let con_el = Login::con_llavero(servidor.destino(), Some(EQUIPO), None, Arc::new(SinLlavero));
    let t0 = Instant::now();
    assert_eq!(con_el.estado(t0), EstadoLogin::SinSesion);
    let intento = iniciar(&con_el, t0);
    assert_eq!(con_el.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Sesion);
    assert_eq!(con_el.token(), Some(token_nuevo()));
}

// ---------- Criterio 2: el arranque ----------

#[test]
fn c2_con_un_token_en_el_llavero_la_app_arranca_con_sesion() {
    let servidor = portal(TOKEN);
    let llavero = con_sesion_guardada();
    let (login, proxy, _navegador) = app(&servidor, &llavero);

    assert_eq!(login.estado(Instant::now()), EstadoLogin::ConSesion);
    assert_eq!(login.token(), Some(token()));
    assert_eq!(llavero.lecturas(), 1, "el llavero se lee una vez, al arrancar");
    assert_eq!(servidor.conexiones(), 0, "arrancar no toca la red");
    assert!(llavero.guardados().is_empty() && llavero.borrados() == 0, "leer no escribe");

    // La primera navegación sale ya con el token: se ve el portal, no la pantalla de login.
    let pagina = pedir(&proxy, navegar("/"));
    assert_eq!(pagina.status().as_u16(), 200);
    assert_eq!(texto(&pagina), "<h1>portal</h1>");
    assert_eq!(servidor.unica().todas("authorization"), [format!("Bearer {TOKEN}")]);
    assert_eq!(llavero.lecturas(), 1, "las peticiones no vuelven a leer el llavero");
}

#[test]
fn c2_el_token_de_desarrollo_manda_y_el_llavero_no_se_lee() {
    let servidor = Servidor::ok();
    let llavero = LlaveroFalso::con_secreto(TOKEN_NUEVO.as_bytes());
    let login = Login::con_llavero(servidor.destino(), Some(EQUIPO), Some(token()), llavero.clone());
    assert_eq!(login.token(), Some(token()));
    assert_eq!(llavero.lecturas(), 0);
    assert!(llavero.guardados().is_empty(), "el token de desarrollo no se guarda en el llavero");
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN_NUEVO.as_bytes()));
    assert_eq!(servidor.conexiones(), 0);
}

#[test]
fn c2_lo_que_no_tiene_forma_de_token_se_borra_y_no_hay_sesion() {
    let servidor = Servidor::ok();
    let con_salto = format!("{TOKEN}\n");
    let con_espacio = format!(" {TOKEN}");
    let corto = &TOKEN[..TOKEN.len() - 1];
    let largo = format!("{TOKEN}A");
    let sin_prefijo = format!("xtd_{}", &TOKEN[4..]);
    let con_simbolo = format!("{}+", &TOKEN[..TOKEN.len() - 1]);
    let en_json = format!("{{\"token\":\"{TOKEN}\"}}");
    let en_utf16: Vec<u8> = TOKEN.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let casos: Vec<&[u8]> = vec![
        b"",
        b"vtd_",
        b"hola",
        con_salto.as_bytes(),
        con_espacio.as_bytes(),
        corto.as_bytes(),
        largo.as_bytes(),
        sin_prefijo.as_bytes(),
        con_simbolo.as_bytes(),
        en_json.as_bytes(),
        &en_utf16,
        &[0xff, 0xfe, 0x00, 0x80],
    ];
    for secreto in casos {
        let llavero = LlaveroFalso::con_secreto(secreto);
        let login = login_con(&servidor, &llavero);
        let caso = String::from_utf8_lossy(secreto).into_owned();
        assert!(login.token().is_none(), "{caso:?} no es un token");
        assert_eq!(login.estado(Instant::now()), EstadoLogin::SinSesion, "{caso:?}: sin aviso");
        assert_eq!(llavero.contenido(), None, "{caso:?}: lo que no sirve se borra del llavero");
    }
    assert_eq!(servidor.conexiones(), 0);
}

#[test]
fn c2_si_el_llavero_falla_la_app_arranca_sin_sesion_y_el_login_funciona() {
    let servidor = portal(TOKEN_NUEVO);
    let llavero = LlaveroFalso::roto();
    let (login, proxy, navegador) = app(&servidor, &llavero);
    let t0 = Instant::now();

    assert!(login.token().is_none());
    assert_eq!(login.estado(t0), EstadoLogin::SinSesion, "un llavero roto no es un aviso");
    es_la_pantalla(&pedir(&proxy, navegar("/")), EstadoLogin::SinSesion);

    // El login completo funciona igual, y la sesión queda en memoria.
    let pulsar = peticion("POST", RUTA_INICIAR)
        .header("Origin", "https://portal.localhost")
        .body(Vec::new())
        .unwrap();
    assert_eq!(pedir(&proxy, pulsar).status().as_u16(), 303);
    let intento = partir_url(&servidor.origen, &navegador.abiertas()[0]);
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Sesion);
    assert_eq!(login.estado(t0), EstadoLogin::ConSesion, "no poder guardar no rompe el login");
    assert_eq!(login.token(), Some(token_nuevo()));
    assert_eq!(llavero.guardados(), [TOKEN_NUEVO.as_bytes().to_vec()], "se intentó guardar una vez");
    assert_eq!(texto(&pedir(&proxy, navegar("/"))), "<h1>portal</h1>");

    // Cerrar sesión tampoco se rompe si el llavero no deja borrar.
    assert_eq!(login.cerrar_sesion(), Cierre::Revocada);
    assert!(login.token().is_none());
    assert_eq!(login.estado(t0), EstadoLogin::Terminada(Fin::Cerrada));
}

// ---------- Criterio 3: guardar tras el canje ----------

#[test]
fn c3_tras_el_canje_el_token_se_guarda_tal_cual_y_el_siguiente_arranque_tiene_sesion() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let llavero = LlaveroFalso::vacio();
    let login = login_con(&servidor, &llavero);
    let t0 = Instant::now();
    let intento = iniciar(&login, t0);
    assert!(llavero.guardados().is_empty(), "abrir el navegador no guarda nada");

    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Sesion);
    // Exactamente los bytes del token: sin JSON, sin salto de línea, sin `expira` ni `login`.
    assert_eq!(llavero.guardados(), [TOKEN_NUEVO.as_bytes().to_vec()], "un solo guardado");
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN_NUEVO.as_bytes()));
    assert_eq!(llavero.borrados(), 0);

    // «Cerrar y abrir la app»: otro `Login` sobre el mismo llavero.
    let otra_vez = login_con(&servidor, &llavero);
    assert_eq!(otra_vez.estado(t0), EstadoLogin::ConSesion);
    assert_eq!(otra_vez.token(), Some(token_nuevo()));
    assert_eq!(servidor.recibidas().len(), 1, "solo el canje llegó al servidor");
}

#[test]
fn c3_un_canje_fallido_o_ignorado_no_toca_el_llavero() {
    let servidor = Servidor::fijo(Respuesta::nueva(400, b"{\"error\":\"x\"}"));
    let llavero = LlaveroFalso::vacio();
    let login = login_con(&servidor, &llavero);
    let t0 = Instant::now();
    let intento = iniciar(&login, t0);
    assert_eq!(login.recibir(&enlace(CODIGO, STATE_AJENO), t0), Recibido::Ignorado);
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Fallo);
    assert_eq!(login.estado(t0), EstadoLogin::Fallo(Aviso::NoSePudo));
    assert!(llavero.guardados().is_empty());
    assert_eq!(llavero.contenido(), None);
}

// ---------- Criterio 4: cerrar sesión ----------

#[test]
fn c4_cerrar_sesion_revoca_el_token_y_lo_borra_de_la_memoria_y_del_llavero() {
    let servidor = Servidor::fijo(revocado());
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);
    let t0 = Instant::now();

    assert_eq!(login.cerrar_sesion(), Cierre::Revocada);
    assert!(login.token().is_none());
    assert_eq!(llavero.contenido(), None, "el llavero queda vacío");
    assert_eq!(login.estado(t0), EstadoLogin::Terminada(Fin::Cerrada));

    let peticion = servidor.unica();
    assert_eq!(peticion.metodo, "POST");
    assert_eq!(peticion.destino, "/auth/app/revocar");
    assert_eq!(peticion.todas("authorization"), [format!("Bearer {TOKEN}")]);
    assert!(peticion.cuerpo.is_empty(), "la revocación no lleva cuerpo");
    assert_eq!(peticion.una("content-length").as_deref(), Some("0"));
    assert!(!peticion.tiene("transfer-encoding"));
    for ajena in ["cookie", "origin", "referer"] {
        assert!(!peticion.tiene(ajena), "la revocación no lleva la cabecera {ajena}");
    }

    // Otra vez: ya no hay sesión, así que no hay nada que cerrar ni que pedir.
    assert_eq!(login.cerrar_sesion(), Cierre::SinSesion);
    assert_eq!(login.estado(t0), EstadoLogin::Terminada(Fin::Cerrada), "el aviso sigue");
    assert_eq!(servidor.recibidas().len(), 1);

    // Y el siguiente arranque no tiene sesión.
    assert_eq!(login_con(&servidor, &llavero).estado(t0), EstadoLogin::SinSesion);
}

#[test]
fn c4_sin_sesion_cerrar_no_hace_nada() {
    let servidor = Servidor::fijo(revocado());
    let llavero = LlaveroFalso::vacio();
    let login = login_con(&servidor, &llavero);
    let t0 = Instant::now();
    assert_eq!(login.cerrar_sesion(), Cierre::SinSesion);
    assert_eq!(login.estado(t0), EstadoLogin::SinSesion, "sin sesión no hay aviso de cierre");

    // Con un login a medias tampoco: el intento sigue vivo.
    let intento = iniciar(&login, t0);
    assert_eq!(login.cerrar_sesion(), Cierre::SinSesion);
    assert_eq!(login.estado(t0), EstadoLogin::EnCurso);
    assert_eq!(servidor.conexiones(), 0);

    // Guarda: ese intento todavía sirve.
    let canje = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let otro = login_con(&canje, &llavero);
    let intento_2 = iniciar(&otro, t0);
    assert_eq!(otro.cerrar_sesion(), Cierre::SinSesion);
    assert_eq!(otro.recibir(&enlace(CODIGO, &intento_2.state), t0), Recibido::Sesion);
    let _ = intento;
}

#[test]
fn c4_si_el_servidor_no_confirma_el_token_se_borra_igual_y_se_avisa() {
    let grande = format!("{{\"ok\":true,\"relleno\":\"{}\"}}", "x".repeat(5000));
    let respuestas: Vec<(&str, Respuesta)> = vec![
        ("503 no identificado", Respuesta::nueva(503, b"{\"error\":\"No disponible\"}")),
        ("500", Respuesta::nueva(500, b"x")),
        ("429", Respuesta::nueva(429, b"{}").con("Retry-After", "60")),
        ("403 origen", Respuesta::nueva(403, b"{\"error\":\"Origen\"}")),
        ("400", Respuesta::nueva(400, b"{\"error\":\"Ruta solo para navegador\"}")),
        ("404", Respuesta::nueva(404, b"{}")),
        ("401 sin desafío", Respuesta::nueva(401, b"{\"login\":null}")),
        ("302", Respuesta::nueva(302, b"").con("Location", "/auth/signed-out")),
        ("204", Respuesta::nueva(204, b"")),
        ("200 HTML", Respuesta::nueva(200, b"<h1>portal cautivo</h1>").con("Content-Type", "text/html")),
        ("200 sin ok", Respuesta::nueva(200, b"{}")),
        ("200 ok falso", Respuesta::nueva(200, b"{\"ok\":false}")),
        ("200 ok de texto", Respuesta::nueva(200, b"{\"ok\":\"true\"}")),
        ("200 enorme", Respuesta::nueva(200, grande.as_bytes())),
    ];
    for (caso, respuesta) in respuestas {
        let servidor = Servidor::fijo(respuesta);
        let llavero = con_sesion_guardada();
        let login = login_con(&servidor, &llavero);
        assert_eq!(login.cerrar_sesion(), Cierre::SoloLocal, "{caso}");
        assert!(login.token().is_none(), "{caso}: el token se borra de la memoria");
        assert_eq!(llavero.contenido(), None, "{caso}: y del llavero");
        let fin = EstadoLogin::Terminada(Fin::CerradaSinServidor);
        assert_eq!(login.estado(Instant::now()), fin, "{caso}");
        assert_eq!(servidor.recibidas().len(), 1, "{caso}: una petición, sin reintentos ni redirecciones");
    }

    // Sin red.
    let destino = nucleo::Destino::nuevo(&format!("http://127.0.0.1:{}", puerto_cerrado())).unwrap();
    let llavero = con_sesion_guardada();
    let login = Login::con_llavero(destino, Some(EQUIPO), None, llavero.clone());
    assert_eq!(login.cerrar_sesion(), Cierre::SoloLocal);
    assert!(login.token().is_none());
    assert_eq!(llavero.contenido(), None);
    assert_eq!(login.estado(Instant::now()), EstadoLogin::Terminada(Fin::CerradaSinServidor));
}

#[test]
fn c4_un_401_con_bearer_al_revocar_cuenta_como_cerrada() {
    // El token ya no valía: el dispositivo está fuera, que es lo que se quería.
    let servidor = Servidor::fijo(token_invalido());
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);
    assert_eq!(login.cerrar_sesion(), Cierre::Revocada);
    assert_eq!(login.estado(Instant::now()), EstadoLogin::Terminada(Fin::Cerrada));
    assert_eq!(llavero.contenido(), None);
    assert_eq!(servidor.recibidas().len(), 1);
}

#[test]
fn c4_el_token_se_borra_antes_de_la_peticion_y_solo_hay_una_revocacion() {
    let servidor = Servidor::fijo(revocado().tras(Duration::from_millis(400)));
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);

    let hilos: Vec<_> = (0..4)
        .map(|_| {
            let login = Arc::clone(&login);
            std::thread::spawn(move || login.cerrar_sesion())
        })
        .collect();
    // Con la revocación todavía en vuelo, el token ya no está en ningún sitio.
    std::thread::sleep(Duration::from_millis(150));
    assert!(login.token().is_none(), "la memoria se borra antes de esperar al servidor");
    assert_eq!(llavero.contenido(), None, "y el llavero también");

    let cierres: Vec<Cierre> = hilos.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(cierres.iter().filter(|c| **c == Cierre::Revocada).count(), 1, "{cierres:?}");
    assert_eq!(cierres.iter().filter(|c| **c == Cierre::SinSesion).count(), 3, "{cierres:?}");
    assert_eq!(servidor.recibidas().len(), 1, "una sola revocación");
    assert_eq!(login.estado(Instant::now()), EstadoLogin::Terminada(Fin::Cerrada));
}

#[test]
fn c4_tras_cerrar_se_puede_volver_a_iniciar_sesion() {
    let servidor = portal(TOKEN_NUEVO);
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);
    let t0 = Instant::now();
    assert_eq!(login.cerrar_sesion(), Cierre::Revocada);

    // Cerrar no cuenta para la pausa entre aperturas del navegador.
    let intento = iniciar(&login, t0);
    assert_eq!(login.estado(t0), EstadoLogin::EnCurso, "el intento nuevo quita el aviso de cierre");
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Sesion);
    assert_eq!(login.estado(t0), EstadoLogin::ConSesion);
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN_NUEVO.as_bytes()));
}

// ---------- Criterio 5: el enlace «Salir» en el proxy ----------

#[test]
fn c5_salir_cierra_la_sesion_y_vuelve_a_la_raiz_que_pinta_el_login() {
    let servidor = portal(TOKEN);
    let llavero = con_sesion_guardada();
    let (login, proxy, navegador) = app(&servidor, &llavero);

    es_vuelta_a_la_raiz(&pedir(&proxy, salir()));
    let revocacion = servidor.unica();
    assert_eq!((revocacion.metodo.as_str(), revocacion.destino.as_str()), ("POST", "/auth/app/revocar"));
    assert_eq!(revocacion.todas("authorization"), [format!("Bearer {TOKEN}")]);
    assert!(login.token().is_none());
    assert_eq!(llavero.contenido(), None);

    // La raíz pinta la pantalla con el aviso, sin red. Un fetch recibe el 401 local.
    es_la_pantalla(&pedir(&proxy, navegar("/")), EstadoLogin::Terminada(Fin::Cerrada));
    es_error_local(&pedir(&proxy, get("/api/x")), 401);
    // Recargar o volver a pulsar no hace nada más.
    es_vuelta_a_la_raiz(&pedir(&proxy, salir()));
    assert_eq!(servidor.recibidas().len(), 1, "nada más llegó al servidor");
    assert!(navegador.abiertas().is_empty(), "salir no abre el navegador");
    assert!(!proxy.sesion_perdida(), "cerrar no es un rechazo del servidor");
}

#[test]
fn c5_salir_acepta_la_consulta_y_las_cabeceras_de_una_navegacion_propia() {
    let propias: [&[(&str, &str)]; 3] = [
        &[],
        &[("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Mode", "navigate"), ("Sec-Fetch-Dest", "document")],
        &[("Sec-Fetch-Site", "none"), ("Sec-Fetch-Mode", "navigate"), ("Sec-Fetch-Dest", "document")],
    ];
    for (ruta, extra) in [("/auth/logout", propias[0]), ("/auth/logout?next=/x", propias[0]), ("/auth/logout", propias[1]), ("/auth/logout", propias[2])] {
        let servidor = Servidor::fijo(revocado());
        let llavero = con_sesion_guardada();
        let (login, proxy, _navegador) = app(&servidor, &llavero);
        es_vuelta_a_la_raiz(&pedir(&proxy, navegar_con(ruta, extra)));
        assert!(login.token().is_none(), "{ruta} {extra:?}");
        // Nada de la petición viaja en la revocación.
        assert_eq!(servidor.unica().destino, "/auth/app/revocar");
    }
}

#[test]
fn c5_solo_la_navegacion_get_exacta_cierra_la_sesion() {
    let servidor = Servidor::ok();
    let llavero = con_sesion_guardada();
    let (login, proxy, _navegador) = app(&servidor, &llavero);
    let propio = |metodo: &str, ruta: &str| {
        peticion(metodo, ruta)
            .header("Origin", "https://portal.localhost")
            .header("Accept", "text/html")
            .body(Vec::new())
            .unwrap()
    };
    let documento = [("Sec-Fetch-Mode", "navigate"), ("Sec-Fetch-Dest", "document")];
    let mut intentos: Vec<(String, Request<Vec<u8>>)> = vec![
        // Lo que puede lanzar el contenido de una página sin que nadie pulse nada.
        ("fetch o imagen (sin Accept html)".into(), get(RUTA_SALIR)),
        ("imagen".into(), peticion("GET", RUTA_SALIR).header("Accept", "image/avif,image/webp,*/*").body(Vec::new()).unwrap()),
        ("GET con Origin".into(), propio("GET", RUTA_SALIR)),
        ("POST".into(), propio("POST", RUTA_SALIR)),
        ("PUT".into(), propio("PUT", RUTA_SALIR)),
        ("DELETE".into(), propio("DELETE", RUTA_SALIR)),
        ("marco".into(), navegar_con(RUTA_SALIR, &[("Sec-Fetch-Site", "same-origin"), ("Sec-Fetch-Mode", "navigate"), ("Sec-Fetch-Dest", "iframe")])),
        ("imagen con Accept html".into(), navegar_con(RUTA_SALIR, &[("Sec-Fetch-Mode", "no-cors"), ("Sec-Fetch-Dest", "image")])),
        ("fetch con Accept html".into(), navegar_con(RUTA_SALIR, &[("Sec-Fetch-Mode", "cors"), ("Sec-Fetch-Dest", "empty")])),
        ("destino repetido".into(), navegar_con(RUTA_SALIR, &[("Sec-Fetch-Mode", "navigate"), ("Sec-Fetch-Dest", "document"), ("Sec-Fetch-Dest", "document")])),
        // La navegación desde una página de origen opaco pasa la regla de origen de A0, pero no cierra.
        ("desde otro sitio".into(), navegar_con(RUTA_SALIR, &[("Sec-Fetch-Site", "cross-site"), documento[0], documento[1]])),
        ("desde el mismo sitio".into(), navegar_con(RUTA_SALIR, &[("Sec-Fetch-Site", "same-site"), documento[0], documento[1]])),
        ("precarga".into(), navegar_con(RUTA_SALIR, &[("Sec-Purpose", "prefetch")])),
        ("precarga antigua".into(), navegar_con(RUTA_SALIR, &[("Purpose", "prefetch")])),
    ];
    for ruta in [
        "/auth/logout/",
        "/auth/logout/x",
        "/auth/LOGOUT",
        "/AUTH/logout",
        "/auth/%6Cogout",
        "/auth//logout",
        "/auth/logout%20",
        "/auth/logoutx",
        "/auth/signed-out",
        "/auth/login",
        "/auth",
    ] {
        intentos.push((format!("navegar a {ruta}"), navegar(ruta)));
    }
    for (caso, intento) in intentos {
        es_error_local(&pedir(&proxy, intento), 404);
        assert_eq!(login.token(), Some(token()), "{caso}: la sesión sigue");
        assert_eq!(login.estado(Instant::now()), EstadoLogin::ConSesion, "{caso}");
    }
    // Un HEAD tampoco: es un 404 local, sin cuerpo.
    let head = peticion("HEAD", RUTA_SALIR).header("Accept", "text/html").body(Vec::new()).unwrap();
    assert_eq!(pedir(&proxy, head).status().as_u16(), 404);
    assert_eq!(login.token(), Some(token()), "HEAD: la sesión sigue");

    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN.as_bytes()));
    assert_eq!(llavero.borrados(), 0);
    assert_eq!(servidor.conexiones(), 0, "nada de esto llega al servidor");

    // Guarda: lo que solo se parece a la ruta se sigue reenviando.
    assert_eq!(pedir(&proxy, navegar("/x/auth/logout")).status().as_u16(), 200);
    assert_eq!(servidor.unica().destino, "/x/auth/logout");
}

#[test]
fn c5_sin_sesion_salir_vuelve_a_la_raiz_sin_red_y_sin_cambiar_el_estado() {
    let servidor = Servidor::fijo(revocado());
    let llavero = LlaveroFalso::vacio();
    let (login, proxy, _navegador) = app(&servidor, &llavero);
    es_vuelta_a_la_raiz(&pedir(&proxy, salir()));
    assert_eq!(login.estado(Instant::now()), EstadoLogin::SinSesion);
    es_la_pantalla(&pedir(&proxy, navegar("/")), EstadoLogin::SinSesion);

    let intento = iniciar(&login, Instant::now());
    es_vuelta_a_la_raiz(&pedir(&proxy, salir()));
    assert_eq!(login.estado(Instant::now()), EstadoLogin::EnCurso, "salir no cancela un login a medias");
    assert_eq!(servidor.conexiones(), 0);
    let _ = intento;
}

#[test]
fn c5_si_la_revocacion_falla_salir_responde_igual_y_la_pantalla_lo_dice() {
    let servidor = Servidor::fijo(Respuesta::nueva(503, b"{\"error\":\"DETALLE-INTERNO\"}"));
    let llavero = con_sesion_guardada();
    let (login, proxy, _navegador) = app(&servidor, &llavero);
    es_vuelta_a_la_raiz(&pedir(&proxy, salir()));
    assert!(login.token().is_none());
    assert_eq!(llavero.contenido(), None);
    let pantalla = pedir(&proxy, navegar("/"));
    es_la_pantalla(&pantalla, EstadoLogin::Terminada(Fin::CerradaSinServidor));
    let html = texto(&pantalla);
    assert!(!html.contains("DETALLE-INTERNO") && !html.contains("503"), "sin detalles del servidor");
    assert_eq!(servidor.recibidas().len(), 1);
}

#[test]
fn c5_un_proxy_sin_login_no_tiene_salir() {
    let servidor = Servidor::ok();
    for fuente in [con_token(), sin_token()] {
        let proxy = Proxy::nuevo(servidor.destino(), fuente, limites());
        es_error_local(&pedir(&proxy, salir()), 404);
    }
    assert_eq!(servidor.conexiones(), 0);
}

// ---------- Criterio 6: el 401 completo ----------

#[test]
fn c6_un_token_guardado_que_el_servidor_rechaza_no_ensena_json_y_se_borra() {
    // Arranque con un token en el llavero que el servidor ya no acepta.
    let servidor = portal(TOKEN_NUEVO);
    let llavero = con_sesion_guardada();
    let (login, proxy, navegador) = app(&servidor, &llavero);

    // La primera navegación pinta la pantalla de login con su aviso, no el JSON del 401.
    let pantalla = pedir(&proxy, navegar("/"));
    es_la_pantalla(&pantalla, EstadoLogin::Terminada(Fin::Caducada));
    assert!(!texto(&pantalla).contains("Token inv"), "nada del cuerpo del 401");
    assert!(proxy.sesion_perdida());
    assert!(login.token().is_none());
    assert_eq!(llavero.contenido(), None, "el token rechazado se borra del llavero");
    assert_eq!(servidor.recibidas().len(), 1);

    // Las siguientes ya no salen a la red.
    es_la_pantalla(&pedir(&proxy, navegar("/uuv/")), EstadoLogin::Terminada(Fin::Caducada));
    es_error_local(&pedir(&proxy, get("/api/x")), 401);
    assert_eq!(servidor.recibidas().len(), 1);

    // El siguiente arranque no encuentra nada, y un login nuevo vuelve a guardar.
    assert_eq!(login_con(&servidor, &llavero).estado(Instant::now()), EstadoLogin::SinSesion);
    let pulsar = peticion("POST", RUTA_INICIAR)
        .header("Origin", "https://portal.localhost")
        .body(Vec::new())
        .unwrap();
    assert_eq!(pedir(&proxy, pulsar).status().as_u16(), 303);
    let intento = partir_url(&servidor.origen, &navegador.abiertas()[0]);
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), Instant::now()), Recibido::Sesion);
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN_NUEVO.as_bytes()));
    assert_eq!(texto(&pedir(&proxy, navegar("/"))), "<h1>portal</h1>");
}

#[test]
fn c6_un_401_en_un_fetch_o_un_subrecurso_pasa_tal_cual_y_la_siguiente_navegacion_pinta_el_login() {
    let peticiones: Vec<(&str, Request<Vec<u8>>)> = vec![
        ("fetch", get("/api/comentarios/")),
        ("imagen", peticion("GET", "/logo.svg").header("Accept", "image/svg+xml,image/*").body(Vec::new()).unwrap()),
        (
            "escritura",
            peticion("PUT", "/api/hardware/x")
                .header("Origin", "https://portal.localhost")
                .header("Content-Type", "application/json")
                .body(b"{}".to_vec())
                .unwrap(),
        ),
    ];
    for (caso, subrecurso) in peticiones {
        let servidor = Servidor::fijo(token_invalido());
        let llavero = con_sesion_guardada();
        let (login, proxy, _navegador) = app(&servidor, &llavero);

        let rechazo = pedir(&proxy, subrecurso);
        assert_eq!(rechazo.status().as_u16(), 401, "{caso}: el 401 del servidor llega tal cual");
        assert_eq!(texto(&rechazo), "{\"error\":\"Token inv\\u00e1lido\"}", "{caso}");
        assert!(login.token().is_none(), "{caso}");
        assert_eq!(llavero.contenido(), None, "{caso}: también se borra del llavero");
        assert_eq!(login.estado(Instant::now()), EstadoLogin::Terminada(Fin::Caducada), "{caso}");

        es_la_pantalla(&pedir(&proxy, navegar("/uuv/")), EstadoLogin::Terminada(Fin::Caducada));
        assert_eq!(servidor.recibidas().len(), 1, "{caso}: la navegación ya no sale a la red");
    }
}

#[test]
fn c6_un_401_sin_desafio_bearer_no_toca_la_sesion_ni_el_llavero() {
    let servidor = Servidor::fijo(Respuesta::nueva(401, b"{\"login\":null}").con("Content-Type", "application/json"));
    let llavero = con_sesion_guardada();
    let (login, proxy, _navegador) = app(&servidor, &llavero);
    assert_eq!(pedir(&proxy, navegar("/uuv/")).status().as_u16(), 401);
    assert_eq!(pedir(&proxy, get("/auth/me")).status().as_u16(), 401);
    assert_eq!(login.token(), Some(token()));
    assert_eq!(login.estado(Instant::now()), EstadoLogin::ConSesion);
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN.as_bytes()));
    assert_eq!(llavero.borrados(), 0);
}

#[test]
fn c6_rechazar_un_token_viejo_no_borra_el_nuevo_del_llavero() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);
    let t0 = Instant::now();

    login.rechazar(&token_nuevo());
    assert_eq!(login.token(), Some(token()), "rechazar otro token no toca el actual");
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN.as_bytes()));
    assert_eq!(llavero.borrados(), 0);

    login.rechazar(&token());
    assert_eq!(login.estado(t0), EstadoLogin::Terminada(Fin::Caducada));
    assert_eq!(llavero.contenido(), None);

    // Sesión nueva; el 401 de una petición que salió con el token viejo llega después.
    let intento = iniciar(&login, t0);
    assert_eq!(login.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Sesion);
    let borrados = llavero.borrados();
    login.rechazar(&token());
    assert_eq!(login.token(), Some(token_nuevo()));
    assert_eq!(login.estado(t0), EstadoLogin::ConSesion);
    assert_eq!(llavero.contenido().as_deref(), Some(TOKEN_NUEVO.as_bytes()));
    assert_eq!(llavero.borrados(), borrados, "el rechazo tardío no borra nada");
}

#[test]
fn c6_el_aviso_no_pisa_un_cierre_y_si_el_llavero_no_borra_la_memoria_se_limpia_igual() {
    // Tras «Salir», el 401 de una petición que seguía en vuelo no cambia el aviso.
    let servidor = Servidor::fijo(revocado());
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);
    assert_eq!(login.cerrar_sesion(), Cierre::Revocada);
    login.rechazar(&token());
    assert_eq!(login.estado(Instant::now()), EstadoLogin::Terminada(Fin::Cerrada));

    // Un llavero que no deja borrar: la sesión termina igual en esta ejecución.
    let llavero = con_sesion_guardada();
    let login = login_con(&servidor, &llavero);
    llavero.que_no_borre();
    login.rechazar(&token());
    assert!(login.token().is_none());
    assert_eq!(login.estado(Instant::now()), EstadoLogin::Terminada(Fin::Caducada));
    assert!(llavero.borrados() >= 1, "se intentó borrar");
}

// ---------- Criterio 7: los avisos de la pantalla ----------

#[test]
fn c7_los_textos_del_fin_de_la_sesion_son_fijos() {
    assert_eq!(Fin::Cerrada.texto(), "Se cerró la sesión.");
    assert_eq!(Fin::Caducada.texto(), "La sesión caducó. Inicia sesión de nuevo.");
    assert_eq!(
        Fin::CerradaSinServidor.texto(),
        "Se cerró la sesión en este equipo. No se pudo avisar al servidor."
    );
}

#[test]
fn c7_la_pantalla_muestra_el_aviso_del_fin_de_la_sesion_y_nada_mas() {
    let sin = pantalla_de_login(EstadoLogin::SinSesion);
    for fin in FINES {
        let respuesta = pantalla_de_login(EstadoLogin::Terminada(fin));
        assert_eq!(respuesta.status().as_u16(), 200);
        assert_eq!(respuesta.headers(), sin.headers(), "{fin:?}: mismas cabeceras que el resto de pantallas");
        let html = html_de(EstadoLogin::Terminada(fin));
        assert!(html.len() < 4096, "{fin:?}: {} bytes", html.len());

        // Un cierre normal es una noticia; los otros dos son avisos.
        let rol = if fin == Fin::Cerrada { "status" } else { "alert" };
        assert!(
            html.contains(&format!("<p role=\"{rol}\">{}</p>", fin.texto())),
            "{fin:?}: el aviso va en un párrafo con role=\"{rol}\""
        );
        assert_eq!(html.matches("role=\"").count(), 1, "{fin:?}: un solo aviso");
        assert_eq!(html.matches("<p").count(), 1, "{fin:?}: un solo párrafo");
        for otro in FINES.iter().filter(|otro| **otro != fin) {
            assert!(!html.contains(otro.texto()), "{fin:?} no muestra el texto de {otro:?}");
        }
        assert!(!html.contains("No has iniciado sesión.") && !html.contains("Sigue en el navegador"));

        // El único control sigue siendo el formulario del botón.
        assert_eq!(html.matches("<form").count(), 1);
        assert!(html.contains(&format!(
            "<form method=\"post\" action=\"{RUTA_INICIAR}\"><button type=\"submit\">Iniciar sesión</button></form>"
        )));
        assert_eq!(html.matches("<button").count(), 1);
        let minusculas = html.to_lowercase();
        for prohibido in ["<script", "<a ", "<input", "<img", "<iframe", "<link", "http-equiv", "javascript:", "onclick", "/auth/"] {
            assert!(!minusculas.contains(prohibido), "{fin:?}: la pantalla no lleva {prohibido:?}");
        }
    }
}

// ---------- Criterio 8: los secretos ----------

#[test]
fn c8_el_token_no_asoma_en_debug_ni_en_ninguna_respuesta() {
    let servidor = Servidor::nuevo(|peticion| {
        // Un servidor que devuelve el token en todo lo que puede.
        let eco = peticion.una("authorization").unwrap_or_default();
        if peticion.destino == "/auth/app/revocar" {
            Respuesta::nueva(503, format!("{{\"error\":\"{eco}\"}}").as_bytes()).con("X-Eco", &eco)
        } else {
            token_invalido()
        }
    });
    let llavero = con_sesion_guardada();
    let (login, proxy, _navegador) = app(&servidor, &llavero);
    let debug = |login: &Login| {
        format!(
            "{login:?} {:?} {:?} {:?} {:?}",
            login.estado(Instant::now()),
            FalloDeLlavero,
            FINES,
            [Cierre::SinSesion, Cierre::Revocada, Cierre::SoloLocal],
        )
    };
    assert!(!debug(&login).contains("vtd_"), "con sesión: {}", debug(&login));

    // `pedir` comprueba que el token no va en el cuerpo ni en las cabeceras de la respuesta.
    let salida = pedir(&proxy, salir());
    es_vuelta_a_la_raiz(&salida);
    let pantalla = pedir(&proxy, navegar("/"));
    es_la_pantalla(&pantalla, EstadoLogin::Terminada(Fin::CerradaSinServidor));
    assert!(!texto(&pantalla).contains("vtd_") && !texto(&pantalla).contains("Bearer"));
    assert!(!debug(&login).contains("vtd_"), "tras cerrar: {}", debug(&login));

    // El token solo salió hacia el destino, en `Authorization`, y una vez.
    let revocacion = servidor.unica();
    assert_eq!(revocacion.todas("authorization"), [format!("Bearer {TOKEN}")]);
    assert!(!revocacion.destino.contains("vtd_"), "nunca en la URL");
    assert!(!contiene(&revocacion.cuerpo, b"vtd_"), "ni en el cuerpo");
    for (nombre, valor) in &revocacion.cabeceras {
        if !nombre.eq_ignore_ascii_case("authorization") {
            assert!(!valor.contains("vtd_"), "el token aparece en la cabecera {nombre}");
        }
    }

    // Un login con un token caducado tampoco lo enseña.
    let llavero = con_sesion_guardada();
    let (login, proxy, _navegador) = app(&servidor, &llavero);
    let caducada = pedir(&proxy, navegar("/"));
    es_la_pantalla(&caducada, EstadoLogin::Terminada(Fin::Caducada));
    assert!(!debug(&login).contains("vtd_"));
}
