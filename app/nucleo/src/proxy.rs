//! El proxy: recibe la petición del webview, la reenvía al destino con el token y devuelve la
//! respuesta sin nada que el webview no deba ver.
//!
//! El token solo sale de aquí en la cabecera `Authorization` hacia el destino. Ningún mensaje
//! de error lleva texto del cliente HTTP ni del sistema: podrían nombrar el host o la cabecera.

use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use flate2::read::MultiGzDecoder;
use http::header::{
    HeaderName, ACCEPT, ALLOW, CACHE_CONTROL, CONNECTION, CONTENT_LENGTH, CONTENT_SECURITY_POLICY,
    CONTENT_TYPE, LOCATION, ORIGIN, X_CONTENT_TYPE_OPTIONS,
};
use http::{HeaderMap, HeaderValue, Method, Request, Response, StatusCode};

use crate::destino::{decodificar_una_vez, solo_ruta, Destino};
use crate::pantalla::pantalla_sin_sesion;
use crate::token::{FuenteDeToken, Token};
use crate::{CSP_AISLADO, CSP_MARCOS, ORIGENES_APP, TOPE_CUERPO};

const METODOS: [&str; 6] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
const METODOS_ALLOW: &str = "GET, HEAD, POST, PUT, PATCH, DELETE";

const SEC_FETCH_SITE: &str = "sec-fetch-site";
const SEC_FETCH_MODE: &str = "sec-fetch-mode";
const SEC_FETCH_DEST: &str = "sec-fetch-dest";

/// Nombre, en minúsculas, de la cabecera en la que se busca `sandbox`.
const CSP: &str = "content-security-policy";

const MSG_ORIGEN: &str = "Origen no permitido";
const MSG_METODO: &str = "Método no permitido";
const MSG_RUTA: &str = "Ruta no válida";
const MSG_AUTH: &str = "No disponible en la app";
const MSG_SIN_SESION: &str = "Sin sesión";
const MSG_CUERPO: &str = "Cuerpo demasiado grande";
const MSG_OCUPADO: &str = "Demasiadas peticiones a la vez";
const MSG_RED: &str = "Sin conexión con el servidor";
const MSG_RESPUESTA: &str = "Respuesta no válida del servidor";

/// Cabeceras de salto: valen para una sola conexión y no se reenvían en ningún sentido.
const DE_SALTO: [&str; 9] = [
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
];

/// Cabeceras del webview que nunca llegan al destino, además de las de salto. Las credenciales
/// y el origen son del webview, no del dispositivo; el resto lo pone el cliente HTTP.
const QUITADAS_DE_IDA: [&str; 7] =
    ["cookie", "origin", "referer", "authorization", "host", "content-length", "accept-encoding"];

/// Cabeceras del destino que nunca llegan al webview, además de las de salto.
/// `content-length` se vuelve a poner con el tamaño del cuerpo entregado.
const QUITADAS_DE_VUELTA: [&str; 3] = ["set-cookie", "set-cookie2", "content-length"];

/// Límites del proxy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limites {
    /// Máximo de bytes del cuerpo de una petición.
    pub cuerpo_peticion: usize,
    /// Máximo de bytes del cuerpo de una respuesta, ya descomprimida.
    pub cuerpo_respuesta: usize,
    /// Tiempo máximo para conectar con el servidor.
    pub timeout_conexion: Duration,
    /// Tiempo máximo de una petición completa, y de la espera por un hueco libre.
    pub timeout_total: Duration,
    /// Peticiones al servidor a la vez.
    pub simultaneas: usize,
    /// Peticiones esperando un hueco a la vez. La que llega con la cola llena no espera.
    pub en_espera: usize,
}

impl Default for Limites {
    fn default() -> Limites {
        Limites {
            cuerpo_peticion: TOPE_CUERPO,
            cuerpo_respuesta: TOPE_CUERPO,
            timeout_conexion: Duration::from_secs(10),
            timeout_total: Duration::from_secs(120),
            simultaneas: 6,
            en_espera: 64,
        }
    }
}

/// Los huecos libres y cuántas peticiones esperan uno.
struct Turnos {
    libres: usize,
    esperando: usize,
}

/// Cuántas peticiones al servidor caben a la vez, y cuántas pueden esperar su turno.
struct Huecos {
    turnos: Mutex<Turnos>,
    aviso: Condvar,
    en_espera: usize,
}

impl Huecos {
    fn nuevo(total: usize, en_espera: usize) -> Huecos {
        let turnos = Turnos { libres: total.max(1), esperando: 0 };
        Huecos { turnos: Mutex::new(turnos), aviso: Condvar::new(), en_espera }
    }

    /// Los contadores no quedan a medias aunque otro hilo haya fallado con el cerrojo tomado.
    fn cerrojo(&self) -> MutexGuard<'_, Turnos> {
        self.turnos.lock().unwrap_or_else(|envenenado| envenenado.into_inner())
    }

    /// Toma un hueco. Si no hay ninguno libre espera como mucho `plazo`, salvo que la cola ya
    /// esté llena: entonces no espera. `None` si no cabe en la cola o si vence el plazo.
    fn tomar(&self, plazo: Duration) -> Option<Hueco<'_>> {
        let mut turnos = self.cerrojo();
        // Primer intento: con un hueco libre la petición pasa, sea cual sea el plazo (también
        // `Duration::ZERO`) y sin contar para la cola.
        if turnos.libres > 0 {
            turnos.libres -= 1;
            return Some(Hueco(self));
        }
        if turnos.esperando >= self.en_espera {
            return None;
        }
        // El puesto en la cola se cuenta y se descuenta con el cerrojo tomado, y entre medias
        // no hay nada que pueda fallar: se libera siempre al salir de ella.
        turnos.esperando += 1;
        let inicio = Instant::now();
        let conseguido = loop {
            // Tras esperar, el plazo se mira antes que los huecos: una espera vencida no toma
            // hueco aunque haya uno libre, que queda para otra.
            let resta = plazo.checked_sub(inicio.elapsed()).filter(|resta| !resta.is_zero());
            let Some(resta) = resta else { break false };
            if turnos.libres > 0 {
                turnos.libres -= 1;
                break true;
            }
            turnos = match self.aviso.wait_timeout(turnos, resta) {
                Ok((guarda, _)) => guarda,
                Err(envenenado) => envenenado.into_inner().0,
            };
        };
        turnos.esperando -= 1;
        let sobra_hueco = !conseguido && turnos.libres > 0;
        drop(turnos);
        if sobra_hueco {
            // El aviso que despertó a esta petición no se pierde: otra que espera lo recoge.
            self.aviso.notify_one();
        }
        conseguido.then(|| Hueco(self))
    }

    /// Peticiones esperando un hueco en este momento.
    fn en_cola(&self) -> usize {
        self.cerrojo().esperando
    }
}

/// Una petición pendiente de `atender_en_hilo`; se descuenta al soltarla, también si falla.
struct Pendiente<'a>(&'a AtomicUsize);

impl Drop for Pendiente<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Un hueco tomado. Se devuelve al soltarlo, también si la petición falla.
struct Hueco<'a>(&'a Huecos);

impl Drop for Hueco<'_> {
    fn drop(&mut self) {
        self.0.cerrojo().libres += 1;
        self.0.aviso.notify_one();
    }
}

/// El proxy. Se comparte entre hilos con `Arc<Proxy>`.
pub struct Proxy {
    destino: Destino,
    fuente: Arc<dyn FuenteDeToken>,
    limites: Limites,
    agente: ureq::Agent,
    huecos: Huecos,
    sesion_perdida: AtomicBool,
    pendientes: AtomicUsize,
}

impl Proxy {
    pub fn nuevo(destino: Destino, fuente: Arc<dyn FuenteDeToken>, limites: Limites) -> Proxy {
        // Sin redirecciones (las sigue el webview) y sin proxies HTTP del entorno.
        let agente = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout_connect(limites.timeout_conexion)
            .timeout(limites.timeout_total)
            .max_idle_connections_per_host(limites.simultaneas.max(1))
            .build();
        let huecos = Huecos::nuevo(limites.simultaneas, limites.en_espera);
        Proxy { destino, fuente, limites, agente, huecos,
            sesion_perdida: AtomicBool::new(false),
            pendientes: AtomicUsize::new(0),
        }
    }

    /// Atiende una petición del webview. Nunca entra en pánico ni devuelve el token.
    pub fn atender(&self, peticion: Request<Vec<u8>>) -> Response<Vec<u8>> {
        let es_head = peticion.method() == Method::HEAD;
        // Solo `entregar` lo pone a `true`, y solo cuando devuelve la respuesta del servidor.
        let mut aislado = false;
        let atendida =
            catch_unwind(AssertUnwindSafe(|| self.atender_peticion(peticion, &mut aislado)));
        let mut respuesta = atendida.unwrap_or_else(|_| {
            aislado = false;
            error_local(StatusCode::BAD_GATEWAY, MSG_RESPUESTA)
        });
        if es_head {
            respuesta.body_mut().clear();
        }
        con_csp_propias(respuesta, aislado)
    }

    /// Atiende la petición en un hilo propio y entrega la respuesta a `responder`. La cuenta
    /// como pendiente desde que la admite, antes de crear el hilo. Si ya hay
    /// `simultaneas + en_espera` pendientes, o el sistema no deja crear el hilo, entrega en el
    /// acto, en el hilo que llama, el 503 local. Nunca entra en pánico.
    pub fn atender_en_hilo<F>(self: &Arc<Self>, peticion: Request<Vec<u8>>, responder: F)
    where
        F: FnOnce(Response<Vec<u8>>) + Send + 'static,
    {
        let es_head = peticion.method() == Method::HEAD;
        let tope = self.limites.simultaneas.max(1).saturating_add(self.limites.en_espera);
        let admitida = self
            .pendientes
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| (n < tope).then(|| n + 1))
            .is_ok();
        if !admitida {
            responder(ocupado(es_head));
            return;
        }
        // El responder se comparte para poder usarlo aquí si el hilo no llega a crearse.
        let responder = Arc::new(Mutex::new(Some(responder)));
        let proxy = Arc::clone(self);
        let del_hilo = Arc::clone(&responder);
        let creado = std::thread::Builder::new().spawn(move || {
            let _pendiente = Pendiente(&proxy.pendientes);
            let respuesta = proxy.atender(peticion);
            let responder = del_hilo.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some(responder) = responder {
                responder(respuesta);
            }
        });
        if creado.is_err() {
            self.pendientes.fetch_sub(1, Ordering::SeqCst);
            let responder = responder.lock().unwrap_or_else(|e| e.into_inner()).take();
            if let Some(responder) = responder {
                responder(ocupado(es_head));
            }
        }
    }

    /// Peticiones admitidas por `atender_en_hilo` cuya respuesta aún no se ha entregado.
    pub fn pendientes(&self) -> usize {
        self.pendientes.load(Ordering::SeqCst)
    }

    /// Peticiones esperando un hueco en este momento.
    pub fn en_cola(&self) -> usize {
        self.huecos.en_cola()
    }

    /// `true` desde que el servidor rechazó el token (401 con `WWW-Authenticate: Bearer`).
    pub fn sesion_perdida(&self) -> bool {
        self.sesion_perdida.load(Ordering::SeqCst)
    }

    /// Las comprobaciones, en el orden de la spec. Solo la última toca la red. `aislado` queda a
    /// `true` si la respuesta es la del servidor y este mandó una CSP con `sandbox`.
    fn atender_peticion(
        &self,
        peticion: Request<Vec<u8>>,
        aislado: &mut bool,
    ) -> Response<Vec<u8>> {
        let (partes, cuerpo) = peticion.into_parts();

        // Lo primero, y sin mirar nada más: a otro origen se le contesta siempre lo mismo.
        if !origen_permitido(&partes.method, &partes.headers) {
            return error_local(StatusCode::FORBIDDEN, MSG_ORIGEN);
        }

        let metodo = partes.method.as_str();
        if !METODOS.contains(&metodo) {
            let mut respuesta = error_local(StatusCode::METHOD_NOT_ALLOWED, MSG_METODO);
            respuesta.headers_mut().insert(ALLOW, HeaderValue::from_static(METODOS_ALLOW));
            return respuesta;
        }

        // De la URI solo cuentan la ruta y la consulta: el esquema y el host se ignoran.
        let ruta_y_consulta = partes.uri.path_and_query().map_or("/", |pq| pq.as_str());
        let Some(url) = self.destino.url_para(ruta_y_consulta) else {
            return error_local(StatusCode::BAD_REQUEST, MSG_RUTA);
        };

        let es_lectura = metodo == "GET" || metodo == "HEAD";
        if es_ruta_de_auth(solo_ruta(ruta_y_consulta), es_lectura) {
            return error_local(StatusCode::NOT_FOUND, MSG_AUTH);
        }

        let es_navegacion = es_lectura && acepta_html(&partes.headers);
        let token = match self.fuente.token() {
            Some(token) if !self.sesion_perdida() => token,
            _ => return sin_sesion(es_navegacion),
        };

        if cuerpo.len() > self.limites.cuerpo_peticion {
            return error_local(StatusCode::PAYLOAD_TOO_LARGE, MSG_CUERPO);
        }

        let Some(_hueco) = self.huecos.tomar(self.limites.timeout_total) else {
            return error_local(StatusCode::SERVICE_UNAVAILABLE, MSG_OCUPADO);
        };
        // Otra petición pudo perder la sesión mientras esta esperaba: el token ya no sale.
        if self.sesion_perdida() {
            return sin_sesion(es_navegacion);
        }

        self.reenviar(metodo, &url, &partes.headers, &cuerpo, &token, aislado)
    }

    fn reenviar(
        &self,
        metodo: &str,
        url: &str,
        cabeceras: &HeaderMap,
        cuerpo: &[u8],
        token: &Token,
        aislado: &mut bool,
    ) -> Response<Vec<u8>> {
        let mut peticion = self.agente.request(metodo, url);
        let nombradas = nombradas_por_connection(cabeceras);
        for nombre in cabeceras.keys() {
            let nombre = nombre.as_str();
            if DE_SALTO.contains(&nombre)
                || QUITADAS_DE_IDA.contains(&nombre)
                || nombradas.iter().any(|n| n == nombre)
            {
                continue;
            }
            // Las repetidas viajan unidas por comas, que es equivalente. Un valor que no sea
            // ASCII visible no se puede reenviar con este cliente y se omite.
            let valores: Option<Vec<&str>> =
                cabeceras.get_all(nombre).iter().map(|v| v.to_str().ok()).collect();
            if let Some(valores) = valores {
                peticion = peticion.set(nombre, &valores.join(", "));
            }
        }
        peticion = peticion.set("authorization", &format!("Bearer {}", token.exponer()));
        // La descompresión la hace el proxy, para ver todos los `Content-Encoding` del servidor.
        peticion = peticion.set("accept-encoding", "gzip");

        let sin_cuerpo = cuerpo.is_empty() && (metodo == "GET" || metodo == "HEAD");
        let resultado = if sin_cuerpo { peticion.call() } else { peticion.send_bytes(cuerpo) };
        let respuesta = match resultado {
            Ok(respuesta) => respuesta,
            // Un estado de error del servidor también se reenvía.
            Err(ureq::Error::Status(_, respuesta)) => respuesta,
            Err(ureq::Error::Transport(_)) => return error_local(StatusCode::BAD_GATEWAY, MSG_RED),
        };
        self.entregar(metodo == "HEAD", respuesta, aislado)
    }

    fn entregar(
        &self,
        es_head: bool,
        respuesta: ureq::Response,
        aislado: &mut bool,
    ) -> Response<Vec<u8>> {
        let invalida = || error_local(StatusCode::BAD_GATEWAY, MSG_RESPUESTA);

        let estado = match StatusCode::from_u16(respuesta.status()) {
            Ok(estado) if (200..=599).contains(&estado.as_u16()) => estado,
            _ => return invalida(),
        };

        let mut nombres = respuesta.headers_names();
        // Se mira lo que mandó el servidor, antes de cualquier filtro.
        let csp_recibidas = nombres.iter().filter(|n| n.as_str() == CSP).count();
        let csp_legibles = respuesta.all(CSP);
        let csp_ilegible = csp_legibles.len() < csp_recibidas
            || csp_legibles.iter().any(|valor| HeaderValue::from_str(valor).is_err());
        let con_sandbox = csp_legibles.iter().any(|valor| trae_sandbox(valor));
        let ce_recibidas = nombres.iter().filter(|n| n.as_str() == "content-encoding").count();
        let mut vistos = Vec::new();
        nombres.retain(|n| !vistos.contains(n) && { vistos.push(n.clone()); true });
        let recibidas: Vec<(String, Vec<String>)> = nombres
            .into_iter()
            .map(|nombre| {
                let valores = respuesta.all(&nombre).into_iter().map(str::to_string).collect();
                (nombre, valores)
            })
            .collect();
        let de = |nombre: &str| -> &[String] {
            recibidas.iter().find(|(n, _)| n == nombre).map_or(&[], |(_, v)| v.as_slice())
        };

        // Un 401 con `Bearer` pierde la sesión ya, antes de cualquier comprobación que pueda
        // acabar en 502: el token no vuelve a salir aunque esta respuesta no se entregue.
        let token_rechazado = estado == StatusCode::UNAUTHORIZED
            && de("www-authenticate").iter().any(|valor| desafia_con_bearer(valor));
        if token_rechazado {
            self.sesion_perdida.store(true, Ordering::SeqCst);
        }

        // Ninguna codificación, o exactamente un campo con gzip. Cualquier otra cosa no se abre.
        if de("content-encoding").len() < ce_recibidas {
            return invalida();
        }
        let es_gzip = match de("content-encoding") {
            [] => false,
            [unica] => {
                let valor = unica.trim();
                if valor.eq_ignore_ascii_case("gzip") || valor.eq_ignore_ascii_case("x-gzip") {
                    true
                } else {
                    return invalida();
                }
            }
            _ => return invalida(),
        };

        let nombradas: Vec<String> = de("connection")
            .iter()
            .flat_map(|valor| valor.split(','))
            .map(|n| n.trim().to_ascii_lowercase())
            .collect();

        // Una CSP que no llega intacta al webview: el documento no se entrega sin ella.
        if csp_recibidas > 0 && (csp_ilegible || nombradas.iter().any(|n| n == CSP)) {
            return invalida();
        }

        let mut location = None;
        if estado.is_redirection() {
            match de("location") {
                [] => {}
                [unica] => match self.location_segura(unica) {
                    Some(relativa) => location = Some(relativa),
                    None => return invalida(),
                },
                _ => return invalida(),
            }
        }

        let largo_declarado = de("content-length").first().cloned();

        // Sin cuerpo no se abre ninguno. Con él, como mucho el tope + 1 byte de lo ya abierto.
        let sin_cuerpo =
            es_head || estado == StatusCode::NO_CONTENT || estado == StatusCode::NOT_MODIFIED;
        let tope = self.limites.cuerpo_respuesta;
        let mut cuerpo = Vec::new();
        if !sin_cuerpo {
            let limite = (tope as u64).saturating_add(1);
            let leido = if es_gzip {
                MultiGzDecoder::new(respuesta.into_reader()).take(limite).read_to_end(&mut cuerpo)
            } else {
                respuesta.into_reader().take(limite).read_to_end(&mut cuerpo)
            };
            if leido.is_err() || cuerpo.len() > tope {
                return invalida();
            }
        }

        let mut salida = Response::new(cuerpo);
        *salida.status_mut() = estado;
        for (nombre, valores) in &recibidas {
            let n = nombre.as_str();
            if DE_SALTO.contains(&n)
                || QUITADAS_DE_VUELTA.contains(&n)
                || n == "content-encoding"
                || nombradas.iter().any(|x| x == n)
                || (n == "location" && location.is_some())
            {
                continue;
            }
            let Ok(nombre) = HeaderName::from_bytes(n.as_bytes()) else { continue };
            for valor in valores {
                if let Ok(valor) = HeaderValue::from_str(valor) {
                    salida.headers_mut().append(nombre.clone(), valor);
                }
            }
        }
        if let Some(relativa) = location {
            match HeaderValue::from_str(&relativa) {
                Ok(valor) => salida.headers_mut().insert(LOCATION, valor),
                Err(_) => return invalida(),
            };
        }

        if es_head {
            // En un HEAD el tamaño es el que anuncia el servidor, no el del cuerpo (vacío);
            // con gzip es el del comprimido y no se reenvía.
            let declarado = largo_declarado
                .filter(|_| !es_gzip)
                .filter(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
                .and_then(|v| HeaderValue::from_str(&v).ok());
            if let Some(valor) = declarado {
                salida.headers_mut().insert(CONTENT_LENGTH, valor);
            }
        } else if !sin_cuerpo {
            let largo = HeaderValue::from(salida.body().len());
            salida.headers_mut().insert(CONTENT_LENGTH, largo);
        }

        *aislado = con_sandbox;
        salida
    }

    /// Un `Location` que el webview puede seguir sin salir del origen de la app: relativo con
    /// una sola barra, o absoluto hacia el propio destino (se devuelve ya relativo).
    fn location_segura(&self, valor: &str) -> Option<String> {
        // Los navegadores tratan `\` como `/` y quitan tabuladores y saltos de dentro de la URL.
        if valor.bytes().any(|b| b == b'\\' || b.is_ascii_control()) {
            return None;
        }
        let es_relativa = |v: &str| v.starts_with('/') && !v.starts_with("//");
        if es_relativa(valor) {
            return Some(valor.to_string());
        }
        let origen = self.destino.origen();
        let cabeza = valor.get(..origen.len())?;
        if !cabeza.eq_ignore_ascii_case(origen) {
            return None;
        }
        let resto = &valor[origen.len()..];
        if resto.is_empty() {
            Some("/".to_string())
        } else if resto.starts_with(['?', '#']) {
            Some(format!("/{resto}"))
        } else if es_relativa(resto) {
            Some(resto.to_string())
        } else {
            None
        }
    }
}

/// `true` si la petición viene del propio portal. El proxy añade el token y quita `Origin`, así
/// que la comprobación que el servidor ya no puede hacer se hace aquí.
fn origen_permitido(metodo: &Method, cabeceras: &HeaderMap) -> bool {
    // Un `Origin`, si viene, es byte a byte uno de los de la app. Sin excepciones.
    let es_propio =
        |valor: &HeaderValue| ORIGENES_APP.iter().any(|o| valor.as_bytes() == o.as_bytes());
    if !cabeceras.get_all(ORIGIN).iter().all(es_propio) {
        return false;
    }

    // Un `Sec-Fetch-Site`, si viene, es `same-origin` o `none`.
    let es_sitio = |valor: &HeaderValue, esperado: &str| {
        valor.as_bytes().trim_ascii().eq_ignore_ascii_case(esperado.as_bytes())
    };
    let sitios: Vec<&HeaderValue> = cabeceras.get_all(SEC_FETCH_SITE).iter().collect();
    if sitios.iter().all(|sitio| es_sitio(sitio, "same-origin") || es_sitio(sitio, "none")) {
        return true;
    }

    // La única excepción: la navegación GET del marco principal desde otro sitio, que es lo
    // que hace un enlace de una página de origen opaco del propio portal.
    let unica = |nombre: &str, esperado: &str| {
        let mut valores = cabeceras.get_all(nombre).iter();
        let primera = valores.next();
        valores.next().is_none() && primera.is_some_and(|v| v.as_bytes() == esperado.as_bytes())
    };
    metodo == Method::GET
        && !cabeceras.contains_key(ORIGIN)
        && matches!(sitios[..], [sitio] if es_sitio(sitio, "cross-site") || es_sitio(sitio, "same-site"))
        && unica(SEC_FETCH_MODE, "navigate")
        && unica(SEC_FETCH_DEST, "document")
}

/// `/auth` y `/auth/*`, comparando la ruta decodificada una vez y en minúsculas, como la ve
/// Cloudflare. La única excepción es leer `/auth/me` (ruta literal).
fn es_ruta_de_auth(ruta: &str, es_lectura: bool) -> bool {
    if es_lectura && (ruta == "/auth/me" || ruta == "/auth/me/") {
        return false;
    }
    let Some(decodificada) = decodificar_una_vez(ruta) else { return true };
    let decodificada = decodificada.to_ascii_lowercase();
    decodificada == b"/auth" || decodificada.starts_with(b"/auth/")
}

fn acepta_html(cabeceras: &HeaderMap) -> bool {
    cabeceras
        .get_all(ACCEPT)
        .iter()
        .any(|valor| valor.to_str().is_ok_and(|v| v.to_ascii_lowercase().contains("text/html")))
}

/// Nombres de cabecera que la propia petición declara como de salto en `Connection`.
fn nombradas_por_connection(cabeceras: &HeaderMap) -> Vec<String> {
    cabeceras
        .get_all(CONNECTION)
        .iter()
        .filter_map(|valor| valor.to_str().ok())
        .flat_map(|valor| valor.split(','))
        .map(|nombre| nombre.trim().to_ascii_lowercase())
        .filter(|nombre| !nombre.is_empty())
        .collect()
}

/// `true` si alguno de los desafíos de un `WWW-Authenticate` es de esquema `Bearer`.
fn desafia_con_bearer(valor: &str) -> bool {
    valor.split(',').any(|parte| {
        parte.split_whitespace().next().is_some_and(|esquema| esquema.eq_ignore_ascii_case("bearer"))
    })
}

/// `true` si alguna política de una `Content-Security-Policy` tiene la directiva `sandbox`. Las
/// políticas van separadas por comas y las directivas por `;`; el nombre es el primer token.
fn trae_sandbox(csp: &str) -> bool {
    csp.split([',', ';']).any(|directiva| {
        directiva
            .split([' ', '\t'])
            .find(|token| !token.is_empty())
            .is_some_and(|nombre| nombre.eq_ignore_ascii_case("sandbox"))
    })
}

/// Las CSP propias van detrás de las que ya lleve la respuesta. Se añaden, no sustituyen:
/// varias CSP se intersectan, así que solo restringen.
fn con_csp_propias(mut respuesta: Response<Vec<u8>>, aislado: bool) -> Response<Vec<u8>> {
    let cabeceras = respuesta.headers_mut();
    cabeceras.append(CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP_MARCOS));
    if aislado {
        cabeceras.append(CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP_AISLADO));
    }
    respuesta
}

/// El 503 local de «Demasiadas peticiones a la vez», ya con la CSP de marcos.
fn ocupado(es_head: bool) -> Response<Vec<u8>> {
    let mut respuesta = error_local(StatusCode::SERVICE_UNAVAILABLE, MSG_OCUPADO);
    if es_head {
        respuesta.body_mut().clear();
    }
    con_csp_propias(respuesta, false)
}

/// Sin token no hay petición de red: la navegación ve la pantalla y el resto un 401.
fn sin_sesion(es_navegacion: bool) -> Response<Vec<u8>> {
    if es_navegacion {
        pantalla_sin_sesion()
    } else {
        error_local(StatusCode::UNAUTHORIZED, MSG_SIN_SESION)
    }
}

/// Respuesta generada por la cáscara: `{"error":"<mensaje>"}` con un mensaje fijo.
fn error_local(estado: StatusCode, mensaje: &'static str) -> Response<Vec<u8>> {
    let mut respuesta = Response::new(format!("{{\"error\":\"{mensaje}\"}}").into_bytes());
    *respuesta.status_mut() = estado;
    let cabeceras = respuesta.headers_mut();
    cabeceras.insert(CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    cabeceras.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    cabeceras.insert(X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    respuesta
}
