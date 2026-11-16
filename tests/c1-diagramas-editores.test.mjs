// C1: lógica pura de los editores (src/lib/diagramas.ts). diagrams.net va en un iframe a https://embed.diagrams.net con
// postMessage (proto=json): init → load, save → export(svg) → export, exit. Solo se aceptan mensajes de ese origen Y
// de la ventana del iframe abierto; las respuestas se envían con targetOrigin exacto (nunca "*").
// Excalidraw se carga en diferido (import() al pulsar Editar/Crear) y su versión está fijada en package.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const diag = () => import("../src/lib/diagramas.ts");
const ORIGEN = "https://embed.diagrams.net";

// ---------- diagrams.net: URL y mensajes ----------

test("ORIGEN_DRAWIO y urlDrawio: embed oficial con proto=json, en español, sin otros dominios", async () => {
  const { ORIGEN_DRAWIO, urlDrawio } = await diag();
  assert.equal(ORIGEN_DRAWIO, ORIGEN);
  const u = new URL(urlDrawio());
  assert.equal(u.origin, ORIGEN);
  assert.equal(u.searchParams.get("embed"), "1");
  assert.equal(u.searchParams.get("proto"), "json");
  assert.equal(u.searchParams.get("lang"), "es");
  assert.equal(u.searchParams.get("saveAndExit"), "0", "Guardar no cierra el editor");
  assert.equal(u.searchParams.get("noExitBtn"), "0", "hay botón Salir (dispara exit con modified)");
});

test("mensajeDrawio: acepta solo origen exacto + source del iframe + JSON con event conocido", async () => {
  const { mensajeDrawio } = await diag();
  const marco = { nombre: "iframe" };
  const ok = (data, extra = {}) => ({ origin: ORIGEN, source: marco, data, ...extra });
  assert.deepEqual(mensajeDrawio(ok('{"event":"init"}'), marco), { event: "init" });
  assert.deepEqual(mensajeDrawio(ok('{"event":"save","xml":"<mxfile/>"}'), marco), { event: "save", xml: "<mxfile/>" });
  assert.deepEqual(mensajeDrawio(ok('{"event":"exit","modified":true}'), marco), { event: "exit", modified: true });

  const rechazados = [
    ok('{"event":"init"}', { origin: "https://evil.example" }),
    ok('{"event":"init"}', { origin: "https://embed.diagrams.net.evil.example" }),
    ok('{"event":"init"}', { origin: "http://embed.diagrams.net" }),
    ok('{"event":"init"}', { origin: "https://app.diagrams.net" }),
    ok('{"event":"init"}', { origin: "null" }),
    ok('{"event":"init"}', { source: { otro: true } }),
    ok('{"event":"init"}', { source: null }),
    ok("no es json"),
    ok('"init"'),
    ok("null"),
    ok("[]"),
    ok('{"action":"load"}'),
    ok('{"event":"desconocido"}'),
    ok({ event: "init" }), // objeto, no cadena: proto=json siempre manda texto
  ];
  for (const e of rechazados) assert.equal(mensajeDrawio(e, marco), null, JSON.stringify({ o: e.origin, d: e.data }));
  // Sin iframe abierto no se acepta nada aunque el origen cuadre.
  assert.equal(mensajeDrawio(ok('{"event":"init"}', { source: undefined }), undefined), null);
});

test("enviarDrawio: postMessage con JSON y targetOrigin exacto (nunca '*')", async () => {
  const { enviarDrawio } = await diag();
  const enviados = [];
  const ventana = { postMessage: (m, o) => enviados.push([m, o]) };
  enviarDrawio(ventana, { action: "load", xml: "<mxfile/>", autosave: 1 });
  enviarDrawio(ventana, { action: "export", format: "svg" });
  assert.deepEqual(enviados.map(([, o]) => o), [ORIGEN, ORIGEN]);
  assert.deepEqual(JSON.parse(enviados[0][0]), { action: "load", xml: "<mxfile/>", autosave: 1 });
  // Sin ventana (iframe ya cerrado) no lanza.
  assert.doesNotThrow(() => enviarDrawio(null, { action: "load" }));
});

// ---------- SVG exportado ----------

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>Señal ⚡</text></svg>';

test("svgDeExport: decodifica el data URI base64 de diagrams.net a texto UTF-8; rechaza lo que no sea SVG", async () => {
  const { svgDeExport } = await diag();
  assert.equal(svgDeExport(`data:image/svg+xml;base64,${b64(SVG)}`), SVG);
  for (const malo of [
    `data:text/html;base64,${b64("<script>alert(1)</script>")}`,
    `data:image/png;base64,${b64("PNG")}`,
    `data:image/svg+xml;base64,${b64("<html><body>no</body></html>")}`,
    "data:image/svg+xml;base64,@@@",
    "javascript:alert(1)",
    "",
    null,
    42,
  ]) assert.equal(svgDeExport(malo), null, String(malo).slice(0, 40));
});

test("esSvg: solo documentos cuyo elemento raíz es <svg> (admite prólogo XML y comentarios)", async () => {
  const { esSvg } = await diag();
  assert.equal(esSvg(SVG), true);
  assert.equal(esSvg(`<?xml version="1.0"?>\n<!-- x -->\n${SVG}`), true);
  assert.equal(esSvg("<html><svg></svg></html>"), false);
  assert.equal(esSvg("texto <svg>"), false);
  assert.equal(esSvg(""), false);
  assert.equal(esSvg(" ".repeat(10) + SVG), true);
});

// ---------- Cambios sin guardar ----------

test("estadoEditor/confirmarCierre: cerrar pide confirmación si hay cambios sin guardar o un guardado en curso", async () => {
  const { estadoEditor, confirmarCierre, ESTADO_INICIAL } = await diag();
  let e = ESTADO_INICIAL;
  assert.equal(confirmarCierre(e), false, "recién abierto se cierra sin preguntar");
  e = estadoEditor(e, "cambio");
  assert.equal(confirmarCierre(e), true);
  e = estadoEditor(e, "guardando");
  assert.equal(confirmarCierre(e), true);
  e = estadoEditor(e, "error");
  assert.equal(confirmarCierre(e), true, "si el guardado falla los cambios siguen sin guardar");
  e = estadoEditor(estadoEditor(e, "guardando"), "guardado");
  assert.equal(confirmarCierre(e), false);
  assert.deepEqual(ESTADO_INICIAL, { sucio: false, guardando: false }, "no muta el estado inicial");
  // Un cambio durante el guardado deja el editor sucio aunque el guardado termine bien.
  e = estadoEditor(estadoEditor(estadoEditor(ESTADO_INICIAL, "cambio"), "guardando"), "cambio");
  assert.equal(confirmarCierre(estadoEditor(e, "guardado")), true);
});

// ---------- Excalidraw: dependencia fijada y carga diferida ----------

test("package.json: @excalidraw/excalidraw con versión exacta (sin ^ ni ~) y en el lockfile", () => {
  const pkg = JSON.parse(readFileSync(resolve(raiz, "package.json"), "utf8"));
  const v = pkg.dependencies?.["@excalidraw/excalidraw"];
  assert.match(String(v), /^\d+\.\d+\.\d+$/, "versión exacta");
  const lock = JSON.parse(readFileSync(resolve(raiz, "package-lock.json"), "utf8"));
  assert.equal(lock.packages?.["node_modules/@excalidraw/excalidraw"]?.version, v);
});

// Resuelve un import relativo como Vite: tal cual o probando extensiones (los .ts del portal se importan sin extensión).
function resolverArchivo(base) {
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", ".jsx"]) {
    const f = base + ext;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}

// Grafo de imports estáticos (los import() dinámicos se separan: son la carga diferida).
function grafo(rel) {
  const vistos = new Set();
  const estaticos = new Set();
  const dinamicos = new Set();
  const pila = [resolve(raiz, rel)];
  while (pila.length) {
    const f = resolverArchivo(pila.pop());
    if (!f || vistos.has(f) || /\.(css|json)$/.test(f)) continue;
    vistos.add(f);
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] ?? m[2];
      if (m[3]) dinamicos.add(m[3].startsWith(".") ? resolve(dirname(f), m[3]) : m[3]);
      if (m[1] && /^\s*import\s+type\s/.test(m[0])) continue; // import type no llega al bundle
      if (!spec) continue;
      if (spec.startsWith(".")) pila.push(resolve(dirname(f), spec));
      else estaticos.add(spec);
    }
  }
  return { estaticos, dinamicos, vistos };
}

test("carga diferida: la página de hardware no importa estáticamente Excalidraw; sí lo hace un módulo pedido con import()", () => {
  const { estaticos, dinamicos } = grafo("src/scripts/hardware-editor.ts");
  for (const p of estaticos) assert.doesNotMatch(p, /^@excalidraw\//, `import estático de ${p}`);
  // Algún import() dinámico alcanza un módulo que sí importa @excalidraw/excalidraw.
  // Recorre en anchura los módulos pedidos con import() (también los import() de esos módulos).
  let alcanza = false;
  const cola = [...dinamicos];
  const visitados = new Set();
  while (cola.length && !alcanza) {
    const d = cola.shift();
    if (visitados.has(d)) continue;
    visitados.add(d);
    if (/^@excalidraw\/excalidraw/.test(d)) alcanza = true;
    else if (/^[A-Za-z]:[\\/]|^\//.test(d)) {
      const sub = grafo(d);
      if ([...sub.estaticos].some((p) => /^@excalidraw\/excalidraw/.test(p))) alcanza = true;
      cola.push(...sub.dinamicos);
    }
  }
  assert.ok(alcanza, "Excalidraw solo se alcanza por import() dinámico");
});

test("Excalidraw usa fuentes propias (sin CDN): EXCALIDRAW_ASSET_PATH apunta a este origen", async () => {
  const { RUTA_ASSETS_EXCALIDRAW } = await diag();
  assert.match(RUTA_ASSETS_EXCALIDRAW, /^\/[a-z0-9/-]+\/$/, "ruta absoluta del mismo origen terminada en /");
});
