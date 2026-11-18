// D1b: esquemáticos y PCB de KiCad (.kicad_sch, .kicad_pcb) en las páginas de hardware con KiCanvas vendorizado.
// Formato del bloque (una clave por línea, "clave: valor"):
//   ```kicad
//   archivo: <uuid del .kicad_sch o .kicad_pcb en /api/archivos>
//   respaldo: <uuid de un PDF o SVG exportado>   (opcional, distinto de archivo)
//   titulo: Placa de potencia                    (opcional, ≤ 120)
//   ```
// El HTML saneado solo lleva enlaces (descargar el archivo y abrir el respaldo). El visor <kicanvas-embed> lo crea
// montarVisores con createElement, a partir de los datos del bloque, con el texto descargado por el portal en un
// <kicanvas-source> (KiCanvas no hace peticiones propias). kicanvas.js se pide solo si hay un bloque ```kicad.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";
import PROYECTOS_REALES from "../projects.json" with { type: "json" };

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const vis = () => import("../src/lib/visores.ts");
const md = () => import("../src/lib/hardware-md.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const ventana = () => new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const bloque = (cuerpo) => "```kicad\n" + cuerpo + "\n```\n";
const src = (id, proyecto = "uuv") => `/api/archivos/?proyecto=${proyecto}&id=${id}`;
const SCH = "(kicad_sch\n  (version 20251024)\n  (generator \"eeschema\")\n)\n";
const PCB = "(kicad_pcb (version 20251024) (generator \"pcbnew\"))\n";
const VENDOR = "public/vendor/kicanvas/kicanvas.js";
const SCRIPT_KICANVAS = "/vendor/kicanvas/kicanvas.js";
// sha256 del kicanvas.js oficial (kicanvas.org, 2026-04-28, ca910f25…) tras quitar SOLO la sentencia
// document.body.appendChild(f`<link rel="stylesheet" href="https://fonts.googleapis.com/…" />`); (fin de línea LF).
const SHA_PARCHEADO = "4b618fdd7beb0516bb3702b5af9dde370b2046e0171fa4e9ec73caa9bc216776";

// Inyección para montarVisores: nada de red ni de <script> real en los tests.
function falsoKicad(texto = SCH) {
  const llamadas = { script: 0, urls: [] };
  return {
    llamadas,
    kicad: {
      cargarScript: async () => {
        llamadas.script++;
      },
      leer: async (url) => {
        llamadas.urls.push(url);
        if (texto instanceof Error) throw texto;
        return texto;
      },
      webgl2: () => true, // C21: sin WebGL2 no se monta el visor
    },
  };
}
const opciones = (extra = {}) => ({ proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {}, ...extra });

// ---------- 1. Bloque ```kicad (lógica pura, visores.ts) ----------

test("parsearKicad: archivo (uuid), respaldo y título opcionales; orden libre, CRLF tolerado; uuids a minúsculas", async () => {
  const { parsearKicad } = await vis();
  assert.deepEqual(parsearKicad(`archivo: ${A}\nrespaldo: ${B}\ntitulo: Placa de potencia`), { archivo: A, respaldo: B, titulo: "Placa de potencia" });
  assert.deepEqual(parsearKicad(`archivo: ${A}`), { archivo: A, respaldo: "", titulo: "" });
  assert.deepEqual(parsearKicad(`\r\n titulo:  Placa \r\n\r\nrespaldo:${B.toUpperCase()}\r\narchivo:${A.toUpperCase()}\r\n`), { archivo: A, respaldo: B, titulo: "Placa" });
});

test("parsearKicad: rechaza (null) ids no uuid, rutas, URLs, respaldo igual al archivo, claves desconocidas o repetidas y títulos largos", async () => {
  const { parsearKicad } = await vis();
  const malos = [
    "",
    `respaldo: ${B}`,
    "archivo: https://evil.example/placa.kicad_sch",
    `archivo: ../../${A}`,
    `archivo: ${A}\nrespaldo: https://evil.example/x.pdf`,
    `archivo: ${A}\nrespaldo: ${A}`,
    `archivo: ${A}\narchivo: ${B}`,
    `archivo: ${A}\nrespaldo: ${B}\nrespaldo: ${C}`,
    `archivo: ${A}\nsrc: https://evil.example/`,
    `archivo: ${A}\ncontrols: full`,
    `archivo: ${A}\ntitulo: ${"x".repeat(121)}`,
    `archivo: ${A}\nlinea sin dos puntos`,
  ];
  for (const m of malos) assert.equal(parsearKicad(m), null, JSON.stringify(m));
});

test("bloqueKicad: fence canónico (archivo, respaldo, titulo), inverso de parsearKicad; limpia el título y lanza con ids no uuid", async () => {
  const { bloqueKicad, parsearKicad } = await vis();
  assert.equal(bloqueKicad({ archivo: A, respaldo: B, titulo: "Placa" }), `\`\`\`kicad\narchivo: ${A}\nrespaldo: ${B}\ntitulo: Placa\n\`\`\`\n`);
  assert.equal(bloqueKicad({ archivo: A }), `\`\`\`kicad\narchivo: ${A}\n\`\`\`\n`);
  const raro = bloqueKicad({ archivo: A, titulo: "a\nrespaldo: x\u0007\n```" });
  assert.equal(raro.match(/```/g).length, 2, raro);
  assert.equal(parsearKicad(raro.replace(/^```kicad\n/, "").replace(/```\n$/, "")).archivo, A);
  assert.throws(() => bloqueKicad({ archivo: "../x" }));
  assert.throws(() => bloqueKicad({ archivo: A, respaldo: "https://evil.example/x.pdf" }));
});

test("tipoKicad: detecta esquemático o PCB por el prefijo S-expression (tras espacios iniciales); MAX_KICAD_VISOR = 20 MB", async () => {
  const { tipoKicad, MAX_KICAD_VISOR } = await vis();
  assert.equal(tipoKicad(SCH), "esquematico");
  assert.equal(tipoKicad("\n\t  " + PCB), "pcb");
  assert.equal(tipoKicad("﻿" + SCH), "esquematico");
  for (const malo of ["", "(kicad_wks (version 1))", "{\"board\":{}}", "<html>", "%PDF-1.4", "(kicad_symbol_lib)"]) assert.equal(tipoKicad(malo), null, malo);
  assert.equal(MAX_KICAD_VISOR, 20 * 1024 * 1024);
});

test("archivosKicad: exactamente un .kicad_sch/.kicad_pcb y como mucho un respaldo .pdf/.svg; nada más", async () => {
  const { archivosKicad } = await vis();
  const sch = { name: "Potencia.kicad_sch", size: 100 };
  const pdf = { name: "potencia.PDF", size: 100 };
  const ok1 = archivosKicad([sch]);
  assert.equal(ok1.ok, true, ok1.error);
  assert.equal(ok1.kicad, sch);
  assert.equal(ok1.respaldo, undefined);
  const ok2 = archivosKicad([pdf, { name: "placa.kicad_pcb", size: 10 }]);
  assert.equal(ok2.ok, true, ok2.error);
  assert.equal(ok2.kicad.name, "placa.kicad_pcb");
  assert.equal(ok2.respaldo, pdf);
  assert.equal(archivosKicad([sch, { name: "placa.svg", size: 5 }]).ok, true);
  const malos = [
    [],
    [pdf],
    [sch, { name: "otra.kicad_pcb", size: 1 }],
    [sch, pdf, { name: "b.pdf", size: 1 }],
    [sch, { name: "placa.png", size: 1 }],
    [{ name: "placa.kicad_pro", size: 1 }],
  ];
  for (const m of malos) {
    const r = archivosKicad(m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.equal(typeof r.error, "string");
    assert.ok(r.error.length > 0);
  }
});

// ---------- 2. Render (hardware-md.ts) ----------

test("render: ```kicad → figure.hw-kicad con enlace de descarga del archivo, enlace al respaldo y figcaption; sin kicanvas/script/iframe en el HTML", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const html = crearRenderizador(win, { proyecto: "uuv" }).html(`# Placa\n\n${bloque(`archivo: ${A}\nrespaldo: ${B}\ntitulo: Potencia <img src=x onerror=alert(1)>`)}`);
  assert.doesNotMatch(html, /<(kicanvas-embed|kicanvas-source|script|iframe|object|embed|img)\b/i, html);
  win.document.body.innerHTML = html;
  const fig = win.document.querySelector("figure.hw-kicad");
  assert.ok(fig, html);
  const enlaces = [...fig.querySelectorAll("a")];
  const descarga = enlaces.find((a) => a.getAttribute("href") === src(A));
  assert.ok(descarga, "enlace al archivo de KiCad");
  assert.match(descarga.textContent, /Descargar/i);
  const respaldo = enlaces.find((a) => a.getAttribute("href") === src(B));
  assert.ok(respaldo, "enlace al respaldo");
  assert.match(respaldo.textContent, /respaldo/i);
  assert.equal(fig.querySelector("figcaption").textContent, "Potencia <img src=x onerror=alert(1)>");
});

test("render: sin respaldo solo queda el enlace de descarga; inválido, anidado o sin proyecto sigue siendo código", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(bloque(`archivo: ${A}`)));
  assert.deepEqual([...win.document.querySelectorAll("figure.hw-kicad a")].map((a) => a.getAttribute("href")), [src(A)]);
  const casos = [
    [{ proyecto: "uuv" }, bloque("archivo: https://evil.example/x.kicad_sch")],
    [{ proyecto: "uuv" }, "> ```kicad\n> archivo: " + A + "\n> ```\n"],
    [{ proyecto: "uuv" }, "- x\n\n  ```kicad\n  archivo: " + A + "\n  ```\n"],
    [{}, bloque(`archivo: ${A}`)],
  ];
  for (const [op, texto] of casos) {
    win.document.body.replaceChildren(crearRenderizador(win, op).fragmento(texto));
    assert.equal(win.document.querySelector("figure.hw-kicad"), null, texto);
    assert.ok(win.document.querySelector("pre code"), texto);
  }
});

test("visoresDe: incluye los ```kicad de primer nivel junto a pdf y bom, en orden", async () => {
  const { visoresDe } = await md();
  const texto = `\`\`\`pdf\narchivo: ${B}\n\`\`\`\n\n${bloque(`archivo: ${A}\nrespaldo: ${B}`)}\n> ${bloque(`archivo: ${C}`)}`;
  const l = visoresDe(texto);
  assert.deepEqual(l.map((v) => v.tipo), ["pdf", "kicad"]);
  assert.deepEqual(l[1].datos, { archivo: A, respaldo: B, titulo: "" });
});

// ---------- 3. Montaje del visor (montarVisores) ----------

test("montarVisores: crea región con nombre accesible y <kicanvas-embed> con <kicanvas-source> (texto descargado del uuid del bloque); idempotente", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const texto = `${bloque(`archivo: ${A}\nrespaldo: ${B}\ntitulo: Potencia`)}\n${bloque(`archivo: ${C}`)}`;
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  // Un enlace manipulado en el DOM no se usa: la URL sale del bloque.
  win.document.querySelector("figure.hw-kicad a").setAttribute("href", "https://evil.example/x.kicad_sch");
  const f = falsoKicad();
  await montarVisores(win.document.body, texto, opciones({ kicad: f.kicad }));
  await montarVisores(win.document.body, texto, opciones({ kicad: f.kicad }));
  const embeds = [...win.document.querySelectorAll("figure.hw-kicad kicanvas-embed")];
  assert.equal(embeds.length, 2);
  assert.deepEqual(f.llamadas.urls.slice(0, 2), [src(A), src(C)]);
  for (const e of embeds) {
    assert.equal(e.getAttribute("controls"), "basic");
    assert.match(e.getAttribute("controlslist") ?? "", /nodownload/);
    assert.equal(e.hasAttribute("src"), false, "KiCanvas no pide nada: el texto va en línea");
    const fuente = e.querySelector("kicanvas-source");
    assert.ok(fuente);
    assert.equal(fuente.hasAttribute("src"), false);
    assert.equal(fuente.textContent, SCH);
    assert.equal(fuente.children.length, 0, "solo texto, nunca HTML");
  }
  const regiones = [...win.document.querySelectorAll("figure.hw-kicad [role=region]")];
  assert.equal(regiones.length, 2);
  assert.match(regiones[0].getAttribute("aria-label"), /KiCad.*Potencia/);
  assert.match(regiones[1].getAttribute("aria-label"), /KiCad/);
  // Los enlaces (descarga y respaldo) siguen como alternativa.
  assert.equal(win.document.querySelectorAll("figure.hw-kicad a").length, 3);
});

test("montarVisores: en la vista previa no descarga nada, no carga KiCanvas ni crea el visor", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const texto = bloque(`archivo: ${A}`);
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  const f = falsoKicad();
  await montarVisores(win.document.body, texto, opciones({ vistaPrevia: true, kicad: f.kicad }));
  assert.equal(f.llamadas.script, 0);
  assert.equal(f.llamadas.urls.length, 0);
  assert.equal(win.document.querySelector("kicanvas-embed"), null);
  assert.ok(win.document.querySelector("figure.hw-kicad a"));
});

test("montarVisores: sin bloques ```kicad no se carga KiCanvas (ni con la carga por defecto: ningún <script> nuevo)", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  const texto = `# Placa\n\n\`\`\`pdf\narchivo: ${A}\n\`\`\`\n`;
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  const f = falsoKicad();
  await montarVisores(win.document.body, texto, opciones({ kicad: f.kicad }));
  assert.equal(f.llamadas.script, 0);
  await montarVisores(win.document.body, texto, opciones());
  assert.equal(win.document.querySelector("script"), null);
});

test("montarVisores: si la descarga falla, el texto no es KiCad o pasa de MAX_KICAD_VISOR, avisa (role=status) y deja descarga y respaldo", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const { MAX_KICAD_VISOR } = await vis();
  const texto = bloque(`archivo: ${A}\nrespaldo: ${B}`);
  for (const malo of [new Error("HTTP 500"), "<html>no</html>", "(kicad_sch " + "x".repeat(MAX_KICAD_VISOR)]) {
    const win = ventana();
    win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
    await montarVisores(win.document.body, texto, opciones({ kicad: falsoKicad(malo).kicad }));
    assert.equal(win.document.querySelector("kicanvas-embed"), null, String(malo).slice(0, 40));
    const aviso = win.document.querySelector("figure.hw-kicad [role=status]");
    assert.ok(aviso, "aviso de fallo");
    assert.match(aviso.textContent, /respaldo|descarga/i);
    assert.equal(win.document.querySelectorAll("figure.hw-kicad a").length, 2);
  }
});

test("cargarKicanvas: añade una sola vez <script type=module src=/vendor/kicanvas/kicanvas.js> (mismo origen, sin código en línea)", async () => {
  const { cargarKicanvas } = await md();
  const win = ventana();
  void cargarKicanvas(win.document);
  void cargarKicanvas(win.document);
  const scripts = [...win.document.querySelectorAll("script")];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].getAttribute("type"), "module");
  assert.equal(scripts[0].getAttribute("src"), SCRIPT_KICANVAS);
  assert.equal(scripts[0].textContent, "");
});

// ---------- 4. KiCanvas vendorizado y CSP ----------

test("vendor: kicanvas.js parcheado (sin Google Fonts), con su sha256 fijado, y LICENSE MIT de theacodes/kicanvas", () => {
  assert.ok(existsSync(new URL(`../${VENDOR}`, import.meta.url)), VENDOR);
  const js = leer(VENDOR).replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(js).digest("hex"), SHA_PARCHEADO);
  assert.doesNotMatch(js, /fonts\.googleapis|fonts\.gstatic/);
  assert.match(js, /customElements\.define\("kicanvas-embed"/);
  assert.match(js, /customElements\.define\("kicanvas-source"/);
  const lic = leer("public/vendor/kicanvas/LICENSE");
  assert.match(lic, /MIT/);
  assert.match(lic, /\(c\) 2022 by Alethea Katherine Flowers/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
});

test("CSP (C15): KiCanvas solo abre img-src a blob: (iconos de zoom); nada más cambia (sin worker-src, Google Fonts ni orígenes nuevos)", async () => {
  const config = (await import("../astro.config.mjs")).default;
  const csp = config.security.csp;
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
  assert.ok(csp.directives.includes("connect-src 'self'"));
  assert.ok(csp.directives.includes("img-src 'self' data: blob:"), "C15: img-src debe permitir blob: (iconos de zoom de KiCanvas)");
  assert.deepEqual(csp.directives.filter((d) => /blob:/.test(d)), ["img-src 'self' data: blob:"]);
  const todo = JSON.stringify(csp);
  assert.doesNotMatch(todo, /worker-src|child-src|googleapis|gstatic|kicanvas\.org/);
});

// ---------- 5. Editor ----------

test("página de hardware: botón 'Insertar esquemático (KiCad)' con input de archivo (.kicad_sch, .kicad_pcb y respaldo .pdf/.svg)", () => {
  const p = leer("src/pages/[project]/[disciplina].astro");
  assert.match(p, /<button type="button" class="btn" data-hw-insertar-kicad[^>]*>Insertar esquemático \(KiCad\)<\/button>/);
  const input = p.match(/<input type="file"[^>]*data-hw-archivo-kicad[^>]*>/)?.[0] ?? "";
  assert.ok(input, "input data-hw-archivo-kicad");
  assert.match(input, /accept="\.kicad_sch,\.kicad_pcb,\.pdf,\.svg"/);
  assert.match(input, /\bmultiple\b/);
  assert.match(input, /aria-hidden="true"/);
});

test("script del editor: Insertar KiCad bloqueado con insercionBloqueada, usa archivosKicad + subir() + bloqueKicad; el visor solo lo crea montarVisores", () => {
  const s = leer("src/scripts/hardware-editor.ts");
  assert.match(s, /btnInsertarKicad\.disabled = insercionBloqueada\(guardando, cargandoVisual\)/);
  assert.match(s, /archivosKicad\(/);
  assert.match(s, /bloqueKicad\(/);
  assert.match(s, /insertarBloqueEnTexto\(bloqueKicad\(/);
  assert.doesNotMatch(s, /createElement\(\s*["']kicanvas-(embed|source)["']\s*\)/);
  assert.doesNotMatch(s, /kicanvas\.js/);
  assert.doesNotMatch(s, /\.innerHTML\s*=/);
});

test("editor visual: vistaBloque pinta ```kicad como tarjeta figure.hw-kicad (sin visor ni script)", async () => {
  const { vistaBloque } = await import("../src/lib/editor-visual.ts");
  const { crearRenderizador } = await md();
  const win = ventana();
  const salida = vistaBloque(crearRenderizador(win, { proyecto: "uuv" }).html, "kicad", `archivo: ${A}\nrespaldo: ${B}\ntitulo: Potencia`, { editable: true });
  assert.equal(typeof salida, "string");
  assert.match(salida, /^<figure class="hw-kicad">/);
  assert.doesNotMatch(salida, /kicanvas-embed|<script/i);
  assert.equal(vistaBloque(crearRenderizador(win, { proyecto: "uuv" }).html, "kicad", "archivo: no-uuid", { editable: true }), null);
});

test("estilos: figure.hw-kicad y su visor ocupan el ancho disponible sin desbordar (375 px)", () => {
  const css = leer("src/styles/global.css");
  assert.match(css, /figure\.hw-kicad\s*\{/);
  assert.match(css, /figure\.hw-kicad[^{]*kicanvas-embed[^{]*\{[^}]*(max-)?width:\s*100%/);
});

// ---------- 6. API de archivos ----------

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const realFetch = globalThis.fetch;
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

test("Worker /api/archivos: acepta .kicad_sch y .kicad_pcb y los sirve como descarga (octet-stream, attachment, nosniff, no enmarcable); exige sesión", async () => {
  const e = env();
  const sch = new TextEncoder().encode(SCH);
  const pcb = new TextEncoder().encode(PCB);
  assert.equal((await subir(e, A, "potencia.kicad_sch", sch)).status, 201);
  assert.equal((await subir(e, B, "potencia.kicad_pcb", pcb)).status, 201);
  for (const [id, bytes, nombre] of [[A, sch, "potencia.kicad_sch"], [B, pcb, "potencia.kicad_pcb"]]) {
    const r = await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id })}`, { login: "ana" });
    assert.equal(r.status, 200, nombre);
    assert.equal(r.headers.get("content-type"), "application/octet-stream");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-disposition") ?? "", new RegExp(`^attachment; filename="${nombre.replace(".", "\\.")}"`));
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  }
  assert.equal((await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id: A })}`)).status, 401);
});
