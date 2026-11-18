// Criterio 17 (lote d1b): «Ver como lector» en las páginas de hardware. Solo presentación en el cliente: un atributo
// data-vista-lector en <html> y CSS que oculta los controles de editor; no cambia permisos ni la API, no se persiste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const pagina = leer("src/pages/[project]/[disciplina].astro");
const script = leer("src/scripts/hardware-editor.ts");
const css = leer("src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, "");

// Cuerpo de `function nombre(...) { ... }` (llaves balanceadas).
function cuerpo(src, nombre) {
  const i = src.search(new RegExp(`function\\s+${nombre}\\s*\\(`));
  if (i < 0) return null;
  let j = src.indexOf("{", i), prof = 0, k = j;
  for (; k < src.length; k++) { if (src[k] === "{") prof++; else if (src[k] === "}" && --prof === 0) break; }
  return src.slice(j, k + 1);
}

test("C17 página: botón «Ver como lector» en la barra de editor (junto a Editar/Borrar página)", () => {
  const barra = /<div class="hw-barra" data-hw-solo-editor hidden>([\s\S]*?)<\/div>/.exec(pagina)?.[1] ?? "";
  assert.match(barra, /<button type="button" class="btn" data-hw-ver-lector aria-pressed="false">Ver como lector<\/button>/);
  assert.match(barra, /data-hw-editar/);
  assert.match(barra, /data-hw-borrar/);
});

test("C17 página: aviso fijo role=status «Vista de lector» con botón de salida, fuera de los controles de editor", () => {
  const m = /<div class="hw-aviso-lector" data-hw-aviso-lector role="status">([\s\S]*?)<\/div>/.exec(pagina);
  assert.ok(m, "falta <div class=\"hw-aviso-lector\" data-hw-aviso-lector role=\"status\">");
  assert.match(m[1], /Vista de lector/);
  assert.match(m[1], /<button type="button" class="btn" data-hw-salir-lector>Salir de la vista de lector<\/button>/);
  assert.doesNotMatch(m[0], /data-hw-solo-editor|hidden/);
});

test("C17 CSS: con :root[data-vista-lector] se ocultan todos los controles de editor; el aviso solo se ve en esa vista", () => {
  const regla = /:root\[data-vista-lector\]\s*:is\(([^)]*)\)\s*\{([^}]*)\}/.exec(css);
  assert.ok(regla, "falta :root[data-vista-lector] :is(...) { display:none }");
  for (const s of ["[data-hw-solo-editor]", ".hw-mover", ".hw-restaurar", "[data-hw-inicializar]"]) {
    assert.ok(regla[1].split(",").map((x) => x.trim()).includes(s), `no oculta ${s}`);
  }
  assert.match(regla[2], /display:\s*none\s*!important/);
  assert.match(css, /(^|\})\s*\.hw-aviso-lector\s*\{[^}]*display:\s*none/);
  const visible = /:root\[data-vista-lector\]\s*\.hw-aviso-lector\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(visible, /display:\s*flex/);
  assert.match(visible, /position:\s*(fixed|sticky)/);
  assert.match(visible, /var\(--surface\)/);
  assert.match(visible, /color:\s*var\(--text\)/);
});

test("C17 script: entrar/salir alternan el atributo en <html> y no tocan hidden de controles sueltos ni guardan estado", () => {
  const entrar = cuerpo(script, "entrarVistaLector");
  const salir = cuerpo(script, "salirVistaLector");
  assert.ok(entrar && salir, "faltan entrarVistaLector/salirVistaLector");
  assert.match(entrar, /document\.documentElement\.(setAttribute\("data-vista-lector"|dataset\.vistaLector\s*=)/);
  assert.match(salir, /document\.documentElement\.(removeAttribute\("data-vista-lector"\)|dataset\.vistaLector\s*=\s*undefined|delete document\.documentElement\.dataset\.vistaLector)/);
  for (const [n, b] of [["entrar", entrar], ["salir", salir]]) {
    assert.doesNotMatch(b, /\.hidden\s*=/, `${n}: nada de hidden por control`);
    assert.doesNotMatch(b, /localStorage|sessionStorage|document\.cookie|fetch\(/, `${n}: sin persistencia ni API`);
  }
  assert.match(entrar, /if\s*\(\s*editando\b[^)]*\)\s*return/, "no disponible mientras se edita");
  assert.match(entrar, /aria-pressed/);
  assert.match(salir, /btnVerLector\.focus\(\)/, "salir devuelve el foco al botón");
  assert.match(entrar, /btnSalirLector\.focus\(\)/, "entrar lleva el foco al botón de salida del aviso");
  assert.match(script, /escuchar\(btnVerLector, "click", entrarVistaLector\)/);
  assert.match(script, /escuchar\(btnSalirLector, "click", salirVistaLector\)/);
});

test("C17 script: abrir el editor no es posible en vista de lector, y la vista no se persiste", () => {
  const abrir = cuerpo(script, "abrirEditor");
  assert.match(abrir, /data-vista-lector|dataset\.vistaLector|vistaLector/, "abrirEditor debe salir o ignorar la vista de lector");
  assert.doesNotMatch(script, /(localStorage|sessionStorage)[^\n]*(vista|lector)/i);
});
