// Lote 1b: interfaz de hardware (estático sobre fuentes). Ruta /<proyecto>/<disciplina>/ (shell que carga por la API con
// ?p=<slug>), script empaquetado (CSP por hash, sin inline), DOM seguro, editor, subida a Vercel Blob, comentarios por
// página, estilos con tokens y servidor de prueba local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const leer = (p) => {
  assert.ok(exists(p), `falta ${p}`);
  return readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
};
const PAGINA = "src/pages/[project]/[disciplina].astro";
const SCRIPT = "src/scripts/hardware-editor.ts";

// ---------- ruta ----------
test("[disciplina].astro: getStaticPaths solo para proyectos construidos con disciplinas configuradas", () => {
  const src = leer(PAGINA);
  assert.match(src, /export (async )?function getStaticPaths/);
  assert.match(src, /builtProjects\(\)/);
  assert.match(src, /disciplinas/);
  assert.match(src, /params:\s*\{\s*project:[^}]*disciplina:/);
  assert.doesNotMatch(src, /editores/, "la página no toca la lista de editores");
  assert.doesNotMatch(src, /is:inline|set:html|style=/, "sin inline ni HTML crudo ni estilos en línea");
});

test("[disciplina].astro: Base con projectNav y current=disciplina; datos para el script; reutiliza las barras", () => {
  const src = leer(PAGINA);
  assert.match(src, /<Base\b[^>]*project=\{projectNav\(p\)\}[^>]*current=\{disciplina\}|<Base\b[^>]*current=\{disciplina\}[^>]*project=\{projectNav\(p\)\}/);
  assert.match(src, /data-hw-proyecto=\{p\.id\}/);
  assert.match(src, /data-hw-disciplina=\{disciplina\}/);
  assert.match(src, /class="doc doc-wiki"/);
  assert.match(src, /data-barra="izq"/);
  assert.match(src, /<nav[^>]*class="sidenav"[^>]*id="barra-izq"|<nav[^>]*id="barra-izq"[^>]*class="sidenav"/);
  assert.match(src, /<main id="contenido" tabindex="-1">/);
  assert.match(src, /<script>[^]*import\s+["']\.\.\/\.\.\/scripts\/hardware-editor(\.ts)?["'][^]*<\/script>/);
  assert.match(src, /import\s+["']\.\.\/\.\.\/scripts\/barras(\.ts)?["']/);
});

test("[disciplina].astro: estados con aria-live, vacío con Inicializar, metadatos y controles con nombre accesible", () => {
  const src = leer(PAGINA);
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /Inicializar desde plantilla/);
  for (const t of ["Editar", "Guardar", "Cancelar", "Adjuntar", "Nueva página", "Historial", "Vista previa"]) assert.match(src, new RegExp(t), t);
  assert.match(src, /<textarea[^>]*id="hw-md"/);
  assert.match(src, /<label[^>]*for="hw-md"/);
  assert.match(src, /<input[^>]*type="file"[^>]*id="hw-archivo"|<input[^>]*id="hw-archivo"[^>]*type="file"/);
  assert.match(src, /<label[^>]*for="hw-archivo"/);
  assert.match(src, /<progress\b/);
  assert.match(src, /data-hw-autor/);
  assert.match(src, /data-hw-actualizado/);
  assert.match(src, /data-hw-version/);
  assert.match(src, /<dialog[^>]*id="hw-borrar"/, "confirmación de borrado en <dialog>");
  assert.match(src, /<dialog[^>]*id="hw-nueva"/, "crear página: diálogo con título");
  assert.match(src, /role="alert"/, "errores anunciados");
});

test("[disciplina].astro: comentarios con clave por página que el script fija antes de cargarlos", () => {
  const src = leer(PAGINA);
  assert.match(src, /import Comentarios from "\.\.\/\.\.\/components\/Comentarios\.astro"/);
  assert.match(src, /<Comentarios\b[^>]*pagina=/);
  const js = leer(SCRIPT);
  assert.match(js, /clavePagina\(/);
  assert.match(js, /dataset\.pagina\s*=/);
  assert.match(js, /await import\(\s*["']\.\/comentarios(\.ts)?["']\s*\)/, "comentarios se importan después de fijar data-pagina");
  assert.doesNotMatch(leer(PAGINA), /scripts\/comentarios/, "no se importan de forma estática en la página");
});

// ---------- script ----------
test("hardware-editor.ts: lógica en src/lib/hardware-editor.ts; fetch same-origin sin caché a /api/hardware/", () => {
  const js = leer(SCRIPT);
  assert.match(js, /from\s+["']\.\.\/lib\/hardware-editor(\.ts)?["']/);
  assert.match(js, /\/api\/hardware\//);
  assert.match(js, /credentials:\s*["']same-origin["']/);
  assert.match(js, /cache:\s*["']no-store["']/);
  assert.match(js, /\.editable\b/, "usa `editable` del índice");
  assert.doesNotMatch(js, /editores/);
  for (const a of ["inicializar", "crear", "reordenar", "restaurar", "previsualizar"]) assert.match(js, new RegExp(`accion:\\s*["']${a}["']`), a);
  assert.match(js, /"PUT"/);
  assert.match(js, /"DELETE"/);
  assert.match(js, /revisiones=1|revisiones:\s*["']1["']/);
  assert.match(js, /version/);
});

test("hardware-editor.ts: DOM seguro; el html del API entra solo por DOMParser en un único punto", () => {
  const js = leer(SCRIPT);
  assert.doesNotMatch(js, /\.innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write/);
  assert.equal((js.match(/new DOMParser\(\)/g) ?? []).length, 1, "un único punto de entrada de HTML");
  assert.match(js, /textContent/);
});

test("hardware-editor.ts: el error de guardado sale de resultadoGuardado (409 conserva el texto; ver fase1b-cubic.test.mjs)", () => {
  assert.match(leer(SCRIPT), /resultadoGuardado\(r\.status\)\.mensaje/);
});

test("hardware-editor.ts: subida con upload() de @vercel/blob/client, privada, a /api/archivos/ con pathname canónico", () => {
  const js = leer(SCRIPT);
  assert.match(js, /import\s*\{[^}]*\bupload\b[^}]*\}\s*from\s*["']@vercel\/blob\/client["']|import\(\s*["']@vercel\/blob\/client["']\s*\)/);
  assert.match(js, /handleUploadUrl:\s*["']\/api\/archivos\/["']/);
  assert.match(js, /access:\s*["']private["']/);
  assert.match(js, /rutaBlob\(/);
  assert.match(js, /crypto\.randomUUID\(\)/);
  assert.match(js, /clientPayload:\s*JSON\.stringify\(/);
  assert.match(js, /onUploadProgress/);
  assert.match(js, /validarArchivo\(/);
  assert.match(js, /enlaceArchivo\(/);
  assert.match(js, /["']paste["']/);
  assert.match(js, /["']drop["']/);
  assert.match(js, /["']dragover["']/);
});

// ---------- comentarios abiertos ----------
test("panel de comentarios: enlaza los hilos de hardware a /<p>/<disc>/?p=<slug> (data-disciplinas)", () => {
  assert.match(leer("src/pages/[project]/comentarios.astro"), /data-disciplinas=/);
  const panel = leer("src/scripts/panel-comentarios.ts");
  assert.match(panel, /dataset\.disciplinas/);
  assert.match(panel, /enlaceHilo\([^)]*,[^)]*,[^)]*\)/);
});

// ---------- estilos ----------
test("global.css: reglas .hw-* con tokens (sin colores fijos), foco visible y ajuste a 375 px", () => {
  const css = leer("src/styles/global.css");
  const reglas = css.split("\n").filter((l) => /\.hw-/.test(l));
  assert.ok(reglas.length > 0, "faltan reglas .hw-* en global.css");
  for (const l of reglas) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
  assert.match(css, /\.hw-[a-z-]+[^{]*:focus-visible/);
  assert.match(css, /@media \(max-width: (4[0-9]{2}|[5-8][0-9]{2})px\)\s*\{[^]*?\.hw-/);
});

// ---------- servidor de prueba ----------
test("tests/fixtures/servidor-hardware.mjs: sirve dist/ y monta los handlers reales con Redis en memoria y Blob falso, solo en 127.0.0.1", () => {
  const src = leer("tests/fixtures/servidor-hardware.mjs");
  assert.match(src, /lib\/hardware-core\.mjs/);
  assert.match(src, /lib\/archivos-core\.mjs/);
  assert.match(src, /lib\/comentarios-core\.mjs/);
  assert.match(src, /fakeRedis/);
  assert.match(src, /dist/);
  assert.match(src, /127\.0\.0\.1/);
  assert.match(src, /__blob/, "endpoint local que imita la API de Blob para probar la subida");
  assert.doesNotMatch(src, /0\.0\.0\.0/);
});

// ---------- correcciones de la verificación en navegador ----------
test("script: inicialización idempotente, listeners con señal de aborto y preguntar() siempre se resuelve", () => {
  const src = leer(SCRIPT);
  assert.match(src, /__hwCtl\?\.abort\(\)/, "la instancia anterior se limpia");
  assert.match(src, /astro:before-swap/);
  const fuera = src.split(/\r?\n/).filter((l) => !/const escuchar|astro:before-swap/.test(l)).join("\n").replace(/function preguntar[^]*?\r?\n  \}\r?\n/, "");
  assert.doesNotMatch(fuera, /\.addEventListener\(/, "fuera de preguntar() todo listener pasa por escuchar()");
  const preg = /function preguntar[^]*?\r?\n  \}\r?\n/.exec(src)?.[0] ?? "";
  assert.match(preg, /fin\(true\)/);
  assert.match(preg, /senal\.aborted/);
  assert.match(preg, /catch\s*\{\s*fin\(false\)/, "showModal que falla no deja la promesa colgada");
});

test("script: cada acción limpia el estado aria-live al empezar", () => {
  const src = leer(SCRIPT);
  for (const ancla of ['escuchar(form, "submit"', "escuchar(btnBorrar", 'accion: "reordenar"', "async function subir"]) {
    const i = src.indexOf(ancla);
    assert.ok(i > 0, ancla);
    assert.match(src.slice(Math.max(0, i - 200), i + 400), /mostrarEstado\(""\)/, `${ancla} limpia el estado`);
  }
});

test("script: la subida nunca falla en silencio (todo en try/catch, aborta sin avance, limpia progreso)", () => {
  const src = leer(SCRIPT);
  const sub = /async function subir\(archivo[^]*?\r?\n  \}\r?\n/.exec(src)?.[0] ?? "";
  assert.match(sub, /try \{[^]*validarArchivo[^]*upload\([^]*catch \(err\)[^]*errorEditor\([^]*finally/);
  assert.match(sub, /abortSignal/);
  assert.match(sub, /progreso\.value = 0;\s*progreso\.hidden = true/);
});

test("Base: el pie de disciplina no dice que todo vive en openwiki/; las pestañas llevan la activa a la vista", () => {
  const base = leer("src/layouts/Base.astro");
  assert.match(base, /esDisciplina/);
  assert.match(base, /se edita en la propia web/);
  assert.match(base, /\.ptabs a\[aria-current\]"\)[^]*scrollLeft[^]*prefers-reduced-motion/);
});

test("servidor de prueba: reescribe la URL de Blob al servir .js y lo documenta en la cabecera", () => {
  const srv = leer("tests/fixtures/servidor-hardware.mjs");
  assert.match(srv, /replaceAll\("https:\/\/vercel\.com\/api\/blob"/);
  assert.match(srv.split("import {")[0], /reescribe/);
});
