//! El token de dispositivo y de dónde lo saca el proxy.

use std::fmt;

/// Token de dispositivo. No implementa `Display` y su `Debug` no muestra el valor.
#[derive(Clone, PartialEq, Eq)]
pub struct Token(String);

impl Token {
    /// `None` si el valor está vacío, pasa de 512 bytes o tiene algo que no sea ASCII visible
    /// (0x21 a 0x7E). Así un valor con saltos de línea no puede inyectar cabeceras.
    pub fn nuevo(valor: &str) -> Option<Token> {
        let largo_valido = (1..=512).contains(&valor.len());
        if largo_valido && valor.bytes().all(|b| (0x21..=0x7E).contains(&b)) {
            Some(Token(valor.to_string()))
        } else {
            None
        }
    }

    /// El valor en claro. Solo para montar la cabecera `Authorization`.
    pub fn exponer(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(<oculto>)")
    }
}

/// De dónde saca el proxy el token. Se consulta en cada petición.
pub trait FuenteDeToken: Send + Sync {
    fn token(&self) -> Option<Token>;
}

/// Fuente con un token fijo, o sin token.
pub struct TokenFijo(pub Option<Token>);

impl FuenteDeToken for TokenFijo {
    fn token(&self) -> Option<Token> {
        self.0.clone()
    }
}
