// Correcciones de la revisión del PR #50: separador fuera de comillas, CSV sin registros, carrera de pintarMd y guardado durante la importación.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vis = () => import("../src/lib/visores.ts");
const editor = readFileSync(new URL("../src/scripts/hardware-editor.ts", import.meta.url), "utf8");

test("detectarSeparador ignora separadores dentro de comillas", async () => {
  const { detectarSeparador } = await vis();
  assert.equal(detectarSeparador('"Notas,a,b,c,d";referencia;descripcion;cantidad;costo_unitario'), ";");
  assert.equal(detectarSeparador('a,b,c'), ",");
  assert.equal(detectarSeparador('"x;;;;""y;;",b,c'), ",");
  assert.equal(detectarSeparador("a;b;c\nx,y,z,w"), ";");
});

test("parsearBom acepta cabecera con ; y columna desconocida con comas entre comillas", async () => {
  const { parsearBom } = await vis();
  const r = parsearBom('"Notas,a,b,c,d";referencia;descripcion;cantidad;costo_unitario\nx;R1;Res;2;0.5\n');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.bom.filas[0].referencia, "R1");
});

test("parsearBom rechaza un CSV sin registros sin lanzar", async () => {
  const { parsearBom } = await vis();
  for (const csv of ['""', '"" ']) {
    const r = parsearBom(csv);
    assert.equal(r.ok, false);
    assert.ok(r.error);
  }
});

test("pintarMd descarta respuestas obsoletas y monta visores sin await tras publicar", () => {
  const cuerpo = editor.slice(editor.indexOf("async function pintarMd"), editor.indexOf("function descargarCsv"));
  assert.match(cuerpo, /generacionPintura/);
  assert.match(cuerpo, /replaceChildren\(frag\)/);
  assert.ok(!/await import\(/.test(cuerpo.slice(cuerpo.indexOf("replaceChildren"))), "no debe haber await entre publicar y montar");
});

test("importar BOM bloquea Guardar mientras se lee el archivo y lo libera en finally", () => {
  const i = editor.indexOf("await archivo.text()");
  const antes = editor.slice(i - 250, i);
  const despues = editor.slice(i, i + 400);
  assert.match(antes, /subidasActivas\+\+/);
  assert.match(despues, /finally\s*\{[^}]*subidasActivas--/);
});
