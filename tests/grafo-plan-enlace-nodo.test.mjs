// Un enlace ?node= hacia un nodo solo-plan debe abrir con el plan activo para que el nodo se vea.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planInicialParaNodo, planDisponible } from "../src/lib/plan.ts";

const base = { planFlow: 3, seccion: null };

test("nodo solo-plan: activa el plan y deja la configuración si es válida", () => {
  const r = planInicialParaNodo({ ...base, nodo: { soloPlan: true }, config: { id: "sub" } });
  assert.deepEqual(r, { showPlan: true, config: null });
});

test("nodo solo-plan con configuración legada: cambia a 'all' y el plan queda disponible", () => {
  const cfg = { id: "viejo", legado: true };
  const r = planInicialParaNodo({ ...base, nodo: { soloPlan: true }, config: cfg });
  assert.deepEqual(r, { showPlan: true, config: "all" });
  assert.ok(planDisponible({ ...base, config: { id: r.config } }));
});

test("sin nodo, nodo normal, sin plan o con sección: no cambia nada", () => {
  const nada = { showPlan: false, config: null };
  assert.deepEqual(planInicialParaNodo({ ...base, nodo: null }), nada);
  assert.deepEqual(planInicialParaNodo({ ...base, nodo: { soloPlan: false } }), nada);
  assert.deepEqual(planInicialParaNodo({ ...base, nodo: { soloPlan: true }, seccion: "s" }), nada);
  assert.deepEqual(planInicialParaNodo({ planFlow: 0, seccion: null, nodo: { soloPlan: true } }), nada);
});
