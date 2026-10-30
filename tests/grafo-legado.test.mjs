// Lote 6b-1 · Configuración "Sistema anterior" (legado: true en ros.json): aviso, enlace a discrepancias y recorrido
// propio definido en projects.json → configs.<id>.tour. Lógica pura en src/lib/legado.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rosGraph } from "../src/lib/graph.ts";
import { claveRecorrido } from "../src/lib/recorrido.ts";
import { AVISO_LEGADO, enlaceInterno, recorridoConfig, configDelRecorrido, configInicial, recorridoActivo } from "../src/lib/legado.ts";
import { planProjectData } from "./fixtures/ros-plan.mjs";

const TOUR_LEGADO = [
  { node: "mis/instruction_handler", text: "Paso 1." },
  { node: "ctl/asmc", text: "Paso 2." },
  { node: "ctl/thrust_allocator", text: "No está en legado." },
  { node: "x/inexistente", text: "No existe." },
  { node: "ctl/viejo", text: "Paso 3." },
];
const data = rosGraph(planProjectData({ configs: { legado: { enlace: "/uuv/discrepancias/", tour: TOUR_LEGADO } } }));

test("AVISO_LEGADO: texto fijo del aviso", () => {
  assert.equal(AVISO_LEGADO, "Este es el sistema anterior; no es lo que corre hoy.");
});

test("enlaceInterno: solo rutas internas del portal", () => {
  assert.equal(enlaceInterno("/uuv/discrepancias/"), "/uuv/discrepancias/");
  for (const malo of ["//evil.com/x", "https://evil.com", "javascript:alert(1)", "uuv/discrepancias", "/\\evil.com", "", undefined, null, 42])
    assert.equal(enlaceInterno(malo), null, String(malo));
});

test("recorridoConfig: conserva el orden y descarta pasos con nodos que no están en la configuración", () => {
  const nodes = data.nodes;
  const r = recorridoConfig("legado", nodes, TOUR_LEGADO);
  assert.deepEqual(r.pasos.map((p) => p.node), ["mis/instruction_handler", "ctl/asmc", "ctl/viejo"]);
  assert.deepEqual(r.descartados, ["ctl/thrust_allocator", "x/inexistente"]);
  assert.deepEqual(recorridoConfig("legado", nodes, undefined), { pasos: [], descartados: [] });
  const malos = [{ node: "ctl/asmc" }, { text: "sin nodo" }, null, { node: "ctl/asmc", text: "   " }];
  assert.deepEqual(recorridoConfig("legado", nodes, malos).pasos, [], "pasos sin nodo o sin texto se ignoran");
});

test("rosGraph: data.configs lleva legado, enlace validado y el recorrido ya resuelto", () => {
  assert.deepEqual(data.configs.map((c) => c.id), ["real", "legado"]);
  const real = data.configs.find((c) => c.id === "real");
  assert.ok(!real.legado);
  assert.ok(!real.tour || real.tour.length === 0);
  const legado = data.configs.find((c) => c.id === "legado");
  assert.equal(legado.legado, true);
  assert.equal(legado.label, "Sistema anterior (gazebo_launch)");
  assert.equal(legado.enlace, "/uuv/discrepancias/");
  assert.deepEqual(legado.tour?.map((p) => p.node), ["mis/instruction_handler", "ctl/asmc", "ctl/viejo"]);
  const malo = rosGraph(planProjectData({ configs: { legado: { enlace: "//evil.com", tour: [] } } }));
  assert.ok(!malo.configs.find((c) => c.id === "legado").enlace, "un enlace externo no se publica");
  const sinDatos = rosGraph(planProjectData());
  assert.equal(sinDatos.configs.find((c) => c.id === "legado").legado, true, "legado sale de ros.json aunque projects.json no diga nada");
});

test("configDelRecorrido / configInicial: la configuración legado nunca es la de arranque", () => {
  const configs = [{ id: "legado", label: "Anterior", legado: true }, { id: "real", label: "Real" }];
  const nodes = [
    { id: "a", configs: ["legado", "real"] },
    { id: "b", configs: ["legado"] },
  ];
  assert.equal(configDelRecorrido(configs, [{ node: "a", text: "" }], nodes), "real");
  assert.equal(configDelRecorrido(configs, [{ node: "b", text: "" }], nodes), null, "solo cabría en legado");
  assert.equal(configInicial(configs, [{ node: "b", text: "" }], nodes), "real", "primera no legado");
  assert.equal(configInicial([{ id: "legado", label: "x", legado: true }], [], nodes), "all");
  assert.equal(configInicial([], [], nodes), "all");
});

test("recorridoActivo: sección > configuración con recorrido propio > global, con claves de retomar separadas", () => {
  const global = [{ node: "g", text: "g" }];
  const cfg = { id: "legado", legado: true, tour: [{ node: "c", text: "c" }] };
  const sec = { id: "control", tour: [{ node: "s", text: "s" }] };
  assert.deepEqual(recorridoActivo({ global, config: cfg, seccion: sec, enSeccion: true }), { tipo: "seccion", pasos: sec.tour, claveSeccion: "control" });
  assert.deepEqual(recorridoActivo({ global, config: cfg, seccion: null, enSeccion: false }), { tipo: "config", pasos: cfg.tour, claveSeccion: "config:legado" });
  assert.deepEqual(recorridoActivo({ global, config: { id: "real" }, seccion: null, enSeccion: false }), { tipo: "global", pasos: global, claveSeccion: null });
  assert.deepEqual(recorridoActivo({ global, config: undefined, seccion: null, enSeccion: false }), { tipo: "global", pasos: global, claveSeccion: null });
  const claves = new Set([claveRecorrido("uuv", "ros", null), claveRecorrido("uuv", "ros", "control"), claveRecorrido("uuv", "ros", "config:legado")]);
  assert.equal(claves.size, 3);
});

test("projects.json (uuv): configs.legado con recorrido del sistema anterior y enlace a discrepancias", () => {
  const projects = JSON.parse(readFileSync(fileURLToPath(new URL("../projects.json", import.meta.url)), "utf8"));
  const uuv = projects.find((p) => p.id === "uuv");
  const legado = uuv.configs?.legado;
  assert.ok(legado, "falta configs.legado en projects.json");
  assert.equal(legado.enlace, "/uuv/discrepancias/");
  assert.deepEqual(legado.tour.map((p) => p.node), [
    "uuv_mission/mission_handler",
    "uuv_navigation/path_generator",
    "uuv_navigation/los",
    "uuv_control/asmc",
  ]);
  for (const p of legado.tour) assert.ok(p.text.trim().length > 20, `${p.node} sin frase`);
  assert.match(legado.tour.at(-1).text, /dynamic_model/, "asmc menciona que dynamic_model_uuv está comentado en ese launch");
});
