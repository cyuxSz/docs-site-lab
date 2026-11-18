// Editor visual: hilos de CodeRabbit en la PR #57 (criterios 19–29 de la spec). Con Crepe montado en jsdom: el marcador de URL
// solo se sustituye en el destino, Esc se desarma al salir del editor, los botones internos de Crepe no envían el formulario,
// pegar un archivo en un bloque de código no deja la etiqueta sin URL e insertar un bloque no borra la selección. Estáticos sobre
// el portal: diagramas no reemplazables, región viva de carga, sesión de edición, subidas pendientes, lo guardado y subirVarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepararDom } from "./fixtures/dom-editor.mjs";

const dom = prepararDom({ bloquesVisibles: true });
const doc = dom.window.document;
const mod = await import("../src/lib/editor-visual-crepe.ts");
const { TextSelection } = await import("@milkdown/kit/prose/state");

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const PAGINA = "src/pages/[project]/[disciplina].astro";
const SCRIPT = "src/scripts/hardware-editor.ts";
const funcion = (js, cabecera) => js.match(new RegExp(`${cabecera}[^]*?\\r?\\n  \\}\\r?\\n`))?.[0] ?? "";
const URL_A = "/api/archivos/?proyecto=uuv&id=2f4b20ae-ad0a-48f2-9047-98aa57be8f55";

async function montar(md, opciones, envoltorio = "div") {
  const caja = doc.createElement(envoltorio);
  caja.innerHTML = '<button type="button" id="antes">Markdown</button><div id="ed"></div><button type="button" id="adj">Adjuntar</button><button id="guardar">Guardar</button>';
  doc.body.append(caja);
  const ed = await mod.montarCrepe(caja.querySelector("#ed"), md, opciones);
  await new Promise((r) => setTimeout(r, 150)); // los bloques de código se montan en un microtask
  return { ed, caja, raiz: caja.querySelector("#ed"), cerrar: async () => { await ed.destruir(); caja.remove(); } };
}
const tecla = (destino, key, extra = {}) => {
  const e = new dom.window.KeyboardEvent("keydown", { key, keyCode: key === "Tab" ? 9 : key === "Escape" ? 27 : 0, bubbles: true, cancelable: true, ...extra });
  destino.dispatchEvent(e);
  return e;
};
function posDe(ed, texto, tipo) {
  let pos = -1;
  ed.vista.state.doc.descendants((n, p) => {
    if (pos >= 0) return false;
    if (n.isText && n.text.includes(texto) && (!tipo || ed.vista.state.doc.resolve(p).parent.type.name === tipo)) pos = p + n.text.indexOf(texto);
  });
  assert.ok(pos >= 0, `no se encontró «${texto}»`);
  return pos;
}
const seleccionar = (ed, desde, hasta = desde) => ed.vista.dispatch(ed.vista.state.tr.setSelection(TextSelection.create(ed.vista.state.doc, desde, hasta)));
// Edita otro párrafo para que el Markdown se serialice de nuevo (no el original).
const editarOtro = (ed, texto) => {
  const p = posDe(ed, texto);
  ed.vista.dispatch(ed.vista.state.tr.insertText("X", p));
};

// ---------- 19: marcador solo en el destino ----------

test("19: una imagen cuyo alt es el marcador interno conserva alt y destino tras editar otro párrafo", async () => {
  const md = `Otro párrafo.\n\n![zzurlintacta0zz](${URL_A})\n`;
  const { ed, cerrar } = await montar(md);
  editarOtro(ed, "Otro");
  const salida = ed.getMarkdown();
  assert.ok(salida.includes(`![zzurlintacta0zz](${URL_A})`), `alt y destino intactos:\n${salida}`);
  await cerrar();
});

test("19: un enlace cuya etiqueta es el marcador interno conserva etiqueta y destino", async () => {
  const md = `Otro párrafo.\n\n[zzurlintacta0zz](${URL_A})\n`;
  const { ed, cerrar } = await montar(md);
  editarOtro(ed, "Otro");
  const salida = ed.getMarkdown();
  assert.ok(salida.includes(`[zzurlintacta0zz](${URL_A})`), `etiqueta y destino intactos:\n${salida}`);
  await cerrar();
});

// ---------- 20: Esc se desarma al salir ----------

const TABLA = "| a | b |\n| - | - |\n| 1 | 2 |\n";
const focusout = (el, relatedTarget) => el.dispatchEvent(new dom.window.FocusEvent("focusout", { bubbles: true, relatedTarget }));

test("20: Esc, el foco sale del editor y vuelve, y Tab pasa a la celda siguiente (no sale)", async () => {
  const { ed, caja, cerrar } = await montar(TABLA);
  seleccionar(ed, posDe(ed, "1") + 1);
  tecla(ed.vista.dom, "Escape");
  focusout(ed.vista.dom, caja.querySelector("#adj"));
  const e = tecla(ed.vista.dom, "Tab");
  assert.notEqual(doc.activeElement, caja.querySelector("#adj"), "Esc quedó desarmado al salir");
  assert.equal(e.defaultPrevented, true, "lo gestiona la tabla");
  assert.equal(ed.vista.state.selection.$from.parent.textContent, "2", "el cursor pasó a la celda siguiente");
  await cerrar();
});

test("20 (guarda): si el foco se mueve dentro del editor, Esc sigue armado y Tab sale", async () => {
  const { ed, caja, raiz, cerrar } = await montar(TABLA);
  seleccionar(ed, posDe(ed, "1") + 1);
  tecla(ed.vista.dom, "Escape");
  focusout(ed.vista.dom, raiz.querySelector("table") ?? raiz);
  tecla(ed.vista.dom, "Tab");
  assert.equal(doc.activeElement, caja.querySelector("#adj"));
  await cerrar();
});

// ---------- 21: botones internos sin submit ----------

test("21: «Modificar» de una tarjeta dentro de un <form> no envía el formulario y sigue alternando la vista", async () => {
  const opciones = { renderizarBloque: (l) => (l === "pdf" ? '<figure class="hw-pdf"><figcaption>Manual</figcaption></figure>' : null) };
  const { raiz, caja, cerrar } = await montar("Texto.\n\n```pdf\narchivo: x\ntitulo: Manual\n```\n", opciones, "form");
  let envios = 0;
  caja.addEventListener("submit", (e) => {
    envios++;
    e.preventDefault();
  });
  const boton = raiz.querySelector(".preview-toggle-button");
  assert.ok(boton, "el bloque con vista tiene su botón Modificar");
  const host = raiz.querySelector(".codemirror-host");
  const antes = host?.classList.contains("hidden");
  boton.click();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(envios, 0, "el clic en un botón interno de Crepe no dispara submit");
  assert.notEqual(raiz.querySelector(".codemirror-host")?.classList.contains("hidden"), antes, "la vista se alterna");
  caja.querySelector("#guardar").click();
  assert.equal(envios, 1, "Guardar (fuera del editor) sigue enviando el formulario");
  await cerrar();
});

// ---------- 22: archivo con el cursor en un bloque de código ----------

for (const [nombre, enlace] of [
  ["enlace", `[datos.csv](${URL_A})`],
  ["imagen", `![foto.png](${URL_A})`],
]) {
  test(`22: insertar un ${nombre} en línea con el cursor en un bloque de código: entra completo tras el bloque y el código no cambia`, async () => {
    const md = "Antes.\n\n```text\nprint(1)\n```\n\nDespués.\n";
    const { ed, cerrar } = await montar(md);
    seleccionar(ed, posDe(ed, "print", "code_block") + 3);
    const r = ed.insertarMarkdown(enlace, { enLinea: true });
    const salida = ed.getMarkdown();
    assert.match(salida, /```text\nprint\(1\)\n```/, `el bloque de código no cambia:\n${salida}`);
    assert.ok(salida.includes(enlace), `el ${nombre} entra completo (con URL):\n${salida}`);
    assert.ok(salida.indexOf(enlace) > salida.indexOf("print(1)"), "después del bloque");
    assert.equal(r, true, "insertarMarkdown devuelve true si el enlace quedó como enlace válido");
    await cerrar();
  });
}

test("22 (guarda): en un párrafo, insertarMarkdown en línea devuelve true y deja el enlace", async () => {
  const { ed, cerrar } = await montar("Uno dos.\n");
  seleccionar(ed, posDe(ed, "dos"));
  const r = ed.insertarMarkdown(`[a.csv](${URL_A}) `, { enLinea: true });
  assert.equal(r, true);
  assert.ok(ed.getMarkdown().includes(`[a.csv](${URL_A})`));
  await cerrar();
});

test("22: subir solo muestra «subido» si insertar devolvió true; si no, error", () => {
  const js = leer(SCRIPT);
  const ins = funcion(js, "function insertar\\(");
  assert.match(ins, /function insertar\([^)]*\)\s*:\s*boolean/, "insertar devuelve boolean");
  const s = funcion(js, "async function subir\\(");
  assert.match(s, /(!|=\s*)insertar\(enlaceArchivo/, "subir usa el resultado de insertar");
  assert.match(s, /errorEditor\(/);
});

// ---------- 28: insertar un bloque no borra la selección ----------

test("28: insertar un bloque (PDF/BOM/diagrama) con texto seleccionado conserva el texto", async () => {
  const { ed, cerrar } = await montar("Antes NO BORRAR después.\n");
  const i = posDe(ed, "NO BORRAR");
  seleccionar(ed, i, i + "NO BORRAR".length);
  const bloque = "```pdf\narchivo: 2f4b20ae-ad0a-48f2-9047-98aa57be8f55\ntitulo: Manual\n```\n";
  ed.insertarMarkdown(bloque);
  const salida = ed.getMarkdown();
  assert.match(salida, /NO BORRAR/, `la selección no se borra:\n${salida}`);
  assert.ok(salida.includes(bloque.trimEnd()), "el bloque entra intacto");
  await cerrar();
});

test("28 (guarda): un enlace en línea sí reemplaza la selección", async () => {
  const { ed, cerrar } = await montar("Antes REEMPLAZAR después.\n");
  const i = posDe(ed, "REEMPLAZAR");
  seleccionar(ed, i, i + "REEMPLAZAR".length);
  ed.insertarMarkdown(`[a.csv](${URL_A})`, { enLinea: true });
  const salida = ed.getMarkdown();
  assert.doesNotMatch(salida, /REEMPLAZAR/);
  assert.ok(salida.includes(`[a.csv](${URL_A})`));
  await cerrar();
});

// ---------- 23: diagramas no reemplazables ----------

const DIAG = (fuente) => `\`\`\`diagrama\neditor: excalidraw\nfuente: ${fuente}\nsvg: 3f4b20ae-ad0a-48f2-9047-98aa57be8f55\ntitulo: Esquema\n\`\`\``;
const F = "1f4b20ae-ad0a-48f2-9047-98aa57be8f55";

test("23: diagramaReemplazable: primer nivel y fuente única sí; en cita, en lista o repetido, no", async () => {
  const hw = await import("../src/lib/hardware-md.ts");
  assert.equal(typeof hw.diagramaReemplazable, "function", "src/lib/hardware-md.ts exporta diagramaReemplazable(md, fuente)");
  assert.equal(hw.diagramaReemplazable(`Texto.\n\n${DIAG(F)}\n`, F), true);
  assert.equal(hw.diagramaReemplazable(`> Cita.\n>\n${DIAG(F).replace(/^/gm, "> ")}\n`, F), false, "dentro de una cita");
  assert.equal(hw.diagramaReemplazable(`- item\n\n${DIAG(F).replace(/^/gm, "  ")}\n`, F), false, "dentro de una lista");
  assert.equal(hw.diagramaReemplazable(`${DIAG(F)}\n\n${DIAG(F)}\n`, F), false, "fuente repetida");
  assert.equal(hw.diagramaReemplazable(`Texto.\n`, F), false, "no está");
});

test("23: «Editar diagrama» en el editor visual comprueba que se puede reemplazar antes de descargar y antes de subir", () => {
  const js = leer(SCRIPT);
  const ed = funcion(js, "async function editarDiagramaDeBoton");
  assert.ok(ed.includes("diagramaReemplazable("), "editarDiagramaDeBoton usa diagramaReemplazable");
  assert.ok(ed.indexOf("diagramaReemplazable(") < ed.indexOf("fetch("), "antes del fetch");
  const g = funcion(js, "async function guardarDiagrama");
  assert.ok(g.includes("diagramaReemplazable("), "guardarDiagrama usa diagramaReemplazable");
  assert.ok(g.indexOf("diagramaReemplazable(") < g.indexOf("subir("), "antes de la primera subida");
});

// ---------- 24: región viva expuesta antes de «Editar» ----------

test("24: región viva vacía de la carga, fuera del formulario oculto y sin hidden", () => {
  const src = leer(PAGINA);
  const seccion = src.match(/<section class="hw-pagina"[^]*?<\/section>\s*(?=<section|<\/main|<aside|$)/)?.[0] ?? src;
  const form = src.match(/<form class="hw-editor"[^]*?<\/form>/)?.[0] ?? "";
  const region = src.match(/<p[^>]*data-hw-anuncio-carga[^>]*>([^<]*)<\/p>/);
  assert.ok(region, "<p data-hw-anuncio-carga> en la página");
  assert.match(region[0], /role="status"/);
  assert.doesNotMatch(region[0], /\shidden[\s>]/, "expuesta antes de pulsar Editar");
  assert.equal(region[1], "", "vacía de inicio");
  assert.ok(!form.includes("data-hw-anuncio-carga"), "fuera del <form> (que está oculto hasta editar)");
  assert.ok(seccion.includes("data-hw-anuncio-carga"), "dentro de la sección de la página");
});

test("24: el indicador visual no se anuncia (aria-hidden) y el script escribe y vacía la región viva", () => {
  const form = leer(PAGINA).match(/<form class="hw-editor"[^]*?<\/form>/)?.[0] ?? "";
  const ind = form.match(/<p[^>]*data-hw-cargando-visual[^>]*>/)?.[0] ?? "";
  assert.ok(ind, "indicador visual");
  assert.match(ind, /aria-hidden="true"/);
  assert.doesNotMatch(ind, /role="status"/, "no se anuncia dos veces");
  const js = leer(SCRIPT);
  const nombre = js.match(/const (\w+) = \$\("\[data-hw-anuncio-carga\]"\)/)?.[1];
  assert.ok(nombre, "el script usa la región viva");
  const m = funcion(js, "async function montarVisual");
  const antes = m.slice(0, m.indexOf("await"));
  assert.match(antes, new RegExp(`${nombre}\\.textContent = MENSAJE_CARGANDO_EDITOR`), "se escribe antes del primer await");
  const fin = m.match(/finally \{[^]*?\r?\n    \}/)?.[0] ?? "";
  assert.match(fin, new RegExp(`${nombre}\\.textContent = ""`), "se vacía al terminar");
});

// ---------- 25: sesión de edición ----------

test("25: la descarga del diagrama queda ligada a la sesión de edición", () => {
  const js = leer(SCRIPT);
  assert.ok(/let sesionEdicion = 0;/.test(js), "let sesionEdicion = 0; en hardware-editor.ts");
  assert.match(funcion(js, "function abrirEditor"), /sesionEdicion\+\+|\+\+sesionEdicion/);
  assert.match(funcion(js, "function cerrarEditor"), /sesionEdicion\+\+|\+\+sesionEdicion/);
  const ed = funcion(js, "async function editarDiagramaDeBoton");
  const iFetch = ed.indexOf("fetch(");
  const captura = ed.match(/const (\w+) = sesionEdicion;/);
  assert.ok(captura && ed.indexOf(captura[0]) < iFetch, "se captura la sesión antes del fetch");
  const tras = ed.slice(iFetch, ed.indexOf("abrirDiagrama("));
  assert.match(tras, new RegExp(`${captura[1]} !== sesionEdicion|sesionEdicion !== ${captura[1]}`), "se comprueba antes de abrir el diálogo");
  const g = funcion(js, "async function guardarDiagrama");
  const enTexto = g.slice(g.indexOf("if (ctx.enTexto)"));
  assert.match(enTexto, /sesionEdicion/, "guardarDiagrama no aplica el resultado de otra sesión");
});

// ---------- 26, 27, 29: subidas, lo guardado y subirVarios ----------

test("26: Markdown → visual no vuelve a montar el editor con subidas pendientes", () => {
  const c = funcion(leer(SCRIPT), "async function cambiarModo");
  const i = c.indexOf("montarVisual(");
  assert.ok(i > 0, "cambiarModo monta el editor visual");
  assert.match(c.slice(0, i), /subidasActivas > 0/, "comprueba las subidas antes de montar");
});

test("27: tras guardar sin salir, inicialEditor es la serialización capturada con el cuerpo del PUT", () => {
  const g = funcion(leer(SCRIPT), "async function guardar\\(");
  const iPut = g.indexOf('await api("PUT"');
  assert.ok(iPut > 0);
  assert.match(g.slice(0, iPut), /getMarkdown\(\)/, "se captura getMarkdown() antes del PUT");
  const despues = g.slice(g.indexOf("await envio"));
  assert.match(despues, /inicialEditor = /);
  assert.doesNotMatch(despues, /getMarkdown\(\)/, "no se vuelve a serializar tras la respuesta");
});

test("29: subirVarios no sube mientras se guarda ni mientras carga el editor visual", () => {
  const s = funcion(leer(SCRIPT), "async function subirVarios");
  const primera = s.split(/\r?\n/)[1]?.trim();
  assert.equal(primera, "if (insercionBloqueada(guardando, cargandoVisual)) return;");
});
