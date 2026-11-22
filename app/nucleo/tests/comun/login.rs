//! Ayudas de los tests del lote `app-login`: intentos de login, enlaces, el canje falso y un
//! navegador que solo apunta lo que le piden abrir.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use nucleo::{Inicio, Login, Navegador, Token};

use super::{Recibida, Respuesta, Servidor};

/// Código con la forma de los del servidor: 43 caracteres base64url.
pub const CODIGO: &str = "c0d1g0-DE_PRUEBA-0123456789abcdefghijklmnop";

/// Un `state` con buena forma que no es el de ningún intento.
pub const STATE_AJENO: &str = "st4te-DE_PRUEBA-0123456789abcdefghijklmnopq";

/// El token que entrega el canje falso. Distinto de `comun::TOKEN`.
pub const TOKEN_NUEVO: &str = "vtd_NUEVO0123456789abcdefghijklmnopqrstuvwxy-_Z";

/// Nombre de equipo de prueba: ya está limpio y no necesita codificarse.
pub const EQUIPO: &str = "PC-PRUEBA";

pub fn es_b64url(valor: &str, largo: usize) -> bool {
    valor.len() == largo && valor.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub fn token_nuevo() -> Token {
    Token::nuevo(TOKEN_NUEVO).expect("el token nuevo de prueba debe ser válido")
}

/// Login sin sesión hacia el servidor falso.
pub fn login_hacia(servidor: &Servidor) -> Arc<Login> {
    Arc::new(Login::nuevo(servidor.destino(), Some(EQUIPO), None))
}

/// Las partes de la URL que la app abre en el navegador.
#[derive(Clone, Debug)]
pub struct Intento {
    pub url: String,
    pub challenge: String,
    pub state: String,
    /// Tal como va en la URL, codificado.
    pub nombre: String,
}

/// Comprueba la forma exacta de la URL de inicio y la parte. `origen` va sin barra final.
pub fn partir_url(origen: &str, url: &str) -> Intento {
    let prefijo = format!("{origen}/auth/app/iniciar?");
    let consulta = url
        .strip_prefix(&prefijo)
        .unwrap_or_else(|| panic!("la URL de inicio debe empezar por {prefijo:?}: {url:?}"));
    let pares: Vec<(&str, &str)> = consulta
        .split('&')
        .map(|par| par.split_once('=').unwrap_or_else(|| panic!("parámetro sin valor en {url:?}")))
        .collect();
    let nombres: Vec<&str> = pares.iter().map(|(n, _)| *n).collect();
    assert_eq!(
        nombres,
        ["challenge", "state", "nombre", "plataforma"],
        "la URL lleva esos cuatro parámetros, una vez cada uno y en ese orden: {url:?}"
    );
    let (challenge, state, nombre, plataforma) = (pares[0].1, pares[1].1, pares[2].1, pares[3].1);
    assert!(es_b64url(challenge, 43), "challenge: 43 caracteres base64url, no {challenge:?}");
    assert!(es_b64url(state, 43), "state: 43 caracteres base64url, no {state:?}");
    assert_eq!(plataforma, "windows");
    assert!(
        !nombre.is_empty()
            && nombre.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._~%".contains(&b)),
        "el nombre va codificado con %XX: {nombre:?}"
    );
    Intento {
        url: url.to_string(),
        challenge: challenge.to_string(),
        state: state.to_string(),
        nombre: nombre.to_string(),
    }
}

/// Pide un intento nuevo y exige que la respuesta sea abrir el navegador.
pub fn iniciar(login: &Login, ahora: Instant) -> Intento {
    match login.iniciar(ahora) {
        Inicio::Abrir(url) => partir_url(login.destino().origen(), &url),
        otro => panic!("se esperaba Inicio::Abrir y fue {otro:?}"),
    }
}

/// El enlace que abre la página «Listo» del servidor.
pub fn enlace(codigo: &str, state: &str) -> String {
    format!("vanttec-docs://auth?code={codigo}&state={state}")
}

/// Respuesta 200 del canje, con la forma del servidor real.
pub fn canje_ok(token: &str) -> Respuesta {
    let cuerpo =
        format!("{{\"token\":\"{token}\",\"expira\":\"2026-12-22T20:15:13.300Z\",\"login\":\"cyuxSz\"}}");
    Respuesta::nueva(200, cuerpo.as_bytes())
        .con("Content-Type", "application/json; charset=utf-8")
        .con("Cache-Control", "no-store")
}

/// El `verifier` que recibió el canje falso. Exige el cuerpo exacto `{"code":"…","verifier":"…"}`.
pub fn verifier_de(recibida: &Recibida, codigo: &str) -> String {
    let cuerpo = String::from_utf8(recibida.cuerpo.clone()).expect("el cuerpo del canje es UTF-8");
    let prefijo = format!("{{\"code\":\"{codigo}\",\"verifier\":\"");
    cuerpo
        .strip_prefix(&prefijo)
        .and_then(|resto| resto.strip_suffix("\"}"))
        .unwrap_or_else(|| panic!("el cuerpo del canje debe ser {prefijo}<verifier>\"}}"))
        .to_string()
}

/// Navegador falso: apunta cada URL que le piden abrir.
pub struct NavegadorFalso {
    abiertas: Mutex<Vec<String>>,
    funciona: bool,
}

impl NavegadorFalso {
    pub fn nuevo() -> Arc<NavegadorFalso> {
        Arc::new(NavegadorFalso { abiertas: Mutex::new(Vec::new()), funciona: true })
    }

    /// Un navegador que no se abre: `abrir` devuelve `false`.
    pub fn roto() -> Arc<NavegadorFalso> {
        Arc::new(NavegadorFalso { abiertas: Mutex::new(Vec::new()), funciona: false })
    }

    pub fn abiertas(&self) -> Vec<String> {
        self.abiertas.lock().unwrap().clone()
    }
}

impl Navegador for NavegadorFalso {
    fn abrir(&self, url: &str) -> bool {
        self.abiertas.lock().unwrap().push(url.to_string());
        self.funciona
    }
}
