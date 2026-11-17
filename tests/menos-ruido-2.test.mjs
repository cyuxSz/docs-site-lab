// Lote "Menos ruido en pantalla" (2/2). C1: cifras del Resumen de Software en una tira de una línea (envuelve a 375 px,
// sin scroll interno). C2: grupos plegables en la SideNav con su estado en localStorage (try/catch) y el grupo de la
// página actual siempre abierto al cargar. C3: «¿Cómo se actualiza?» sale del pie y vive en /acerca/. C4: «En esta
// página» en móvil como desplegable nativo (<details> sin open) arriba del artículo; en escritorio sigue abierto en el
// panel derecho. Lógica pura importada; marcado, CSS y scripts comprobados sobre las fuentes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const existe = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SOFTWARE = "src/pages/[project]/software.astro";
const SIDENAV = "src/components/SideNav.astro";
const SLUG = "src/pages/[project]/[...slug].astro";
const BASE = "src/layouts/Base.astro";
const ACERCA = "src/pages/acerca.astro";
const css = () => read("src/styles/global.css");
const tag = (src, marca) => src.match(new RegExp(`<[a-z0-9]+[^>]*${marca}[^>]*>`))?.[0] ?? "";
const sinHtml = (f, s) => assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(/, `${f} no pinta HTML`);

// Cuerpos de las reglas (también dentro de @media) cuya lista de selectores incluye alguno de `sels`.
function reglas(fuente, ...sels) {
  const out = [];
  for (const m of fuente.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const lista = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (sels.some((s) => lista.includes(s))) out.push(m[2]);
  }
  return out;
}
const todas = (fuente, ...sels) => reglas(fuente, ...sels).join(";");
// Contenido de los bloques @media cuya condición contiene `cond` (llaves balanceadas).
function medias(fuente, cond) {
  const out = [];
  let i = 0;
  while ((i = fuente.indexOf("@media", i)) >= 0) {
    const a = fuente.indexOf("{", i);
    const cabecera = fuente.slice(i, a);
    let d = 0;
    let j = a;
    for (; j < fuente.length; j++) {
      if (fuente[j] === "{") d++;
      else if (fuente[j] === "}" && --d === 0) break;
    }
    if (cabecera.includes(cond)) out.push(fuente.slice(a + 1, j));
    i = j;
  }
  return out.join("\n");
}

async function cargar(ruta) {
  try {
    return { mod: await import(`../${ruta}`) };
  } catch (e) {
    return { fallo: e };
  }
}
const gruposLib = await cargar("src/lib/nav-grupos.ts");
const dataLib = await cargar("src/lib/data.ts");
const fn = (lib, ruta, nombre) => {
  assert.ok(lib.mod, `no carga ${ruta} (${lib.fallo?.code ?? lib.fallo?.message})`);
  assert.equal(typeof lib.mod[nombre], "function", `falta ${nombre} en ${ruta}`);
  return lib.mod[nombre];
};

// ---------- C1. Cifras del Resumen de Software en una tira ----------
const tira = () => {
  const s = read(SOFTWARE);
  const i = s.indexOf('class="stats stats-proyecto');
  assert.ok(i >= 0, "sigue el <dl class=\"stats stats-proyecto\">");
  return s.slice(s.lastIndexOf("<dl", i), s.indexOf("</dl>", i) + 5);
};
const texto = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const visible = (h) => texto(h.replace(/<span class="sr-only">[^<]*<\/span>/g, ""));

test("C1 software.astro: la tira es un <dl> con pares dt/dd y sin segunda línea (.stats-sub)", () => {
  const dl = tira();
  assert.match(dl, /^<dl\b/);
  assert.match(dl, /<dt\b/);
  assert.match(dl, /<dd\b/);
  assert.doesNotMatch(dl, /stats-sub/, "«de N nodos del repo» va en la misma línea, no en un bloque aparte");
});

test("C1 etiquetas visibles cortas (≤ 14 caracteres) y texto accesible completo con sr-only", () => {
  const dl = tira();
  const dts = [...dl.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>/g)].map((m) => m[1]);
  assert.ok(dts.length >= 3, "al menos páginas, afirmaciones y fecha");
  for (const dt of dts) assert.ok(visible(dt).length <= 14, `etiqueta visible larga: «${visible(dt)}»`);
  assert.match(dl, /class="sr-only"/, "lo recortado sigue disponible para el lector de pantalla");
  const accesible = texto(dl);
  assert.match(accesible, /Páginas/i);
  assert.match(accesible, /Afirmaciones verificadas/i);
  assert.match(accesible, /Nodos( ROS)? en uso/i);
  assert.match(dl, /de \{conteo\.total\}/, "el total de nodos se anuncia como «de N»");
  assert.match(accesible, /Nodos rotos/i);
  assert.match(accesible, /Actualizado/i);
});

test("C1 global.css: .stats-proyecto es una tira flex que envuelve (sin scroll interno ni nowrap global)", () => {
  const c = css();
  const r = todas(c, ".stats-proyecto", ".stats.stats-proyecto");
  assert.match(r, /display:\s*flex/);
  assert.match(r, /flex-wrap:\s*wrap/, "a 375 px envuelve: todas las cifras quedan visibles sin desplazamiento");
  assert.match(r, /gap:\s*[1-9]/);
  assert.doesNotMatch(r, /overflow-x:\s*(auto|scroll)/);
  assert.doesNotMatch(r, /white-space:\s*nowrap/);
  assert.match(r, /margin(-block|-top)?:\s*(?!0)[^;]*\d/, "sigue separada del hero");
});

test("C1 global.css: cada cifra deja de ser tarjeta (sin borde, sombra ni fondo) y el dt no va en mayúsculas", () => {
  const c = css();
  const item = todas(c, ".stats-proyecto > div", ".stats-proyecto div");
  assert.match(item, /box-shadow:\s*none/);
  assert.match(item, /border:\s*(0|none)/);
  assert.match(item, /background:\s*(none|transparent)/);
  assert.match(item, /min-width:\s*0|white-space:\s*nowrap/, "el par no se parte por dentro o puede encoger");
  assert.match(todas(c, ".stats-proyecto dt"), /text-transform:\s*none/);
});

test("C1 global.css: la cifra de la tira es compacta (clamp con máximo ≤ 24px) y sin margen", () => {
  const dd = todas(css(), ".stats-proyecto dd");
  const m = dd.match(/font-size:\s*clamp\(([^)]*)\)/);
  assert.ok(m, ".stats-proyecto dd usa font-size: clamp(...)");
  const max = parseFloat(m[1].split(",").at(-1));
  assert.ok(max <= 24, `máximo ${max}px`);
  assert.match(dd, /margin:\s*0/);
});

// ---------- C2. Grupos plegables en la SideNav ----------
const page = (path, title, type = "page") => ({ path, route: `/uuv/${path.replace(/\.md$/, "")}/`, title, description: "", type, owner: "", claims: 0, updated: null, author: null });

test("C2 sections(): cada grupo trae un id estable (carpeta; la raíz es «raiz»)", () => {
  const sections = fn(dataLib, "src/lib/data.ts", "sections");
  const g = sections([page("quickstart.md", "Inicio", "guide"), page("operations/estado.md", "Estado"), page("zeta/a.md", "A")]);
  assert.deepEqual(g.map((x) => x.id), ["raiz", "operations", "zeta"]);
  assert.deepEqual(g.map((x) => x.label), ["Empezar", "Operación", "zeta"], "las etiquetas no cambian");
});

const almacen = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => void m.set(k, String(v)), remove: (k) => void m.delete(k) };
};
const roto = { get() { throw new Error("SecurityError"); }, set() { throw new Error("QuotaExceeded"); }, remove() { throw new Error("x"); } };

test("C2 claveGrupos: una clave por proyecto con el prefijo wiki: (como las barras)", () => {
  const claveGrupos = fn(gruposLib, "src/lib/nav-grupos.ts", "claveGrupos");
  assert.equal(claveGrupos("uuv"), "wiki:nav-grupos:uuv");
  assert.notEqual(claveGrupos("uuv"), claveGrupos("usv"));
});

test("C2 leerGrupos: JSON guardado → mapa id→boolean; ausente, roto, no-objeto o almacén que lanza → {}", () => {
  const leerGrupos = fn(gruposLib, "src/lib/nav-grupos.ts", "leerGrupos");
  const claveGrupos = fn(gruposLib, "src/lib/nav-grupos.ts", "claveGrupos");
  const k = claveGrupos("uuv");
  assert.deepEqual(leerGrupos(almacen({ [k]: '{"operations":true,"raiz":false}' }), "uuv"), { operations: true, raiz: false });
  assert.deepEqual(leerGrupos(almacen(), "uuv"), {});
  for (const v of ["{", "null", "[1,2]", '"x"', "42"]) assert.deepEqual(leerGrupos(almacen({ [k]: v }), "uuv"), {}, v);
  assert.deepEqual(leerGrupos(almacen({ [k]: '{"a":true,"b":"si","c":1,"__proto__":true}' }), "uuv"), { a: true }, "solo booleanos y sin claves peligrosas");
  assert.deepEqual(leerGrupos(roto, "uuv"), {}, "localStorage bloqueado no rompe la barra");
});

test("C2 grupoAbierto: el grupo actual siempre abierto; los demás según lo guardado y, sin dato, cerrados", () => {
  const grupoAbierto = fn(gruposLib, "src/lib/nav-grupos.ts", "grupoAbierto");
  assert.equal(grupoAbierto("operations", "operations", {}), true);
  assert.equal(grupoAbierto("operations", "operations", { operations: false }), true, "el actual nunca queda oculto al cargar");
  assert.equal(grupoAbierto("raiz", "operations", {}), false, "por defecto solo el actual");
  assert.equal(grupoAbierto("raiz", "operations", { raiz: true }), true);
  assert.equal(grupoAbierto("raiz", null, { raiz: false }), false);
  assert.equal(grupoAbierto("raiz", null, {}), false, "sin página actual (Resumen, Novedades) todo cerrado salvo lo guardado");
});

test("C2 guardarGrupo: lee-modifica-escribe sin pisar otros grupos ni otros proyectos; con almacén roto no lanza", () => {
  const guardarGrupo = fn(gruposLib, "src/lib/nav-grupos.ts", "guardarGrupo");
  const leerGrupos = fn(gruposLib, "src/lib/nav-grupos.ts", "leerGrupos");
  const a = almacen();
  guardarGrupo(a, "uuv", "operations", true);
  guardarGrupo(a, "uuv", "raiz", false);
  guardarGrupo(a, "usv", "operations", false);
  assert.deepEqual(leerGrupos(a, "uuv"), { operations: true, raiz: false });
  assert.deepEqual(leerGrupos(a, "usv"), { operations: false });
  assert.doesNotThrow(() => guardarGrupo(roto, "uuv", "raiz", true));
});

test("C2 grupoActual: id del grupo que contiene la ruta actual; null si no está en ningún grupo", () => {
  const grupoActual = fn(gruposLib, "src/lib/nav-grupos.ts", "grupoActual");
  const grupos = [{ id: "raiz", pages: [{ route: "/uuv/quickstart/" }] }, { id: "operations", pages: [{ route: "/uuv/operations/estado/" }] }];
  assert.equal(grupoActual(grupos, "/uuv/operations/estado/"), "operations");
  assert.equal(grupoActual(grupos, "/uuv/novedades/"), null);
  assert.equal(grupoActual(grupos, undefined), null);
});

test("C2 nav-grupos.ts es lógica pura (sin DOM ni localStorage directo)", () => {
  assert.ok(existe("src/lib/nav-grupos.ts"), "falta src/lib/nav-grupos.ts");
  assert.doesNotMatch(read("src/lib/nav-grupos.ts"), /\b(document|window|localStorage)\b/);
});

test("C2 SideNav: cada grupo es <details class=\"nav-grupo\"> con data-nav-grupo, <summary> y open solo en el actual", () => {
  const src = read(SIDENAV);
  const d = tag(src, 'class="nav-grupo"');
  assert.ok(d, "falta <details class=\"nav-grupo\">");
  assert.match(d, /^<details\b/);
  assert.match(d, /data-nav-grupo=\{s\.id\}/);
  assert.match(d, /\bopen=\{[^}]*\}/, "open lo decide el servidor (grupo actual): sin salto al cargar");
  assert.match(src, /grupoActual\(/, "el grupo actual sale de grupoActual (lib/nav-grupos)");
  assert.match(src, /<summary\b[^>]*>[\s\S]*?\{s\.label\}[\s\S]*?<\/summary>/);
  assert.doesNotMatch(src, /<h2>\{s\.label\}<\/h2>/, "el título del grupo pasa a ser el summary");
});

test("C2 SideNav conserva Favoritos, enlaces extra, aria-current y el botón de móvil", () => {
  const src = read(SIDENAV);
  assert.match(src, /data-favoritos-lista/);
  assert.match(src, /<ul class="extra">/);
  assert.match(src, /aria-current=\{p\.route === currentRoute \? "page" : undefined\}/);
  assert.match(src, /class="sidenav-toggle"/);
});

test("C2 scripts/nav-grupos.ts: usa la lib, aplica al cargar, guarda en toggle; SideNav lo importa (sin inline)", () => {
  assert.ok(existe("src/scripts/nav-grupos.ts"), "falta src/scripts/nav-grupos.ts");
  const js = read("src/scripts/nav-grupos.ts");
  assert.match(js, /from "\.\.\/lib\/nav-grupos(\.ts)?"/);
  for (const f of ["leerGrupos", "grupoAbierto", "guardarGrupo"]) assert.match(js, new RegExp(`\\b${f}\\(`), `usa ${f}`);
  assert.match(js, /\[data-nav-grupo\]/);
  assert.match(js, /addEventListener\("toggle"/);
  assert.match(js, /localStorage/);
  sinHtml("nav-grupos.ts", js);
  const src = read(SIDENAV);
  assert.match(src, /import "\.\.\/scripts\/nav-grupos(\.ts)?";/);
  assert.doesNotMatch(src, /is:inline/);
});

test("C2 global.css: summary de grupo con foco visible y estilos con tokens", () => {
  const c = css();
  assert.match(c, /\.nav-grupo\b[^{]*summary[^{]*:focus-visible[^{]*\{[^}]*outline/);
  for (const l of c.split("\n").filter((x) => x.includes(".nav-grupo"))) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
});

// ---------- C3. «¿Cómo se actualiza?» en /acerca/ ----------
const pie = () => {
  const b = read(BASE);
  const i = b.indexOf("<footer");
  assert.ok(i >= 0, "Base sigue teniendo <footer>");
  return b.slice(i, b.indexOf("</footer>", i));
};

test("C3 Base: el pie ya no lleva el recuadro (ni título ni listas) y enlaza a /acerca/ de forma discreta", () => {
  const f = pie();
  assert.doesNotMatch(f, /Cómo se actualiza\?<\/h3>|<h3\b/);
  assert.doesNotMatch(f, /<ol\b/);
  assert.doesNotMatch(f, /openwiki\/|se edita en la propia web/);
  const a = f.match(/<a\b[^>]*href="\/acerca\/"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
  assert.ok(a, "falta el enlace a /acerca/ en el pie");
  assert.doesNotMatch(a, /class="[^"]*\bbtn\b/, "enlace discreto, no botón");
  assert.match(texto(a), /Acerca|actualiza/i);
  assert.match(f, /<slot name="footer" \/>/, "la portada sigue poniendo «Portal construido el …»");
});

test("C3 acerca.astro: página global con Base, main#contenido y las dos explicaciones (repo y disciplinas)", () => {
  assert.ok(existe(ACERCA), "falta src/pages/acerca.astro");
  const s = read(ACERCA);
  assert.match(s, /import Base from "\.\.\/layouts\/Base\.astro"/);
  assert.match(s, /<main\b[^>]*id="contenido"[^>]*tabindex="-1"|<main\b[^>]*tabindex="-1"[^>]*id="contenido"/);
  assert.match(s, /<h1\b[^>]*>[^<]*Acerca/);
  assert.match(s, /¿Cómo se actualiza\?/);
  assert.match(s, /<code>openwiki\/<\/code>/);
  assert.match(s, /<code>docs\/arch\/<\/code>/);
  assert.match(s, /reconstruye solo/);
  assert.match(s, /se edita en la propia web/);
  assert.match(s, /restaurar/);
  assert.equal((s.match(/<ol\b/g) ?? []).length, 2, "dos listas: Software (repo) y Electrónica/Mecánica");
  assert.doesNotMatch(s, /is:inline/);
});

test("C3 /acerca/ no choca con un proyecto: ningún id de projects.json se llama «acerca»", () => {
  const p = JSON.parse(read("projects.json"));
  const ids = (Array.isArray(p) ? p : (p.projects ?? Object.values(p))).map((x) => x?.id).filter(Boolean);
  assert.ok(ids.length > 0);
  assert.ok(!ids.includes("acerca"));
});

test("C3 global.css: sin reglas huérfanas del recuadro (.footer h3 / .footer ol)", () => {
  const c = css();
  assert.equal(reglas(c, ".footer h3").length, 0);
  assert.equal(reglas(c, ".footer ol").length, 0);
});

// ---------- C4. «En esta página» en móvil ----------
test("C4 [...slug].astro: índice móvil como <details> sin open, en un <nav> etiquetado, antes del artículo y fuera de Pagefind", () => {
  const src = read(SLUG);
  const nav = tag(src, "data-toc-movil");
  assert.ok(nav, "falta el elemento data-toc-movil");
  assert.match(nav, /^<nav\b/);
  assert.match(nav, /class="[^"]*\btoc-movil\b/);
  assert.match(nav, /aria-label="En esta página"/);
  assert.match(nav, /data-pagefind-ignore/);
  const i = src.indexOf("data-toc-movil");
  const bloqueMovil = src.slice(i, src.indexOf("</nav>", i));
  const det = bloqueMovil.match(/<details\b[^>]*>/)?.[0] ?? "";
  assert.ok(det, "dentro va un <details>");
  assert.doesNotMatch(det, /\bopen\b/, "plegado por defecto (sin JS ni salto al cargar)");
  assert.match(bloqueMovil, /<summary\b[^>]*>[^<]*En esta página/);
  assert.match(bloqueMovil, /<ul class="toc">/, "mismos enlaces .toc (el resaltado de prose.ts los marca)");
  assert.match(bloqueMovil, /toc\.map\(/);
  assert.ok(i < src.indexOf('class="prose"'), "va arriba, antes del artículo");
  assert.match(src.slice(Math.max(0, i - 200), i), /toc\.length\s*>\s*1\s*&&/, "solo si hay índice");
});

test("C4 el índice de escritorio sigue abierto en el panel derecho (sin <details>) con su título", () => {
  const src = read(SLUG);
  const i = src.indexOf('<aside class="meta"');
  const a = src.slice(i, src.indexOf("</aside>", i));
  assert.match(a, /class="toc-box"/);
  assert.match(a, /id="toc-title"/);
  assert.doesNotMatch(a, /<details\b/);
});

test("C4 global.css: .toc-movil oculto por defecto y visible solo bajo 900 px; foco visible en su summary; impresión lo oculta", () => {
  const c = css();
  assert.match(todas(c, ".toc-movil"), /display:\s*none/);
  const movil = medias(c, "max-width: 899.98px");
  assert.match(todas(movil, ".toc-movil"), /display:\s*block/);
  assert.match(c, /\.toc-movil[^{]*summary[^{]*:focus-visible[^{]*\{[^}]*outline/);
  assert.match(medias(c, "print"), /\.toc-movil/);
  for (const l of c.split("\n").filter((x) => x.includes(".toc-movil"))) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
});
