// D1a: visor de PDF en las páginas de hardware. Formato del bloque (una clave por línea, "clave: valor"):
//   ```pdf
//   archivo: <uuid del PDF en /api/archivos>
//   titulo: Hoja de datos del ESC   (opcional, ≤ 120)
//   ```
// Lógica pura en src/lib/visores.ts; render, visoresDe y montarVisores en src/lib/hardware-md.ts (marked + DOMPurify, jsdom).
// El iframe NO pasa por DOMPurify: lo crea montarVisores con createElement a partir de los datos del bloque (uuid validado),
// nunca a partir del DOM ni de HTML. Cabeceras: solo los PDF se pueden enmarcar, y solo desde el mismo origen.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { JSDOM } from "jsdom";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";
import PROYECTOS_REALES from "../projects.json" with { type: "json" };

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const vis = () => import("../src/lib/visores.ts");
const md = () => import("../src/lib/hardware-md.ts");
const ventana = () => new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const bloque = (cuerpo) => "```pdf\n" + cuerpo + "\n```\n";
const src = (id, proyecto = "uuv") => `/api/archivos/?proyecto=${proyecto}&id=${id}`;

// ---------- 1. Bloque ```pdf ----------

test("parsearPdf: archivo (uuid) y título opcional; orden libre, espacios y CRLF tolerados; uuid a minúsculas", async () => {
  const { parsearPdf } = await vis();
  assert.deepEqual(parsearPdf(`archivo: ${A}\ntitulo: Hoja de datos del ESC`), { archivo: A, titulo: "Hoja de datos del ESC" });
  assert.deepEqual(parsearPdf(`archivo: ${A}`), { archivo: A, titulo: "" });
  assert.deepEqual(parsearPdf(`\r\n  titulo:  Manual  \r\n\r\narchivo:${A.toUpperCase()}\r\n`), { archivo: A, titulo: "Manual" });
});

test("parsearPdf: rechaza (null) ids no uuid, rutas, URLs, claves desconocidas o repetidas y títulos largos", async () => {
  const { parsearPdf } = await vis();
  const malos = [
    "",
    "titulo: sin archivo",
    `archivo: ../../${A}`,
    "archivo: https://evil.example/x.pdf",
    `archivo: /api/archivos/?proyecto=uuv&id=${A}`,
    `archivo: ${A}\narchivo: ${B}`,
    `archivo: ${A}\nsrc: https://evil.example/`,
    `archivo: ${A}\nonload: alert(1)`,
    `archivo: ${A}\ntitulo: ${"x".repeat(121)}`,
    `archivo: ${A}\nlinea sin dos puntos`,
  ];
  for (const m of malos) assert.equal(parsearPdf(m), null, JSON.stringify(m));
});

test("bloquePdf: fence canónico, inverso de parsearPdf; el título se limpia (sin saltos, controles ni comillas invertidas)", async () => {
  const { bloquePdf, parsearPdf } = await vis();
  assert.equal(bloquePdf({ archivo: A, titulo: "Manual" }), `\`\`\`pdf\narchivo: ${A}\ntitulo: Manual\n\`\`\`\n`);
  assert.equal(bloquePdf({ archivo: A }), `\`\`\`pdf\narchivo: ${A}\n\`\`\`\n`);
  const raro = bloquePdf({ archivo: A, titulo: "a\narchivo: x\u0007\n```" });
  const cuerpo = raro.replace(/^```pdf\n/, "").replace(/```\n$/, "");
  assert.equal(raro.match(/```/g).length, 2, raro);
  assert.equal(parsearPdf(cuerpo).archivo, A);
  assert.throws(() => bloquePdf({ archivo: "../x" }));
});

// ---------- 2. Render y montaje ----------

test("render: ```pdf de primer nivel → figure.hw-pdf con enlace 'Abrir PDF' a /api/archivos y figcaption; sin iframe/object/embed en el HTML", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const r = crearRenderizador(win, { proyecto: "uuv" });
  const html = r.html(`# Placa\n\n${bloque(`archivo: ${A}\ntitulo: Hoja <img src=x onerror=alert(1)>`)}`);
  assert.doesNotMatch(html, /<(iframe|object|embed|img)\b/i, html);
  win.document.body.innerHTML = html;
  const fig = win.document.querySelector("figure.hw-pdf");
  assert.ok(fig, html);
  const a = fig.querySelector("a");
  assert.equal(a.getAttribute("href"), src(A));
  assert.match(a.textContent, /Abrir PDF/);
  assert.equal(fig.querySelector("figcaption").textContent, "Hoja <img src=x onerror=alert(1)>");
});

test("render: ```pdf inválido, anidado (cita/lista) o sin proyecto sigue siendo código", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const casos = [
    [{ proyecto: "uuv" }, bloque("archivo: https://evil.example/x.pdf")],
    [{ proyecto: "uuv" }, "> ```pdf\n> archivo: " + A + "\n> ```\n"],
    [{ proyecto: "uuv" }, "- x\n\n  ```pdf\n  archivo: " + A + "\n  ```\n"],
    [{}, bloque(`archivo: ${A}`)],
  ];
  for (const [op, texto] of casos) {
    win.document.body.replaceChildren(crearRenderizador(win, op).fragmento(texto));
    assert.equal(win.document.querySelector("figure.hw-pdf"), null, texto);
    assert.ok(win.document.querySelector("pre code"), texto);
  }
});

test("visoresDe: lista pdf y bom de primer nivel, en el orden del documento", async () => {
  const { visoresDe } = await md();
  const texto = `${bloque(`archivo: ${A}`)}\n\`\`\`bom\nreferencia,descripcion,cantidad,costo_unitario\nR1,Resistencia,2,0.10\n\`\`\`\n\n${bloque(`archivo: ${B}\ntitulo: Dos`)}\n> ${bloque(`archivo: ${A}`)}`;
  const l = visoresDe(texto);
  assert.deepEqual(l.map((v) => v.tipo), ["pdf", "bom", "pdf"]);
  assert.deepEqual(l[2].datos, { archivo: B, titulo: "Dos" });
});

test("montarVisores: añade un iframe por PDF (src del uuid del bloque, title, loading=lazy, sin srcdoc); idempotente", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const texto = `${bloque(`archivo: ${A}\ntitulo: Manual`)}\n${bloque(`archivo: ${B}`)}`;
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  montarVisores(win.document.body, texto, { proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {} });
  montarVisores(win.document.body, texto, { proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {} });
  const marcos = [...win.document.querySelectorAll("figure.hw-pdf iframe")];
  assert.equal(marcos.length, 2);
  assert.equal(marcos[0].getAttribute("src"), src(A));
  assert.equal(marcos[1].getAttribute("src"), src(B));
  assert.equal(marcos[0].getAttribute("title"), "PDF: Manual");
  assert.equal(marcos[1].getAttribute("title"), "PDF");
  for (const f of marcos) {
    assert.equal(f.getAttribute("loading"), "lazy");
    assert.equal(f.hasAttribute("srcdoc"), false);
  }
  // El enlace de respaldo sigue (Android y iOS no muestran PDF en iframe).
  assert.equal(win.document.querySelectorAll("figure.hw-pdf a").length, 2);
});

test("montarVisores: el src sale de los datos del bloque, no del DOM (un enlace manipulado no se usa)", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const texto = bloque(`archivo: ${A}`);
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  win.document.querySelector("figure.hw-pdf a").setAttribute("href", "https://evil.example/x.pdf");
  montarVisores(win.document.body, texto, { proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {} });
  assert.equal(win.document.querySelector("figure.hw-pdf iframe").getAttribute("src"), src(A));
});

test("montarVisores: en la vista previa no se crea ningún iframe (no recarga el PDF en cada tecla)", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const texto = bloque(`archivo: ${A}`);
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  montarVisores(win.document.body, texto, { proyecto: "uuv", slug: "placa", vistaPrevia: true, descargar() {} });
  assert.equal(win.document.querySelector("iframe"), null);
  assert.ok(win.document.querySelector("figure.hw-pdf a"));
});

// ---------- 3. Cabeceras de /api/archivos ----------

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const PDF = new TextEncoder().encode("%PDF-1.4\n%prueba\n");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const realFetch = globalThis.fetch;

// Sin red: el almacén es el binding D1 (tests/fixtures/d1-sqlite.mjs); un fetch saliente es un error.
let db;
beforeEach(() => {
  db = crearD1();
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeR2() {
  const objetos = new Map();
  return {
    async put(key, value, opciones = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objetos.set(key, { bytes, httpMetadata: { ...(opciones.httpMetadata ?? {}) } });
      return { key, size: bytes.length };
    },
    async get(key) {
      const o = objetos.get(key);
      return o ? { key, size: o.bytes.length, httpMetadata: o.httpMetadata, body: new Response(o.bytes).body } : null;
    },
    async delete(key) {
      objetos.delete(key);
    },
  };
}
const env = () => ({
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  SESSION_SECRET: SECRET,
  ALLOWED_ORG: "vanttec",
  ALLOWED_USERS: "",
  DB: db,
  ASSETS: { fetch: async () => new Response("<h1>asset</h1>", { headers: { "content-type": "text/html" } }) },
  ARCHIVOS: fakeR2(),
});
function sesion(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
async function pedir(e, path, { login, method = "GET", headers = {}, body } = {}) {
  const worker = (await import("../worker/index.mjs")).crearWorker({ proyectos: PROYECTOS_REALES });
  const h = { ...headers };
  if (login) h.cookie = sesion(login);
  if (method !== "GET") h.origin = ORIGIN;
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body }), e, { waitUntil() {}, passThroughOnException() {} });
}
const qs = (o) => new URLSearchParams(o).toString();
const subir = (e, id, nombre, bytes) =>
  pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", disciplina: "electronica", id, nombre })}`, {
    login: "cyuxSz",
    method: "POST",
    headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length) },
    body: bytes,
  });

test("Worker /api/archivos: el PDF se puede enmarcar solo desde el mismo origen (frame-ancestors 'self', X-Frame-Options SAMEORIGIN), inline y sin sandbox", async () => {
  const e = env();
  assert.equal((await subir(e, A, "manual.pdf", PDF)).status, 201);
  const r = await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id: A })}`, { login: "ana" });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/pdf");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-disposition") ?? "", /^inline; filename="manual\.pdf"/);
  assert.match(r.headers.get("cache-control") ?? "", /no-store/);
  // El visor de PDF de Chrome no funciona con CSP sandbox ni con object-src 'none' en la propia respuesta del PDF.
  assert.equal(r.headers.get("content-security-policy"), "frame-ancestors 'self'");
  assert.equal(r.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), PDF);
});

test("Worker /api/archivos: el resto de tipos sigue sin poder enmarcarse (DENY, frame-ancestors 'none'); el SVG conserva su sandbox", async () => {
  const e = env();
  const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const CSV = new TextEncoder().encode("a,b\n1,2\n");
  assert.equal((await subir(e, A, "placa.png", PNG)).status, 201);
  assert.equal((await subir(e, B, "dibujo.svg", SVG)).status, 201);
  const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
  assert.equal((await subir(e, C, "bom.csv", CSV)).status, 201);
  for (const id of [A, B, C]) {
    const r = await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id })}`, { login: "ana" });
    assert.equal(r.status, 200, id);
    assert.equal(r.headers.get("x-frame-options"), "DENY", id);
    assert.match(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'|^sandbox/, id);
    assert.doesNotMatch(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/, id);
  }
  const svg = await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id: B })}`, { login: "ana" });
  assert.match(svg.headers.get("content-security-policy") ?? "", /^sandbox; default-src 'none'/);
});

test("Worker /api/archivos: el PDF exige sesión igual que antes (401 sin cookie) y las páginas siguen con frame-ancestors 'none'", async () => {
  const e = env();
  assert.equal((await subir(e, A, "manual.pdf", PDF)).status, 201);
  assert.equal((await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id: A })}`)).status, 401);
  const pagina = await pedir(e, "/uuv/electronica/", { login: "ana" });
  assert.equal(pagina.headers.get("x-frame-options"), "DENY");
  assert.match(pagina.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

// ---------- 4. CSP del <meta> ----------

test("<meta> CSP: frame-src añade solo 'self' (para el PDF de /api/archivos); object-src sigue en 'none'; nada más cambia", async () => {
  const config = (await import("../astro.config.mjs")).default;
  const d = config.security.csp.directives;
  assert.ok(d.includes("frame-src 'self' https://embed.diagrams.net"), d.join(" | "));
  assert.ok(d.includes("object-src 'none'"));
  assert.ok(!d.some((x) => /^(child-src|worker-src)\b/.test(x)));
  assert.deepEqual(config.security.csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
});
