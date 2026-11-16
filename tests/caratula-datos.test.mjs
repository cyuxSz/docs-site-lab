// Carátula: nombre corto, repositorio y descripción derivados de los datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const data = () => import("../src/lib/data.ts");
const INDEX = "src/pages/[project]/index.astro";

test("nombreCorto: parte antes de « · »; sin separador, el nombre entero", async () => {
  const { nombreCorto } = await data();
  assert.equal(nombreCorto("UUV · uuv_software"), "UUV");
  assert.equal(nombreCorto("Proyecto Demo"), "Proyecto Demo");
});

test("nombreRepo: parte tras « · » o null", async () => {
  const { nombreRepo } = await data();
  assert.equal(nombreRepo("UUV · uuv_software"), "uuv_software");
  assert.equal(nombreRepo("Proyecto Demo"), null);
});

test("projects.json: descripcionCaratula es texto y la de uuv no lleva año", () => {
  const proyectos = JSON.parse(read("projects.json"));
  for (const p of proyectos) {
    if (p.descripcionCaratula !== undefined) assert.ok(typeof p.descripcionCaratula === "string" && p.descripcionCaratula.length > 0, p.id);
  }
  const uuv = proyectos.find((p) => p.id === "uuv");
  assert.match(uuv.descripcionCaratula, /para RoboSub: chasis tipo costillar/);
  assert.ok(!Object.hasOwn(uuv, "sitioOficial"), "sitioOficial ya no existe");
});

test("carátula: h1 corto, repositorio y nota en la tarjeta Software, sin la sección «¿Por qué aquí?»", () => {
  const s = read(INDEX);
  assert.match(s, /<h1>\{corto\}<\/h1>/);
  assert.match(s, /p\.descripcionCaratula \?\? p\.summary/);
  assert.match(s, /Repositorio <code>\{repoNombre\}<\/code>/);
  const hero = s.slice(s.indexOf('class="hero phero"'), s.indexOf("</section>", s.indexOf('class="hero phero"')));
  assert.doesNotMatch(hero, /p\.note/, "la nota ya no va en el encabezado");
  assert.doesNotMatch(s, /sitioOficial|Por qué aquí/);
  assert.doesNotMatch(s, /vanttec\.com|UUV/, "nada de nombres hardcodeados en la plantilla");
});
