//! El inicio de sesión de la app: PKCE, el enlace de vuelta, la máquina de estados y el canje.
//!
//! Esqueleto del lote `app-login`: las firmas están fijadas en la spec y los cuerpos, por hacer.
//! El `verifier`, el código y el token no salen de aquí: ni en `Debug`, ni en errores.

use std::fmt;
use std::time::Instant;

use crate::destino::Destino;
use crate::token::{FuenteDeToken, Token};

/// `challenge` de PKCE (S256): base64url sin relleno del SHA-256 del `verifier`.
pub fn desafio_s256(_verifier: &str) -> String {
    todo!("lote app-login: desafio_s256")
}

/// Nombre con el que el dispositivo aparece en el consentimiento y en «Dispositivos».
pub fn nombre_de_dispositivo(_crudo: Option<&str>) -> String {
    todo!("lote app-login: nombre_de_dispositivo")
}

/// Lo que trae un enlace `vanttec-docs://auth?code=…&state=…` bien formado.
#[derive(Clone, PartialEq, Eq)]
pub struct EnlaceDeLogin {
    codigo: String,
    state: String,
}

impl EnlaceDeLogin {
    pub fn codigo(&self) -> &str {
        &self.codigo
    }

    pub fn state(&self) -> &str {
        &self.state
    }
}

impl fmt::Debug for EnlaceDeLogin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("EnlaceDeLogin(<oculto>)")
    }
}

/// `None` si el enlace no tiene exactamente la forma que emite el servidor.
pub fn leer_enlace(_enlace: &str) -> Option<EnlaceDeLogin> {
    todo!("lote app-login: leer_enlace")
}

/// Por qué no se pudo iniciar sesión. Cada uno tiene un texto fijo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Aviso {
    /// El navegador del sistema no se abrió.
    NavegadorNoAbre,
    /// El servidor no aceptó el código, o su respuesta no sirve.
    NoSePudo,
    /// El servidor respondió 429.
    DemasiadosIntentos,
    /// Sin red, tiempo agotado o un 5xx.
    SinConexion,
}

impl Aviso {
    /// El texto que ve el usuario. Fijo: nunca lleva nada de la respuesta del servidor.
    pub fn texto(&self) -> &'static str {
        todo!("lote app-login: Aviso::texto")
    }
}

/// Lo que pinta la pantalla de login.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EstadoLogin {
    SinSesion,
    /// Hay un intento vivo o un canje en vuelo.
    EnCurso,
    Fallo(Aviso),
    ConSesion,
}

/// Respuesta a «Iniciar sesión».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Inicio {
    /// Intento nuevo: hay que abrir esta URL en el navegador del sistema.
    Abrir(String),
    /// Demasiado pronto, o hay un canje en vuelo: no se abre nada y el intento actual sigue.
    Esperar,
    /// Ya hay sesión: no se abre nada.
    ConSesion,
}

/// Qué pasó con un enlace recibido.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recibido {
    /// No se hizo nada: ni canje ni cambio de estado.
    Ignorado,
    /// El canje dio un token: hay sesión.
    Sesion,
    /// El canje falló: el estado es `Fallo(_)`.
    Fallo,
}

/// El login de la app. Se comparte entre hilos con `Arc<Login>` y es la fuente de token del
/// proxy.
pub struct Login {
    _privado: (),
}

impl Login {
    /// `nombre_equipo` pasa por `nombre_de_dispositivo`. `inicial` es el token de desarrollo.
    pub fn nuevo(_destino: Destino, _nombre_equipo: Option<&str>, _inicial: Option<Token>) -> Login {
        todo!("lote app-login: Login::nuevo")
    }

    pub fn destino(&self) -> &Destino {
        todo!("lote app-login: Login::destino")
    }

    pub fn estado(&self, _ahora: Instant) -> EstadoLogin {
        todo!("lote app-login: Login::estado")
    }

    pub fn iniciar(&self, _ahora: Instant) -> Inicio {
        todo!("lote app-login: Login::iniciar")
    }

    /// El navegador no se abrió: se descarta el intento y el estado pasa a `Fallo`.
    pub fn navegador_no_abre(&self) {
        todo!("lote app-login: Login::navegador_no_abre")
    }

    /// Valida el enlace contra el intento vivo y, si casa, canjea el código. Bloquea mientras
    /// dura la petición.
    pub fn recibir(&self, _enlace: &str, _ahora: Instant) -> Recibido {
        todo!("lote app-login: Login::recibir")
    }

    /// El servidor rechazó ese token: se olvida, solo si sigue siendo el actual.
    pub fn rechazar(&self, _token: &Token) {
        todo!("lote app-login: Login::rechazar")
    }
}

impl FuenteDeToken for Login {
    fn token(&self) -> Option<Token> {
        todo!("lote app-login: Login::token")
    }
}

impl fmt::Debug for Login {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Login(<oculto>)")
    }
}
