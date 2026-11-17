// C2a: hallazgos de la revisión del PR #49.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resultadoBorrado, mensajeRespuesta, MENSAJE_CANDADO, mensajeError } from "../src/lib/hardware-editor.ts";

const js = readFileSync(new URL("../src/scripts/hardware-editor.ts", import.meta.url), "utf8");

test("mensajeRespuesta: el 409 por candado usa MENSAJE_CANDADO en cualquier acción; el de versión, el de siempre", () => {
  assert.equal(mensajeRespuesta(409, { json: { codigo: "candado" } }), MENSAJE_CANDADO);
  assert.equal(mensajeRespuesta(409, { json: { codigo: "version" } }), mensajeError(409));
  assert.equal(mensajeRespuesta(0, { fallo: "timeout" }), mensajeError("timeout"));
});

test("resultadoBorrado: 409 por candado muestra MENSAJE_CANDADO; sin cuerpo sigue el texto de versión", () => {
  assert.equal(resultadoBorrado(409, { json: { codigo: "candado" } }).mensaje, MENSAJE_CANDADO);
  assert.match(resultadoBorrado(409).mensaje, /recárgala/);
});

test("script: msg y borrar leen el cuerpo (codigo) y salidaConfirmada se restablece en pageshow", () => {
  assert.match(js, /const msg = [^]{0,200}mensajeRespuesta\(/);
  assert.match(js, /codigo === "candado"[^]{0,120}msg\(r\)/);
  assert.match(js, /"pageshow"[^]{0,200}salidaConfirmada = false/);
});
