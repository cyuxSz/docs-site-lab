// Lote b-kicanvas-claro: el visor KiCanvas se monta con fondo claro (theme="kicad") por defecto, con un botón por visor
// («Fondo oscuro», aria-pressed) que alterna a theme="witchhazel" sin volver a descargar el archivo. La preferencia se
// guarda en localStorage (clave propia, tolerante a fallos) y se aplica a todos los visores de la página y a los que se
// monten después. Sin visor montado (vista previa, sin WebGL2, archivo inválido, error de carga) no hay botón.
// Nota: en el bundle de KiCanvas el atributo `theme` del <kicanvas-embed> no es reactivo (se lee al crear el visor),
// así que el comportamiento se prueba por lo observable: atributo del embed vigente, texto reutilizado y nº de descargas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const md = () => import("../src/lib/hardware-md.ts");
const fondo = () => import("../src/lib/kicad-fondo.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const ventana = () => new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
const bloque = (cuerpo) => "```kicad\n" + cuerpo + "\n```\n";
const SCH = "(kicad_sch\n  (version 20251024)\n  (generator \"eeschema\")\n)\n";
const PCB = "(kicad_pcb (version 20251024) (generator \"pcbnew\"))\n";
const CLARO = "kicad";
const OSCURO = "witchhazel";

function falsoKicad(texto = SCH, { webgl2 = true } = {}) {
  const llamadas = { script: 0, urls: [] };
  return {
    llamadas,
    kicad: {
      cargarScript: async () => {
        llamadas.script++;
      },
      leer: async (url) => {
        llamadas.urls.push(url);
        if (texto instanceof Error) throw texto;
        return typeof texto === "function" ? texto(url) : texto;
      },
      webgl2: () => webgl2,
    },
  };
}
const opciones = (extra = {}) => ({ proyecto: "uuv", slug: "placa", vistaPrevia: false, descargar() {}, ...extra });

async function montar(win, texto, f = falsoKicad(), extra = {}) {
  const { crearRenderizador, montarVisores } = await md();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  await montarVisores(win.document.body, texto, opciones({ kicad: f.kicad, ...extra }));
  return f;
}
const botones = (win) => [...win.document.querySelectorAll("figure.hw-kicad button")];
const temas = (win) => [...win.document.querySelectorAll("figure.hw-kicad kicanvas-embed")].map((e) => e.getAttribute("theme"));
// Lo que el portal guardó en su clave propia (cualquier clave distinta de la de KiCanvas, "kc:prefs").
const clavesPropias = (win) => Object.keys(win.localStorage).filter((k) => k !== "kc:prefs");

// ---------- C1. Tema claro por defecto ----------

test("C1: sin preferencia guardada, cada <kicanvas-embed> se monta con theme=\"kicad\" (claro)", async () => {
  const win = ventana();
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${C}`)}`);
  assert.deepEqual(temas(win), [CLARO, CLARO]);
});

test("C1: el tema del visor no depende del tema del portal (claro u oscuro)", async () => {
  for (const temaPortal of ["light", null]) {
    const win = ventana();
    if (temaPortal) win.document.documentElement.dataset.theme = temaPortal;
    await montar(win, bloque(`archivo: ${A}`));
    assert.deepEqual(temas(win), [CLARO], `portal ${temaPortal ?? "oscuro"}`);
  }
});

// ---------- C2. Botón por visor ----------

test("C2: un <button type=button class=btn> por visor, dentro de figure.hw-kicad, tras los enlaces y antes del figcaption", async () => {
  const win = ventana();
  const texto = `${bloque(`archivo: ${A}\nrespaldo: ${B}\ntitulo: Potencia`)}\n${bloque(`archivo: ${C}`)}`;
  const f = await montar(win, texto);
  const { montarVisores } = await md();
  await montarVisores(win.document.body, texto, opciones({ kicad: f.kicad })); // idempotente
  const figs = [...win.document.querySelectorAll("figure.hw-kicad")];
  for (const fig of figs) {
    const bs = [...fig.querySelectorAll("button")];
    assert.equal(bs.length, 1, "un solo botón por visor, también tras montar dos veces");
    const b = bs[0];
    assert.equal(b.parentElement, fig, "hijo directo de la figura, junto a los enlaces");
    assert.equal(b.getAttribute("type"), "button");
    assert.ok(b.classList.contains("btn"));
    assert.equal(b.previousElementSibling?.tagName, "A", "va justo después del último enlace");
    const cap = fig.querySelector("figcaption");
    if (cap) assert.ok(b.compareDocumentPosition(cap) & win.Node.DOCUMENT_POSITION_FOLLOWING, "antes del figcaption");
  }
});

test("C2: texto en formato oración «Fondo oscuro», sin iconos; aria-pressed=false con fondo claro", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  const [b] = botones(win);
  assert.equal(b.textContent.trim(), "Fondo oscuro");
  assert.equal(b.getAttribute("aria-pressed"), "false");
  assert.equal(b.querySelector("svg, img, i"), null);
});

test("C2: pulsar alterna claro ↔ oscuro (theme kicad ↔ witchhazel), aria-pressed refleja el estado y el texto no cambia", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  let [b] = botones(win);
  b.click();
  assert.deepEqual(temas(win), [OSCURO]);
  [b] = botones(win);
  assert.equal(b.getAttribute("aria-pressed"), "true");
  assert.equal(b.textContent.trim(), "Fondo oscuro");
  b.click();
  assert.deepEqual(temas(win), [CLARO]);
  assert.equal(botones(win)[0].getAttribute("aria-pressed"), "false");
});

test("C2: cambiar el tema no vuelve a descargar el archivo y conserva el texto, la región y los atributos del visor", async () => {
  const win = ventana();
  const f = await montar(win, bloque(`archivo: ${A}\ntitulo: Potencia`), falsoKicad(PCB));
  const [b] = botones(win);
  b.click();
  b.click();
  b.click();
  assert.equal(f.llamadas.urls.length, 1, "una sola descarga por visor");
  const embeds = win.document.querySelectorAll("figure.hw-kicad kicanvas-embed");
  assert.equal(embeds.length, 1, "nunca dos visores en la misma figura");
  const e = embeds[0];
  assert.equal(e.getAttribute("theme"), OSCURO);
  assert.equal(e.getAttribute("controls"), "basic");
  assert.match(e.getAttribute("controlslist") ?? "", /nodownload/);
  const fuente = e.querySelector("kicanvas-source");
  assert.equal(fuente?.textContent, PCB);
  assert.equal(fuente.children.length, 0);
  const regiones = win.document.querySelectorAll("figure.hw-kicad [role=region]");
  assert.equal(regiones.length, 1);
  assert.match(regiones[0].getAttribute("aria-label"), /PCB de KiCad.*Potencia/);
});

test("C2: teclado; es un <button> nativo, enfocable, y conserva el foco tras alternar", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  const [b] = botones(win);
  assert.equal(b.tagName, "BUTTON");
  assert.notEqual(b.getAttribute("tabindex"), "-1");
  assert.equal(b.disabled, false);
  b.focus();
  b.click();
  assert.equal(win.document.activeElement, b, "el mismo botón sigue con el foco");
  assert.equal(b.isConnected, true);
});

// ---------- C3. Preferencia recordada y aplicada a todos ----------

test("C3: módulo kicad-fondo: lee y guarda en una clave propia (no la de KiCanvas); valores desconocidos → claro", async () => {
  const { leerFondoKicad, guardarFondoKicad, CLAVE_FONDO_KICAD } = await fondo();
  assert.equal(typeof CLAVE_FONDO_KICAD, "string");
  assert.ok(CLAVE_FONDO_KICAD && CLAVE_FONDO_KICAD !== "kc:prefs");
  const win = ventana();
  assert.equal(leerFondoKicad(win), "claro");
  guardarFondoKicad(win, "oscuro");
  assert.equal(leerFondoKicad(win), "oscuro");
  guardarFondoKicad(win, "claro");
  assert.equal(leerFondoKicad(win), "claro");
  win.localStorage.setItem(CLAVE_FONDO_KICAD, "<script>");
  assert.equal(leerFondoKicad(win), "claro");
});

test("C3: tolerante a fallos; localStorage que lanza o no existe → claro, y guardar no lanza", async () => {
  const { leerFondoKicad, guardarFondoKicad } = await fondo();
  const rota = ventana();
  Object.defineProperty(rota, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  assert.equal(leerFondoKicad(rota), "claro");
  assert.doesNotThrow(() => guardarFondoKicad(rota, "oscuro"));
  const llena = ventana();
  Object.defineProperty(llena, "localStorage", {
    configurable: true,
    value: { getItem() { throw new Error("x"); }, setItem() { throw new Error("QuotaExceededError"); } },
  });
  assert.equal(leerFondoKicad(llena), "claro");
  assert.doesNotThrow(() => guardarFondoKicad(llena, "oscuro"));
  assert.equal(leerFondoKicad({}), "claro");
  assert.equal(leerFondoKicad(null), "claro");
});

test("C3: con localStorage roto el visor se monta en claro y el botón sigue alternando en la página", async () => {
  const win = ventana();
  Object.defineProperty(win, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  await montar(win, bloque(`archivo: ${A}`));
  assert.deepEqual(temas(win), [CLARO]);
  botones(win)[0].click();
  assert.deepEqual(temas(win), [OSCURO]);
});

test("C3: pulsar el botón guarda la preferencia en localStorage (clave propia)", async () => {
  const { leerFondoKicad, CLAVE_FONDO_KICAD } = await fondo();
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  botones(win)[0].click();
  assert.equal(leerFondoKicad(win), "oscuro");
  assert.ok(win.localStorage.getItem(CLAVE_FONDO_KICAD) != null);
  assert.deepEqual(clavesPropias(win), [CLAVE_FONDO_KICAD], "una sola clave propia");
  botones(win)[0].click();
  assert.equal(leerFondoKicad(win), "claro");
});

test("C3: con la preferencia oscura guardada, los visores se montan con witchhazel y aria-pressed=true", async () => {
  const { guardarFondoKicad } = await fondo();
  const win = ventana();
  guardarFondoKicad(win, "oscuro");
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${C}`)}`);
  assert.deepEqual(temas(win), [OSCURO, OSCURO]);
  assert.deepEqual(botones(win).map((b) => b.getAttribute("aria-pressed")), ["true", "true"]);
});

test("C3: el botón de un visor cambia todos los visores de la página, sin descargar de nuevo ninguno", async () => {
  const win = ventana();
  const f = await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${C}`)}`, falsoKicad((url) => (url.includes(C) ? PCB : SCH)));
  botones(win)[1].click();
  assert.deepEqual(temas(win), [OSCURO, OSCURO]);
  assert.deepEqual(botones(win).map((b) => b.getAttribute("aria-pressed")), ["true", "true"]);
  const fuentes = [...win.document.querySelectorAll("figure.hw-kicad kicanvas-source")].map((s) => s.textContent);
  assert.deepEqual(fuentes, [SCH, PCB], "cada visor conserva su propio archivo");
  assert.equal(f.llamadas.urls.length, 2);
  botones(win)[0].click();
  assert.deepEqual(temas(win), [CLARO, CLARO]);
});

test("C3: los visores montados después de cambiar la preferencia usan el tema elegido", async () => {
  const win = ventana();
  await montar(win, bloque(`archivo: ${A}`));
  botones(win)[0].click();
  // La página se vuelve a pintar (p. ej. tras guardar en el editor) y se monta otro visor.
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${C}`)}`);
  assert.deepEqual(temas(win), [OSCURO, OSCURO]);
  assert.deepEqual(botones(win).map((b) => b.getAttribute("aria-pressed")), ["true", "true"]);
});

// ---------- C4. Sin visor no hay botón ----------

test("C4: sin WebGL2, con descarga fallida, o texto que no es KiCad: aviso role=status y ningún botón", async () => {
  const casos = [
    ["sin WebGL2", falsoKicad(SCH, { webgl2: false })],
    ["HTTP 500", falsoKicad(new Error("HTTP 500"))],
    ["no es KiCad", falsoKicad("<html>no</html>")],
  ];
  for (const [nombre, f] of casos) {
    const win = ventana();
    await montar(win, bloque(`archivo: ${A}\nrespaldo: ${B}`), f);
    assert.ok(win.document.querySelector("figure.hw-kicad [role=status]"), nombre);
    assert.equal(win.document.querySelector("kicanvas-embed"), null, nombre);
    assert.equal(botones(win).length, 0, `${nombre}: sin botón de fondo`);
    assert.equal(win.document.querySelectorAll("figure.hw-kicad a").length, 2, `${nombre}: siguen los enlaces`);
  }
});

test("C4: si falla la carga de kicanvas.js no hay botón", async () => {
  const win = ventana();
  const f = falsoKicad();
  f.kicad.cargarScript = async () => {
    throw new Error("No se pudo cargar KiCanvas");
  };
  await montar(win, bloque(`archivo: ${A}`), f);
  assert.ok(win.document.querySelector("figure.hw-kicad [role=status]"));
  assert.equal(botones(win).length, 0);
});

test("C4: en la vista previa del editor (no se monta el visor) no hay botón", async () => {
  const win = ventana();
  const f = await montar(win, bloque(`archivo: ${A}`), falsoKicad(), { vistaPrevia: true });
  assert.equal(f.llamadas.urls.length, 0);
  assert.equal(botones(win).length, 0);
});

test("C4: con un visor que monta y otro que falla, solo el que monta tiene botón y el cambio no crea visor en el fallido", async () => {
  const win = ventana();
  const f = falsoKicad((url) => (url.includes(C) ? "<html>no</html>" : SCH));
  await montar(win, `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${C}`)}`, f);
  const figs = [...win.document.querySelectorAll("figure.hw-kicad")];
  assert.equal(figs[0].querySelectorAll("button").length, 1);
  assert.equal(figs[1].querySelectorAll("button").length, 0);
  figs[0].querySelector("button").click();
  assert.equal(figs[1].querySelector("kicanvas-embed"), null);
  assert.ok(figs[1].querySelector("[role=status]"));
  assert.equal(f.llamadas.urls.length, 2);
});

// ---------- Estilos (archivo nuevo, sin tocar global.css) ----------

test("estilos: src/styles/kicad.css nuevo, cargado desde Base.astro, con foco visible para el botón y solo tokens (sin colores nuevos)", () => {
  assert.ok(existsSync(new URL("../src/styles/kicad.css", import.meta.url)), "src/styles/kicad.css");
  const css = leer("src/styles/kicad.css");
  assert.match(css, /figure\.hw-kicad[^{]*\.btn[^{]*:focus-visible[^{]*\{[^}]*outline/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "solo var(--…)");
  assert.match(leer("src/layouts/Base.astro"), /import\s+["']\.\.\/styles\/kicad\.css["']/);
});

test("vendor intacto: kicanvas.js no se edita y sigue trayendo los temas kicad y witchhazel", () => {
  const js = leer("public/vendor/kicanvas/kicanvas.js");
  assert.match(js, /name:"kicad"/);
  assert.match(js, /name:"witchhazel"/);
});
