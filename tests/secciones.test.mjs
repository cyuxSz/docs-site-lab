// Grafos por sección (capa) del UUV: subconjunto de nodos y recorrido automático. Lógica pura en src/lib/secciones.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { seccion, seccionesDe, recorridoSeccion, listaCorta } from "../src/lib/secciones.ts";
import { graphNodes as N, graphEdges as E, CONTROL, NAVEGACION } from "./fixtures/ros-mini.mjs";

test("seccion: núcleo = nodos de la capa sin legado/sin uso; canales = topics/servicios que usan; contexto = el otro lado", () => {
  const s = seccion(N, E, "control");
  assert.equal(s.id, "control");
  assert.deepEqual(s.core, ["ctl/asmc", "ctl/thrust_allocator"]);
  assert.deepEqual(s.channels, ["topic:/forces", "topic:/matriz", "topic:/pose", "topic:/pose_objetivo"]);
  assert.deepEqual(s.context, ["ext/bridge", "mis/instruction_handler", "nav/camera_opener", "viz/plotter"]);
});

test("seccion: con showOld entran legado/sin uso y sus canales", () => {
  const s = seccion(N, E, "control", { showOld: true });
  assert.deepEqual(s.core, ["ctl/asmc", "ctl/sinuso", "ctl/thrust_allocator", "ctl/viejo"]);
  assert.ok(s.channels.includes("topic:/debug"));
});

test("seccion: el contexto nunca incluye nodos legado/sin uso por defecto", () => {
  const s = seccion(N, E, "control");
  assert.ok(!s.context.includes("ctl/viejo"));
  assert.ok(!s.channels.includes("topic:/debug"), "/debug solo lo usa un nodo oculto");
});

test("seccion: navegación incluye servicios y el hardware conectado directo", () => {
  const s = seccion(N, E, "navegacion");
  assert.deepEqual(s.core, ["nav/camera_opener"]);
  assert.deepEqual(s.channels, ["service:/take_picture", "topic:/pose"]);
  assert.deepEqual(s.context, ["ctl/asmc", "hw:zed", "mis/instruction_handler"]);
});

test("seccion: la capa hardware toma los nodos de hardware como núcleo", () => {
  const s = seccion(N, E, "hardware");
  assert.deepEqual(s.core, ["hw:zed"]);
  assert.deepEqual(s.context, ["nav/camera_opener"]);
});

test("seccionesDe: solo capas con nodos propios (incluido legado), en el orden dado, sin topic/service", () => {
  const ids = seccionesDe(N, E, ["control", "mision", "navegacion", "vision", "visualizacion", "externo", "hardware", "topic", "service"]);
  assert.deepEqual(ids, ["control", "mision", "navegacion", "visualizacion", "externo", "hardware"]);
});

test("listaCorta: une con comas e 'y', y corta con 'y N más'", () => {
  assert.equal(listaCorta([]), "");
  assert.equal(listaCorta(["a"]), "a");
  assert.equal(listaCorta(["a", "b"]), "a y b");
  assert.equal(listaCorta(["a", "b", "c"]), "a, b y c");
  assert.equal(listaCorta(["a", "b", "c", "d", "e"]), "a, b, c y 2 más");
  assert.equal(listaCorta(["a", "b", "c"], 2), "a, b y 1 más");
});

test("recorridoSeccion: recorre el núcleo en el orden del flujo de datos", () => {
  const s = seccion(N, E, "control");
  const tour = recorridoSeccion(s, N, E, CONTROL);
  assert.deepEqual(tour.map((t) => t.node), ["ctl/asmc", "ctl/thrust_allocator"]);
});

test("recorridoSeccion: la primera frase es la capa con su hint; el texto dice qué recibe, de quién, qué publica y para quién", () => {
  const s = seccion(N, E, "control");
  const [a, b] = recorridoSeccion(s, N, E, CONTROL);
  assert.ok(a.text.startsWith("Control: calcula las fuerzas para mover el sub."), a.text);
  assert.match(a.text, /asmc recibe /);
  assert.match(a.text, /\/pose \(de camera_opener\)/);
  assert.match(a.text, /\/pose_objetivo \(de instruction_handler\)/);
  assert.match(a.text, /publica \/forces \(para thrust_allocator y plotter\)/);
  assert.ok(!a.text.includes("viejo"), "no menciona nodos ocultos");
  assert.ok(!b.text.startsWith("Control:"), "solo el primer paso lleva el hint");
  assert.match(b.text, /thrust_allocator recibe \/forces \(de asmc\)/);
  assert.match(b.text, /publica \/matriz \(para bridge\)/);
});

test("recorridoSeccion: menciona servicios y hardware conectado directo", () => {
  const s = seccion(N, E, "navegacion");
  const [step] = recorridoSeccion(s, N, E, NAVEGACION);
  assert.ok(step.text.startsWith("Navegación: sabe dónde está el sub."), step.text);
  assert.match(step.text, /ZED 2/);
  assert.match(step.text, /\/take_picture/);
  assert.match(step.text, /instruction_handler/);
});

test("recorridoSeccion: el texto de projects.json sobrescribe el automático (filtrado a nodos de la sección)", () => {
  const s = seccion(N, E, "control");
  const override = [
    { node: "ctl/thrust_allocator", text: "Primero el reparto." },
    { node: "no/existe", text: "Se descarta." },
    { node: "ctl/asmc", text: "Luego el ASMC." },
  ];
  assert.deepEqual(recorridoSeccion(s, N, E, CONTROL, override), [
    { node: "ctl/thrust_allocator", text: "Primero el reparto." },
    { node: "ctl/asmc", text: "Luego el ASMC." },
  ]);
  // Si nada del override existe, se usa el automático.
  assert.equal(recorridoSeccion(s, N, E, CONTROL, [{ node: "no/existe", text: "x" }])[0].node, "ctl/asmc");
});
