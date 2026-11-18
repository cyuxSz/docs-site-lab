// Carátula (lote 1): extensión mínima de GET /api/hardware/ (índice, sin ?pagina=) con `actualizado`, la última
// edición de cualquier página de la disciplina (ISO o null). `paginas` conserva su forma {slug, titulo}.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/hardware/`;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const EDITOR = "edi";
const PLANTILLAS = {
  electronica: [
    { slug: "arquitectura", titulo: "Arquitectura", md: "# Arquitectura\n" },
    { slug: "pcb", titulo: "PCB", md: "# PCB\n" },
  ],
  mecanica: [{ slug: "ensamble", titulo: "Ensamble", md: "# Ensamble\n" }],
};
const PROYECTOS = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] }, mecanica: { plantilla: "mecanica", editores: [EDITOR] } } }];

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function cookieDe(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}

async function montar() {
  const { crearHandler } = await import("../lib/hardware-core.mjs");
  const reloj = { t: T0 };
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET }, redis: fakeRedis(), proyectos: PROYECTOS, plantillas: PLANTILLAS, ahora: () => reloj.t });
  return { handler, reloj };
}

const req = (method, login, { query, body } = {}) => {
  const headers = { cookie: cookieDe(login) };
  if (method !== "GET") Object.assign(headers, { "content-type": "application/json", origin: ORIGIN });
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  return new Request(`${URL_API}${qs}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
};
const indice = (h, disciplina = "electronica") => h(req("GET", "ana", { query: { proyecto: "uuv", disciplina } }));
const post = (h, body) => h(req("POST", EDITOR, { body: { proyecto: "uuv", disciplina: "electronica", ...body } }));
const put = (h, body) => h(req("PUT", EDITOR, { body: { proyecto: "uuv", disciplina: "electronica", ...body } }));

test("GET índice sin páginas: actualizado es null", async () => {
  const { handler } = await montar();
  const res = await indice(handler);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.paginas, []);
  assert.ok(Object.hasOwn(j, "actualizado"), "el índice trae la clave actualizado");
  assert.equal(j.actualizado, null);
});

test("GET índice: actualizado es la edición más reciente entre todas las páginas", async () => {
  const { handler, reloj } = await montar();
  assert.equal((await post(handler, { accion: "inicializar" })).status, 201);
  let j = await (await indice(handler)).json();
  assert.equal(j.actualizado, new Date(T0).toISOString());
  assert.deepEqual(j.paginas, [{ slug: "arquitectura", titulo: "Arquitectura" }, { slug: "pcb", titulo: "PCB" }], "paginas no cambia de forma");

  reloj.t = T0 + 3_600_000;
  assert.equal((await put(handler, { pagina: "pcb", md: "# PCB editada", version: 1 })).status, 200);
  j = await (await indice(handler)).json();
  assert.equal(j.actualizado, new Date(T0 + 3_600_000).toISOString());
});

test("GET índice: actualizado es por disciplina (mecánica no ve las ediciones de electrónica)", async () => {
  const { handler } = await montar();
  await post(handler, { accion: "inicializar" });
  const j = await (await indice(handler, "mecanica")).json();
  assert.deepEqual(j.paginas, []);
  assert.equal(j.actualizado, null);
});

test("GET índice sin sesión sigue siendo 401 (la carátula cae a solo título)", async () => {
  const { handler } = await montar();
  const res = await handler(new Request(`${URL_API}?proyecto=uuv&disciplina=electronica`));
  assert.equal(res.status, 401);
});
