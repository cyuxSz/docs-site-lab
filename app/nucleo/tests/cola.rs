//! Criterio 4: tope de peticiones en espera de un hueco (`Limites::en_espera`).
//!
//! Sin esperas a ciegas (hilo 7 de CodeRabbit en el PR 72): la petición que ocupa el hueco se
//! queda retenida en el servidor falso (`Compuerta`) hasta que el test la suelta, y el test
//! espera a verla llegar antes de seguir. Así «el hueco está ocupado» es un hecho observado.

mod comun;

use std::sync::{mpsc, Arc};
use std::time::Instant;

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

/// Con el único hueco ocupado por una petición retenida en el servidor, lanza dos más a la vez.
/// Con un solo puesto de espera libre, la primera que llegue a la cola espera y la otra recibe
/// 503 **mientras el hueco sigue ocupado**, es decir, sin haber esperado. Cuál de las dos es
/// cuál no importa. Devuelve (rechazada, atendida).
fn ronda(proxy: &Arc<Proxy>, compuerta: &Compuerta, nombres: [&'static str; 3]) -> (&'static str, &'static str) {
    let [ocupa, x, y] = nombres;
    let ya_llegadas = compuerta.llegadas().len();
    compuerta.cerrar();
    std::thread::scope(|ambito| {
        // Dentro del ámbito: si el test falla, abre antes de esperar a los hilos.
        let _abrir = compuerta.abrir_al_salir();
        let a = ambito.spawn(|| pedir(proxy, subida(ocupa)).status().as_u16());
        compuerta.esperar_llegadas(ya_llegadas + 1);

        let (tx, rx) = mpsc::channel();
        for nombre in [x, y] {
            let tx = tx.clone();
            ambito.spawn(move || {
                let inicio = Instant::now();
                let respuesta = pedir(proxy, subida(nombre));
                let _ = tx.send((nombre, respuesta, inicio.elapsed()));
            });
        }

        let (rechazada, respuesta, tardo) =
            rx.recv_timeout(PLAZO).expect("una de las dos debe recibir el 503 sin esperar a que se libere el hueco");
        es_error_local(&respuesta, 503);
        // Esperar en la cola y rendirse tarda al menos `timeout_total`: no es lo que pasó.
        assert!(tardo < limites().timeout_total, "el 503 por cola llena no espera: tardó {tardo:?}");
        assert_eq!(compuerta.llegadas().len(), ya_llegadas + 1, "la que ocupa el hueco sigue retenida");
        assert!(rx.try_recv().is_err(), "la otra sigue esperando su turno en la cola");

        compuerta.abrir();
        assert_eq!(a.join().unwrap(), 200);
        let (atendida, respuesta, _) = rx.recv_timeout(PLAZO).expect("la que esperaba en la cola debe atenderse");
        assert_eq!(respuesta.status().as_u16(), 200, "la que sí cabía en la cola se atiende");
        (rechazada, atendida)
    })
}

#[test]
fn c4_el_tope_de_peticiones_en_espera_por_defecto_es_explicito() {
    assert_eq!(Limites::default().en_espera, 64);
}

#[test]
fn c4_con_la_cola_llena_el_503_es_inmediato_y_sin_red() {
    let compuerta = Compuerta::nueva();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let proxy = con_cola(&servidor, 1, 1);

    let (rechazada, atendida) = ronda(&proxy, &compuerta, ["a", "b", "c"]);
    let destinos: Vec<String> = servidor.recibidas().into_iter().map(|r| r.destino).collect();
    assert_eq!(destinos.len(), 2, "la petición rechazada no llega a la red: {destinos:?}");
    assert!(destinos.iter().any(|d| d.ends_with("n=a")), "{destinos:?}");
    assert!(destinos.iter().any(|d| d.ends_with(&format!("n={atendida}"))), "{destinos:?}");
    assert!(!destinos.iter().any(|d| d.ends_with(&format!("n={rechazada}"))), "{destinos:?}");
    assert_eq!(servidor.max_activas(), 1);

    // Al vaciarse la cola vuelve a haber sitio para esperar: si el puesto no se hubiera
    // liberado, en esta ronda las dos recibirían el 503 y ninguna se atendería.
    let (rechazada, atendida) = ronda(&proxy, &compuerta, ["d", "e", "f"]);
    let destinos: Vec<String> = servidor.recibidas().into_iter().map(|r| r.destino).collect();
    assert_eq!(destinos.len(), 4, "{destinos:?}");
    assert!(destinos.iter().any(|d| d.ends_with(&format!("n={atendida}"))), "{destinos:?}");
    assert!(!destinos.iter().any(|d| d.ends_with(&format!("n={rechazada}"))), "{destinos:?}");
    assert_eq!(servidor.max_activas(), 1);
}

#[test]
fn c4_con_tope_cero_nadie_espera() {
    let compuerta = Compuerta::nueva();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let proxy = con_cola(&servidor, 1, 0);
    std::thread::scope(|ambito| {
        // Dentro del ámbito: si el test falla, abre antes de esperar a los hilos.
        let _abrir = compuerta.abrir_al_salir();
        let a = ambito.spawn(|| pedir(&proxy, get("/api/x?n=a")).status().as_u16());
        compuerta.esperar_llegadas(1);

        // A ocupa el hueco y sigue retenida: B no tiene dónde esperar.
        let inicio = Instant::now();
        es_error_local(&pedir(&proxy, get("/api/x?n=b")), 503);
        let tardo = inicio.elapsed();
        assert!(tardo < limites().timeout_total, "el 503 con tope cero no espera: tardó {tardo:?}");
        assert_eq!(compuerta.llegadas(), ["/api/x?n=a"], "A seguía ocupando el hueco");

        compuerta.abrir();
        assert_eq!(a.join().unwrap(), 200);
    });
    assert_eq!(servidor.recibidas().len(), 1);
    // Con un hueco libre no hace falta esperar: pasa aunque el tope de espera sea cero.
    assert_eq!(pedir(&proxy, get("/api/x?n=c")).status().as_u16(), 200);
}
