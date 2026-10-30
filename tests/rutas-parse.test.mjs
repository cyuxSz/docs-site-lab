// Rutas por rol: parser de openwiki/rutas.md (tools/rutas.mjs) que usa tools/fetch.mjs para data/<id>.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRutas, slugRol } from "../tools/rutas.mjs";
import { RUTAS_MD, PAGES } from "./fixtures/rutas-mini.mjs";

const { rutas, avisos } = parseRutas(RUTAS_MD, { project: "uuv", pages: PAGES });
const ruta = (id) => rutas.find((r) => r.id === id);

test("slugRol: id ASCII en minúsculas, sin acentos y con guiones", () => {
  assert.equal(slugRol("Visión"), "vision");
  assert.equal(slugRol("Electrónica"), "electronica");
  assert.equal(slugRol("Software y CI/CD"), "software-y-ci-cd");
  assert.match(slugRol("Ñandú Árbol"), /^[a-z0-9-]+$/);
});

test("parseRutas: cada ## es un rol, en orden; la lista antes del primer ## se ignora; roles sin pasos válidos no salen", () => {
  assert.deepEqual(
    rutas.map((r) => [r.id, r.nombre]),
    [
      ["software", "Software"],
      ["vision", "Visión"],
      ["electronica", "Electrónica"],
    ],
  );
});

test("parseRutas: cada paso trae route del portal (con ancla), page (.md de la wiki), title y nota", () => {
  assert.deepEqual(ruta("software").pasos, [
    { route: "/uuv/quickstart/", page: "quickstart.md", title: "Quickstart", nota: "qué configuraciones existen." },
    { route: "/uuv/architecture/overview/", page: "architecture/overview.md", title: "Visión general", nota: "el lazo misión → control → motores." },
    { route: "/uuv/discrepancias/", page: "discrepancias/index.md", title: "Discrepancias", nota: "dónde no coinciden." },
  ]);
  assert.deepEqual(ruta("vision").pasos[1], {
    route: "/uuv/architecture/topics/#cámara-y-visión",
    page: "architecture/topics.md",
    title: "Topics y servicios",
    nota: "cómo la misión le pide datos a la visión.",
  });
});

test("parseRutas: la misma página puede repetirse con anclas distintas; una carpeta/ va a su index.md", () => {
  assert.deepEqual(
    ruta("electronica").pasos.map((p) => [p.page, p.route]),
    [
      ["operations/hardware.md", "/uuv/operations/hardware/"],
      ["operations/hardware.md", "/uuv/operations/hardware/#probar-motores"],
      ["packages/index.md", "/uuv/packages/"],
    ],
  );
});

test("parseRutas: ignora enlaces externos, páginas inexistentes, rutas fuera de openwiki/ y pasos sin enlace, con un aviso por cada uno", () => {
  assert.equal(ruta("vision").pasos.length, 3);
  for (const t of ["Blog externo", "Página fantasma", "Fuera", "Nada"]) {
    assert.ok(avisos.some((a) => a.includes(t)), `falta aviso para "${t}": ${JSON.stringify(avisos)}`);
  }
  assert.ok(avisos.some((a) => a.includes("sin enlace")), "falta aviso para el paso sin enlace");
  assert.ok(avisos.some((a) => a.includes("Vacío")), "falta aviso del rol sin pasos válidos");
  for (const a of avisos) assert.equal(typeof a, "string");
});

test("parseRutas: texto sin ## ni listas → rutas vacías y sin avisos", () => {
  assert.deepEqual(parseRutas("# Rutas\n\nNada todavía.", { project: "uuv", pages: PAGES }), { rutas: [], avisos: [] });
});

test("fetch.mjs usa parseRutas solo si existe openwiki/rutas.md y solo escribe `rutas` si hay alguna", () => {
  const src = readFileSync(new URL("../tools/fetch.mjs", import.meta.url), "utf8");
  assert.match(src, /import\s*\{[^}]*parseRutas[^}]*\}\s*from\s*"\.\/rutas\.mjs"/);
  assert.match(src, /rutas\.md/);
  assert.match(src, /console\.warn/, "los avisos de pasos ignorados van a la consola del build");
  assert.match(src, /rutas\.length\s*\?/, "la clave rutas solo se agrega a data/<id>.json si hay rutas");
});
