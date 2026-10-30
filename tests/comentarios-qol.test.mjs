// Lote "QoL de comentarios", parte interfaz: @menciones (lib/menciones.mjs, compartido por API e interfaz), lógica pura
// del panel y del contador de la SideNav (src/lib/comentarios.ts) y comprobaciones estáticas de la página
// /<proyecto>/comentarios/, los scripts y los estilos (CSP por hash, DOM sin innerHTML, tokens).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const leer = (p) => {
  assert.ok(exists(p), `falta ${p}`);
  return read(p);
};
const PAGINA = "src/pages/[project]/comentarios.astro";
const PANEL = "src/scripts/panel-comentarios.ts";
const NAV = "src/scripts/contador-nav.ts";
const SCRIPT = "src/scripts/comentarios.ts";
const SIDENAV = "src/components/SideNav.astro";

async function importar(p) {
  try {
    return { mod: await import(p), fallo: null };
  } catch (e) {
    return { mod: null, fallo: e };
  }
}
const men = await importar("../lib/menciones.mjs");
const lib = await importar("../src/lib/comentarios.ts");
const M = () => {
  assert.ok(men.mod, `falta lib/menciones.mjs (${men.fallo?.code ?? men.fallo?.message})`);
  return men.mod;
};
const L = (...fns) => {
  assert.ok(lib.mod, `falta src/lib/comentarios.ts (${lib.fallo?.code ?? lib.fallo?.message})`);
  for (const f of fns) assert.equal(typeof lib.mod[f], "function", `src/lib/comentarios.ts no exporta ${f}`);
  return lib.mod;
};

// ---------- 1. @menciones ----------
test("extraerMenciones: logins de GitHub válidos tras @ (inicio o no-palabra), en minúsculas, sin repetir y en orden", () => {
  const { extraerMenciones } = M();
  assert.equal(typeof extraerMenciones, "function");
  assert.deepEqual(extraerMenciones("hola @ana y @Beto-2, ¿y @ANA?"), ["ana", "beto-2"]);
  assert.deepEqual(extraerMenciones("@inicio (@paren) [@corchete] @fin."), ["inicio", "paren", "corchete", "fin"]);
  assert.deepEqual(extraerMenciones("correo ana@vanttec.mx o a.b@c"), [], "un correo no es mención");
  assert.deepEqual(extraerMenciones("@-guion @guion- @a--b"), [], "guion al inicio, al final o doble no es login válido");
  assert.deepEqual(extraerMenciones(`@${"a".repeat(39)} @${"b".repeat(40)}`), ["a".repeat(39)], "máximo 39 caracteres");
  assert.deepEqual(extraerMenciones("@ solo arroba y @@doble"), []);
  assert.deepEqual(extraerMenciones(""), []);
  assert.deepEqual(extraerMenciones(null), []);
});

test("partirMenciones: trozos {texto, mencion} que al unirse reproducen el texto exacto; no genera HTML", () => {
  const { partirMenciones } = M();
  assert.equal(typeof partirMenciones, "function");
  const t = "cc @Ana: revisa <b>esto</b> con @beto\ny ana@x.com";
  const trozos = partirMenciones(t);
  assert.equal(trozos.map((x) => x.texto).join(""), t, "sin perder ni cambiar nada");
  assert.deepEqual(trozos.filter((x) => x.mencion).map((x) => [x.texto, x.mencion]), [["@Ana", "ana"], ["@beto", "beto"]]);
  assert.ok(trozos.every((x) => x.mencion === null || typeof x.mencion === "string"));
  assert.ok(trozos.some((x) => x.texto.includes("<b>esto</b>") && x.mencion === null), "el HTML queda como texto plano");
  assert.deepEqual(partirMenciones("sin menciones"), [{ texto: "sin menciones", mencion: null }]);
  assert.deepEqual(partirMenciones(""), []);
});

test("mencionaA: compara sin mayúsculas con yo; sin yo nunca", () => {
  const { mencionaA } = M();
  assert.equal(typeof mencionaA, "function");
  assert.equal(mencionaA("hola @CyuxSz", "cyuxsz"), true);
  assert.equal(mencionaA("hola @cyuxsz2", "cyuxsz"), false);
  assert.equal(mencionaA("hola @ana", null), false);
  assert.equal(mencionaA("correo cyuxsz@x.com", "cyuxsz"), false);
});

test("una sola fuente: la API importa lib/menciones.mjs y la interfaz la reexporta o importa (sin regex duplicada)", () => {
  assert.match(read("lib/comentarios-core.mjs"), /from\s+["']\.\/menciones\.mjs["']/);
  assert.match(leer(SCRIPT), /partirMenciones/);
  assert.match(read("src/lib/comentarios.ts") + leer(SCRIPT), /lib\/menciones(\.mjs)?["']/);
});

// ---------- 2. Lógica del panel ----------
const hilo = (id, extra = {}) => ({ id, tipo: "duda", autor: "ana", creado: "2026-10-30T12:00:00.000Z", extracto: `texto ${id}`, menciones: [], ...extra });
const resp = () => ({
  yo: "Beto",
  proyecto: "uuv",
  truncado: false,
  paginas: [
    { pagina: "/uuv/a/", abiertos: 3, hilos: [hilo("1"), hilo("2", { autor: "BETO", tipo: "bug" }), hilo("3", { menciones: ["beto", "carla"] })] },
    { pagina: "/uuv/b/", abiertos: 1, hilos: [hilo("4", { tipo: "sugerencia" })] },
  ],
});

test("filtrarPanel: por tipo y por quién (todos, míos, me mencionan) sin mayúsculas; quita páginas vacías; no muta", () => {
  const { filtrarPanel } = L("filtrarPanel");
  const r = resp();
  const copia = structuredClone(r);
  const ids = (ps) => ps.flatMap((p) => p.hilos.map((h) => h.id));
  assert.deepEqual(ids(filtrarPanel(r.paginas, { tipo: "todos", quien: "todos" }, r.yo)), ["1", "2", "3", "4"]);
  assert.deepEqual(ids(filtrarPanel(r.paginas, { tipo: "bug", quien: "todos" }, r.yo)), ["2"]);
  assert.deepEqual(ids(filtrarPanel(r.paginas, { tipo: "todos", quien: "mios" }, r.yo)), ["2"]);
  assert.deepEqual(ids(filtrarPanel(r.paginas, { tipo: "todos", quien: "mencion" }, r.yo)), ["3"]);
  assert.deepEqual(filtrarPanel(r.paginas, { tipo: "sugerencia", quien: "mios" }, r.yo), [], "sin hilos no quedan páginas");
  assert.deepEqual(filtrarPanel(r.paginas, { tipo: "todos", quien: "mios" }, null), [], "sin yo no hay míos");
  assert.deepEqual(ids(filtrarPanel(r.paginas, { tipo: "inventado", quien: "x" }, r.yo)), ["1", "2", "3", "4"], "valores desconocidos = todos");
  assert.deepEqual(r, copia);
  assert.deepEqual(filtrarPanel(null, { tipo: "todos", quien: "todos" }, "x"), []);
});

test("urlProyecto, enlaceHilo y contadoresNav", () => {
  const { urlProyecto, enlaceHilo, contadoresNav } = L("urlProyecto", "enlaceHilo", "contadoresNav");
  assert.equal(urlProyecto("uuv"), "/api/comentarios/?proyecto=uuv");
  assert.equal(urlProyecto("a b"), "/api/comentarios/?proyecto=a%20b");
  assert.equal(enlaceHilo("/uuv/a/", "00000000-0000-4000-8000-000000000001"), "/uuv/a/#comentario-00000000-0000-4000-8000-000000000001");
  assert.deepEqual(contadoresNav(resp()), { "/uuv/a/": 3, "/uuv/b/": 1 });
  const raro = { paginas: [{ pagina: "/uuv/a/", abiertos: "3" }, { pagina: "/uuv/b/", abiertos: 0 }, { pagina: 5, abiertos: 2 }, null, { pagina: "/uuv/c/", abiertos: 2.5 }] };
  assert.deepEqual(contadoresNav(raro), {}, "solo enteros > 0 con ruta string");
  assert.deepEqual(contadoresNav(null), {});
});

test("etiquetaContador: singular y plural para aria-label", () => {
  const { etiquetaContador } = L("etiquetaContador");
  assert.equal(etiquetaContador(1), "1 comentario abierto");
  assert.equal(etiquetaContador(4), "4 comentarios abiertos");
});

test("caché de la SideNav: clave por proyecto, TTL de 60 s; JSON roto, caducado o del futuro → null", () => {
  const { claveCacheNav, escribirCacheNav, leerCacheNav } = L("claveCacheNav", "escribirCacheNav", "leerCacheNav");
  assert.equal(claveCacheNav("uuv"), "comentarios:nav:uuv");
  const t = 1_000_000;
  const datos = { "/uuv/a/": 2 };
  const raw = escribirCacheNav(datos, t);
  assert.equal(typeof raw, "string");
  assert.deepEqual(leerCacheNav(raw, t + 59_000), datos);
  assert.equal(leerCacheNav(raw, t + 60_001), null, "caducado");
  assert.equal(leerCacheNav(raw, t - 5_000), null, "marca del futuro");
  for (const malo of [null, "", "{", "null", "[]", JSON.stringify({ t, d: "x" }), JSON.stringify({ d: datos })]) assert.equal(leerCacheNav(malo, t), null, String(malo));
});

// ---------- 3. Página /<proyecto>/comentarios/ ----------
test("comentarios.astro: una página por proyecto con Base, SideNav marcada y fuera de Pagefind", () => {
  const src = leer(PAGINA);
  assert.match(src, /export function getStaticPaths\(\)[^]*builtProjects\(\)/);
  assert.match(src, /import Base from "\.\.\/\.\.\/layouts\/Base\.astro"/);
  assert.match(src, /<SideNav\b[^>]*currentRoute=\{route\}/);
  assert.match(src, /const route = `\/\$\{p\.id\}\/comentarios\/`/);
  assert.match(src, /<h1>Comentarios abiertos<\/h1>/);
  assert.doesNotMatch(src, /data-pagefind-body/);
  assert.doesNotMatch(src, /is:inline/);
  assert.match(src, /<script>[^]*import\s+["']\.\.\/\.\.\/scripts\/panel-comentarios(\.ts)?["'][^]*<\/script>/);
});

test("comentarios.astro: contenedor con proyecto, filtros con label (tipo y quién), estado aria-live y lista", () => {
  const src = leer(PAGINA);
  assert.match(src, /data-panel-comentarios[^>]*data-proyecto=\{p\.id\}|data-proyecto=\{p\.id\}[^>]*data-panel-comentarios/);
  assert.match(src, /<label[^>]*for="panel-tipo"/);
  assert.match(src, /<select[^>]*id="panel-tipo"/);
  for (const [v, t] of [["todos", "Todos los tipos"], ["duda", "Duda"], ["aclaracion", "Aclaración"], ["sugerencia", "Sugerencia"], ["bug", "Bug"]]) {
    assert.match(src, new RegExp(`<option value="${v}"[^>]*>${t}</option>`), v);
  }
  assert.match(src, /<label[^>]*for="panel-quien"/);
  assert.match(src, /<select[^>]*id="panel-quien"/);
  for (const [v, t] of [["todos", "Todos"], ["mios", "Solo míos"], ["mencion", "Me mencionan"]]) {
    assert.match(src, new RegExp(`<option value="${v}"[^>]*>${t}</option>`), v);
  }
  assert.match(src, /aria-live="polite"/);
  assert.match(src, /Cargando comentarios/);
  assert.match(src, /data-panel-lista/);
});

test("panel-comentarios.ts: una petición no-store por proyecto, filtra con la lógica pura y pinta con DOM seguro", () => {
  const src = leer(PANEL);
  assert.match(src, /from\s+["']\.\.\/lib\/comentarios(\.ts)?["']/);
  for (const f of ["urlProyecto", "filtrarPanel", "enlaceHilo", "tipoInfo", "fechaRelativa", "mensajeError", "contadoresNav"]) assert.match(src, new RegExp(`\\b${f}\\b`), f);
  assert.match(src, /cache:\s*["']no-store["']/);
  assert.match(src, /credentials:\s*["']same-origin["']/);
  assert.doesNotMatch(src, /fetch\(\s*["'`]https?:/);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML\s*=|document\.write|\beval\(|new Function/);
  assert.match(src, /textContent/);
  assert.match(src, /createElement\(\s*["']a["']\s*\)/);
  assert.match(src, /createElement\(\s*["']time["']\s*\)/);
  assert.match(src, /addEventListener\(\s*["']change["']/, "los filtros reaccionan sin recargar");
  assert.match(src, /No hay comentarios abiertos/);
  assert.match(src, /truncado/);
  assert.match(src, /mensajeError\(\s*["']red["']/);
});

// ---------- 4. Contador en la SideNav ----------
test("SideNav: enlace a Comentarios abiertos marcado con aria-current e importa el contador", () => {
  const src = read(SIDENAV);
  assert.match(src, /href=\{`\/\$\{projectId\}\/comentarios\/`\}[^>]*>Comentarios abiertos</);
  assert.match(src, /aria-current=\{currentRoute === `\/\$\{projectId\}\/comentarios\/` \? "page" : undefined\}/);
  assert.match(src, /import\s+["']\.\.\/scripts\/contador-nav(\.ts)?["']/);
  assert.doesNotMatch(src, /is:inline/);
});

test("contador-nav.ts: sessionStorage con try/catch, una petición, badge con role=img y aria-label, sin innerHTML", () => {
  const src = leer(NAV);
  for (const f of ["urlProyecto", "claveCacheNav", "leerCacheNav", "escribirCacheNav", "contadoresNav", "etiquetaContador"]) assert.match(src, new RegExp(`\\b${f}\\b`), f);
  assert.match(src, /try\s*\{[^]*sessionStorage[^]*\}\s*catch/);
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1, "una sola petición por carga");
  assert.match(src, /data-panel-comentarios/, "en la página del panel no pide de nuevo: usa los datos del panel");
  assert.match(src, /setAttribute\(\s*["']role["']\s*,\s*["']img["']\s*\)/);
  assert.match(src, /setAttribute\(\s*["']aria-label["']/);
  assert.match(src, /nav-contador/);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML\s*=|document\.write/);
});

// ---------- 5. Menciones en el render y enlace directo ----------
test("comentarios.ts: pinta las menciones como span.mencion con textContent y abre el hilo de #comentario-<id>", () => {
  const src = leer(SCRIPT);
  assert.match(src, /\bpartirMenciones\b/);
  assert.match(src, /["']mencion["']/);
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML\s*=/);
  assert.match(src, /location\.hash/);
  assert.match(src, /#comentario-|comentario-/);
  assert.match(src, /scrollIntoView|\.focus\(/);
});

test("comentarios.ts: tras escribir invalida la caché del contador de la SideNav", () => {
  const src = leer(SCRIPT);
  assert.match(src, /claveCacheNav/);
  assert.match(src, /try\s*\{[^]*sessionStorage\.removeItem[^]*\}\s*catch/);
});

// ---------- 6. Estilos ----------
test("global.css: .mencion, .nav-contador (absoluto, sin mover el layout) y panel con tokens", () => {
  const css = read("src/styles/global.css");
  assert.match(css, /\.mencion\b[^{]*\{[^}]*var\(--/);
  assert.match(css, /\.nav-contador\b[^{]*\{[^}]*position:\s*absolute/);
  assert.match(css, /\.panel-comentarios\b/);
  const reglas = css
    .replace(/@media print\s*\{[^]*?\n\}/, "")
    .split("\n")
    .filter((l) => /\.mencion|\.nav-contador|\.panel-comentarios/.test(l));
  assert.ok(reglas.length > 0);
  for (const l of reglas) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
});

test("CSP: sigue con solo el hash del tema", () => {
  assert.match(read("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
});
