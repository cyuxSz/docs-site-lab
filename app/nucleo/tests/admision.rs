//! Criterio 12 (hilo 2 de CodeRabbit en el PR 72): tope de peticiones pendientes **antes** de
//! crear el hilo que las atiende.
//!
//! Hasta ahora `main.rs` creaba un hilo por petición y solo después el proxy miraba si cabía en
//! la cola: una ráfaga creaba hilos sin límite. `Proxy::atender_en_hilo` cuenta la petición al
//! admitirla, y si ya hay `simultaneas + en_espera` pendientes responde 503 en el acto, en el
//! hilo que llama, sin crear ninguno.
//!
//! Criterio 19 (hilo `PRRT_kwDOVU6dHM68kqB7`): ese 503 síncrono a un HEAD va sin cuerpo.

mod comun;

use std::sync::{mpsc, Arc};
use std::thread::ThreadId;

use comun::*;
use nucleo::{Limites, Proxy};

const MARCOS: &str = "frame-src 'self'";

type Entregada = (&'static str, http::Response<Vec<u8>>, ThreadId);

/// Lanza la petición `nombre` con `atender_en_hilo`; su respuesta llega por `tx` junto con el
/// hilo en el que se entregó.
fn lanzar(proxy: &Arc<Proxy>, nombre: &'static str, tx: &mpsc::Sender<Entregada>) {
    let tx = tx.clone();
    proxy.atender_en_hilo(get(&format!("/api/x?n={nombre}")), move |respuesta| {
        let _ = tx.send((nombre, respuesta, std::thread::current().id()));
    });
}

fn csps(respuesta: &http::Response<Vec<u8>>) -> Vec<String> {
    respuesta
        .headers()
        .get_all("content-security-policy")
        .iter()
        .map(|v| String::from_utf8_lossy(v.as_bytes()).into_owned())
        .collect()
}

#[test]
fn c12_con_el_tope_de_pendientes_el_503_es_sincrono_y_sin_hilo() {
    let compuerta = Compuerta::nueva();
    let _abrir = compuerta.abrir_al_salir();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let limites = Limites { simultaneas: 1, en_espera: 1, ..limites() };
    let proxy = Arc::new(Proxy::nuevo(servidor.destino(), con_token(), limites));
    let aqui = std::thread::current().id();
    let (tx, rx) = mpsc::channel::<Entregada>();

    // A y B se admiten: cuentan como pendientes desde la llamada, sin esperar a sus hilos.
    lanzar(&proxy, "a", &tx);
    lanzar(&proxy, "b", &tx);
    assert_eq!(proxy.pendientes(), 2, "se cuentan al admitirlas");

    // C ya no cabe (1 + 1): la respuesta se entrega antes de que `atender_en_hilo` vuelva y en
    // este mismo hilo, es decir, sin crear ninguno.
    lanzar(&proxy, "c", &tx);
    let (nombre, respuesta, hilo) = rx.try_recv().expect("el 503 se entrega en el acto");
    assert_eq!(nombre, "c");
    assert_eq!(hilo, aqui, "el 503 se entrega sin crear un hilo");
    es_error_local(&respuesta, 503);
    assert_eq!(csps(&respuesta), [MARCOS], "lleva la CSP de marcos, como toda respuesta del proxy");
    assert_eq!(proxy.pendientes(), 2, "la rechazada no cuenta");

    // A y B se atienden en otros hilos y, al responder, dejan de contar.
    compuerta.abrir();
    let mut atendidas = Vec::new();
    for _ in 0..2 {
        let (nombre, respuesta, hilo) = rx.recv_timeout(PLAZO).expect("A y B deben responder");
        assert_eq!(respuesta.status().as_u16(), 200, "{nombre}");
        assert_ne!(hilo, aqui, "{nombre} se atiende en su propio hilo");
        atendidas.push(nombre);
    }
    atendidas.sort();
    assert_eq!(atendidas, ["a", "b"]);
    esperar_hasta("los pendientes vuelven a cero al responder", || proxy.pendientes() == 0);

    // Con sitio otra vez, la siguiente se admite.
    lanzar(&proxy, "d", &tx);
    let (nombre, respuesta, hilo) = rx.recv_timeout(PLAZO).expect("D debe responder");
    assert_eq!((nombre, respuesta.status().as_u16()), ("d", 200));
    assert_ne!(hilo, aqui);
    let destinos: Vec<String> = servidor.recibidas().into_iter().map(|r| r.destino).collect();
    assert_eq!(destinos.len(), 3, "C no llega a la red: {destinos:?}");
    assert!(!destinos.iter().any(|d| d.ends_with("n=c")), "{destinos:?}");
}

#[test]
fn c12_con_tope_de_espera_cero_el_tope_de_pendientes_es_el_de_simultaneas() {
    let compuerta = Compuerta::nueva();
    let _abrir = compuerta.abrir_al_salir();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let limites = Limites { simultaneas: 2, en_espera: 0, ..limites() };
    let proxy = Arc::new(Proxy::nuevo(servidor.destino(), con_token(), limites));
    let aqui = std::thread::current().id();
    let (tx, rx) = mpsc::channel::<Entregada>();

    lanzar(&proxy, "a", &tx);
    lanzar(&proxy, "b", &tx);
    lanzar(&proxy, "c", &tx);
    let (nombre, respuesta, hilo) = rx.try_recv().expect("el 503 se entrega en el acto");
    assert_eq!((nombre, hilo), ("c", aqui));
    es_error_local(&respuesta, 503);

    compuerta.abrir();
    for _ in 0..2 {
        let (nombre, respuesta, _) = rx.recv_timeout(PLAZO).expect("A y B deben responder");
        assert_eq!(respuesta.status().as_u16(), 200, "{nombre}");
    }
    esperar_hasta("los pendientes vuelven a cero al responder", || proxy.pendientes() == 0);
}

#[test]
fn c12_las_respuestas_locales_tambien_liberan_su_puesto() {
    // Una petición que el proxy responde en local (aquí, sin token) también cuenta mientras está
    // pendiente y deja de contar al responder: el contador no se queda a medias.
    let servidor = Servidor::ok();
    let limites = Limites { simultaneas: 1, en_espera: 0, ..limites() };
    let proxy = Arc::new(Proxy::nuevo(servidor.destino(), sin_token(), limites));
    let (tx, rx) = mpsc::channel::<Entregada>();
    for nombre in ["a", "b", "c"] {
        lanzar(&proxy, nombre, &tx);
        let (_, respuesta, _) = rx.recv_timeout(PLAZO).expect("debe responder");
        es_error_local(&respuesta, 401);
        esperar_hasta("el pendiente se libera", || proxy.pendientes() == 0);
    }
    assert_eq!(servidor.conexiones(), 0);
}

/// Comprueba el 503 síncrono a un HEAD: el estado y las cabeceras del 503 local, la CSP de
/// marcos y ningún byte de cuerpo.
fn es_503_head_sin_cuerpo(respuesta: &http::Response<Vec<u8>>) {
    assert_eq!(respuesta.status().as_u16(), 503);
    assert_eq!(csps(respuesta), [MARCOS], "lleva la CSP de marcos, como toda respuesta del proxy");
    assert_eq!(cabecera(respuesta, "cache-control").as_deref(), Some("no-store"));
    assert_eq!(cabecera(respuesta, "x-content-type-options").as_deref(), Some("nosniff"));
    assert!(
        respuesta.body().is_empty(),
        "un HEAD no lleva cuerpo, y el 503 síncrono entregó {:?}",
        texto(respuesta)
    );
}

#[test]
fn c19_con_el_tope_de_pendientes_un_head_recibe_el_503_sin_cuerpo() {
    let compuerta = Compuerta::nueva();
    let _abrir = compuerta.abrir_al_salir();
    let servidor = servidor_retenido(&compuerta, Respuesta::nueva(200, b"ok"));
    let limites = Limites { simultaneas: 1, en_espera: 0, ..limites() };
    let proxy = Arc::new(Proxy::nuevo(servidor.destino(), con_token(), limites));
    let aqui = std::thread::current().id();
    let (tx, rx) = mpsc::channel::<Entregada>();

    // A ocupa el único puesto de pendientes.
    lanzar(&proxy, "a", &tx);
    assert_eq!(proxy.pendientes(), 1);

    // Un HEAD que ya no cabe: 503 en el acto, en este hilo, sin cuerpo.
    let tx_head = tx.clone();
    proxy.atender_en_hilo(
        peticion("HEAD", "/api/x?n=head").body(Vec::new()).unwrap(),
        move |respuesta| {
            let _ = tx_head.send(("head", respuesta, std::thread::current().id()));
        },
    );
    let (nombre, respuesta, hilo) = rx.try_recv().expect("el 503 se entrega en el acto");
    assert_eq!((nombre, hilo), ("head", aqui));
    es_503_head_sin_cuerpo(&respuesta);

    // Un GET que no cabe sigue recibiendo el JSON de siempre.
    lanzar(&proxy, "get", &tx);
    let (nombre, respuesta, hilo) = rx.try_recv().expect("el 503 se entrega en el acto");
    assert_eq!((nombre, hilo), ("get", aqui));
    es_error_local(&respuesta, 503);
    assert_eq!(csps(&respuesta), [MARCOS]);
    assert_eq!(proxy.pendientes(), 1, "las rechazadas no cuentan");

    compuerta.abrir();
    let (nombre, respuesta, _) = rx.recv_timeout(PLAZO).expect("A debe responder");
    assert_eq!((nombre, respuesta.status().as_u16()), ("a", 200));
    esperar_hasta("los pendientes vuelven a cero al responder", || proxy.pendientes() == 0);
    let destinos: Vec<String> = servidor.recibidas().into_iter().map(|r| r.destino).collect();
    assert_eq!(destinos, ["/api/x?n=a"], "las rechazadas no llegan a la red");
}
