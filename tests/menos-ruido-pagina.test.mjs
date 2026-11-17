// Lote "Menos ruido en pantalla" (1/2: página de la wiki). Metadatos en una línea bajo el título, "Mejorar" e
// "Historial" detrás de un menú "⋯" (disclosure: aria-expanded, Escape, foco), comentarios que se abren con
// #comentarios y #comentario-<id>, y el modo enfoque (f) pasa a llamarse "modo lectura" y se anuncia.
// Lógica pura importada; marcado y scripts comprobados sobre las fuentes (sin HTML del usuario, sin inline nuevo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const existe = (p) => existsSync(new URL(`../${p}`, import.meta.url));
const SLUG = "src/pages/[project]/[...slug].astro";
const css = () => read("src/styles/global.css");
const tag = (src, marca) => src.match(new RegExp(`<[a-z0-9]+[^>]*${marca}[^>]*>`))?.[0] ?? "";
const aside = (src) => {
  const i = src.indexOf('<aside class="meta"');
  return i < 0 ? "" : src.slice(i, src.indexOf("</aside>", i));
};
// Bloque que empieza en la etiqueta con `marca` y acaba en su cierre (mismo nombre de etiqueta, con anidamiento simple).
const bloque = (src, marca) => {
  const m = src.match(new RegExp(`<([a-z0-9]+)[^>]*${marca}[^>]*>`));
  if (!m) return "";
  const nombre = m[1];
  let d = 0;
  const re = new RegExp(`<${nombre}\\b[^>]*>|</${nombre}>`, "g");
  re.lastIndex = m.index;
  for (let x; (x = re.exec(src)); ) {
    if (x[0].startsWith("</")) d--;
    else d++;
    if (d === 0) return src.slice(m.index, x.index + x[0].length);
  }
  return src.slice(m.index);
};
const sinHtml = (f, s) => assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(/, `${f} no pinta HTML`);

async function cargar(ruta) {
  try {
    return { mod: await import(`../${ruta}`) };
  } catch (e) {
    return { fallo: e };
  }
}
const menuLib = await cargar("src/lib/menu-pagina.ts");
const comLib = await cargar("src/lib/comentarios.ts");
const barrasLib = await cargar("src/lib/barras.ts");
const atajosLib = await cargar("src/lib/atajos.ts");
const fn = (lib, ruta, nombre) => {
  assert.ok(lib.mod, `no carga ${ruta} (${lib.fallo?.code ?? lib.fallo?.message})`);
  assert.equal(typeof lib.mod[nombre], "function", `falta ${nombre} en ${ruta}`);
  return lib.mod[nombre];
};

// ---------- C1. Metadatos en una línea bajo el título ----------
test("C1 [...slug].astro: .pagina-meta (data-pagina-meta) en el artículo, antes del contenido y fuera de Pagefind", () => {
  const src = read(SLUG);
  const t = tag(src, "data-pagina-meta");
  assert.ok(t, "falta el elemento data-pagina-meta");
  assert.match(t, /class="[^"]*\bpagina-meta\b/);
  assert.match(t, /data-pagefind-ignore/);
  const i = src.indexOf("data-pagina-meta");
  assert.ok(i > src.indexOf('class="prose"') && i < src.indexOf("<Content />"), "va dentro del artículo y antes de <Content /> (el script la coloca bajo el H1)");
});

test("C1 la línea lleva fecha (time datetime), afirmaciones solo si hay y el enlace a la fuente", () => {
  const linea = bloque(read(SLUG), "data-pagina-meta");
  assert.match(linea, /<time datetime=\{entry\.data\.updated\}[^>]*data-hace/, "fecha relativa como hoy (data-hace)");
  assert.match(linea, /entry\.data\.claims\s*>\s*0\s*&&/, "afirmaciones solo si hay");
  assert.match(linea, /afirmaciones/i);
  assert.match(linea, /href=\{entry\.data\.source\}/);
  assert.match(linea, /Fuente|GitHub/);
});

test("C1 la línea cabe en una línea a 1280 px: textos visibles cortos y nombres accesibles completos", () => {
  const linea = bloque(read(SLUG), "data-pagina-meta");
  // Afirmaciones: visible «N afirmaciones verificadas»; «contra el código» solo para lector de pantalla.
  assert.match(linea, /afirmaciones verificadas<span class="sr-only"> contra el código<\/span>/);
  assert.doesNotMatch(linea, /verificadas contra el código/);
  // Fuente: visible «GitHub ↗» (flecha decorativa), nombre accesible completo y se abre en otra pestaña.
  const a = linea.match(/<a\b[^>]*href=\{entry\.data\.source\}[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
  assert.ok(a, "falta el enlace a la fuente");
  assert.match(a, /aria-label="Ver en GitHub \(se abre en otra pestaña\)"/);
  assert.match(a, /target="_blank"/);
  assert.match(a, /rel="[^"]*\bnoopener\b[^"]*"/);
  assert.match(a, />\s*GitHub\s*<span aria-hidden="true">↗<\/span>\s*<\/a>$/, "texto visible «GitHub ↗» con la flecha oculta al lector");
  assert.doesNotMatch(linea, />Ver en GitHub</, "el texto visible largo desaparece");
});

test("C1 el panel derecho ya no repite Actualizado, Afirmaciones, Fuente, Mejorar ni Historial (conserva nodos e índice)", () => {
  const a = aside(read(SLUG));
  assert.ok(a, "sigue existiendo <aside class=\"meta\" id=\"barra-der\">");
  for (const t of ["<dt>Actualizado", "<dt>Afirmaciones", "<dt>Fuente", "Mejorar esta página", 'class="historial"', "data-reportar"]) {
    assert.ok(!a.includes(t), `el panel derecho ya no tiene «${t}»`);
  }
  assert.match(a, /Nodos en el grafo/);
  assert.match(a, /toc-box/);
});

// ---------- C2. Menú "⋯" ----------
test("C2 [...slug].astro: botón ⋯ (disclosure) con aria-expanded=false, aria-controls y nombre accesible", () => {
  const src = read(SLUG);
  const b = tag(src, "data-pagina-menu-btn");
  assert.ok(b, "falta el botón data-pagina-menu-btn");
  assert.match(b, /^<button[^>]*type="button"/);
  assert.match(b, /aria-expanded="false"/);
  assert.match(b, /aria-controls="pagina-menu"/);
  assert.match(b, /aria-label="[^"]*[Mm]ás acciones[^"]*"/);
  const completo = bloque(src, "data-pagina-menu-btn");
  assert.match(completo, /⋯|<svg\b[^>]*aria-hidden="true"/, "el ⋯ es decorativo (texto o svg oculto)");
  assert.doesNotMatch(b, /role="menu"|aria-haspopup="menu"/, "patrón disclosure de enlaces, no role=menu");
});

test("C2 el panel #pagina-menu arranca oculto y tiene Editar, Reportar (data-reportar) e Historial", () => {
  const src = read(SLUG);
  const panel = bloque(src, 'id="pagina-menu"');
  assert.ok(panel, "falta id=\"pagina-menu\"");
  assert.match(tag(src, 'id="pagina-menu"'), /\bhidden\b/);
  assert.match(tag(src, 'id="pagina-menu"'), /data-pagefind-ignore/);
  assert.match(panel, /href=\{editar\}/);
  assert.match(panel, /Editar en GitHub/);
  assert.match(panel, /data-reportar data-repo=\{p\.repo\}/);
  assert.match(panel, /Reportar un error/);
  assert.match(panel, /historial\.length\s*>\s*0\s*&&/);
  assert.match(panel, /<details class="historial"/);
  assert.ok(src.indexOf("data-pagina-menu-btn") < src.indexOf('id="pagina-menu"'), "el botón va antes del panel");
});

test("C2 [...slug].astro importa el script empaquetado del menú (sin inline nuevo)", () => {
  const src = read(SLUG);
  assert.match(src, /import "\.\.\/\.\.\/scripts\/menu-pagina(\.ts)?";/);
  assert.doesNotMatch(src, /is:inline/);
});

test("C2 menuPagina: alternar abre y lleva el foco al primer enlace; alternar de nuevo cierra y vuelve al botón", () => {
  const menuPagina = fn(menuLib, "src/lib/menu-pagina.ts", "menuPagina");
  assert.deepEqual(menuPagina(false, "alternar"), { abierto: true, foco: "primero" });
  assert.deepEqual(menuPagina(true, "alternar"), { abierto: false, foco: "boton" });
});

test("C2 menuPagina: Escape cierra y devuelve el foco al botón; cerrado, Escape no se maneja (lo usan las barras)", () => {
  const menuPagina = fn(menuLib, "src/lib/menu-pagina.ts", "menuPagina");
  assert.deepEqual(menuPagina(true, "escape"), { abierto: false, foco: "boton" });
  assert.equal(menuPagina(false, "escape"), null, "null: el evento sigue su camino (Escape de barras/enfoque)");
});

test("C2 menuPagina: clic fuera y Tab fuera del panel cierran sin robar el foco", () => {
  const menuPagina = fn(menuLib, "src/lib/menu-pagina.ts", "menuPagina");
  assert.deepEqual(menuPagina(true, "fuera"), { abierto: false, foco: null });
  assert.deepEqual(menuPagina(true, "salir"), { abierto: false, foco: null });
  assert.equal(menuPagina(false, "fuera"), null);
  assert.equal(menuPagina(false, "salir"), null);
  assert.equal(menuPagina(true, "otra"), null, "evento desconocido: null");
});

test("C2 src/scripts/menu-pagina.ts: usa menuPagina, sincroniza aria-expanded/hidden, frena el Escape y coloca la línea bajo el H1", () => {
  assert.ok(existe("src/scripts/menu-pagina.ts"), "falta src/scripts/menu-pagina.ts");
  const js = read("src/scripts/menu-pagina.ts");
  assert.match(js, /import \{[^}]*menuPagina[^}]*\} from "\.\.\/lib\/menu-pagina(\.ts)?"/);
  assert.match(js, /setAttribute\("aria-expanded"/);
  assert.match(js, /\.hidden\s*=/);
  assert.match(js, /"Escape"/);
  assert.match(js, /stopPropagation\(\)/, "el Escape que cierra el menú no llega al de las barras (no sale del enfoque)");
  assert.match(js, /\.prose h1|\.titulo-pagina/);
  assert.match(js, /\[data-pagina-meta\]/);
  assert.match(js, /\.after\(|insertAdjacentElement\(/, "mueve el nodo existente (no crea HTML)");
  sinHtml("menu-pagina.ts", js);
});

test("C1/C2 global.css: estilos de .pagina-meta y .pagina-menu con tokens; impresión oculta el menú", () => {
  const c = css();
  for (const sel of [".pagina-meta", ".pagina-menu"]) {
    assert.ok(c.includes(sel), `faltan estilos de ${sel}`);
    for (const l of c.split("\n").filter((x) => x.includes(sel))) assert.doesNotMatch(l, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, `usa tokens: ${l.trim()}`);
  }
  const i = c.indexOf("@media print {");
  assert.ok(i >= 0);
  assert.match(c.slice(i), /\.pagina-menu/, "@media print oculta .pagina-menu");
});

// ---------- C3. Comentarios: #comentarios y #comentario-<id> los abren ----------
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("C3 abrirPorHash: #comentarios abre sin destino; #comentario-<uuid> abre y apunta a ese comentario", () => {
  const abrirPorHash = fn(comLib, "src/lib/comentarios.ts", "abrirPorHash");
  assert.deepEqual(abrirPorHash("#comentarios"), { abrir: true, id: null });
  assert.deepEqual(abrirPorHash(`#comentario-${UUID}`), { abrir: true, id: UUID });
  assert.deepEqual(abrirPorHash(`#comentario-${UUID.toUpperCase()}`), { abrir: true, id: UUID.toUpperCase() });
});

test("C3 abrirPorHash: otros anclajes no abren nada", () => {
  const abrirPorHash = fn(comLib, "src/lib/comentarios.ts", "abrirPorHash");
  for (const h of ["", "#", "#instalacion", "#comentarios-cuerpo", "#comentarios-titulo", "#comentario-", "#comentario-123", `#comentario-${UUID}x`, null, undefined]) {
    assert.deepEqual(abrirPorHash(h), { abrir: false, id: null }, String(h));
  }
});

test("C3 Comentarios.astro: la sección tiene id=\"comentarios\" (destino del ancla) y sigue plegada", () => {
  const src = read("src/components/Comentarios.astro");
  assert.match(tag(src, 'class="comentarios"'), /id="comentarios"/);
  assert.match(tag(src, "data-comentarios-toggle"), /aria-expanded="false"/);
  assert.match(tag(src, 'id="comentarios-cuerpo"'), /\bhidden\b/);
});

test("C3 scripts/comentarios.ts: usa abrirPorHash al cargar y en hashchange (no solo el regex de #comentario-<id>)", () => {
  const js = read("src/scripts/comentarios.ts");
  assert.match(js, /import \{[^}]*abrirPorHash[^}]*\} from "\.\.\/lib\/comentarios(\.ts)?"/);
  assert.match(js, /abrirPorHash\(location\.hash\)/);
  assert.match(js, /addEventListener\("hashchange"/);
  sinHtml("comentarios.ts", js);
});

// ---------- C4. Modo lectura con f ----------
test("C4 ATAJOS: la ayuda lo llama «Modo lectura» con la tecla f; ninguna otra entrada usa f", () => {
  const { ATAJOS } = atajosLib.mod ?? {};
  assert.ok(Array.isArray(ATAJOS), "src/lib/atajos.ts exporta ATAJOS");
  const f = ATAJOS.filter((a) => a.teclas.some((t) => t.toLowerCase() === "f"));
  assert.equal(f.length, 1, "una sola entrada con f");
  assert.deepEqual(f[0].teclas, ["f"]);
  assert.match(f[0].descripcion, /^Modo lectura/);
  assert.ok(!ATAJOS.some((a) => /Modo enfoque/.test(a.descripcion)), "ya no se llama «Modo enfoque» en la ayuda");
});

test("C4 atajo: f sigue alternando (acción enfoque) y no choca con g + tecla, [, ], ? ni con Ctrl/Alt", () => {
  const atajo = fn(atajosLib, "src/lib/atajos.ts", "atajo");
  const t = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, escribiendo: false, dialogoAbierto: false, t: 1000, ...extra });
  assert.equal(atajo(null, t("f")).accion, "enfoque");
  assert.equal(atajo(900, t("f")).accion, "enfoque", "tras g, f no es una navegación g+f");
  assert.equal(atajo(null, t("f", { ctrlKey: true })).accion, null, "Ctrl+F (buscar del navegador) no se toca");
  assert.equal(atajo(null, t("f", { escribiendo: true })).accion, null);
  assert.equal(atajo(null, t("f", { dialogoAbierto: true })).accion, null);
});

test("C4 anuncioLectura: anuncia al entrar y al salir; nada si el modo no cambia", () => {
  const anuncioLectura = fn(barrasLib, "src/lib/barras.ts", "anuncioLectura");
  const e = (x = {}) => ({ izqPlegada: false, derPlegada: false, enfoque: false, cajon: null, ...x });
  const on = anuncioLectura(e(), e({ enfoque: true }));
  assert.equal(typeof on, "string");
  assert.match(on, /^Modo lectura activado/);
  assert.match(on, /\bF\b/, "dice cómo salir (F)");
  assert.match(on, /Escape/);
  assert.match(anuncioLectura(e({ enfoque: true }), e()), /^Modo lectura desactivado/);
  assert.equal(anuncioLectura(e(), e({ izqPlegada: true })), null);
  assert.equal(anuncioLectura(e({ enfoque: true }), e({ enfoque: true })), null);
});

test("C4 [...slug].astro: región viva sr-only para el anuncio (role=status, polite)", () => {
  const t = tag(read(SLUG), "data-anuncio-lectura");
  assert.ok(t, "falta data-anuncio-lectura");
  assert.match(t, /class="[^"]*\bsr-only\b/);
  assert.match(t, /role="status"/);
  assert.match(t, /aria-live="polite"/);
});

test("C4 scripts/barras.ts: escribe anuncioLectura en la región viva con textContent", () => {
  const js = read("src/scripts/barras.ts");
  assert.match(js, /import \{[^}]*anuncioLectura[^}]*\} from "\.\.\/lib\/barras(\.ts)?"/);
  assert.match(js, /\[data-anuncio-lectura\]/);
  assert.match(js, /anuncioLectura\(antes,\s*estado\)/);
  assert.match(js, /\.textContent\s*=/);
  sinHtml("barras.ts", js);
});
