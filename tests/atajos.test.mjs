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

// ---------- Lote 8a: barras laterales y modo enfoque ----------
test("[ y ] pliegan la barra izquierda y la derecha; f alterna el modo enfoque (también con Bloq Mayús)", () => {
  assert.equal(atajo(null, t("[")).accion, "izquierda");
  assert.equal(atajo(null, t("]")).accion, "derecha");
  assert.equal(atajo(null, t("f")).accion, "enfoque");
  assert.equal(atajo(null, t("F")).accion, "enfoque");
  assert.equal(atajo(null, t("f")).pendiente, null);
});

test("[ y ] con AltGr (teclado español: Windows reporta Ctrl+Alt) sí cuentan; con Ctrl o Alt solos, no", () => {
  assert.equal(atajo(null, t("[", { ctrlKey: true, altKey: true, altGraph: true })).accion, "izquierda");
  assert.equal(atajo(null, t("]", { ctrlKey: true, altKey: true, altGraph: true })).accion, "derecha");
  assert.equal(atajo(null, t("[", { ctrlKey: true })).accion, null);
  assert.equal(atajo(null, t("]", { altKey: true })).accion, null);
  assert.equal(atajo(null, t("f", { ctrlKey: true })).accion, null, "Ctrl F sigue siendo buscar del navegador");
  assert.equal(atajo(null, t("f", { metaKey: true })).accion, null);
});

test("[ ] f se ignoran al escribir o con un diálogo abierto", () => {
  for (const k of ["[", "]", "f"]) {
    assert.equal(atajo(null, t(k, { escribiendo: true })).accion, null, `${k} escribiendo`);
    assert.equal(atajo(null, t(k, { dialogoAbierto: true })).accion, null, `${k} con diálogo`);
  }
});

test("destino: las acciones de barras no navegan", () => {
  const rutas = { wiki: "/uuv/quickstart/", grafo: "/uuv/grafo/", novedades: "/uuv/novedades/" };
  for (const a of ["izquierda", "derecha", "enfoque"]) assert.equal(destino(a, rutas), null, a);
});

test("ATAJOS: la ayuda lista [ ] y f", () => {
  for (const k of ["[", "]", "f"]) assert.ok(ATAJOS.some((a) => a.teclas.join(" ") === k), `falta ${k}`);
  const texto = ATAJOS.map((a) => a.descripcion).join("\n");
  assert.match(texto, /[Nn]avegación/);
  assert.match(texto, /[Íí]ndice/);
  assert.match(texto, /[Ee]nfoque/);
});
