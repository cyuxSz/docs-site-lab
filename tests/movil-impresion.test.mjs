// Lote «movil-impresion». P1: en móvil queda un solo índice (el de línea); el cajón derecho no lo repite y su botón
// desaparece si el cajón queda vacío. P2: el aviso de la vista de lector se pega justo bajo la cabecera (variable
// --cabecera-fondo medida en el layout). P3: el editor de hardware crea su propio contexto de apilamiento y queda bajo
// la cabecera. P4: sin JS el panel «⋯» tampoco se imprime. P5: los grupos abiertos de la barra lateral se separan.
// El CSS se resuelve de verdad (media, especificidad, !important y orden) sobre un DOM de jsdom; no se busca solo texto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const GLOBAL = "src/styles/global.css";
const VISUAL = "src/styles/editor-visual.css";
const BASE = "src/layouts/Base.astro";
const SLUG = "src/pages/[project]/[...slug].astro";
const DISCIPLINA = "src/pages/[project]/[disciplina].astro";

// ---------- Mini motor de cascada ----------
// Parte `s` por `sep` solo en el nivel superior (fuera de paréntesis, corchetes y comillas).
function partir(s, sep) {
  const out = [];
  let d = 0;
  let q = "";
  let a = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "(" || c === "[") d++;
    else if (c === ")" || c === "]") d--;
    else if (c === sep && d === 0) {
      out.push(s.slice(a, i));
      a = i + 1;
    }
  }
  out.push(s.slice(a));
  return out.map((x) => x.trim()).filter(Boolean);
}

// Reglas de una hoja, en orden, con las condiciones @media que las envuelven. Ignora @keyframes y demás at-rules.
function reglasDe(fuente) {
  const out = [];
  const recorrer = (src, medias) => {
    let i = 0;
    while (i < src.length) {
      const a = src.indexOf("{", i);
      if (a < 0) break;
      const preludio = src.slice(i, a).trim();
      let d = 0;
      let j = a;
      for (; j < src.length; j++) {
        if (src[j] === "{") d++;
        else if (src[j] === "}" && --d === 0) break;
      }
      const cuerpo = src.slice(a + 1, j);
      if (preludio.startsWith("@media")) recorrer(cuerpo, [...medias, preludio.slice(6).trim()]);
      else if (!preludio.startsWith("@")) {
        const decls = partir(cuerpo, ";").map((dcl) => {
          const k = dcl.indexOf(":");
          const valor = dcl.slice(k + 1).trim();
          return { prop: dcl.slice(0, k).trim().toLowerCase(), valor: valor.replace(/\s*!important$/i, ""), importante: /!important$/i.test(valor) };
        });
        out.push({ selectores: partir(preludio.replace(/\s+/g, " "), ","), decls, medias, orden: out.length });
      }
      i = j + 1;
    }
  };
  recorrer(fuente.replace(/\/\*[^]*?\*\//g, ""), []);
  return out;
}

const largo = (v) => (/rem$/.test(v) ? parseFloat(v) * 16 : parseFloat(v));
// ¿Aplica la condición @media en `ctx` ({ ancho, medio })? Lo que no entiende (hover, prefers-*) cuenta como falso.
function mediaAplica(cond, ctx) {
  return partir(cond, ",").some((q) =>
    q.split(/\s+and\s+/).every((t) => {
      t = t.trim();
      if (t === "screen" || t === "print") return t === ctx.medio;
      if (t === "all") return true;
      const m = /^\(\s*(max|min)-width\s*:\s*([\d.]+(?:px|rem))\s*\)$/.exec(t);
      if (!m) return false;
      return m[1] === "max" ? ctx.ancho <= largo(m[2]) : ctx.ancho >= largo(m[2]);
    }),
  );
}

// Especificidad [ids, clases/atributos/pseudoclases, tipos/pseudoelementos]; :not/:is/:has cuentan su argumento más específico.
function especificidad(sel) {
  const e = [0, 0, 0];
  let i = 0;
  const ident = () => {
    const m = /^[-\w\\]+/.exec(sel.slice(i));
    i += m ? m[0].length : 0;
  };
  while (i < sel.length) {
    const c = sel[i];
    if (c === "#") {
      i++;
      ident();
      e[0]++;
    } else if (c === ".") {
      i++;
      ident();
      e[1]++;
    } else if (c === "[") {
      i = sel.indexOf("]", i) + 1;
      e[1]++;
    } else if (c === ":") {
      const pseudoElemento = sel[i + 1] === ":";
      i += pseudoElemento ? 2 : 1;
      const ini = i;
      ident();
      const nombre = sel.slice(ini, i).toLowerCase();
      let args = null;
      if (sel[i] === "(") {
        let d = 0;
        let j = i;
        for (; j < sel.length; j++) {
          if (sel[j] === "(") d++;
          else if (sel[j] === ")" && --d === 0) break;
        }
        args = sel.slice(i + 1, j);
        i = j + 1;
      }
      if (pseudoElemento) e[2]++;
      else if (nombre === "where") continue;
      else if (["not", "is", "has", "matches"].includes(nombre) && args !== null) {
        const mejor = partir(args, ",").map(especificidad).sort(comparar).pop() ?? [0, 0, 0];
        for (let k = 0; k < 3; k++) e[k] += mejor[k];
      } else e[1]++;
    } else if (/[a-zA-Z]/.test(c)) {
      ident();
      e[2]++;
    } else i++;
  }
  return e;
}
const comparar = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Declaración de `prop` que gana para `el` en `ctx`: !important, luego especificidad, luego orden en la hoja.
function ganadora(reglas, el, prop, ctx) {
  let mejor = null;
  for (const r of reglas) {
    if (!r.medias.every((m) => mediaAplica(m, ctx))) continue;
    const decl = r.decls.findLast((d) => d.prop === prop);
    if (!decl) continue;
    for (const sel of r.selectores) {
      let casa = false;
      try {
        casa = el.matches(sel);
      } catch {
        /* selector que jsdom no entiende (pseudoelementos): no aplica al elemento */
      }
      if (!casa) continue;
      const cand = { valor: decl.valor, importante: decl.importante, esp: especificidad(sel), orden: r.orden, selector: sel, medias: r.medias };
      if (!mejor || Number(cand.importante) - Number(mejor.importante) > 0 || (cand.importante === mejor.importante && (comparar(cand.esp, mejor.esp) > 0 || (comparar(cand.esp, mejor.esp) === 0 && cand.orden > mejor.orden)))) mejor = cand;
    }
  }
  return mejor;
}
const valor = (reglas, el, prop, ctx) => ganadora(reglas, el, prop, ctx)?.valor ?? null;

const global = () => reglasDe(read(GLOBAL));
const MOVIL = { ancho: 375, medio: "screen" };
const TABLET = { ancho: 899, medio: "screen" };
const ESCRITORIO = { ancho: 1366, medio: "screen" };
const dom = (html, attrsHtml = "") => new JSDOM(`<!doctype html><html ${attrsHtml}><body>${html}</body></html>`).window.document;

// El motor se comprueba a sí mismo con reglas que ya existen, para que un rojo de abajo no sea un fallo del motor.
test("motor de cascada: especificidad, media y !important sobre reglas que ya existen", () => {
  assert.deepEqual(especificidad("html:not([data-js]) .pagina-menu[hidden]"), [0, 3, 1]);
  assert.deepEqual(especificidad(".doc-wiki:not(:has(.meta dl > *)) .barras-movil [data-barra=\"der\"]"), [0, 4, 1]);
  assert.deepEqual(especificidad(":root[data-vista-lector] :is([data-hw-solo-editor], .hw-mover)"), [0, 3, 0]);
  assert.equal(mediaAplica("(max-width: 899.98px)", MOVIL), true);
  assert.equal(mediaAplica("(max-width: 899.98px)", ESCRITORIO), false);
  assert.equal(mediaAplica("screen and (min-width: 900px) and (max-width: 1100px)", { ancho: 1000, medio: "screen" }), true);
  assert.equal(mediaAplica("print", ESCRITORIO), false);
  const d = dom('<div class="barras-movil"></div><p hidden class="x"></p>');
  const r = global();
  assert.equal(valor(r, d.querySelector(".barras-movil"), "display", ESCRITORIO), "none");
  assert.equal(valor(r, d.querySelector(".barras-movil"), "display", MOVIL), "flex");
  assert.equal(ganadora(r, d.querySelector("p"), "display", MOVIL).importante, true, "[hidden] global con !important");
});

// ---------- P1. Un solo índice en móvil ----------
// Misma forma que [...slug].astro: botones móviles, índice en línea y cajón derecho con <dl> + nav.toc-box.
const paginaWiki = (dl) =>
  dom(`<div class="doc doc-wiki">
    <div class="barra-caja barra-caja-izq"><nav class="sidenav" id="barra-izq"></nav></div>
    <main>
      <div class="barras-movil"><button type="button" data-barra="izq"></button><button type="button" data-barra="der"></button></div>
      <nav class="toc-movil"><details><summary>En esta página</summary><ul class="toc"><li><a href="#a">A</a></li></ul></details></nav>
    </main>
    <div class="barra-caja barra-caja-der"><button type="button" class="barra-btn" data-barra="der"></button>
      <aside class="meta" id="barra-der"><dl>${dl}</dl>
        <nav class="toc-box"><p class="toc-title">En esta página</p><ul class="toc"><li><a href="#a">A</a></li></ul></nav>
      </aside>
    </div>
  </div>`);
const NODOS = "<div><dt>Nodos en el grafo</dt><dd><ul><li>nodo</li></ul></dd></div>";
const botonDer = (d) => d.querySelector('.barras-movil [data-barra="der"]');
const botonIzq = (d) => d.querySelector('.barras-movil [data-barra="izq"]');

test("P1a: a ≤899.98 px el índice del cajón derecho (.toc-box) no se muestra; queda el de línea (.toc-movil)", () => {
  const r = global();
  const d = paginaWiki("\n          ");
  for (const ctx of [MOVIL, TABLET]) {
    assert.equal(valor(r, d.querySelector(".toc-box"), "display", ctx), "none", `.toc-box oculto a ${ctx.ancho} px`);
    assert.equal(valor(r, d.querySelector(".toc-movil"), "display", ctx), "block", `.toc-movil visible a ${ctx.ancho} px`);
  }
  const g = ganadora(r, d.querySelector(".toc-box"), "display", MOVIL);
  assert.equal(g?.selector, ".doc-wiki .meta .toc-box", "la regla es la acordada");
  assert.deepEqual(g?.medias, ["(max-width: 899.98px)"], "y vive en el @media móvil (≤899.98 px)");
});

test("P1a: en escritorio (≥900 px) nada cambia: .toc-box visible y .toc-movil oculto", () => {
  const r = global();
  const d = paginaWiki(NODOS);
  for (const ctx of [{ ancho: 900, medio: "screen" }, ESCRITORIO]) {
    assert.notEqual(valor(r, d.querySelector(".toc-box"), "display", ctx), "none", `.toc-box visible a ${ctx.ancho} px`);
    assert.equal(valor(r, d.querySelector(".toc-movil"), "display", ctx), "none", `.toc-movil oculto a ${ctx.ancho} px`);
  }
});

test("P1b: si el <dl> del cajón derecho no tiene hijos, el botón móvil derecho no se muestra (y el izquierdo sí)", () => {
  const r = global();
  const d = paginaWiki("\n          ");
  assert.equal(valor(r, botonDer(d), "display", MOVIL), "none", "sin datos no hay botón derecho");
  assert.equal(valor(r, botonDer(d), "display", TABLET), "none");
  assert.notEqual(valor(r, botonIzq(d), "display", MOVIL), "none", "el de navegación sigue");
  const g = ganadora(r, botonDer(d), "display", MOVIL);
  assert.match(g?.selector ?? "", /:has\(/, "se decide con :has() sobre el contenido real del cajón");
  assert.deepEqual(g?.medias, ["(max-width: 899.98px)"], "solo en el @media móvil");
});

test("P1b: con «Nodos en el grafo» el botón móvil derecho sigue", () => {
  const r = global();
  const d = paginaWiki(NODOS);
  assert.notEqual(valor(r, botonDer(d), "display", MOVIL), "none");
  assert.equal(valor(r, d.querySelector(".toc-box"), "display", MOVIL), "none", "aun así el índice repetido no sale en el cajón");
});

test("P1b: en la página de disciplina (autor, actualizado, versión, historial) el botón móvil derecho sigue", () => {
  const src = read(DISCIPLINA);
  // Se monta con el marcado real del cajón derecho de [disciplina].astro: si cambia su estructura, este test lo nota.
  const aside = /<aside class="meta" id="barra-der"[^>]*>[^]*?<\/aside>/.exec(src)?.[0] ?? "";
  assert.ok(aside, "sigue el <aside class=\"meta\" id=\"barra-der\"> en [disciplina].astro");
  const d = dom(`<div class="doc doc-wiki"><main><div class="barras-movil"><button data-barra="izq"></button><button data-barra="der"></button></div></main><div class="barra-caja barra-caja-der">${aside}</div></div>`);
  assert.ok(d.querySelector(".meta dl > *"), "el <dl> de disciplina trae sus filas en el HTML (no depende de JS)");
  const r = global();
  assert.notEqual(valor(r, botonDer(d), "display", MOVIL), "none", "con datos, el botón no se oculta");
  assert.notEqual(valor(r, botonDer(d), "display", TABLET), "none");
});

test("P1b: la forma del cajón de la wiki sigue siendo <dl> + nav.toc-box dentro de aside.meta", () => {
  const aside = /<aside class="meta" id="barra-der"[^>]*>[^]*?<\/aside>/.exec(read(SLUG))?.[0] ?? "";
  assert.match(aside, /<aside[^>]*>\s*<dl>/, "el <dl> es hijo directo del cajón");
  assert.match(aside, /<\/dl>[^]*<nav class="toc-box"/, "el índice va fuera del <dl>");
});

const barrasLib = await import("../src/lib/barras.ts");
const estado = (o = {}) => ({ izqPlegada: false, derPlegada: false, enfoque: false, cajon: null, ...o });

test("P1c: etiquetaBarra en móvil llama al lado derecho «datos de la página»; en escritorio sigue «índice»", () => {
  const { etiquetaBarra } = barrasLib;
  assert.equal(etiquetaBarra(estado(), "der", true), "Mostrar datos de la página");
  assert.equal(etiquetaBarra(estado({ cajon: "der" }), "der", true), "Ocultar datos de la página");
  assert.equal(etiquetaBarra(estado({ enfoque: true, cajon: null }), "der", true), "Mostrar datos de la página");
  assert.equal(etiquetaBarra(estado(), "der", false), "Ocultar índice");
  assert.equal(etiquetaBarra(estado({ derPlegada: true }), "der", false), "Mostrar índice");
  assert.equal(etiquetaBarra(estado(), "izq", true), "Mostrar navegación", "el lado izquierdo no cambia");
  assert.equal(etiquetaBarra(estado({ cajon: "izq" }), "izq", true), "Ocultar navegación");
  assert.equal(etiquetaBarra(estado(), "izq", false), "Ocultar navegación");
});

// ---------- P2. Aviso de la vista de lector pegado a la cabecera ----------
async function cargar(ruta) {
  try {
    return { mod: await import(`../${ruta}`) };
  } catch (e) {
    return { fallo: e };
  }
}
const cabeceraLib = await cargar("src/lib/cabecera.ts");

test("P2: fondoCabecera(top, alto) devuelve el borde inferior de la cabecera en px enteros, con respaldo de 67px", () => {
  assert.ok(cabeceraLib.mod, `no carga src/lib/cabecera.ts (${cabeceraLib.fallo?.code ?? cabeceraLib.fallo?.message})`);
  const { fondoCabecera } = cabeceraLib.mod;
  assert.equal(typeof fondoCabecera, "function", "falta fondoCabecera en src/lib/cabecera.ts");
  assert.equal(fondoCabecera(12, 55), "67px", "escritorio: top 12 + alto 55");
  assert.equal(fondoCabecera(12, 50), "62px", "375 px: top 12 + alto 50");
  assert.equal(fondoCabecera(12, 54.6), "67px", "redondea al entero más cercano");
  assert.equal(fondoCabecera(12, 50.4), "62px");
  assert.equal(fondoCabecera(0, 48), "48px");
  for (const [t, a] of [[NaN, 55], [12, NaN], [Infinity, 55], [12, -Infinity], [undefined, 55], [12, undefined]]) {
    assert.equal(fondoCabecera(t, a), "67px", `respaldo con (${t}, ${a})`);
  }
});

test("P2: :root declara --cabecera-fondo: 67px y el aviso usa calc(var(--cabecera-fondo) + 8px), sin 92px", () => {
  const r = global();
  const d = dom('<header class="topbar"></header><div class="hw-aviso-lector"></div>', "data-vista-lector");
  assert.equal(valor(r, d.documentElement, "--cabecera-fondo", ESCRITORIO), "67px", "respaldo en :root");
  assert.equal(valor(r, d.documentElement, "--cabecera-fondo", MOVIL), "67px", "el respaldo no cambia por ancho (lo ajusta el script)");
  const aviso = d.querySelector(".hw-aviso-lector");
  for (const ctx of [MOVIL, ESCRITORIO]) {
    assert.equal(valor(r, aviso, "position", ctx), "sticky");
    assert.equal(valor(r, aviso, "top", ctx)?.replace(/\s+/g, " "), "calc(var(--cabecera-fondo) + 8px)", `top del aviso a ${ctx.ancho} px`);
  }
  assert.equal(valor(r, d.querySelector(".topbar"), "top", ESCRITORIO), "12px", "la cabecera sigue en top: 12px");
});

test("P2: los demás top: 92px (.sidenav, .meta, .barra-caja) no se tocan", () => {
  const r = global();
  const d = dom('<div class="doc-wiki"><div class="barra-caja"><nav class="sidenav"></nav></div><aside class="meta"></aside></div>');
  assert.equal(valor(r, d.querySelector(".sidenav"), "top", { ancho: 1366, medio: "screen" }), "92px");
  assert.equal(valor(r, d.querySelector(".meta"), "top", ESCRITORIO), "92px");
  assert.equal(valor(r, d.querySelector(".barra-caja"), "top", ESCRITORIO), "92px");
});

test("P2: el <script> del layout mide .topbar con fondoCabecera, escribe --cabecera-fondo en <html> y lo sigue con ResizeObserver", () => {
  const src = read(BASE);
  const scripts = [...src.matchAll(/<script>([^]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1, "sigue habiendo un solo <script> empaquetado en el layout (nada en línea: CSP)");
  const s = scripts[0];
  assert.match(s, /import\s*\{[^}]*\bfondoCabecera\b[^}]*\}\s*from\s*["']\.\.\/lib\/cabecera(\.ts)?["']/, "importa fondoCabecera de src/lib/cabecera.ts");
  assert.match(s, /querySelector(<[^>]*>)?\(\s*["']\.topbar["']\s*\)/, "busca .topbar");
  assert.match(s, /documentElement\.style\.setProperty\(\s*["']--cabecera-fondo["']\s*,/, "escribe la variable en <html>");
  assert.match(s, /\bfondoCabecera\(/, "el valor sale de fondoCabecera(top, alto)");
  assert.match(s, /\.offsetHeight\b/, "usa el alto real de la cabecera");
  assert.match(s, /getComputedStyle\([^)]*\)\.top\b/, "y su top calculado (no un número fijo ni la posición en pantalla)");
  assert.match(s, /new ResizeObserver\(/, "se actualiza cuando la cabecera cambia de tamaño");
  assert.match(s, /\.observe\(/);
  assert.doesNotMatch(s, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\beval\(/);
});

// ---------- P3. El editor de hardware queda bajo la cabecera ----------
const propia = (reglas, sel) => reglas.filter((r) => r.selectores.includes(sel));
const zDe = (reglas, sel) => Number(propia(reglas, sel).flatMap((r) => r.decls).findLast((d) => d.prop === "z-index")?.valor);

test("P3: .hw-editor { isolation: isolate } en editor-visual.css, fuera de cualquier @media", () => {
  const r = propia(reglasDe(read(VISUAL)), ".hw-editor").filter((x) => x.decls.some((d) => d.prop === "isolation"));
  assert.equal(r.length, 1, "una sola regla .hw-editor con isolation en editor-visual.css");
  assert.equal(r[0].decls.find((d) => d.prop === "isolation").valor, "isolate");
  assert.deepEqual(r[0].medias, [], "vale en todos los anchos");
  assert.deepEqual(r[0].selectores, [".hw-editor"], "solo el formulario del editor");
});

test("P3: .hw-editor no declara un z-index que lo ponga a la altura de .topbar, y nadie anula su isolation", () => {
  const todas = [...global(), ...reglasDe(read(VISUAL))];
  const topbar = zDe(global(), ".topbar");
  assert.equal(topbar, 20, ".topbar sigue en z-index 20");
  for (const r of todas) {
    for (const sel of r.selectores.filter((s) => /\.hw-editor(?![-\w])[^ >+~]*$/.test(s))) {
      for (const d of r.decls) {
        if (d.prop === "z-index") assert.ok(Number(d.valor) < topbar, `${sel} declara z-index ${d.valor}: debe quedar bajo .topbar (${topbar})`);
        if (d.prop === "isolation") assert.equal(d.valor, "isolate", `${sel} no anula el contexto de apilamiento`);
      }
    }
  }
});

test("P3: no se toca ningún z-index: acciones (5) < menú «/» (30) < menú Insertar (40)", () => {
  const g = global();
  const v = reglasDe(read(VISUAL));
  assert.equal(zDe(g, ".hw-acciones"), 5);
  assert.equal(zDe(v, ".hw-visual .milkdown .milkdown-slash-menu"), 30);
  assert.equal(zDe(g, ".hw-insertar-menu"), 40);
});

test("P3: el comentario del menú «/» ya no dice que queda por encima de la cabecera", () => {
  const css = read(VISUAL);
  const i = css.indexOf(".hw-visual .milkdown .milkdown-slash-menu {");
  const comentario = css.slice(css.lastIndexOf("/*", i), i);
  assert.doesNotMatch(comentario.replace(/\s+/g, " "), /por encima de la cabecera/, "los z-index del menú valen dentro del editor");
  assert.match(css, /\/\*[^]*?bajo la\s+cabecera[^]*?\*\//, "el comentario explica que el editor entero queda bajo la cabecera");
});

// ---------- P4. Impresión sin JS ----------
const menu = (attrsHtml, oculto) => dom(`<div class="pagina-meta"><button class="pagina-menu-btn"></button><div class="pagina-menu"${oculto ? " hidden" : ""}><a href="#">Editar en GitHub</a></div></div>`, attrsHtml).querySelector(".pagina-menu");
const IMPRESION = [{ ancho: 794, medio: "print" }, { ancho: 375, medio: "print" }, { ancho: 1366, medio: "print" }];

test("P4: al imprimir sin JS el panel «⋯» no sale (gana por !important + especificidad + orden)", () => {
  const r = global();
  for (const ctx of IMPRESION) {
    for (const oculto of [true, false]) {
      const g = ganadora(r, menu("", oculto), "display", ctx);
      assert.equal(g?.valor, "none", `sin JS, ${oculto ? "con" : "sin"} [hidden], a ${ctx.ancho} px impreso gana «${g?.selector} { display: ${g?.valor} }»`);
      assert.equal(g.importante, true);
      assert.ok(g.medias.some((m) => /\bprint\b/.test(m)), "la regla que gana es de la hoja de impresión");
    }
  }
});

test("P4: al imprimir con JS el panel tampoco sale (abierto o cerrado)", () => {
  const r = global();
  for (const ctx of IMPRESION) for (const oculto of [true, false]) assert.equal(valor(r, menu("data-js", oculto), "display", ctx), "none");
});

test("P4: en pantalla nada cambia: sin JS el panel se ve (grid) y con JS se oculta con [hidden]", () => {
  const r = global();
  for (const ctx of [MOVIL, ESCRITORIO]) {
    assert.equal(valor(r, menu("", true), "display", ctx), "grid", "sin JS, aunque lleve [hidden]");
    assert.equal(valor(r, menu("", false), "display", ctx), "grid");
    assert.equal(valor(r, menu("data-js", true), "display", ctx), "none");
    assert.equal(valor(r, menu("data-js", false), "display", ctx), "grid");
  }
  const css = read(GLOBAL);
  assert.ok(css.includes("html:not([data-js]) .pagina-menu[hidden] { display: grid !important; }"), "la regla de pantalla sigue tal cual");
});

// ---------- P5. Grupos de la barra lateral ----------
const grupos = () => dom('<nav class="sidenav"><ul class="sidenav-list"><li><details class="nav-grupo" open><summary>Guías</summary><ul><li><a href="#">A</a></li></ul></details></li><li><details class="nav-grupo"><summary>Referencia</summary><ul><li><a href="#">B</a></li></ul></details></li></ul></nav>');

test("P5: los grupos abiertos dejan 10 px por debajo; los plegados siguen compactos", () => {
  const r = global();
  const d = grupos();
  const [abierto, plegado] = d.querySelectorAll(".nav-grupo");
  for (const ctx of [MOVIL, ESCRITORIO]) {
    assert.equal(valor(r, abierto, "padding-bottom", ctx), "10px", `grupo abierto a ${ctx.ancho} px`);
    assert.equal(valor(r, plegado, "padding-bottom", ctx), null, `grupo plegado a ${ctx.ancho} px: sin relleno extra`);
    assert.equal(valor(r, plegado, "padding", ctx), null);
    assert.equal(valor(r, plegado, "margin-bottom", ctx), null);
    assert.equal(valor(r, plegado.querySelector("summary"), "min-height", ctx), "36px", "fila tocable de 36 px");
  }
  const g = ganadora(r, abierto, "padding-bottom", ESCRITORIO);
  assert.equal(g.selector, ".nav-grupo[open]");
  assert.deepEqual(g.medias, [], "fuera de @media");
});

test("P5: sin líneas divisorias ni colores nuevos en los grupos", () => {
  for (const r of global()) {
    if (!r.selectores.some((s) => /^\.nav-grupo(\[open\])?$/.test(s))) continue;
    for (const d of r.decls) {
      assert.doesNotMatch(d.prop, /^(border|outline|background|box-shadow)/, `${r.selectores.join(", ")} no añade ${d.prop}`);
      assert.doesNotMatch(d.valor, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, "sin colores fijos");
    }
  }
});

// ---------- Regla de diseño: solo tokens ----------
test("las reglas nuevas del lote no traen colores fijos", () => {
  const nuevas = [...global(), ...reglasDe(read(VISUAL))].filter((r) =>
    r.selectores.some((s) => /:has\(\.meta dl|\.doc-wiki \.meta \.toc-box$|^\.nav-grupo\[open\]$|^\.hw-editor$|^html:not\(\[data-js\]\) \.pagina-menu/.test(s)),
  );
  for (const r of nuevas) for (const d of r.decls) assert.doesNotMatch(d.valor, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${r.selectores.join(", ")} { ${d.prop} }`);
  const aviso = global().find((r) => r.selectores.includes(":root[data-vista-lector] .hw-aviso-lector"));
  assert.ok(aviso, "sigue la regla del aviso de la vista de lector");
  for (const d of aviso.decls) assert.doesNotMatch(d.valor, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `aviso { ${d.prop} }`);
});
