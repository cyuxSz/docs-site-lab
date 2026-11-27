// Lote «sueltos-teclado». Dos pendientes del portal:
// C1–C4: el enlace #comentario-<uuid> deja el comentario arriba (bajo la cabecera), con foco y con un anillo que se ve
//        aunque se llegue con el ratón; el tabindex temporal se retira al salir y un destino que no existe no rompe nada.
// A1–A4: la tecla «?» no se dispara al escribir (tampoco dentro de un shadow DOM), y con la ayuda abierta la cierra.
// Lógica pura importada y probada con jsdom; scripts y CSS comprobados sobre las fuentes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { buildSync } from "esbuild";
import * as atajosLib from "../src/lib/atajos.ts";
import * as comLib from "../src/lib/comentarios.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const UUID = "00000000-0000-4000-8000-000000000001";
const OTRO = "00000000-0000-4000-8000-000000000002";
const fn = (mod, archivo, nombre) => {
  assert.equal(typeof mod[nombre], "function", `${archivo} debe exportar ${nombre}()`);
  return mod[nombre];
};

// ---------- C1–C3. enfocarComentario ----------
function pagina() {
  const dom = new JSDOM(`<button id="antes">antes</button><ol>
    <li class="comentario" id="comentario-${UUID}"><p>hilo</p>
      <ol><li class="comentario" id="comentario-${OTRO}"><p>respuesta</p></li></ol>
    </li></ol><button id="despues">después</button>`);
  const doc = dom.window.document;
  const llamadas = [];
  // jsdom no trae scrollIntoView: se espía en el prototipo, junto con las opciones de focus().
  dom.window.Element.prototype.scrollIntoView = function (o) {
    llamadas.push({ que: "scroll", id: this.id, o });
  };
  const focusReal = dom.window.HTMLElement.prototype.focus;
  dom.window.HTMLElement.prototype.focus = function (o) {
    llamadas.push({ que: "focus", id: this.id, o });
    return focusReal.call(this, o);
  };
  return { doc, llamadas };
}

test("C1 enfocarComentario: lleva el comentario arriba (block start), sin centrarlo, y le da el foco sin un segundo salto", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc, llamadas } = pagina();
  assert.equal(enfocar(doc, UUID), true);
  const li = doc.getElementById(`comentario-${UUID}`);
  assert.equal(doc.activeElement, li, "el foco queda en el comentario: teclado y lector de pantalla parten de ahí");
  assert.equal(li.getAttribute("tabindex"), "-1", "enfocable por script, fuera del orden de tabulación");
  const scroll = llamadas.find((l) => l.que === "scroll");
  assert.ok(scroll, "llama a scrollIntoView");
  assert.equal(scroll.id, li.id);
  assert.equal(scroll.o?.block, "start", "arriba: scroll-padding-top del documento lo deja bajo la cabecera fija");
  const foco = llamadas.find((l) => l.que === "focus");
  assert.equal(foco.o?.preventScroll, true, "focus() no vuelve a desplazar");
  assert.ok(llamadas.indexOf(scroll) < llamadas.indexOf(foco), "primero desplaza, luego enfoca");
});

test("C1 enfocarComentario: también enfoca una respuesta dentro de un hilo (solo ella, no el hilo)", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc } = pagina();
  assert.equal(enfocar(doc, OTRO), true);
  assert.equal(doc.activeElement.id, `comentario-${OTRO}`);
  assert.equal(doc.getElementById(`comentario-${UUID}`).hasAttribute("tabindex"), false);
});

test("C2 enfocarComentario: al perder el foco se retira el tabindex (un clic posterior ya no lo enfoca ni pinta el anillo)", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc } = pagina();
  enfocar(doc, UUID);
  const li = doc.getElementById(`comentario-${UUID}`);
  doc.getElementById("despues").focus();
  assert.equal(li.hasAttribute("tabindex"), false, "sin tabindex tras el blur");
  // Se puede volver a enfocar con el mismo enlace.
  assert.equal(enfocar(doc, UUID), true);
  assert.equal(doc.activeElement, li);
  assert.equal(li.getAttribute("tabindex"), "-1");
});

test("C3 enfocarComentario: si el comentario no existe (o no hay id) devuelve false y no toca el foco ni lanza", () => {
  const enfocar = fn(comLib, "src/lib/comentarios.ts", "enfocarComentario");
  const { doc, llamadas } = pagina();
  const antes = doc.getElementById("antes");
  antes.focus();
  llamadas.length = 0;
  for (const id of ["00000000-0000-4000-8000-00000000ffff", null, undefined, ""]) {
    assert.equal(enfocar(doc, id), false, String(id));
  }
  assert.equal(doc.activeElement, antes, "el foco sigue donde estaba");
  assert.deepEqual(llamadas, [], "ni desplaza ni enfoca");
  // Un id que no es de comentario no se usa como selector ni como id arbitrario.
  doc.body.insertAdjacentHTML("beforeend", `<div id="comentario-x" tabindex="0"></div>`);
  assert.equal(enfocar(doc, "x"), false, "solo UUID");
});

test("C1/C3 scripts/comentarios.ts: los dos caminos (tras pintar y en hashchange) usan enfocarComentario; ya no centra", () => {
  const js = read("src/scripts/comentarios.ts");
  assert.match(js, /import \{[^}]*\benfocarComentario\b[^}]*\} from "\.\.\/lib\/comentarios(\.ts)?"/);
  const p = js.slice(js.indexOf("function pintar()"), js.indexOf("function pintarHilo"));
  assert.match(p, /enfocarComentario\(/, "pintar(): enfoca el destino pendiente al terminar de cargar");
  const h = js.slice(js.indexOf("function abrirDesdeHash()"), js.indexOf("abrirDesdeHash();\n"));
  assert.match(h, /enfocarComentario\(/, "abrirDesdeHash(): enfoca al momento si la lista ya cargó");
  assert.doesNotMatch(js, /block:\s*["']center["']/, "centrar esconde el inicio de un hilo más alto que la pantalla");
  assert.doesNotMatch(js, /destino\.scrollIntoView|destino\.focus\(/, "sin copias de la lógica en el script");
});

// ---------- C4. Indicador de foco ----------
test("C4 CSS: el comentario enfocado por enlace lleva el anillo del sitio con :focus (no solo :focus-visible) y solo tokens", () => {
  const css = read("src/styles/global.css");
  const regla = css.match(/\.comentario:focus\s*\{([^}]*)\}/);
  assert.ok(regla, "falta la regla .comentario:focus (tras un clic de ratón :focus-visible no se cumple)");
  assert.match(regla[1], /outline:\s*2px solid var\(--accent\)/, "mismo anillo que el resto del sitio");
  assert.match(regla[1], /outline-offset:\s*2px/);
  assert.doesNotMatch(regla[1], /#[0-9a-f]{3,8}\b|rgb\(|animation|box-shadow|background/i, "sobrio: sin colores sueltos, fondo, sombra ni animación");
});

// ---------- A1–A2. «?» no se dispara al escribir ----------
function campos() {
  const dom = new JSDOM(`<main><p id="texto">texto <a id="enlace" href="#x">enlace</a></p><button id="boton">b</button>
    <input id="input"><textarea id="textarea"></textarea><select id="select"><option>a</option></select>
    <div id="editor" contenteditable="true"><p id="parrafo">hola</p></div>
    <div id="rol" role="textbox" tabindex="0"><span id="rol-dentro">x</span></div>
    <div id="buscador" role="searchbox" tabindex="0"></div>
    <div id="visor"></div></main>`);
  const doc = dom.window.document;
  const raiz = doc.getElementById("visor").attachShadow({ mode: "open" });
  raiz.innerHTML = `<input id="dentro"><button id="boton-dentro">b</button>`;
  // Dispara un keydown real y devuelve lo que vería el listener de document.
  const visto = (origen, escribiendoEn) => {
    let r = null;
    const oir = (e) => (r = escribiendoEn(e));
    doc.addEventListener("keydown", oir);
    origen.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, composed: true }));
    doc.removeEventListener("keydown", oir);
    return r;
  };
  return { doc, raiz, visto };
}

test("A1 escribiendoEn: campos de texto, select, contenteditable y roles de texto cuentan como «escribiendo»", () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { doc, visto } = campos();
  for (const id of ["input", "textarea", "select", "editor", "parrafo", "rol", "rol-dentro", "buscador"]) {
    assert.equal(visto(doc.getElementById(id), escribiendoEn), true, `#${id}`);
  }
  for (const id of ["texto", "enlace", "boton"]) assert.equal(visto(doc.getElementById(id), escribiendoEn), false, `#${id}`);
  assert.equal(visto(doc.body, escribiendoEn), false, "sin foco en nada");
});

test("A2 escribiendoEn: un campo dentro de un shadow DOM (visores) también cuenta, aunque e.target sea el anfitrión", () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { raiz, visto } = campos();
  assert.equal(visto(raiz.getElementById("dentro"), escribiendoEn), true, "input en shadow DOM");
  assert.equal(visto(raiz.getElementById("boton-dentro"), escribiendoEn), false, "un botón en shadow DOM no es escribir");
  // Criterio 11: aunque no sea escribir, está dentro de un componente y «?» no se dispara.
  const enComponente = fn(atajosLib, "src/lib/atajos.ts", "enComponente");
  assert.equal(visto(raiz.getElementById("boton-dentro"), (e) => escribiendoEn(e) || enComponente(e)), true, "un botón en shadow DOM cuenta como dentro de un componente: «?» no se dispara");
});

test("A1 escribiendoEn: destinos raros (document, null, sin composedPath) no lanzan y no cuentan", () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { doc } = campos();
  assert.equal(escribiendoEn({ target: doc }), false);
  assert.equal(escribiendoEn({ target: null }), false);
  assert.equal(escribiendoEn({ target: doc.getElementById("input") }), true, "sin composedPath usa target");
  assert.equal(escribiendoEn({ target: doc.getElementById("boton"), composedPath: () => [] }), false);
});

test("A1/A2 scripts/atajos.ts: delega en escribiendoEn(e) y ya no decide con e.target.closest", () => {
  const s = read("src/scripts/atajos.ts");
  assert.match(s, /import \{[^}]*\bescribiendoEn\b[^}]*\} from "\.\.\/lib\/atajos(\.ts)?"/);
  assert.match(s, /escribiendo:\s*escribiendoEn\(e\)/);
  assert.doesNotMatch(s, /e\.target[^;\n]*closest/, "e.target es el anfitrión cuando la tecla viene de un shadow DOM");
});

// ---------- A3–A4. «?» con la ayuda abierta ----------
const { atajo, ATAJOS } = atajosLib;
const t = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, escribiendo: false, dialogoAbierto: false, t: 1000, ...extra });
const ABIERTA = { dialogoAbierto: true, ayudaAbierta: true };

test("A3 atajo: con la ayuda abierta, «?» (con o sin Mayús) devuelve «ayuda» para cerrarla", () => {
  assert.equal(atajo(null, t("?", { ...ABIERTA, shiftKey: true })).accion, "ayuda", "teclado español: Mayús + '");
  assert.equal(atajo(null, t("?", ABIERTA)).accion, "ayuda");
  assert.equal(atajo(null, t("?", { ...ABIERTA, shiftKey: true })).pendiente, null);
});

test("A3 atajo: con la ayuda abierta el resto de atajos sigue en pausa, y «?» respeta escribir, modificadores y repetición", () => {
  for (const k of ["g", "w", "f", "[", "]", "n"]) {
    const r = atajo(1000, t(k, { ...ABIERTA, t: 1100 }));
    assert.equal(r.accion, null, k);
    assert.equal(r.pendiente, null, `${k} no deja nada pendiente`);
  }
  for (const extra of [{ escribiendo: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { repetida: true }, { altGraph: true }]) {
    assert.equal(atajo(null, t("?", { ...ABIERTA, ...extra })).accion, null, JSON.stringify(extra));
  }
});

test("A3 atajo: con otro diálogo abierto (no la ayuda) «?» no hace nada", () => {
  assert.equal(atajo(null, t("?", { dialogoAbierto: true })).accion, null);
  assert.equal(atajo(null, t("?", { dialogoAbierto: true, ayudaAbierta: false, shiftKey: true })).accion, null);
});

test("A3 scripts/atajos.ts: avisa de que la ayuda está abierta y la acción «ayuda» alterna (cierra si ya está abierta)", () => {
  const s = read("src/scripts/atajos.ts");
  assert.match(s, /ayudaAbierta:\s*dialogo\.open\b/);
  const rama = s.slice(s.indexOf('r.accion === "ayuda"'));
  assert.ok(rama.length > 0 && rama !== s, "sigue habiendo una rama para la ayuda");
  const cuerpo = rama.slice(0, rama.indexOf("return;"));
  assert.match(cuerpo, /dialogo\.open/, "mira si ya está abierta: showModal() sobre un diálogo abierto lanza InvalidStateError");
  assert.match(cuerpo, /dialogo\.close\(\)/);
  assert.match(cuerpo, /dialogo\.showModal\(\)/);
});

test("A4 ATAJOS: la fila de «?» dice que también la oculta, y la ayuda no gana filas", () => {
  const filas = ATAJOS.filter((a) => a.teclas.join(" ") === "?");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].descripcion, "Mostrar u ocultar esta ayuda");
  assert.equal(ATAJOS.length, 9);
});

test("A4 Base.astro: la nota del diálogo ya no dice que todos los atajos se pausan (ahora «?» lo cierra) y sigue siendo una línea", () => {
  const src = read("src/layouts/Base.astro");
  const nota = src.match(/<p class="atajos-nota">([^<]*)<\/p>/)?.[1] ?? "";
  assert.match(nota, /\?/, "nombra la tecla que cierra la ayuda");
  assert.match(nota, /Esc/, "y Esc");
  assert.ok(nota.length <= 90, `corta (${nota.length} caracteres)`);
});

// ====================================================================================================================
// Ampliación tras la revisión completa (ui BLOQUEA, ux DUDAS). Criterios 8–10 de la spec:
// C5: con la vista de lector, el aviso fijo no tapa el comentario enlazado (scroll-margin-top solo en ese modo).
// C6: el anillo de foco de un comentario resuelto no se atenúa (la opacidad baja al contenido, no al li).
// A5: contenteditable="false" no cuenta como campo de escritura.
// ====================================================================================================================
const cabeceraLib = await import("../src/lib/cabecera.ts");

// Reglas de global.css en plano (las de dentro de @media también, sin su condición): basta para propiedades que este
// lote no declara dentro de ningún @media. Gana la última que case en la hoja (ninguna de estas compite en especificidad).
function reglasPlanas() {
  const css = read("src/styles/global.css").replace(/\/\*[^]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    decls: Object.fromEntries(
      m[2]
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(":")).trim().toLowerCase(), d.slice(d.indexOf(":") + 1).trim()]),
    ),
  }));
}
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
// Resuelve un largo con px, calc(), max()/min() y las dos variables de altura a un número de px.
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
const docHtml = (attrs, cuerpo) => new JSDOM(`<!doctype html><html ${attrs}><body>${cuerpo}</body></html>`).window.document;
const HILOS = `<div class="hw-aviso-lector" data-hw-aviso-lector role="status"></div>
  <ol class="comentarios-lista">
    <li class="comentario resuelto" id="hilo">
      <div class="comentario-cab" id="hilo-cab"></div><p class="comentario-texto" id="hilo-texto"></p>
      <div class="comentario-acciones" id="hilo-acciones"><button>Responder</button></div>
      <form class="comentarios-form-inline" id="hilo-form"><textarea></textarea></form>
      <ol class="comentarios-respuestas" id="respuestas">
        <li class="comentario" id="respuesta">
          <div class="comentario-cab" id="resp-cab"></div><p class="comentario-texto" id="resp-texto"></p>
          <div class="comentario-acciones" id="resp-acciones"><button>Editar</button></div>
        </li>
      </ol>
    </li>
    <li class="comentario resuelto borrado" id="borrado"><p class="comentario-texto" id="borrado-texto">Comentario borrado</p></li>
    <li class="comentario" id="abierto">
      <div class="comentario-cab" id="abierto-cab"></div><p class="comentario-texto" id="abierto-texto"></p>
    </li>
  </ol>`;

// ---------- C5. El aviso de la vista de lector no tapa el comentario enlazado ----------
const SCROLL_PADDING = 96; // html { scroll-padding-top: 96px }: no se toca en este lote
const ANILLO = 4; // outline 2px + outline-offset 2px

test("C5 altoAviso(alto): alto del aviso de lector en px enteros, con respaldo de 57px si está oculto o no es un número", () => {
  const altoAviso = fn(cabeceraLib, "src/lib/cabecera.ts", "altoAviso");
  assert.equal(altoAviso(57), "57px", "una línea, escritorio");
  assert.equal(altoAviso(103.6), "104px", "dos líneas a 375 px; redondea al entero más cercano");
  for (const a of [0, -1, NaN, Infinity, undefined]) assert.equal(altoAviso(a), "57px", `respaldo con ${a} (display: none mide 0)`);
});

test("C5 CSS: :root declara --aviso-lector-alto: 57px y el scroll-padding-top global sigue en 96px", () => {
  const r = reglasPlanas();
  const d = docHtml("", HILOS);
  assert.equal(declarado(r, d.documentElement, "--aviso-lector-alto"), "57px", "respaldo en :root (lo ajusta el script)");
  assert.equal(declarado(r, d.documentElement, "scroll-padding-top"), "96px", "las demás anclas no cambian");
  assert.equal(declarado(r, docHtml("data-vista-lector", HILOS).documentElement, "scroll-padding-top"), "96px", "tampoco con la vista de lector");
});

test("C5 CSS: con la vista de lector, el comentario enlazado (hilo o respuesta) queda entero bajo el aviso, anillo incluido, con un hueco pequeño", () => {
  const r = reglasPlanas();
  const d = docHtml("data-vista-lector", HILOS);
  const aviso = d.querySelector(".hw-aviso-lector");
  // Cabecera y aviso de escritorio (67 + 57: el caso de la captura, aviso de y=75 a y=132), 375 px con el aviso en
  // dos líneas, y una cabecera más alta: el margen tiene que seguir a las dos medidas, no a un valor fijo.
  for (const [fondo, alto] of [[67, 57], [62, 104], [90, 57], [62, 57]]) {
    const vars = { "--cabecera-fondo": fondo, "--aviso-lector-alto": alto };
    const fondoAviso = enPx(declarado(r, aviso, "top"), vars) + alto;
    for (const id of ["hilo", "respuesta", "abierto"]) {
      const margen = declarado(r, d.getElementById(id), "scroll-margin-top");
      assert.ok(margen, `#${id}: falta scroll-margin-top en .comentario con :root[data-vista-lector]`);
      const hueco = SCROLL_PADDING + enPx(margen, vars) - ANILLO - fondoAviso;
      assert.ok(hueco >= 4, `#${id} con cabecera ${fondo} y aviso ${alto}: el aviso (hasta y=${fondoAviso}) tapa el anillo (hueco ${hueco} px)`);
      assert.ok(hueco <= 16, `#${id} con cabecera ${fondo} y aviso ${alto}: hueco de ${hueco} px, demasiado grande`);
    }
  }
});

test("C5 CSS: sin la vista de lector, .comentario no gana scroll-margin-top (nada cambia)", () => {
  const r = reglasPlanas();
  const d = docHtml("", HILOS);
  for (const id of ["hilo", "respuesta", "abierto"]) assert.equal(declarado(r, d.getElementById(id), "scroll-margin-top"), null, `#${id}`);
  // La regla nueva solo alcanza a los comentarios: otras anclas de la página de hardware siguen como estaban.
  const otra = docHtml("data-vista-lector", `<h2 id="titulo">t</h2><section class="hw-pagina" id="pagina"></section>`);
  for (const id of ["titulo", "pagina"]) assert.equal(declarado(r, otra.getElementById(id), "scroll-margin-top"), null, `#${id} con vista de lector`);
  // Y existe: sin esta comprobación el test pasaría antes de implementar nada.
  assert.ok(declarado(r, docHtml("data-vista-lector", HILOS).getElementById("hilo"), "scroll-margin-top"), "con la vista de lector sí lo lleva");
});

test("C5 hardware-editor.ts: mide el aviso con ResizeObserver y publica --aviso-lector-alto con altoAviso()", () => {
  const s = read("src/scripts/hardware-editor.ts");
  assert.match(s, /import \{[^}]*\baltoAviso\b[^}]*\} from "\.\.\/lib\/cabecera(\.ts)?"/);
  assert.match(s, /\[data-hw-aviso-lector\]/, "localiza el aviso por su atributo");
  assert.match(s, /setProperty\(\s*"--aviso-lector-alto",\s*altoAviso\(/, "publica la variable en el documento");
  assert.match(s, /typeof ResizeObserver !== "undefined"/, "sin ResizeObserver (jsdom, navegador viejo) no lanza: queda el respaldo de 57px");
  assert.match(s, /new ResizeObserver\(/, "el aviso pasa a dos líneas a 375 px y mide 0 mientras está oculto");
});

// ---------- C6. El anillo de un comentario resuelto no se atenúa ----------
// Opacidad con la que se pinta de verdad un elemento: la suya por la de todos sus ancestros.
function opacidadReal(reglas, el) {
  let o = 1;
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(declarado(reglas, e, "opacity") ?? 1);
  return Math.round(o * 1000) / 1000;
}

test("C6 CSS: el li de un comentario resuelto (y el de sus respuestas) no lleva opacidad, así que su anillo de foco se pinta entero", () => {
  const r = reglasPlanas();
  const d = docHtml("", HILOS);
  for (const id of ["hilo", "respuesta", "borrado", "abierto"]) {
    assert.equal(opacidadReal(r, d.getElementById(id)), 1, `#${id}: el outline se pinta con la opacidad del li (con .6, --accent queda cerca de 2,4:1 en tema claro)`);
  }
  assert.equal(opacidadReal(r, d.getElementById("respuestas")), 1, "la lista de respuestas tampoco: atenuaría el anillo de una respuesta enlazada");
});

test("C6 CSS: el contenido de un hilo resuelto sigue atenuado a .6, una sola vez (las respuestas no acumulan .36)", () => {
  const r = reglasPlanas();
  const d = docHtml("", HILOS);
  // El propio li ya no lleva la opacidad (si la llevara, esto pasaría hoy y no probaría nada).
  assert.equal(declarado(r, d.getElementById("hilo"), "opacity"), null, "la opacidad no va en el li resuelto");
  for (const id of ["hilo-cab", "hilo-texto", "hilo-acciones", "hilo-form", "resp-cab", "resp-texto", "resp-acciones", "borrado-texto"]) {
    assert.equal(opacidadReal(r, d.getElementById(id)), 0.6, `#${id}`);
  }
  for (const id of ["abierto-cab", "abierto-texto"]) assert.equal(opacidadReal(r, d.getElementById(id)), 1, `#${id}: un hilo sin resolver no se atenúa`);
});

test("C6 CSS: el anillo de un resuelto es el mismo que el de uno sin resolver (misma regla, sin color propio) y nada lo atenúa", () => {
  const r = reglasPlanas();
  const d = docHtml("", HILOS);
  const anillo = (id) => {
    const li = d.getElementById(id);
    li.setAttribute("tabindex", "-1");
    li.focus();
    assert.equal(d.activeElement, li);
    return [...["outline", "outline-color", "outline-offset", "outline-width", "outline-style"].map((p) => declarado(r, li, p)), opacidadReal(r, li)];
  };
  const abierto = anillo("abierto");
  assert.deepEqual(abierto, ["2px solid var(--accent)", null, "2px", null, null, 1]);
  for (const id of ["hilo", "respuesta", "borrado"]) assert.deepEqual(anillo(id), abierto, `#${id}`);
});

// ---------- A5. contenteditable="false" no es un campo de escritura ----------
test('A5 escribiendoEn: contenteditable="false" no cuenta, salvo dentro de otro editable', () => {
  const escribiendoEn = fn(atajosLib, "src/lib/atajos.ts", "escribiendoEn");
  const { doc, visto } = campos();
  doc.querySelector("main").insertAdjacentHTML(
    "beforeend",
    `<div id="fijo" contenteditable="false" tabindex="0"><span id="fijo-dentro">x</span></div>
     <div id="fijo-mayus" contenteditable="FALSE" tabindex="0"></div>
     <div id="vacio" contenteditable><span id="vacio-dentro">x</span></div>
     <div id="plano" contenteditable="plaintext-only"></div>
     <div id="fuera" contenteditable="true"><span id="isla" contenteditable="false"><b id="isla-dentro">x</b></span></div>`,
  );
  for (const id of ["fijo", "fijo-dentro", "fijo-mayus"]) assert.equal(visto(doc.getElementById(id), escribiendoEn), false, `#${id}: ahí no se escribe, los atajos siguen activos`);
  for (const id of ["vacio", "vacio-dentro", "plano", "editor", "parrafo"]) assert.equal(visto(doc.getElementById(id), escribiendoEn), true, `#${id}: editable`);
  for (const id of ["isla", "isla-dentro"]) assert.equal(visto(doc.getElementById(id), escribiendoEn), true, `#${id}: isla no editable dentro de un editor, el foco sigue en el editor`);
});

// ---------- A6 (criterio 11). Con el foco dentro de un componente con shadow DOM (visor KiCad) «?» no se dispara ----------
// Medido en Edge con kicanvas: foco por Tab en «zoom to page» (botón en su shadow DOM abierto) y «?» abría la ayuda,
// porque el listener de document ve el anfitrión como e.target y escribiendoEn() solo excluye campos de escritura.
function visorKicad({ modo = "open" } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><main><button id="fuera">b</button>
    <visor-kicad id="visor"></visor-kicad><visor-foco id="host" tabindex="0"></visor-foco></main></body></html>`);
  const w = dom.window;
  const doc = w.document;
  let raiz = null;
  w.customElements.define("visor-kicad", class extends w.HTMLElement {
    constructor() {
      super();
      raiz = this.attachShadow({ mode: modo });
      raiz.innerHTML = `<button id="zoom" title="zoom to page">z</button>`;
    }
  });
  // Anfitrión que toma el foco él mismo (tabindex / delegatesFocus).
  w.customElements.define("visor-foco", class extends w.HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: modo }).innerHTML = `<canvas></canvas>`;
    }
  });
  const host = doc.getElementById("visor");
  // Enfoca el origen y despacha un keydown «?» real (composed, bubbles) desde él; devuelve lo que vería el listener de document.
  const pulsar = (origen, decide) => {
    origen.focus();
    let r = null;
    const oir = (e) => (r = { decide: decide(e), target: e.target });
    doc.addEventListener("keydown", oir);
    origen.dispatchEvent(new w.KeyboardEvent("keydown", { key: "?", shiftKey: true, bubbles: true, composed: true }));
    doc.removeEventListener("keydown", oir);
    return r;
  };
  return { dom, w, doc, host, raiz, pulsar };
}
const noDispara = (e) => atajosLib.escribiendoEn(e) || fn(atajosLib, "src/lib/atajos.ts", "enComponente")(e);

test("A6 enComponente: foco por Tab en un botón dentro del shadow DOM de un visor (custom element): el listener ve el anfitrión y «?» no se dispara", () => {
  const { doc, host, raiz, pulsar } = visorKicad();
  const boton = raiz.getElementById("zoom");
  const r = pulsar(boton, noDispara);
  assert.equal(doc.activeElement, host, "en el documento el foco está en el anfitrión");
  assert.equal(r.target, host, "con el evento composed, e.target en document es el anfitrión, no el botón");
  assert.equal(atajosLib.escribiendoEn({ target: host, composedPath: () => [boton] }), false, "no es escribir");
  assert.equal(r.decide, true, "pero está dentro de un componente: «?» no abre la ayuda");
});

test("A6 enComponente: con el foco en el propio anfitrión (tabindex) tampoco se dispara", () => {
  const { doc, pulsar } = visorKicad();
  const host = doc.getElementById("host");
  const r = pulsar(host, noDispara);
  assert.equal(doc.activeElement, host);
  assert.equal(r.decide, true, "anfitrión con shadowRoot enfocado");
});

test("A6 enComponente: shadow root cerrado (composedPath no llega dentro): el respaldo document.activeElement lo cuenta como dentro", () => {
  const { doc, host, raiz, pulsar } = visorKicad({ modo: "closed" });
  assert.equal(host.shadowRoot, null, "cerrado: el anfitrión no expone shadowRoot");
  const r = pulsar(raiz.getElementById("zoom"), noDispara);
  assert.equal(r.target, host);
  assert.equal(doc.activeElement, host);
  assert.equal(r.decide, true, "anfitrión enfocado con guion en el nombre: dentro de un componente");
});

test("A6 enComponente: un botón normal fuera del visor, document, null o sin composedPath no cuentan (los atajos siguen)", () => {
  const enComponente = fn(atajosLib, "src/lib/atajos.ts", "enComponente");
  const { doc, pulsar } = visorKicad();
  assert.equal(pulsar(doc.getElementById("fuera"), noDispara).decide, false, "botón normal: «?» sí abre la ayuda");
  assert.equal(pulsar(doc.body, enComponente).decide, false, "sin foco en nada");
  assert.equal(enComponente({ target: doc }), false);
  assert.equal(enComponente({ target: null }), false);
  assert.equal(enComponente({}), false);
  assert.equal(enComponente({ target: doc.getElementById("fuera"), composedPath: () => [] }), false);
});

test("A6 scripts/atajos.ts: combina escribiendoEn(e) || enComponente(e) al decidir si «?» se ignora", () => {
  const s = read("src/scripts/atajos.ts");
  assert.match(s, /import \{[^}]*\benComponente\b[^}]*\} from "\.\.\/lib\/atajos(\.ts)?"/);
  assert.match(s, /escribiendo:\s*escribiendoEn\(e\)\s*\|\|\s*enComponente\(e\)/);
});

let guionAtajos;
test("A6 scripts/atajos.ts (comportamiento): «?» desde un botón del visor o desde el anfitrión no abre la ayuda; desde un botón normal abre y cierra", () => {
  guionAtajos ??= buildSync({ entryPoints: [fileURLToPath(new URL("../src/scripts/atajos.ts", import.meta.url))], bundle: true, write: false, format: "iife", platform: "neutral" }).outputFiles[0].text;
  const { w, doc, raiz, pulsar } = visorKicad();
  doc.body.insertAdjacentHTML("afterbegin", `<dialog id="atajos" data-wiki="/uuv/wiki/"><button data-atajos-cerrar>Cerrar</button></dialog>`);
  // jsdom no implementa showModal()/close(): los imita con el atributo open.
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  new Function("window", "document", "location", "CustomEvent", guionAtajos)(w, doc, w.location, w.CustomEvent);
  const ayuda = doc.getElementById("atajos");
  pulsar(raiz.getElementById("zoom"), () => null);
  assert.equal(ayuda.open, false, "foco en «zoom to page» del visor: «?» no abre la ayuda");
  pulsar(doc.getElementById("host"), () => null);
  assert.equal(ayuda.open, false, "foco en el anfitrión: «?» no abre la ayuda");
  pulsar(doc.getElementById("fuera"), () => null);
  assert.equal(ayuda.open, true, "fuera del visor «?» sigue abriendo la ayuda");
  pulsar(doc.getElementById("fuera"), () => null);
  assert.equal(ayuda.open, false, "y la vuelve a cerrar");
});

// ---------- C5 (ampliación). El comentario del hash se posiciona con el indicador de carga ya retirado ----------
// src/scripts/comentarios.ts empaquetado con esbuild y ejecutado sobre jsdom con el marcado real de Comentarios.astro.
// Mientras <p data-comentarios-estado> lleva data-cargando, su spinner ::before lo mantiene en 26,4px + 12px de margen aunque
// el texto esté vacío; si se quita después del scroll, el comentario sube 38,4px y el aviso de lector lo tapa.
let guionComentarios;
async function montarComentarios({ hash, respuesta }) {
  guionComentarios ??= buildSync({ entryPoints: [fileURLToPath(new URL("../src/scripts/comentarios.ts", import.meta.url))], bundle: true, write: false, format: "iife", platform: "neutral" }).outputFiles[0].text;
  const marcado = read("src/components/Comentarios.astro").replace(/^---[\s\S]*?---/, "").replace("data-pagina={pagina}", 'data-pagina="/uuv/electronica/"');
  const dom = new JSDOM(`<!doctype html><html><body>${marcado}</body></html>`, { url: `https://docs.example/uuv/electronica/?p=placa${hash}` });
  const w = dom.window;
  const doc = w.document;
  const estado = doc.querySelector("[data-comentarios-estado]");
  assert.ok(estado?.hasAttribute("data-cargando"), "el marcado parte con el indicador de carga puesto");
  const llamadas = [];
  const anotar = (que, el) => {
    if (el.classList.contains("comentario")) llamadas.push({ que, id: el.id, cargando: estado.hasAttribute("data-cargando"), texto: estado.textContent });
  };
  w.Element.prototype.scrollIntoView = function () {
    anotar("scroll", this);
  };
  const focusReal = w.HTMLElement.prototype.focus;
  w.HTMLElement.prototype.focus = function (o) {
    anotar("focus", this);
    return focusReal.call(this, o);
  };
  const fetch = async () => respuesta();
  // Sin IntersectionObserver el script carga al momento: el mismo camino que un primer hash con los comentarios sin cargar.
  new Function("window", "document", "location", "sessionStorage", "fetch", "IntersectionObserver", guionComentarios)(w, doc, w.location, w.sessionStorage, fetch, undefined);
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return { doc, estado, llamadas };
}
const json = (status, cuerpo) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => cuerpo });
const COMENTARIO = { id: UUID, pagina: "/uuv/electronica/", padre: null, tipo: "duda", texto: "hola", autor: "ana", creado: "2026-11-01T00:00:00Z", editado: false, resuelto: false, resueltoPor: null, borrado: false };

test("C5 scripts/comentarios.ts: al enfocar el comentario del hash el indicador de carga ya no ocupa sitio (data-cargando retirado antes del scroll)", async () => {
  const { doc, estado, llamadas } = await montarComentarios({ hash: `#comentario-${UUID}`, respuesta: () => json(200, { yo: "ana", comentarios: [COMENTARIO] }) });
  const li = doc.getElementById(`comentario-${UUID}`);
  assert.ok(li, "pinta el comentario enlazado");
  const scroll = llamadas.find((l) => l.que === "scroll" && l.id === li.id);
  const foco = llamadas.find((l) => l.que === "focus" && l.id === li.id);
  assert.ok(scroll && foco, "desplaza y enfoca el comentario del hash");
  assert.equal(doc.activeElement, li);
  assert.equal(scroll.texto, "", "con hilos, el estado ya está vacío al desplazar");
  assert.equal(scroll.cargando, false, "en el momento del scrollIntoView [data-comentarios-estado] ya no lleva data-cargando: si se quita después, el <p> colapsa 38,4px y el comentario sube bajo el aviso de lector");
  assert.equal(foco.cargando, false, "tampoco al dar el foco");
  assert.equal(estado.hasAttribute("data-cargando"), false);
});

test("C5 scripts/comentarios.ts: si la carga falla, el indicador se retira igualmente (el finally de cargar() se conserva)", async () => {
  const { estado, llamadas } = await montarComentarios({ hash: `#comentario-${UUID}`, respuesta: () => json(500, { error: "x" }) });
  assert.equal(estado.hasAttribute("data-cargando"), false, "sin spinner tras un error");
  assert.notEqual(estado.textContent.trim(), "", "queda el mensaje de error");
  assert.deepEqual(llamadas, [], "sin comentario que enfocar");
});
