// Posiciones de la vista plan: sin solape de etiquetas y nodos solo-plan en su propia banda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acomodarPlan } from "../src/lib/plan.ts";

test("acomodarPlan separa filas y aparta los solo-plan", () => {
  const pos = new Map([
    ["hw:arduino", [10, 0]],
    ["to_arduino_from_locacion", [12, 0]],
    ["a", [0, 3]],
    ["vectornav", [10, 0.5]],
    ["ext/vectornav_largo", [10, 0]],
    ["ext/otro", [11, 0]],
  ]);
  const solo = new Set(["vectornav", "ext/vectornav_largo", "ext/otro"]);
  const out = acomodarPlan(pos, solo, (id) => id);
  const mx = (a, b) => Math.max(10, ((a.length + b.length) / 2) * 0.32 + 2);
  assert.ok(out.get("to_arduino_from_locacion")[0] - out.get("hw:arduino")[0] >= mx("hw:arduino", "to_arduino_from_locacion"));
  const maxReal = Math.max(...["hw:arduino", "to_arduino_from_locacion", "a"].map((i) => out.get(i)[1]));
  const planes = [...solo].map((i) => out.get(i));
  for (const p of planes) assert.ok(p[1] > maxReal + 3);
  const xs = [...solo].map((i) => [i, out.get(i)[0]]).sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i][1] - xs[i - 1][1] >= 10);
});

test("acomodarPlan reparte los nodos plan a lo ancho de los reales", () => {
  const pos = new Map([["a", [0, 0]], ["b", [100, 0]], ["vectornav", [0, 1]], ["ekf_node", [1, 1]]]);
  const out = acomodarPlan(pos, new Set(["vectornav", "ekf_node"]), (id) => id);
  const v = out.get("vectornav")[0];
  const e = out.get("ekf_node")[0];
  assert.ok(e - v >= Math.max(10, ((("vectornav (plan)").length + ("ekf_node (plan)").length) / 2) * 0.5 + 2));
  assert.equal(v, 0);
  assert.equal(e, 100);
});
