//! Criterio 4: tope de peticiones en espera de un hueco (`Limites::en_espera`).
//!
//! Va en su propio archivo porque usa un campo nuevo de `Limites`: mientras no exista, este
//! archivo no compila (E0560 y E0609) y los demás archivos de test no cambian.

mod comun;

use std::sync::Arc;
use std::time::{Duration, Instant};

use comun::*;
use nucleo::{Limites, Proxy};

fn con_cola(servidor: &Servidor, simultaneas: usize, en_espera: usize) -> Arc<Proxy> {
    let limites = Limites { simultaneas, en_espera, ..limites() };
    Arc::new(Proxy::nuevo(servidor.destino(), con_token(), limites))
}

fn subida(nombre: &str) -> http::Request<Vec<u8>> {
    peticion("PUT", &format!("/api/archivos/?n={nombre}"))
        .header("Content-Type", "application/octet-stream")
        .body(vec![7u8; 512 * 1024])
        .unwrap()
}

#[test]
fn c4_el_tope_de_peticiones_en_espera_por_defecto_es_explicito() {
    assert_eq!(Limites::default().en_espera, 64);
}

#[test]
fn c4_con_la_cola_llena_el_503_es_inmediato_y_sin_red() {
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"ok").tras(Duration::from_millis(1200)));
    let proxy = con_cola(&servidor, 1, 1);
    std::thread::scope(|ambito| {
        // A ocupa el único hueco durante 1,2 s; B ocupa el único puesto de espera.
        let a = ambito.spawn(|| pedir(&proxy, subida("a")).status().as_u16());
        std::thread::sleep(Duration::from_millis(300));
        let b = ambito.spawn(|| pedir(&proxy, subida("b")).status().as_u16());
        std::thread::sleep(Duration::from_millis(300));

        // C ya no cabe: 503 al momento, sin esperar a que A termine.
        let inicio = Instant::now();
        let c = pedir(&proxy, subida("c"));
        let tardo = inicio.elapsed();
        es_error_local(&c, 503);
        assert!(tardo < Duration::from_millis(400), "el 503 debe ser inmediato: tardó {tardo:?}");

        assert_eq!(a.join().unwrap(), 200);
        assert_eq!(b.join().unwrap(), 200, "la que sí cabía en la cola se atiende");
    });
    let destinos: Vec<String> = servidor.recibidas().into_iter().map(|r| r.destino).collect();
    assert_eq!(destinos.len(), 2, "la petición rechazada no llega a la red: {destinos:?}");
    assert!(!destinos.iter().any(|d| d.ends_with("n=c")), "{destinos:?}");
    assert_eq!(servidor.max_activas(), 1);

    // Al vaciarse la cola vuelve a haber sitio, también para esperar.
    std::thread::scope(|ambito| {
        let d = ambito.spawn(|| pedir(&proxy, subida("d")).status().as_u16());
        std::thread::sleep(Duration::from_millis(300));
        let e = ambito.spawn(|| pedir(&proxy, subida("e")).status().as_u16());
        assert_eq!(d.join().unwrap(), 200);
        assert_eq!(e.join().unwrap(), 200, "el puesto de espera se libera al salir de la cola");
    });
}

#[test]
fn c4_con_tope_cero_nadie_espera() {
    let servidor = Servidor::fijo(Respuesta::nueva(200, b"ok").tras(Duration::from_millis(900)));
    let proxy = con_cola(&servidor, 1, 0);
    std::thread::scope(|ambito| {
        let a = ambito.spawn(|| pedir(&proxy, get("/api/x?n=a")).status().as_u16());
        std::thread::sleep(Duration::from_millis(300));
        let inicio = Instant::now();
        es_error_local(&pedir(&proxy, get("/api/x?n=b")), 503);
        let tardo = inicio.elapsed();
        assert!(tardo < Duration::from_millis(400), "el 503 debe ser inmediato: tardó {tardo:?}");
        assert_eq!(a.join().unwrap(), 200);
    });
    assert_eq!(servidor.recibidas().len(), 1);
    // Con un hueco libre no hace falta esperar: pasa aunque el tope de espera sea cero.
    assert_eq!(pedir(&proxy, get("/api/x?n=c")).status().as_u16(), 200);
}
