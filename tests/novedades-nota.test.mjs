// Aviso opcional arriba de /<id>/novedades/ (projects.json → novedadesNota).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const NOTA = "Por ahora este repo es una copia de prueba del original, así que todos los cambios aparecen con el mismo autor.";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("projects.json: uuv y proyecto-x llevan novedadesNota con el texto acordado", () => {
  const projects = JSON.parse(read("projects.json"));
  for (const id of ["uuv", "proyecto-x"]) assert.equal(projects.find((p) => p.id === id)?.novedadesNota, NOTA, id);
});

test("novedades.astro muestra p.novedadesNota (solo si existe) antes de la lista", () => {
  const src = read("src/pages/[project]/novedades.astro");
  assert.match(src, /p\.novedadesNota\s*&&/);
  assert.ok(src.indexOf("novedadesNota") < src.indexOf('class="novedades"'), "el aviso va arriba de la lista");
  assert.match(read("src/lib/data.ts"), /novedadesNota\?:\s*string/);
});
