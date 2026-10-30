// Lote 6b-2 · Panorama (nivel 0): 4 cajas Misión → Navegación → Control → Thrusters que abren su sección del grafo.
// Lógica pura en src/lib/panorama.ts; datos en projects.json → panorama; el JSON del grafo los publica filtrados.
// El cableado HTML/CSS se comprueba leyendo la fuente; lo visual (375 px, tema, foco) va a verificación en navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rosGraph } from "../src/lib/graph.ts";
import { projectData } from "./fixtures/ros-mini.mjs";

// Import dinámico: mientras no exista src/lib/panorama.ts cada test falla con un mensaje claro, no el archivo entero.
const mod = await import("../src/lib/panorama.ts").catch(() => ({}));
const panoramaCajas = (...args) => {
  assert.equal(typeof mod.panoramaCajas, "function", "falta src/lib/panorama.ts → panoramaCajas");
  return mod.panoramaCajas(...args);
};

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const projects = JSON.parse(read("projects.json"));
const uuv = projects.find((p) => p.id === "uuv");

const caja = (seccion, titulo = seccion, texto = `texto de ${seccion}`) => ({ seccion, titulo, texto });

test("panoramaCajas: conserva el orden y descarta cajas cuya sección no existe, duplicadas o sin título", () => {
  const entrada = [caja("mision"), caja("vision"), caja("navegacion"), caja("mision", "Otra"), caja("control", ""), caja("hardware")];
  assert.deepEqual(
    panoramaCajas(entrada, ["control", "mision", "navegacion", "hardware"]).map((c) => c.seccion),
    ["mision", "navegacion", "hardware"],
  );
});

test("panoramaCajas: sin panorama (undefined, vacío o no arreglo) devuelve []", () => {
  assert.deepEqual(panoramaCajas(undefined, ["control"]), []);
  assert.deepEqual(panoramaCajas([], ["control"]), []);
  assert.deepEqual(panoramaCajas({ control: 1 }, ["control"]), []);
  assert.deepEqual(panoramaCajas([null, 3, { seccion: 7, titulo: "x", texto: "y" }], ["control"]), []);
});

test("panoramaCajas: devuelve solo seccion/titulo/texto (sin campos extra del JSON)", () => {
  const [c] = panoramaCajas([{ ...caja("control", "Control", "calcula fuerzas"), html: "<b>x</b>" }], ["control"]);
  assert.deepEqual(c, { seccion: "control", titulo: "Control", texto: "calcula fuerzas" });
});

test("projects.json (uuv): panorama con Misión → Navegación → Control → Thrusters (hardware) y una línea cada uno", () => {
  assert.ok(Array.isArray(uuv.panorama), "falta panorama en el proyecto uuv");
  assert.deepEqual(uuv.panorama.map((c) => c.seccion), ["mision", "navegacion", "control", "hardware"]);
  assert.deepEqual(uuv.panorama.map((c) => c.titulo), ["Misión", "Navegación", "Control", "Thrusters"]);
  for (const c of uuv.panorama) assert.ok(typeof c.texto === "string" && c.texto.trim().length > 0 && c.texto.length <= 80, `texto de ${c.seccion}`);
  assert.match(uuv.panorama[3].texto, /Arduino/);
  assert.match(uuv.panorama[3].texto, /6 motores/);
  const otro = projects.find((p) => p.id === "proyecto-x");
  assert.equal(otro.panorama, undefined, "proyecto-x no tiene Panorama");
});

test("data.ts tipa panorama en el proyecto y graph.ts lo publica en GraphData", () => {
  assert.match(read("src/lib/data.ts"), /panorama\?:/);
  assert.match(read("src/lib/graph.ts"), /panorama\?:/);
});

test("rosGraph: publica panorama filtrado a las secciones existentes; sin panorama no hay campo", () => {
  const conPanorama = rosGraph(projectData({ panorama: [caja("mision"), caja("vision"), caja("navegacion"), caja("control"), caja("hardware")] }));
  // ros-mini no tiene nodos de visión: esa caja se descarta.
  assert.deepEqual(conPanorama.panorama.map((c) => c.seccion), ["mision", "navegacion", "control", "hardware"]);
  const sin = rosGraph(projectData());
  assert.ok(!sin.panorama || sin.panorama.length === 0, "sin panorama en projects.json no hay cajas");
  assert.equal("panorama" in sin, false);
});

const TSX = read("src/components/RoboticsGraph.tsx");
const CSS = read("src/components/RoboticsGraph.css");

test("componente: botón 'Panorama' con aria-pressed, cajas como <button> que abren la sección con pickSection", () => {
  assert.match(TSX, /data\??\.panorama/);
  assert.match(TSX, />\s*Panorama\s*</, "botón con el texto Panorama");
  assert.match(TSX, /aria-pressed=\{panorama\w*\}/i);
  assert.match(TSX, /className="rg-panorama"/);
  assert.match(TSX, /<button[^>]*className="rg-panorama-caja"/);
  assert.match(TSX, /pickSection\(\w+\.seccion\)/);
  // Flechas decorativas fuera del árbol accesible.
  assert.match(TSX, /className="rg-panorama-flecha"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*className="rg-panorama-flecha"/);
  assert.doesNotMatch(TSX, /dangerouslySetInnerHTML/);
});

test("CSS: cajas en fila, columna con flechas hacia abajo en pantallas angostas, foco visible y sin colores fijos", () => {
  assert.match(CSS, /\.rg-panorama[^{]*\{[^}]*display:\s*(flex|grid)/);
  assert.match(CSS, /\.rg-panorama-caja:focus-visible\s*\{[^}]*outline/);
  assert.match(CSS, /@media\s*\(max-width:\s*\d+px\)\s*\{[^@]*\.rg-panorama[^{]*\{[^}]*flex-direction:\s*column/);
  assert.match(CSS, /@media\s*\(max-width:\s*\d+px\)\s*\{[^@]*\.rg-panorama-flecha[^{]*\{[^}]*rotate/);
  const reglas = CSS.split("}").filter((r) => r.includes(".rg-panorama"));
  assert.ok(reglas.length > 0);
  for (const r of reglas) assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(/i, `color fijo en: ${r.trim().slice(0, 60)}`);
});
