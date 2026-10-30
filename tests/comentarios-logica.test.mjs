// Comentarios por página, lote 7b: lógica pura de la interfaz (src/lib/comentarios.ts). Hilos de 1 nivel desde la lista
// plana de GET /api/comentarios/, fecha relativa en español, etiqueta y clase por tipo, texto y contador, mensajes por
// código de error, acciones visibles según `yo` y opciones de fetch same-origin.
import { test } from "node:test";
import assert from "node:assert/strict";

// Import dinámico: si el módulo no existe, cada test falla por su cuenta con un mensaje claro.
let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/comentarios.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `falta src/lib/comentarios.ts (${fallo?.code ?? fallo?.message})`);
  return lib;
};

const c = (id, extra = {}) => ({
  id,
  padre: null,
  autor: "ana",
  tipo: "duda",
  texto: `texto ${id}`,
  creado: "2026-10-01T12:00:00.000Z",
  editado: null,
  resuelto: false,
  resueltoPor: null,
  borrado: false,
  ...extra,
});

// ---------- 1. Hilos ----------
test("armarHilos: raíces en orden de creado, cada una con sus respuestas en orden de creado", () => {
  const { armarHilos } = L();
  const lista = [
    c("r2", { creado: "2026-10-02T10:00:00.000Z" }),
    c("a2", { padre: "r1", creado: "2026-10-03T10:00:00.000Z" }),
    c("r1", { creado: "2026-10-01T10:00:00.000Z" }),
    c("a1", { padre: "r1", creado: "2026-10-02T09:00:00.000Z" }),
    c("b1", { padre: "r2", creado: "2026-10-02T11:00:00.000Z" }),
  ];
  const hilos = armarHilos(lista);
  assert.deepEqual(hilos.map((h) => h.id), ["r1", "r2"]);
  assert.deepEqual(hilos[0].respuestas.map((r) => r.id), ["a1", "a2"]);
  assert.deepEqual(hilos[1].respuestas.map((r) => r.id), ["b1"]);
  assert.equal(hilos[0].texto, "texto r1", "conserva los campos del comentario");
});

test("armarHilos: respuestas huérfanas o de segundo nivel no se muestran; no muta la entrada", () => {
  const { armarHilos } = L();
  const lista = [c("r1"), c("x", { padre: "no-existe" }), c("a1", { padre: "r1" }), c("n2", { padre: "a1" })];
  const copia = structuredClone(lista);
  const hilos = armarHilos(lista);
  assert.deepEqual(hilos.map((h) => h.id), ["r1"]);
  assert.deepEqual(hilos[0].respuestas.map((r) => r.id), ["a1"]);
  assert.deepEqual(lista, copia);
});

test("armarHilos: raíz borrada con respuestas queda como placeholder; sin respuestas desaparece", () => {
  const { armarHilos } = L();
  const lista = [
    c("r1", { borrado: true, autor: null, texto: "" }),
    c("a1", { padre: "r1" }),
    c("r2", { borrado: true, autor: null, texto: "" }),
  ];
  const hilos = armarHilos(lista);
  assert.deepEqual(hilos.map((h) => h.id), ["r1"]);
  assert.equal(hilos[0].borrado, true);
  assert.equal(hilos[0].respuestas.length, 1);
});

test("armarHilos: entrada vacía o no lista da []", () => {
  const { armarHilos } = L();
  assert.deepEqual(armarHilos([]), []);
  assert.deepEqual(armarHilos(null), []);
  assert.deepEqual(armarHilos(undefined), []);
});

// ---------- 2. Fecha relativa ----------
test("fechaRelativa: segundos, minutos, horas, ayer y días en español", () => {
  const { fechaRelativa } = L();
  const ahora = Date.parse("2026-10-30T12:00:00.000Z");
  const antes = (ms) => new Date(ahora - ms).toISOString();
  assert.equal(fechaRelativa(antes(10_000), ahora), "hace un momento");
  assert.equal(fechaRelativa(antes(60_000), ahora), "hace 1 minuto");
  assert.equal(fechaRelativa(antes(5 * 60_000), ahora), "hace 5 minutos");
  assert.equal(fechaRelativa(antes(3_600_000), ahora), "hace 1 hora");
  assert.equal(fechaRelativa(antes(3 * 3_600_000), ahora), "hace 3 horas");
  assert.equal(fechaRelativa(antes(30 * 3_600_000), ahora), "ayer");
  assert.equal(fechaRelativa(antes(4 * 864e5), ahora), "hace 4 días");
});

test("fechaRelativa: 30 días o más da fecha absoluta en español; futura cuenta como 'hace un momento'; inválida da ''", () => {
  const { fechaRelativa } = L();
  const ahora = Date.parse("2026-10-30T12:00:00.000Z");
  assert.equal(fechaRelativa("2026-03-12T12:00:00.000Z", ahora), "12 de marzo de 2026");
  assert.equal(fechaRelativa("2026-10-30T12:05:00.000Z", ahora), "hace un momento");
  assert.equal(fechaRelativa("no es fecha", ahora), "");
  assert.equal(fechaRelativa(null, ahora), "");
  assert.equal(fechaRelativa(undefined, ahora), "");
});

// ---------- 3. Tipos y texto ----------
test("tipos: las cuatro opciones en orden con etiqueta en español y clase de chip", () => {
  const { TIPOS_COMENTARIO, tipoInfo } = L();
  assert.deepEqual(
    TIPOS_COMENTARIO.map((t) => [t.id, t.etiqueta]),
    [
      ["duda", "Duda"],
      ["aclaracion", "Aclaración"],
      ["sugerencia", "Sugerencia"],
      ["bug", "Bug"],
    ],
  );
  assert.deepEqual(tipoInfo("bug"), { etiqueta: "Bug", clase: "chip-bug" });
  assert.deepEqual(tipoInfo("aclaracion"), { etiqueta: "Aclaración", clase: "chip-aclaracion" });
});

test("tipoInfo: un tipo desconocido no inyecta clases ni texto del servidor", () => {
  const { tipoInfo } = L();
  for (const t of ["x\" onclick=\"a", "constructor", "__proto__", "", null, undefined, 3]) {
    assert.deepEqual(tipoInfo(t), { etiqueta: "Comentario", clase: "chip-otro" }, String(t));
  }
});

test("texto: MAX_TEXTO 2000, textoValido tras trim y contador 'N/2000'", () => {
  const { MAX_TEXTO, textoValido, contador } = L();
  assert.equal(MAX_TEXTO, 2000);
  assert.equal(textoValido(""), false);
  assert.equal(textoValido("   \n "), false);
  assert.equal(textoValido(" hola "), true);
  assert.equal(textoValido("a".repeat(2000)), true);
  assert.equal(textoValido("a".repeat(2001)), false);
  assert.equal(contador(""), "0/2000");
  assert.equal(contador("hola"), "4/2000");
});

// ---------- 4. Mensajes de error ----------
test("mensajeError: textos fijos por código", () => {
  const { mensajeError } = L();
  assert.equal(mensajeError(503), "Comentarios no configurados");
  assert.equal(mensajeError("red"), "Comentarios no disponibles en local");
  assert.match(mensajeError(401), /inicia sesión/i);
  assert.match(mensajeError(403), /permiso/i);
  assert.match(mensajeError(404), /ya no existe/i);
  assert.match(mensajeError(413), /demasiado largo/i);
  assert.match(mensajeError(415), /no se pudo enviar/i);
});

test("mensajeError: 429 dice cuánto esperar (Retry-After en segundos), con valor por defecto", () => {
  const { mensajeError } = L();
  assert.match(mensajeError(429, { retryAfter: "42" }), /espera 42 s/i);
  assert.match(mensajeError(429, { retryAfter: 7 }), /espera 7 s/i);
  assert.match(mensajeError(429, { retryAfter: "basura" }), /espera 60 s/i);
  assert.match(mensajeError(429), /espera 60 s/i);
});

test("mensajeError: 400 usa el mensaje del servidor si es texto corto; otros dan genérico", () => {
  const { mensajeError } = L();
  assert.equal(mensajeError(400, { servidor: "Tipo no válido" }), "Tipo no válido");
  assert.match(mensajeError(400), /no se pudo guardar/i);
  assert.match(mensajeError(400, { servidor: "x".repeat(500) }), /no se pudo guardar/i);
  assert.match(mensajeError(500), /intenta de nuevo/i);
  assert.match(mensajeError(418), /intenta de nuevo/i);
});

// ---------- 5. Acciones y peticiones ----------
test("acciones: el autor (sin distinguir mayúsculas) edita y borra; otro no", () => {
  const { acciones } = L();
  const mio = acciones(c("r1", { autor: "Ana" }), "ana");
  assert.equal(mio.editar, true);
  assert.equal(mio.borrar, true);
  const ajeno = acciones(c("r1", { autor: "bob" }), "ana");
  assert.equal(ajeno.editar, false);
  assert.equal(ajeno.borrar, false);
  const sinYo = acciones(c("r1", { autor: "ana" }), null);
  assert.equal(sinYo.editar, false);
  assert.equal(sinYo.borrar, false);
});

test("acciones: responder y resolver solo en raíces; etiqueta según estado", () => {
  const { acciones } = L();
  const raiz = acciones(c("r1", { autor: "bob" }), "ana");
  assert.equal(raiz.responder, true);
  assert.equal(raiz.resolver, "Marcar resuelto");
  assert.equal(acciones(c("r1", { resuelto: true }), "ana").resolver, "Reabrir");
  const resp = acciones(c("a1", { padre: "r1", autor: "ana" }), "ana");
  assert.equal(resp.responder, false);
  assert.equal(resp.resolver, null);
  assert.equal(resp.editar, true);
});

test("acciones: un placeholder borrado no tiene ninguna acción", () => {
  const { acciones } = L();
  assert.deepEqual(acciones(c("r1", { borrado: true, autor: null, texto: "" }), "ana"), {
    responder: false,
    editar: false,
    borrar: false,
    resolver: null,
  });
});

test("urlComentarios: ruta con barra final y página codificada", () => {
  const { urlComentarios } = L();
  assert.equal(urlComentarios("/uuv/quickstart/"), "/api/comentarios/?pagina=%2Fuuv%2Fquickstart%2F");
  assert.equal(urlComentarios(), "/api/comentarios/");
});

test("opcionesEscritura: JSON same-origin con el método y el cuerpo serializado", () => {
  const { opcionesEscritura } = L();
  const o = opcionesEscritura("POST", { pagina: "/uuv/x/", tipo: "duda", texto: "hola" });
  assert.equal(o.method, "POST");
  assert.equal(o.credentials, "same-origin");
  assert.equal(o.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(o.body), { pagina: "/uuv/x/", tipo: "duda", texto: "hola" });
  for (const m of ["PATCH", "DELETE"]) assert.equal(opcionesEscritura(m, { id: "1" }).method, m);
});
