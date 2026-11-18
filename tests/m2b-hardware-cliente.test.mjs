// M2b: el Markdown de hardware se renderiza en el navegador (opción c). lib/hardware-core.mjs deja de importar satteri
// y devuelve md + metadatos (sin html, sin accion=previsualizar); el cliente renderiza con marked + DOMPurify
// (src/lib/hardware-md.ts, carga diferida) y /api/hardware responde en el Worker sobre D1.
// El sanitizador se prueba en un DOM real de jsdom (devDependency exacta). D1 es node:sqlite (tests/fixtures/d1-sqlite.mjs).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { almacenMemoria as fakeRedis } from "./fixtures/almacen-memoria.mjs";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";

const root = new URL("../", import.meta.url);
const raiz = fileURLToPath(root);
const leer = (rel) => readFileSync(new URL(rel, root), "utf8");
const existe = (rel) => existsSync(new URL(rel, root));

const SECRET = "m".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const EDITOR = "cyuxSz"; // editor de uuv/electronica en projects.json
const UUID = "0b7c8f2e-4d1a-4c3b-9e8f-1a2b3c4d5e6f";

// ======================================================================================================
// 1. hardware-core sin satteri ni html
// ======================================================================================================

// Grafo de imports estáticos locales desde un módulo: devuelve { archivos, externos } (externos = paquetes y node:*).
function grafoImports(rel) {
  const vistos = new Set();
  const externos = new Set();
  const pila = [resolve(raiz, rel)];
  while (pila.length) {
    const f = pila.pop();
    if (vistos.has(f)) continue;
    vistos.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith(".")) {
        const destino = resolve(dirname(f), spec);
        if (!/\.json$/.test(destino)) pila.push(destino);
      } else externos.add(spec);
    }
  }
  return { archivos: [...vistos].map((f) => f.slice(raiz.length).replace(/\\/g, "/")), externos: [...externos] };
}

test("core: hardware-core ya no exporta renderizarMd ni importa satteri, tools/neutralizar.mjs ni node:*", async () => {
  const src = leer("lib/hardware-core.mjs");
  assert.doesNotMatch(src, /["']satteri["']/, "no importa satteri");
  assert.doesNotMatch(src, /neutralizar/, "no importa tools/neutralizar.mjs (depende de satteri)");
  assert.doesNotMatch(src, /from\s+["']node:/, "sin imports node:* (randomUUID → crypto.randomUUID global)");
  assert.doesNotMatch(src, /markdownToHtml|renderizarMd|esquemaPeligroso/, "el render y su saneado salen del servidor");
  const mod = await import("../lib/hardware-core.mjs");
  assert.equal(mod.renderizarMd, undefined, "renderizarMd ya no se exporta");
  assert.equal(typeof mod.crearHandler, "function");
});

test("core: el grafo de imports de hardware-core no arrastra paquetes ni módulos de Node (apto para workerd)", () => {
  const { archivos, externos } = grafoImports("lib/hardware-core.mjs");
  assert.deepEqual(externos, [], `dependencias externas en el grafo: ${externos.join(", ")} (archivos: ${archivos.join(", ")})`);
  assert.ok(!archivos.some((f) => /tools\/neutralizar/.test(f)), "neutralizar.mjs no entra en el grafo");
  for (const f of archivos) assert.doesNotMatch(readFileSync(join(raiz, f), "utf8"), /process\.env\.(?!SESSION_SECRET\b)/, `${f}: sin process.env (salvo el valor por defecto de sesion.mjs)`);
});

function cookieDe(login, secret = SECRET) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

const PLANTILLAS = { electronica: [{ slug: "pcb", titulo: "PCB", md: "# PCB\n\n## Capas\n\n<b>crudo</b>\n" }], mecanica: [] };
const PROYECTOS = [{ id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: ["edi"] } } }];
async function montarCore() {
  const { crearHandler } = await import("../lib/hardware-core.mjs");
  const redis = fakeRedis();
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS, plantillas: PLANTILLAS, ahora: () => Date.parse("2026-11-15T12:00:00Z") });
  const base = { proyecto: "uuv", disciplina: "electronica" };
  const pedirCore = (method, { login = "edi", body, query } = {}) => {
    const headers = { cookie: cookieDe(login) };
    if (method !== "GET") Object.assign(headers, { "content-type": "application/json", origin: "https://docs.example" });
    const qs = query ? `?${new URLSearchParams({ ...base, ...query })}` : "";
    return handler(new Request(`https://docs.example/api/hardware/${qs}`, { method, headers, body: body ? JSON.stringify({ ...base, ...body }) : undefined }));
  };
  return { redis, pedirCore };
}
const CAMPOS_PAGINA = ["actualizado", "autor", "md", "slug", "titulo", "version"];

test("core: GET de página, crear, PUT y restaurar devuelven md y metadatos, sin html (mismo comportamiento en Vercel y Worker)", async () => {
  const { pedirCore } = await montarCore();
  assert.equal((await pedirCore("POST", { body: { accion: "inicializar" } })).status, 201);
  const g = await (await pedirCore("GET", { query: { pagina: "pcb" } })).json();
  assert.deepEqual(Object.keys(g.pagina).sort(), CAMPOS_PAGINA);
  assert.equal(g.pagina.md, PLANTILLAS.electronica[0].md, "el md llega tal cual (el HTML crudo lo neutraliza el cliente)");
  assert.equal(g.pagina.version, 1);
  const c = await (await pedirCore("POST", { body: { accion: "crear", pagina: "nueva", titulo: "Nueva" } })).json();
  assert.deepEqual(Object.keys(c.pagina).sort(), CAMPOS_PAGINA);
  const p = await (await pedirCore("PUT", { body: { pagina: "pcb", md: "# PCB\n\nCuatro capas.", version: 1 } })).json();
  assert.deepEqual(Object.keys(p.pagina).sort(), CAMPOS_PAGINA);
  assert.equal(p.pagina.version, 2);
  const r = await (await pedirCore("POST", { body: { accion: "restaurar", pagina: "pcb", revision: 0, version: 2 } })).json();
  assert.deepEqual(Object.keys(r.pagina).sort(), CAMPOS_PAGINA);
  assert.equal(r.pagina.md, PLANTILLAS.electronica[0].md);
});

test("core: accion=previsualizar ya no existe (la vista previa es local) → 400 sin escribir ni gastar cubo de tasa", async () => {
  const { pedirCore, redis } = await montarCore();
  const antes = JSON.stringify([...redis.data.keys()]);
  const res = await pedirCore("POST", { body: { accion: "previsualizar", md: "# x" } });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Acción inválida" });
  assert.equal(JSON.stringify([...redis.data.keys()]), antes, "ni páginas ni contador hwprev");
  assert.doesNotMatch(leer("lib/hardware-core.mjs"), /previsualizar|hwprev/);
});

// ======================================================================================================
// 2. /api/hardware en el Worker
// ======================================================================================================

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

function crearEnv(extra = {}) {
  const llamadas = [];
  const env = {
    GITHUB_CLIENT_ID: "cid",
    GITHUB_CLIENT_SECRET: "csecret",
    SESSION_SECRET: SECRET,
    ALLOWED_ORG: "vanttec",
    ALLOWED_USERS: "",
    DB: db,
    ASSETS: { async fetch(req) { llamadas.push(req); return new Response("asset"); } },
    ...extra,
  };
  return { env, llamadas };
}

async function pedir(path, { env, login, method = "GET", cuerpo, origin = ORIGIN, headers = {} } = {}) {
  const worker = (await import("../worker/index.mjs")).default;
  const h = { ...headers };
  if (login) h.cookie = cookieDe(login);
  if (cuerpo !== undefined) {
    h["content-type"] ??= "application/json";
    if (origin) h.origin = origin;
  }
  const req = new Request(`${ORIGIN}${path}`, { method, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return worker.fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
}
const BASE = { proyecto: "uuv", disciplina: "electronica" };
const qs = (o) => new URLSearchParams({ ...BASE, ...o }).toString();

test("worker: /api/hardware (con y sin barra) ya no es 501: índice vacío con editable según el editor", async () => {
  const { env, llamadas } = crearEnv();
  for (const path of [`/api/hardware/?${qs()}`, `/api/hardware?${qs()}`]) {
    for (const [login, editable] of [[EDITOR, true], ["ana", false]]) {
      const res = await pedir(path, { env, login });
      assert.equal(res.status, 200, `${path} ${login}`);
      const j = await res.json();
      assert.equal(j.editable, editable, `${path} ${login}`);
      assert.deepEqual(j.paginas, []);
      assert.match(res.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    }
  }
  assert.equal(llamadas.length, 0, "la API no pasa por ASSETS");
});

test("worker: inicializar desde la plantilla, leer el índice y una página (md sin html) contra D1", async () => {
  const { env } = crearEnv();
  const ini = await pedir("/api/hardware/", { env, login: EDITOR, method: "POST", cuerpo: { ...BASE, accion: "inicializar" } });
  assert.equal(ini.status, 201);
  const plantilla = JSON.parse(leer("plantillas/electronica.json"));
  const indice = await (await pedir(`/api/hardware/?${qs()}`, { env, login: "ana" })).json();
  assert.deepEqual(indice.paginas.map((p) => p.slug), plantilla.map((p) => p.slug), "usa plantillas/electronica.json");
  const res = await pedir(`/api/hardware/?${qs({ pagina: plantilla[0].slug })}`, { env, login: "ana" });
  assert.equal(res.status, 200);
  const { pagina, editable } = await res.json();
  assert.equal(editable, false);
  assert.equal(pagina.md, plantilla[0].md);
  assert.equal(pagina.version, 1);
  assert.ok(!("html" in pagina), "sin html: renderiza el navegador");
});

test("worker: guardar con versión → 200 v+1; versión vieja → 409 con la versión actual; no editor → 403", async () => {
  const { env } = crearEnv();
  await pedir("/api/hardware/", { env, login: EDITOR, method: "POST", cuerpo: { ...BASE, accion: "inicializar" } });
  const put = await pedir("/api/hardware/", { env, login: EDITOR, method: "PUT", cuerpo: { ...BASE, pagina: "pcb", md: "# PCB\n\nCuatro capas.", version: 1 } });
  assert.equal(put.status, 200);
  const { pagina } = await put.json();
  assert.equal(pagina.version, 2);
  assert.equal(pagina.md, "# PCB\n\nCuatro capas.");
  assert.equal(pagina.autor, EDITOR);
  assert.ok(!("html" in pagina));
  const viejo = await pedir("/api/hardware/", { env, login: EDITOR, method: "PUT", cuerpo: { ...BASE, pagina: "pcb", md: "# pisar", version: 1 } });
  assert.equal(viejo.status, 409);
  assert.equal((await viejo.json()).version, 2);
  const lector = await pedir("/api/hardware/", { env, login: "ana", method: "PUT", cuerpo: { ...BASE, pagina: "pcb", md: "# no", version: 2 } });
  assert.equal(lector.status, 403);
  const g = await (await pedir(`/api/hardware/?${qs({ pagina: "pcb" })}`, { env, login: "ana" })).json();
  assert.equal(g.pagina.md, "# PCB\n\nCuatro capas.", "ni el 409 ni el 403 pisaron el contenido");
});

test("worker: /api/hardware sin sesión → 401; otro origen → 403; método no permitido → 405 con Allow; sin binding DB → 503", async () => {
  const { env } = crearEnv();
  const sin = await pedir(`/api/hardware/?${qs()}`, { env });
  assert.equal(sin.status, 401);
  const otro = await pedir("/api/hardware/", { env, login: EDITOR, method: "POST", cuerpo: { ...BASE, accion: "inicializar" }, origin: "https://malo.example" });
  assert.equal(otro.status, 403);
  assert.deepEqual((await (await pedir(`/api/hardware/?${qs()}`, { env, login: "ana" })).json()).paginas, [], "nada escrito");
  const patch = await pedir("/api/hardware/", { env, login: EDITOR, method: "PATCH", cuerpo: {} });
  assert.equal(patch.status, 405);
  assert.equal(patch.headers.get("allow"), "GET, POST, PUT, DELETE");
  const { env: sinDb } = crearEnv({ DB: undefined });
  assert.equal((await pedir(`/api/hardware/?${qs()}`, { env: sinDb, login: EDITOR })).status, 503);
});

test("worker: importa hardware-core y las plantillas (JSON) sin comentario de 501", () => {
  const src = leer("worker/index.mjs");
  assert.match(src, /from\s+["']\.\.\/lib\/hardware-core\.mjs["']/);
  assert.match(src, /plantillas\/electronica\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*\}/);
  assert.match(src, /plantillas\/mecanica\.json["']\s+with\s*\{\s*type:\s*["']json["']\s*\}/);
  assert.doesNotMatch(src, /501|No disponible aún en Cloudflare/);
});

// ======================================================================================================
// 3. Render en el navegador: src/lib/hardware-md.ts (marked + DOMPurify) en jsdom
// ======================================================================================================

const cargarMd = () => import("../src/lib/hardware-md.ts");
const ventana = () => new JSDOM("<!doctype html><html><body></body></html>", { url: `${ORIGIN}/uuv/electronica/` }).window;
async function render(md) {
  const { crearRenderizador } = await cargarMd();
  const win = ventana();
  const r = crearRenderizador(win);
  const html = r.html(md);
  const doc = new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
  return { html, doc, r, win };
}

const ETIQUETAS = new Set(["A", "P", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "EM", "DEL", "S", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "IMG", "INPUT"]);
const ATRIBUTOS = new Set(["href", "src", "alt", "title", "align", "start", "type", "checked", "disabled", "class", "rel"]);
const ESQUEMA_MALO = /^(javascript|vbscript|data|file):/i;

// Comprueba la salida como la vería el navegador: solo etiquetas y atributos de la lista blanca, sin on*, href seguros
// (o ausentes / "#"), src solo de /api/archivos y enlaces http(s) con rel="noopener noreferrer".
function comprobarSeguro(doc, caso) {
  for (const el of doc.body.querySelectorAll("*")) {
    assert.ok(ETIQUETAS.has(el.tagName), `${caso}: etiqueta no permitida <${el.tagName.toLowerCase()}>`);
    for (const a of el.attributes) {
      assert.ok(ATRIBUTOS.has(a.name), `${caso}: atributo no permitido ${a.name} en <${el.tagName.toLowerCase()}>`);
      assert.doesNotMatch(a.name, /^on/i, caso);
    }
    if (el.hasAttribute("href")) {
      const v = el.getAttribute("href").replace(/[\u0000- \u007f-\u009f]/g, "");
      assert.doesNotMatch(v, ESQUEMA_MALO, `${caso}: href ${v}`);
      assert.doesNotMatch(v, /^[/\\]{2}|^\/\\/, `${caso}: href protocol-relative ${v}`);
      if (/^https?:/i.test(v)) assert.equal(el.getAttribute("rel"), "noopener noreferrer", `${caso}: enlace externo sin rel`);
    }
    if (el.hasAttribute("src")) assert.match(el.getAttribute("src"), /^\/api\/archivos\/?\?/, `${caso}: src fuera de /api/archivos`);
    if (el.tagName === "INPUT") {
      assert.equal(el.getAttribute("type"), "checkbox", `${caso}: input que no es checkbox`);
      assert.ok(el.hasAttribute("disabled"), `${caso}: checkbox editable`);
    }
    if (el.hasAttribute("class")) assert.match(el.getAttribute("class"), /^language-[\w+#-]+$/, `${caso}: class ${el.getAttribute("class")}`);
  }
}

const XSS = [
  "<script>alert(1)</script>",
  "texto <script>alert(1)</script> en línea",
  '<img src=x onerror="alert(1)">',
  "<img src=x onerror=alert(1)>",
  '<iframe src="https://evil.example"></iframe>',
  "<svg onload=alert(1)><script>alert(1)</script></svg>",
  "<svg><a xlink:href=\"javascript:alert(1)\"><text>x</text></a></svg>",
  "<math><mi xlink:href=\"javascript:alert(1)\">x</mi></math>",
  '<a href="javascript:alert(1)">crudo</a>',
  "<details open ontoggle=alert(1)>",
  "<style>body{display:none}</style>",
  '<form action="https://evil.example"><button>x</button></form>',
  "[x](javascript:alert(1))",
  "[x](JaVaScRiPt:alert(1))",
  "[x](java\tscript:alert(1))",
  "[x](java&#9;script:alert(1))",
  "[x](&#x6a;avascript:alert(1))",
  "[x](&#106;avascript:alert(1))",
  "[x](javascript&colon;alert(1))",
  "[x](vbscript:msgbox(1))",
  "[x](data:text/html,<script>alert(1)</script>)",
  "[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[x](file:///etc/passwd)",
  "[x](//evil.example/x)",
  "<javascript:alert(1)>",
  "[x][r]\n\n[r]: javascript:alert(1)",
  '[x](/ok "t\\" onmouseover=alert(1) x=\\"")',
  "![x](javascript:alert(1))",
  "![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)",
  "![x](https://evil.example/rastreo.png)",
  '![x" onerror="alert(1)](/api/archivos/?proyecto=uuv&id=1)',
  "- [x] tarea <input type=text autofocus onfocus=alert(1)>",
];

test("cliente: crearRenderizador(win) devuelve { html, fragmento } y no deja HTML activo en ningún caso de XSS", async () => {
  const { crearRenderizador } = await cargarMd();
  assert.equal(typeof crearRenderizador, "function");
  for (const caso of XSS) {
    const { html, doc } = await render(caso);
    assert.equal(typeof html, "string", caso);
    assert.doesNotMatch(html, /<(script|iframe|svg|math|style|form|details|object|embed)\b/i, `etiqueta activa: ${caso}`);
    comprobarSeguro(doc, caso);
  }
});

test("cliente: entidad numérica de sustituto (&#xd800; / &#55296;) en un enlace no rompe el render ni deja javascript:", async () => {
  for (const caso of ["[x](&#xd800;javascript:alert(1))", "[y](&#55296;javascript:alert(2))", "[x](&#xd800;javascript:alert(1)) [y](&#55296;javascript:alert(2))"]) {
    const { html, doc } = await render(caso);
    assert.equal(typeof html, "string", caso);
    // Se resuelve con el parser WHATWG (el del navegador): "�javascript:..." es una ruta relativa, no un esquema.
    for (const a of doc.querySelectorAll("[href]")) {
      const h = a.getAttribute("href");
      assert.doesNotMatch(h.replace(/[\u0000- \u007f-\u009f]/g, ""), /^javascript:/i, `${caso}: href ${h}`);
      assert.notEqual(new URL(h, `${ORIGIN}/uuv/electronica/`).protocol, "javascript:", `${caso}: href ${h}`);
    }
    comprobarSeguro(doc, caso);
  }
});

test("cliente: el HTML crudo se neutraliza (se ve como texto), igual que neutralizeHtml en la wiki", async () => {
  const { doc } = await render("# Hola\n\n<b>negrita cruda</b>\n\ntexto <i>en línea</i> fin\n\n<div onclick=x>bloque</div>");
  assert.equal(doc.querySelector("b, i, div"), null, "las etiquetas crudas no se vuelven elementos");
  const texto = doc.body.textContent;
  assert.match(texto, /<b>negrita cruda<\/b>/, "el HTML del bloque se muestra como texto");
  assert.match(texto, /<i>en línea<\/i>/, "el HTML en línea también");
  assert.match(texto, /<div onclick=x>bloque<\/div>/);
});

test("cliente: el código conserva < y > como texto (sin &lt; doble) y lleva class language-*", async () => {
  const { doc } = await render("```c\nif (a < b && c > d) {}\n```\n\nEn línea: `<b>x</b>`");
  const pre = doc.querySelector("pre > code");
  assert.ok(pre);
  assert.equal(pre.getAttribute("class"), "language-c");
  assert.equal(pre.textContent, "if (a < b && c > d) {}\n");
  assert.equal(doc.querySelector("p > code").textContent, "<b>x</b>");
});

test("cliente: enlaces: rutas internas y anclas se conservan; externos con rel=noopener noreferrer; adjuntos e imágenes de /api/archivos", async () => {
  const md = [
    "[interno](/uuv/electronica/?p=pcb) [ancla](#capas) [externo](https://github.com/vanttec) [correo](mailto:equipo@ejemplo.org) www.ejemplo.org",
    "",
    `![placa](/api/archivos/?proyecto=uuv&id=${UUID}) [hoja.pdf](/api/archivos/?proyecto=uuv&id=${UUID})`,
  ].join("\n");
  const { doc } = await render(md);
  comprobarSeguro(doc, "enlaces");
  const a = Object.fromEntries([...doc.querySelectorAll("a")].map((x) => [x.textContent, x]));
  assert.equal(a.interno.getAttribute("href"), "/uuv/electronica/?p=pcb");
  assert.equal(a.interno.getAttribute("rel"), null, "los internos no llevan rel");
  assert.equal(a.ancla.getAttribute("href"), "#capas");
  assert.equal(a.externo.getAttribute("href"), "https://github.com/vanttec");
  assert.equal(a.externo.getAttribute("rel"), "noopener noreferrer");
  assert.equal(a.correo.getAttribute("href"), "mailto:equipo@ejemplo.org");
  assert.equal(a["www.ejemplo.org"].getAttribute("rel"), "noopener noreferrer", "autoenlace GFM externo");
  assert.equal(a["hoja.pdf"].getAttribute("href"), `/api/archivos/?proyecto=uuv&id=${UUID}`);
  const img = doc.querySelector("img");
  assert.equal(img.getAttribute("src"), `/api/archivos/?proyecto=uuv&id=${UUID}`);
  assert.equal(img.getAttribute("alt"), "placa");
});

test("cliente: urlSegura(valor, 'href' | 'src') aplica la lista blanca de rutas y esquemas", async () => {
  const { urlSegura } = await cargarMd();
  assert.equal(typeof urlSegura, "function");
  const bien = {
    href: ["https://x.org/a?b=1", "http://x.org", "mailto:a@b.org", "/uuv/electronica/?p=pcb", "#capas", "pcb", "?p=pcb", `/api/archivos/?proyecto=uuv&id=${UUID}`],
    src: [`/api/archivos/?proyecto=uuv&id=${UUID}`, `/api/archivos?proyecto=uuv&id=${UUID}`],
  };
  const mal = {
    href: ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "java\nscript:x", "&#x6a;avascript:alert(1)", "&#106;avascript:alert(1)", "javascript&colon;alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ftp://x.org", "//evil.example/x", "/\\evil.example", "\\\\evil.example"],
    src: ["https://evil.example/x.png", "http://x.org/a.png", "data:image/png;base64,AAAA", "/uuv/x.png", "x.png", "//evil.example/api/archivos/?x", "/api/archivosX?proyecto=uuv", "/api/archivos/../x", "/api/archivos/otra?x", "javascript:alert(1)", ""],
  };
  for (const tipo of ["href", "src"]) {
    for (const v of bien[tipo]) assert.equal(urlSegura(v, tipo), v, `${tipo} permitido: ${v}`);
    for (const v of mal[tipo]) assert.equal(urlSegura(v, tipo), null, `${tipo} rechazado: ${JSON.stringify(v)}`);
  }
});

test("cliente: fragmento(md) devuelve un DocumentFragment del documento de la ventana, ya saneado", async () => {
  const { crearRenderizador } = await cargarMd();
  const win = ventana();
  const frag = crearRenderizador(win).fragmento("# T\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))");
  assert.equal(frag.nodeType, 11, "DocumentFragment");
  assert.equal(frag.querySelector("script"), null);
  assert.equal(frag.querySelector("h1")?.textContent, "T");
  for (const a of frag.querySelectorAll("a[href]")) assert.doesNotMatch(a.getAttribute("href"), /javascript/i);
  win.document.body.replaceChildren(frag);
  assert.equal(win.document.body.querySelector("h1")?.textContent, "T", "se inserta en el documento de la página");
});

// Equivalencia básica con el render de hoy (satteri, GFM): misma secuencia de etiquetas para Markdown sin HTML crudo.
const etiquetas = (html) => [...new JSDOM(`<!doctype html><body>${html}</body>`).window.document.body.querySelectorAll("*")].map((e) => e.tagName.toLowerCase());
const MUESTRAS = [
  "# Título\n\n## Subtítulo\n\n### Tercer nivel\n\nTexto **negrita**, _cursiva_, ~~tachado~~ y `código`.",
  "| Pin | Señal | Nota |\n|:----|:-----:|-----:|\n| 1 | VCC | 5 V |\n| 2 | GND | masa |",
  "```c\nint main(void) { return 0; }\n```\n\n```\nsin lenguaje\n```",
  `![placa](/api/archivos/?proyecto=uuv&id=${UUID})\n\n[datasheet.pdf](/api/archivos/?proyecto=uuv&id=${UUID})`,
  "- uno\n- dos\n  - anidado\n\n1. a\n2. b\n\n> cita\n\n---",
  "- [x] hecho\n- [ ] pendiente",
];
test("cliente: equivalencia básica con satteri (encabezados, tablas, código, listas, imágenes de /api/archivos)", async () => {
  const { markdownToHtml } = await import("satteri");
  for (const md of MUESTRAS) {
    const servidor = markdownToHtml(md, { features: { gfm: true, frontmatter: false } }).html;
    const { html, doc } = await render(md);
    assert.deepEqual(etiquetas(html), etiquetas(servidor), `misma estructura: ${JSON.stringify(md.slice(0, 40))}`);
    comprobarSeguro(doc, md.slice(0, 30));
  }
  const { doc } = await render(MUESTRAS[1]);
  assert.deepEqual([...doc.querySelectorAll("th")].map((t) => t.textContent), ["Pin", "Señal", "Nota"]);
  assert.equal(doc.querySelectorAll("tbody tr").length, 2);
});

test("cliente: hardware-md.ts usa marked y DOMPurify (sin eval ni new Function) y no depende de satteri", () => {
  const src = leer("src/lib/hardware-md.ts");
  assert.match(src, /from\s+["']marked["']/);
  assert.match(src, /from\s+["']dompurify["']/);
  assert.doesNotMatch(src, /satteri|\beval\(|new Function|innerHTML|outerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(src, /ADD_TAGS|ADD_ATTR|ALLOW_UNKNOWN_PROTOCOLS|SAFE_FOR_TEMPLATES:\s*false/, "lista blanca cerrada");
  assert.match(src, /ALLOWED_TAGS/);
  assert.match(src, /ALLOWED_ATTR/);
});

// ======================================================================================================
// 4. Cliente: integración en hardware-editor.ts y carga diferida
// ======================================================================================================

test("cliente: hardware-editor.ts carga el render con import() diferido y no importa marked/dompurify de forma estática", () => {
  const js = leer("src/scripts/hardware-editor.ts");
  assert.match(js, /import\(\s*["']\.\.\/lib\/hardware-md(\.ts)?["']\s*\)/, "import() dinámico de ../lib/hardware-md");
  assert.doesNotMatch(js, /^\s*import\s[^;]*from\s+["'](marked|dompurify|\.\.\/lib\/hardware-md(\.ts)?)["']/m, "sin import estático");
  assert.match(js.replace(/^\s*\/\/.*$/gm, ""), /crearRenderizador\(window\s*(\)|,\s*\{)/, "crearRenderizador(window) o crearRenderizador(window, { ...opciones })");
  assert.match(js, /\.fragmento\(/);
});

test("cliente: el HTML entra al DOM por un único punto (pintarMd) y la vista previa ya no va al servidor", () => {
  const js = leer("src/scripts/hardware-editor.ts");
  assert.doesNotMatch(js, /\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write|new DOMParser/);
  assert.equal((js.match(/\.fragmento\(/g) ?? []).length, 1, "un único punto de entrada de HTML");
  assert.match(js, /pintarMd\(lectura,\s*p\.md,\s*p\.titulo\)/);
  assert.match(js, /pintarMd\(previa,\s*textarea\.value,\s*pagina\?\.titulo\)/);
  assert.doesNotMatch(js, /previsualizar/, "sin POST accion=previsualizar");
  assert.doesNotMatch(js, /\.html\b/, "no lee html de la API");
  assert.doesNotMatch(js.match(/interface PaginaHw\s*\{[^}]*\}/)?.[0] ?? "", /\bhtml\b/, "PaginaHw sin html");
});

function archivosSrc(dir) {
  const out = [];
  for (const n of readdirSync(join(raiz, dir))) {
    const p = join(dir, n);
    if (statSync(join(raiz, p)).isDirectory()) out.push(...archivosSrc(p));
    else if (/\.(ts|tsx|js|mjs|astro)$/.test(n)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}
test("cliente: solo hardware-editor.ts importa hardware-md, y nadie más en src/ importa marked ni dompurify (carga solo en Electrónica/Mecánica)", () => {
  for (const f of archivosSrc("src")) {
    const src = readFileSync(join(raiz, f), "utf8");
    if (f !== "src/scripts/hardware-editor.ts") assert.doesNotMatch(src, /lib\/hardware-md/, `${f} no debe importar hardware-md`);
    if (f !== "src/lib/hardware-md.ts") assert.doesNotMatch(src, /from\s+["'](marked|dompurify)["']|import\(\s*["'](marked|dompurify)["']/, `${f} no debe importar marked/dompurify`);
  }
  const quien = archivosSrc("src").filter((f) => /["'](?:\.\.?\/)+scripts\/hardware-editor(?:\.ts)?["']/.test(readFileSync(join(raiz, f), "utf8")));
  assert.deepEqual(quien, ["src/pages/[project]/[disciplina].astro"], "el script solo se carga en la página de disciplina");
});

// ======================================================================================================
// 5. Dependencias, herramientas y documentación
// ======================================================================================================

test("package.json: marked y dompurify directas con versión exacta (las instaladas); satteri se queda; jsdom solo de desarrollo", () => {
  const pkg = JSON.parse(leer("package.json"));
  for (const dep of ["marked", "dompurify"]) {
    const v = pkg.dependencies?.[dep];
    assert.ok(v, `falta ${dep} en dependencies`);
    assert.match(v, /^\d+\.\d+\.\d+$/, `${dep}: versión exacta`);
    assert.equal(v, JSON.parse(leer(`node_modules/${dep}/package.json`)).version, `${dep}: la misma que está instalada`);
  }
  assert.ok(pkg.dependencies.satteri, "la búsqueda y la wiki siguen usando satteri en el build");
  assert.match(pkg.devDependencies?.jsdom ?? "", /^\d+\.\d+\.\d+$/, "jsdom devDependency exacta");
  assert.ok(!pkg.dependencies.jsdom);
});

test("tools/medir-render.mjs ya no importa hardware-core (mide satteri directo como referencia)", () => {
  const src = leer("tools/medir-render.mjs");
  assert.doesNotMatch(src, /hardware-core/);
});

test("README: la sección de Cloudflare dice que /api/hardware responde en el Worker y que el render es en el navegador", () => {
  const md = leer("README.md");
  const i = md.indexOf("## Cloudflare");
  assert.ok(i >= 0);
  const fin = md.indexOf("\n## ", i + 1);
  const sec = md.slice(i, fin === -1 ? undefined : fin);
  assert.doesNotMatch(sec, /hardware`?\s+responde\s+501/i, "ya no es 501");
  assert.match(sec, /navegador/i);
  assert.match(sec, /marked/);
  assert.match(sec, /DOMPurify/);
  assert.doesNotMatch(sec, /upstash-local/, "el Upstash simulado ya no se documenta");
});
