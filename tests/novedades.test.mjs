// Página "Novedades" y "actualizado hace N días" (src/lib/novedades.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { novedades, haceDias } from "../src/lib/novedades.ts";

const page = (path, title, updated, extra = {}) => ({
  path,
  route: `/uuv/${path.replace(/\.md$/, "")}/`,
  title,
  description: "",
  type: "page",
  owner: "",
  claims: 0,
  updated,
  author: "Ana",
  commit: null,
  ...extra,
});

const PAGES = [
  page("a.md", "Alfa", "2026-10-20T10:00:00-06:00", { commit: "aaa111" }),
  // Gamma (20:00 del 20 en Monterrey = 02:00Z del 21) es más nueva que Beta (01:00Z del 21), aunque como texto ordene después.
  page("b.md", "Beta", "2026-10-21T01:00:00Z"),
  page("c.md", "Gamma", "2026-10-20T20:00:00-06:00", { commit: "ccc333", author: "Luis" }),
  page("d.md", "Delta", null),
  page("INSTRUCTIONS.md", "Instrucciones", "2026-10-28T00:00:00Z", { type: "meta" }),
  page("e.md", "Épsilon", "2026-10-20T10:00:00-06:00"),
];

test("novedades: más recientes primero comparando fechas reales (no texto), sin meta ni páginas sin fecha", () => {
  assert.deepEqual(
    novedades(PAGES, "https://github.com/o/r").map((x) => x.title),
    ["Gamma", "Beta", "Alfa", "Épsilon"],
  );
});

test("novedades: empate de fecha por título; respeta el límite", () => {
  assert.deepEqual(novedades(PAGES, "https://github.com/o/r", 2).map((x) => x.title), ["Gamma", "Beta"]);
});

test("novedades: cada entrada trae ruta, autor y enlace al commit cuando lo hay", () => {
  const [gamma, , , epsilon] = novedades(PAGES, "https://github.com/o/r");
  assert.deepEqual(gamma, {
    route: "/uuv/c/",
    title: "Gamma",
    updated: "2026-10-20T20:00:00-06:00",
    author: "Luis",
    commit: "ccc333",
    commitUrl: "https://github.com/o/r/commit/ccc333",
  });
  assert.equal(epsilon.commitUrl, null);
});

test("haceDias: hoy, ayer, hace N días", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(haceDias("2026-10-29T08:00:00Z", now), "hoy");
  assert.equal(haceDias("2026-10-28T11:00:00Z", now), "ayer");
  assert.equal(haceDias("2026-10-23T12:00:00Z", now), "hace 6 días");
  assert.equal(haceDias("2025-10-29T12:00:00Z", now.getTime()), "hace 365 días");
});

test("haceDias: fecha futura (reloj desfasado) cuenta como hoy; vacía o inválida da ''", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  assert.equal(haceDias("2026-10-30T12:00:00Z", now), "hoy");
  assert.equal(haceDias(null, now), "");
  assert.equal(haceDias("no-es-fecha", now), "");
});
