// Lote 1b: cambios de API que necesita la interfaz. El índice trae `editable` (lote 1a): la interfaz lo usa y nunca
// recibe la lista de editores. M2b: accion=previsualizar desaparece (la vista previa se renderiza en el navegador con
// src/lib/hardware-md.ts); el servidor la rechaza como cualquier acción desconocida.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/hardware/`;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const EDITOR = "edi";
const PLANTILLAS = { electronica: [{ slug: "pcb", titulo: "PCB", md: "# PCB\n\n## Capas\n" }], mecanica: [] };
const PROYECTOS = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR] } } }];
const BASE = { proyecto: "uuv", disciplina: "electronica" };

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function cookieDe(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
async function montar(redis = fakeRedis()) {
  const { crearHandler } = await import("../lib/hardware-core.mjs");
  return { handler: crearHandler({ env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS, plantillas: PLANTILLAS, ahora: () => T0 }), redis };
}
function req(method, { login, body, query = {} } = {}) {
  const headers = {};
  if (login) headers.cookie = cookieDe(login);
  if (method !== "GET") {
    headers["content-type"] = "application/json";
    headers.origin = ORIGIN;
  }
  const qs = new URLSearchParams(query).toString();
  return new Request(qs ? `${URL_API}?${qs}` : URL_API, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const post = (h, body, login = EDITOR) => h(req("POST", { login, body: { ...BASE, ...body } }));

test("índice: trae editable (boolean) y nunca la lista de editores", async () => {
  const { handler } = await montar();
  for (const [login, esperado] of [[EDITOR, true], ["ana", false]]) {
    const res = await handler(req("GET", { login, query: BASE }));
    assert.equal(res.status, 200);
    const texto = await res.text();
    const j = JSON.parse(texto);
    assert.equal(j.editable, esperado);
    assert.doesNotMatch(texto, /editores/);
  }
});

test("previsualizar (M2b): ya no existe; editor → 400 'Acción inválida' sin escribir; lector → 403", async () => {
  const redis = fakeRedis();
  const cmds = [];
  const espia = { exec: (c) => (cmds.push(...c), redis.exec(c)) };
  const { handler } = await montar(espia);
  const res = await post(handler, { accion: "previsualizar", md: "# x" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Acción inválida" });
  assert.deepEqual(cmds.filter(([c]) => /^(SET|HSET|LPUSH|DEL|HDEL|INCR|EVAL)$/i.test(c)), [], "ni escrituras ni cubo de tasa");
  assert.equal((await post(handler, { accion: "previsualizar", md: "# x" }, "ana")).status, 403);
});
