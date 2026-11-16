// C1: hallazgos de revisión (CodeRabbit) sobre el controlador de diagramas, el editor de hardware y el render del bloque.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const F = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const S = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const ORIGEN = "https://embed.diagrams.net";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
const DATA = "data:image/svg+xml;base64," + Buffer.from(SVG).toString("base64");

// ---------- controlador (src/scripts/diagramas.ts) empaquetado y ejecutado sobre jsdom ----------
let modulo;
async function controlador() {
  if (!modulo) {
    const { outputFiles } = buildSync({
      entryPoints: [raiz + "src/scripts/diagramas.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      external: ["../components/EditorExcalidraw"],
    });
    modulo = await import("data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64"));
  }
  return modulo;
}

function entorno() {
  const dom = new JSDOM(
    `<body><dialog id="hw-diagrama"><h2 id="hw-diagrama-titulo"></h2><div data-hw-diag-lienzo></div>
     <button data-hw-diag-guardar></button><button data-hw-diag-cerrar></button><p data-hw-diag-estado></p><p data-hw-diag-error hidden></p></dialog></body>`,
    { url: "https://docs.example/uuv/electronica/" },
  );
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const temporizadores = [];
  const AC = globalThis.AbortController;
  const guardado = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.AbortController = w.AbortController;
  globalThis.setTimeout = (fn, ms) => (temporizadores.push({ fn, ms, activo: true }), temporizadores.length);
  globalThis.clearTimeout = (id) => { if (temporizadores[id - 1]) temporizadores[id - 1].activo = false; };
  const enviados = [];
  const marco = () => w.document.querySelector("iframe");
  return {
    w,
    temporizadores,
    enviados,
    marco,
    restaurar() { Object.assign(globalThis, guardado, { AbortController: AC }); delete globalThis.window; delete globalThis.document; },
    // Simula un mensaje de diagrams.net.
    drawio(obj) {
      w.dispatchEvent(new w.MessageEvent("message", { origin: ORIGEN, source: marco().contentWindow, data: JSON.stringify(obj) }));
    },
    vencer(i) { const t = temporizadores[i]; if (t.activo) t.fn(); },
  };
}
const esperar = () => new Promise((r) => setImmediate(r));

test("controlador: si se sigue dibujando mientras alGuardar sube, el editor no se cierra tras guardar", async () => {
  const { abrirEditorDiagrama } = await controlador();
  const e = entorno();
  try {
    let resolverGuardado;
    let guardadas = 0;
    let cerrado = false;
    void abrirEditorDiagrama({
      editor: "drawio",
      fuente: "<mxfile/>",
      titulo: "",
      disparador: null,
      alGuardar: () => (guardadas++, new Promise((r) => (resolverGuardado = r))),
      confirmarDescartar: async () => true,
    }).then(() => (cerrado = true));
    e.drawio({ event: "init" });
    e.drawio({ event: "load" });
    e.drawio({ event: "save", xml: "<mxfile>1</mxfile>" });
    e.drawio({ event: "export", data: DATA, xml: "<mxfile>1</mxfile>" });
    await esperar();
    assert.equal(guardadas, 1);
    e.drawio({ event: "autosave", xml: "<mxfile>2</mxfile>" }); // cambio mientras sube
    resolverGuardado({ ok: true });
    await esperar();
    assert.equal(cerrado, false, "con cambios pendientes el editor sigue abierto");
    assert.equal(e.w.document.querySelector("#hw-diagrama").open, true);
    assert.equal(e.w.document.querySelector("[data-hw-diag-guardar]").disabled, false, "se puede volver a guardar");
  } finally {
    e.restaurar();
  }
});

test("controlador: sin cambios durante el guardado, el editor se cierra", async () => {
  const { abrirEditorDiagrama } = await controlador();
  const e = entorno();
  try {
    let cerrado = false;
    void abrirEditorDiagrama({
      editor: "drawio", fuente: "<mxfile/>", titulo: "", disparador: null,
      alGuardar: async () => ({ ok: true }),
      confirmarDescartar: async () => true,
    }).then(() => (cerrado = true));
    e.drawio({ event: "init" });
    e.drawio({ event: "load" });
    e.drawio({ event: "save", xml: "<mxfile>1</mxfile>" });
    e.drawio({ event: "export", data: DATA, xml: "<mxfile>1</mxfile>" });
    await esperar();
    await esperar();
    assert.equal(cerrado, true);
  } finally {
    e.restaurar();
  }
});

test("controlador diagrams.net: una respuesta tardía de una exportación vencida no entrega ni cancela el temporizador de la nueva", async () => {
  const { abrirEditorDiagrama } = await controlador();
  const e = entorno();
  try {
    let guardadas = 0;
    void abrirEditorDiagrama({
      editor: "drawio", fuente: "<mxfile/>", titulo: "", disparador: null,
      alGuardar: async () => (guardadas++, { ok: true }),
      confirmarDescartar: async () => true,
    });
    e.drawio({ event: "init" });
    e.drawio({ event: "load" });
    const btn = e.w.document.querySelector("[data-hw-diag-guardar]");
    btn.click(); // E1
    assert.equal(e.temporizadores.length, 1);
    e.vencer(0); // E1 vence a los 20 s
    assert.equal(btn.disabled, false);
    const err = e.w.document.querySelector("[data-hw-diag-error]");
    assert.equal(err.hidden, false);
    btn.click(); // E2
    assert.equal(e.temporizadores.length, 2);
    // Respuesta tardía de E1 (diagrams.net devuelve la petición en `message`).
    e.drawio({ event: "export", data: DATA, xml: "<mxfile>vieja</mxfile>", message: { peticion: 1 } });
    await esperar();
    assert.equal(guardadas, 0, "la instantánea vieja no se entrega");
    assert.equal(e.temporizadores[1].activo, true, "el temporizador de E2 sigue activo");
    // Y sin eco de la petición, una respuesta sin exportación pendiente también se ignora.
    e.vencer(1);
    e.drawio({ event: "export", data: DATA, xml: "<mxfile>vieja</mxfile>" });
    await esperar();
    assert.equal(guardadas, 0);
    // La respuesta de la petición vigente sí se entrega.
    btn.click(); // E3
    e.drawio({ event: "export", data: DATA, xml: "<mxfile>nueva</mxfile>", message: { peticion: 3 } });
    await esperar();
    assert.equal(guardadas, 1);
  } finally {
    e.restaurar();
  }
});

// ---------- editor de hardware: Insertar diagrama durante el PUT ----------
test("hardware-editor: Insertar diagrama se deshabilita mientras la página se guarda y el listener lo comprueba", () => {
  const src = readFileSync(raiz + "src/scripts/hardware-editor.ts", "utf8");
  assert.match(src, /btnInsertarDiagrama\.disabled = guardando/);
  assert.match(src, /escuchar\(btnInsertarDiagrama, "click", \(\) => \{\s*if \(guardando\) return;/);
});

// ---------- Excalidraw: huella de cambios ----------
test("huellaDibujo: el color de fondo cuenta como cambio; la selección y el desplazamiento no", async () => {
  const { huellaDibujo } = await import("../src/lib/diagramas.ts");
  const els = [{ id: "a", version: 1 }];
  const base = huellaDibujo(els, { viewBackgroundColor: "#ffffff" });
  assert.notEqual(huellaDibujo(els, { viewBackgroundColor: "#000000" }), base);
  assert.equal(huellaDibujo(els, { viewBackgroundColor: "#ffffff", scrollX: 40, selectedElementIds: { a: true } }), base);
  assert.notEqual(huellaDibujo([{ id: "a", version: 2 }], { viewBackgroundColor: "#ffffff" }), base);
  const tsx = readFileSync(raiz + "src/components/EditorExcalidraw.tsx", "utf8");
  assert.match(tsx, /huellaDibujo\(elementos, appState\)/, "onChange usa la huella con appState");
});

// ---------- hardware-md: posiciones y definiciones de enlace repetidas ----------
const bloque = `\`\`\`diagrama\neditor: drawio\nfuente: ${F}\nsvg: ${S}\n\`\`\`\n`;
const md = () => import("../src/lib/hardware-md.ts");

test("diagramasDe: definiciones de enlace repetidas no hacen desaparecer los diagramas", async () => {
  const { diagramasDe, reemplazarDiagrama } = await md();
  const texto = `[r]: /uno\n[r]: /dos\n\n${bloque}`;
  assert.equal(diagramasDe(texto).length, 1);
  const F2 = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
  const S2 = "1b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3d";
  const r = reemplazarDiagrama(texto, F, { editor: "drawio", fuente: F2, svg: S2 });
  assert.equal(r, `[r]: /uno\n[r]: /dos\n\n\`\`\`diagrama\neditor: drawio\nfuente: ${F2}\nsvg: ${S2}\n\`\`\`\n`);
});

test("crearRenderizador: con saltos CRLF y con definiciones repetidas el bloque se pinta como figura, no como código", async () => {
  const { crearRenderizador } = await md();
  const win = new JSDOM("<!doctype html><body></body>").window;
  const r = crearRenderizador(win, { proyecto: "uuv" });
  for (const texto of [`# P\r\n\r\n${bloque.replace(/\n/g, "\r\n")}`, `[r]: /uno\n[r]: /dos\n\n${bloque}`, `# P\n\n${bloque}`]) {
    const h = r.html(texto);
    assert.match(h, /<figure class="hw-diagrama">/, JSON.stringify(texto));
    assert.doesNotMatch(h, /<pre>/);
  }
});

// ---------- segundo guardado sin cerrar el editor ----------
test("hardware-editor: tras cada guardado correcto la referencia del diagrama pasa a la fuente nueva (no duplica ni da conflicto)", async () => {
  const { reemplazarDiagrama } = await md();
  const F2 = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
  const S2 = "1b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3d";
  const F3 = "2b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3e";
  const S3 = "3b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3f";
  const tras1 = reemplazarDiagrama(bloque, F, { editor: "drawio", fuente: F2, svg: S2 });
  // Con la referencia vieja el segundo guardado no encuentra el bloque; con la nueva, lo reemplaza.
  assert.equal(reemplazarDiagrama(tras1, F, { editor: "drawio", fuente: F3, svg: S3 }), null);
  const tras2 = reemplazarDiagrama(tras1, F2, { editor: "drawio", fuente: F3, svg: S3 });
  assert.equal((tras2.match(/```diagrama/g) ?? []).length, 1);
  const src = readFileSync(raiz + "src/scripts/hardware-editor.ts", "utf8");
  assert.equal((src.match(/ctx\.anterior = datos\.fuente/g) ?? []).length, 2, "tanto al insertar en el texto como al guardar la página");
  assert.match(src, /alGuardar: \(r\) => guardarDiagrama\(ctx, r\)/, "el mismo ctx mutable en todos los guardados");
});
