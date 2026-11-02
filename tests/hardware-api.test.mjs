// Lote 1a: API de documentación de hardware (api/hardware.js → lib/hardware-core.mjs) sobre Upstash Redis (REST).
// Mismo patrón que tests/comentarios-api.test.mjs: Redis en memoria inyectado y cookie de sesión firmada con HMAC.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fakeRedis } from "./fixtures/redis-memoria.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const URL_API = `${ORIGIN}/api/hardware/`;
const T0 = Date.parse("2026-11-02T12:00:00Z");
const EDITOR = "edi";

const PLANTILLAS = {
  electronica: [
    { slug: "arquitectura", titulo: "Arquitectura", md: "# Arquitectura\n\n## Diagrama de bloques\n" },
    { slug: "potencia", titulo: "Potencia", md: "# Potencia\n\n## Baterías\n" },
    { slug: "pcb", titulo: "PCB", md: "# PCB\n\n## Capas\n" },
  ],
  mecanica: [{ slug: "ensamble", titulo: "Ensamble", md: "# Ensamble\n" }],
};
const PROYECTOS = [
  { id: "uuv", disciplinas: { electronica: { plantilla: "electronica", editores: [EDITOR, "Otra"] }, mecanica: { plantilla: "mecanica", editores: [] } } },
  { id: "proyecto-x", disciplinas: { electronica: { plantilla: "electronica", editores: ["cyuxSz"] } } },
  { id: "usv" },
];

const core = () => import("../lib/hardware-core.mjs");

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

function cookieDe(login, { exp = Date.now() + 864e5, secret = SECRET } = {}) {
  const body = Buffer.from(JSON.stringify({ login, exp })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`)}`;
}

async function montar({ redis = fakeRedis(), env = {}, ahora = () => T0, proyectos = PROYECTOS } = {}) {
  const { crearHandler } = await core();
  const handler = crearHandler({ env: { SESSION_SECRET: SECRET, ...env }, redis, proyectos, plantillas: PLANTILLAS, ahora });
  return { handler, redis };
}

function req(method, { login, cookie, body, query = {}, origin = ORIGIN, ct = "application/json" } = {}) {
  const headers = {};
  if (login) headers.cookie = cookieDe(login);
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") {
    if (ct) headers["content-type"] = ct;
    if (origin) headers.origin = origin;
  }
  const qs = new URLSearchParams(query).toString();
  return new Request(qs ? `${URL_API}?${qs}` : URL_API, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
}

const BASE = { proyecto: "uuv", disciplina: "electronica" };
const indice = (h, login = "ana", extra = {}) => h(req("GET", { login, query: { ...BASE, ...extra } }));
const pagina = (h, slug, login = "ana", extra = {}) => h(req("GET", { login, query: { ...BASE, pagina: slug, ...extra } }));
const post = (h, body, login = EDITOR, extra = {}) => h(req("POST", { login, body: { ...BASE, ...body }, ...extra }));
const put = (h, body, login = EDITOR, extra = {}) => h(req("PUT", { login, body: { ...BASE, ...body }, ...extra }));
const del = (h, body, login = EDITOR, extra = {}) => h(req("DELETE", { login, body: { ...BASE, ...body }, ...extra }));

function cabecerasJson(res, que) {
  assert.match(res.headers.get("content-type") ?? "", /application\/json/, `${que}: content-type`);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/, `${que}: cache-control`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${que}: nosniff`);
}

async function inicializado() {
  const m = await montar();
  const res = await post(m.handler, { accion: "inicializar" });
  assert.equal(res.status, 201, "inicializar la primera vez");
  return m;
}

// ---------- Identidad, configuración y acceso ----------

test("401: sin cookie, alterada, caducada o de otro secreto, en todos los métodos", async () => {
  const { handler } = await montar();
  const cookies = [undefined, "docs_session=a.b", cookieDe("ana", { exp: Date.now() - 1 }), cookieDe("ana", { secret: "x".repeat(40) }), `${cookieDe("ana")}x`];
  for (const cookie of cookies) {
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const res = await handler(req(method, { cookie, query: method === "GET" ? BASE : {}, body: method === "GET" ? undefined : { ...BASE, accion: "inicializar", pagina: "pcb", md: "x", version: 1 } }));
      assert.equal(res.status, 401, `${method} ${cookie}`);
      cabecerasJson(res, "401");
      assert.equal(typeof (await res.json()).error, "string");
    }
  }
});

test("503 sin SESSION_SECRET fuerte y 503 'no configurado' sin almacén (sin variables de Upstash)", async () => {
  const { crearHandler } = await core();
  const sinSecreto = crearHandler({ env: { SESSION_SECRET: "corto" }, redis: fakeRedis(), proyectos: PROYECTOS, plantillas: PLANTILLAS });
  assert.equal((await sinSecreto(req("GET", { login: "ana", query: BASE }))).status, 503);
  for (const redis of [undefined, null]) {
    const h = crearHandler({ env: { SESSION_SECRET: SECRET }, redis, proyectos: PROYECTOS, plantillas: PLANTILLAS });
    const res = await h(req("GET", { login: "ana", query: BASE }));
    assert.equal(res.status, 503, `redis=${redis}`);
    cabecerasJson(res, "503");
  }
});

test("405 para métodos no soportados (PATCH) con cabecera Allow", async () => {
  const { handler } = await montar();
  const res = await handler(req("PATCH", { login: EDITOR, body: BASE }));
  assert.equal(res.status, 405);
  assert.match(res.headers.get("allow") ?? "", /GET/);
  assert.match(res.headers.get("allow") ?? "", /PUT/);
});

test("404: disciplina no configurada en el proyecto o proyecto sin la clave disciplinas", async () => {
  const { handler } = await montar();
  for (const query of [{ proyecto: "uuv", disciplina: "software" }, { proyecto: "usv", disciplina: "electronica" }, { proyecto: "proyecto-x", disciplina: "mecanica" }]) {
    const login = query.proyecto === "proyecto-x" ? "cyuxSz" : "ana";
    const res = await handler(req("GET", { login, query }));
    assert.equal(res.status, 404, JSON.stringify(query));
    cabecerasJson(res, "404");
  }
  const res = await handler(req("POST", { login: EDITOR, body: { proyecto: "uuv", disciplina: "software", accion: "inicializar" } }));
  assert.equal(res.status, 404, "escritura en disciplina no configurada");
});

test("400/404: proyecto o disciplina con formato inválido o proyecto inexistente; nunca 200", async () => {
  const { handler } = await montar();
  for (const query of [{ disciplina: "electronica" }, { proyecto: "uuv" }, { proyecto: "../uuv", disciplina: "electronica" }, { proyecto: "uuv", disciplina: "ELEC TRONICA" }, { proyecto: "nadie", disciplina: "electronica" }]) {
    const res = await handler(req("GET", { login: "ana", query }));
    assert.ok([400, 404].includes(res.status), `${JSON.stringify(query)} → ${res.status}`);
  }
});

test("proyecto restringido (canAccess): otro login recibe 403 en lectura y escritura; cyuxSz entra", async () => {
  const { handler } = await montar();
  const X = { proyecto: "proyecto-x", disciplina: "electronica" };
  assert.equal((await handler(req("GET", { login: "ana", query: X }))).status, 403);
  assert.equal((await handler(req("POST", { login: "ana", body: { ...X, accion: "inicializar" } }))).status, 403);
  // Un proyecto restringido no revela si la disciplina existe: 403 antes que 404.
  assert.equal((await handler(req("GET", { login: "ana", query: { proyecto: "proyecto-x", disciplina: "mecanica" } }))).status, 403);
  const ok = await handler(req("GET", { login: "CyuxSZ", query: X }));
  assert.equal(ok.status, 200);
});

test("lectura: cualquier sesión con acceso ve el índice; editable solo es true para editores (sin distinguir mayúsculas)", async () => {
  const { handler } = await inicializado();
  const res = await indice(handler, "ana");
  assert.equal(res.status, 200);
  cabecerasJson(res, "GET índice");
  const j = await res.json();
  assert.equal(j.yo, "ana");
  assert.equal(j.proyecto, "uuv");
  assert.equal(j.disciplina, "electronica");
  assert.equal(j.editable, false);
  assert.deepEqual(j.paginas, PLANTILLAS.electronica.map(({ slug, titulo }) => ({ slug, titulo })));
  assert.equal((await (await indice(handler, "EDI")).json()).editable, true);
});

test("403: un no editor no puede escribir (inicializar, crear, reordenar, restaurar, PUT, DELETE)", async () => {
  const { handler, redis } = await inicializado();
  const antes = JSON.stringify([...redis.data].filter(([k]) => !k.includes(":rl:")));
  const intentos = [
    () => post(handler, { accion: "inicializar" }, "ana"),
    () => post(handler, { accion: "crear", pagina: "nueva", titulo: "Nueva" }, "ana"),
    () => post(handler, { accion: "reordenar", orden: ["pcb", "potencia", "arquitectura"] }, "ana"),
    () => post(handler, { accion: "restaurar", pagina: "pcb", revision: 0, version: 1 }, "ana"),
    () => put(handler, { pagina: "pcb", md: "# hackeado", version: 1 }, "ana"),
    () => del(handler, { pagina: "pcb" }, "ana"),
  ];
  for (const f of intentos) {
    const res = await f();
    assert.equal(res.status, 403);
    cabecerasJson(res, "403");
  }
  // mecanica no tiene editores: nadie escribe ahí.
  assert.equal((await post(handler, { disciplina: "mecanica", accion: "inicializar" }, EDITOR)).status, 403);
  assert.equal(JSON.stringify([...redis.data].filter(([k]) => !k.includes(":rl:"))), antes, "nada cambió en el almacén");
});

test("escrituras: solo JSON (415) y mismo origen (403), como en comentarios", async () => {
  const { handler } = await montar();
  assert.equal((await post(handler, { accion: "inicializar" }, EDITOR, { ct: "text/plain" })).status, 415);
  assert.equal((await post(handler, { accion: "inicializar" }, EDITOR, { origin: null })).status, 403);
  assert.equal((await post(handler, { accion: "inicializar" }, EDITOR, { origin: "https://evil.example" })).status, 403);
  assert.equal((await handler(req("POST", { login: EDITOR, body: "{no json" }))).status, 400);
  assert.equal((await post(handler, { accion: "desconocida" })).status, 400);
});

// ---------- Inicializar, crear, reordenar ----------

test("inicializar siembra desde la plantilla y guarda el índice como JSON en hw:<proy>:<disc>:indice", async () => {
  const { handler, redis } = await inicializado();
  const crudo = redis.data.get("hw:uuv:electronica:indice");
  assert.equal(typeof crudo, "string", "el índice es un string JSON");
  assert.deepEqual(JSON.parse(crudo), PLANTILLAS.electronica.map(({ slug, titulo }) => ({ slug, titulo })));
  const h = redis.data.get("hw:pag:uuv:electronica:pcb");
  assert.ok(h instanceof Map, "cada página es un hash");
  assert.equal(h.get("titulo"), "PCB");
  assert.equal(h.get("md"), PLANTILLAS.electronica[2].md);
  assert.equal(h.get("autor"), EDITOR);
  assert.equal(Number(h.get("version")), 1);
  assert.equal(h.get("actualizado"), new Date(T0).toISOString());
});

test("inicializar es idempotente: la segunda vez responde 200 sin tocar índice ni contenido editado", async () => {
  const { handler, redis } = await inicializado();
  assert.equal((await put(handler, { pagina: "pcb", md: "# PCB editada", version: 1 })).status, 200);
  const indiceAntes = redis.data.get("hw:uuv:electronica:indice");
  const res = await post(handler, { accion: "inicializar" });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.inicializado, false);
  assert.equal(redis.data.get("hw:uuv:electronica:indice"), indiceAntes);
  const p = (await (await pagina(handler, "pcb")).json()).pagina;
  assert.equal(p.md, "# PCB editada");
  assert.equal(p.version, 2);
});

test("crear añade una página al final del índice (201); 409 si ya existe; slug inválido → 400", async () => {
  const { handler } = await inicializado();
  const res = await post(handler, { accion: "crear", pagina: "conectores-2", titulo: "Conectores" });
  assert.equal(res.status, 201);
  const j = await res.json();
  assert.equal(j.pagina.slug, "conectores-2");
  assert.equal(j.pagina.version, 1);
  const paginas = (await (await indice(handler)).json()).paginas;
  assert.deepEqual(paginas.at(-1), { slug: "conectores-2", titulo: "Conectores" });
  assert.equal((await post(handler, { accion: "crear", pagina: "pcb", titulo: "Otra" })).status, 409);
  for (const slug of ["", "Mayus", "con espacio", "../x", "a/b", "x".repeat(61), "ñandu", 5, null]) {
    assert.equal((await post(handler, { accion: "crear", pagina: slug, titulo: "T" })).status, 400, `slug ${JSON.stringify(slug)}`);
  }
  for (const titulo of ["", "   ", "x".repeat(121), "a\u0000b", 3]) {
    assert.equal((await post(handler, { accion: "crear", pagina: "valida", titulo })).status, 400, `titulo ${JSON.stringify(titulo)}`);
  }
});

test("slug de GET validado [a-z0-9-]{1,60}: inválido → 400; válido inexistente → 404", async () => {
  const { handler } = await inicializado();
  for (const slug of ["../pcb", "PCB", "a b", "x".repeat(61)]) assert.equal((await pagina(handler, slug)).status, 400, slug);
  assert.equal((await pagina(handler, "no-existe")).status, 404);
});

test("reordenar acepta solo una permutación exacta del índice actual", async () => {
  const { handler } = await inicializado();
  const res = await post(handler, { accion: "reordenar", orden: ["pcb", "arquitectura", "potencia"] });
  assert.equal(res.status, 200);
  assert.deepEqual((await (await indice(handler)).json()).paginas.map((p) => p.slug), ["pcb", "arquitectura", "potencia"]);
  for (const orden of [["pcb", "arquitectura"], ["pcb", "arquitectura", "potencia", "extra"], ["pcb", "pcb", "potencia"], "pcb", null]) {
    assert.equal((await post(handler, { accion: "reordenar", orden })).status, 400, JSON.stringify(orden));
  }
});

// ---------- GET de página: HTML sanitizado ----------

test("GET de página devuelve md, html, autor, actualizado y version (número)", async () => {
  const { handler } = await inicializado();
  const res = await pagina(handler, "potencia");
  assert.equal(res.status, 200);
  cabecerasJson(res, "GET página");
  const { pagina: p, editable } = await res.json();
  assert.equal(editable, false);
  assert.equal(p.slug, "potencia");
  assert.equal(p.titulo, "Potencia");
  assert.equal(p.md, PLANTILLAS.electronica[1].md);
  assert.match(p.html, /<h1[^>]*>Potencia<\/h1>/);
  assert.match(p.html, /<h2[^>]*>Baterías<\/h2>/);
  assert.equal(p.version, 1);
  assert.equal(p.autor, EDITOR);
});

test("html sanitizado: <script>, onerror, <iframe> y enlaces javascript: no llegan como HTML activo", async () => {
  const { handler } = await inicializado();
  const md = [
    "# Prueba",
    "",
    "<script>alert(1)</script>",
    "",
    '<img src=x onerror="alert(1)">',
    "",
    '<iframe src="https://evil.example"></iframe>',
    "",
    "[clic](javascript:alert(1)) [otro](JaVaScRiPt:alert(2)) [vb](vbscript:msgbox(1)) [dato](data:text/html,<b>x</b>)",
    "",
    "Texto con `<b>código</b>` y **negrita**.",
  ].join("\n");
  assert.equal((await put(handler, { pagina: "pcb", md, version: 1 })).status, 200);
  const { html } = (await (await pagina(handler, "pcb")).json()).pagina;
  assert.doesNotMatch(html, /<script/i, "sin etiqueta script");
  assert.doesNotMatch(html, /<img[^>]*onerror/i, "sin img con onerror");
  assert.doesNotMatch(html, /<iframe/i, "sin iframe");
  assert.doesNotMatch(html, /href\s*=\s*["']?\s*(javascript|vbscript|data):/i, "sin href peligroso");
  assert.match(html, /<strong>negrita<\/strong>/, "el Markdown normal sí se renderiza");
  assert.match(html, /<code>&lt;b&gt;código&lt;\/b&gt;<\/code>/, "el código en línea sale escapado");
});

test("renderizarMd reutiliza el pipeline de la wiki (neutralizeHtml de tools/neutralizar.mjs + satteri), sin reimplementarlo", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/hardware-core.mjs", import.meta.url), "utf8");
  assert.match(src, /from\s+["']\.\.\/tools\/neutralizar\.mjs["']/, "importa tools/neutralizar.mjs");
  assert.match(src, /neutralizeHtml/);
  assert.match(src, /from\s+["']satteri["']/, "renderiza con satteri");
  const { renderizarMd } = await core();
  assert.equal(typeof renderizarMd, "function");
  const html = await renderizarMd("## Hola\n\n<b>x</b>");
  assert.match(html, /<h2[^>]*>Hola<\/h2>/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
});

// ---------- PUT, versión y límites ----------

test("PUT guarda con la versión esperada: version+1, autor y fecha nuevos", async () => {
  let t = T0;
  const m = await montar({ ahora: () => t });
  await post(m.handler, { accion: "inicializar" });
  t = T0 + 60_000;
  const res = await put(m.handler, { pagina: "pcb", md: "# PCB\n\nCuatro capas.", version: 1 }, "Otra");
  assert.equal(res.status, 200);
  cabecerasJson(res, "PUT");
  const { pagina: p } = await res.json();
  assert.equal(p.version, 2);
  assert.equal(p.autor, "Otra");
  assert.equal(p.actualizado, new Date(t).toISOString());
  assert.match(p.html, /Cuatro capas/);
});

test("409 si la versión esperada no coincide; responde la versión actual y no pisa el contenido", async () => {
  const { handler } = await inicializado();
  assert.equal((await put(handler, { pagina: "pcb", md: "# v2", version: 1 })).status, 200);
  const res = await put(handler, { pagina: "pcb", md: "# pisado", version: 1 }, "Otra");
  assert.equal(res.status, 409);
  cabecerasJson(res, "409");
  const j = await res.json();
  assert.equal(typeof j.error, "string");
  assert.equal(j.version, 2);
  assert.equal((await (await pagina(handler, "pcb")).json()).pagina.md, "# v2");
  for (const version of [undefined, "1", 0, -1, 1.5, null]) {
    assert.equal((await put(handler, { pagina: "pcb", md: "# x", version })).status, 400, `version ${version}`);
  }
});

test("409 si hay otro guardado en curso (candado SET NX en hw:lock:<proy>:<disc>:<slug>) y el candado se libera al terminar", async () => {
  const { handler, redis } = await inicializado();
  await redis.exec([["SET", "hw:lock:uuv:electronica:pcb", "otro", "NX", "EX", 10]]);
  assert.equal((await put(handler, { pagina: "pcb", md: "# x", version: 1 })).status, 409);
  await redis.exec([["DEL", "hw:lock:uuv:electronica:pcb"]]);
  assert.equal((await put(handler, { pagina: "pcb", md: "# x", version: 1 })).status, 200);
  assert.ok(!redis.data.has("hw:lock:uuv:electronica:pcb"), "el candado no queda puesto");
  assert.ok(redis.comandos.some((c) => String(c[0]).toUpperCase() === "SET" && c[1] === "hw:lock:uuv:electronica:pcb" && c.map(String).map((s) => s.toUpperCase()).includes("NX")), "usa SET NX");
});

test("PUT: md > 200 KB → 413; md no string → 400; página inexistente → 404", async () => {
  const { handler } = await inicializado();
  const grande = "a".repeat(200 * 1024 + 1);
  assert.equal((await put(handler, { pagina: "pcb", md: grande, version: 1 })).status, 413);
  assert.equal((await put(handler, { pagina: "pcb", md: "é".repeat(102_401), version: 1 })).status, 413, "el límite es en bytes UTF-8");
  assert.equal((await put(handler, { pagina: "pcb", md: "a".repeat(200 * 1024), version: 1 })).status, 200, "justo 200 KB se acepta");
  assert.equal((await put(handler, { pagina: "pcb", md: 7, version: 2 })).status, 400);
  assert.equal((await put(handler, { pagina: "no-existe", md: "# x", version: 1 })).status, 404);
});

// ---------- Revisiones ----------

test("cada PUT guarda la versión anterior en hw:rev:<proy>:<disc>:<slug> (LPUSH) recortada a 50 (LTRIM)", async () => {
  const { handler, redis } = await inicializado();
  for (let v = 1; v <= 55; v++) {
    const res = await put(handler, { pagina: "pcb", md: `# v${v + 1}`, version: v });
    assert.equal(res.status, 200, `PUT ${v}`);
    await redis.exec([["DEL", "hw:rl:edi"]]);
  }
  const lista = redis.data.get("hw:rev:uuv:electronica:pcb");
  assert.ok(Array.isArray(lista), "las revisiones son una lista");
  assert.equal(lista.length, 50);
  assert.ok(redis.comandos.some((c) => String(c[0]).toUpperCase() === "LTRIM" && c[1] === "hw:rev:uuv:electronica:pcb"), "recorta con LTRIM");
  const res = await pagina(handler, "pcb", "ana", { revisiones: "1" });
  assert.equal(res.status, 200);
  cabecerasJson(res, "revisiones");
  const { revisiones } = await res.json();
  assert.equal(revisiones.length, 50);
  assert.deepEqual(revisiones.map((r) => r.n), [...Array(50).keys()], "n = 0 es la más reciente");
  assert.equal(revisiones[0].version, 55, "la más reciente es la versión anterior a la actual (56)");
  assert.equal(revisiones[49].version, 6);
  for (const r of revisiones) {
    assert.equal(typeof r.autor, "string");
    assert.equal(typeof r.actualizado, "string");
    assert.equal(typeof r.titulo, "string");
  }
});

test("restaurar revision n: el md vuelve, la versión sube y el estado anterior pasa a revisiones", async () => {
  const { handler } = await inicializado();
  await put(handler, { pagina: "pcb", md: "# buena", version: 1 });
  await put(handler, { pagina: "pcb", md: "# rota", version: 2 });
  // revisiones: n=0 → "# buena" (v2), n=1 → plantilla (v1)
  const res = await post(handler, { accion: "restaurar", pagina: "pcb", revision: 0, version: 3 });
  assert.equal(res.status, 200);
  const { pagina: p } = await res.json();
  assert.equal(p.md, "# buena");
  assert.equal(p.version, 4);
  const revs = (await (await pagina(handler, "pcb", "ana", { revisiones: "1" })).json()).revisiones;
  assert.equal(revs[0].version, 3, "la versión rota quedó guardada como revisión");
  assert.equal((await post(handler, { accion: "restaurar", pagina: "pcb", revision: 1, version: 3 })).status, 409, "versión vieja → 409");
  assert.equal((await post(handler, { accion: "restaurar", pagina: "pcb", revision: 99, version: 4 })).status, 404, "revisión inexistente");
  for (const revision of [-1, "0", 1.5, null]) {
    assert.equal((await post(handler, { accion: "restaurar", pagina: "pcb", revision, version: 4 })).status, 400, `revision ${revision}`);
  }
});

// ---------- DELETE → papelera ----------

test("DELETE manda la página a la papelera hw:papelera:<proy>:<disc>: sale del índice y GET da 404", async () => {
  const { handler, redis } = await inicializado();
  await put(handler, { pagina: "pcb", md: "# a la papelera", version: 1 });
  const res = await del(handler, { pagina: "pcb" });
  assert.equal(res.status, 200);
  cabecerasJson(res, "DELETE");
  assert.deepEqual((await (await indice(handler)).json()).paginas.map((p) => p.slug), ["arquitectura", "potencia"]);
  assert.equal((await pagina(handler, "pcb")).status, 404);
  assert.ok(!redis.data.has("hw:pag:uuv:electronica:pcb"), "el hash de la página ya no está");
  const papelera = redis.data.get("hw:papelera:uuv:electronica");
  assert.ok(papelera instanceof Map, "la papelera es un hash slug → JSON");
  const guardada = JSON.parse(papelera.get("pcb"));
  assert.equal(guardada.md, "# a la papelera");
  assert.equal(guardada.borradoPor, EDITOR);
  assert.equal((await del(handler, { pagina: "pcb" })).status, 404, "borrar dos veces → 404");
});

// ---------- Límite de tasa ----------

test("límite de tasa igual que comentarios: 10 escrituras por minuto y la 11.ª → 429 con Retry-After; las lecturas no cuentan", async () => {
  const { handler } = await inicializado();
  for (let i = 0; i < 5; i++) assert.equal((await indice(handler, EDITOR)).status, 200);
  let v = 1;
  for (let i = 0; i < 9; i++) assert.equal((await put(handler, { pagina: "pcb", md: `# ${i}`, version: v++ })).status, 200, `escritura ${i + 2}`);
  const res = await put(handler, { pagina: "pcb", md: "# 11", version: v });
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get("retry-after")) > 0);
});

// ---------- Módulo compartido (sin duplicar el cliente Redis ni la sesión) ----------

test("hardware-core no duplica clienteRedis ni la verificación de sesión: los toma de un módulo compartido", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/hardware-core.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\/pipeline/, "sin otra copia del cliente REST de Upstash");
  assert.doesNotMatch(src, /createHmac|crypto\.subtle/, "sin otra verificación HMAC");
  const com = await import("../lib/comentarios-core.mjs");
  const comun = await import("../lib/api-comun.mjs");
  assert.equal(typeof comun.clienteRedis, "function");
  assert.equal(com.clienteRedis, comun.clienteRedis, "comentarios-core reexporta el mismo clienteRedis");
});

test("api/hardware.js delega en lib/hardware-core.mjs con projects.json y las plantillas importadas como JSON", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../api/hardware.js", import.meta.url), "utf8");
  assert.match(src, /from\s+["']\.\.\/lib\/hardware-core\.mjs["']/);
  assert.match(src, /projects\.json["']\s+with\s+\{\s*type:\s*["']json["']\s*\}/);
  assert.match(src, /plantillas\/electronica\.json["']\s+with/);
  assert.match(src, /plantillas\/mecanica\.json["']\s+with/);
  for (const m of ["GET", "POST", "PUT", "DELETE"]) assert.match(src, new RegExp(`export const ${m}\\b`));
});
