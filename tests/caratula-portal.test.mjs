// Carátula del proyecto (lote 1): /<id>/ es la carátula (Software · Electrónica · Mecánica) y la portada de
// software se mueve a /<id>/software/. Comprobaciones sobre el código fuente (el build necesita .content/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ruta = (rel) => new URL(`../${rel}`, import.meta.url);
const read = (rel) => readFileSync(ruta(rel), "utf8");
const leerSiExiste = (rel) => (existsSync(ruta(rel)) ? read(rel) : "");

const CARATULA = "src/pages/[project]/index.astro";
const SOFTWARE = "src/pages/[project]/software.astro";
const BASE = "src/layouts/Base.astro";
const SCRIPT = "src/scripts/caratula.ts";

// ---------- /<id>/software/: la portada de software, movida ----------

test("software.astro existe, solo para proyectos construidos, con current=\"resumen\"", () => {
  assert.ok(existsSync(ruta(SOFTWARE)), `falta ${SOFTWARE}`);
  const s = read(SOFTWARE);
  const paths = s.slice(s.indexOf("getStaticPaths"), s.indexOf("}", s.indexOf("getStaticPaths")) + 1);
  assert.match(paths, /builtProjects\(\)/);
  assert.match(s, /current="resumen"/);
});

test("software.astro conserva la portada: cifras, Empieza aquí, Configuraciones, Paquetes, Diagramas, Novedades, Favoritos, Continuar", () => {
  const s = leerSiExiste(SOFTWARE);
  for (const t of ['class="stats stats-proyecto"', "Empieza aquí", "Configuraciones", "Paquetes", "Diagramas", "Novedades", "data-favoritos-lista", "data-continuar-visita", "VehicleArt"]) {
    assert.ok(s.includes(t), `software.astro: falta ${t}`);
  }
  assert.match(s, /data-pagefind-filter="tipo\[content\]" content="Resumen"/, "sigue siendo el «Resumen» en la búsqueda");
  assert.match(s, /import\s+["']\.\.\/\.\.\/scripts\/personal(\.ts)?["']/);
});

test("software.astro: cada bloque tiene el id de su ancla (para redirigir las anclas viejas)", () => {
  const s = leerSiExiste(SOFTWARE);
  for (const a of ["empieza", "configuraciones", "paquetes", "diagramas", "novedades", "favoritos"]) {
    assert.match(s, new RegExp(`<section[^>]*\\bid="${a}"`), `falta <section id="${a}">`);
  }
});

test("software.astro: «Continuar» cae en /<id>/software/ y no en la carátula", () => {
  const s = leerSiExiste(SOFTWARE);
  const a = s.match(/<a[^>]*data-continuar-visita[^>]*>/)?.[0] ?? "";
  assert.match(a, /href=\{`\/\$\{p\.id\}\/software\/`\}/);
});

// ---------- /<id>/: carátula ----------

test("carátula: tarjetas de tarjetasCaratula, arte del vehículo y current=\"caratula\"", () => {
  const s = read(CARATULA);
  assert.match(s, /import\s*\{[^}]*tarjetasCaratula[^}]*\}\s*from\s*["']\.\.\/\.\.\/lib\/data["']/);
  assert.match(s, /class="caratula"/);
  assert.match(s, /<VehicleArt\b/);
  assert.match(s, /current="caratula"/);
  assert.match(s, /tarjetasCaratula\(p\)\.map\(/);
});

test("carátula: ya no contiene la portada de software", () => {
  const s = read(CARATULA);
  for (const t of ["Empieza aquí", "Configuraciones", "data-favoritos-lista", "data-continuar-visita", "<SideNav"]) {
    assert.ok(!s.includes(t), `la carátula no debe llevar ${t}`);
  }
  assert.doesNotMatch(s, /content="Resumen"/, "el «Resumen» de la búsqueda es /<id>/software/");
});

test("carátula: la tarjeta Software muestra páginas, afirmaciones y nodos del build", () => {
  const s = read(CARATULA);
  assert.match(s, /data-caratula="software"/);
  assert.match(s, /p\.pages/);
  assert.match(s, /p\.claims/);
  assert.match(s, /conteoNodos\(/);
});

test("carátula: tarjetas de hardware son enlaces con hueco reservado para las cifras", () => {
  const s = read(CARATULA);
  assert.match(s, /<a[^>]*class="card caratula-card"[^>]*href=\{t\.href\}/);
  assert.match(s, /data-caratula-hw=\{t\.id\}/);
  assert.match(s, /data-proyecto=\{p\.id\}/);
  assert.match(s, /<span class="card-meta caratula-cifras" data-caratula-cifras[^>]*>/);
  const css = read("src/styles/global.css");
  const r = [...css.matchAll(/\.caratula-cifras[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  assert.match(r, /min-height:/, "sin layout shift: la línea de cifras reserva su alto");
});

test("carátula: proyecto sin disciplinas redirige a /<id>/software/ sin romper «atrás»", () => {
  const s = read(CARATULA);
  assert.match(s, /<meta\s+http-equiv="refresh"\s+content=\{`0;\s*url=\/\$\{p\.id\}\/software\/`\}/);
  assert.match(s, /href=\{`\/\$\{p\.id\}\/software\/`\}/, "enlace visible por si el refresh está bloqueado");
  const js = leerSiExiste(SCRIPT);
  assert.match(js, /location\.replace\(/, "replace: la carátula no queda en el historial");
});

test("carátula: scripts procesados por Astro (CSP por hash), sin is:inline", () => {
  const s = read(CARATULA);
  assert.doesNotMatch(s, /is:inline/);
  assert.match(s, /<script>[^]*import\s+["']\.\.\/\.\.\/scripts\/caratula(\.ts)?["'][^]*<\/script>/);
});

test("scripts/caratula.ts: redirige anclas viejas y pide el índice a /api/hardware/ con la sesión", () => {
  const js = leerSiExiste(SCRIPT);
  assert.ok(js, `falta ${SCRIPT}`);
  assert.match(js, /from\s+["']\.\.\/lib\/caratula(\.ts)?["']/);
  assert.match(js, /redirigirAncla\(/);
  assert.match(js, /datosTarjeta\(/);
  assert.match(js, /textoCifras\(/);
  assert.match(js, /\/api\/hardware\/\?/);
  assert.match(js, /credentials:\s*["']same-origin["']/);
  assert.doesNotMatch(js, /innerHTML/, "las cifras se escriben con textContent");
});

// ---------- cabeceras: Base.astro ----------

test("Base.astro: current admite caratula; las pestañas de software no pintan disciplinas", () => {
  const src = read(BASE);
  const m = src.match(/current\?:\s*([^;\n]+)/);
  for (const v of ["resumen", "wiki", "grafo", "electronica", "mecanica", "caratula"]) assert.match(m?.[1] ?? "", new RegExp(`"${v}"`), `current incluye "${v}"`);
  const tabs = src.match(/<nav class="ptabs"[^]*?<\/nav>/)?.[0] ?? "";
  assert.ok(tabs, "sigue habiendo .ptabs");
  assert.doesNotMatch(tabs, /disciplinas/);
  assert.match(tabs, /href=\{`\/\$\{project\.id\}\/software\/`\}[^>]*>Resumen</);
});

test("Base.astro: .ptabs solo en páginas de software (ni carátula ni Electrónica/Mecánica)", () => {
  const src = read(BASE);
  assert.match(src, /const pestanasSoftware = [^;\n]*/);
  const def = src.match(/const pestanasSoftware = ([^;\n]*)/)?.[1] ?? "";
  for (const v of ["caratula", "electronica", "mecanica"]) assert.ok(def.includes(v) || def.includes("esDisciplina"), `pestanasSoftware excluye ${v}`);
  assert.match(src, /\{project && pestanasSoftware && \(\s*<nav class="ptabs"/);
});

test("Base.astro: Electrónica/Mecánica llevan cabecera propia con vuelta a la carátula", () => {
  const src = read(BASE);
  const head = src.match(/<nav class="phead"[^]*?<\/nav>/)?.[0] ?? "";
  assert.ok(head, "falta <nav class=\"phead\">");
  assert.match(head, /href=\{`\/\$\{project\.id\}\/`\}/);
  assert.match(head, /aria-current="page"/);
  assert.match(src, /esDisciplina && \(\s*<nav class="phead"/);
});

test("Base.astro: Diagramas apunta a /<id>/software/#diagramas y recibe aria-current por ancla", () => {
  const src = read(BASE);
  const tabs = src.match(/<nav class="ptabs"[^]*?<\/nav>/)?.[0] ?? "";
  const diag = tabs.match(/<a[^>]*>Diagramas<\/a>/)?.[0] ?? "";
  assert.match(diag, /href=\{`\/\$\{project\.id\}\/software\/#diagramas`\}/);
  assert.match(diag, /data-ptab-ancla="diagramas"/);
  assert.doesNotMatch(src, /\/\$\{project\.id\}\/#diagramas/);
  assert.match(src, /pestanaActiva\(/);
  assert.match(src, /hashchange/);
});

test("Base.astro: el diálogo de atajos conserva data-wiki/data-grafo/data-novedades en todas las páginas de proyecto", () => {
  const d = read(BASE).match(/<dialog class="atajos-dialog" id="atajos"[^>]*>/)?.[0] ?? "";
  for (const a of ["data-wiki=", "data-grafo=", "data-novedades="]) assert.ok(d.includes(a), a);
});

test("CSS: .caratula y .phead usan tokens del tema, sin colores fijos", () => {
  const css = read("src/styles/global.css");
  for (const sel of [".caratula", ".phead"]) {
    const r = [...css.matchAll(new RegExp(`\\${sel}[^{]*\\{([^}]*)\\}`, "g"))].map((m) => m[1]).join("\n");
    assert.ok(r.length > 0, `faltan estilos para ${sel}`);
    assert.match(r, /var\(--/, `${sel} usa tokens`);
    assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(/i, `${sel} no usa colores fijos`);
  }
});

// ---------- enlaces que apuntaban a la portada de software ----------

test("SideNav: Diagramas → /<id>/software/#diagramas", () => {
  const nav = read("src/components/SideNav.astro");
  assert.match(nav, /href=\{`\/\$\{projectId\}\/software\/#diagramas`\}/);
  assert.doesNotMatch(nav, /\/\$\{projectId\}\/#diagramas/);
});

test("[...slug].astro: no genera rutas reservadas (software, páginas fijas, disciplinas)", () => {
  const s = read("src/pages/[project]/[...slug].astro");
  assert.match(s, /slugReservado\(/);
});

test("inicio: las tarjetas de proyecto usan entradaProyecto", () => {
  const s = read("src/pages/index.astro");
  assert.match(s, /entradaProyecto\(/);
});

test("vercel.json: /<id>/content/* redirige a /<id>/software/", () => {
  const v = JSON.parse(read("vercel.json"));
  const r = v.redirects.find((x) => x.source === "/:project/content/:path*");
  assert.equal(r?.destination, "/:project/software/");
});

test("projects.json: ninguna disciplina se llama software", () => {
  for (const p of JSON.parse(read("projects.json"))) assert.ok(!Object.hasOwn(p.disciplinas ?? {}, "software"), p.id);
});

test("Base.astro: pestanaActiva se importa en el script del navegador (no solo en el frontmatter)", () => {
  const src = read(BASE);
  const script = src.slice(src.lastIndexOf("<script>"));
  assert.match(script, /import\s*\{[^}]*pestanaActiva[^}]*\}\s*from\s*["']\.\.\/lib\/caratula(\.ts)?["']/);
});

test("CSS: la carátula se centra con ancho máximo y margen lateral", () => {
  const css = read("src/styles/global.css");
  const r = css.match(/main\.caratula\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(r, /max-width:/);
  assert.match(r, /margin:\s*0 auto/);
  assert.match(r, /padding:/);
});
