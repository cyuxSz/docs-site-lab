//! Criterio 19 (hilo `PRRT_kwDOVU6dHM68kqB7`), rama «el sistema no deja crear el hilo» de
//! `Proxy::atender_en_hilo`: un HEAD recibe el 503 síncrono sin cuerpo; el resto, el JSON.
//!
//! Va en un binario propio sin el arnés de `libtest` (`harness = false` en `Cargo.toml`): el
//! fallo al crear el hilo se provoca con `RUST_MIN_STACK` enorme, que `std` lee una sola vez, en
//! el primer hilo que se crea. Con el arnés ese primer hilo es el del propio test y ya no se
//! podría cambiar. Aquí no se crea ningún hilo antes de fijarla.

mod comun;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use comun::*;
use nucleo::{Destino, Proxy};

const MARCOS: &str = "frame-src 'self'";

fn csps(respuesta: &http::Response<Vec<u8>>) -> Vec<String> {
    respuesta
        .headers()
        .get_all("content-security-policy")
        .iter()
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
        .collect()
}

/// Atiende `peticion` con `atender_en_hilo` y devuelve la respuesta, que debe haberse entregado
/// antes de que la llamada vuelva y en este mismo hilo.
fn rechazada(proxy: &Arc<Proxy>, peticion: http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let aqui = std::thread::current().id();
    let entregada = Arc::new(std::sync::Mutex::new(None));
    let destino = Arc::clone(&entregada);
    proxy.atender_en_hilo(peticion, move |respuesta| {
        *destino.lock().unwrap() = Some((respuesta, std::thread::current().id()));
    });
    let (respuesta, hilo) =
        entregada.lock().unwrap().take().expect("sin hilo, el 503 se entrega en el acto");
    assert_eq!(hilo, aqui, "el 503 se entrega en el hilo que llama");
    assert_eq!(proxy.pendientes(), 0, "la petición que no tuvo hilo se descuenta");
    respuesta
}

fn main() {
    // 1 PiB de pila: ningún sistema la reserva, así que `thread::Builder::spawn` devuelve error.
    std::env::set_var("RUST_MIN_STACK", (1u64 << 50).to_string());
    assert!(
        std::thread::Builder::new().spawn(|| {}).is_err(),
        "este sistema creó un hilo con 1 PiB de pila: el test no puede provocar el fallo"
    );

    // Sin servidor: la petición no debe llegar a la red, y el servidor falso crea hilos.
    let destino = Destino::nuevo(&format!("http://127.0.0.1:{}", puerto_cerrado())).unwrap();
    let proxy = Arc::new(Proxy::nuevo(destino, con_token(), limites()));
    let fallos: Rc<RefCell<Vec<String>>> = Rc::default();

    let caso = |nombre: &str, prueba: &dyn Fn()| {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(prueba)) {
            Ok(()) => println!("test {nombre} ... ok"),
            Err(_) => {
                println!("test {nombre} ... FAILED");
                fallos.borrow_mut().push(nombre.to_string());
            }
        }
    };

    caso("c19_sin_hilo_un_head_recibe_el_503_sin_cuerpo", &|| {
        let respuesta = rechazada(&proxy, peticion("HEAD", "/api/x").body(Vec::new()).unwrap());
        assert_eq!(respuesta.status().as_u16(), 503);
        assert_eq!(csps(&respuesta), [MARCOS], "lleva la CSP de marcos");
        assert_eq!(cabecera(&respuesta, "cache-control").as_deref(), Some("no-store"));
        assert_eq!(cabecera(&respuesta, "x-content-type-options").as_deref(), Some("nosniff"));
        assert!(
            respuesta.body().is_empty(),
            "un HEAD no lleva cuerpo, y el 503 sin hilo entregó {:?}",
            texto(&respuesta)
        );
    });

    caso("c19_sin_hilo_un_get_sigue_recibiendo_el_503_json", &|| {
        let respuesta = rechazada(&proxy, get("/api/x"));
        es_error_local(&respuesta, 503);
        assert_eq!(csps(&respuesta), [MARCOS]);
    });

    let fallos = fallos.borrow();
    if !fallos.is_empty() {
        panic!("fallaron: {fallos:?}");
    }
}
