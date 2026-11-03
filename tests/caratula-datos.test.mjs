// Carátula: nombre corto, repositorio, sitio oficial (solo https) y texto «¿Por qué aquí…?» derivados de los datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const data = () => import("../src/lib/data.ts");
const INDEX = "src/pages/[project]/index.astro";

test("nombreCorto: parte antes de « · »; sin separador, el nombre entero", async () => {
  const { nombreCorto } = await data();
  assert.equal(nombreCorto("UUV · uuv_software"), "UUV");
  assert.equal(nombreCorto("Proyecto X"), "Proyecto X");
});

test("nombreRepo: parte tras « · » o null", async () => {
  const { nombreRepo } = await data();
  assert.equal(nombreRepo("UUV · uuv_software"), "uuv_software");
  assert.equal(nombreRepo("Proyecto X"), null);
});

test("sitioOficial: solo https; el host sale sin www.", async () => {
  const { sitioOficial } = await data();
  assert.deepEqual(sitioOficial("https://www.vanttec.com/#/uuv"), { href: "https://www.vanttec.com/#/uuv", host: "vanttec.com" });
  for (const u of ["http://vanttec.com", "javascript:alert(1)", "//vanttec.com", "vanttec.com", "", undefined, 3]) assert.equal(sitioOficial(u), null, String(u));
});

test("projects.json: sitioOficial es https y descripcionCaratula es texto", () => {
  for (const p of JSON.parse(read("projects.json"))) {
    if (p.sitioOficial !== undefined) assert.match(p.sitioOficial, /^https:\/\//, `${p.id}: sitioOficial`);
    if (p.descripcionCaratula !== undefined) assert.ok(typeof p.descripcionCaratula === "string" && p.descripcionCaratula.length > 0, p.id);
  }
  const uuv = JSON.parse(read("projects.json")).find((p) => p.id === "uuv");
  assert.equal(uuv.sitioOficial, "https://www.vanttec.com/#/uuv");
});

test("carátula: h1 corto, repositorio y nota en la tarjeta Software, sección del sitio oficial genérica", () => {
  const s = read(INDEX);
  assert.match(s, /<h1>\{corto\}<\/h1>/);
  assert.match(s, /p\.descripcionCaratula \?\? p\.summary/);
  assert.match(s, /Repositorio <code>\{repoNombre\}<\/code>/);
  const hero = s.slice(s.indexOf('class="hero phero"'), s.indexOf("</section>", s.indexOf('class="hero phero"')));
  assert.doesNotMatch(hero, /p\.note/, "la nota ya no va en el encabezado");
  assert.match(s, /\{sitio && \(/);
  assert.match(s, /¿Por qué aquí y no en \{sitio\.host\}\?/);
  assert.match(s, /href=\{sitio\.href\} rel="noopener"/);
  assert.doesNotMatch(s, /vanttec\.com|UUV/, "nada de nombres hardcodeados en la plantilla");
});
