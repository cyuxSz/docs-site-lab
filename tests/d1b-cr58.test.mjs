// Lote CR58 (criterios 18–23): hilos de CodeRabbit en el PR #58 sobre el visor de KiCad y la vista de lector.
// 18 reintento de carga de KiCanvas · 19 límite en bytes · 20 nombre accesible por tipo · 21 sin WebGL2 no se monta
// 22 subida KiCad atada a la sesión de edición · 23 «Editar diagrama» oculto e inerte en vista de lector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const vis = () => import("../src/lib/visores.ts");
const md = () => import("../src/lib/hardware-md.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const ventana = () => new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const bloque = (cuerpo) => "```kicad\n" + cuerpo + "\n```\n";
const SCH = "(kicad_sch\n  (version 20251024)\n  (generator \"eeschema\")\n)\n";
const PCB = "(kicad_pcb (version 20251024) (generator \"pcbnew\"))\n";
const SCRIPT_KICANVAS = "/vendor/kicanvas/kicanvas.js";
const opciones = (extra = {}) => ({ proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {}, ...extra });

function falsoKicad(texto = SCH, { webgl2 = true } = {}) {
  const llamadas = { script: 0, urls: [], webgl2: 0 };
  return {
    llamadas,
    kicad: {
      cargarScript: async () => {
        llamadas.script++;
      },
      leer: async (url) => {
        llamadas.urls.push(url);
        return texto;
      },
      webgl2: () => {
        llamadas.webgl2++;
        return webgl2;
      },
    },
  };
}

async function montar(texto, kicad) {
  const { crearRenderizador, montarVisores } = await md();
  const win = ventana();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  await montarVisores(win.document.body, texto, opciones({ kicad }));
  return win;
}

// ---------- 18. cargarKicanvas: un fallo no se queda en caché ----------

test("C18 cargarKicanvas: si el <script> falla, la promesa rechaza, se borra de la caché y la siguiente llamada reintenta con otra URL", async () => {
  const { cargarKicanvas } = await md();
  const win = ventana();
  const p1 = cargarKicanvas(win.document);
  assert.equal(cargarKicanvas(win.document), p1, "en curso: misma promesa");
  const s1 = win.document.querySelector("script");
  assert.equal(s1.getAttribute("src"), SCRIPT_KICANVAS);
  s1.dispatchEvent(new win.Event("error"));
  await assert.rejects(p1);
  const p2 = cargarKicanvas(win.document);
  assert.notEqual(p2, p1, "tras el fallo no se reutiliza la promesa rechazada");
  const scripts = [...win.document.querySelectorAll("script")];
  assert.equal(scripts.length, 1, "el <script> fallido se retira y se añade uno nuevo");
  // El mapa de módulos del navegador recuerda el fallo por URL: el reintento debe usar otra URL del mismo origen.
  assert.match(scripts[0].getAttribute("src"), /^\/vendor\/kicanvas\/kicanvas\.js\?reintento=\d+$/);
  assert.equal(scripts[0].getAttribute("type"), "module");
  scripts[0].dispatchEvent(new win.Event("load"));
  await p2;
  assert.equal(cargarKicanvas(win.document), p2, "carga exitosa: se sigue deduplicando");
  assert.equal(win.document.querySelectorAll("script").length, 1);
});

// ---------- 19. límite en bytes ----------

function respuesta({ bytes, texto = "(kicad_sch)", largo = null }) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(largo === null ? {} : { "content-length": String(largo) }),
    arrayBuffer: async () => bytes,
    text: async () => texto,
  };
}

test("C19 leerArchivoKicad: mide MAX_KICAD_VISOR en bytes del cuerpo (arrayBuffer) antes de decodificar", async () => {
  const mod = await md();
  const { MAX_KICAD_VISOR } = await vis();
  assert.equal(typeof mod.leerArchivoKicad, "function", "exportar leerArchivoKicad(doc, url) (antes leerTexto)");
  const win = ventana();
  // Cuerpo de más de MAX bytes aunque text() devuelva algo corto (p. ej. multibyte): se rechaza sin Content-Length.
  win.fetch = async () => respuesta({ bytes: new ArrayBuffer(MAX_KICAD_VISOR + 1) });
  await assert.rejects(mod.leerArchivoKicad(win.document, `/api/archivos/?proyecto=uuv&id=${A}`), /grande/i);
  // Cuerpo válido con caracteres multibyte: se devuelve decodificado como UTF-8.
  const sch = "(kicad_sch (title \"Señal ñ\"))\n";
  win.fetch = async () => respuesta({ bytes: new TextEncoder().encode(sch).buffer, texto: "no usar text()" });
  assert.equal(await mod.leerArchivoKicad(win.document, `/api/archivos/?proyecto=uuv&id=${A}`), sch);
  // Content-Length declarado por encima del límite se sigue rechazando antes de leer el cuerpo.
  let leido = false;
  win.fetch = async () => ({ ...respuesta({ bytes: new ArrayBuffer(1), largo: MAX_KICAD_VISOR + 1 }), arrayBuffer: async () => ((leido = true), new ArrayBuffer(1)) });
  await assert.rejects(mod.leerArchivoKicad(win.document, `/api/archivos/?proyecto=uuv&id=${A}`), /grande/i);
  assert.equal(leido, false);
});

test("C19 fuente: leerArchivoKicad no usa res.text() ni texto.length para el límite", () => {
  const src = leer("src/lib/hardware-md.ts");
  const i = src.search(/function\s+leerArchivoKicad\s*\(/);
  assert.ok(i >= 0, "falta leerArchivoKicad");
  const resto = src.slice(i);
  const cuerpo = resto.slice(0, resto.search(/\r?\n\}\r?\n/));
  assert.match(cuerpo, /arrayBuffer\(\)/);
  assert.match(cuerpo, /byteLength\s*>\s*MAX_KICAD_VISOR/);
  assert.match(cuerpo, /new\s+(win\.)?TextDecoder\(/);
  assert.doesNotMatch(cuerpo, /\.text\(\)/);
});

// ---------- 20. nombre accesible por tipo ----------

test("C20 montarVisores: la región se llama «PCB de KiCad[: título]» o «Esquemático de KiCad[: título]» según el archivo", async () => {
  const casos = [
    [PCB, `archivo: ${A}\ntitulo: Potencia`, "PCB de KiCad: Potencia"],
    [PCB, `archivo: ${A}`, "PCB de KiCad"],
    [SCH, `archivo: ${A}\ntitulo: Potencia`, "Esquemático de KiCad: Potencia"],
    [SCH, `archivo: ${A}`, "Esquemático de KiCad"],
  ];
  for (const [archivo, cuerpo, nombre] of casos) {
    const win = await montar(bloque(cuerpo), falsoKicad(archivo).kicad);
    const region = win.document.querySelector("figure.hw-kicad [role=region]");
    assert.ok(region, nombre);
    assert.equal(region.getAttribute("aria-label"), nombre);
  }
});

// ---------- 21. sin WebGL2 no se monta el visor ----------

test("C21 montarVisores: sin WebGL2 no descarga, no carga KiCanvas ni crea el visor; muestra el aviso y deja los enlaces", async () => {
  const texto = bloque(`archivo: ${A}\nrespaldo: ${B}`);
  const f = falsoKicad(PCB, { webgl2: false });
  const win = await montar(texto, f.kicad);
  assert.equal(f.llamadas.webgl2, 1, "se consulta webgl2() una vez");
  assert.equal(f.llamadas.script, 0);
  assert.equal(f.llamadas.urls.length, 0, "no se descarga el archivo para nada");
  assert.equal(win.document.querySelector("kicanvas-embed"), null);
  const aviso = win.document.querySelector("figure.hw-kicad [role=status]");
  assert.ok(aviso, "aviso role=status");
  assert.match(aviso.textContent, /respaldo|descarga/i);
  assert.equal(win.document.querySelectorAll("figure.hw-kicad a").length, 2);
  // Con WebGL2 se monta como siempre.
  const g = falsoKicad(PCB);
  const win2 = await montar(texto, g.kicad);
  assert.ok(win2.document.querySelector("kicanvas-embed"));
});

test("C21 soportaWebgl2(doc): true solo si un <canvas> nuevo da contexto \"webgl2\"; false si null o si lanza", async () => {
  const { soportaWebgl2 } = await md();
  assert.equal(typeof soportaWebgl2, "function", "exportar soportaWebgl2(doc)");
  const docCon = (getContext) => {
    const pedidos = [];
    return {
      pedidos,
      doc: {
        createElement: (tag) => {
          pedidos.push(tag);
          return { getContext: (tipo) => getContext(tipo) };
        },
      },
    };
  };
  const ok = docCon((t) => (t === "webgl2" ? {} : null));
  assert.equal(soportaWebgl2(ok.doc), true);
  assert.deepEqual(ok.pedidos, ["canvas"]);
  assert.equal(soportaWebgl2(docCon(() => null).doc), false);
  assert.equal(soportaWebgl2(docCon((t) => (t === "webgl" ? {} : null)).doc), false, "WebGL1 no basta");
  assert.equal(soportaWebgl2(docCon(() => { throw new Error("x"); }).doc), false);
});

test("C21 fuente: la carga por defecto usa soportaWebgl2(doc)", () => {
  const src = leer("src/lib/hardware-md.ts");
  assert.ok(/webgl2\s*:\s*\(\)\s*=>\s*soportaWebgl2\(doc\)/.test(src), "opcKicad por defecto: webgl2: () => soportaWebgl2(doc)");
});

// ---------- 22. subida KiCad atada a la sesión de edición ----------

test("C22 editor: insertar KiCad captura sesionEdicion y comprueba sesión y editando antes del respaldo y antes de insertar", () => {
  const script = leer("src/scripts/hardware-editor.ts");
  const i = script.indexOf('escuchar(inputKicad, "change"');
  assert.ok(i >= 0);
  const h = script.slice(i, script.indexOf("escuchar(btnInsertarBom", i));
  const captura = h.search(/const\s+(\w+)\s*=\s*sesionEdicion\b/);
  assert.ok(captura >= 0, "captura const sesion = sesionEdicion");
  const nombre = /const\s+(\w+)\s*=\s*sesionEdicion\b/.exec(h)[1];
  const subir1 = h.indexOf("subir(sel.kicad");
  const subir2 = h.indexOf("subir(sel.respaldo");
  const insertar = h.indexOf("insertarBloqueEnTexto(");
  assert.ok(captura < subir1 && subir1 < subir2 && subir2 < insertar);
  const guarda = new RegExp(`(${nombre}\\s*!==\\s*sesionEdicion[^;\\n]*!editando|!editando[^;\\n]*${nombre}\\s*!==\\s*sesionEdicion)`);
  assert.match(h.slice(subir1, subir2), guarda, "comprobación antes de subir el respaldo");
  assert.match(h.slice(subir2, insertar), guarda, "comprobación antes de insertar");
  assert.match(h, /finally\s*\{\s*subidasActivas--;/);
});

// ---------- 23. «Editar diagrama» en vista de lector ----------

test("C23 CSS: :root[data-vista-lector] también oculta .hw-diagrama-editar (solo en esa vista)", () => {
  const css = leer("src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const regla = /:root\[data-vista-lector\]\s*:is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css);
  assert.ok(regla);
  assert.ok(regla[1].split(",").map((x) => x.trim()).includes(".hw-diagrama-editar"), "no oculta .hw-diagrama-editar");
  assert.match(regla[2], /display:\s*none\s*!important/);
  assert.doesNotMatch(css.replace(regla[0], ""), /(^|\})\s*\.hw-diagrama-editar\s*\{[^}]*display:\s*none/, "fuera de la vista sigue visible");
});

test("C23 editor: el clic en «Editar diagrama» de la lectura no abre el editor con data-vista-lector activo", () => {
  const script = leer("src/scripts/hardware-editor.ts");
  const i = script.indexOf('escuchar(lectura, "click"');
  assert.ok(i >= 0);
  const h = script.slice(i, script.indexOf("});", i));
  assert.match(h, /hasAttribute\("data-vista-lector"\)|dataset\.vistaLector/);
  assert.ok(h.search(/data-vista-lector|vistaLector/) < h.indexOf("editarDiagramaDeBoton"), "la guarda va antes de abrir");
});
