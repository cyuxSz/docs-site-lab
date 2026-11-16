// Código de salida de tools/fetch.mjs: sin token, si todo falla por autenticación solo avisa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { codigoSalida } from "../tools/salida.mjs";

const authErr = { id: "uuv", error: true, auth: true, causa: "sin-token" };
const otroErr = { id: "a", error: true, auth: false, causa: "clone" };
const ok = { id: "b" };

test("sin token y todo error de auth: sale 0 (también en modo estricto)", () => {
  assert.equal(codigoSalida([authErr], { token: "", strict: false }), 0);
  assert.equal(codigoSalida([authErr], { token: "", strict: true }), 0);
});
test("con token y todo falla: sale 1", () => {
  assert.equal(codigoSalida([authErr], { token: "t", strict: false }), 1);
});
test("error que no es de auth: sale 1 aunque no haya token", () => {
  assert.equal(codigoSalida([otroErr], { token: "", strict: false }), 1);
  assert.equal(codigoSalida([authErr, otroErr], { token: "", strict: false }), 1);
});
test("modo estricto: error no-auth parcial falla; sin errores sale 0", () => {
  assert.equal(codigoSalida([ok, otroErr], { token: "", strict: true }), 1);
  assert.equal(codigoSalida([ok, authErr], { token: "", strict: true }), 0);
  assert.equal(codigoSalida([ok], { token: "t", strict: true }), 0);
});
test("fetch.mjs usa codigoSalida", () => {
  assert.match(readFileSync(new URL("../tools/fetch.mjs", import.meta.url), "utf8"), /codigoSalida\(summary/);
});
