// Fase 0 · 6: el progreso de las rutas se guarda por página (s.page), no por índice, para que reordenar pasos en la
// wiki no mueva las marcas. Las claves viejas por índice se migran en silencio al leer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const R = await import("../src/lib/rutas.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof R[name], "function", `falta src/lib/rutas.ts → ${name}`);
  return R[name](...args);
};
const [clavePaso, clavePasoIndice, leidos, marcar, reiniciar, almacenSeguro] = ["clavePaso", "clavePasoIndice", "leidos", "marcar", "reiniciar", "almacenSeguro"].map(fn);

const memoria = (ini = {}) => {
  const m = new Map(Object.entries(ini));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const paso = (page) => ({ route: `/uuv/${page.replace(/\.md$/, "")}/`, page, title: page, nota: "" });
const RUTA = { id: "control", nombre: "Control", pasos: [paso("quickstart.md"), paso("operations/hardware.md"), paso("glosario.md")] };

test("claves: por proyecto, rol y página; la vieja por índice sigue disponible para migrar", () => {
  assert.equal(clavePaso("uuv", "control", "operations/hardware.md"), "rutas:uuv:control:pagina:operations/hardware.md");
  assert.equal(clavePasoIndice("uuv", "control", 3), "rutas:uuv:control:3");
  assert.notEqual(clavePaso("uuv", "control", "a.md"), clavePaso("proyecto-x", "control", "a.md"));
  assert.notEqual(clavePaso("uuv", "control", "a.md"), clavePaso("uuv", "vision", "a.md"));
});

test("marcar usa la página: reordenar los pasos conserva lo leído", () => {
  const ls = memoria();
  const a = almacenSeguro(() => ls);
  marcar(a, "uuv", "control", "operations/hardware.md", true);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, true, false]);
  const reordenada = { ...RUTA, pasos: [RUTA.pasos[1], RUTA.pasos[2], RUTA.pasos[0]] };
  assert.deepEqual(leidos(a, "uuv", reordenada), [true, false, false]);
  marcar(a, "uuv", "control", "operations/hardware.md", false);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, false, false]);
});

test("migración: una clave vieja por índice cuenta como leída, se reescribe con la clave nueva y se borra", () => {
  const ls = memoria({ "rutas:uuv:control:1": "1" });
  const a = almacenSeguro(() => ls);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, true, false]);
  assert.equal(ls.getItem(clavePaso("uuv", "control", "operations/hardware.md")), "1", "reescrita con la clave nueva");
  assert.equal(ls.getItem("rutas:uuv:control:1"), null, "la clave vieja ya no queda");
  marcar(a, "uuv", "control", "operations/hardware.md", false);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, false, false], "desmarcar después de migrar no resucita la vieja");
});

test("migración: si la escritura de la clave nueva falla, la vieja se conserva y el paso sigue leído", () => {
  const m = new Map([["rutas:uuv:control:1", "1"]]);
  const lleno = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: (k) => m.delete(k),
  };
  const a = almacenSeguro(() => lleno);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, true, false]);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, true, false], "segunda lectura igual");
  assert.equal(m.get("rutas:uuv:control:1"), "1", "la clave vieja sigue presente");
});

test("migración: solo con valor '1'; no toca otro rol ni proyecto", () => {
  const ls = memoria({ "rutas:uuv:control:0": "basura", "rutas:uuv:vision:2": "1", "rutas:proyecto-x:control:2": "1" });
  const a = almacenSeguro(() => ls);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, false, false]);
  assert.equal(ls.getItem("rutas:uuv:vision:2"), "1");
  assert.equal(ls.getItem("rutas:proyecto-x:control:2"), "1");
});

test("reiniciar borra las claves nuevas y también las viejas por índice de esa ruta", () => {
  const ls = memoria({ "rutas:uuv:control:2": "1", "rutas:uuv:vision:0": "1" });
  const a = almacenSeguro(() => ls);
  marcar(a, "uuv", "control", "quickstart.md", true);
  reiniciar(a, "uuv", RUTA);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, false, false]);
  assert.equal(ls.getItem("rutas:uuv:control:2"), null);
  assert.equal(ls.getItem("rutas:uuv:vision:0"), "1", "no toca otro rol");
});

test("almacén roto: leer con migración no lanza", () => {
  const roto = almacenSeguro(() => {
    throw new Error("SecurityError");
  });
  assert.deepEqual(leidos(roto, "uuv", RUTA), [false, false, false]);
  assert.doesNotThrow(() => marcar(roto, "uuv", "control", "quickstart.md", true));
});

test("scripts/rutas.ts: marcar recibe la página del paso, no el índice", () => {
  const src = readFileSync(new URL("../src/scripts/rutas.ts", import.meta.url), "utf8");
  const llamadas = [...src.matchAll(/\bmarcar\(([^\n]*)\)/g)].map((m) => m[1]);
  assert.ok(llamadas.length >= 2, "las dos llamadas (checklist y pie del paso)");
  for (const c of llamadas) assert.match(c, /\.page\b/, c);
});
