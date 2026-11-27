//! Ayudas de los tests del lote `app-sesion`: un llavero en memoria que apunta lo que le piden y
//! las respuestas del servidor falso a la revocación.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use nucleo::{FalloDeLlavero, Llavero, Login};

use super::login::EQUIPO;
use super::{Respuesta, Servidor};

/// Llavero en memoria. Cuenta las llamadas y puede fallar en cada operación por separado.
pub struct LlaveroFalso {
    contenido: Mutex<Option<Vec<u8>>>,
    guardados: Mutex<Vec<Vec<u8>>>,
    lecturas: AtomicUsize,
    borrados: AtomicUsize,
    falla_leer: AtomicBool,
    falla_guardar: AtomicBool,
    falla_borrar: AtomicBool,
}

impl LlaveroFalso {
    fn con(contenido: Option<Vec<u8>>) -> Arc<LlaveroFalso> {
        Arc::new(LlaveroFalso {
            contenido: Mutex::new(contenido),
            guardados: Mutex::new(Vec::new()),
            lecturas: AtomicUsize::new(0),
            borrados: AtomicUsize::new(0),
            falla_leer: AtomicBool::new(false),
            falla_guardar: AtomicBool::new(false),
            falla_borrar: AtomicBool::new(false),
        })
    }

    pub fn vacio() -> Arc<LlaveroFalso> {
        LlaveroFalso::con(None)
    }

    /// Con ese secreto ya guardado, como lo dejó un arranque anterior.
    pub fn con_secreto(secreto: &[u8]) -> Arc<LlaveroFalso> {
        LlaveroFalso::con(Some(secreto.to_vec()))
    }

    /// Un llavero que no está disponible: leer, guardar y borrar fallan.
    pub fn roto() -> Arc<LlaveroFalso> {
        let llavero = LlaveroFalso::vacio();
        llavero.falla_leer.store(true, Ordering::SeqCst);
        llavero.falla_guardar.store(true, Ordering::SeqCst);
        llavero.falla_borrar.store(true, Ordering::SeqCst);
        llavero
    }

    /// Desde ahora borrar falla y el secreto se queda donde está.
    pub fn que_no_borre(&self) {
        self.falla_borrar.store(true, Ordering::SeqCst);
    }

    /// Lo que hay guardado ahora mismo.
    pub fn contenido(&self) -> Option<Vec<u8>> {
        self.contenido.lock().unwrap().clone()
    }

    /// Cada secreto que se pidió guardar, haya fallado o no.
    pub fn guardados(&self) -> Vec<Vec<u8>> {
        self.guardados.lock().unwrap().clone()
    }

    pub fn lecturas(&self) -> usize {
        self.lecturas.load(Ordering::SeqCst)
    }

    /// Veces que se pidió borrar, haya fallado o no.
    pub fn borrados(&self) -> usize {
        self.borrados.load(Ordering::SeqCst)
    }
}

impl Llavero for LlaveroFalso {
    fn leer(&self) -> Result<Option<Vec<u8>>, FalloDeLlavero> {
        self.lecturas.fetch_add(1, Ordering::SeqCst);
        if self.falla_leer.load(Ordering::SeqCst) {
            return Err(FalloDeLlavero);
        }
        Ok(self.contenido.lock().unwrap().clone())
    }

    fn guardar(&self, secreto: &[u8]) -> Result<(), FalloDeLlavero> {
        self.guardados.lock().unwrap().push(secreto.to_vec());
        if self.falla_guardar.load(Ordering::SeqCst) {
            return Err(FalloDeLlavero);
        }
        *self.contenido.lock().unwrap() = Some(secreto.to_vec());
        Ok(())
    }

    fn borrar(&self) -> Result<(), FalloDeLlavero> {
        self.borrados.fetch_add(1, Ordering::SeqCst);
        if self.falla_borrar.load(Ordering::SeqCst) {
            return Err(FalloDeLlavero);
        }
        *self.contenido.lock().unwrap() = None;
        Ok(())
    }
}

/// Login sin token de desarrollo y con ese llavero, hacia el servidor falso.
pub fn login_con(servidor: &Servidor, llavero: &Arc<LlaveroFalso>) -> Arc<Login> {
    Arc::new(Login::con_llavero(servidor.destino(), Some(EQUIPO), None, llavero.clone()))
}

/// Respuesta 200 de `POST /auth/app/revocar`, con la forma del servidor real.
pub fn revocado() -> Respuesta {
    Respuesta::nueva(200, b"{\"ok\":true}")
        .con("Content-Type", "application/json; charset=utf-8")
        .con("Cache-Control", "no-store")
}

/// El 401 del servidor a un token que no conoce.
pub fn token_invalido() -> Respuesta {
    Respuesta::nueva(401, b"{\"error\":\"Token inv\\u00e1lido\"}")
        .con("Content-Type", "application/json; charset=utf-8")
        .con("WWW-Authenticate", "Bearer")
}
