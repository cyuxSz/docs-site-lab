// Lote e-integrados · hilos de CodeRabbit del PR 61 (criterios 11, 12 y 13): el CSV se lee en modo estricto y el nombre del
// integrado tiene una franja propia, de modo que no se encima con los rótulos de los pines de arriba ni de abajo.
// Los tests de geometría miden la salida real (mxGeometry de las celdas, posición de los <text>), no el código del generador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SIN_PYTHON, archivos, generar, generarBien, join, ladoDePunto, leerBiblioteca, leerSvg, puntos, readFileSync,
} from "./fixtures/integrados.mjs";

const CAB = "integrado,pin,nombre,lado\n";
const LARGO = "ABCDEFGHIJKLMNOPQRST";

// ── Criterio 11: CSV estricto ───────────────────────────────────────────────────────────────────────────────────────
function rechazaMalFormado(contenido, que) {
  const r = generar("a.csv", contenido);
  assert.equal(r.codigo, 1, `${que}: debía salir con 1 (salió con ${r.codigo}); stdout: ${r.salida}; stderr: ${r.error}`);
  assert.match(r.error, /^error: /m, `${que}: el mensaje empieza por «error: »`);
  assert.match(r.error, /mal formado/i, `${que}: el mensaje dice «CSV mal formado»; stderr: ${r.error}`);
  assert.doesNotMatch(r.error, /Traceback|File ".*", line \d+/, `${que}: sin traza de Python`);
  assert.deepEqual(archivos(r.dir), [], `${que}: no deja archivos a medias`);
  return r;
}

test("CSV estricto: texto pegado a una comilla de cierre («\"A\"B») se rechaza como CSV mal formado, con su línea", SIN_PYTHON, () => {
  const r = rechazaMalFormado(`${CAB}U1,1,"A"B,izquierda\n`, "comilla de cierre seguida de texto");
  assert.ok(r.error.includes("a.csv:2:"), `indica la línea 2 como «a.csv:2:»; stderr: ${r.error}`);
  const s = rechazaMalFormado(`${CAB}U1,1,A,izquierda\nU1,2,B,derecha\nU1,3,"C"D,derecha\n`, "la fila mala es la cuarta línea");
  assert.ok(s.error.includes("a.csv:4:"), `indica la línea 4 como «a.csv:4:»; stderr: ${s.error}`);
});

test("CSV estricto: una comilla que no se cierra se rechaza como CSV mal formado", SIN_PYTHON, () => {
  rechazaMalFormado(`${CAB}U1,1,"A,izquierda\n`, "comilla sin cerrar");
});

test("CSV estricto: las comillas bien formadas siguen funcionando (comas dentro y \"\" escapadas)", SIN_PYTHON, () => {
  const r = generarBien("a.csv", `${CAB}U1,1,"A,B",izquierda\nU1,2,"di ""x""",derecha\n"U,2",1,"C",izquierda\n`);
  assert.equal(r.error, "", "sin avisos");
  const [u1, u2] = leerBiblioteca(join(r.dir, "a.xml"));
  assert.equal(u1.title, "U1");
  assert.deepEqual(u1.etiquetas.map((c) => c.valor), ["1", "A,B", "2", 'di "x"']);
  assert.equal(u2.title, "U,2");
  assert.deepEqual(u2.etiquetas.map((c) => c.valor), ["1", "C"]);
});

// ── Geometría ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Cajas {x0, y0, x1, y1}. Dos cajas se solapan si se pisan más de medio píxel en los dos ejes (tocarse por el borde no cuenta).
const solapan = (a, b) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
const ver = (c) => `[x ${c.x0.toFixed(1)}…${c.x1.toFixed(1)}, y ${c.y0.toFixed(1)}…${c.y1.toFixed(1)}]`;
// Ancho estimado de un texto: 0,6 × tamaño de letra por carácter; alto de línea: 1,2 × tamaño.
const ANCHO_CAR = 0.6;

const estiloMapa = (estilo) => Object.fromEntries(
  estilo.split(";").filter((p) => p.includes("=")).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
const numEstilo = (m, k, def = 0) => (m[k] !== undefined && m[k] !== "" && Number.isFinite(Number(m[k])) ? Number(m[k]) : def);

function geometria(celda) {
  const geo = [...celda.children].find((n) => n.nodeName === "mxGeometry");
  assert.ok(geo, `la celda ${celda.getAttribute("id")} tiene mxGeometry`);
  const v = (a) => Number(geo.getAttribute(a) || 0);
  return { x: v("x"), y: v("y"), w: v("width"), h: v("height") };
}

// Caja visible de una etiqueta: su mxGeometry, girada alrededor de su centro si el estilo lleva rotation=90|270.
function cajaEtiqueta(celda) {
  const { x, y, w, h } = geometria(celda);
  const giro = ((numEstilo(estiloMapa(celda.getAttribute("style") || ""), "rotation") % 180) + 180) % 180;
  assert.ok(giro === 0 || giro === 90, `rotación no prevista en la etiqueta ${celda.getAttribute("id")}: ${giro}`);
  const cx = x + w / 2, cy = y + h / 2;
  const [mx, my] = giro === 90 ? [h / 2, w / 2] : [w / 2, h / 2];
  return { x0: cx - mx, x1: cx + mx, y0: cy - my, y1: cy + my };
}

// Caja del nombre del integrado: es el rótulo de la celda «cuerpo», colocado como lo coloca diagrams.net según
// align / verticalAlign / spacing / spacingTop|Bottom|Left|Right del estilo.
function cajaNombreCuerpo(cuerpo) {
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
function cajaTexto(t, raiz) {
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

// Casos: [descripción, nombre del integrado, filas «pin,nombre,lado»].
const CASOS = [
  ["solo un pin arriba con nombre largo", "U1", [`1,${LARGO},arriba`]],
  ["solo un pin abajo con nombre largo", "U1", [`1,${LARGO},abajo`]],
  ["arriba (largo) y abajo (corto), sin pines laterales", "U1", [`1,${LARGO},arriba`, "2,GND,abajo"]],
  ["arriba (corto) y abajo (largo), sin pines laterales", "U1", ["1,VCC,arriba", `2,${LARGO},abajo`]],
  ["tres pines arriba y tres abajo con nombres largos, sin laterales", "U1",
    [`1,${LARGO},arriba`, "2,B,arriba", `3,${LARGO},arriba`, "4,C,abajo", `5,${LARGO},abajo`, "6,D,abajo"]],
  ["pines laterales y un pin arriba con nombre largo", "NE555X", ["2,IN,izquierda", "3,OUT,derecha", `1,${LARGO},arriba`]],
  ["pines laterales y un pin abajo con nombre largo", "NE555X", ["2,IN,izquierda", "3,OUT,derecha", `1,${LARGO},abajo`]],
  ["pines laterales, arriba (largo) y abajo (largo)", "NE555X",
    ["2,IN,izquierda", "6,THR,izquierda", "3,OUT,derecha", `8,${LARGO},arriba`, `1,${LARGO},abajo`]],
];
const csvDe = (chip, filas) => CAB + filas.map((f) => `${chip},${f}\n`).join("");

// ── Criterio 12: biblioteca de diagrams.net ─────────────────────────────────────────────────────────────────────────
for (const [que, chip, filas] of CASOS) {
  test(`biblioteca: el nombre del integrado no se encima con los rótulos de arriba/abajo · ${que}`, SIN_PYTHON, () => {
    const r = generarBien("c.csv", csvDe(chip, filas));
    const [e] = leerBiblioteca(join(r.dir, "c.xml"));
    const cuerpo = e.modelo.querySelector('mxCell[id="cuerpo"]');
    assert.equal(cuerpo.getAttribute("value"), chip, "el nombre sigue siendo el rótulo del cuerpo");
    const { caja: nombre, w, h } = cajaNombreCuerpo(cuerpo);
    assert.ok(nombre.x0 >= -0.5 && nombre.x1 <= w + 0.5 && nombre.y0 >= -0.5 && nombre.y1 <= h + 0.5,
      `el nombre queda dentro de la caja ${w}×${h}: ${ver(nombre)}`);
    const lados = puntos(cuerpo.getAttribute("style")).map(ladoDePunto);
    const etiquetas = [...e.modelo.querySelectorAll('mxCell[parent="cuerpo"]')];
    assert.equal(etiquetas.length, lados.length * 2, "dos etiquetas por pin, en el orden de los pines");
    let medidas = 0;
    etiquetas.forEach((c, i) => {
      const lado = lados[Math.floor(i / 2)];
      if (lado !== "arriba" && lado !== "abajo") return;
      const caja = cajaEtiqueta(c);
      medidas += 1;
      assert.ok(!solapan(nombre, caja),
        `el nombre «${chip}» ${ver(nombre)} se encima con el rótulo «${c.getAttribute("value")}» (${lado}) ${ver(caja)} en una caja de ${w}×${h}`);
    });
    assert.equal(medidas, filas.filter((f) => /,(arriba|abajo)$/.test(f)).length * 2, "se midieron todos los rótulos de arriba y abajo");
  });
}

// ── Criterio 13: SVG de vista previa ────────────────────────────────────────────────────────────────────────────────
for (const [que, chip, filas] of CASOS) {
  test(`SVG: el título no se encima con los rótulos de los pines de arriba/abajo · ${que}`, SIN_PYTHON, () => {
    const r = generarBien("c.csv", csvDe(chip, filas));
    const [archivo] = archivos(r.dir).filter((f) => f.endsWith(".svg"));
    const svg = leerSvg(join(r.dir, archivo));
    const titulos = [...svg.doc.querySelectorAll("text")].filter((t) => !t.closest("g.pin") && t.textContent === chip);
    assert.equal(titulos.length, 1, "hay un <text> con el nombre del integrado fuera de los grupos de pin");
    const titulo = cajaTexto(titulos[0], svg.raiz);
    const [, , vw, vh] = svg.raiz.getAttribute("viewBox").split(/\s+/).map(Number);
    assert.ok(titulo.x0 >= 0 && titulo.x1 <= vw && titulo.y0 >= 0 && titulo.y1 <= vh, `el título queda dentro del dibujo: ${ver(titulo)}`);
    let medidos = 0;
    for (const g of svg.doc.querySelectorAll("g.pin")) {
      const lado = g.getAttribute("data-lado");
      if (lado !== "arriba" && lado !== "abajo") continue;
      for (const t of g.querySelectorAll("text")) {
        const caja = cajaTexto(t, svg.raiz);
        medidos += 1;
        assert.ok(!solapan(titulo, caja),
          `el título «${chip}» ${ver(titulo)} se encima con el rótulo «${t.textContent}» (${lado}) ${ver(caja)}`);
      }
    }
    assert.equal(medidos, filas.filter((f) => /,(arriba|abajo)$/.test(f)).length * 2, "se midieron el número y el nombre de cada pin de arriba y abajo");
  });
}

// ── Regresión: los integrados que solo tienen pines laterales no cambian ────────────────────────────────────────────
const SOLO_LATERALES = [
  "integrado,pin,nombre,lado,tipo",
  "LM358,1,OUT1,izquierda,salida",
  "LM358,2,IN1-,izquierda,entrada",
  "LM358,3,IN1+,izquierda,entrada",
  "LM358,4,GND,izquierda,alimentacion",
  "LM358,8,VCC,derecha,alimentacion",
  "LM358,7,OUT2,derecha,salida",
  "LM358,6,IN2-,derecha,entrada",
  "LM358,5,IN2+,derecha,",
  "",
].join("\n");
const HUELLAS = {
  "lm358.svg": "3f397cbe2c860fba1e088a8d04a19e5eaf3b36d551701092035133c8ce6ee8e6",
  "lm358.xml": "e6d6e0ca0a14934936aaa65607309b2f0730e5607a07bd837c1694d86a5c93c4",
};

test("regresión: un integrado solo con pines laterales genera exactamente los mismos bytes que antes de reservar la franja", SIN_PYTHON, () => {
  const r = generarBien("lm358.csv", SOLO_LATERALES);
  assert.deepEqual(archivos(r.dir), Object.keys(HUELLAS));
  for (const [f, huella] of Object.entries(HUELLAS)) {
    assert.equal(createHash("sha256").update(readFileSync(join(r.dir, f))).digest("hex"), huella,
      `${f} cambió: la franja del nombre solo debe afectar a integrados con pines arriba o abajo`);
  }
});
