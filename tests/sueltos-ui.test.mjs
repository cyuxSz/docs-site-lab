// Lote «sueltos-ui». Cinco pendientes de interfaz:
// U1–U3: /auth/dispositivos. La etiqueta «Token de «nombre»» no desborda con un nombre sin espacios (1280 px), las fechas
//        no se parten a 375 px y el campo «Nombre» lleva un texto de ayuda asociado con aria-describedby.
// U4:    el comentario enlazado (#comentario-<uuid>) recibe, mientras tiene el foco, un nombre accesible corto
//        (autor + fecha), no todo su texto.
// U5:    el diálogo de importar tiene un solo contenedor con scroll (el propio diálogo); las listas ya no tienen scroll.
// U6:    kicanvas.js ya no pide /…/$$:0:$$ (el <use xlink:href="${…}"> de kc-ui-icon dejaba el marcador en una URL).
// U7:    scroll-padding-top sale de --cabecera-fondo (alto real de la cabecera), no de 96px fijos.
// Lógica pura y CSS resueltos sobre jsdom (cascada plana con el selector real); kicanvas.js se evalúa en jsdom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { htmlDispositivos, htmlTokenCreado, ESTILOS } from "../lib/dispositivos-paginas.mjs";
import * as comLib from "../src/lib/comentarios.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const T0 = Date.UTC(2026, 10, 21);
const DIA = 864e5;

// Reglas de una hoja en plano (las de dentro de @media también, sin su condición).
function reglasPlanas(css) {
  css = css.replace(/\/\*[^]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/^@media[^{]*$/, "").trim(),
    decls: Object.fromEntries(
      m[2]
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim()]),
    ),
  }));
}
// Último valor declarado para `prop` por una regla cuyo selector casa con `el` (o null).
function declarado(reglas, el, prop) {
  let v = null;
  for (const r of reglas) {
    if (!(prop in r.decls)) continue;
    let casa = false;
    try {
      casa = el.matches(r.selector);
    } catch {
      /* selector que jsdom no entiende: no aplica */
    }
    if (casa) v = r.decls[prop];
  }
  return v;
}
// Todos los valores declarados para `prop` que alcanzan a `el` (para «ninguna regla le pone scroll»).
function todosDeclarados(reglas, el, prop) {
  const v = [];
  for (const r of reglas) {
    if (!(prop in r.decls)) continue;
    try {
      if (el.matches(r.selector)) v.push(`${r.selector} { ${prop}: ${r.decls[prop]} }`);
    } catch {
      /* no aplica */
    }
  }
  return v;
}

// ---------- U1–U3. /auth/dispositivos ----------
const paginaDisp = (cuerpo) => new JSDOM(`<!doctype html><html lang="es"><style>${ESTILOS}</style><main><h1>t</h1><div>${cuerpo}</div></main></html>`).window.document;
const reglasDisp = reglasPlanas(ESTILOS);
const TOKENS = [{ id: "b", nombre: "ci-subida-hardware", creado: T0, ultimoUso: T0, expira: T0 + 30 * DIA }];
const DISPOSITIVOS = [{ id: "a", nombre: "Portátil", plataforma: "windows", ultimoUso: T0 }];

test("U1 «Token creado»: la etiqueta con el nombre (hasta 60 caracteres sin espacios) se parte en vez de desbordar la columna", () => {
  const nombre = "x".repeat(60);
  const doc = paginaDisp(htmlTokenCreado({ nombre, token: "vts_" + "A".repeat(43), expira: T0 }));
  const etiqueta = doc.querySelector('label[for="tk"]');
  assert.ok(etiqueta, "sigue la etiqueta del token");
  assert.ok(etiqueta.textContent.includes(nombre));
  const ow = declarado(reglasDisp, etiqueta, "overflow-wrap");
  const wb = declarado(reglasDisp, etiqueta, "word-break");
  assert.ok(ow === "anywhere" || ow === "break-word" || wb === "break-word" || wb === "break-all", `la etiqueta necesita overflow-wrap/word-break (hoy: overflow-wrap ${ow}, word-break ${wb})`);
  // El token en sí ya se partía: que siga.
  assert.equal(declarado(reglasDisp, doc.getElementById("tk"), "overflow-wrap"), "anywhere");
});

test("U1 lista: el nombre de un dispositivo o token sigue partiéndose (.d con overflow-wrap)", () => {
  const doc = paginaDisp(htmlDispositivos(DISPOSITIVOS, "c", { tokens: TOKENS, crear: { id: "x", csrf: "y" } }));
  for (const strong of doc.querySelectorAll("li .d strong")) {
    const v = declarado(reglasDisp, strong.parentElement, "overflow-wrap");
    assert.equal(v, "anywhere", "la columna de texto se parte");
  }
});

test("U2 fechas: cada <time> de la lista (dispositivos y tokens) no se parte (white-space: nowrap)", () => {
  const lista = paginaDisp(htmlDispositivos(DISPOSITIVOS, "c", { tokens: TOKENS, crear: { id: "x", csrf: "y" } }));
  const times = [...lista.querySelectorAll("li time")];
  assert.equal(times.length, 4, "último uso del dispositivo + creado, último uso y caduca del token");
  for (const t of times) assert.equal(declarado(reglasDisp, t, "white-space"), "nowrap", `«${t.textContent}» se parte en dos líneas a 375 px`);
  // Solo la fecha: el resto de la línea sigue partiéndose con normalidad.
  for (const s of lista.querySelectorAll("li .d span")) assert.notEqual(declarado(reglasDisp, s, "white-space"), "nowrap", "la línea entera no");
});

test("U3 «Nombre»: el campo tiene un texto de ayuda visible asociado con aria-describedby que dice para qué sirve", () => {
  const doc = paginaDisp(htmlDispositivos([], "c", { tokens: [], crear: { id: "x", csrf: "y" } }));
  const campo = doc.querySelector('form input[name="nombre"]');
  assert.ok(campo, "sigue el campo");
  assert.equal(doc.querySelector(`label[for="${campo.id}"]`)?.textContent, "Nombre", "la etiqueta visible no cambia");
  const ids = (campo.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  assert.ok(ids.length, "falta aria-describedby en el campo «Nombre»");
  const ayuda = ids.map((id) => doc.getElementById(id)).filter(Boolean);
  assert.equal(ayuda.length, ids.length, "cada id de aria-describedby existe en la página");
  const texto = ayuda.map((e) => e.textContent.trim()).join(" ");
  assert.ok(texto.length >= 20 && texto.length <= 140, `texto de ayuda breve (${texto.length} caracteres): «${texto}»`);
  assert.match(texto, /lista|reconocer|identificar|distinguir/i, "dice que el nombre sirve para reconocer el token en la lista");
  for (const e of ayuda) {
    assert.ok(campo.form.contains(e), "la ayuda vive dentro del formulario, junto al campo");
    assert.ok(!e.hidden && e.getAttribute("aria-hidden") !== "true" && !/sr-only/.test(e.className), "visible para todos, no solo para lectores");
  }
  // Ni placeholder ni autofocus (tests/subida-2-pagina.test.mjs): la ayuda no lo sustituye por un placeholder.
  assert.ok(!campo.hasAttribute("placeholder"));
});

test("U3 «Nombre»: sin formulario (tope, login de nuevo o no editor) no queda una ayuda huérfana", () => {
  for (const crear of ["tope", "login", null]) {
    const doc = paginaDisp(htmlDispositivos([], "c", { tokens: TOKENS, crear }));
    assert.equal(doc.querySelectorAll("[aria-describedby]").length, 0, String(crear));
    assert.doesNotMatch(doc.body.textContent, /reconocer|identificar|distinguir/i, `${crear}: la ayuda solo va con el campo`);
  }
});

// ---------- U4. Nombre accesible corto del comentario enlazado ----------
const UUID = "00000000-0000-4000-8000-000000000001";
const RESP = "00000000-0000-4000-8000-000000000002";
const BORR = "00000000-0000-4000-8000-000000000003";
const TEXTO_LARGO = "Este es el texto completo del comentario, que puede ser muy largo y no debe leerse como nombre del elemento. ".repeat(5);
const fn = (mod, archivo, nombre) => {
  assert.equal(typeof mod[nombre], "function", `${archivo} debe exportar ${nombre}()`);
  return mod[nombre];
};
// Mismo marcado que pintarComentario() de src/scripts/comentarios.ts.
function hilos() {
  const dom = new JSDOM(`<button id="fuera">f</button><ol class="comentarios-lista">
    <li class="comentario" id="comentario-${UUID}">
      <div class="comentario-cab"><span class="chip chip-nota">Nota</span><span class="comentario-autor">ana</span><time datetime="2026-11-21T10:00:00Z">hace 2 h</time><span>(editado)</span></div>
      <p class="comentario-texto">${TEXTO_LARGO}</p>
      <div class="comentario-acciones"><button data-accion="responder">Responder</button></div>
      <ol class="comentarios-respuestas">
        <li class="comentario" id="comentario-${RESP}">
          <div class="comentario-cab"><span class="chip chip-nota">Nota</span><span class="comentario-autor">beto</span><time datetime="2026-11-21T11:00:00Z">hace 1 h</time></div>
          <p class="comentario-texto">respuesta larga de beto</p>
        </li>
      </ol>
    </li>
    <li class="comentario borrado" id="comentario-${BORR}"><p class="comentario-texto">Comentario borrado</p></li>
  </ol>`);
  dom.window.Element.prototype.scrollIntoView = () => {};
  return dom.window.document;
}
const nombre = (li) => (li.getAttribute("aria-label") ?? (li.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => li.ownerDocument.getElementById(id)?.textContent ?? "").join(" ")).trim();

test("U4 enfocarComentario: el li enlazado lleva un nombre accesible corto con autor y fecha, sin el texto del comentario", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilos();
  assert.equal(enfocar(doc, UUID), true);
  const li = doc.getElementById(`comentario-${UUID}`);
  assert.equal(doc.activeElement, li);
  const n = nombre(li);
  assert.ok(n, "falta aria-label (o aria-labelledby) en el comentario enfocado: el lector leería todo su texto");
  assert.match(n, /\bana\b/, "nombra al autor");
  assert.match(n, /hace 2 h/, "y la fecha que se ve");
  assert.ok(n.length <= 80, `corto (${n.length} caracteres): «${n}»`);
  assert.doesNotMatch(n, /texto completo|beto|Responder/, "ni el texto, ni las respuestas, ni los botones");
});

test("U4 enfocarComentario: una respuesta enlazada se nombra con su propio autor, no con el del hilo", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilos();
  assert.equal(enfocar(doc, RESP), true);
  const n = nombre(doc.getElementById(`comentario-${RESP}`));
  assert.match(n, /\bbeto\b/);
  assert.match(n, /hace 1 h/);
  assert.doesNotMatch(n, /\bana\b|respuesta larga/);
  assert.equal(doc.getElementById(`comentario-${UUID}`).hasAttribute("aria-label"), false, "el hilo no gana nombre");
});

test("U4 enfocarComentario: un comentario borrado (sin cabecera) se nombra «Comentario borrado» y no lanza", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilos();
  assert.equal(enfocar(doc, BORR), true);
  assert.equal(nombre(doc.getElementById(`comentario-${BORR}`)), "Comentario borrado");
});

test("U4 enfocarComentario: al perder el foco se retira el nombre junto con el tabindex (la lista vuelve a leerse como siempre)", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilos();
  enfocar(doc, UUID);
  const li = doc.getElementById(`comentario-${UUID}`);
  assert.ok(nombre(li), "con foco tiene nombre");
  doc.getElementById("fuera").focus();
  assert.equal(li.hasAttribute("tabindex"), false);
  assert.equal(li.hasAttribute("aria-label"), false, "sin aria-label tras el blur");
  assert.equal(li.hasAttribute("aria-labelledby"), false, "ni aria-labelledby");
  // Y vuelve a ponerse con el mismo enlace.
  assert.equal(enfocar(doc, UUID), true);
  assert.match(nombre(li), /\bana\b/);
});

// U4b (hilo de CodeRabbit): «borrado» se decide por la cabecera, no por el autor vacío. pintarComentario() pinta
// `<span class="comentario-autor">` con "" cuando c.autor es null, pero la cabecera (y su fecha) siguen ahí.
const SINA = "00000000-0000-4000-8000-000000000004";
const SINAF = "00000000-0000-4000-8000-000000000005";
function hilosSinAutor() {
  const dom = new JSDOM(`<button id="fuera">f</button><ol class="comentarios-lista">
    <li class="comentario" id="comentario-${SINA}">
      <div class="comentario-cab"><span class="chip chip-nota">Nota</span><span class="comentario-autor"></span><time datetime="2026-11-21T09:00:00Z">hace 3 h</time></div>
      <p class="comentario-texto">texto de un comentario sin autor</p>
    </li>
    <li class="comentario" id="comentario-${SINAF}">
      <div class="comentario-cab"><span class="chip chip-nota">Nota</span><span class="comentario-autor">  </span></div>
      <p class="comentario-texto">otro sin autor ni fecha</p>
    </li>
    <li class="comentario borrado" id="comentario-${BORR}"><p class="comentario-texto">Comentario borrado</p></li>
  </ol>`);
  dom.window.Element.prototype.scrollIntoView = () => {};
  return dom.window.document;
}

test("U4b enfocarComentario: un comentario activo sin autor (con cabecera y fecha) se nombra «Comentario sin autor, <fecha>», no «borrado»", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilosSinAutor();
  assert.equal(enfocar(doc, SINA), true);
  assert.equal(nombre(doc.getElementById(`comentario-${SINA}`)), "Comentario sin autor, hace 3 h");
});

test("U4b enfocarComentario: un comentario activo sin autor ni fecha se nombra «Comentario sin autor»", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilosSinAutor();
  assert.equal(enfocar(doc, SINAF), true);
  assert.equal(nombre(doc.getElementById(`comentario-${SINAF}`)), "Comentario sin autor");
});

test("U4b enfocarComentario: sin cabecera sigue siendo «Comentario borrado»; con autor no cambia", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const doc = hilosSinAutor();
  assert.equal(enfocar(doc, BORR), true);
  assert.equal(nombre(doc.getElementById(`comentario-${BORR}`)), "Comentario borrado");
  const d2 = hilos();
  assert.equal(enfocar(d2, UUID), true);
  assert.equal(nombre(d2.getElementById(`comentario-${UUID}`)), "Comentario de ana, hace 2 h");
  assert.equal(enfocar(d2, RESP), true);
  assert.equal(nombre(d2.getElementById(`comentario-${RESP}`)), "Comentario de beto, hace 1 h");
});

// ---------- U5. Un solo scroll en el diálogo de importar ----------
const cssGlobal = reglasPlanas(read("src/styles/global.css"));
function dialogoImportar() {
  const astro = read("src/components/HwImportar.astro").replace(/^---[^]*?---/, "");
  const doc = new JSDOM(`<!doctype html><html><body>${astro}</body></html>`).window.document;
  const dlg = doc.getElementById("hw-importar");
  dlg.setAttribute("open", "");
  // Filas como las que pinta hardware-importar.ts, en las tres listas.
  for (const ul of dlg.querySelectorAll("ul")) ul.innerHTML = "<li><span>pagina.md</span></li>".repeat(40);
  return { doc, dlg };
}
const conScroll = (v) => /\b(auto|scroll)\b/.test(v);

test("U5 importar: ninguna lista ni contenedor dentro del diálogo tiene scroll propio (a ningún ancho)", () => {
  const { dlg } = dialogoImportar();
  const malos = [];
  for (const el of dlg.querySelectorAll("*")) {
    for (const p of ["overflow", "overflow-y", "overflow-block"]) {
      for (const d of todosDeclarados(cssGlobal, el, p)) if (conScroll(d.slice(d.indexOf("{")))) malos.push(`<${el.localName} class="${el.className}">: ${d}`);
    }
  }
  assert.deepEqual(malos, [], "segundo contenedor con scroll dentro del diálogo");
  for (const ul of dlg.querySelectorAll("ul.hw-importar-lista")) {
    assert.deepEqual(todosDeclarados(cssGlobal, ul, "max-height"), [], "sin altura máxima propia: crece y scrollea el diálogo");
  }
});

test("U5 importar: el diálogo es el único contenedor con scroll (alto acotado a la ventana) y los botones siguen pegados abajo", () => {
  const { dlg } = dialogoImportar();
  const oy = declarado(cssGlobal, dlg, "overflow-y") ?? declarado(cssGlobal, dlg, "overflow");
  assert.ok(oy && conScroll(oy), `el diálogo declara su scroll de forma explícita (hoy: ${oy})`);
  const mh = declarado(cssGlobal, dlg, "max-height");
  assert.ok(mh && /(d|s|l)?vh|%/.test(mh), `alto máximo relativo a la ventana (hoy: ${mh})`);
  const acciones = dlg.querySelector('[data-hw-imp="revision"] .hw-acciones');
  assert.equal(declarado(cssGlobal, acciones, "position"), "sticky");
  assert.equal(declarado(cssGlobal, acciones, "bottom"), "0");
});

// ---------- U6. kicanvas.js sin petición a $$:0:$$ ----------
const KICANVAS = read("public/vendor/kicanvas/kicanvas.js");
const ATRIBUTO_URL = /\s(?:xlink:href|href|src|srcset|poster|data|action|formaction)\s*=\s*["']?\$\$:\d+:\$\$/;

function cargarKicanvas() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  // Cada HTML que pasa por un <template>: es ahí donde el marcador $$:N:$$ acababa en una URL de verdad.
  const plantillas = [];
  const d = Object.getOwnPropertyDescriptor(w.Element.prototype, "innerHTML");
  Object.defineProperty(w.HTMLTemplateElement.prototype, "innerHTML", {
    set(v) {
      plantillas.push(String(v));
      d.set.call(this, v);
    },
    get() {
      return d.get.call(this);
    },
    configurable: true,
  });
  w.URL.createObjectURL ??= () => "blob:x";
  w.URL.revokeObjectURL ??= () => {};
  try {
    w.eval(KICANVAS);
  } catch {
    /* jsdom no trae WebGL ni todo lo demás: basta con que se definan los elementos de la interfaz */
  }
  return { w, plantillas };
}

test("U6 kicanvas.js: <kc-ui-icon>svg:…</kc-ui-icon> pinta el icono sin poner el marcador $$:0:$$ en un atributo de URL", async () => {
  const { w, plantillas } = cargarKicanvas();
  assert.ok(w.customElements.get("kc-ui-icon"), "kc-ui-icon definido");
  const icono = w.document.createElement("kc-ui-icon");
  icono.textContent = "svg:zoom_page";
  w.document.body.append(icono);
  await new Promise((r) => setTimeout(r, 20));
  const use = icono.shadowRoot?.querySelector("use");
  assert.ok(use, "el icono sigue pintando un <svg><use>");
  const href = use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  // kicanvas pone en sprites_url un blob: con sus sprites; el icono apunta a «<sprites_url>#zoom_page».
  assert.match(href ?? "", /^(blob:[^#]*)?#zoom_page$/, `apunta al sprite (hoy: ${href})`);
  const conMarcador = plantillas.filter((p) => ATRIBUTO_URL.test(p));
  assert.deepEqual(conMarcador, [], "una plantilla con el marcador en una URL: el navegador pide /uuv/electronica/$$:0:$$ (404)");
});

test("U6 kicanvas.js: ninguna plantilla html`` del bundle liga un atributo de URL con ${…}", () => {
  const malos = KICANVAS.match(/\s(?:xlink:href|href|src|srcset|poster|action|formaction)\s*=\s*["']?\$\{[^}]*\}/g) ?? [];
  assert.deepEqual(malos, []);
  // El resto del bundle sigue ahí (tests/b-kicanvas-claro.test.mjs fija lo que usa el portal).
  assert.match(KICANVAS, /customElements\.define\("kc-ui-icon"/);
});

// ---------- U7. scroll-padding-top ligado a la cabecera ----------
function enPx(v, vars) {
  assert.ok(v, "la propiedad no tiene valor");
  let s = v.replace(/var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g, (_, n) => {
    assert.ok(n in vars, `variable que el test no conoce: ${n} en «${v}»`);
    return `${vars[n]}px`;
  });
  s = s.replace(/calc/g, "").replace(/\b(max|min)\(/g, "Math.$1(").replace(/([\d.]+)px/g, "$1");
  assert.match(s.replace(/Math\.(max|min)/g, ""), /^[\d\s.,+\-*/()]+$/, `largo que el test no sabe resolver: ${v}`);
  return Function(`"use strict"; return (${s});`)();
}

test("U7 global.css: scroll-padding-top de <html> sale de --cabecera-fondo (no un número fijo) y deja las anclas bajo la cabecera", () => {
  const html = new JSDOM("<!doctype html><html><body></body></html>").window.document.documentElement;
  const sp = declarado(cssGlobal, html, "scroll-padding-top");
  assert.match(sp ?? "", /var\(\s*--cabecera-fondo\b/, `scroll-padding-top debe seguir la altura medida de la cabecera (hoy: ${sp})`);
  // Medido en Edge: fondo de la cabecera 67 px a 1280 y 62 px a 375. A 1280 no cambia nada visible (96 px).
  assert.equal(enPx(sp, { "--cabecera-fondo": 67 }), 96, "escritorio: igual que hoy");
  for (const fondo of [62, 67, 80, 123]) {
    const hueco = enPx(sp, { "--cabecera-fondo": fondo }) - fondo;
    assert.ok(hueco >= 8 && hueco <= 32, `cabecera ${fondo}: hueco de ${hueco} px entre la cabecera y el ancla`);
  }
});

test("U7 global.css: con la vista de lector, el scroll-margin de .comentario ya no resta 96px fijos ni suma la cabecera dos veces", () => {
  const css = read("src/styles/global.css");
  const regla = css.match(/:root\[data-vista-lector\] \.comentario \{([^}]*)\}/)?.[1] ?? "";
  assert.match(regla, /scroll-margin-top/);
  assert.doesNotMatch(regla, /96px/, "sin el 96px del antiguo scroll-padding");
  assert.doesNotMatch(css, /scroll-padding-top:\s*96px/);
});
