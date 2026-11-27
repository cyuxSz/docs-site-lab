// C1 importar: ejecutor de la importación (src/lib/importar-cola.ts). Secuencial, reanudable y con fetch, esperar y
// uuid inyectados:
//   crearImportacion({ plan, proyecto, disciplina, fetch, esperar, uuid, alProgreso?, plazos? }) → { ejecutar(senal?), estado() }
//   resumenResultado(estado) → { texto, pendientes, imagenes, reintentable, primera }
//   textoProgreso(evento) → string
// Por cada página: sus imágenes pendientes → crear → PUT con el md reescrito. La primera parte usa un servidor de guion;
// la segunda conecta la cola a los handlers reales (lib/hardware-core.mjs y lib/archivos-core.mjs) con el almacén en
// memoria, para comprobar el contrato de verdad, incluido el límite de 10 escrituras por minuto.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { almacenMemoria } from "./fixtures/almacen-memoria.mjs";
import { DEMO } from "./fixtures/acceso-demo.mjs";

const ORIGIN = "https://docs.example";
const SECRET = "s".repeat(40);
const EDITOR = "edi";
const PNG1 = new Uint8Array([137, 80, 78, 71, 1, 1, 1]);
const PNG2 = new Uint8Array([137, 80, 78, 71, 2, 2, 2, 2]);
const enc = (s) => new TextEncoder().encode(s);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

async function modulo() {
  try {
    return await import("../src/lib/importar-cola.ts");
  } catch (e) {
    assert.fail(`no se pudo importar src/lib/importar-cola.ts: ${e.message}`);
  }
}
async function planDe(archivos, existentes = []) {
  const { analizar } = await import("../src/lib/importar-plan.ts");
  return analizar({ entradas: Object.entries(archivos).map(([ruta, v]) => ({ ruta, bytes: typeof v === "string" ? enc(v) : v })), existentes });
}

const MD_A = "# Alfa\n\n![uno](img/uno.png)\n";
const MD_B = "# Beta\n\n![uno](img/uno.png) ![dos](img/dos.png)\n\nVer [alfa](a.md).\n";
const MD_C = "# Gama\n";
const TRES = () => ({ "a.md": MD_A, "b.md": MD_B, "c.md": MD_C, "img/uno.png": PNG1, "img/dos.png": PNG2 });

const json = (status, cuerpo, headers = {}) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json", ...headers } });
const errorRed = () => {
  throw new TypeError("fetch failed");
};
// Petición que no contesta hasta que se aborta su señal (como un fetch real cortado).
const colgada = (ll) =>
  new Promise((_, rechazar) => {
    const s = ll.init.signal;
    assert.ok(s, "toda petición lleva signal para poder abortarla");
    const cortar = () => rechazar(new DOMException("abortada", "AbortError"));
    if (s.aborted) cortar();
    else s.addEventListener("abort", cortar, { once: true });
  });

// Servidor de guion. alPedir(llamada, n) puede devolver una Response (o promesa) o lanzar; n cuenta las llamadas de ese
// tipo ("subida", "crear", "put", "get"). Sin guion contesta bien a todo.
function servidor(alPedir) {
  const llamadas = [];
  const fetch = async (url, init = {}) => {
    assert.equal(typeof url, "string");
    assert.ok(url.startsWith("/api/"), `URL relativa al mismo origen: ${url}`);
    assert.equal(init.credentials, "same-origin", url);
    const u = new URL(url, ORIGIN);
    const metodo = init.method ?? "GET";
    const ll = { metodo, url, q: u.searchParams, init, cabeceras: new Headers(init.headers) };
    if (u.pathname === "/api/archivos/" && metodo === "POST") {
      ll.tipo = "subida";
      ll.cuerpo = new Uint8Array(await new Response(init.body).arrayBuffer());
    } else if (u.pathname === "/api/hardware/" && metodo === "GET") {
      ll.tipo = "get";
    } else if (u.pathname === "/api/hardware/" && (metodo === "POST" || metodo === "PUT")) {
      assert.equal(typeof init.body, "string", "cuerpo JSON como texto");
      ll.cuerpo = JSON.parse(init.body);
      ll.tipo = metodo === "PUT" ? "put" : ll.cuerpo.accion;
    } else {
      assert.fail(`petición inesperada: ${metodo} ${url}`);
    }
    llamadas.push(ll);
    const n = llamadas.filter((x) => x.tipo === ll.tipo).length;
    const guion = await alPedir?.(ll, n);
    if (guion) return guion;
    if (ll.tipo === "subida") return json(201, { id: ll.q.get("id"), nombre: ll.q.get("nombre"), tipo: "png" });
    if (ll.tipo === "crear") return json(201, { pagina: { slug: ll.cuerpo.pagina, titulo: ll.cuerpo.titulo, md: `# ${ll.cuerpo.titulo}\n`, autor: EDITOR, version: 7 } });
    if (ll.tipo === "put") return json(200, { pagina: { slug: ll.cuerpo.pagina, version: ll.cuerpo.version + 1 } });
    return json(404, { error: "Página no encontrada" });
  };
  return { fetch, llamadas, tipos: () => llamadas.map((l) => (l.tipo === "subida" ? `subida:${l.q.get("nombre")}` : `${l.tipo}:${l.cuerpo?.pagina ?? l.q.get("pagina")}`)) };
}

function uuids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

async function montar({ archivos = TRES(), existentes = [], alPedir, esperar, plazos, alProgreso } = {}) {
  const { crearImportacion } = await modulo();
  const srv = servidor(alPedir);
  const esperas = [];
  const imp = crearImportacion({
    plan: await planDe(archivos, existentes),
    proyecto: "uuv",
    disciplina: "electronica",
    fetch: srv.fetch,
    esperar: esperar ?? (async (ms) => void esperas.push(ms)),
    uuid: uuids(),
    alProgreso,
    plazos,
  });
  return { imp, srv, esperas };
}
const estados = (e) => e.paginas.map((p) => p.estado);
const TODO = ["subida:uno.png", "crear:alfa", "put:alfa", "subida:dos.png", "crear:beta", "put:beta", "crear:gama", "put:gama"];

// ---------- camino normal ----------

test("orden: por cada página, primero sus imágenes pendientes, luego crear y luego PUT; cada imagen se sube una sola vez", async () => {
  const { imp, srv } = await montar();
  const e = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), TODO);
  assert.deepEqual(estados(e), ["hecha", "hecha", "hecha"]);
  assert.deepEqual(e.imagenes.map((i) => i.estado), ["subida", "subida"]);
  assert.equal(e.detenido, null);
  assert.equal(e.total, 8, "2 escrituras por página y 1 por imagen");
  assert.equal(e.hechas, 8);
  assert.deepEqual(imp.estado(), e);
});

test("peticiones: subida directa binaria, crear y PUT con el md reescrito y la versión que devolvió crear; todo same-origin", async () => {
  const { imp, srv } = await montar();
  await imp.ejecutar();
  const [sUno, crear, put, sDos, , putB] = srv.llamadas;
  for (const s of [sUno, sDos]) {
    assert.match(s.cabeceras.get("content-type"), /^application\/octet-stream$/);
    assert.equal(s.q.get("proyecto"), "uuv");
    assert.equal(s.q.get("disciplina"), "electronica");
    assert.match(s.q.get("id"), UUID);
    assert.deepEqual([...s.q.keys()].sort(), ["disciplina", "id", "nombre", "proyecto"]);
  }
  assert.notEqual(sUno.q.get("id"), sDos.q.get("id"));
  assert.deepEqual([...sUno.cuerpo], [...PNG1]);
  assert.deepEqual([...sDos.cuerpo], [...PNG2]);
  assert.match(crear.cabeceras.get("content-type"), /^application\/json/);
  assert.deepEqual(crear.cuerpo, { proyecto: "uuv", disciplina: "electronica", accion: "crear", pagina: "alfa", titulo: "Alfa" });
  const urlUno = `/api/archivos/?proyecto=uuv&id=${sUno.q.get("id")}`;
  const urlDos = `/api/archivos/?proyecto=uuv&id=${sDos.q.get("id")}`;
  assert.deepEqual(put.cuerpo, { proyecto: "uuv", disciplina: "electronica", pagina: "alfa", md: `# Alfa\n\n![uno](${urlUno})\n`, version: 7 });
  assert.equal(putB.cuerpo.md, `# Beta\n\n![uno](${urlUno}) ![dos](${urlDos})\n\nVer [alfa](/uuv/electronica/?p=alfa).\n`);
});

test("resumenResultado: «Se importaron N de M páginas.», sin pendientes y con la primera página importada", async () => {
  const { resumenResultado } = await modulo();
  const { imp } = await montar();
  const r = resumenResultado(await imp.ejecutar());
  assert.equal(r.texto, "Se importaron 3 de 3 páginas.");
  assert.deepEqual(r.pendientes, []);
  assert.deepEqual(r.imagenes, []);
  assert.equal(r.reintentable, false);
  assert.equal(r.primera, "alfa");
  const una = await montar({ archivos: { "x.md": "# Equis\n" } });
  assert.equal(resumenResultado(await una.imp.ejecutar()).texto, "Se importó 1 de 1 página.");
});

test("progreso: avisa de cada operación y textoProgreso da las líneas del diálogo", async () => {
  const { textoProgreso } = await modulo();
  assert.equal(textoProgreso({ tipo: "pagina", n: 3, de: 12, titulo: "Título" }), "Página 3 de 12: «Título»");
  assert.equal(textoProgreso({ tipo: "imagen", n: 2, de: 5 }), "Subiendo imagen 2 de 5…");
  assert.equal(textoProgreso({ tipo: "espera", segundos: 42 }), "Esperando al límite de escrituras: 42 s");
  const eventos = [];
  const { imp } = await montar({ alProgreso: (ev) => eventos.push(ev) });
  await imp.ejecutar();
  assert.deepEqual(eventos.filter((e) => e.tipo === "imagen").map((e) => [e.n, e.de]), [[1, 2], [2, 2]]);
  assert.deepEqual(eventos.filter((e) => e.tipo === "pagina").map((e) => [e.n, e.de, e.titulo]).filter((x, i, a) => i === 0 || a[i - 1][0] !== x[0]), [[1, 3, "Alfa"], [2, 3, "Beta"], [3, 3, "Gama"]]);
});

// ---------- límite de tasa ----------

test("429: espera lo que diga retry-after (60 s si falta o no es un entero positivo) y repite la misma operación", async () => {
  for (const [cabecera, ms] of [["7", 7000], [undefined, 60000], ["abc", 60000], ["-5", 60000], ["0", 60000], ["1.5", 60000]]) {
    const eventos = [];
    const { imp, srv, esperas } = await montar({
      alPedir: (ll, n) => ((ll.tipo === "crear" && n === 1) || (ll.tipo === "subida" && n === 2) ? json(429, { error: "Demasiadas escrituras" }, cabecera === undefined ? {} : { "retry-after": cabecera }) : null),
      alProgreso: (ev) => eventos.push(ev),
    });
    const e = await imp.ejecutar();
    assert.deepEqual(esperas, [ms, ms], `retry-after ${cabecera}`);
    assert.deepEqual(srv.tipos(), ["subida:uno.png", "crear:alfa", "crear:alfa", "put:alfa", "subida:dos.png", "subida:dos.png", "crear:beta", "put:beta", "crear:gama", "put:gama"]);
    assert.deepEqual(srv.llamadas[1].cuerpo, srv.llamadas[2].cuerpo);
    assert.equal(srv.llamadas[4].url, srv.llamadas[5].url, "la subida se repite con el mismo id");
    assert.deepEqual(estados(e), ["hecha", "hecha", "hecha"]);
    assert.equal(e.hechas, 8);
    assert.deepEqual(eventos.filter((x) => x.tipo === "espera").map((x) => x.segundos), [ms / 1000, ms / 1000]);
  }
});

test("429: tras 5 esperas seguidas de la misma operación se detiene e informa; el contador es por operación; se puede reintentar", async () => {
  let atascado = true;
  const { resumenResultado } = await modulo();
  const { imp, srv, esperas } = await montar({
    alPedir: (ll, n) => {
      if (ll.tipo === "crear" && ll.cuerpo.pagina === "alfa" && n <= 4) return json(429, {}, { "retry-after": "3" }); // 4 esperas: sigue
      if (ll.tipo === "put" && ll.cuerpo.pagina === "alfa" && atascado) return json(429, {}, { "retry-after": "3" });
      return null;
    },
  });
  const e = await imp.ejecutar();
  assert.equal(esperas.length, 4 + 5);
  assert.equal(srv.llamadas.filter((l) => l.tipo === "put").length, 6, "5 esperas y un sexto intento, que ya no espera");
  assert.equal(e.detenido?.causa, "limite");
  assert.match(e.detenido.mensaje, /límite de escrituras/);
  assert.deepEqual(estados(e), ["creada", "pendiente", "pendiente"]);
  assert.equal(resumenResultado(e).reintentable, true);
  atascado = false;
  const antes = srv.llamadas.length;
  const e2 = await imp.ejecutar();
  assert.deepEqual(srv.tipos().slice(antes), TODO.slice(2), "al reintentar no repite la subida ni el crear");
  assert.equal(e2.detenido, null);
  assert.deepEqual(estados(e2), ["hecha", "hecha", "hecha"]);
});

// ---------- fallos a mitad ----------

test("fallo de red en el PUT: se detiene; la página queda creada sin contenido y las demás sin empezar; reintentar solo repite el PUT", async () => {
  const { resumenResultado } = await modulo();
  const { mensajeError } = await import("../src/lib/hardware-editor.ts");
  let roto = true;
  const { imp, srv } = await montar({ alPedir: (ll) => (ll.tipo === "put" && roto ? errorRed() : null) });
  const e = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), TODO.slice(0, 3), "tras el fallo no hay más peticiones");
  assert.deepEqual(e.detenido, { causa: "red", mensaje: mensajeError("red") });
  assert.deepEqual(estados(e), ["creada", "pendiente", "pendiente"]);
  const r = resumenResultado(e);
  assert.equal(r.texto, "Se importaron 0 de 3 páginas.");
  assert.deepEqual(r.pendientes, [{ titulo: "Alfa", motivo: "creada sin contenido" }, { titulo: "Beta", motivo: "sin empezar" }, { titulo: "Gama", motivo: "sin empezar" }]);
  assert.equal(r.reintentable, true);
  assert.equal(r.primera, null);
  roto = false;
  const e2 = await imp.ejecutar();
  assert.deepEqual(srv.tipos().slice(3), TODO.slice(2));
  assert.equal(srv.llamadas[3].cuerpo.version, 7);
  assert.deepEqual(estados(e2), ["hecha", "hecha", "hecha"]);
  assert.equal(resumenResultado(e2).texto, "Se importaron 3 de 3 páginas.");
  const total = srv.llamadas.length;
  await imp.ejecutar();
  assert.equal(srv.llamadas.length, total, "con todo hecho, ejecutar otra vez no pide nada");
});

test("timeout: una petición que no contesta se aborta al vencer el plazo y la importación se detiene", async () => {
  const { imp, srv } = await montar({ plazos: { api: 30, subida: 30 }, alPedir: (ll) => (ll.tipo === "crear" ? colgada(ll) : null) });
  const e = await imp.ejecutar();
  assert.equal(e.detenido?.causa, "timeout");
  assert.deepEqual(srv.tipos(), ["subida:uno.png", "crear:alfa"]);
  assert.deepEqual(estados(e), ["pendiente", "pendiente", "pendiente"]);
  assert.equal(e.imagenes.filter((i) => i.estado === "subida").length, 1);
});

test("errores por página: crear 409 «ya existe…», 413 «demasiado grande», PUT 409 «alguien cambió la página»; se sigue con las demás", async () => {
  const { resumenResultado } = await modulo();
  const cuatro = { ...TRES(), "d.md": "# Delta\n" };
  const { imp, srv } = await montar({
    archivos: cuatro,
    alPedir: (ll) => {
      if (ll.tipo === "crear" && ll.cuerpo.pagina === "alfa") return json(409, { error: "La página ya existe" });
      if (ll.tipo === "put" && ll.cuerpo.pagina === "beta") return json(413, { error: "Contenido demasiado grande" });
      if (ll.tipo === "put" && ll.cuerpo.pagina === "gama") return json(409, { error: "La página cambió", codigo: "version", version: 9 });
      return null;
    },
  });
  const e = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), ["subida:uno.png", "crear:alfa", "subida:dos.png", "crear:beta", "put:beta", "crear:gama", "put:gama", "crear:delta", "put:delta"]);
  assert.equal(e.detenido, null);
  assert.deepEqual(estados(e), ["fallida", "fallida", "fallida", "hecha"]);
  assert.match(e.paginas[0].motivo, /ya existe una página con ese nombre/);
  assert.match(e.paginas[1].motivo, /demasiado grande/);
  assert.match(e.paginas[2].motivo, /alguien cambió la página/);
  assert.equal(e.hechas, e.total, "lo que falló sin remedio también cuenta como resuelto en la barra");
  const r = resumenResultado(e);
  assert.equal(r.texto, "Se importó 1 de 4 páginas.");
  assert.deepEqual(r.pendientes.map((p) => p.titulo), ["Alfa", "Beta", "Gama"]);
  assert.equal(r.reintentable, false, "las fallidas no se reintentan");
  assert.equal(r.primera, "delta");
  const total = srv.llamadas.length;
  await imp.ejecutar();
  assert.equal(srv.llamadas.length, total);
});

test("401 y 403 detienen todo con el mensaje de mensajeError; 503 y el 409 de candado también detienen y dejan reintentar", async () => {
  const { resumenResultado } = await modulo();
  const { mensajeError, MENSAJE_CANDADO } = await import("../src/lib/hardware-editor.ts");
  const casos = [
    ["subida", json(401, { error: "Sesión requerida" }), "sesion", "Tu sesión caducó. Vuelve a iniciar sesión.", 1],
    ["subida", json(403, { error: "Solo los editores pueden subir archivos" }), "permiso", "Solo los editores pueden hacer esto.", 1],
    ["crear", json(403, { error: "Solo los editores pueden escribir" }), "permiso", mensajeError(403), 2],
    ["put", json(401, { error: "Sesión requerida" }), "sesion", mensajeError(401), 3],
    ["crear", json(503, { error: "Documentación no disponible" }), "servidor", mensajeError(503), 2],
    ["put", json(409, { error: "Hay otro guardado en curso; intenta de nuevo", codigo: "candado" }), "servidor", MENSAJE_CANDADO, 3],
    ["crear", json(409, { error: "Hay otro guardado en curso; intenta de nuevo", codigo: "candado" }), "servidor", MENSAJE_CANDADO, 2],
  ];
  for (const [tipo, respuesta, causa, mensaje, peticiones] of casos) {
    let primera = true;
    const { imp, srv, esperas } = await montar({
      alPedir: (ll) => {
        if (ll.tipo !== tipo || !primera) return null;
        primera = false;
        return respuesta.clone();
      },
    });
    const e = await imp.ejecutar();
    assert.deepEqual(e.detenido, { causa, mensaje }, `${tipo} ${respuesta.status}`);
    assert.equal(srv.llamadas.length, peticiones, `${tipo} ${respuesta.status}: se detiene en esa petición`);
    assert.deepEqual(esperas, []);
    assert.ok(!estados(e).includes("fallida") && !estados(e).includes("hecha"));
    assert.equal(resumenResultado(e).reintentable, true);
    const e2 = await imp.ejecutar();
    assert.deepEqual(estados(e2), ["hecha", "hecha", "hecha"], `${tipo} ${respuesta.status}: al reintentar termina`);
    assert.equal(srv.llamadas.filter((l) => l.tipo === "crear" && l.cuerpo.pagina === "alfa").length, tipo === "crear" ? 2 : 1);
  }
});

test("imagen que falla al subir: no se reintenta, la página se importa con esa referencia sin tocar y el resultado lo dice", async () => {
  const { resumenResultado } = await modulo();
  const { imp, srv } = await montar({ alPedir: (ll) => (ll.tipo === "subida" && ll.q.get("nombre") === "uno.png" ? json(413, { error: "Archivo demasiado grande" }) : null) });
  const e = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), TODO, "uno.png se intenta una sola vez aunque la usen dos páginas");
  assert.deepEqual(estados(e), ["hecha", "hecha", "hecha"]);
  const uno = e.imagenes.find((i) => i.nombre === "uno.png");
  assert.equal(uno.estado, "fallida");
  assert.match(uno.motivo, /demasiado grande/);
  assert.equal(srv.llamadas[2].cuerpo.md, MD_A);
  const idDos = srv.llamadas[3].q.get("id");
  assert.equal(srv.llamadas[5].cuerpo.md, `# Beta\n\n![uno](img/uno.png) ![dos](/api/archivos/?proyecto=uuv&id=${idDos})\n\nVer [alfa](/uuv/electronica/?p=alfa).\n`);
  const r = resumenResultado(e);
  assert.equal(r.texto, "Se importaron 3 de 3 páginas.");
  assert.equal(r.imagenes.length, 1);
  assert.equal(r.imagenes[0].nombre, "uno.png");
  assert.match(r.imagenes[0].motivo, /demasiado grande/);
  assert.equal(r.reintentable, false);
});

// ---------- detener ----------

test("Detener: aborta la petición en vuelo, no pide nada más y deja el estado listo para reintentar sin duplicar", async () => {
  const ctl = new AbortController();
  let colgar = true;
  const { imp, srv } = await montar({
    alPedir: (ll) => {
      if (ll.tipo !== "subida" || ll.q.get("nombre") !== "dos.png" || !colgar) return null;
      queueMicrotask(() => ctl.abort());
      return colgada(ll);
    },
  });
  const e = await imp.ejecutar(ctl.signal);
  assert.equal(e.detenido?.causa, "usuario");
  assert.deepEqual(srv.tipos(), TODO.slice(0, 4));
  assert.deepEqual(estados(e), ["hecha", "pendiente", "pendiente"]);
  colgar = false;
  const e2 = await imp.ejecutar(new AbortController().signal);
  assert.deepEqual(srv.tipos().slice(4), TODO.slice(3));
  assert.equal(srv.llamadas[4].url, srv.llamadas[3].url, "la subida dudosa se repite con el mismo id");
  assert.deepEqual(estados(e2), ["hecha", "hecha", "hecha"]);
});

test("Detener durante la espera del límite: corta la espera y no repite la operación hasta que se reintente", async () => {
  const ctl = new AbortController();
  let limitado = true;
  const pedidas = [];
  const esperar = (ms, senal) =>
    new Promise((resolver) => {
      pedidas.push(ms);
      assert.ok(senal, "esperar recibe la señal para poder cortarla");
      senal.addEventListener("abort", () => resolver(), { once: true });
      queueMicrotask(() => ctl.abort());
    });
  const { imp, srv } = await montar({ esperar, alPedir: (ll) => (ll.tipo === "crear" && limitado ? json(429, {}, { "retry-after": "42" }) : null) });
  const e = await imp.ejecutar(ctl.signal);
  assert.deepEqual(pedidas, [42000]);
  assert.equal(e.detenido?.causa, "usuario");
  assert.deepEqual(srv.tipos(), ["subida:uno.png", "crear:alfa"]);
  limitado = false;
  const e2 = await imp.ejecutar();
  assert.deepEqual(srv.tipos().slice(2), TODO.slice(1));
  assert.deepEqual(estados(e2), ["hecha", "hecha", "hecha"]);
});

test("señal ya abortada: no se pide nada", async () => {
  const { imp, srv } = await montar();
  const e = await imp.ejecutar(AbortSignal.abort());
  assert.equal(e.detenido?.causa, "usuario");
  assert.equal(srv.llamadas.length, 0);
});

// ---------- resultado dudoso (la petición se cortó y no se sabe si el servidor la aplicó) ----------

test("crear dudoso: si al reintentar da 409 y la página es el esbozo recién creado por mí, se adopta su versión y se sigue con el PUT", async () => {
  let roto = true;
  const { imp, srv } = await montar({
    archivos: { "c.md": MD_C },
    alPedir: (ll) => {
      if (ll.tipo === "crear" && roto) return errorRed();
      if (ll.tipo === "crear") return json(409, { error: "La página ya existe" });
      if (ll.tipo === "get") return json(200, { yo: EDITOR, editable: true, pagina: { slug: "gama", titulo: "Gama", md: "# Gama\n", autor: EDITOR, version: 4 } });
      return null;
    },
  });
  const e = await imp.ejecutar();
  assert.equal(e.detenido?.causa, "red");
  assert.deepEqual(estados(e), ["pendiente"]);
  roto = false;
  const e2 = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), ["crear:gama", "crear:gama", "get:gama", "put:gama"]);
  const get = srv.llamadas[2];
  assert.deepEqual([get.q.get("proyecto"), get.q.get("disciplina"), get.q.get("pagina")], ["uuv", "electronica", "gama"]);
  assert.equal(srv.llamadas[3].cuerpo.version, 4);
  assert.deepEqual(estados(e2), ["hecha"]);
});

test("crear dudoso: si la página que hay no es mi esbozo (otro contenido u otro autor), queda fallida «ya existe…» y no se pisa", async () => {
  const ajenas = [
    { slug: "gama", titulo: "Gama", md: "# Gama\n\nContenido de otra persona\n", autor: EDITOR, version: 4 },
    { slug: "gama", titulo: "Gama", md: "# Gama\n", autor: "otra", version: 1 },
  ];
  for (const pagina of ajenas) {
    let roto = true;
    const { imp, srv } = await montar({
      archivos: { "c.md": MD_C },
      alPedir: (ll) => {
        if (ll.tipo === "crear" && roto) return errorRed();
        if (ll.tipo === "crear") return json(409, { error: "La página ya existe" });
        if (ll.tipo === "get") return json(200, { yo: EDITOR, editable: true, pagina });
        return null;
      },
    });
    await imp.ejecutar();
    roto = false;
    const e = await imp.ejecutar();
    assert.deepEqual(estados(e), ["fallida"]);
    assert.match(e.paginas[0].motivo, /ya existe una página con ese nombre/);
    assert.equal(srv.llamadas.filter((l) => l.tipo === "put").length, 0);
  }
});

test("crear 409 sin duda previa: fallida directa, sin consultar la página", async () => {
  const { imp, srv } = await montar({ archivos: { "c.md": MD_C }, alPedir: (ll) => (ll.tipo === "crear" ? json(409, { error: "La página ya existe" }) : null) });
  const e = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), ["crear:gama"]);
  assert.deepEqual(estados(e), ["fallida"]);
});

test("PUT dudoso: si al reintentar da 409 de versión y la página ya tiene mi md, cuenta como hecha; si tiene otro, «alguien cambió la página»", async () => {
  for (const [mdServidor, final] of [[MD_C, "hecha"], ["# Gama\n\notra cosa\n", "fallida"]]) {
    let roto = true;
    const { imp, srv } = await montar({
      archivos: { "c.md": MD_C },
      alPedir: (ll) => {
        if (ll.tipo === "put" && roto) return errorRed();
        if (ll.tipo === "put") return json(409, { error: "La página cambió", codigo: "version", version: 8 });
        if (ll.tipo === "get") return json(200, { yo: EDITOR, editable: true, pagina: { slug: "gama", titulo: "Gama", md: mdServidor, autor: EDITOR, version: 8 } });
        return null;
      },
    });
    await imp.ejecutar();
    roto = false;
    const e = await imp.ejecutar();
    assert.deepEqual(srv.tipos(), ["crear:gama", "put:gama", "put:gama", "get:gama"]);
    assert.deepEqual(estados(e), [final]);
    if (final === "fallida") assert.match(e.paginas[0].motivo, /alguien cambió la página/);
  }
});

test("subida dudosa: se repite con el mismo id y un 409 («ese id ya existe») significa que la primera llegó: cuenta como subida", async () => {
  let roto = true;
  const { imp, srv } = await montar({
    archivos: { "a.md": MD_A, "img/uno.png": PNG1 },
    alPedir: (ll) => {
      if (ll.tipo === "subida" && roto) return errorRed();
      if (ll.tipo === "subida") return json(409, { error: "Ese id de archivo ya existe" });
      return null;
    },
  });
  const e = await imp.ejecutar();
  assert.equal(e.detenido?.causa, "red");
  assert.equal(e.imagenes[0].estado, "pendiente");
  roto = false;
  const e2 = await imp.ejecutar();
  assert.deepEqual(srv.tipos(), ["subida:uno.png", "subida:uno.png", "crear:alfa", "put:alfa"]);
  assert.equal(srv.llamadas[0].url, srv.llamadas[1].url);
  assert.equal(e2.imagenes[0].estado, "subida");
  assert.equal(srv.llamadas[3].cuerpo.md, `# Alfa\n\n![uno](/api/archivos/?proyecto=uuv&id=${srv.llamadas[0].q.get("id")})\n`);
});

// ---------- contra los handlers reales ----------

const PROYECTOS = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] }, mecanica: { plantilla: "mecanica", editores: ["meca"] } } }];

function cookieDe(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
function nubeFalsa() {
  return {
    objetos: new Map(),
    async subir(clave, stream, { contentType } = {}) {
      this.objetos.set(clave, { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), contentType });
    },
    async leer(clave) {
      const o = this.objetos.get(clave);
      return o ? { stream: new Response(o.bytes).body, contentType: o.contentType, size: o.bytes.length } : null;
    },
    async borrar(clave) {
      this.objetos.delete(clave);
    },
  };
}
// Portal real en memoria. fetchDe(login) hace lo que haría el navegador: añade cookie, Origin y Content-Length.
async function portal() {
  const redis = almacenMemoria();
  const nube = nubeFalsa();
  const comun = { env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS, restringidos: DEMO };
  const hardware = (await import("../lib/hardware-core.mjs")).crearHandler({ ...comun, plantillas: {} });
  const archivos = (await import("../lib/archivos-core.mjs")).crearHandler({ ...comun, blob: nube });
  const estadosHttp = [];
  const fetchDe = (login) => async (url, init = {}) => {
    assert.ok(url.startsWith("/api/"), url);
    assert.equal(init.credentials, "same-origin");
    const u = new URL(url, ORIGIN);
    const metodo = init.method ?? "GET";
    const headers = new Headers(init.headers);
    headers.set("cookie", cookieDe(login));
    let body;
    if (metodo !== "GET") {
      headers.set("origin", ORIGIN);
      body = typeof init.body === "string" ? init.body : new Uint8Array(await new Response(init.body).arrayBuffer());
      if (typeof body !== "string") headers.set("content-length", String(body.length));
    }
    const res = await (u.pathname === "/api/archivos/" ? archivos : hardware)(new Request(u, { method: metodo, headers, body }));
    estadosHttp.push(res.status);
    return res;
  };
  const get = async (login, ruta) => (await fetchDe(login)(ruta, { credentials: "same-origin" })).json();
  return { redis, nube, fetchDe, get, estadosHttp };
}
const BASE = { proyecto: "uuv", disciplina: "electronica" };
const escribir = (p, login, metodo, cuerpo) => p.fetchDe(login)("/api/hardware/", { method: metodo, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...BASE, ...cuerpo }) });
const subirDirecto = (p, login, id) => p.fetchDe(login)(`/api/archivos/?proyecto=uuv&disciplina=electronica&id=${id}&nombre=x.png`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body: PNG1 });

test("regresión de permisos (API, ya en verde): crear, PUT y la subida directa devuelven 403 a quien no es editor de la disciplina", async () => {
  const p = await portal();
  assert.equal((await escribir(p, EDITOR, "POST", { accion: "crear", pagina: "pcb", titulo: "PCB" })).status, 201);
  for (const login of ["ana", "meca"]) {
    assert.equal((await escribir(p, login, "POST", { accion: "crear", pagina: "nueva", titulo: "Nueva" })).status, 403, `crear ${login}`);
    assert.equal((await escribir(p, login, "PUT", { pagina: "pcb", md: "# Pisada\n", version: 1 })).status, 403, `PUT ${login}`);
    assert.equal((await subirDirecto(p, login, "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90")).status, 403, `subida ${login}`);
  }
  assert.deepEqual((await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica")).paginas.map((x) => x.slug), ["pcb"]);
  assert.equal((await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica&pagina=pcb")).pagina.md, "# PCB\n");
  assert.equal(p.nube.objetos.size, 0);
});

test("handlers reales: quien no es editor no importa nada: el servidor contesta 403 y la cola se detiene con «Solo los editores pueden hacer esto.»", async () => {
  const { crearImportacion } = await modulo();
  const p = await portal();
  const imp = crearImportacion({ plan: await planDe(TRES()), ...BASE, fetch: p.fetchDe("ana"), esperar: async () => {}, uuid: () => crypto.randomUUID() });
  const e = await imp.ejecutar();
  assert.deepEqual(e.detenido, { causa: "permiso", mensaje: "Solo los editores pueden hacer esto." });
  assert.deepEqual(p.estadosHttp, [403]);
  assert.deepEqual((await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica")).paginas, []);
  assert.equal(p.nube.objetos.size, 0);
});

test("handlers reales: importa páginas e imágenes; quedan al final del índice, con el md reescrito y los adjuntos servibles", async () => {
  const { crearImportacion, resumenResultado } = await modulo();
  const p = await portal();
  assert.equal((await escribir(p, EDITOR, "POST", { accion: "crear", pagina: "alfa", titulo: "Ya estaba" })).status, 201);
  const indice = (await p.get(EDITOR, "/api/hardware/?proyecto=uuv&disciplina=electronica")).paginas.map((x) => x.slug);
  const plan = await planDe(TRES(), indice);
  const imp = crearImportacion({ plan, ...BASE, fetch: p.fetchDe(EDITOR), esperar: async () => assert.fail("9 escrituras no llegan al límite"), uuid: () => crypto.randomUUID() });
  const e = await imp.ejecutar();
  assert.equal(e.detenido, null);
  assert.equal(resumenResultado(e).texto, "Se importaron 3 de 3 páginas.");
  assert.equal(resumenResultado(e).primera, "alfa-2");
  const despues = (await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica")).paginas;
  assert.deepEqual(despues, [{ slug: "alfa", titulo: "Ya estaba" }, { slug: "alfa-2", titulo: "Alfa" }, { slug: "beta", titulo: "Beta" }, { slug: "gama", titulo: "Gama" }]);
  const { archivos } = await p.get("ana", "/api/archivos/?proyecto=uuv&lista=1");
  assert.deepEqual(archivos.map((a) => a.nombre).sort(), ["dos.png", "uno.png"]);
  const id = Object.fromEntries(archivos.map((a) => [a.nombre, a.id]));
  const beta = (await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica&pagina=beta")).pagina;
  assert.equal(beta.md, `# Beta\n\n![uno](/api/archivos/?proyecto=uuv&id=${id["uno.png"]}) ![dos](/api/archivos/?proyecto=uuv&id=${id["dos.png"]})\n\nVer [alfa](/uuv/electronica/?p=alfa-2).\n`);
  assert.equal(beta.autor, EDITOR);
  const bytes = new Uint8Array(await (await p.fetchDe("ana")(`/api/archivos/?proyecto=uuv&id=${id["dos.png"]}`, { credentials: "same-origin" })).arrayBuffer());
  assert.deepEqual([...bytes], [...PNG2]);
});

test("handlers reales: con más de 10 escrituras el servidor contesta 429 con retry-after; la cola espera eso y termina sin duplicar nada", async () => {
  const { crearImportacion } = await modulo();
  const p = await portal();
  let ahora = Date.now();
  p.redis.reloj.ahora = () => ahora;
  const esperas = [];
  const esperar = async (ms) => {
    esperas.push(ms);
    ahora += ms;
  };
  const seis = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p${i}.md`, `# Página ${i}\n\ntexto ${i}\n`]));
  const imp = crearImportacion({ plan: await planDe(seis), ...BASE, fetch: p.fetchDe(EDITOR), esperar, uuid: () => crypto.randomUUID() });
  const e = await imp.ejecutar();
  assert.equal(e.detenido, null);
  assert.deepEqual(estados(e), Array(6).fill("hecha"));
  assert.equal(esperas.length, 1, "12 escrituras: una sola espera");
  assert.ok(esperas[0] >= 1000 && esperas[0] <= 60000, `espera de ${esperas[0]} ms`);
  assert.equal(p.estadosHttp.filter((s) => s === 429).length, 1);
  assert.deepEqual(p.estadosHttp.filter((s) => s !== 429), [201, 200, 201, 200, 201, 200, 201, 200, 201, 200, 201, 200]);
  const paginas = (await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica")).paginas.map((x) => x.slug);
  assert.deepEqual(paginas, ["pagina-0", "pagina-1", "pagina-2", "pagina-3", "pagina-4", "pagina-5"]);
  assert.equal((await p.get("ana", "/api/hardware/?proyecto=uuv&disciplina=electronica&pagina=pagina-5")).pagina.md, "# Página 5\n\ntexto 5\n");
});
