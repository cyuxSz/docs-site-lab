// Prototipo desechable (lote 0). Dos modos, elegidos por variables de entorno:
//   PROTO_MODO=remoto  -> ventana que carga https://docs.vanttec.workers.dev (prueba A)
//   (por defecto)      -> ventana servida por el protocolo propio `proto` (prueba B)
//   PROTO_HTTPS=1      -> use_https_scheme(true): https://proto.localhost en vez de http://
//   PROTO_ZOOM=1       -> zoom_hotkeys_enabled(true) (zoom y pellizco de WebView2)
//   PROTO_UPSTREAM    -> URL a la que /api/proxy reenvía el GET (servidor local de prueba)
//   PROTO_SALIDA       -> carpeta donde se escriben informe-b.json y peticiones.log
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use tauri::http::{Request, Response};
use tauri::{WebviewUrl, WebviewWindowBuilder};

const PAGINA: &str = include_str!("../../src/index.html");

fn salida() -> std::path::PathBuf {
    let dir = std::env::var("PROTO_SALIDA").unwrap_or_else(|_| ".".into());
    let _ = std::fs::create_dir_all(&dir);
    dir.into()
}

fn anotar(linea: &str) {
    eprintln!("{linea}");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(salida().join("peticiones.log"))
    {
        let _ = writeln!(f, "{linea}");
    }
}

fn json(estado: u16, v: serde_json::Value) -> Response<Vec<u8>> {
    Response::builder()
        .status(estado)
        .header("content-type", "application/json; charset=utf-8")
        .header("cache-control", "no-store")
        .header("x-desde-rust", "si")
        .body(v.to_string().into_bytes())
        .unwrap()
}

fn fnv1a(datos: &[u8]) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in datos {
        h ^= *b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

fn manejar(req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let ruta = req.uri().path().to_string();
    let metodo = req.method().as_str().to_string();
    let cuerpo = req.body();
    anotar(&format!(
        "{metodo} {} cuerpo={} bytes content-type={:?}",
        req.uri(),
        cuerpo.len(),
        req.headers().get("content-type")
    ));

    match ruta.as_str() {
        "/" | "/index.html" => Response::builder()
            .header("content-type", "text/html; charset=utf-8")
            .body(PAGINA.as_bytes().to_vec())
            .unwrap(),
        "/sw.js" => Response::builder()
            .header("content-type", "text/javascript")
            .body(b"self.addEventListener('fetch', () => {});".to_vec())
            .unwrap(),
        "/api/eco" => {
            let mut cabeceras = serde_json::Map::new();
            for (k, v) in req.headers() {
                cabeceras.insert(
                    k.as_str().to_string(),
                    String::from_utf8_lossy(v.as_bytes()).into_owned().into(),
                );
            }
            let sha: String = Sha256::digest(cuerpo)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            let texto = if cuerpo.len() <= 4096 {
                std::str::from_utf8(cuerpo).ok().map(str::to_string)
            } else {
                None
            };
            json(
                200,
                serde_json::json!({
                    "metodo": metodo,
                    "uri": req.uri().to_string(),
                    "consulta": req.uri().query(),
                    "cabeceras": cabeceras,
                    "bytes": cuerpo.len(),
                    "sha256": sha,
                    "fnv1a": fnv1a(cuerpo),
                    "texto": texto,
                }),
            )
        }
        "/api/estado/401" => json(401, serde_json::json!({"error": "sin sesion"})),
        "/api/estado/409" => json(409, serde_json::json!({"error": "version", "version": 7})),
        "/api/lento" => {
            // La API solo deja responder una vez con el cuerpo entero: se arma en 5 trozos
            // con pausas para que el cliente vea si le llegan escalonados o de golpe.
            let mut v = Vec::new();
            for i in 0..5 {
                std::thread::sleep(std::time::Duration::from_millis(300));
                v.extend_from_slice(format!("trozo {i}\n").as_bytes());
                v.extend(std::iter::repeat(b'.').take(64 * 1024));
            }
            Response::builder()
                .header("content-type", "text/plain")
                .body(v)
                .unwrap()
        }
        "/api/proxy" => {
            let destino = std::env::var("PROTO_UPSTREAM")
                .unwrap_or_else(|_| "http://127.0.0.1:8799/whoami".into());
            match ureq::get(&destino)
                .set("Authorization", "Bearer token-de-prueba-solo-en-rust")
                .call()
            {
                Ok(r) => {
                    let estado = r.status();
                    let tipo = r.content_type().to_string();
                    let mut datos = Vec::new();
                    let _ = r.into_reader().read_to_end(&mut datos);
                    Response::builder()
                        .status(estado)
                        .header("content-type", tipo)
                        .header("x-reenviado-a", destino)
                        .body(datos)
                        .unwrap()
                }
                Err(e) => json(502, serde_json::json!({"error": e.to_string()})),
            }
        }
        "/api/informe" => {
            let nombre = if std::env::var("PROTO_HTTPS").as_deref() == Ok("1") {
                "informe-b-https.json"
            } else {
                "informe-b-http.json"
            };
            let r = std::fs::write(salida().join(nombre), cuerpo);
            json(200, serde_json::json!({"escrito": r.is_ok()}))
        }
        _ => json(404, serde_json::json!({"error": "no existe", "ruta": ruta})),
    }
}

fn main() {
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("proto", |_ctx, req, responder| {
            std::thread::spawn(move || responder.respond(manejar(req)));
        })
        .setup(|app| {
            let remoto = std::env::var("PROTO_MODO").as_deref() == Ok("remoto");
            let https = std::env::var("PROTO_HTTPS").as_deref() == Ok("1");
            let url = if remoto {
                WebviewUrl::External("https://docs.vanttec.workers.dev/".parse().unwrap())
            } else {
                WebviewUrl::CustomProtocol("proto://localhost/index.html".parse().unwrap())
            };
            WebviewWindowBuilder::new(app, "main", url)
                .title(if remoto { "Prueba A: sitio remoto" } else { "Prueba B: protocolo" })
                .inner_size(1280.0, 860.0)
                .use_https_scheme(https)
                // Tauri lo deja en false: WebView2 queda con IsZoomControlEnabled e
                // IsPinchZoomEnabled apagados. PROTO_ZOOM=1 los enciende para comparar.
                .zoom_hotkeys_enabled(std::env::var("PROTO_ZOOM").as_deref() == Ok("1"))
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al arrancar");
}
