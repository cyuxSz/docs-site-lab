// C2a: papelera del editor de hardware. GET ?papelera=1 lista las páginas borradas de la disciplina (solo editores, sin md
// ni revisiones) y POST { accion: "restaurar-papelera", id } devuelve una a la disciplina con su historial. Se prueba
// contra el Redis en memoria y contra D1 (clienteD1 sobre node:sqlite), como tests/almacen-d1-apis.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeRedis } from "./fixtures/redis-memoria.mjs";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const T0 = Date.parse("2026-11-16T10:00:00Z");
const EDITOR = "edi";
const PLANTILLAS = {
  electronica: [
    { slug: "arquitectura", titulo: "Arquitectura", md: "# Arquitectura\n" },
    { slug: "potencia", titulo: "Potencia", md: "# Potencia\n" },
    { slug: "pcb", titulo: "PCB", md: "# PCB\n" },
  ],
};
const PROYECTOS = [
  {
    id: "uuv",
    disciplinas: {
      electronica: { plantilla: "electronica", editores: [EDITOR] },
      mecanica: { plantilla: "electronica", editores: [EDITOR] },
    },
  },
];
const BASE = { proyecto: "uuv", disciplina: "electronica" };
const ID = /^[a-z0-9-]{1,60}:\d{1,16}$/;

const BACKENDS = {
  "redis-memoria": async () => {
    let t = T0;
    const almacen = fakeRedis();
    almacen.reloj.ahora = () => t;
    return { almacen, ahora: () => t, avanzar: (ms) => (t += ms) };
  },
  d1: async () => {
    const { clienteD1 } = await import("../lib/almacen-d1.mjs");
    let t = T0;
    const db = crearD1();
    return { almacen: clienteD1(db, { ahora: () => t }), ahora: () => t, avanzar: (ms) => (t += ms) };
  },
};

function cookieDe(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
function req(method, { login, body, query = {} } = {}) {
  const headers = {};
  if (login) headers.cookie = cookieDe(login);
  if (method !== "GET") {
    headers.origin = ORIGIN;
    headers["content-type"] = "application/json";
  }
  const qs = new URLSearchParams(query).toString();
  return new Request(`${ORIGIN}/api/hardware/${qs ? `?${qs}` : ""}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function montar(crear) {
  const b = await crear();
  const { crearHandler } = await import("../lib/hardware-core.mjs");
  const h = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: b.almacen, proyectos: PROYECTOS, plantillas: PLANTILLAS, ahora: b.ahora });
  // Las pruebas hacen muchas escrituras seguidas: se vacía el cubo de tasa antes de cada una.
  const tasa = () => b.almacen.exec([["DEL", `hw:rl:${EDITOR}`]]);
  const api = {
    b,
    h,
    get: (query, login = EDITOR) => h(req("GET", { login, query: { ...BASE, ...query } })),
    post: async (body, login = EDITOR) => (await tasa(), h(req("POST", { login, body: { ...BASE, ...body } }))),
    put: async (body, login = EDITOR) => (await tasa(), h(req("PUT", { login, body: { ...BASE, ...body } }))),
    del: async (body, login = EDITOR) => (await tasa(), h(req("DELETE", { login, body: { ...BASE, ...body } }))),
  };
  api.papelera = async (login = EDITOR, extra = {}) => api.get({ papelera: "1", ...extra }, login);
  assert.equal((await api.post({ accion: "inicializar" })).status, 201, "inicializar");
  return api;
}

const json = async (res) => res.json();

for (const [nombre, crear] of Object.entries(BACKENDS)) {
  test(`[${nombre}] GET ?papelera=1: el editor ve las páginas borradas de la disciplina, la más reciente primero y sin contenido`, async () => {
    const api = await montar(crear);
    const vacia = await api.papelera();
    assert.equal(vacia.status, 200);
    assert.match(vacia.headers.get("cache-control") ?? "", /no-store/);
    assert.deepEqual(await json(vacia), { papelera: [] });

    assert.equal((await api.put({ pagina: "pcb", md: "# PCB v2", version: 1 })).status, 200);
    api.b.avanzar(1000);
    assert.equal((await api.del({ pagina: "pcb", version: 2 })).status, 200);
    api.b.avanzar(1000);
    assert.equal((await api.del({ pagina: "potencia", version: 1 })).status, 200);

    const res = await api.papelera();
    assert.equal(res.status, 200);
    const { papelera } = await json(res);
    assert.ok(Array.isArray(papelera), "papelera es una lista");
    assert.deepEqual(papelera.map((e) => e.slug), ["potencia", "pcb"], "la borrada más recientemente va primero");
    for (const e of papelera) {
      assert.deepEqual(Object.keys(e).sort(), ["borradoPor", "borrado", "id", "revisiones", "slug", "titulo", "version"], `campos de ${e.slug}`);
      assert.match(e.id, ID, "id <slug>:<marca de tiempo>");
      assert.ok(e.id.startsWith(`${e.slug}:`));
      assert.equal(e.borradoPor, EDITOR);
      assert.ok(!Number.isNaN(Date.parse(e.borrado)), "borrado es una fecha ISO");
      assert.equal(typeof e.revisiones, "number", "solo el número de revisiones, no su contenido");
    }
    const pcb = papelera.find((e) => e.slug === "pcb");
    assert.equal(pcb.titulo, "PCB");
    assert.equal(pcb.version, 2);
    assert.equal(pcb.revisiones, 1);
    assert.equal(papelera.find((e) => e.slug === "potencia").revisiones, 0);
    assert.doesNotMatch(JSON.stringify(papelera), /# PCB v2/, "el Markdown no viaja en el listado");

    const otra = await api.get({ disciplina: "mecanica", papelera: "1" });
    assert.equal(otra.status, 200);
    assert.deepEqual(await json(otra), { papelera: [] }, "cada disciplina tiene su propia papelera");
  });

  test(`[${nombre}] GET ?papelera=1: sin sesión 401 y quien no es editor 403 (no ve qué se borró)`, async () => {
    const api = await montar(crear);
    assert.equal((await api.del({ pagina: "pcb", version: 1 })).status, 200);
    assert.equal((await api.h(req("GET", { query: { ...BASE, papelera: "1" } }))).status, 401);
    const lector = await api.papelera("ana");
    assert.equal(lector.status, 403);
    assert.doesNotMatch(JSON.stringify(await json(lector)), /pcb/i, "el 403 no revela entradas");
  });

  test(`[${nombre}] restaurar-papelera: la página vuelve al final del índice con su contenido, versión nueva y sale de la papelera`, async () => {
    const api = await montar(crear);
    assert.equal((await api.put({ pagina: "pcb", md: "# PCB restaurable", version: 1 })).status, 200);
    api.b.avanzar(1000);
    assert.equal((await api.del({ pagina: "pcb", version: 2 })).status, 200);
    const [entrada] = (await json(await api.papelera())).papelera;

    api.b.avanzar(1000);
    const res = await api.post({ accion: "restaurar-papelera", id: entrada.id });
    assert.equal(res.status, 200);
    const { pagina } = await json(res);
    assert.equal(pagina.slug, "pcb");
    assert.equal(pagina.titulo, "PCB");
    assert.equal(pagina.md, "# PCB restaurable");
    assert.equal(pagina.autor, EDITOR);
    assert.equal(pagina.version, 3, "nunca reutiliza una versión ya vista (suelo + 1)");
    assert.equal(pagina.actualizado, new Date(api.b.ahora()).toISOString());

    const indice = await json(await api.get({}));
    assert.deepEqual(indice.paginas.map((p) => p.slug), ["arquitectura", "potencia", "pcb"], "vuelve al final del índice");
    const leida = await json(await api.get({ pagina: "pcb" }));
    assert.equal(leida.pagina.md, "# PCB restaurable");
    assert.equal(leida.pagina.version, 3);
    const { revisiones } = await json(await api.get({ pagina: "pcb", revisiones: "1" }));
    assert.deepEqual(revisiones.map((r) => r.version), [1], "recupera su historial");
    assert.deepEqual(await json(await api.papelera()), { papelera: [] }, "la entrada sale de la papelera");

    // La página restaurada se puede editar y volver a borrar con normalidad.
    assert.equal((await api.put({ pagina: "pcb", md: "# otra vez", version: 3 })).status, 200);
    assert.equal((await api.del({ pagina: "pcb", version: 4 })).status, 200);
    assert.equal((await json(await api.papelera())).papelera.length, 1);
  });

  test(`[${nombre}] restaurar-papelera con más de 5 revisiones (más de un tramo): vuelven todas y en orden`, async () => {
    const api = await montar(crear);
    for (let v = 1; v <= 7; v++) assert.equal((await api.put({ pagina: "pcb", md: `# v${v + 1}`, version: v })).status, 200, `PUT ${v}`);
    assert.equal((await api.del({ pagina: "pcb", version: 8 })).status, 200);
    const [entrada] = (await json(await api.papelera())).papelera;
    assert.equal(entrada.revisiones, 7);
    const res = await api.post({ accion: "restaurar-papelera", id: entrada.id });
    assert.equal(res.status, 200);
    assert.equal((await json(res)).pagina.version, 9);
    const { revisiones } = await json(await api.get({ pagina: "pcb", revisiones: "1" }));
    assert.deepEqual(revisiones.map((r) => r.version), [7, 6, 5, 4, 3, 2, 1], "más reciente primero, como antes de borrar");
    assert.deepEqual(revisiones.map((r) => r.n), [0, 1, 2, 3, 4, 5, 6]);
    // Restaurar la revisión más antigua sigue funcionando tras volver de la papelera.
    const vieja = await api.post({ accion: "restaurar", pagina: "pcb", revision: 6, version: 9 });
    assert.equal(vieja.status, 200);
    assert.equal((await json(vieja)).pagina.md, "# PCB\n");
  });

  test(`[${nombre}] restaurar-papelera: id inválido 400, inexistente 404, lector 403 y slug ocupado 409 (codigo existe) sin escribir`, async () => {
    const api = await montar(crear);
    assert.equal((await api.del({ pagina: "pcb", version: 1 })).status, 200);
    const [entrada] = (await json(await api.papelera())).papelera;

    for (const id of [undefined, "", "pcb", "PCB:1", "pcb:abc", "pcb:1:2", 5, null, `${"a".repeat(61)}:1`]) {
      assert.equal((await api.post({ accion: "restaurar-papelera", id })).status, 400, `id ${JSON.stringify(id)}`);
    }
    assert.equal((await api.post({ accion: "restaurar-papelera", id: "pcb:1" })).status, 404);
    assert.equal((await api.post({ accion: "restaurar-papelera", id: entrada.id }, "ana")).status, 403);

    // Alguien creó otra página con el mismo slug: no se pisa.
    assert.equal((await api.post({ accion: "crear", pagina: "pcb", titulo: "PCB nueva" })).status, 201);
    const choque = await api.post({ accion: "restaurar-papelera", id: entrada.id });
    assert.equal(choque.status, 409);
    const cuerpo = await json(choque);
    assert.equal(cuerpo.codigo, "existe");
    assert.equal(typeof cuerpo.error, "string");
    assert.equal((await json(await api.get({ pagina: "pcb" }))).pagina.titulo, "PCB nueva", "la página nueva queda intacta");
    assert.equal((await json(await api.papelera())).papelera.length, 1, "la entrada sigue en la papelera");
  });
}
