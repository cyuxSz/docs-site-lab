// Atajos globales de teclado (src/lib/atajos.ts): g w / g g / g n / ?, ignorados al escribir, con modificadores o
// con un diálogo abierto. Lógica pura: el script del navegador solo traduce el evento y navega.
import { test } from "node:test";
import assert from "node:assert/strict";
import { atajo, destino, ATAJOS, VENTANA_ATAJO } from "../src/lib/atajos.ts";

const t = (key, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, escribiendo: false, dialogoAbierto: false, t: 1000, ...extra });
const secuencia = (teclas, gap = 100) => {
  let pendiente = null;
  let ultima = null;
  teclas.forEach((k, i) => {
    ultima = atajo(pendiente, t(k, { t: 1000 + i * gap }));
    pendiente = ultima.pendiente;
  });
  return ultima;
};

test("g seguido de w / g / n dispara wiki, grafo y novedades", () => {
  assert.equal(secuencia(["g", "w"]).accion, "wiki");
  assert.equal(secuencia(["g", "g"]).accion, "grafo");
  assert.equal(secuencia(["g", "n"]).accion, "novedades");
  assert.equal(secuencia(["G", "W"]).accion, "wiki", "Bloq Mayús no lo rompe");
});

test("g deja la secuencia pendiente y no dispara nada; otra tecla la cancela", () => {
  const r = atajo(null, t("g"));
  assert.equal(r.accion, null);
  assert.equal(typeof r.pendiente, "number");
  assert.equal(secuencia(["g", "x"]).accion, null);
  assert.equal(secuencia(["g", "x"]).pendiente, null);
  assert.equal(secuencia(["w"]).accion, null, "w sola no hace nada");
});

test("la segunda tecla fuera de VENTANA_ATAJO ya no cuenta", () => {
  assert.equal(typeof VENTANA_ATAJO, "number");
  assert.equal(secuencia(["g", "w"], VENTANA_ATAJO + 1).accion, null);
  assert.equal(secuencia(["g", "w"], VENTANA_ATAJO - 1).accion, "wiki");
});

test("? abre la ayuda (aunque venga con Shift, que es como se escribe)", () => {
  assert.equal(atajo(null, t("?")).accion, "ayuda");
  assert.equal(atajo(null, t("?", { shiftKey: true })).accion, "ayuda");
});

test("se ignora al escribir, con Ctrl/Cmd/Alt o con un diálogo abierto (y se pierde lo pendiente)", () => {
  for (const extra of [{ escribiendo: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { dialogoAbierto: true }]) {
    const k = JSON.stringify(extra);
    assert.equal(atajo(null, t("?", extra)).accion, null, k);
    assert.equal(atajo(null, t("g", extra)).pendiente, null, `g no queda pendiente con ${k}`);
    assert.equal(atajo(1000, t("w", { ...extra, t: 1100 })).accion, null, `w no completa con ${k}`);
  }
});

test("destino: rutas del proyecto actual; fuera de un proyecto, wiki/grafo/novedades no van a ningún lado", () => {
  const rutas = { wiki: "/uuv/quickstart/", grafo: "/uuv/grafo/", novedades: "/uuv/novedades/" };
  assert.equal(destino("wiki", rutas), "/uuv/quickstart/");
  assert.equal(destino("grafo", rutas), "/uuv/grafo/");
  assert.equal(destino("novedades", rutas), "/uuv/novedades/");
  assert.equal(destino("ayuda", rutas), null, "la ayuda no navega");
  assert.equal(destino("wiki", {}), null);
  assert.equal(destino("grafo", { wiki: "/uuv/quickstart/" }), null);
});

test("ATAJOS: la lista del diálogo de ayuda incluye todos, también Ctrl K y / de la búsqueda", () => {
  for (const k of ["g w", "g g", "g n", "?", "Ctrl K", "/"]) assert.ok(ATAJOS.some((a) => a.teclas.join(" ") === k), `falta ${k}`);
  const texto = ATAJOS.map((a) => a.descripcion).join("\n");
  assert.match(texto, /[Ww]iki/);
  assert.match(texto, /[Gg]rafo/);
  assert.match(texto, /[Nn]ovedades/);
  assert.match(texto, /[Bb]uscar/);
  for (const a of ATAJOS) assert.ok(a.descripcion.length > 0);
});
