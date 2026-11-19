// D1a: en el editor de hardware, "Insertar > PDF" (sube el PDF con el flujo de adjuntos y mete un bloque ```pdf con su uuid) e
// "Insertar BOM" (lee un .csv local, lo valida con parsearBom y mete el bloque ```bom canónico; no sube nada).
// La página de lectura monta los visores (montarVisores) después de pintar el fragmento ya saneado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const vis = () => import("../src/lib/visores.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const CABECERA = "referencia,descripcion,cantidad,costo_unitario";

test("insertarBloqueTexto: separa el bloque con líneas en blanco y deja el cursor después", async () => {
  const { insertarBloqueTexto, bloquePdf } = await vis();
  const b = bloquePdf({ archivo: A, titulo: "Manual" });
  assert.deepEqual(insertarBloqueTexto("", 0, b), { texto: b, cursor: b.length });
  const r = insertarBloqueTexto("antes\ndespués", 5, b);
  assert.equal(r.texto, `antes\n\n${b}\ndespués`);
  assert.equal(r.cursor, `antes\n\n${b}`.length);
  const fin = insertarBloqueTexto("hola\n\n", 99, b);
  assert.equal(fin.texto, `hola\n\n${b}`);
});

test("tituloDeArchivo: nombre sin extensión, limpio y de una línea (≤ 120)", async () => {
  const { tituloDeArchivo } = await vis();
  assert.equal(tituloDeArchivo("Hoja de datos.pdf"), "Hoja de datos");
  assert.equal(tituloDeArchivo("a\n```b.pdf"), "a b");
  assert.equal(tituloDeArchivo("x".repeat(300) + ".pdf").length, 120);
  assert.equal(tituloDeArchivo(".pdf"), "");
});

test("bomDeArchivo: solo .csv de hasta 64 KB; quita el BOM UTF-8 inicial y valida con parsearBom", async () => {
  const { bomDeArchivo, MAX_BOM_BYTES } = await vis();
  assert.equal(MAX_BOM_BYTES, 64 * 1024);
  const ok = bomDeArchivo({ name: "bom.csv", size: 100 }, `﻿${CABECERA}\nR1,Res,2,0.5\n`);
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.bom.filas[0].referencia, "R1");
  const tipo = bomDeArchivo({ name: "bom.xlsx", size: 100 }, `${CABECERA}\nR1,Res,2,0.5\n`);
  assert.equal(tipo.ok, false);
  assert.match(tipo.error, /\.csv/);
  const grande = bomDeArchivo({ name: "bom.csv", size: 64 * 1024 + 1 }, `${CABECERA}\nR1,Res,2,0.5\n`);
  assert.equal(grande.ok, false);
  assert.match(grande.error, /64 KB/);
  const malo = bomDeArchivo({ name: "bom.csv", size: 10 }, "a,b\n1,2");
  assert.equal(malo.ok, false);
  assert.match(malo.error, /costo|referencia|cantidad/i);
});

// Lote a-editor-qol: las acciones viven en el menú «Insertar» (role=menuitem); el nombre ya no repite «Insertar».
test("página de hardware: acciones 'PDF' y 'BOM (CSV)' del menú «Insertar», con inputs de archivo restringidos", () => {
  const p = leer("src/pages/[project]/[disciplina].astro");
  assert.match(p, /<button type="button" class="btn" data-hw-insertar-pdf[^>]*role="menuitem"[^>]*>PDF<\/button>/);
  assert.match(p, /<button type="button" class="btn" data-hw-insertar-bom[^>]*role="menuitem"[^>]*>BOM \(CSV\)<\/button>/);
  assert.match(p, /<input type="file"[^>]*data-hw-archivo-pdf[^>]*accept="\.pdf,application\/pdf"/);
  assert.match(p, /<input type="file"[^>]*data-hw-archivo-bom[^>]*accept="\.csv,text\/csv"/);
});

test("script del editor: monta los visores tras pintar (vista previa sin iframes) y reutiliza subir() para el PDF", () => {
  const s = leer("src/scripts/hardware-editor.ts");
  assert.match(s, /montarVisores\(/);
  assert.match(s, /vistaPrevia:\s*destino === previa/);
  assert.match(s, /bloquePdf\(/);
  assert.match(s, /bomDeArchivo\(/);
  assert.match(s, /insertarBloqueTexto\(/);
  // El iframe solo lo crea montarVisores: el script no construye iframes ni usa innerHTML.
  assert.doesNotMatch(s, /createElement\(\s*["']iframe["']\s*\)/);
  assert.doesNotMatch(s, /\.innerHTML\s*=/);
});
