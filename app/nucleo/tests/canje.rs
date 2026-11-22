//! Lote `app-login`, criterio 4: el canje del código contra un servidor HTTP falso, lo que se
//! ignora sin canje y lo que pasa cuando el canje falla. Criterio 8: los secretos no asoman.

mod comun;

use std::sync::Arc;
use std::time::{Duration, Instant};

use comun::login::*;
use comun::{puerto_cerrado, token, Respuesta, Servidor, TOKEN};
use nucleo::{
    desafio_s256, leer_enlace, Aviso, Destino, EstadoLogin, Fin, FuenteDeToken, Inicio, Login, Recibido,
    PAUSA_ENTRE_INICIOS, VIDA_INTENTO,
};

// ---------- Criterio 4: el canje ----------

#[test]
fn c4_el_canje_envia_el_codigo_y_el_verifier_y_guarda_el_token() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let login = login_hacia(&servidor);
    let t0 = Instant::now();
    let intento = iniciar(&login, t0);
    assert_eq!(servidor.conexiones(), 0, "abrir el navegador no toca la red");

    let recibido = login.recibir(&enlace(CODIGO, &intento.state), t0 + Duration::from_secs(30));
    assert_eq!(recibido, Recibido::Sesion);
    assert_eq!(login.token(), Some(token_nuevo()));
    assert_eq!(login.estado(t0 + Duration::from_secs(30)), EstadoLogin::ConSesion);
    // La sesión no caduca con el intento.
    assert_eq!(login.estado(t0 + VIDA_INTENTO * 2), EstadoLogin::ConSesion);

    let peticion = servidor.unica();
    assert_eq!(peticion.metodo, "POST");
    assert_eq!(peticion.destino, "/auth/app/canje");
    assert_eq!(peticion.una("content-type").as_deref(), Some("application/json"));
    for ajena in ["authorization", "cookie", "origin", "referer"] {
        assert!(!peticion.tiene(ajena), "el canje no lleva la cabecera {ajena}");
    }
    assert!(peticion.una("content-length").is_some(), "el cuerpo va con Content-Length");
    assert!(!peticion.tiene("transfer-encoding"));

    // El verifier es de 43 caracteres base64url y es el del challenge que se abrió.
    let verifier = verifier_de(&peticion, CODIGO);
    assert!(es_b64url(&verifier, 43), "verifier: {} caracteres", verifier.len());
    assert_eq!(desafio_s256(&verifier), intento.challenge);
    assert_ne!(verifier, intento.state);
    assert!(!intento.url.contains(&verifier), "el verifier no viaja en la URL del navegador");
}

#[test]
fn c4_sin_login_en_curso_el_enlace_se_ignora_sin_canje() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let t0 = Instant::now();

    // Nunca se pulsó «Iniciar sesión»: es el caso de la app abierta por el propio enlace.
    let login = login_hacia(&servidor);
    assert_eq!(login.recibir(&enlace(CODIGO, STATE_AJENO), t0), Recibido::Ignorado);
    assert_eq!(login.estado(t0), EstadoLogin::SinSesion);

    // El intento caducó.
    let caducado = login_hacia(&servidor);
    let intento = iniciar(&caducado, t0);
    assert_eq!(caducado.recibir(&enlace(CODIGO, &intento.state), t0 + VIDA_INTENTO), Recibido::Ignorado);
    assert_eq!(caducado.estado(t0 + VIDA_INTENTO), EstadoLogin::SinSesion);

    // El navegador no se abrió: no queda intento.
    let roto = login_hacia(&servidor);
    let intento = iniciar(&roto, t0);
    roto.navegador_no_abre();
    assert_eq!(roto.recibir(&enlace(CODIGO, &intento.state), t0), Recibido::Ignorado);
    assert_eq!(roto.estado(t0), EstadoLogin::Fallo(Aviso::NavegadorNoAbre));

    // Ya hay sesión.
    let con = Login::nuevo(servidor.destino(), Some(EQUIPO), Some(token()));
    assert_eq!(con.recibir(&enlace(CODIGO, STATE_AJENO), t0), Recibido::Ignorado);
    assert_eq!(con.token(), Some(token()));

    assert_eq!(servidor.conexiones(), 0, "ningún enlace ignorado llega al servidor");
}

#[test]
fn c4_un_state_distinto_o_una_forma_inesperada_se_ignoran_y_el_intento_sigue() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let login = login_hacia(&servidor);
    let t0 = Instant::now();
    let intento = iniciar(&login, t0);
    let bueno = enlace(CODIGO, &intento.state);

    let mut casi = intento.state.clone().into_bytes();
    casi[42] = if casi[42] == b'A' { b'B' } else { b'A' };
    let casi = String::from_utf8(casi).unwrap();

    for malo in [
        enlace(CODIGO, STATE_AJENO),
        enlace(CODIGO, &casi),
        enlace(CODIGO, &intento.state[..42]),
        enlace(CODIGO, &intento.state.to_uppercase()),
        enlace(CODIGO, &intento.challenge),
        format!("{bueno}&x=1"),
        format!("{bueno}#x"),
        format!("{bueno} "),
        bueno.replacen("vanttec-docs://auth?", "vanttec-docs://auth/?", 1),
        bueno.replacen("vanttec-docs:", "VANTTEC-DOCS:", 1),
        format!("vanttec-docs://auth?state={}&code={CODIGO}", intento.state),
        format!("vanttec-docs://auth?code={}&state={}", &CODIGO[..42], intento.state),
        String::new(),
        "--flag".to_string(),
    ] {
        assert_eq!(login.recibir(&malo, t0), Recibido::Ignorado, "debe ignorarse {malo:?}");
        assert_eq!(login.estado(t0), EstadoLogin::EnCurso, "tras {malo:?} el intento sigue vivo");
    }
    assert_eq!(servidor.conexiones(), 0, "nada de lo ignorado llega al servidor");

    // Un enlace ajeno no gasta el intento: el bueno todavía sirve.
    assert_eq!(login.recibir(&bueno, t0), Recibido::Sesion);
    assert_eq!(servidor.recibidas().len(), 1);
}

#[test]
fn c4_el_enlace_de_un_intento_sustituido_se_ignora() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let login = login_hacia(&servidor);
    let t0 = Instant::now();
    let viejo = iniciar(&login, t0);
    let t1 = t0 + PAUSA_ENTRE_INICIOS;
    let nuevo = iniciar(&login, t1);

    assert_eq!(login.recibir(&enlace(CODIGO, &viejo.state), t1), Recibido::Ignorado);
    assert_eq!(servidor.conexiones(), 0);
    assert_eq!(login.estado(t1), EstadoLogin::EnCurso);

    assert_eq!(login.recibir(&enlace(CODIGO, &nuevo.state), t1), Recibido::Sesion);
    let verifier = verifier_de(&servidor.unica(), CODIGO);
    assert_eq!(desafio_s256(&verifier), nuevo.challenge, "el verifier es el del intento nuevo");
}

#[test]
fn c4_un_enlace_repetido_no_se_canjea_dos_veces() {
    // Uno detrás de otro, con éxito.
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let login = login_hacia(&servidor);
    let t0 = Instant::now();
    let bueno = enlace(CODIGO, &iniciar(&login, t0).state);
    assert_eq!(login.recibir(&bueno, t0), Recibido::Sesion);
    assert_eq!(login.recibir(&bueno, t0), Recibido::Ignorado);
    assert_eq!(servidor.recibidas().len(), 1);

    // A la vez: solo uno llega al servidor.
    let lento = Servidor::fijo(canje_ok(TOKEN_NUEVO).tras(Duration::from_millis(300)));
    let login = login_hacia(&lento);
    let bueno = enlace(CODIGO, &iniciar(&login, t0).state);
    let hilos: Vec<_> = (0..4)
        .map(|_| {
            let (login, bueno) = (Arc::clone(&login), bueno.clone());
            std::thread::spawn(move || login.recibir(&bueno, t0))
        })
        .collect();
    let resultados: Vec<Recibido> = hilos.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(resultados.iter().filter(|r| **r == Recibido::Sesion).count(), 1, "{resultados:?}");
    assert_eq!(resultados.iter().filter(|r| **r == Recibido::Ignorado).count(), 3, "{resultados:?}");
    assert_eq!(lento.recibidas().len(), 1, "un solo canje");
    assert_eq!(login.token(), Some(token_nuevo()));
}

#[test]
fn c4_mientras_dura_el_canje_no_se_abre_otro_intento() {
    let lento = Servidor::fijo(canje_ok(TOKEN_NUEVO).tras(Duration::from_millis(400)));
    let login = login_hacia(&lento);
    let t0 = Instant::now();
    let bueno = enlace(CODIGO, &iniciar(&login, t0).state);
    let hilo = {
        let login = Arc::clone(&login);
        std::thread::spawn(move || login.recibir(&bueno, t0))
    };
    std::thread::sleep(Duration::from_millis(150));
    let despues = t0 + PAUSA_ENTRE_INICIOS * 2;
    assert_eq!(login.estado(despues), EstadoLogin::EnCurso, "el canje en vuelo cuenta como en curso");
    assert_eq!(login.iniciar(despues), Inicio::Esperar, "ni pasada la pausa");
    assert!(login.token().is_none());
    assert_eq!(hilo.join().unwrap(), Recibido::Sesion);
    assert_eq!(login.estado(despues), EstadoLogin::ConSesion);
}

/// Hace un intento contra `servidor`, entrega el enlace bueno y devuelve el login y el enlace.
fn canje_contra(destino: Destino, t0: Instant) -> (Login, String, Recibido) {
    let login = Login::nuevo(destino, Some(EQUIPO), None);
    let bueno = enlace(CODIGO, &iniciar(&login, t0).state);
    let recibido = login.recibir(&bueno, t0);
    (login, bueno, recibido)
}

#[test]
fn c4_un_canje_fallido_deja_un_aviso_y_ninguna_sesion() {
    let json = |estado: u16, cuerpo: &str| {
        Respuesta::nueva(estado, cuerpo.as_bytes()).con("Content-Type", "application/json; charset=utf-8")
    };
    let grande = format!("{{\"relleno\":\"{}\",\"token\":\"{TOKEN_NUEVO}\"}}", "a".repeat(8000));
    let casos: Vec<(&str, Respuesta, Aviso)> = vec![
        ("400 del servidor", json(400, "{\"error\":\"Código inválido o caducado\"}"), Aviso::NoSePudo),
        ("401", json(401, "{\"error\":\"x\"}").con("WWW-Authenticate", "Bearer"), Aviso::NoSePudo),
        ("403", json(403, "{\"error\":\"x\"}"), Aviso::NoSePudo),
        ("404", json(404, "{\"error\":\"x\"}"), Aviso::NoSePudo),
        ("415", json(415, "{\"error\":\"Se requiere application/json\"}"), Aviso::NoSePudo),
        (
            "429",
            json(429, "{\"error\":\"Demasiadas peticiones; espera un momento\"}").con("Retry-After", "42"),
            Aviso::DemasiadosIntentos,
        ),
        ("500", json(500, "{\"error\":\"x\"}"), Aviso::SinConexion),
        ("502", Respuesta::nueva(502, b"<html>Bad gateway</html>"), Aviso::SinConexion),
        ("503", json(503, "{\"error\":\"Canje no disponible\"}"), Aviso::SinConexion),
        ("200 que no es JSON", Respuesta::nueva(200, b"<html>hola</html>"), Aviso::NoSePudo),
        ("200 vacío", json(200, ""), Aviso::NoSePudo),
        ("200 sin token", json(200, "{\"expira\":\"2026-12-22T00:00:00.000Z\",\"login\":\"x\"}"), Aviso::NoSePudo),
        ("200 con token que no es texto", json(200, "{\"token\":123}"), Aviso::NoSePudo),
        ("200 con token nulo", json(200, "{\"token\":null}"), Aviso::NoSePudo),
        ("200 con token sin forma", json(200, "{\"token\":\"abc\"}"), Aviso::NoSePudo),
        (
            "200 con token de otro prefijo",
            json(200, "{\"token\":\"ghp_NUEVO0123456789abcdefghijklmnopqrstuvwxy-_Z\"}"),
            Aviso::NoSePudo,
        ),
        (
            "200 con token con salto de línea",
            json(200, "{\"token\":\"vtd_NUEVO0123456789abcdefghijklmnopqrstuvw\\r\\nX: y\"}"),
            Aviso::NoSePudo,
        ),
        ("200 con una lista", json(200, &format!("[\"{TOKEN_NUEVO}\"]")), Aviso::NoSePudo),
        ("200 de más de 4 KiB", json(200, &grande), Aviso::NoSePudo),
        ("204", Respuesta::nueva(204, b""), Aviso::NoSePudo),
        ("302", Respuesta::nueva(302, b"").con("Location", "/auth/app/canje2"), Aviso::NoSePudo),
    ];
    let t0 = Instant::now();
    for (caso, respuesta, aviso) in casos {
        let servidor = Servidor::fijo(respuesta);
        let (login, bueno, recibido) = canje_contra(servidor.destino(), t0);
        assert_eq!(recibido, Recibido::Fallo, "{caso}");
        assert_eq!(login.estado(t0), EstadoLogin::Fallo(aviso), "{caso}");
        assert!(login.token().is_none(), "{caso}: un canje fallido no deja token");
        assert_eq!(servidor.recibidas().len(), 1, "{caso}: un solo intento, sin reintentos ni redirecciones");

        // El código es de un solo uso: el mismo enlace ya no hace nada.
        assert_eq!(login.recibir(&bueno, t0), Recibido::Ignorado, "{caso}");
        assert_eq!(servidor.recibidas().len(), 1, "{caso}");
        assert_eq!(login.estado(t0), EstadoLogin::Fallo(aviso), "{caso}");

        // Se puede volver a empezar, pasada la pausa.
        assert_eq!(login.iniciar(t0 + Duration::from_secs(1)), Inicio::Esperar, "{caso}");
        iniciar(&login, t0 + PAUSA_ENTRE_INICIOS);
        assert_eq!(login.estado(t0 + PAUSA_ENTRE_INICIOS), EstadoLogin::EnCurso, "{caso}");
    }
}

#[test]
fn c4_sin_red_el_canje_falla_con_sin_conexion() {
    let cerrado = Destino::nuevo(&format!("http://127.0.0.1:{}", puerto_cerrado())).unwrap();
    let t0 = Instant::now();
    let (login, bueno, recibido) = canje_contra(cerrado, t0);
    assert_eq!(recibido, Recibido::Fallo);
    assert_eq!(login.estado(t0), EstadoLogin::Fallo(Aviso::SinConexion));
    assert!(login.token().is_none());
    assert_eq!(login.recibir(&bueno, t0), Recibido::Ignorado, "tampoco se reintenta al volver la red");
}

#[test]
fn c4_un_rechazo_tardio_no_borra_un_token_nuevo() {
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let t0 = Instant::now();
    // Arranca con un token (el de desarrollo) que el servidor rechaza. app-sesion: el estado
    // tras un rechazo ya no es `SinSesion`, sino `Terminada(Caducada)`, para que la pantalla lo diga.
    let login = Login::nuevo(servidor.destino(), Some(EQUIPO), Some(token()));
    login.rechazar(&token_nuevo());
    assert_eq!(login.token(), Some(token()), "rechazar otro token no toca el actual");
    login.rechazar(&token());
    assert!(login.token().is_none());
    assert_eq!(login.estado(t0), EstadoLogin::Terminada(Fin::Caducada));

    // Sesión nueva; el rechazo del token viejo llega después.
    let bueno = enlace(CODIGO, &iniciar(&login, t0).state);
    assert_eq!(login.recibir(&bueno, t0), Recibido::Sesion);
    login.rechazar(&token());
    assert_eq!(login.token(), Some(token_nuevo()));
    assert_eq!(login.estado(t0), EstadoLogin::ConSesion);

    login.rechazar(&token_nuevo());
    assert!(login.token().is_none());
    assert_eq!(login.estado(t0), EstadoLogin::Terminada(Fin::Caducada));
}

// ---------- Criterio 8: los secretos ----------

#[test]
fn c8_el_verifier_el_codigo_el_state_y_el_token_no_asoman_en_debug() {
    let t0 = Instant::now();
    let leido = leer_enlace(&enlace(CODIGO, STATE_AJENO)).expect("enlace bien formado");
    let texto = format!("{leido:?} {:?}", Some(&leido));
    assert!(!texto.contains(CODIGO) && !texto.contains(STATE_AJENO), "Debug del enlace: {texto}");

    // Con éxito.
    let servidor = Servidor::fijo(canje_ok(TOKEN_NUEVO));
    let login = login_hacia(&servidor);
    let intento = iniciar(&login, t0);
    let antes = format!("{login:?} {:?}", login.estado(t0));
    let recibido = login.recibir(&enlace(CODIGO, &intento.state), t0);
    let verifier = verifier_de(&servidor.unica(), CODIGO);
    let despues = format!("{login:?} {:?} {recibido:?} {:?}", login.estado(t0), login.token());
    for texto in [&antes, &despues] {
        for secreto in [CODIGO, TOKEN_NUEVO, &verifier, &intento.state, &intento.challenge] {
            assert!(!texto.contains(secreto), "un secreto asoma en {texto:?}");
        }
    }

    // Con fallo, aunque el servidor devuelva los secretos en su error.
    let eco = Servidor::nuevo(|peticion| {
        let cuerpo = String::from_utf8_lossy(&peticion.cuerpo).into_owned();
        Respuesta::nueva(400, format!("{{\"error\":{cuerpo:?}}}").as_bytes())
            .con("Content-Type", "application/json")
    });
    let login = login_hacia(&eco);
    let intento = iniciar(&login, t0);
    let recibido = login.recibir(&enlace(CODIGO, &intento.state), t0);
    let verifier = verifier_de(&eco.unica(), CODIGO);
    let estado = login.estado(t0);
    let aviso = match estado {
        EstadoLogin::Fallo(aviso) => aviso.texto(),
        otro => panic!("se esperaba un fallo y fue {otro:?}"),
    };
    let texto = format!("{login:?} {estado:?} {recibido:?} {aviso}");
    for secreto in [CODIGO, &verifier, &intento.state, TOKEN, "error"] {
        assert!(!texto.contains(secreto), "un secreto o el error del servidor asoma en {texto:?}");
    }
}
