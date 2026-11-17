// Lote D2a · Enlaces entre el grafo y el hardware: cableado en el portal (projects.json, tipos, panel del grafo, tabla
// alternativa, sección "Usado por" en la página de hardware). La lógica está en tests/d2a-hw-enlaces.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { HW_PAGINA, usoDePagina } from "../src/lib/hw-enlaces.ts";
import { JSDOM } from "jsdom";
import { transformSync } from "esbuild";

const leer = (p) => {
  assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `falta ${p}`);
  return readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
};
const PAGINA = "src/pages/[project]/[disciplina].astro";
const GRAFO = "src/pages/[project]/grafo.astro";
const SCRIPT = "src/scripts/hardware-editor.ts";
const COMPONENTE = "src/components/RoboticsGraph.tsx";
const HTML_CRUDO = /innerHTML|outerHTML|insertAdjacentHTML|set:html|document\.write/;

// Delimita la función completa (declaración → llave de cierre), contando llaves y saltando cadenas y comentarios.
function funcionCompleta(src, nombre) {
  const inicio = src.search(new RegExp(`function\\s+${nombre}\\s*\\(`));
  assert.ok(inicio >= 0, `falta function ${nombre}`);
  let i = src.indexOf("{", src.indexOf(")", inicio));
  let prof = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") i = src.indexOf("\n", i);
    else if (c === "/" && src[i + 1] === "*") i = src.indexOf("*/", i) + 1;
    else if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "{") prof++;
    else if (c === "}" && --prof === 0) return src.slice(inicio, i + 1);
  }
  assert.fail(`no se cerró function ${nombre}`);
}

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
  assert.doesNotMatch(src, HTML_CRUDO);
});

// ---------- página de hardware ----------
test("[disciplina].astro: datos de «Usado por» calculados en el build en un atributo data-* (sin set:html ni API nueva)", () => {
  const src = leer(PAGINA);
  assert.match(src, /import\s*\{[^}]*usadoPor[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/hw-enlaces(\.ts)?["']/);
  assert.match(src, /data-hw-usado-por=\{JSON\.stringify\(/);
  assert.doesNotMatch(src, HTML_CRUDO);
  assert.doesNotMatch(src, /is:inline/);
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
  const cuerpo = funcionCompleta(src, "pintarUsadoPor");
  assert.match(cuerpo, /usoDePagina\(/);
  assert.match(cuerpo, /secUsado\.hidden\s*=/, "la función delimitada llega hasta el final");
  assert.doesNotMatch(cuerpo, HTML_CRUDO, "solo textContent/createElement en todo pintarUsadoPor");
});

test("hardware-editor.ts: pintarUsadoPor no interpreta HTML en etiquetas (jsdom, payload <img onerror>)", () => {
  const ts = funcionCompleta(leer(SCRIPT), "pintarUsadoPor");
  const js = transformSync(ts, { loader: "ts" }).code;
  const { window } = new JSDOM("<!doctype html><div id=r></div><ul id=l></ul><section id=s hidden></section>");
  const d = window.document;
  const xss = "<img src=x onerror=alert(1)>";
  const root = d.getElementById("r");
  root.dataset.hwUsadoPor = JSON.stringify({
    pagina: [
      { id: "hw:a", label: xss, nodos: [{ id: "n", label: xss, href: "/uuv/grafo/?node=n", plan: true }] },
      { id: "hw:b", label: xss, nodos: [] },
    ],
  });
  const lista = d.getElementById("l");
  const sec = d.getElementById("s");
  const pintar = new Function("usoDePagina", "root", "listaUsado", "secUsado", "editando", "document", `${js}\nreturn pintarUsadoPor;`)(
    usoDePagina, root, lista, sec, false, d,
  );
  pintar("pagina");
  assert.equal(d.querySelectorAll("img").length, 0, "no se crea ningún <img>");
  assert.equal(lista.querySelectorAll("li").length, 2);
  assert.equal(lista.querySelector("strong").textContent, xss, "la etiqueta se muestra como texto");
  assert.equal(lista.querySelector("a").textContent, xss);
  assert.equal(sec.hidden, false);
});

test("global.css: estilos de «Usado por» con tokens del tema (claro y oscuro)", () => {
  const css = leer("src/styles/global.css");
  const m = css.match(/\.hw-usado-por[^{]*\{[^}]*\}/g);
  assert.ok(m && m.length, "faltan estilos .hw-usado-por");
  assert.doesNotMatch(m.join("\n"), /#[0-9a-fA-F]{3,8}\b/, "colores con var(--…), no fijos");
});
