// Minimapa del grafo (src/lib/minimapa.ts): encuadre de todo el grafo en el canvas, conversión grafo<->minimapa
// (ida y vuelta), rectángulo de la vista actual recortado al canvas y visibilidad por preferencia/ancho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encuadre, aMinimapa, aGrafo, rectVista, minimapaVisible, claveMinimapa } from "../src/lib/minimapa.ts";

const NODOS = [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 25 }];
const cerca = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("encuadre: todo el grafo cabe en el canvas, con margen y sin deformar (misma escala en x e y)", () => {
  const t = encuadre(NODOS, 160, 120, 8);
  for (const n of NODOS) {
    const [px, py] = aMinimapa(t, n.x, n.y);
    assert.ok(px >= 8 - 1e-9 && px <= 152 + 1e-9, `x ${px} fuera`);
    assert.ok(py >= 8 - 1e-9 && py <= 112 + 1e-9, `y ${py} fuera`);
  }
  // Ancho 100 en 144 px útiles; alto 50 en 104 px → manda el ancho: escala 1.44.
  cerca(t.escala, 1.44);
  // Centrado: el centro del grafo cae en el centro del canvas.
  const [cx, cy] = aMinimapa(t, 50, 25);
  cerca(cx, 80);
  cerca(cy, 60);
});

test("encuadre: y del grafo hacia arriba, y del canvas hacia abajo (como Sigma)", () => {
  const t = encuadre(NODOS, 160, 120, 8);
  const [, yBajo] = aMinimapa(t, 0, 0);
  const [, yAlto] = aMinimapa(t, 0, 50);
  assert.ok(yAlto < yBajo, "un nodo con y mayor se dibuja más arriba");
});

test("encuadre: grafo vacío o de un solo punto no divide entre cero", () => {
  for (const nodos of [[], [{ x: 3, y: 3 }]]) {
    const t = encuadre(nodos, 100, 100, 4);
    assert.ok(Number.isFinite(t.escala) && t.escala > 0);
    const [px, py] = aMinimapa(t, 3, 3);
    assert.ok(Number.isFinite(px) && Number.isFinite(py));
  }
});

test("aGrafo es la inversa de aMinimapa (clic en el minimapa -> punto del grafo)", () => {
  const t = encuadre(NODOS, 200, 90, 6);
  for (const [x, y] of [[0, 0], [100, 50], [37.5, 12], [-20, 80]]) {
    const [px, py] = aMinimapa(t, x, y);
    const [gx, gy] = aGrafo(t, px, py);
    cerca(gx, x);
    cerca(gy, y);
  }
});

test("rectVista: rectángulo de la vista actual en px del minimapa, normalizado y recortado al canvas", () => {
  const t = encuadre(NODOS, 160, 120, 8);
  // Vista = mitad izquierda del grafo (esquinas en cualquier orden).
  const r = rectVista(t, { x0: 50, y0: 0, x1: 0, y1: 50 }, 160, 120);
  const [ax, ay] = aMinimapa(t, 0, 50);
  const [bx, by] = aMinimapa(t, 50, 0);
  cerca(r.x, ax);
  cerca(r.y, ay);
  cerca(r.w, bx - ax);
  cerca(r.h, by - ay);
  // Vista muy alejada (zoom out): se recorta al canvas, nunca sale de él.
  const g = rectVista(t, { x0: -1000, y0: -1000, x1: 1000, y1: 1000 }, 160, 120);
  assert.deepEqual([g.x, g.y, g.w, g.h], [0, 0, 160, 120]);
});

test("minimapaVisible: preferencia guardada manda; sin preferencia, oculto por debajo de 640 px", () => {
  assert.equal(minimapaVisible(null, 375), false);
  assert.equal(minimapaVisible(null, 639), false);
  assert.equal(minimapaVisible(null, 640), true);
  assert.equal(minimapaVisible(null, 1280), true);
  assert.equal(minimapaVisible("1", 375), true);
  assert.equal(minimapaVisible("0", 1280), false);
  assert.equal(minimapaVisible("basura", 1280), true);
  assert.equal(typeof claveMinimapa, "string");
  assert.match(claveMinimapa, /minimapa/);
});
