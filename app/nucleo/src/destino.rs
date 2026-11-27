//! A dónde reenvía el proxy y con qué arranca la app.

use crate::token::Token;
use crate::ORIGEN_PRODUCCION;

/// El origen no es válido como destino del proxy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DestinoInvalido;

/// Origen al que reenvía el proxy: esquema, host y puerto, sin nada más.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destino {
    origen: String,
}

impl Destino {
    /// El portal en producción (`ORIGEN_PRODUCCION`).
    pub fn produccion() -> Destino {
        Destino { origen: ORIGEN_PRODUCCION.to_string() }
    }

    /// Acepta `https://host[:puerto]` y `http://` solo hacia `localhost` o `127.0.0.1`.
    /// Admite una barra final. Rechaza userinfo, ruta, consulta y fragmento.
    pub fn nuevo(origen: &str) -> Result<Destino, DestinoInvalido> {
        let (esquema, resto) = if let Some(resto) = origen.strip_prefix("https://") {
            ("https", resto)
        } else if let Some(resto) = origen.strip_prefix("http://") {
            ("http", resto)
        } else {
            return Err(DestinoInvalido);
        };
        let autoridad = resto.strip_suffix('/').unwrap_or(resto);
        let (host, puerto) = match autoridad.split_once(':') {
            Some((host, puerto)) => (host, Some(puerto)),
            None => (autoridad, None),
        };
        if !host_valido(host) {
            return Err(DestinoInvalido);
        }
        let host = host.to_ascii_lowercase();
        if esquema == "http" && host != "localhost" && host != "127.0.0.1" {
            return Err(DestinoInvalido);
        }
        let origen = match puerto {
            Some(puerto) if puerto_valido(puerto) => format!("{esquema}://{host}:{puerto}"),
            Some(_) => return Err(DestinoInvalido),
            None => format!("{esquema}://{host}"),
        };
        Ok(Destino { origen })
    }

    /// El origen sin barra final.
    pub fn origen(&self) -> &str {
        &self.origen
    }

    /// URL completa para una ruta con consulta opcional (`/ruta?consulta`). `None` si la ruta
    /// podría salir del origen o no es una ruta absoluta limpia.
    pub fn url_para(&self, ruta_y_consulta: &str) -> Option<String> {
        if !ruta_y_consulta.starts_with('/') {
            return None;
        }
        // Ni fragmento, ni espacios, ni controles: el cliente HTTP los quitaría o los cambiaría.
        if ruta_y_consulta.bytes().any(|b| b == b'#' || b == b' ' || b.is_ascii_control()) {
            return None;
        }
        let ruta = solo_ruta(ruta_y_consulta);
        let decodificada = decodificar_una_vez(ruta)?;
        if decodificada.starts_with(b"//") {
            return None;
        }
        if decodificada.iter().any(|b| *b == b'\\' || b.is_ascii_control()) {
            return None;
        }
        if decodificada.split(|b| *b == b'/').any(|s| s == b"." || s == b"..") {
            return None;
        }
        Some(format!("{}{}", self.origen, ruta_y_consulta))
    }
}

/// La parte de la ruta, sin la consulta.
pub(crate) fn solo_ruta(ruta_y_consulta: &str) -> &str {
    match ruta_y_consulta.split_once('?') {
        Some((ruta, _)) => ruta,
        None => ruta_y_consulta,
    }
}

/// Decodifica los `%XX` una sola vez. `None` si hay un `%` mal formado.
pub(crate) fn decodificar_una_vez(texto: &str) -> Option<Vec<u8>> {
    let bytes = texto.as_bytes();
    let mut salida = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let alto = hex(*bytes.get(i + 1)?)?;
            let bajo = hex(*bytes.get(i + 2)?)?;
            salida.push(alto * 16 + bajo);
            i += 3;
        } else {
            salida.push(bytes[i]);
            i += 1;
        }
    }
    Some(salida)
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Nombre de host o IPv4: etiquetas de letras, cifras y guiones separadas por puntos.
fn host_valido(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|etiqueta| {
            !etiqueta.is_empty()
                && !etiqueta.starts_with('-')
                && !etiqueta.ends_with('-')
                && etiqueta.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// De 1 a 65535, solo cifras y sin ceros a la izquierda.
fn puerto_valido(puerto: &str) -> bool {
    (1..=5).contains(&puerto.len())
        && puerto.bytes().all(|b| b.is_ascii_digit())
        && !puerto.starts_with('0')
        && puerto.parse::<u16>().is_ok()
}

/// Con qué destino y qué token arranca la app.
#[derive(Debug)]
pub struct Arranque {
    pub destino: Destino,
    pub token: Option<Token>,
}

/// Decide el arranque. Con `es_debug == false` devuelve siempre producción y ningún token, sin
/// mirar los otros argumentos. Con `es_debug == true` usa los valores de las variables de
/// entorno de desarrollo que le pasen (vacío cuenta como ausente).
pub fn config_de_arranque(
    es_debug: bool,
    destino_dev: Option<&str>,
    token_dev: Option<&str>,
) -> Result<Arranque, DestinoInvalido> {
    if !es_debug {
        return Ok(Arranque { destino: Destino::produccion(), token: None });
    }
    let destino = match destino_dev.filter(|valor| !valor.is_empty()) {
        Some(valor) => Destino::nuevo(valor)?,
        None => Destino::produccion(),
    };
    let token = token_dev.filter(|valor| !valor.is_empty()).and_then(Token::nuevo);
    Ok(Arranque { destino, token })
}
