// D1a: tabla BOM en las páginas de hardware. El bloque lleva el CSV en línea:
//   ```bom
//   referencia,descripcion,cantidad,costo_unitario,proveedor,enlace
//   R1,Resistencia 10k,10,0.0032,Digikey,https://www.digikey.com/x
//   ```
// Columnas obligatorias: referencia, descripción, cantidad, costo unitario. Opcionales: proveedor y enlace. Las desconocidas se
// ignoran (los BOM de KiCad traen muchas). Separador "," o ";" (según la cabecera). Costos con hasta 4 decimales; los totales se
// calculan con enteros (sin errores de coma flotante). Lógica pura en src/lib/visores.ts; render y botón en src/lib/hardware-md.ts.
// "Exportar CSV": UTF-8 con BOM, CRLF, todos los campos entre comillas y celdas de texto que empiezan por = + - @ (aunque lleven
// espacios delante) con un apóstrofo delante (inyección de fórmulas en Excel/LibreOffice/Sheets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const vis = () => import("../src/lib/visores.ts");
const md = () => import("../src/lib/hardware-md.ts");
const ventana = () => new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const CABECERA = "referencia,descripcion,cantidad,costo_unitario";
const bloque = (csv) => "```bom\n" + csv + "\n```\n";

// ---------- 1. Parser ----------

test("parsearBom: columnas mínimas, filas y totales (cantidad y costo) sin errores de coma flotante", async () => {
  const { parsearBom } = await vis();
  const r = parsearBom(`${CABECERA}\nR1,Resistencia 10k,3,0.1\nR2,Resistencia 1k,3,0.2\n`);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.bom.filas.length, 2);
  assert.equal(r.bom.filas[0].referencia, "R1");
  assert.equal(r.bom.filas[0].descripcion, "Resistencia 10k");
  assert.equal(r.bom.filas[0].cantidad, 3);
  assert.deepEqual(r.bom.totales, { cantidad: 6, costo: 0.9 });
  assert.deepEqual(r.bom.opcionales, { proveedor: false, enlace: false });

  const r2 = parsearBom(`${CABECERA}\nR1,Res,10,0.0032\nU1,ESC,3,$12.50\nJ1,Conector,2,1.005\n`);
  assert.equal(r2.ok, true, r2.error);
  // 10 × 0.0032 + 3 × 12.50 + 2 × 1.005 = 39.542 → 39.54
  assert.deepEqual(r2.bom.totales, { cantidad: 15, costo: 39.54 });
});

test("parsearBom: cabeceras sin distinguir mayúsculas ni acentos, columnas opcionales, desconocidas ignoradas, ';' y comillas RFC 4180", async () => {
  const { parsearBom } = await vis();
  const r = parsearBom('Referencia;Descripción;Cantidad;Costo unitario;Proveedor;Enlace;Footprint\nC1;"Capacitor; 10 uF ""X7R""";4;0.25;Mouser;https://www.mouser.com/p?x=1;0805\n');
  assert.equal(r.ok, true, r.error);
  const f = r.bom.filas[0];
  assert.equal(f.descripcion, 'Capacitor; 10 uF "X7R"');
  assert.equal(f.proveedor, "Mouser");
  assert.equal(f.enlace, "https://www.mouser.com/p?x=1");
  assert.deepEqual(r.bom.opcionales, { proveedor: true, enlace: true });
  assert.ok(!JSON.stringify(r.bom).includes("0805"), "la columna desconocida no se guarda");
});

test("parsearBom: limpia celdas (controles y saltos de línea → espacio) y recorta espacios", async () => {
  const { parsearBom } = await vis();
  const r = parsearBom(`${CABECERA}\n  R1 ,"línea 1\nlínea 2\u0007",1,1\n`);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.bom.filas[0].referencia, "R1");
  assert.equal(r.bom.filas[0].descripcion, "línea 1 línea 2");
});

test("parsearBom: errores con número de fila; nunca acepta columnas obligatorias faltantes ni números inválidos", async () => {
  const { parsearBom, MAX_FILAS_BOM, MAX_CELDA_BOM } = await vis();
  assert.equal(MAX_FILAS_BOM, 500);
  assert.equal(MAX_CELDA_BOM, 200);
  const malos = [
    ["", /vac/i],
    ["referencia,descripcion,cantidad\nR1,x,1", /costo/i],
    [`${CABECERA}`, /fila/i], // sin filas
    [`${CABECERA}\nR1,x,-1,1`, /fila 2.*cantidad/i],
    [`${CABECERA}\nR1,x,1.5,1`, /fila 2.*cantidad/i],
    [`${CABECERA}\nR1,x,abc,1`, /fila 2.*cantidad/i],
    [`${CABECERA}\nR1,x,1,1\nR2,y,1,-3`, /fila 3.*costo/i],
    [`${CABECERA}\nR1,x,1,1.23456`, /fila 2.*costo/i],
    [`${CABECERA}\nR1,x,1,=1+1`, /fila 2.*costo/i],
    [`${CABECERA}\n,x,1,1`, /fila 2.*referencia/i],
    [`${CABECERA},enlace\nR1,x,1,1,javascript:alert(1)`, /fila 2.*enlace/i],
    [`${CABECERA},enlace\nR1,x,1,1,//evil.example`, /fila 2.*enlace/i],
    [`${CABECERA}\nR1,"sin cerrar,1,1`, /comillas/i],
    [`${CABECERA}\nR1,${"x".repeat(201)},1,1`, /fila 2/i],
    [`${CABECERA}\n` + Array.from({ length: 501 }, (_, i) => `R${i},x,1,1`).join("\n"), /500/],
  ];
  for (const [csv, msg] of malos) {
    const r = parsearBom(csv);
    assert.equal(r.ok, false, csv.slice(0, 80));
    assert.match(r.error, msg, `${csv.slice(0, 80)} → ${r.error}`);
  }
});

// ---------- 2. Export y bloque ----------

test("celdaSegura: neutraliza = + - @ (también tras espacios) con un apóstrofo; el resto queda igual", async () => {
  const { celdaSegura } = await vis();
  for (const v of ["=HYPERLINK(\"http://evil\",\"x\")", "+1", "-2+3", "@SUM(A1)", "  =1+1"]) assert.equal(celdaSegura(v), `'${v}`, v);
  for (const v of ["R1", "10 uF", "a=b", "", "https://www.digikey.com/x"]) assert.equal(celdaSegura(v), v, v);
});

test("csvBom: UTF-8 con BOM, CRLF, todo entre comillas, comillas dobladas, texto neutralizado y números tal cual", async () => {
  const { parsearBom, csvBom } = await vis();
  const r = parsearBom(`${CABECERA},proveedor\n=cmd,"Res ""10k""",10,0.0032,@prov\nU1,-ESC,1,12.5,+x\n`);
  assert.equal(r.ok, true, r.error);
  const csv = csvBom(r.bom);
  assert.equal(csv[0], "﻿");
  const lineas = csv.slice(1).split("\r\n");
  assert.equal(lineas.at(-1), "", "termina en CRLF");
  assert.deepEqual(lineas.slice(0, -1), [
    '"Referencia","Descripción","Cantidad","Costo unitario","Proveedor"',
    `"'=cmd","Res ""10k""","10","0.0032","'@prov"`,
    `"U1","'-ESC","1","12.5","'+x"`,
  ]);
  assert.doesNotMatch(csv, /\n(?<!\r\n)/, "sin LF sueltos");
});

test("bloqueBom: genera ```bom canónico, inverso de parsearBom; una celda con ``` no cierra el bloque", async () => {
  const { parsearBom, bloqueBom } = await vis();
  const { crearRenderizador } = await md();
  const r = parsearBom(`${CABECERA},enlace\n\`\`\`,"a, b",2,1.5,https://x.example/\nR2,~~~,1,0\n`);
  assert.equal(r.ok, true, r.error);
  const b = bloqueBom(r.bom);
  assert.match(b, /^```bom\n/);
  assert.match(b, /\n```\n$/);
  const cuerpo = b.replace(/^```bom\n/, "").replace(/```\n$/, "");
  assert.deepEqual(parsearBom(cuerpo).bom, r.bom);
  const win = ventana();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(`${b}\nfin`));
  assert.equal(win.document.querySelectorAll("figure.hw-bom").length, 1);
  assert.equal(win.document.querySelector("figure.hw-bom tbody td").textContent, "```");
  assert.equal(win.document.querySelector("pre"), null, "no queda código suelto");
});

test("nombreCsvBom: bom-<slug>.csv, y -2, -3… para las tablas siguientes de la misma página", async () => {
  const { nombreCsvBom } = await vis();
  assert.equal(nombreCsvBom("placa-potencia", 0), "bom-placa-potencia.csv");
  assert.equal(nombreCsvBom("placa-potencia", 1), "bom-placa-potencia-2.csv");
  assert.equal(nombreCsvBom("", 0), "bom.csv");
  assert.equal(nombreCsvBom("../x", 0), "bom-x.csv");
});

test("formatoCosto: dos decimales con separador de miles (es-MX)", async () => {
  const { formatoCosto } = await vis();
  assert.equal(formatoCosto(1234.5), "1,234.50");
  assert.equal(formatoCosto(0), "0.00");
});

// ---------- 3. Render ----------

test("render: ```bom → figure.hw-bom con thead, tbody y tfoot de totales; el texto de las celdas nunca es HTML", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const csv = `${CABECERA},proveedor,enlace\n"<img src=x onerror=alert(1)>","<b>ESC</b>",1000,1.25,<script>x</script>,https://www.digikey.com/p\nR2,Res,234,0.5,,\n`;
  const html = crearRenderizador(win, { proyecto: "uuv" }).html(bloque(csv));
  assert.doesNotMatch(html, /<(img|b|script)\b/i, html);
  win.document.body.innerHTML = html;
  const fig = win.document.querySelector("figure.hw-bom");
  assert.ok(fig, html);
  const ths = [...fig.querySelectorAll("thead th")].map((t) => t.textContent.trim());
  assert.deepEqual(ths, ["Referencia", "Descripción", "Cantidad", "Costo unitario", "Subtotal", "Proveedor", "Enlace"]);
  const filas = fig.querySelectorAll("tbody tr");
  assert.equal(filas.length, 2);
  assert.equal(filas[0].querySelector("td").textContent, "<img src=x onerror=alert(1)>");
  const a = filas[0].querySelector("a");
  assert.equal(a.getAttribute("href"), "https://www.digikey.com/p");
  assert.equal(a.getAttribute("rel"), "noopener noreferrer");
  assert.equal(filas[1].querySelector("a"), null, "sin enlace no hay <a>");
  const pie = fig.querySelector("tfoot").textContent;
  assert.match(pie, /Total/);
  assert.match(pie, /1,234\b/, "cantidad total");
  assert.match(pie, /1,367\.00/, "costo total: 1000 × 1.25 + 234 × 0.5");
});

test("render: ```bom inválido o anidado sigue siendo código", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  for (const texto of [bloque("a,b\n1,2"), "> ```bom\n> " + CABECERA + "\n> R1,x,1,1\n> ```\n"]) {
    win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
    assert.equal(win.document.querySelector("figure.hw-bom"), null, texto);
    assert.ok(win.document.querySelector("pre code"), texto);
  }
});

test("montarVisores: botón 'Exportar CSV' por tabla (type=button, con nombre accesible) que llama a descargar(nombre, csv); idempotente", async () => {
  const { crearRenderizador, montarVisores } = await md();
  const { parsearBom, csvBom } = await vis();
  const win = ventana();
  const c1 = `${CABECERA}\n=R1,x,1,1\n`;
  const c2 = `${CABECERA}\nR9,y,2,3\n`;
  const texto = `${bloque(c1)}\n${bloque(c2)}`;
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  const llamadas = [];
  const op = { proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar: (nombre, csv) => llamadas.push([nombre, csv]) };
  montarVisores(win.document.body, texto, op);
  montarVisores(win.document.body, texto, op);
  const botones = [...win.document.querySelectorAll("figure.hw-bom button")];
  assert.equal(botones.length, 2);
  for (const b of botones) {
    assert.equal(b.getAttribute("type"), "button");
    assert.match(b.textContent, /Exportar CSV/);
  }
  botones[1].click();
  botones[0].click();
  assert.deepEqual(llamadas, [
    ["bom-placa-2.csv", csvBom(parsearBom(c2).bom)],
    ["bom-placa.csv", csvBom(parsearBom(c1).bom)],
  ]);
  assert.match(llamadas[1][1], /"'=R1"/);
});
