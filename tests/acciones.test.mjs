// "Editar en GitHub" y "Reportar un error" (src/lib/acciones.ts): URLs prellenadas, sin datos personales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { urlEditar, urlReportar } from "../src/lib/acciones.ts";

const PAGE = { title: "uuv_control", route: "/uuv/packages/uuv_control/", path: "packages/uuv_control.md" };

test("urlEditar: abre el editor de GitHub en la rama (no en el commit) dentro de openwiki/", () => {
  assert.equal(urlEditar("o/r", "main", "packages/uuv_control.md"), "https://github.com/o/r/edit/main/openwiki/packages/uuv_control.md");
});

test("urlReportar: issue nuevo con título y cuerpo prellenados", () => {
  const u = new URL(urlReportar("o/r", PAGE));
  assert.equal(u.origin + u.pathname, "https://github.com/o/r/issues/new");
  assert.equal(u.searchParams.get("title"), "Error en la wiki: uuv_control");
  const body = u.searchParams.get("body");
  assert.match(body, /\/uuv\/packages\/uuv_control\//);
  assert.match(body, /openwiki\/packages\/uuv_control\.md/);
});

test("urlReportar: cita el texto seleccionado línea por línea y lo recorta a 500 caracteres", () => {
  const body = new URL(urlReportar("o/r", PAGE, "línea uno\nlínea dos")).searchParams.get("body");
  assert.match(body, /> línea uno\n> línea dos/);
  const long = new URL(urlReportar("o/r", PAGE, "x".repeat(2000))).searchParams.get("body");
  assert.ok(long.includes(`> ${"x".repeat(500)}…`));
  assert.ok(!long.includes("x".repeat(501)));
});

test("urlReportar: sin selección no agrega cita; nunca incluye usuario ni origen del sitio", () => {
  const body = new URL(urlReportar("o/r", PAGE, "   ")).searchParams.get("body");
  assert.ok(!body.includes(">"));
  assert.ok(!/@|vercel\.app|https?:\/\/(?!github\.com)/.test(body), body);
});
