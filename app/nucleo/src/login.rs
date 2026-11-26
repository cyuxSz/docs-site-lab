//! El inicio de sesión de la app: PKCE, el enlace de vuelta, la máquina de estados y el canje.
//!
//! El `verifier`, el código y el token no salen de aquí: ni en `Debug`, ni en errores.

use std::fmt;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::rand::{SecureRandom, SystemRandom};

use crate::destino::Destino;
use crate::llavero::Llavero;
use crate::token::{FuenteDeToken, Token};
use crate::{ESQUEMA_ENLACE, NOMBRE_POR_DEFECTO, PAUSA_ENTRE_INICIOS, PLATAFORMA, VIDA_INTENTO};

/// Rutas del servidor: la página de consentimiento y el canje del código.
const RUTA_CONSENTIMIENTO: &str = "/auth/app/iniciar";
const RUTA_CANJE: &str = "/auth/app/canje";

/// Tiempos del canje: para conectar y para la petición entera.
const CANJE_CONEXION: Duration = Duration::from_secs(10);
const CANJE_TOTAL: Duration = Duration::from_secs(20);

/// Máximo de bytes que se leen de la respuesta del canje.
const TOPE_CANJE: usize = 4096;

/// Bytes de azar del `verifier` y del `state`. En base64url sin relleno son 43 caracteres.
const BYTES_DE_AZAR: usize = 32;
const LARGO_B64: usize = 43;

/// Máximo de caracteres del nombre del dispositivo.
const LARGO_NOMBRE: usize = 30;

/// Un token de dispositivo es este prefijo y 43 caracteres base64url.
const PREFIJO_TOKEN: &str = "vtd_";

fn es_b64url(valor: &str) -> bool {
    valor.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Compara sin cortar en la primera diferencia, para no dar pistas del `state` por el tiempo.
fn iguales(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |suma, (x, y)| suma | (x ^ y)) == 0
}

/// 32 bytes de la aleatoriedad del sistema, en base64url sin relleno. `None` si el sistema no
/// los da: es mejor no tener intento que tener uno con valores adivinables.
fn azar() -> Option<String> {
    let mut bytes = [0u8; BYTES_DE_AZAR];
    SystemRandom::new().fill(&mut bytes).ok()?;
    Some(URL_SAFE_NO_PAD.encode(bytes))
}

/// `%XX` en mayúsculas para todo byte que no sea `A-Za-z0-9-._~`.
fn codificar(texto: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut salida = String::with_capacity(texto.len() * 3);
    for b in texto.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            salida.push(char::from(b));
        } else {
            salida.push('%');
            salida.push(char::from(HEX[usize::from(b >> 4)]));
            salida.push(char::from(HEX[usize::from(b & 15)]));
        }
    }
    salida
}

/// `challenge` de PKCE (S256): base64url sin relleno del SHA-256 del `verifier`.
pub fn desafio_s256(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes()))
}

/// Nombre con el que el dispositivo aparece en el consentimiento y en «Dispositivos»: solo
/// letras, números, espacios, `-`, `_` y `.`, y como mucho 30 caracteres.
pub fn nombre_de_dispositivo(crudo: Option<&str>) -> String {
    let limpio: String = crudo
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_' | '.'))
        .collect();
    let cortado: String = limpio.trim().chars().take(LARGO_NOMBRE).collect();
    let nombre = cortado.trim();
    if nombre.is_empty() {
        NOMBRE_POR_DEFECTO.to_string()
    } else {
        nombre.to_string()
    }
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
pub fn leer_enlace(enlace: &str) -> Option<EnlaceDeLogin> {
    // Windows añade una `/` tras `auth` al abrir el enlace por el registro: se admite una, opcional.
    let tras_auth = enlace.strip_prefix(ESQUEMA_ENLACE)?.strip_prefix("://auth")?;
    let resto = tras_auth.strip_prefix('/').unwrap_or(tras_auth).strip_prefix("?code=")?;
    let (codigo, state) = resto.split_once("&state=")?;
    let codigo_valido = codigo.len() == LARGO_B64 && es_b64url(codigo);
    let state_valido = (22..=128).contains(&state.len()) && es_b64url(state);
    if codigo_valido && state_valido {
        Some(EnlaceDeLogin { codigo: codigo.to_string(), state: state.to_string() })
    } else {
        None
    }
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
        match self {
            Aviso::NavegadorNoAbre => "No se pudo abrir el navegador.",
            Aviso::NoSePudo => "No se pudo iniciar sesión. Inténtalo de nuevo.",
            Aviso::DemasiadosIntentos => "Demasiados intentos. Espera un minuto.",
            Aviso::SinConexion => "Sin conexión con el servidor.",
        }
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
    /// La sesión terminó: se cerró o el servidor rechazó el token.
    Terminada(Fin),
}

/// Por qué terminó la sesión. Cada uno tiene un texto fijo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fin {
    /// El usuario pulsó «Salir» y el servidor confirmó que el token ya no vale.
    Cerrada,
    /// El usuario pulsó «Salir», pero el servidor no confirmó la revocación.
    CerradaSinServidor,
    /// El servidor rechazó el token: caducó o se revocó desde otro sitio.
    Caducada,
}

impl Fin {
    /// El texto que ve el usuario. Fijo: nunca lleva nada de la respuesta del servidor.
    pub fn texto(&self) -> &'static str {
        todo!("lote app-sesion: textos del fin de la sesión")
    }
}

/// Qué pasó al cerrar la sesión.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cierre {
    /// No había sesión: no se hizo nada, ni petición ni cambio de estado.
    SinSesion,
    /// El token se borró aquí y el servidor confirmó que ya no vale.
    Revocada,
    /// El token se borró aquí, pero el servidor no confirmó la revocación.
    SoloLocal,
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

/// Un intento de login: lo que hay que recordar hasta que vuelve el enlace.
struct Intento {
    verifier: String,
    state: String,
    abierto: Instant,
}

impl Intento {
    fn vivo(&self, ahora: Instant) -> bool {
        ahora.saturating_duration_since(self.abierto) < VIDA_INTENTO
    }
}

impl fmt::Debug for Intento {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Intento(<oculto>)")
    }
}

/// Lo que cambia del login. Solo se lee y se escribe con el cerrojo tomado.
struct Interior {
    token: Option<Token>,
    intento: Option<Intento>,
    /// Hay una petición de canje en vuelo.
    canjeando: bool,
    fallo: Option<Aviso>,
    /// Cuándo se pidió abrir el navegador por última vez.
    ultima_apertura: Option<Instant>,
}

/// El login de la app. Se comparte entre hilos con `Arc<Login>` y es la fuente de token del
/// proxy.
pub struct Login {
    destino: Destino,
    /// Nombre del dispositivo, ya limpio y codificado para la URL.
    nombre: String,
    agente: ureq::Agent,
    interior: Mutex<Interior>,
}

impl Login {
    /// `nombre_equipo` pasa por `nombre_de_dispositivo`. `inicial` es el token de desarrollo.
    pub fn nuevo(destino: Destino, nombre_equipo: Option<&str>, inicial: Option<Token>) -> Login {
        // Sin redirecciones y sin proxies HTTP del entorno.
        let agente = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout_connect(CANJE_CONEXION)
            .timeout(CANJE_TOTAL)
            .build();
        let interior = Interior {
            token: inicial,
            intento: None,
            canjeando: false,
            fallo: None,
            ultima_apertura: None,
        };
        Login {
            destino,
            nombre: codificar(&nombre_de_dispositivo(nombre_equipo)),
            agente,
            interior: Mutex::new(interior),
        }
    }

    /// Como `nuevo`, con un llavero. Sin token `inicial`, la sesión se lee del llavero. Tras un
    /// canje el token se guarda en él, y se borra al cerrar la sesión o si el servidor lo rechaza.
    pub fn con_llavero(
        destino: Destino,
        nombre_equipo: Option<&str>,
        inicial: Option<Token>,
        llavero: Arc<dyn Llavero>,
    ) -> Login {
        let _ = (destino, nombre_equipo, inicial, llavero);
        todo!("lote app-sesion: login con llavero")
    }

    pub fn destino(&self) -> &Destino {
        &self.destino
    }

    /// Cierra la sesión: borra el token de la memoria y del llavero y pide al servidor que lo
    /// revoque. Bloquea mientras dura la petición.
    pub fn cerrar_sesion(&self) -> Cierre {
        todo!("lote app-sesion: cerrar sesión")
    }

    /// El estado no queda a medias aunque otro hilo haya fallado con el cerrojo tomado.
    fn cerrojo(&self) -> MutexGuard<'_, Interior> {
        self.interior.lock().unwrap_or_else(|envenenado| envenenado.into_inner())
    }

    pub fn estado(&self, ahora: Instant) -> EstadoLogin {
        let interior = self.cerrojo();
        if interior.token.is_some() {
            EstadoLogin::ConSesion
        } else if interior.canjeando || interior.intento.as_ref().is_some_and(|i| i.vivo(ahora)) {
            EstadoLogin::EnCurso
        } else if let Some(aviso) = interior.fallo {
            EstadoLogin::Fallo(aviso)
        } else {
            EstadoLogin::SinSesion
        }
    }

    pub fn iniciar(&self, ahora: Instant) -> Inicio {
        let mut interior = self.cerrojo();
        if interior.token.is_some() {
            return Inicio::ConSesion;
        }
        let en_pausa = interior
            .ultima_apertura
            .is_some_and(|ultima| ahora.saturating_duration_since(ultima) < PAUSA_ENTRE_INICIOS);
        if interior.canjeando || en_pausa {
            return Inicio::Esperar;
        }
        // La pausa cuenta también si el sistema no da azar: no hay intento y no se abre nada.
        interior.ultima_apertura = Some(ahora);
        let (Some(verifier), Some(state)) = (azar(), azar()) else {
            interior.intento = None;
            interior.fallo = Some(Aviso::NoSePudo);
            return Inicio::Esperar;
        };
        let url = format!(
            "{}{RUTA_CONSENTIMIENTO}?challenge={}&state={state}&nombre={}&plataforma={PLATAFORMA}",
            self.destino.origen(),
            desafio_s256(&verifier),
            self.nombre,
        );
        // El intento nuevo sustituye al anterior, y con él se va el aviso que hubiera.
        interior.intento = Some(Intento { verifier, state, abierto: ahora });
        interior.fallo = None;
        Inicio::Abrir(url)
    }

    /// El navegador no se abrió: se descarta el intento y el estado pasa a `Fallo`.
    pub fn navegador_no_abre(&self) {
        let mut interior = self.cerrojo();
        interior.intento = None;
        if interior.token.is_none() && !interior.canjeando {
            interior.fallo = Some(Aviso::NavegadorNoAbre);
        }
    }

    /// Valida el enlace contra el intento vivo y, si casa, canjea el código. Bloquea mientras
    /// dura la petición.
    pub fn recibir(&self, enlace: &str, ahora: Instant) -> Recibido {
        let Some(leido) = leer_enlace(enlace) else { return Recibido::Ignorado };

        // El intento se consume con el cerrojo tomado y antes de la petición: el mismo enlace,
        // otra vez o desde otro hilo, ya no encuentra nada que canjear.
        let intento = {
            let mut interior = self.cerrojo();
            if interior.token.is_some() || interior.canjeando {
                return Recibido::Ignorado;
            }
            let casa = interior
                .intento
                .as_ref()
                .is_some_and(|intento| intento.vivo(ahora) && iguales(&intento.state, leido.state()));
            if !casa {
                return Recibido::Ignorado;
            }
            let Some(intento) = interior.intento.take() else { return Recibido::Ignorado };
            interior.canjeando = true;
            intento
        };

        // Pase lo que pase en la petición, `canjeando` vuelve a `false`.
        let canje = catch_unwind(AssertUnwindSafe(|| self.canjear(leido.codigo(), &intento.verifier)));
        let resultado = canje.unwrap_or(Err(Aviso::NoSePudo));

        let mut interior = self.cerrojo();
        interior.canjeando = false;
        match resultado {
            Ok(token) => {
                interior.token = Some(token);
                interior.fallo = None;
                Recibido::Sesion
            }
            Err(aviso) => {
                interior.fallo = Some(aviso);
                Recibido::Fallo
            }
        }
    }

    /// La petición del canje: una sola, sin credenciales del webview. Del fallo solo sale un
    /// aviso fijo, nunca el texto del servidor ni el error del cliente HTTP.
    fn canjear(&self, codigo: &str, verifier: &str) -> Result<Token, Aviso> {
        // Los dos valores son base64url: no necesitan escaparse dentro del JSON.
        let cuerpo = format!("{{\"code\":\"{codigo}\",\"verifier\":\"{verifier}\"}}");
        let url = format!("{}{RUTA_CANJE}", self.destino.origen());
        let enviada = self
            .agente
            .post(&url)
            .set("content-type", "application/json")
            .send_bytes(cuerpo.as_bytes());
        let respuesta = match enviada {
            Ok(respuesta) => respuesta,
            Err(ureq::Error::Status(_, respuesta)) => respuesta,
            Err(ureq::Error::Transport(_)) => return Err(Aviso::SinConexion),
        };
        match respuesta.status() {
            200 => {}
            429 => return Err(Aviso::DemasiadosIntentos),
            500..=599 => return Err(Aviso::SinConexion),
            _ => return Err(Aviso::NoSePudo),
        }

        // Como mucho el tope + 1 byte: basta para saber que se pasó.
        let mut leido = Vec::new();
        let lectura = respuesta.into_reader().take(TOPE_CANJE as u64 + 1).read_to_end(&mut leido);
        if lectura.is_err() {
            return Err(Aviso::SinConexion);
        }
        if leido.len() > TOPE_CANJE {
            return Err(Aviso::NoSePudo);
        }
        let json: serde_json::Value = serde_json::from_slice(&leido).map_err(|_| Aviso::NoSePudo)?;
        json.get("token")
            .and_then(|valor| valor.as_str())
            .filter(|valor| {
                valor.strip_prefix(PREFIJO_TOKEN).is_some_and(|r| r.len() == LARGO_B64 && es_b64url(r))
            })
            .and_then(Token::nuevo)
            .ok_or(Aviso::NoSePudo)
    }

    /// El servidor rechazó ese token: se olvida, solo si sigue siendo el actual.
    pub fn rechazar(&self, token: &Token) {
        let mut interior = self.cerrojo();
        if interior.token.as_ref() == Some(token) {
            interior.token = None;
        }
    }
}

impl FuenteDeToken for Login {
    fn token(&self) -> Option<Token> {
        self.cerrojo().token.clone()
    }
}

impl fmt::Debug for Login {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Login(<oculto>)")
    }
}
