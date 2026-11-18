// C2a: deuda de api() del editor de hardware. El servidor distingue los dos 409 (candado perdido / otro guardado en curso
// frente a versión cambiada) con `codigo`; el cliente tiene timeout con AbortController, mensaje propio para el candado y
// un cerrojo que impide dos guardados a la vez. También el borrado con más de 5 revisiones (más de un tramo de lectura).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fakeRedis } from "./fixtures/redis-memoria.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const T0 = Date.parse("2026-11-16T10:00:00Z");
const EDITOR = "edi";
const PLANTILLAS = { electronica: [{ slug: "pcb", titulo: "PCB", md: "# PCB\n" }, { slug: "potencia", titulo: "Potencia", md: "# Potencia\n" }] };
const PROYECTOS = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] } } }];
const BASE = { proyecto: "uuv", disciplina: "electronica" };
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function cookieDe(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
function req(method, { body, query = {} } = {}) {
  const headers = { cookie: cookieDe(EDITOR) };
  if (method !== "GET") Object.assign(headers, { origin: ORIGIN, "content-type": "application/json" });
  const qs = new URLSearchParams(query).toString();
  return new Request(`${ORIGIN}/api/hardware/${qs ? `?${qs}` : ""}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function montar() {
  const redis = fakeRedis();
  const { crearHandler } = await import("../lib/hardware-core.mjs");
  const h = crearHandler({ env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS, plantillas: PLANTILLAS, ahora: () => T0 });
  const tasa = () => redis.exec([["DEL", `hw:rl:${EDITOR}`]]);
  const api = {
    redis,
    h,
    get: (query) => h(req("GET", { query: { ...BASE, ...query } })),
    post: async (body) => (await tasa(), h(req("POST", { body: { ...BASE, ...body } }))),
    put: async (body) => (await tasa(), h(req("PUT", { body: { ...BASE, ...body } }))),
    del: async (body) => (await tasa(), h(req("DELETE", { body: { ...BASE, ...body } }))),
  };
  assert.equal((await api.post({ accion: "inicializar" })).status, 201);
  return api;
}
// Simula que el lease expiró y otro tomó los candados justo antes de la escritura final (EVAL de fencing).
function perderCandadoAlEscribir(redis) {
  const orig = redis.exec.bind(redis);
  redis.exec = async (cmds) => {
    if (cmds.some((c) => c[0] === "EVAL" && String(c[1]).includes("FENCED"))) {
      for (const k of [...redis.data.keys()]) if (k.includes(":lock:")) redis.data.set(k, "de-otro");
    }
    return orig(cmds);
  };
}
const sinLocks = (redis) => JSON.stringify([...redis.data].filter(([k]) => !k.includes(":lock:") && !k.includes(":rl:")).map(([k, v]) => [k, v instanceof Map ? [...v] : v]));

let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/hardware-editor.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `no se pudo importar src/lib/hardware-editor.ts: ${fallo?.message}`);
  return lib;
};

// ---------- servidor: los dos 409 se distinguen por `codigo` ----------

test("servidor: 409 por otro guardado en curso (candado ocupado) lleva codigo=candado y no trae version", async () => {
  const api = await montar();
  await api.redis.exec([["SET", "hw:lock:uuv:electronica:pcb", "otro", "NX", "EX", 10]]);
  const res = await api.put({ pagina: "pcb", md: "# x", version: 1 });
  assert.equal(res.status, 409);
  const j = await res.json();
  assert.equal(j.codigo, "candado");
  assert.equal(j.version, undefined);
  assert.equal(typeof j.error, "string");
});

test("servidor: 409 por candado perdido al escribir (fencing) lleva codigo=candado en PUT, borrar y restaurar-papelera", async () => {
  const casos = [
    ["PUT", (api) => api.put({ pagina: "pcb", md: "# tarde", version: 1 })],
    ["borrar", (api) => api.del({ pagina: "pcb", version: 1 })],
    [
      "restaurar-papelera",
      async (api) => {
        const id = (await (await api.get({ papelera: "1" })).json()).papelera?.[0]?.id ?? "potencia:1";
        return api.post({ accion: "restaurar-papelera", id });
      },
    ],
  ];
  for (const [nombre, accion] of casos) {
    const api = await montar();
    if (nombre === "restaurar-papelera") assert.equal((await api.del({ pagina: "potencia", version: 1 })).status, 200);
    const antes = sinLocks(api.redis);
    perderCandadoAlEscribir(api.redis);
    const res = await accion(api);
    assert.equal(res.status, 409, nombre);
    assert.equal((await res.json()).codigo, "candado", nombre);
    assert.equal(sinLocks(api.redis), antes, `${nombre}: no se escribió nada`);
  }
});

test("servidor: 409 por versión cambiada lleva codigo=version y la versión actual (PUT, restaurar y borrar)", async () => {
  const api = await montar();
  assert.equal((await api.put({ pagina: "pcb", md: "# v2", version: 1 })).status, 200);
  for (const [nombre, res] of [
    ["PUT", await api.put({ pagina: "pcb", md: "# viejo", version: 1 })],
    ["restaurar", await api.post({ accion: "restaurar", pagina: "pcb", revision: 0, version: 1 })],
    ["borrar", await api.del({ pagina: "pcb", version: 1 })],
  ]) {
    assert.equal(res.status, 409, nombre);
    const j = await res.json();
    assert.equal(j.codigo, "version", nombre);
    assert.equal(j.version, 2, nombre);
  }
});

test("servidor: borrar una página con 7 revisiones (más de un tramo de 5) las lleva todas a la papelera, en orden", async () => {
  const api = await montar();
  for (let v = 1; v <= 7; v++) assert.equal((await api.put({ pagina: "pcb", md: `# v${v + 1}`, version: v })).status, 200);
  const lecturas = [];
  const orig = api.redis.exec.bind(api.redis);
  api.redis.exec = async (cmds) => {
    for (const c of cmds) if (c[0] === "LRANGE" && c[1] === "hw:rev:uuv:electronica:pcb") lecturas.push([c[2], c[3]]);
    return orig(cmds);
  };
  assert.equal((await api.del({ pagina: "pcb", version: 8 })).status, 200);
  const [entrada] = [...api.redis.data.get("hw:papelera:uuv:electronica").values()].map((v) => JSON.parse(v));
  assert.equal(entrada.revisiones.length, 7);
  assert.equal(entrada.revisionesOmitidas, 0);
  assert.deepEqual(entrada.revisiones.map((r) => r.version), [7, 6, 5, 4, 3, 2, 1]);
  assert.ok(lecturas.length >= 2, `lee por tramos: ${JSON.stringify(lecturas)}`);
  assert.ok(lecturas.every(([a, b]) => Number(b) - Number(a) + 1 <= 5), "ningún tramo pasa de 5");
});

// ---------- cliente: pedirApi con timeout ----------

test("pedirApi: TIMEOUT_API_MS es 20 s; devuelve status y json, y json=null si el cuerpo no es JSON", async () => {
  const { pedirApi, TIMEOUT_API_MS } = L();
  assert.equal(TIMEOUT_API_MS, 20_000);
  let init = null;
  const ok = await pedirApi(async (_url, i) => ((init = i), new Response('{"a":1}', { status: 200 })), "/api/hardware/", { method: "GET" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { a: 1 });
  assert.equal(ok.fallo, undefined);
  assert.ok(init.signal instanceof AbortSignal, "pasa una señal de aborto a fetch");
  assert.equal(init.method, "GET", "conserva el init recibido");
  const roto = await pedirApi(async () => new Response("<html>", { status: 502 }), "/api/hardware/", {});
  assert.equal(roto.status, 502);
  assert.equal(roto.json, null);
});

test("pedirApi: sin red devuelve status 0 con fallo=red", async () => {
  const { pedirApi } = L();
  const r = await pedirApi(async () => {
    throw new TypeError("Failed to fetch");
  }, "/api/hardware/", {});
  assert.deepEqual(r, { status: 0, json: null, fallo: "red" });
});

test("pedirApi: si el servidor no responde a tiempo aborta la petición y devuelve fallo=timeout", async () => {
  const { pedirApi } = L();
  let senal = null;
  const colgado = (_url, init) =>
    new Promise((_, rechazar) => {
      senal = init.signal;
      init.signal.addEventListener("abort", () => rechazar(new DOMException("Aborted", "AbortError")));
    });
  const inicio = Date.now();
  const r = await pedirApi(colgado, "/api/hardware/", {}, { timeoutMs: 30 });
  assert.ok(Date.now() - inicio < 2000, "no espera más que el timeout");
  assert.ok(senal?.aborted, "la petición se aborta de verdad");
  assert.deepEqual(r, { status: 0, json: null, fallo: "timeout" });
});

test("pedirApi: si el cuerpo tarda en llegar también cuenta el timeout (lectura del JSON dentro del plazo)", async () => {
  const { pedirApi } = L();
  const cuerpoLento = (_url, init) =>
    Promise.resolve({
      status: 200,
      json: () =>
        new Promise((_, rechazar) => init.signal.addEventListener("abort", () => rechazar(new DOMException("Aborted", "AbortError")))),
    });
  const r = await pedirApi(cuerpoLento, "/api/hardware/", {}, { timeoutMs: 30 });
  assert.equal(r.fallo, "timeout");
  assert.equal(r.status, 0);
});

test("pedirApi: una señal externa abortada (la página se va) corta la petición sin esperar al timeout", async () => {
  const { pedirApi } = L();
  const externa = new AbortController();
  const colgado = (_url, init) =>
    new Promise((_, rechazar) => init.signal.addEventListener("abort", () => rechazar(new DOMException("Aborted", "AbortError"))));
  const p = pedirApi(colgado, "/api/hardware/", {}, { timeoutMs: 60_000, senal: externa.signal });
  externa.abort();
  const r = await p;
  assert.equal(r.status, 0);
  assert.notEqual(r.fallo, "timeout");
});

// ---------- cliente: mensajes ----------

test("mensajeError('timeout'): mensaje propio y claro, distinto del de sin red", () => {
  const { mensajeError } = L();
  const t = mensajeError("timeout");
  assert.match(t, /tard/i);
  assert.notEqual(t, mensajeError("red"));
  assert.notEqual(t, mensajeError(500));
});

test("resultadoGuardado: el 409 por candado tiene mensaje propio (reintentar), distinto del 409 por versión (recargar)", () => {
  const { resultadoGuardado, mensajeError, MENSAJE_CANDADO } = L();
  assert.equal(typeof MENSAJE_CANDADO, "string");
  const candado = resultadoGuardado(409, { json: { error: "x", codigo: "candado" } });
  const version = resultadoGuardado(409, { json: { error: "x", codigo: "version", version: 3 } });
  assert.equal(candado.mensaje, MENSAJE_CANDADO);
  assert.equal(candado.conservarTexto, true);
  assert.notEqual(candado.mensaje, version.mensaje);
  assert.match(candado.mensaje, /intent/i, "invita a reintentar");
  assert.doesNotMatch(candado.mensaje, /recarga/i, "no manda a recargar: el texto sigue valiendo");
  assert.equal(version.mensaje, mensajeError(409));
  assert.equal(resultadoGuardado(409).mensaje, mensajeError(409), "sin cuerpo se trata como conflicto de versión");
  assert.equal(resultadoGuardado(0, { fallo: "timeout" }).mensaje, mensajeError("timeout"));
  assert.equal(resultadoGuardado(0, { fallo: "red" }).mensaje, mensajeError("red"));
  assert.equal(resultadoGuardado(0).mensaje, mensajeError("red"));
  assert.deepEqual(resultadoGuardado(200), { conservarTexto: false, mensaje: "" });
});

// ---------- cliente: cerrojo de guardado ----------

test("crearCerrojoGuardado: un segundo guardado mientras hay uno en curso no se envía; al terminar (bien o mal) se libera", async () => {
  const { crearCerrojoGuardado } = L();
  const c = crearCerrojoGuardado();
  assert.equal(c.ocupado(), false);
  let llamadas = 0;
  let soltar;
  const enviar = () => (llamadas++, new Promise((r) => (soltar = r)));
  const primero = c.intentar(enviar);
  assert.ok(primero instanceof Promise);
  assert.equal(c.ocupado(), true);
  assert.equal(c.intentar(enviar), null, "Ctrl+S repetido o doble clic: no hay segundo PUT");
  assert.equal(llamadas, 1);
  soltar("ok");
  assert.equal(await primero, "ok");
  assert.equal(c.ocupado(), false);

  const conError = c.intentar(() => (llamadas++, Promise.reject(new Error("falló"))));
  await assert.rejects(conError, /falló/);
  assert.equal(c.ocupado(), false, "un error también libera el cerrojo");
  assert.ok(c.intentar(async () => (llamadas++, "otra")) instanceof Promise);
  assert.equal(llamadas, 3);
});

test("estadoGuardar: mientras se guarda, Guardar queda deshabilitado aunque no haya subidas", () => {
  const { estadoGuardar } = L();
  assert.equal(estadoGuardar(0, true).deshabilitado, true);
  assert.equal(estadoGuardar(0, false).deshabilitado, false);
});

// ---------- cliente: el script usa todo lo anterior ----------

test("hardware-editor.ts: api() pasa por pedirApi (timeout) y los guardados usan el cerrojo y el resultado con cuerpo", () => {
  const js = leer("src/scripts/hardware-editor.ts");
  assert.match(js, /pedirApi\(/, "api() usa pedirApi");
  assert.doesNotMatch(js, /fetch\(`\/api\/hardware\//, "no hay fetch directo a /api/hardware/");
  assert.match(js, /senal/, "la señal de la página corta las peticiones pendientes");
  assert.match(js, /crearCerrojoGuardado\(\)/);
  assert.match(js, /resultadoGuardado\((r|res)\.status,\s*(r|res)\)/, "el resultado del guardado mira el cuerpo (codigo) y el fallo (timeout)");
  assert.doesNotMatch(js, /resultadoGuardado\(\w+\.status\)/, "ningún guardado (página ni diagrama) ignora el cuerpo");
  assert.match(js, /Guardando…/, "anuncia el guardado en curso (aria-live)");
});
