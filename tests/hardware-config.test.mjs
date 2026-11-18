// Lote 1a: configuración de disciplinas (projects.json + data.ts), plantillas y README. Desde el lote "quitar Vercel",
// el login del Worker no tiene ninguna excepción sin sesión en /api/archivos (ya no hay callback de Vercel Blob).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { crearWorker } from "../worker/index.mjs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const SLUG = /^[a-z0-9-]{1,60}$/;

const ELECTRONICA = ["arquitectura", "potencia", "esquematicos", "pcb", "cableado", "pinout", "sensores-actuadores", "bom", "pruebas", "problemas"];
const MECANICA = ["ensamble", "subensambles", "piezas-planos", "materiales", "sellado", "hidrodinamica", "bom", "montaje", "mantenimiento"];

test("plantillas/electronica.json y plantillas/mecanica.json: lista ordenada {slug, titulo, md} con los slugs pedidos", () => {
  for (const [nombre, slugs] of [["electronica", ELECTRONICA], ["mecanica", MECANICA]]) {
    const ruta = `plantillas/${nombre}.json`;
    assert.ok(existsSync(new URL(`../${ruta}`, import.meta.url)), ruta);
    const lista = JSON.parse(leer(ruta));
    assert.ok(Array.isArray(lista), `${ruta} es una lista`);
    assert.deepEqual(lista.map((p) => p.slug), slugs, `${ruta}: orden de slugs`);
    for (const p of lista) {
      assert.deepEqual(Object.keys(p).sort(), ["md", "slug", "titulo"], `${ruta}:${p.slug} solo slug/titulo/md`);
      assert.match(p.slug, SLUG);
      assert.ok(typeof p.titulo === "string" && p.titulo.trim().length > 0 && p.titulo.length <= 120, `${p.slug}: título`);
      assert.ok(typeof p.md === "string", `${p.slug}: md`);
      assert.match(p.md, /^# .+/m, `${p.slug}: md empieza con un H1`);
      assert.match(p.md, /^## .+/m, `${p.slug}: md trae encabezados guía (##)`);
      assert.doesNotMatch(p.md, /</, `${p.slug}: sin HTML`);
    }
  }
});

test("projects.json: uuv tiene disciplinas electronica y mecanica con plantilla existente y editores ['cyuxSz']; secciones intacta", () => {
  const proyectos = JSON.parse(leer("projects.json"));
  const uuv = proyectos.find((p) => p.id === "uuv");
  assert.ok(uuv.disciplinas, "uuv.disciplinas");
  assert.deepEqual(Object.keys(uuv.disciplinas).sort(), ["electronica", "mecanica"]);
  for (const [disc, conf] of Object.entries(uuv.disciplinas)) {
    assert.equal(conf.plantilla, disc);
    assert.ok(existsSync(new URL(`../plantillas/${conf.plantilla}.json`, import.meta.url)), `plantilla de ${disc}`);
    assert.deepEqual(conf.editores, ["cyuxSz"]);
  }
  assert.ok(uuv.secciones?.vision?.tour?.length, "la clave secciones (del grafo) sigue igual");
  assert.ok(!("electronica" in (uuv.secciones ?? {})) && !("mecanica" in (uuv.secciones ?? {})), "no se reutiliza secciones");
  for (const p of proyectos) {
    if (!p.disciplinas) continue;
    for (const [disc, conf] of Object.entries(p.disciplinas)) {
      assert.match(disc, /^[a-z0-9-]{1,30}$/, `${p.id}: disciplina ${disc}`);
      assert.ok(Array.isArray(conf.editores) && conf.editores.every((e) => typeof e === "string"), `${p.id}.${disc}.editores`);
    }
  }
});

test("src/lib/data.ts: ProjectSummary tiene disciplinas opcional tipada (plantilla y editores)", () => {
  const src = leer("src/lib/data.ts");
  const m = src.match(/export interface ProjectSummary \{([\s\S]*?)\n\}/);
  assert.ok(m, "interface ProjectSummary");
  assert.match(m[1], /disciplinas\?:\s*Record<string,\s*\{[^}]*plantilla:\s*string;?[^}]*editores:\s*string\[\];?[^}]*\}>/);
});

// ---------- login: sin excepciones sin sesión en /api ----------

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});
const ENV = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, ALLOWED_ORG: "vanttec", ALLOWED_USERS: "" };
async function middleware(request) {
  let paso = false;
  const ASSETS = { fetch: async () => ((paso = true), new Response("asset")) };
  const res = await crearWorker().fetch(request, { ...ENV, ASSETS }, { waitUntil() {}, passThroughOnException() {} });
  res.paso = paso;
  return res;
}
const pasa = (res) => res.paso === true;

test("worker: sin sesión todo /api responde 401, también POST /api/archivos con x-vercel-signature (sin excepción)", async () => {
  const casos = [
    ["POST", "/api/archivos/", { "x-vercel-signature": "abc", "content-type": "application/json" }],
    ["POST", "/api/archivos", { "x-vercel-signature": "abc", "content-type": "application/json" }],
    ["POST", "/api/archivos/", {}],
    ["GET", "/api/archivos/", { "x-vercel-signature": "abc" }],
    ["DELETE", "/api/archivos/", { "x-vercel-signature": "abc" }],
    ["POST", "/api/hardware/", { "x-vercel-signature": "abc" }],
    ["POST", "/api/comentarios/", { "x-vercel-signature": "abc" }],
    ["POST", "/api/archivos/otra/", { "x-vercel-signature": "abc" }],
    ["POST", "/api/archivosx/", { "x-vercel-signature": "abc" }],
  ];
  for (const [method, path, headers] of casos) {
    const res = await middleware(new Request(`${ORIGIN}${path}`, { method, headers, body: method === "GET" ? undefined : "{}" }));
    assert.equal(res.status, 401, `${method} ${path} ${JSON.stringify(headers)}`);
    assert.ok(!pasa(res));
  }
});

// ---------- README ----------

test("README explica dónde van los archivos: R2 `ARCHIVOS` (docs-hardware), sin Vercel Blob", () => {
  const src = leer("README.md");
  assert.match(src, /`ARCHIVOS`/);
  assert.match(src, /docs-hardware/);
  assert.doesNotMatch(src, /Vercel Blob/);
  assert.doesNotMatch(src, /BLOB_READ_WRITE_TOKEN/);
  assert.match(src, /disciplinas/);
});
