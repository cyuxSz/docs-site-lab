// Lote 1b: únicos cambios de API que necesita la interfaz. POST accion=previsualizar en lib/hardware-core.mjs (html
// saneado con el mismo renderizarMd, solo editores, sin escribir y con su propio límite de tasa para no gastar el de
// los guardados). El índice ya trae `editable` (lote 1a): la interfaz lo usa y nunca recibe la lista de editores.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeRedis } from "./fixtures/redis-memoria.mjs";

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

test("previsualizar: editor → 200 { html } saneado con renderizarMd (sin <script> ni javascript:)", async () => {
  const { handler } = await montar();
  const md = "# Hola\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![f](/api/archivos/?proyecto=uuv&id=0b7c8f2e-4d1a-4c3b-9e8f-1a2b3c4d5e6f)\n";
  const res = await post(handler, { accion: "previsualizar", md });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(typeof j.html, "string");
  assert.match(j.html, /<h1[^>]*>Hola<\/h1>/);
  assert.doesNotMatch(j.html, /<script/i);
  assert.doesNotMatch(j.html, /javascript:/i);
  assert.match(j.html, /<img[^>]*src="\/api\/archivos\/\?proyecto=uuv&(amp;)?id=/);
  const { renderizarMd } = await import("../lib/hardware-core.mjs");
  assert.equal(j.html, await renderizarMd(md), "mismo render que al guardar");
});

test("previsualizar: no escribe nada en Redis (ni páginas ni índice ni revisiones)", async () => {
  const redis = fakeRedis();
  const cmds = [];
  const espia = { exec: (c) => (cmds.push(...c), redis.exec(c)) };
  const { handler } = await montar(espia);
  const res = await post(handler, { accion: "previsualizar", md: "# x" });
  assert.equal(res.status, 200);
  const escrituras = cmds.filter(([c, k]) => /^(SET|HSET|LPUSH|DEL|HDEL)$/i.test(c) && /^hw:(pag|rev|papelera|uuv)/.test(String(k)));
  assert.deepEqual(escrituras, []);
});

test("previsualizar: lector → 403; md no string → 400; md > 200 KB → 413", async () => {
  const { handler } = await montar();
  assert.equal((await post(handler, { accion: "previsualizar", md: "# x" }, "ana")).status, 403);
  assert.equal((await post(handler, { accion: "previsualizar", md: 5 })).status, 400);
  assert.equal((await post(handler, { accion: "previsualizar", md: "a".repeat(200 * 1024 + 1) })).status, 413);
});

test("previsualizar: límite propio (10/min, 11.ª → 429) que no consume el de guardados", async () => {
  const { handler } = await montar();
  for (let i = 0; i < 10; i++) assert.equal((await post(handler, { accion: "previsualizar", md: `# ${i}` })).status, 200, `preview ${i + 1}`);
  const once = await post(handler, { accion: "previsualizar", md: "# 11" });
  assert.equal(once.status, 429);
  assert.ok(once.headers.get("retry-after"));
  // Los guardados siguen disponibles.
  assert.equal((await post(handler, { accion: "inicializar" })).status, 201);
  const put = await handler(req("PUT", { login: EDITOR, body: { ...BASE, pagina: "pcb", md: "# PCB 2", version: 1 } }));
  assert.equal(put.status, 200);
});
