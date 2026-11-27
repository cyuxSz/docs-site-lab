//! Servidor HTTP falso y ayudas compartidas por los tests del proxy.
#![allow(dead_code)]

pub mod login;
pub mod sesion;

use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http::{Request, Response};
use nucleo::{Destino, FuenteDeToken, Limites, Proxy, Token, TokenFijo};

/// Token de prueba con la forma de los del servidor (`vtd_` + 43 caracteres base64url).
pub const TOKEN: &str = "vtd_PRUEBA0123456789abcdefghijklmnopqrstuvw-_XY";

/// Lo que el servidor falso recibió en una petición.
#[derive(Clone, Debug)]
pub struct Recibida {
    pub metodo: String,
    /// La línea de petición tal cual: ruta y consulta.
    pub destino: String,
    pub cabeceras: Vec<(String, String)>,
    pub cuerpo: Vec<u8>,
}

impl Recibida {
    /// Todos los valores de una cabecera (el nombre no distingue mayúsculas).
    pub fn todas(&self, nombre: &str) -> Vec<String> {
        self.cabeceras
            .iter()
            .filter(|(n, _)| n.eq_ignore_ascii_case(nombre))
            .map(|(_, v)| v.clone())
            .collect()
    }

    pub fn una(&self, nombre: &str) -> Option<String> {
        let v = self.todas(nombre);
        assert!(v.len() <= 1, "la cabecera {nombre} llegó {} veces: {v:?}", v.len());
        v.into_iter().next()
    }

    pub fn tiene(&self, nombre: &str) -> bool {
        !self.todas(nombre).is_empty()
    }
}

/// Lo que el servidor falso contesta.
#[derive(Clone, Debug)]
pub struct Respuesta {
    pub estado: u16,
    pub cabeceras: Vec<(String, String)>,
    pub cuerpo: Vec<u8>,
    pub demora: Duration,
    pub con_longitud: bool,
    /// Cabeceras cuyo valor va en la red tal cual, byte a byte (puede no ser UTF-8). Se
    /// escriben detrás de `cabeceras`.
    pub crudas: Vec<(String, Vec<u8>)>,
}

impl Respuesta {
    pub fn nueva(estado: u16, cuerpo: &[u8]) -> Respuesta {
        Respuesta {
            estado,
            cabeceras: Vec::new(),
            cuerpo: cuerpo.to_vec(),
            demora: Duration::ZERO,
            con_longitud: true,
            crudas: Vec::new(),
        }
    }

    pub fn con(mut self, nombre: &str, valor: &str) -> Respuesta {
        self.cabeceras.push((nombre.to_string(), valor.to_string()));
        self
    }

    /// Cabecera con un valor en bytes crudos, sin pasar por UTF-8.
    pub fn con_bytes(mut self, nombre: &str, valor: &[u8]) -> Respuesta {
        self.crudas.push((nombre.to_string(), valor.to_vec()));
        self
    }

    pub fn tras(mut self, demora: Duration) -> Respuesta {
        self.demora = demora;
        self
    }

    /// Sin `Content-Length`: el cuerpo acaba al cerrar la conexión.
    pub fn sin_longitud(mut self) -> Respuesta {
        self.con_longitud = false;
        self
    }
}

type Responder = dyn Fn(&Recibida) -> Respuesta + Send + Sync;

pub struct Servidor {
    pub origen: String,
    pub puerto: u16,
    recibidas: Arc<Mutex<Vec<Recibida>>>,
    conexiones: Arc<AtomicUsize>,
    max_activas: Arc<AtomicUsize>,
}

impl Servidor {
    pub fn nuevo(responder: impl Fn(&Recibida) -> Respuesta + Send + Sync + 'static) -> Servidor {
        let escucha = TcpListener::bind("127.0.0.1:0").expect("no se pudo abrir el servidor falso");
        let puerto = escucha.local_addr().unwrap().port();
        let recibidas = Arc::new(Mutex::new(Vec::new()));
        let conexiones = Arc::new(AtomicUsize::new(0));
        let activas = Arc::new(AtomicUsize::new(0));
        let max_activas = Arc::new(AtomicUsize::new(0));
        let responder: Arc<Responder> = Arc::new(responder);
        {
            let (recibidas, conexiones, max_activas) =
                (recibidas.clone(), conexiones.clone(), max_activas.clone());
            std::thread::spawn(move || {
                for flujo in escucha.incoming() {
                    let Ok(flujo) = flujo else { continue };
                    conexiones.fetch_add(1, Ordering::SeqCst);
                    let (recibidas, activas, max_activas, responder) =
                        (recibidas.clone(), activas.clone(), max_activas.clone(), responder.clone());
                    std::thread::spawn(move || {
                        atender_conexion(flujo, &recibidas, &activas, &max_activas, &*responder)
                    });
                }
            });
        }
        Servidor {
            origen: format!("http://127.0.0.1:{puerto}"),
            puerto,
            recibidas,
            conexiones,
            max_activas,
        }
    }

    /// Servidor que contesta siempre lo mismo.
    pub fn fijo(respuesta: Respuesta) -> Servidor {
        Servidor::nuevo(move |_| respuesta.clone())
    }

    /// Servidor que contesta 200 con el cuerpo `ok`.
    pub fn ok() -> Servidor {
        Servidor::fijo(Respuesta::nueva(200, b"ok").con("Content-Type", "text/plain"))
    }

    pub fn recibidas(&self) -> Vec<Recibida> {
        self.recibidas.lock().unwrap().clone()
    }

    /// La única petición recibida.
    pub fn unica(&self) -> Recibida {
        let r = self.recibidas();
        assert_eq!(r.len(), 1, "se esperaba una sola petición al servidor y llegaron {}", r.len());
        r.into_iter().next().unwrap()
    }

    /// Conexiones TCP aceptadas, lleven o no una petición.
    pub fn conexiones(&self) -> usize {
        self.conexiones.load(Ordering::SeqCst)
    }

    /// Máximo de peticiones atendidas a la vez.
    pub fn max_activas(&self) -> usize {
        self.max_activas.load(Ordering::SeqCst)
    }

    pub fn destino(&self) -> Destino {
        Destino::nuevo(&self.origen).expect("el origen del servidor falso debe ser un destino válido")
    }
}

fn atender_conexion(
    mut flujo: TcpStream,
    recibidas: &Mutex<Vec<Recibida>>,
    activas: &AtomicUsize,
    max_activas: &AtomicUsize,
    responder: &Responder,
) {
    let _ = flujo.set_read_timeout(Some(Duration::from_secs(10)));
    let Some(recibida) = leer_peticion(&mut flujo) else { return };
    let ahora = activas.fetch_add(1, Ordering::SeqCst) + 1;
    max_activas.fetch_max(ahora, Ordering::SeqCst);
    recibidas.lock().unwrap().push(recibida.clone());
    let respuesta = responder(&recibida);
    if !respuesta.demora.is_zero() {
        std::thread::sleep(respuesta.demora);
    }
    let mut salida = format!("HTTP/1.1 {} Prueba\r\n", respuesta.estado).into_bytes();
    for (n, v) in &respuesta.cabeceras {
        salida.extend_from_slice(format!("{n}: {v}\r\n").as_bytes());
    }
    for (n, v) in &respuesta.crudas {
        salida.extend_from_slice(format!("{n}: ").as_bytes());
        salida.extend_from_slice(v);
        salida.extend_from_slice(b"
");
    }
    if respuesta.con_longitud {
        salida.extend_from_slice(format!("Content-Length: {}\r\n", respuesta.cuerpo.len()).as_bytes());
    }
    salida.extend_from_slice(b"Connection: close\r\n\r\n");
    if recibida.metodo != "HEAD" {
        salida.extend_from_slice(&respuesta.cuerpo);
    }
    // Se descuenta antes de escribir: así la siguiente petición del proxy nunca se cuenta junto
    // a una que ya terminó.
    activas.fetch_sub(1, Ordering::SeqCst);
    let _ = flujo.write_all(&salida);
    let _ = flujo.flush();
    let _ = flujo.shutdown(Shutdown::Write);
    // Se espera a que el cliente cierre, para no cortar una respuesta grande a medias.
    let mut resto = [0u8; 256];
    while matches!(flujo.read(&mut resto), Ok(n) if n > 0) {}
}

fn leer_peticion(flujo: &mut TcpStream) -> Option<Recibida> {
    let mut datos = Vec::new();
    let mut trozo = [0u8; 16 * 1024];
    let fin_cabeceras = loop {
        if let Some(i) = buscar(&datos, b"\r\n\r\n") {
            break i;
        }
        match flujo.read(&mut trozo) {
            Ok(0) | Err(_) => return None,
            Ok(n) => datos.extend_from_slice(&trozo[..n]),
        }
    };
    let cabecera = String::from_utf8_lossy(&datos[..fin_cabeceras]).into_owned();
    let mut resto = datos[fin_cabeceras + 4..].to_vec();
    let mut lineas = cabecera.split("\r\n");
    let mut primera = lineas.next()?.split(' ');
    let metodo = primera.next()?.to_string();
    let destino = primera.next()?.to_string();
    let cabeceras: Vec<(String, String)> = lineas
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| (n.trim().to_string(), v.trim().to_string()))
        .collect();
    let valor = |nombre: &str| {
        cabeceras.iter().find(|(n, _)| n.eq_ignore_ascii_case(nombre)).map(|(_, v)| v.clone())
    };
    let troceado = valor("transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked"));
    let cuerpo = if troceado {
        leer_troceado(flujo, &mut resto)?
    } else {
        let largo: usize = valor("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
        while resto.len() < largo {
            match flujo.read(&mut trozo) {
                Ok(0) | Err(_) => return None,
                Ok(n) => resto.extend_from_slice(&trozo[..n]),
            }
        }
        resto.truncate(largo);
        resto
    };
    Some(Recibida { metodo, destino, cabeceras, cuerpo })
}

fn leer_troceado(flujo: &mut TcpStream, pendiente: &mut Vec<u8>) -> Option<Vec<u8>> {
    let mut cuerpo = Vec::new();
    let mut trozo = [0u8; 16 * 1024];
    loop {
        let fin_linea = loop {
            if let Some(i) = buscar(pendiente, b"\r\n") {
                break i;
            }
            match flujo.read(&mut trozo) {
                Ok(0) | Err(_) => return None,
                Ok(n) => pendiente.extend_from_slice(&trozo[..n]),
            }
        };
        let linea = String::from_utf8_lossy(&pendiente[..fin_linea]).into_owned();
        let largo = usize::from_str_radix(linea.split(';').next()?.trim(), 16).ok()?;
        pendiente.drain(..fin_linea + 2);
        while pendiente.len() < largo + 2 {
            match flujo.read(&mut trozo) {
                Ok(0) | Err(_) => return None,
                Ok(n) => pendiente.extend_from_slice(&trozo[..n]),
            }
        }
        if largo == 0 {
            return Some(cuerpo);
        }
        cuerpo.extend_from_slice(&pendiente[..largo]);
        pendiente.drain(..largo + 2);
    }
}

fn buscar(datos: &[u8], aguja: &[u8]) -> Option<usize> {
    datos.windows(aguja.len()).position(|v| v == aguja)
}

/// Un puerto de loopback en el que no escucha nadie.
pub fn puerto_cerrado() -> u16 {
    let escucha = TcpListener::bind("127.0.0.1:0").unwrap();
    escucha.local_addr().unwrap().port()
}

/// Límites cortos para que un test colgado falle pronto.
pub fn limites() -> Limites {
    Limites {
        cuerpo_peticion: 1024 * 1024,
        cuerpo_respuesta: 1024 * 1024,
        timeout_conexion: Duration::from_secs(5),
        timeout_total: Duration::from_secs(10),
        simultaneas: 4,
        // El tope de peticiones en espera (`en_espera`) queda en su valor por defecto.
        ..Limites::default()
    }
}

pub fn token() -> Token {
    Token::nuevo(TOKEN).expect("el token de prueba debe ser válido")
}

pub fn con_token() -> Arc<dyn FuenteDeToken> {
    Arc::new(TokenFijo(Some(token())))
}

pub fn sin_token() -> Arc<dyn FuenteDeToken> {
    Arc::new(TokenFijo(None))
}

/// Proxy con token y límites de prueba hacia el servidor falso.
pub fn proxy(servidor: &Servidor) -> Proxy {
    Proxy::nuevo(servidor.destino(), con_token(), limites())
}

/// Petición como las que entrega el webview: `portal://localhost/ruta?consulta`.
pub fn peticion(metodo: &str, ruta: &str) -> http::request::Builder {
    Request::builder().method(metodo).uri(format!("portal://localhost{ruta}"))
}

pub fn get(ruta: &str) -> Request<Vec<u8>> {
    peticion("GET", ruta).body(Vec::new()).unwrap()
}

/// Navegación del marco principal: GET que acepta HTML.
pub fn navegar(ruta: &str) -> Request<Vec<u8>> {
    peticion("GET", ruta)
        .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .body(Vec::new())
        .unwrap()
}

pub fn cabecera(respuesta: &Response<Vec<u8>>, nombre: &str) -> Option<String> {
    respuesta.headers().get(nombre).map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
}

pub fn texto(respuesta: &Response<Vec<u8>>) -> String {
    String::from_utf8_lossy(respuesta.body()).into_owned()
}

/// Pasa la petición por el proxy y comprueba lo que debe cumplir **toda** respuesta que llega al
/// webview: sin el token, sin `Set-Cookie`, sin cabeceras de salto, sin `Content-Encoding` y con
/// un `Content-Length` que, si viene, coincide con el cuerpo.
pub fn pedir(proxy: &Proxy, peticion: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let es_head = peticion.method() == http::Method::HEAD;
    let respuesta = proxy.atender(peticion);
    assert!(
        !contiene(respuesta.body(), TOKEN.as_bytes()),
        "el token aparece en el cuerpo de la respuesta"
    );
    for (nombre, valor) in respuesta.headers() {
        assert!(
            !contiene(valor.as_bytes(), TOKEN.as_bytes()),
            "el token aparece en la cabecera de respuesta {nombre}"
        );
    }
    for prohibida in [
        "set-cookie",
        "connection",
        "keep-alive",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
        "proxy-authenticate",
        "proxy-authorization",
        "content-encoding",
    ] {
        assert!(
            !respuesta.headers().contains_key(prohibida),
            "la respuesta al webview no debe llevar la cabecera {prohibida}"
        );
    }
    if !es_head {
        if let Some(largo) = cabecera(&respuesta, "content-length") {
            assert_eq!(
                largo,
                respuesta.body().len().to_string(),
                "Content-Length no coincide con el cuerpo entregado"
            );
        }
    }
    respuesta
}

pub fn contiene(datos: &[u8], aguja: &[u8]) -> bool {
    buscar(datos, aguja).is_some()
}

/// Comprueba que es una respuesta JSON generada por la cáscara, con ese estado.
pub fn es_error_local(respuesta: &Response<Vec<u8>>, estado: u16) {
    assert_eq!(respuesta.status().as_u16(), estado, "cuerpo: {}", texto(respuesta));
    let tipo = cabecera(respuesta, "content-type").unwrap_or_default();
    assert!(tipo.starts_with("application/json"), "content-type de un error local: {tipo:?}");
    let cache = cabecera(respuesta, "cache-control").unwrap_or_default();
    assert!(cache.contains("no-store"), "un error local lleva Cache-Control: no-store");
    assert_eq!(cabecera(respuesta, "x-content-type-options").as_deref(), Some("nosniff"));
    let cuerpo = texto(respuesta);
    assert!(
        cuerpo.starts_with("{\"error\":\"") && cuerpo.ends_with("\"}"),
        "un error local es {{\"error\":\"…\"}}, no {cuerpo:?}"
    );
}

/// gzip válido con un único bloque sin comprimir (hasta 65 535 bytes).
pub fn gzip(datos: &[u8]) -> Vec<u8> {
    assert!(datos.len() <= 0xFFFF);
    let largo = datos.len() as u16;
    let mut v = vec![0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03, 0x01];
    v.extend_from_slice(&largo.to_le_bytes());
    v.extend_from_slice(&(!largo).to_le_bytes());
    v.extend_from_slice(datos);
    v.extend_from_slice(&crc32(datos).to_le_bytes());
    v.extend_from_slice(&(datos.len() as u32).to_le_bytes());
    v
}

fn crc32(datos: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in datos {
        crc ^= *byte as u32;
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// gzip real (deflate con compresión) de 3000 bytes `a`: 39 bytes en la red. Generado con
/// `zlib.gzipSync(Buffer.alloc(3000, "a"), { level: 9 })` de Node.
pub const GZIP_3000_A: [u8; 39] = [
    0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x0a, 0xed, 0xc1, 0x31, 0x01, 0x00, 0x00,
    0x00, 0xc2, 0xa0, 0xac, 0xeb, 0x5f, 0xc2, 0x1a, 0x1e, 0x40, 0x01, 0x00, 0x00, 0xef, 0x06, 0xc8,
    0x3c, 0xdc, 0x5e, 0xb8, 0x0b, 0x00, 0x00,
];

// ---------- Sincronización sin esperas a ciegas (hilos 7 a 9 de CodeRabbit en el PR 72) ----------

/// Plazo máximo para que ocurra algo que el test espera. Solo acota un test colgado: ningún
/// resultado depende de que se agote.
pub const PLAZO: Duration = Duration::from_secs(5);

/// Espera, como mucho `PLAZO`, a que se cumpla `condicion`. Si no se cumple, el test falla con
/// `que`. Sondea estado observable; no es una espera a ciegas.
pub fn esperar_hasta(que: &str, mut condicion: impl FnMut() -> bool) {
    let limite = std::time::Instant::now() + PLAZO;
    while !condicion() {
        assert!(std::time::Instant::now() < limite, "no ocurrió en {PLAZO:?}: {que}");
        std::thread::sleep(Duration::from_millis(2));
    }
}

#[derive(Default)]
struct EstadoCompuerta {
    llegadas: Vec<String>,
    permisos: usize,
    abierta: bool,
}

/// Retiene en el servidor falso cada petición que llega hasta que el test la suelta. Mientras
/// una petición está retenida, el proxy tiene ocupado su hueco: es la ocupación observable que
/// sustituye a «esperar 300 ms y suponer».
#[derive(Clone, Default)]
pub struct Compuerta(Arc<(Mutex<EstadoCompuerta>, std::sync::Condvar)>);

impl Compuerta {
    pub fn nueva() -> Compuerta {
        Compuerta::default()
    }

    /// Para el servidor: anota la llegada y espera permiso. Como mucho 20 s, para que un test
    /// que falla no deje hilos colgados para siempre.
    fn retener(&self, destino: &str) {
        let (estado, aviso) = &*self.0;
        let mut estado = estado.lock().unwrap();
        estado.llegadas.push(destino.to_string());
        aviso.notify_all();
        let limite = std::time::Instant::now() + Duration::from_secs(20);
        while !estado.abierta && estado.permisos == 0 {
            let ahora = std::time::Instant::now();
            if ahora >= limite {
                return;
            }
            estado = aviso.wait_timeout(estado, limite - ahora).unwrap().0;
        }
        if !estado.abierta {
            estado.permisos -= 1;
        }
    }

    /// Deja pasar `n` peticiones retenidas (o las próximas en llegar).
    pub fn soltar(&self, n: usize) {
        let (estado, aviso) = &*self.0;
        estado.lock().unwrap().permisos += n;
        aviso.notify_all();
    }

    /// Deja pasar todo, lo retenido y lo que llegue.
    pub fn abrir(&self) {
        let (estado, aviso) = &*self.0;
        estado.lock().unwrap().abierta = true;
        aviso.notify_all();
    }

    /// Vuelve a retener lo que llegue a partir de ahora.
    pub fn cerrar(&self) {
        let (estado, _) = &*self.0;
        let mut estado = estado.lock().unwrap();
        estado.abierta = false;
        estado.permisos = 0;
    }

    /// Destinos (ruta y consulta) de las peticiones que han llegado, en orden de llegada.
    pub fn llegadas(&self) -> Vec<String> {
        self.0 .0.lock().unwrap().llegadas.clone()
    }

    /// Espera, como mucho `PLAZO`, a que hayan llegado al servidor `n` peticiones en total.
    pub fn esperar_llegadas(&self, n: usize) -> Vec<String> {
        let (estado, aviso) = &*self.0;
        let limite = std::time::Instant::now() + PLAZO;
        let mut estado = estado.lock().unwrap();
        while estado.llegadas.len() < n {
            let ahora = std::time::Instant::now();
            if ahora >= limite {
                // Se falla con el cerrojo ya suelto: un pánico con la guarda tomada envenena el
                // mutex y `abrir_al_salir` haría un segundo pánico al soltarse (aborto).
                let llegadas = estado.llegadas.len();
                drop(estado);
                panic!("llegaron {llegadas} peticiones al servidor y se esperaban {n}");
            }
            estado = aviso.wait_timeout(estado, limite - ahora).unwrap().0;
        }
        estado.llegadas.clone()
    }

    /// Abre la compuerta al soltar la guarda, también si el test falla: así ningún hilo del
    /// proxy se queda retenido hasta su timeout.
    pub fn abrir_al_salir(&self) -> AbrirAlSalir {
        AbrirAlSalir(self.clone())
    }
}

pub struct AbrirAlSalir(Compuerta);

impl Drop for AbrirAlSalir {
    fn drop(&mut self) {
        self.0.abrir();
    }
}

/// Servidor que contesta `respuesta` a todo, pero solo cuando la compuerta deja pasar.
pub fn servidor_retenido(compuerta: &Compuerta, respuesta: Respuesta) -> Servidor {
    let compuerta = compuerta.clone();
    Servidor::nuevo(move |recibida| {
        compuerta.retener(&recibida.destino);
        respuesta.clone()
    })
}
