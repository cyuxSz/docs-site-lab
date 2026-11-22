//! Lote `app-login`, la parte sin red: PKCE y la URL de inicio (criterio 1), la forma del enlace
//! de vuelta (criterio 2) y la máquina de estados del login (criterio 3).

mod comun;

use std::collections::HashSet;
use std::time::{Duration, Instant};

use comun::login::*;
use comun::{token, Servidor};
use nucleo::{
    desafio_s256, leer_enlace, nombre_de_dispositivo, Aviso, Destino, EstadoLogin, FuenteDeToken, Inicio,
    Login, ESQUEMA, ESQUEMA_ENLACE, NOMBRE_POR_DEFECTO, PAUSA_ENTRE_INICIOS, PLATAFORMA, RUTA_INICIAR,
    VAR_NOMBRE_EQUIPO, VIDA_INTENTO,
};

fn login_sin_sesion() -> Login {
    Login::nuevo(Destino::produccion(), Some(EQUIPO), None)
}

// ---------- Criterio 1: PKCE y la URL de inicio ----------

#[test]
fn c1_las_constantes_del_login_son_fijas() {
    assert_eq!(ESQUEMA_ENLACE, "vanttec-docs");
    assert_ne!(ESQUEMA_ENLACE, ESQUEMA, "el esquema del enlace no puede ser el del origen de la app");
    assert_eq!(RUTA_INICIAR, "/__app/iniciar");
    assert_eq!(PLATAFORMA, "windows");
    assert_eq!(VAR_NOMBRE_EQUIPO, "COMPUTERNAME");
    assert_eq!(NOMBRE_POR_DEFECTO, "PC con Windows");
    assert_eq!(VIDA_INTENTO, Duration::from_secs(600));
    assert_eq!(PAUSA_ENTRE_INICIOS, Duration::from_secs(5));
}

#[test]
fn c1_el_challenge_es_el_s256_del_verifier() {
    // Vector del apéndice B de la RFC 7636.
    assert_eq!(
        desafio_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
    // SHA-256 de la cadena vacía, en base64url sin relleno.
    assert_eq!(desafio_s256(""), "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
}

#[test]
fn c1_iniciar_devuelve_la_url_de_consentimiento_sobre_el_destino() {
    let ahora = Instant::now();
    let login = login_sin_sesion();
    assert_eq!(login.destino().origen(), "https://docs.vanttec.workers.dev");
    // `iniciar` (la ayuda) exige la forma exacta: origen del destino, la ruta, los cuatro
    // parámetros en su orden, challenge y state de 43 caracteres base64url y `windows`.
    let intento = iniciar(&login, ahora);
    assert_eq!(intento.nombre, EQUIPO);
    assert_ne!(intento.challenge, intento.state);

    // Sobre un destino de desarrollo, la URL cuelga de ese origen y de ningún otro.
    let local = Login::nuevo(Destino::nuevo("http://localhost:8795/").unwrap(), Some(EQUIPO), None);
    let intento = iniciar(&local, ahora);
    assert!(intento.url.starts_with("http://localhost:8795/auth/app/iniciar?challenge="));
}

#[test]
fn c1_cada_intento_estrena_challenge_y_state() {
    let ahora = Instant::now();
    let mut vistos = HashSet::new();
    for _ in 0..24 {
        let intento = iniciar(&login_sin_sesion(), ahora);
        assert!(vistos.insert(intento.challenge.clone()), "challenge repetido");
        assert!(vistos.insert(intento.state.clone()), "state repetido");
    }
    assert_eq!(vistos.len(), 48);
}

#[test]
fn c1_el_nombre_del_dispositivo_se_limpia() {
    for (crudo, esperado) in [
        (Some("DESKTOP-AB12CD"), "DESKTOP-AB12CD"),
        (Some("  PC de Iván  "), "PC de Iván"),
        (Some("mi_pc.local"), "mi_pc.local"),
        // Todo lo que no es letra, número, espacio, `-`, `_` o `.` se quita.
        (Some("PC\r\nde<b>&\"x\""), "PCdebx"),
        (Some("a\u{202E}b\u{0000}c%41/\\?#"), "abc41"),
        (None, NOMBRE_POR_DEFECTO),
        (Some(""), NOMBRE_POR_DEFECTO),
        (Some("   "), NOMBRE_POR_DEFECTO),
        (Some("\u{202E}\t\n<>"), NOMBRE_POR_DEFECTO),
    ] {
        assert_eq!(nombre_de_dispositivo(crudo), esperado, "nombre de {crudo:?}");
    }
    // Como mucho 30 caracteres, y sin espacios en los extremos después de cortar.
    assert_eq!(nombre_de_dispositivo(Some(&"A".repeat(100))), "A".repeat(30));
    assert_eq!(nombre_de_dispositivo(Some(&format!("{} B", "A".repeat(29)))), "A".repeat(29));
    assert_eq!(nombre_de_dispositivo(Some(&"ñ".repeat(40))).chars().count(), 30);
}

#[test]
fn c1_el_nombre_viaja_codificado_y_no_puede_anadir_parametros() {
    let ahora = Instant::now();
    let destino = || Destino::nuevo("http://127.0.0.1:8795").unwrap();
    let con_tilde = Login::nuevo(destino(), Some("PC de Iván"), None);
    assert_eq!(iniciar(&con_tilde, ahora).nombre, "PC%20de%20Iv%C3%A1n");

    let sin_nombre = Login::nuevo(destino(), None, None);
    assert_eq!(iniciar(&sin_nombre, ahora).nombre, "PC%20con%20Windows");

    // Un nombre hostil no rompe la URL: `partir_url` exige cuatro parámetros exactos.
    let hostil = Login::nuevo(destino(), Some("x&plataforma=ios&state=y#z=1 %26"), None);
    let intento = iniciar(&hostil, ahora);
    assert_eq!(intento.nombre, "xplataformaiosstateyz1%2026");
}

// ---------- Criterio 2: la forma del enlace ----------

#[test]
fn c2_un_enlace_con_la_forma_del_servidor_se_lee() {
    assert!(es_b64url(CODIGO, 43) && es_b64url(STATE_AJENO, 43), "las constantes de prueba");
    let leido = leer_enlace(&enlace(CODIGO, STATE_AJENO)).expect("el enlace del servidor se lee");
    assert_eq!(leido.codigo(), CODIGO);
    assert_eq!(leido.state(), STATE_AJENO);

    // El servidor admite un state de 22 a 128 caracteres.
    for largo in [22, 128] {
        let state = "s".repeat(largo);
        let leido = leer_enlace(&enlace(CODIGO, &state)).expect("state en el rango del servidor");
        assert_eq!(leido.state(), state);
    }
}

/// Medido en Windows 11: cuando el enlace se abre por el registro (`cmd /c start`, `rundll32
/// url.dll,FileProtocolHandler`, `Start-Process`), la segunda instancia lo recibe con una `/`
/// tras `auth`. Es la vía normal del login, así que esa forma, y solo esa, también se lee.
#[test]
fn c2_un_enlace_con_barra_tras_auth_se_lee_igual() {
    let con_barra = |codigo: &str, state: &str| format!("vanttec-docs://auth/?code={codigo}&state={state}");

    let leido = leer_enlace(&con_barra(CODIGO, STATE_AJENO)).expect("el enlace que entrega Windows se lee");
    assert_eq!(leido.codigo(), CODIGO);
    assert_eq!(leido.state(), STATE_AJENO);
    // Las dos formas dan lo mismo: la barra no entra ni en el código ni en el state.
    assert!(Some(leido) == leer_enlace(&enlace(CODIGO, STATE_AJENO)), "las dos formas se leen igual");

    for largo in [22, 128] {
        let state = "s".repeat(largo);
        let leido = leer_enlace(&con_barra(CODIGO, &state)).expect("state en el rango del servidor");
        assert_eq!(leido.codigo(), CODIGO);
        assert_eq!(leido.state(), state);
    }
}

/// La barra no relaja nada más: con ella, el resto del enlace se exige igual de exacto.
#[test]
fn c2_la_barra_tras_auth_no_admite_ninguna_otra_variante() {
    let c = CODIGO;
    let s = STATE_AJENO;
    let malos: Vec<String> = vec![
        "vanttec-docs://auth/".into(),
        "vanttec-docs://auth/?".into(),
        format!("vanttec-docs://auth/?code={c}"),
        format!("vanttec-docs://auth/?state={s}&code={c}"),
        format!("vanttec-docs://auth/?code={c}&state={s}&x=1"),
        format!("vanttec-docs://auth/?x=1&code={c}&state={s}"),
        format!("vanttec-docs://auth/?code={c}&code={c}&state={s}"),
        format!("vanttec-docs://auth/?code={c}&state={s}&state={s}"),
        format!("vanttec-docs://auth/?code={c}&state={s}&"),
        format!("vanttec-docs://auth/?code={c}&state={s}#x"),
        format!("vanttec-docs://auth/?code={c}&state={s}/"),
        format!("vanttec-docs://auth/?code={c}&state={s} "),
        format!("vanttec-docs://auth/?code={c}&state={s}\n"),
        format!("vanttec-docs://auth/?code={}&state={s}", &c[..42]),
        format!("vanttec-docs://auth/?code={c}A&state={s}"),
        format!("vanttec-docs://auth/?code={c}&state={}", "s".repeat(21)),
        format!("vanttec-docs://auth/?code={c}&state={}", "s".repeat(129)),
        format!("vanttec-docs://auth/?Code={c}&state={s}"),
        // Una sola barra, y justo antes de `?`.
        format!("vanttec-docs://auth//?code={c}&state={s}"),
        format!("vanttec-docs://auth///?code={c}&state={s}"),
        format!("vanttec-docs://auth/x?code={c}&state={s}"),
        format!("vanttec-docs://auth/x/?code={c}&state={s}"),
        format!("vanttec-docs://auth/./?code={c}&state={s}"),
        format!("vanttec-docs://auth/../auth/?code={c}&state={s}"),
        format!("vanttec-docs://auth/ ?code={c}&state={s}"),
        format!("vanttec-docs://auth/#?code={c}&state={s}"),
        format!("vanttec-docs://auth/??code={c}&state={s}"),
        format!("vanttec-docs://auth?/code={c}&state={s}"),
        format!("vanttec-docs://auth/code={c}&state={s}"),
        format!("vanttec-docs://auth\\?code={c}&state={s}"),
        format!("vanttec-docs://auth%2F?code={c}&state={s}"),
        format!("vanttec-docs://auth%2f?code={c}&state={s}"),
        format!("vanttec-docs://auth/%3Fcode={c}&state={s}"),
        // Sin medida, ninguna otra normalización: ni caja, ni puerto, ni usuario, ni otro host.
        format!("VANTTEC-DOCS://auth/?code={c}&state={s}"),
        format!("Vanttec-Docs://auth/?code={c}&state={s}"),
        format!("vanttec-docs://AUTH/?code={c}&state={s}"),
        format!("vanttec-docs://Auth/?code={c}&state={s}"),
        format!("vanttec-docs://auth:443/?code={c}&state={s}"),
        format!("vanttec-docs://u@auth/?code={c}&state={s}"),
        format!("vanttec-docs://auth./?code={c}&state={s}"),
        format!("vanttec-docs://otra/?code={c}&state={s}"),
        format!("vanttec-docs://authx/?code={c}&state={s}"),
        format!("vanttec-docs:/auth/?code={c}&state={s}"),
        format!("vanttec-docs:auth/?code={c}&state={s}"),
        format!("vanttec-docs:///auth/?code={c}&state={s}"),
        format!("vanttec-docsx://auth/?code={c}&state={s}"),
        format!("portal://auth/?code={c}&state={s}"),
        format!("https://auth/?code={c}&state={s}"),
        format!(" vanttec-docs://auth/?code={c}&state={s}"),
        format!("\"vanttec-docs://auth/?code={c}&state={s}\""),
    ];
    for malo in &malos {
        assert!(leer_enlace(malo).is_none(), "no debe leerse {malo:?}");
    }
}

#[test]
fn c2_un_enlace_con_otra_forma_no_se_lee() {
    let c = CODIGO;
    let s = STATE_AJENO;
    let malos: Vec<String> = vec![
        String::new(),
        "vanttec-docs://auth".into(),
        "vanttec-docs://auth?".into(),
        format!("vanttec-docs://auth?code={c}"),
        format!("vanttec-docs://auth?state={s}"),
        // El orden es el del servidor: primero `code`.
        format!("vanttec-docs://auth?state={s}&code={c}"),
        // Parámetros de más, repetidos o vacíos.
        format!("vanttec-docs://auth?code={c}&state={s}&x=1"),
        format!("vanttec-docs://auth?x=1&code={c}&state={s}"),
        format!("vanttec-docs://auth?code={c}&code={c}&state={s}"),
        format!("vanttec-docs://auth?code={c}&state={s}&state={s}"),
        format!("vanttec-docs://auth?code={c}&state={s}&"),
        format!("vanttec-docs://auth?code=&state={s}"),
        format!("vanttec-docs://auth?code={c}&state="),
        format!("vanttec-docs://auth?Code={c}&state={s}"),
        format!("vanttec-docs://auth?code={c}&State={s}"),
        // Código o state fuera de su forma.
        format!("vanttec-docs://auth?code={}&state={s}", &c[..42]),
        format!("vanttec-docs://auth?code={c}A&state={s}"),
        format!("vanttec-docs://auth?code={}=&state={s}", &c[..42]),
        format!("vanttec-docs://auth?code={}+&state={s}", &c[..42]),
        format!("vanttec-docs://auth?code={}/&state={s}", &c[..42]),
        format!("vanttec-docs://auth?code={}%2D&state={s}", &c[..40]),
        format!("vanttec-docs://auth?code={}ñ&state={s}", &c[..41]),
        format!("vanttec-docs://auth?code={c}&state={}", "s".repeat(21)),
        format!("vanttec-docs://auth?code={c}&state={}", "s".repeat(129)),
        format!("vanttec-docs://auth?code={c}&state={}.", &s[..42]),
        format!("vanttec-docs://auth?code={c}&state={}", "s".repeat(4000)),
        // Otro esquema, otro host u otra ruta.
        format!("VANTTEC-DOCS://auth?code={c}&state={s}"),
        format!("vanttec-docs://AUTH?code={c}&state={s}"),
        format!("vanttec-docs:auth?code={c}&state={s}"),
        format!("vanttec-docs:///auth?code={c}&state={s}"),
        // `auth/?` sí se lee (es como lo entrega Windows); `auth//?` y `auth/x?` no.
        format!("vanttec-docs://auth//?code={c}&state={s}"),
        format!("vanttec-docs://auth/x?code={c}&state={s}"),
        format!("vanttec-docs://auth:443?code={c}&state={s}"),
        format!("vanttec-docs://u@auth?code={c}&state={s}"),
        format!("vanttec-docs://otra?code={c}&state={s}"),
        format!("vanttec-docs://authx?code={c}&state={s}"),
        format!("vanttec-docsx://auth?code={c}&state={s}"),
        format!("portal://auth?code={c}&state={s}"),
        format!("https://auth?code={c}&state={s}"),
        format!("https://docs.vanttec.workers.dev/auth?code={c}&state={s}"),
        // Fragmento, espacios y saltos de línea.
        format!("vanttec-docs://auth?code={c}&state={s}#x"),
        format!(" vanttec-docs://auth?code={c}&state={s}"),
        format!("vanttec-docs://auth?code={c}&state={s} "),
        format!("vanttec-docs://auth?code={c}&state={s}\n"),
        format!("vanttec-docs://auth?code={c}&state={s}\r\n"),
        format!("vanttec-docs://auth?code={c}&amp;state={s}"),
        format!("\"vanttec-docs://auth?code={c}&state={s}\""),
        // Lo que no es un enlace: otros argumentos de una segunda instancia.
        "--help".into(),
        "C:\\Users\\x\\vanttec-docs.exe".into(),
        "vanttec-docs".into(),
    ];
    for malo in &malos {
        assert!(leer_enlace(malo).is_none(), "no debe leerse {malo:?}");
    }
}

// ---------- Criterio 3: la máquina de estados ----------

#[test]
fn c3_sin_token_empieza_sin_sesion_y_con_token_con_sesion() {
    let ahora = Instant::now();
    let sin = login_sin_sesion();
    assert_eq!(sin.estado(ahora), EstadoLogin::SinSesion);
    assert!(sin.token().is_none());

    let con = Login::nuevo(Destino::produccion(), Some(EQUIPO), Some(token()));
    assert_eq!(con.estado(ahora), EstadoLogin::ConSesion);
    assert_eq!(con.token(), Some(token()));
    // Con sesión no se abre nada, ni ahora ni pasada la pausa.
    assert_eq!(con.iniciar(ahora), Inicio::ConSesion);
    assert_eq!(con.iniciar(ahora + PAUSA_ENTRE_INICIOS * 3), Inicio::ConSesion);
    assert_eq!(con.estado(ahora), EstadoLogin::ConSesion);
}

#[test]
fn c3_iniciar_abre_un_intento_y_el_estado_pasa_a_en_curso() {
    let t0 = Instant::now();
    let login = login_sin_sesion();
    iniciar(&login, t0);
    assert_eq!(login.estado(t0), EstadoLogin::EnCurso);
    assert_eq!(login.estado(t0 + Duration::from_secs(60)), EstadoLogin::EnCurso);
    assert!(login.token().is_none(), "abrir el navegador no da sesión");
}

#[test]
fn c3_un_segundo_iniciar_demasiado_pronto_no_abre_nada() {
    let t0 = Instant::now();
    let login = login_sin_sesion();
    iniciar(&login, t0);
    for espera in [Duration::ZERO, Duration::from_millis(1), PAUSA_ENTRE_INICIOS - Duration::from_millis(1)] {
        assert_eq!(login.iniciar(t0 + espera), Inicio::Esperar, "a los {espera:?}");
        assert_eq!(login.estado(t0 + espera), EstadoLogin::EnCurso, "el intento sigue vivo");
    }
}

#[test]
fn c3_pasada_la_pausa_un_iniciar_nuevo_sustituye_al_anterior() {
    let t0 = Instant::now();
    let login = login_sin_sesion();
    let primero = iniciar(&login, t0);
    let segundo = iniciar(&login, t0 + PAUSA_ENTRE_INICIOS);
    assert_ne!(primero.state, segundo.state);
    assert_ne!(primero.challenge, segundo.challenge);
    assert_eq!(login.estado(t0 + PAUSA_ENTRE_INICIOS), EstadoLogin::EnCurso);
    // La pausa cuenta desde la última apertura.
    assert_eq!(login.iniciar(t0 + PAUSA_ENTRE_INICIOS + Duration::from_secs(1)), Inicio::Esperar);
}

#[test]
fn c3_el_intento_caduca() {
    let t0 = Instant::now();
    let login = login_sin_sesion();
    iniciar(&login, t0);
    assert_eq!(login.estado(t0 + VIDA_INTENTO - Duration::from_millis(1)), EstadoLogin::EnCurso);
    assert_eq!(login.estado(t0 + VIDA_INTENTO), EstadoLogin::SinSesion);
    assert_eq!(login.estado(t0 + VIDA_INTENTO * 2), EstadoLogin::SinSesion);
    // Caducado, se puede empezar otro.
    iniciar(&login, t0 + VIDA_INTENTO);
    assert_eq!(login.estado(t0 + VIDA_INTENTO), EstadoLogin::EnCurso);
}

#[test]
fn c3_si_el_navegador_no_abre_el_estado_es_un_fallo_y_la_pausa_sigue_contando() {
    let t0 = Instant::now();
    let login = login_sin_sesion();
    iniciar(&login, t0);
    login.navegador_no_abre();
    assert_eq!(login.estado(t0), EstadoLogin::Fallo(Aviso::NavegadorNoAbre));
    assert_eq!(login.estado(t0 + VIDA_INTENTO * 2), EstadoLogin::Fallo(Aviso::NavegadorNoAbre));
    assert_eq!(login.iniciar(t0 + Duration::from_secs(1)), Inicio::Esperar, "tampoco aquí hay bucle");
    assert_eq!(login.estado(t0 + Duration::from_secs(1)), EstadoLogin::Fallo(Aviso::NavegadorNoAbre));
    iniciar(&login, t0 + PAUSA_ENTRE_INICIOS);
    assert_eq!(login.estado(t0 + PAUSA_ENTRE_INICIOS), EstadoLogin::EnCurso);
}

#[test]
fn c3_los_avisos_son_textos_fijos_y_breves() {
    assert_eq!(Aviso::NavegadorNoAbre.texto(), "No se pudo abrir el navegador.");
    assert_eq!(Aviso::NoSePudo.texto(), "No se pudo iniciar sesión. Inténtalo de nuevo.");
    assert_eq!(Aviso::DemasiadosIntentos.texto(), "Demasiados intentos. Espera un minuto.");
    assert_eq!(Aviso::SinConexion.texto(), "Sin conexión con el servidor.");
}

#[test]
fn c3_el_login_se_comparte_entre_hilos_y_no_toca_la_red_hasta_el_canje() {
    fn es_send_sync<T: Send + Sync>() {}
    es_send_sync::<Login>();

    let servidor = Servidor::ok();
    let login = login_hacia(&servidor);
    let t0 = Instant::now();
    iniciar(&login, t0);
    let _ = login.estado(t0);
    let _ = login.iniciar(t0 + PAUSA_ENTRE_INICIOS);
    login.navegador_no_abre();
    assert_eq!(servidor.conexiones(), 0, "iniciar y consultar el estado no abren conexiones");
}
