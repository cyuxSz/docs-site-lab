// Lote 1B-2 de «tokens de dispositivo»: dos pulidos de la verificación en navegador (criterios 10 y 11 de
// .factory/spec.md). El texto de la página 429 del tope y el objetivo táctil del enlace «Cancelar».
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { T0, crearEnv, sesion, peticionApp, consentir, autorizar, enviarAutorizar } from "./fixtures/tokens-1b2.mjs";

const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const texto = (el) => el.textContent.replace(/\s+/g, " ").trim();

test("tope: la página 429 explica el motivo real (intentos pendientes), no manda a iniciar sesión y cabe en un párrafo", async () => {
  const { env } = crearEnv();
  const cookie = sesion("ana");
  for (let i = 0; i < 5; i++) await autorizar(env, cookie, peticionApp().params);
  const { campos } = await consentir(env, cookie, peticionApp().params);
  const res = await enviarAutorizar(env, { cookie, campos });
  assert.equal(res.status, 429);
  const doc = new JSDOM(await res.text()).window.document;
  assert.equal(texto(doc.querySelector("h1")), "Demasiados intentos");
  // «VantTec Docs» con espacio duro (U+00A0): a 375 px, si no caben juntas, bajan las dos y «Docs.» no queda huérfana.
  const crudos = [...doc.querySelectorAll("main p")].map((p) => p.textContent);
  assert.equal(crudos.length, 1);
  assert.ok(crudos[0].includes("VantTec Docs"), "«VantTec» y «Docs» van unidas por un espacio duro");
  assert.ok(!crudos[0].includes("VantTec Docs"), "no queda «VantTec Docs» con espacio normal");
  const parrafos = [...doc.querySelectorAll("main p")].map((p) => p.textContent.replace(/ /g, " ").replace(/s+/g, " ").trim());
  assert.deepEqual(parrafos, ["Hay demasiados intentos pendientes. Espera un minuto y vuelve a intentarlo desde VantTec Docs."]);
  assert.ok(!/sesión/i.test(texto(doc.body)), "el motivo no es la sesión: el texto no habla de iniciar sesión");
  assert.equal(doc.querySelectorAll("a, form, button").length, 0, "sigue sin enlaces ni controles");
});

test("consentimiento: «Cancelar» tiene un área pulsable de al menos 24 px de alto y sigue pareciendo un enlace", async () => {
  const { env } = crearEnv();
  const { html } = await consentir(env, sesion("ana"), peticionApp().params);
  // jsdom no maqueta, pero sí aplica las reglas del <style> de la página: se mira lo que le toca al enlace.
  const { window } = new JSDOM(html);
  const enlaces = [...window.document.querySelectorAll("a[href]")];
  const cancelar = enlaces.find((a) => texto(a) === "Cancelar");
  assert.ok(cancelar, "el enlace «Cancelar» sigue en la página");
  const cs = window.getComputedStyle(cancelar);

  // min-height no actúa sobre una caja en línea: hace falta una caja con alto propio.
  assert.ok(["inline-block", "inline-flex", "block", "flex"].includes(cs.display), `display del enlace: ${cs.display} (en línea mide 21 px y min-height no le afecta)`);
  assert.match(cs.minHeight, /^\d+(\.\d+)?px$/, `min-height del enlace: ${cs.minHeight}`);
  assert.ok(parseFloat(cs.minHeight) >= 24, `min-height del enlace: ${cs.minHeight}`);

  // Mismo aspecto: enlace de texto del color de siempre, subrayado, sin fondo, borde ni relleno de botón.
  assert.equal(cs.color, "rgb(73, 193, 210)");
  assert.match(cs.textDecoration || cs.textDecorationLine, /underline/);
  assert.ok(["rgba(0, 0, 0, 0)", "transparent", ""].includes(cs.backgroundColor), `fondo: ${cs.backgroundColor}`);
  for (const lado of ["Top", "Right", "Bottom", "Left"]) assert.ok(["none", ""].includes(cs[`border${lado}Style`]), `borde ${lado}: ${cs[`border${lado}Style`]}`);
  assert.equal(cs.fontSize, window.getComputedStyle(cancelar.parentElement).fontSize, "mismo tamaño de letra que su párrafo");
  assert.equal(cs.fontWeight, window.getComputedStyle(cancelar.parentElement).fontWeight);
  assert.ok(!cancelar.classList.contains("b"), "no se convierte en botón");

  // Sin elementos nuevos: el mismo <a href="/"> con solo texto, dentro de su párrafo, y los dos enlaces de siempre.
  assert.equal(cancelar.getAttribute("href"), "/");
  assert.equal(cancelar.children.length, 0);
  assert.equal(cancelar.parentElement.tagName, "P");
  assert.equal(cancelar.parentElement.children.length, 1, "el párrafo solo contiene el enlace");
  assert.deepEqual(enlaces.map(texto).sort(), ["Cancelar", "Dispositivos"]);
  const etiquetas = [...window.document.querySelectorAll("main *")].map((e) => e.tagName.toLowerCase());
  assert.deepEqual(etiquetas, ["h1", "div", "p", "p", "a", "form", "input", "input", "input", "input", "input", "button", "p", "a"], "la página tiene los mismos elementos que antes del cambio");
});
