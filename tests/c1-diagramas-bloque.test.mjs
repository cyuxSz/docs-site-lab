// C1: bloque ```diagrama en el Markdown de hardware. Formato (una clave por línea, "clave: valor"):
//   ```diagrama
//   editor: excalidraw          (o drawio)
//   fuente: <uuid del .excalidraw / .drawio en /api/archivos>
//   svg: <uuid del .svg exportado>
//   titulo: Cableado principal  (opcional)
//   ```
// Lógica pura en src/lib/diagramas.ts; render y reemplazo en src/lib/hardware-md.ts (marked + DOMPurify, jsdom).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const F = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const S = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const F2 = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const S2 = "1b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3d";

const diag = () => import("../src/lib/diagramas.ts");
const md = () => import("../src/lib/hardware-md.ts");
const ventana = () => new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const bloque = (cuerpo) => "```diagrama\n" + cuerpo + "\n```\n";

// ---------- 1. Parser del cuerpo del bloque ----------

test("parsearBloque: acepta excalidraw y drawio con fuente, svg y título opcional", async () => {
  const { parsearBloque } = await diag();
  assert.deepEqual(parsearBloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: Cableado principal`), { editor: "excalidraw", fuente: F, svg: S, titulo: "Cableado principal" });
  assert.deepEqual(parsearBloque(`editor: drawio\nfuente: ${F}\nsvg: ${S}`), { editor: "drawio", fuente: F, svg: S, titulo: "" });
  // Orden libre, espacios alrededor y líneas en blanco tolerados; UUID en mayúsculas se normaliza a minúsculas.
  assert.deepEqual(parsearBloque(`\n  svg:   ${S.toUpperCase()}  \n\neditor:drawio\r\nfuente: ${F}\n`), { editor: "drawio", fuente: F, svg: S, titulo: "" });
});

test("parsearBloque: rechaza (null) editor desconocido, ids no UUID, claves faltantes, desconocidas o repetidas", async () => {
  const { parsearBloque } = await diag();
  const malos = [
    `editor: tldraw\nfuente: ${F}\nsvg: ${S}`,
    `editor: Excalidraw\nfuente: ${F}\nsvg: ${S}`,
    `editor: excalidraw\nfuente: ../../secreto\nsvg: ${S}`,
    `editor: excalidraw\nfuente: ${F}\nsvg: https://evil.example/x.svg`,
    `editor: excalidraw\nfuente: ${F}`,
    `fuente: ${F}\nsvg: ${S}`,
    `editor: excalidraw\nfuente: ${F}\nsvg: ${S}\nonload: x`,
    `editor: excalidraw\nfuente: ${F}\nsvg: ${S}\nsvg: ${S2}`,
    `editor: excalidraw\nfuente: ${F}\nsvg: ${F}`,
    `editor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: ${"x".repeat(121)}`,
    `editor: excalidraw\nfuente: ${F}\nsvg: ${S}\nlinea sin dos puntos`,
    "",
  ];
  for (const m of malos) assert.equal(parsearBloque(m), null, JSON.stringify(m));
});

test("bloqueDiagrama: genera el fence canónico y es inverso de parsearBloque; el título se limpia", async () => {
  const { bloqueDiagrama, parsearBloque } = await diag();
  const d = { editor: "excalidraw", fuente: F, svg: S, titulo: "Cableado principal" };
  const b = bloqueDiagrama(d);
  assert.equal(b, `\`\`\`diagrama\neditor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: Cableado principal\n\`\`\`\n`);
  const cuerpo = b.replace(/^```diagrama\n/, "").replace(/```\n$/, "");
  assert.deepEqual(parsearBloque(cuerpo), d);
  // Saltos de línea y caracteres de control del título no pueden romper el bloque ni inyectar claves.
  const raro = bloqueDiagrama({ editor: "drawio", fuente: F, svg: S, titulo: "a\nsvg: x\u0007\n```" });
  assert.equal(raro.split("\n").filter((l) => l.startsWith("```")).length, 2, "solo abre y cierra el fence");
  assert.deepEqual(parsearBloque(raro.replace(/^```diagrama\n/, "").replace(/```\n$/, "")).svg, S);
  // Sin título no escribe la línea titulo.
  assert.doesNotMatch(bloqueDiagrama({ editor: "drawio", fuente: F, svg: S, titulo: "" }), /titulo/);
  assert.throws(() => bloqueDiagrama({ editor: "otro", fuente: F, svg: S }), "editor inválido");
});

test("nombresArchivos: nombres saneados con la extensión de cada editor (.excalidraw/.drawio y .svg)", async () => {
  const { nombresArchivos } = await diag();
  assert.deepEqual(nombresArchivos({ editor: "excalidraw", titulo: "Cableado principal" }), { fuente: "cableado-principal.excalidraw", svg: "cableado-principal.svg" });
  assert.deepEqual(nombresArchivos({ editor: "drawio", titulo: "" }), { fuente: "diagrama.drawio", svg: "diagrama.svg" });
  assert.deepEqual(nombresArchivos({ editor: "drawio", titulo: "../../Ñandú ⚡" }), { fuente: "nandu.drawio", svg: "nandu.svg" });
});

// ---------- 2. Render en lectura (hardware-md.ts) ----------

test("render: un bloque válido se muestra como <figure> con <img> del SVG por el proxy /api/archivos (nunca SVG en línea)", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const r = crearRenderizador(win, { proyecto: "uuv" });
  const frag = r.fragmento(`# Placa\n\n${bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: Cableado <b>principal</b>`)}`);
  win.document.body.replaceChildren(frag);
  const fig = win.document.querySelector("figure");
  assert.ok(fig, "hay figure");
  assert.equal(fig.className, "hw-diagrama");
  const img = fig.querySelector("img");
  assert.equal(img.getAttribute("src"), `/api/archivos/?proyecto=uuv&id=${S}`);
  assert.equal(img.getAttribute("alt"), "Diagrama: Cableado <b>principal</b>", "el título es texto, no HTML");
  assert.equal(fig.querySelector("figcaption")?.textContent, "Cableado <b>principal</b>");
  assert.equal(win.document.querySelector("b"), null);
  assert.equal(win.document.querySelector("svg"), null, "el SVG nunca se incrusta en el DOM");
  assert.equal(win.document.querySelector("pre"), null, "no queda el código del bloque");
  for (const el of win.document.body.querySelectorAll("*")) for (const a of el.attributes) assert.doesNotMatch(a.name, /^on|^style$/i);
});

test("render: sin título no hay figcaption y el alt es 'Diagrama'; el id de proyecto va codificado", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "otro-proyecto" }).fragmento(bloque(`editor: drawio\nfuente: ${F}\nsvg: ${S}`)));
  const img = win.document.querySelector("figure.hw-diagrama img");
  assert.equal(img.getAttribute("alt"), "Diagrama");
  assert.equal(img.getAttribute("src"), `/api/archivos/?proyecto=otro-proyecto&id=${S}`);
  assert.equal(win.document.querySelector("figcaption"), null);
});

test("render: bloque inválido, anidado (cita/lista) o sin proyecto se muestra como código normal, sin figure", async () => {
  const { crearRenderizador } = await md();
  const casos = [
    [{ proyecto: "uuv" }, bloque(`editor: excalidraw\nfuente: ${F}\nsvg: javascript:alert(1)`)],
    [{ proyecto: "uuv" }, "> " + bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}`).trimEnd().split("\n").join("\n> ") + "\n"],
    [{}, bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}`)],
    [{ proyecto: "../evil" }, bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}`)],
  ];
  for (const [op, texto] of casos) {
    const win = ventana();
    win.document.body.replaceChildren(crearRenderizador(win, op).fragmento(texto));
    assert.equal(win.document.querySelector("figure"), null, JSON.stringify(texto.slice(0, 40)));
    assert.ok(win.document.querySelector("pre code"), "se ve como código");
    assert.equal(win.document.querySelector("img"), null);
  }
});

test("render: la firma vieja crearRenderizador(win) sigue funcionando (vista previa y código existente)", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const html = crearRenderizador(win).html("# Hola\n\n```c\nint x;\n```");
  assert.match(html, /<h1>Hola<\/h1>/);
  assert.match(html, /language-c/);
});

// ---------- 3. Localizar y reemplazar bloques (lo usa "Editar diagrama" al guardar) ----------

test("diagramasDe: lista los bloques válidos de primer nivel en el mismo orden que las figure renderizadas", async () => {
  const { diagramasDe, crearRenderizador } = await md();
  const texto = `# P\n\n${bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: Uno`)}\nTexto\n\n${bloque("editor: nada")}\n${bloque(`editor: drawio\nfuente: ${F2}\nsvg: ${S2}`)}`;
  const lista = diagramasDe(texto);
  assert.deepEqual(lista.map((d) => [d.editor, d.fuente, d.svg]), [["excalidraw", F, S], ["drawio", F2, S2]]);
  const win = ventana();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  const srcs = [...win.document.querySelectorAll("figure.hw-diagrama img")].map((i) => new URLSearchParams(i.getAttribute("src").split("?")[1]).get("id"));
  assert.deepEqual(srcs, lista.map((d) => d.svg));
});

test("reemplazarDiagrama: cambia solo el bloque con esa fuente y deja el resto del Markdown byte a byte", async () => {
  const { reemplazarDiagrama } = await md();
  const antes = "# Placa\n\nIntro *con* formato.\n\n";
  const medio = "\n| a | b |\n|---|---|\n| 1 | 2 |\n\n";
  const despues = "\n[ref]: https://example.com\n\nFin sin salto";
  const texto = antes + bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: Uno`) + medio + bloque(`editor: drawio\nfuente: ${F2}\nsvg: ${S2}`) + despues;
  const nuevo = { editor: "drawio", fuente: "aaaaaaaa-4f50-4a61-9b72-8c9d0e1f2a3d", svg: "bbbbbbbb-4f50-4a61-9b72-8c9d0e1f2a3d", titulo: "Dos v2" };
  const { bloqueDiagrama } = await diag();
  const r = reemplazarDiagrama(texto, F2, nuevo);
  assert.equal(r, antes + bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}\ntitulo: Uno`) + medio + bloqueDiagrama(nuevo) + despues);
});

test("reemplazarDiagrama: devuelve null si la fuente ya no está (otro la cambió) o aparece dos veces", async () => {
  const { reemplazarDiagrama } = await md();
  const nuevo = { editor: "excalidraw", fuente: F2, svg: S2, titulo: "" };
  assert.equal(reemplazarDiagrama("# Sin diagramas\n", F, nuevo), null);
  const doble = bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}`) + "\n" + bloque(`editor: excalidraw\nfuente: ${F}\nsvg: ${S}`);
  assert.equal(reemplazarDiagrama(doble, F, nuevo), null);
});

// ---------- 4. Insertar un diagrama nuevo en el editor de la página ----------

test("insertarBloque: inserta el bloque en el cursor separado por líneas en blanco (no pega al texto vecino)", async () => {
  const { insertarBloque, bloqueDiagrama } = await diag();
  const d = { editor: "excalidraw", fuente: F, svg: S, titulo: "" };
  const b = bloqueDiagrama(d);
  const r = insertarBloque("Hola mundo", 4, d);
  assert.equal(r.texto, `Hola\n\n${b}\n mundo`);
  assert.equal(r.texto.slice(0, r.cursor), `Hola\n\n${b}\n`);
  assert.equal(insertarBloque("", 0, d).texto, b);
  assert.equal(insertarBloque("A\n\n", 3, d).texto, `A\n\n${b}`);
});
