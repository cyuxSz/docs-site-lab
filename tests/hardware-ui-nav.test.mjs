// Lote 1b: pestañas Electrónica y Mecánica (projectNav en src/lib/data.ts y .ptabs en Base.astro), solo para
// disciplinas configuradas en projects.json, sin exponer la lista de editores en el HTML.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { projectNav } from "../src/lib/data.ts";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const base = (extra = {}) => ({
  id: "uuv",
  name: "UUV",
  summary: "",
  repo: "x/y",
  branch: "main",
  lastUpdate: null,
  pageList: [],
  diagramList: [],
  links: [],
  ros: null,
  ...extra,
});

test("projectNav: disciplinas configuradas → [{id, etiqueta, href}] en orden Electrónica, Mecánica", () => {
  const nav = projectNav(base({ disciplinas: { mecanica: { plantilla: "mecanica", editores: ["cyuxSz"] }, electronica: { plantilla: "electronica", editores: ["cyuxSz"] } } }));
  assert.deepEqual(nav.disciplinas, [
    { id: "electronica", etiqueta: "Electrónica", href: "/uuv/electronica/" },
    { id: "mecanica", etiqueta: "Mecánica", href: "/uuv/mecanica/" },
  ]);
});

test("projectNav: solo las disciplinas que existan; sin disciplinas → lista vacía", () => {
  assert.deepEqual(projectNav(base({ disciplinas: { mecanica: { plantilla: "mecanica", editores: [] } } })).disciplinas, [{ id: "mecanica", etiqueta: "Mecánica", href: "/uuv/mecanica/" }]);
  assert.deepEqual(projectNav(base()).disciplinas, []);
});

test("projectNav: nunca expone editores ni plantillas (van al HTML)", () => {
  const nav = projectNav(base({ disciplinas: { electronica: { plantilla: "electronica", editores: ["cyuxSz", "otra-persona"] } } }));
  const json = JSON.stringify(nav);
  assert.doesNotMatch(json, /editores|cyuxSz|otra-persona|plantilla/);
});

test("projectNav: las pestañas de software no cambian (wiki, diagramas, repoUrl)", () => {
  const nav = projectNav(base({ repoUrl: "https://github.com/x/y", diagramList: [{ file: "a.html", title: "A", kb: 1 }], pageList: [{ path: "quickstart.md", route: "/uuv/quickstart/", title: "Q", description: "", type: "guide", owner: "", claims: 0, updated: null, author: null }] }));
  assert.equal(nav.wiki, "/uuv/quickstart/");
  assert.equal(nav.diagrams, true);
  assert.equal(nav.repoUrl, "https://github.com/x/y");
});

// Lote carátula: Electrónica y Mecánica salen de .ptabs; se llega desde la carátula y tienen su cabecera (.phead).
test("Base.astro: current admite electronica y mecanica; .ptabs ya no pinta disciplinas y .phead marca la actual", () => {
  const src = leer("src/layouts/Base.astro");
  const m = src.match(/current\?:\s*([^;\n]+)/);
  assert.ok(m, "prop current");
  for (const v of ["resumen", "wiki", "grafo", "electronica", "mecanica"]) assert.match(m[1], new RegExp(`"${v}"`), `current incluye "${v}"`);
  assert.match(src, /disciplinas\?:\s*\{\s*id:\s*string;\s*etiqueta:\s*string;\s*href:\s*string;?\s*\}\[\]/, "Props.project.disciplinas tipado");
  const tabs = src.match(/<nav class="ptabs"[^]*?<\/nav>/)?.[0] ?? "";
  assert.doesNotMatch(tabs, /project\.disciplinas/);
  const head = src.match(/<nav class="phead"[^]*?<\/nav>/)?.[0] ?? "";
  assert.match(head, /project\.disciplinas\?\.find\(/);
  assert.match(head, /aria-current="page"/);
});

test("projects.json: ninguna disciplina choca con rutas fijas de /<proyecto>/", () => {
  const RESERVADAS = ["software", "grafo", "limpieza", "novedades", "comentarios", "content", "arch", "rutas"];
  for (const p of JSON.parse(leer("projects.json"))) {
    for (const d of Object.keys(p.disciplinas ?? {})) assert.ok(!RESERVADAS.includes(d), `${p.id}: ${d} es una ruta reservada`);
  }
});
