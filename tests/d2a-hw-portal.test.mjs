// Lote D2a · Enlaces entre el grafo y el hardware: cableado en el portal (projects.json, tipos, panel del grafo, tabla
// alternativa, sección "Usado por" en la página de hardware). La lógica está en tests/d2a-hw-enlaces.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { HW_PAGINA } from "../src/lib/hw-enlaces.ts";

const leer = (p) => {
  assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `falta ${p}`);
  return readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
};
const PAGINA = "src/pages/[project]/[disciplina].astro";
const GRAFO = "src/pages/[project]/grafo.astro";
const SCRIPT = "src/scripts/hardware-editor.ts";
const COMPONENTE = "src/components/RoboticsGraph.tsx";

// ---------- configuración ----------
test("projects.json: uuv declara hwPaginas con hw:zed → electronica/sensores-actuadores y todo con formato válido", () => {
  const uuv = JSON.parse(leer("projects.json")).find((p) => p.id === "uuv");
  assert.ok(uuv.hwPaginas && typeof uuv.hwPaginas === "object" && !Array.isArray(uuv.hwPaginas), "falta hwPaginas");
  assert.equal(uuv.hwPaginas["hw:zed"], "electronica/sensores-actuadores");
  for (const [id, destino] of Object.entries(uuv.hwPaginas)) {
    assert.match(id, /^hw:/, id);
    assert.ok(HW_PAGINA.test(destino), `${id}: ${destino}`);
    assert.ok(Object.hasOwn(uuv.disciplinas, destino.split("/")[0]), `${id}: disciplina no configurada`);
  }
});

test("data.ts: ProjectSummary declara hwPaginas", () => {
  assert.match(leer("src/lib/data.ts"), /hwPaginas\?:\s*Record<string,\s*string>/);
});

test("graph.ts: GraphNode declara hwPagina y rosGraph usa enlacesHardware", () => {
  const src = leer("src/lib/graph.ts");
  assert.match(src, /hwPagina\?:\s*\{\s*href:\s*string;\s*etiqueta:\s*string;?\s*\}/);
  assert.match(src, /import\s*\{[^}]*enlacesHardware[^}]*\}\s*from\s*["']\.\/hw-enlaces(\.ts)?["']/);
});

// ---------- panel del grafo ----------
test("RoboticsGraph: el panel del nodo enlaza a su página de hardware con un <a> real (teclado y lector de pantalla)", () => {
  const src = leer(COMPONENTE);
  assert.match(src, /node\.hwPagina\s*&&\s*\(?\s*<a\b[^>]*href=\{node\.hwPagina\.href\}[^>]*>\s*\{node\.hwPagina\.etiqueta\}\s*<\/a>/);
  assert.doesNotMatch(src, /<a\b[^>]*href=\{node\.hwPagina\.href\}[^>]*target=/, "misma pestaña: es una página del portal");
});

// ---------- tabla alternativa ----------
test("grafo.astro: tabla de hardware con enlace al nodo (?node=) y a su página de Electrónica/Mecánica", () => {
  const src = leer(GRAFO);
  assert.match(src, /import\s*\{[^}]*enlacesHardware[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/hw-enlaces(\.ts)?["']/);
  assert.match(src, /category\s*===\s*["']hardware["']/);
  assert.match(src, /<h2[^>]*>\s*Hardware\s*<\/h2>/);
  assert.match(src, /<caption|aria-label|aria-labelledby/);
  assert.match(src, /\.etiqueta\}/, "el enlace muestra «Ver en Electrónica» o «Ver en Mecánica»");
  assert.doesNotMatch(src, /set:html/);
});

// ---------- página de hardware ----------
test("[disciplina].astro: datos de «Usado por» calculados en el build en un atributo data-* (sin set:html ni API nueva)", () => {
  const src = leer(PAGINA);
  assert.match(src, /import\s*\{[^}]*usadoPor[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/hw-enlaces(\.ts)?["']/);
  assert.match(src, /data-hw-usado-por=\{JSON\.stringify\(/);
  assert.doesNotMatch(src, /set:html|is:inline/);
});

test("[disciplina].astro: sección «Usado por» oculta por defecto, con encabezado y lista", () => {
  const src = leer(PAGINA);
  const m = src.match(/<section\b[^>]*data-hw-usado-por-seccion[^>]*>([^]*?)<\/section>/);
  assert.ok(m, "falta la sección data-hw-usado-por-seccion");
  assert.match(m[0], /\bhidden\b/);
  assert.match(m[0], /aria-labelledby="hw-usado-por-titulo"/);
  assert.match(m[1], /<h2 id="hw-usado-por-titulo">\s*Usado por\s*<\/h2>/);
  assert.match(m[1], /<ul\b[^>]*data-hw-usado-por-lista/);
  const pagina = src.match(/<section class="hw-pagina"[^]*?<\/section>\s*<\/main>/);
  assert.ok(pagina && pagina[0].includes("data-hw-usado-por-seccion"), "va dentro de la página, no en el editor ni en la barra lateral");
});

test("hardware-editor.ts: pinta «Usado por» con usoDePagina y DOM seguro, y la oculta al editar o sin datos", () => {
  const src = leer(SCRIPT);
  assert.match(src, /import\s*\{[^}]*usoDePagina[^}]*\}\s*from\s*["']\.\.\/lib\/hw-enlaces(\.ts)?["']/);
  assert.match(src, /usoDePagina\(\s*root\.dataset\.hwUsadoPor/);
  assert.match(src, /\[data-hw-usado-por-seccion\]/);
  const desde = src.indexOf("usoDePagina(");
  const trozo = src.slice(desde, desde + 1500);
  assert.doesNotMatch(trozo, /innerHTML|insertAdjacentHTML|outerHTML/, "solo textContent/createElement");
});

test("global.css: estilos de «Usado por» con tokens del tema (claro y oscuro)", () => {
  const css = leer("src/styles/global.css");
  const m = css.match(/\.hw-usado-por[^{]*\{[^}]*\}/g);
  assert.ok(m && m.length, "faltan estilos .hw-usado-por");
  assert.doesNotMatch(m.join("\n"), /#[0-9a-fA-F]{3,8}\b/, "colores con var(--…), no fijos");
});
