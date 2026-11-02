// Arreglos de revisión (PR #34): nombre truncado, límite de cuerpo en streaming, Guardar con subidas, atajos y servidor de prueba.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sanearNombre, extension, TIPOS } from "../lib/archivos-nombre.mjs";
import { leerCuerpo } from "../lib/api-comun.mjs";
import { estadoGuardar, resultadoGuardado, resultadoBorrado, AVISO_SUBIDAS, mensajeError } from "../src/lib/hardware-editor.ts";
import { atajo } from "../src/lib/atajos.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("sanearNombre: al truncar no convierte un .png intermedio en la extensión", () => {
  const s = sanearNombre(`${"a".repeat(96)}.png.${"evil".repeat(10)}`);
  assert.ok(s.length <= 100);
  const ext = extension(s);
  assert.ok(ext === null || !Object.hasOwn(TIPOS, ext), `extensión inesperada: ${ext}`);
});

test("sanearNombre: la extensión final real se conserva al truncar", () => {
  const s = sanearNombre(`${"b".repeat(150)}.png`);
  assert.equal(s.length, 100);
  assert.equal(extension(s), "png");
});

test("leerCuerpo: el límite se aplica mientras se lee el stream (sin Content-Length)", async () => {
  let leidos = 0;
  const stream = new ReadableStream({
    pull(c) {
      leidos++;
      c.enqueue(new Uint8Array(1024));
      if (leidos > 1000) c.close();
    },
  });
  const req = new Request("http://x/", { method: "POST", body: stream, duplex: "half" });
  await assert.rejects(leerCuerpo(req, 4096), (e) => e.status === 413);
  assert.ok(leidos < 100, `se siguió leyendo tras pasar el límite (${leidos} trozos)`);
});

test("leerCuerpo: un cuerpo dentro del límite sigue funcionando", async () => {
  const req = new Request("http://x/", { method: "POST", body: JSON.stringify({ a: "ñ" }) });
  assert.deepEqual(await leerCuerpo(req, 100), { a: "ñ" });
});

test("estadoGuardar: deshabilitado con subidas activas y con aviso", () => {
  assert.deepEqual(estadoGuardar(0, false), { deshabilitado: false, aviso: "" });
  assert.deepEqual(estadoGuardar(2, false), { deshabilitado: true, aviso: "Espera a que terminen las subidas" });
  assert.equal(AVISO_SUBIDAS, "Espera a que terminen las subidas");
  assert.equal(estadoGuardar(0, true).deshabilitado, true);
});

test("resultadoGuardado: ante 409 se conserva el texto y se da el mensaje de conflicto", () => {
  const r = resultadoGuardado(409);
  assert.equal(r.conservarTexto, true);
  assert.equal(r.mensaje, mensajeError(409));
  assert.match(r.mensaje, /Alguien cambió la página/);
  assert.deepEqual(resultadoGuardado(200), { conservarTexto: false, mensaje: "" });
  assert.equal(resultadoGuardado(0).mensaje, mensajeError("red"));
});

test("scripts/hardware-editor.ts: usa el estado de Guardar y la vista previa lleva el título", () => {
  const js = read("src/scripts/hardware-editor.ts");
  assert.match(js, /estadoGuardar\(/);
  assert.match(js, /pintarHtml\(previa,\s*r\.json\.html,\s*pagina\?\.titulo\)/);
});

const t = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, escribiendo: false, dialogoAbierto: false, t: 1000, ...extra });

test("atajo: una repetición con editor o diálogo descarta la g pendiente", () => {
  assert.equal(atajo(900, t("g", { repetida: true, escribiendo: true })).pendiente, null);
  assert.equal(atajo(900, t("g", { repetida: true, dialogoAbierto: true })).pendiente, null);
  assert.equal(atajo(900, t("g", { repetida: true })).pendiente, 900, "sin contexto se conserva");
});

test("Base.astro: solo se desplaza .ptabs en horizontal", () => {
  const b = read("src/layouts/Base.astro");
  assert.doesNotMatch(b, /\.ptabs a\[aria-current\]"\)\?\.scrollIntoView/);
  assert.match(b, /scrollLeft/);
  assert.match(b, /prefers-reduced-motion/);
});

test("servidor-hardware: aplica por pathname todas las reglas de cabeceras (CSP sandbox de /arch/)", () => {
  const src = read("tests/fixtures/servidor-hardware.mjs");
  assert.match(src, /cabecerasDe\(url\.pathname\)/);
  assert.doesNotMatch(src, /\.headers \?\? \[\]\)\[0\]/);
});

test("resultadoBorrado: 409 da su mensaje y no quita nada del índice; otros errores usan el habitual", () => {
  assert.deepEqual(resultadoBorrado(200), { quitarDelIndice: true, mensaje: "" });
  assert.deepEqual(resultadoBorrado(409), { quitarDelIndice: false, mensaje: "Alguien cambió la página; recárgala antes de borrar" });
  assert.deepEqual(resultadoBorrado(403), { quitarDelIndice: false, mensaje: mensajeError(403) });
  assert.equal(resultadoBorrado(0).mensaje, mensajeError("red"));
});
