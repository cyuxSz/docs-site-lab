// El llavero real: una credencial genérica del Administrador de credenciales de Windows, del
// usuario actual. Es el único archivo de la cáscara con `unsafe`: las llamadas a la API de
// credenciales. El secreto entra y sale como bytes; aquí no se mira, no se escribe en ningún
// otro sitio y ningún error lleva texto del sistema.

use std::ptr;

use nucleo::{FalloDeLlavero, Llavero};
use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
use windows_sys::Win32::Security::Credentials::{
    CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_MAX_CREDENTIAL_BLOB_SIZE,
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

/// Una credencial con nombre fijo. Los dos nombres van en UTF-16 y terminados en cero.
pub struct LlaveroDelSistema {
    servicio: Vec<u16>,
    cuenta: Vec<u16>,
}

fn ancho(texto: &str) -> Vec<u16> {
    texto.encode_utf16().chain(std::iter::once(0)).collect()
}

impl LlaveroDelSistema {
    pub fn nuevo(servicio: &str, cuenta: &str) -> LlaveroDelSistema {
        LlaveroDelSistema { servicio: ancho(servicio), cuenta: ancho(cuenta) }
    }
}

impl Llavero for LlaveroDelSistema {
    fn leer(&self) -> Result<Option<Vec<u8>>, FalloDeLlavero> {
        let mut credencial: *mut CREDENTIALW = ptr::null_mut();
        // SAFETY: `servicio` termina en cero y vive durante la llamada; `credencial` es un
        // puntero de salida válido.
        let leida = unsafe { CredReadW(self.servicio.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credencial) };
        if leida == 0 {
            // SAFETY: sin argumentos; lee el código de error del hilo.
            let codigo = unsafe { GetLastError() };
            return if codigo == ERROR_NOT_FOUND { Ok(None) } else { Err(FalloDeLlavero) };
        }
        // SAFETY: `CredReadW` tuvo éxito, así que `credencial` apunta a una estructura válida
        // hasta `CredFree`, y su blob mide `CredentialBlobSize` bytes. Se copia y se libera.
        let secreto = unsafe {
            let datos = &*credencial;
            let secreto = if datos.CredentialBlob.is_null() || datos.CredentialBlobSize == 0 {
                Vec::new()
            } else {
                std::slice::from_raw_parts(datos.CredentialBlob, datos.CredentialBlobSize as usize).to_vec()
            };
            CredFree(credencial.cast());
            secreto
        };
        Ok(Some(secreto))
    }

    fn guardar(&self, secreto: &[u8]) -> Result<(), FalloDeLlavero> {
        if secreto.is_empty() || secreto.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize {
            return Err(FalloDeLlavero);
        }
        // La API pide punteros mutables aunque no escribe en ellos: se le dan copias.
        let (mut servicio, mut cuenta, mut blob) = (self.servicio.clone(), self.cuenta.clone(), secreto.to_vec());
        let credencial = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: servicio.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            // Del usuario y de este equipo: no viaja con un perfil móvil.
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: cuenta.as_mut_ptr(),
            ..Default::default()
        };
        // SAFETY: los tres punteros apuntan a memoria viva durante la llamada, las cadenas
        // terminan en cero y el tamaño del blob es el de `blob`.
        let escrita = unsafe { CredWriteW(&credencial, 0) };
        blob.fill(0);
        if escrita == 0 { Err(FalloDeLlavero) } else { Ok(()) }
    }

    fn borrar(&self) -> Result<(), FalloDeLlavero> {
        // SAFETY: `servicio` termina en cero y vive durante la llamada.
        let borrada = unsafe { CredDeleteW(self.servicio.as_ptr(), CRED_TYPE_GENERIC, 0) };
        // SAFETY: sin argumentos; lee el código de error del hilo.
        if borrada != 0 || unsafe { GetLastError() } == ERROR_NOT_FOUND { Ok(()) } else { Err(FalloDeLlavero) }
    }
}
