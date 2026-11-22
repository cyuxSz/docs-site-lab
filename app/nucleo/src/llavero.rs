//! El llavero: dónde se guarda el token entre un arranque y el siguiente.
//!
//! El núcleo solo conoce este trait. La implementación real (el almacén de credenciales del
//! sistema) vive en la cáscara, así que los tests del núcleo corren sin dependencias de sistema.

/// El llavero no pudo leer, guardar o borrar. No lleva detalles: el texto del error del sistema
/// no debe llegar a ningún mensaje.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FalloDeLlavero;

/// Un hueco con nombre fijo en el almacén de credenciales del sistema. Guarda un solo secreto.
pub trait Llavero: Send + Sync {
    /// El secreto guardado, byte a byte. `Ok(None)` si no hay ninguno.
    fn leer(&self) -> Result<Option<Vec<u8>>, FalloDeLlavero>;
    /// Guarda el secreto y sustituye al que hubiera.
    fn guardar(&self, secreto: &[u8]) -> Result<(), FalloDeLlavero>;
    /// Borra el secreto. Borrar lo que no existe no es un fallo.
    fn borrar(&self) -> Result<(), FalloDeLlavero>;
}

/// Llavero que no guarda nada: la sesión vive solo en memoria. Es el de `Login::nuevo`.
pub struct SinLlavero;

impl Llavero for SinLlavero {
    fn leer(&self) -> Result<Option<Vec<u8>>, FalloDeLlavero> {
        Ok(None)
    }

    fn guardar(&self, _secreto: &[u8]) -> Result<(), FalloDeLlavero> {
        Err(FalloDeLlavero)
    }

    fn borrar(&self) -> Result<(), FalloDeLlavero> {
        Ok(())
    }
}

/// Nombre de la credencial en el almacén del sistema: `LLAVERO_SERVICIO` en release y
/// `LLAVERO_SERVICIO_DEV` en debug, para que el desarrollo no pise la sesión real.
pub fn nombre_de_llavero(es_debug: bool) -> &'static str {
    let _ = es_debug;
    todo!("lote app-sesion: nombre de la credencial según el tipo de build")
}
