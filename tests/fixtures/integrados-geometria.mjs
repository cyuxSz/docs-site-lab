// Geometría de la salida del generador de integrados: cajas de las etiquetas de la biblioteca de diagrams.net y de los <text>
// del SVG, con un ancho de texto estimado. Salió tal cual de tests/e-integrados-cr61.test.mjs para compartirla entre lotes.
import assert from "node:assert/strict";

// Cajas {x0, y0, x1, y1}. Dos cajas se solapan si se pisan más de medio píxel en los dos ejes (tocarse por el borde no cuenta).
export const solapan = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
export const ver = (c) => `[x ${c.x0.toFixed(1)}…${c.x1.toFixed(1)}, y ${c.y0.toFixed(1)}…${c.y1.toFixed(1)}]`;
// Ancho estimado de un texto: 0,6 × tamaño de letra por carácter; alto de línea: 1,2 × tamaño.
export const ANCHO_CAR = 0.6;

export const estiloMapa = (estilo) => Object.fromEntries(
  estilo.split(";").filter((p) => p.includes("=")).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
export const numEstilo = (m, k, def = 0) => (m[k] !== undefined && m[k] !== "" && Number.isFinite(Number(m[k])) ? Number(m[k]) : def);

export function geometria(celda) {
  const geo = [...celda.children].find((n) => n.nodeName === "mxGeometry");
  assert.ok(geo, `la celda ${celda.getAttribute("id")} tiene mxGeometry`);
  const v = (a) => Number(geo.getAttribute(a) || 0);
  return { x: v("x"), y: v("y"), w: v("width"), h: v("height") };
}

// Caja visible de una etiqueta: su mxGeometry, girada alrededor de su centro si el estilo lleva rotation=90|270.
export function cajaEtiqueta(celda) {
  const { x, y, w, h } = geometria(celda);
  const giro = ((numEstilo(estiloMapa(celda.getAttribute("style") || ""), "rotation") % 180) + 180) % 180;
  assert.ok(giro === 0 || giro === 90, `rotación no prevista en la etiqueta ${celda.getAttribute("id")}: ${giro}`);
  const cx = x + w / 2, cy = y + h / 2;
  const [mx, my] = giro === 90 ? [h / 2, w / 2] : [w / 2, h / 2];
  return { x0: cx - mx, x1: cx + mx, y0: cy - my, y1: cy + my };
}

// Caja del nombre del integrado: es el rótulo de la celda «cuerpo», colocado como lo coloca diagrams.net según
// align / verticalAlign / spacing / spacingTop|Bottom|Left|Right del estilo.
export function cajaNombreCuerpo(cuerpo) {
  const { w, h } = geometria(cuerpo);
  const st = estiloMapa(cuerpo.getAttribute("style") || "");
  for (const k of ["labelPosition", "verticalLabelPosition", "rotation", "horizontal"]) {
    assert.ok(!(k in st), `el test no interpreta «${k}» en el estilo del cuerpo; el nombre debe ir dentro de la caja`);
  }
  const fs = numEstilo(st, "fontSize", 12);
  const ancho = Math.min((cuerpo.getAttribute("value") || "").length * fs * ANCHO_CAR, w);
  const alto = fs * 1.2;
  const sp = numEstilo(st, "spacing", 2);
  const arriba = numEstilo(st, "spacingTop"), abajo = numEstilo(st, "spacingBottom");
  const izq = numEstilo(st, "spacingLeft"), der = numEstilo(st, "spacingRight");
  let x0, y0;
  const align = st.align || "center", vert = st.verticalAlign || "middle";
  if (align === "left") x0 = sp + izq;
  else if (align === "right") x0 = w - sp - der - ancho;
  else x0 = w / 2 + (izq - der) / 2 - ancho / 2;
  if (vert === "top") y0 = sp + arriba;
  else if (vert === "bottom") y0 = h - sp - abajo - alto;
  else y0 = h / 2 + (arriba - abajo) / 2 - alto / 2;
  return { caja: { x0, x1: x0 + ancho, y0, y1: y0 + alto }, w, h };
}

// Caja de un <text> del SVG: ancla, línea base y tamaño de letra, y rotate(a cx cy) si lo lleva.
export function cajaTexto(t, raiz) {
  for (let p = t.parentElement; p; p = p.parentElement) {
    assert.ok(!p.hasAttribute("transform"), "el test no interpreta transform en los contenedores de un <text>");
  }
  const fs = Number(t.getAttribute("font-size") || raiz.getAttribute("font-size") || 12);
  const x = Number(t.getAttribute("x") || 0), y = Number(t.getAttribute("y") || 0);
  const largo = t.textContent.length * fs * ANCHO_CAR;
  const ancla = t.getAttribute("text-anchor") || "start";
  const x0 = ancla === "end" ? x - largo : ancla === "middle" ? x - largo / 2 : x;
  let esquinas = [[x0, y - 0.8 * fs], [x0 + largo, y - 0.8 * fs], [x0, y + 0.2 * fs], [x0 + largo, y + 0.2 * fs]];
  const tr = t.getAttribute("transform");
  if (tr) {
    const m = /^\s*rotate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+))?\s*\)\s*$/.exec(tr);
    assert.ok(m, `transform no previsto en un <text>: ${tr}`);
    const a = (Number(m[1]) * Math.PI) / 180, cx = Number(m[2] || 0), cy = Number(m[3] || 0);
    esquinas = esquinas.map(([px, py]) => [
      cx + (px - cx) * Math.cos(a) - (py - cy) * Math.sin(a),
      cy + (px - cx) * Math.sin(a) + (py - cy) * Math.cos(a),
    ]);
  }
  const xs = esquinas.map((e) => e[0]), ys = esquinas.map((e) => e[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
