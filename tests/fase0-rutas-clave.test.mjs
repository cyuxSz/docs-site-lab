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
  marcar(a, "uuv", "control", paso("operations/hardware.md"), true);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, true, false]);
  const reordenada = { ...RUTA, pasos: [RUTA.pasos[1], RUTA.pasos[2], RUTA.pasos[0]] };
  assert.deepEqual(leidos(a, "uuv", reordenada), [true, false, false]);
  marcar(a, "uuv", "control", paso("operations/hardware.md"), false);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, false, false]);
});

test("migración: una clave vieja por índice cuenta como leída, se reescribe con la clave nueva y se borra", () => {
  const ls = memoria({ "rutas:uuv:control:1": "1" });
  const a = almacenSeguro(() => ls);
  assert.deepEqual(leidos(a, "uuv", RUTA), [false, true, false]);
  assert.equal(ls.getItem(clavePaso("uuv", "control", "operations/hardware.md")), "1", "reescrita con la clave nueva");
  assert.equal(ls.getItem("rutas:uuv:control:1"), null, "la clave vieja ya no queda");
  marcar(a, "uuv", "control", paso("operations/hardware.md"), false);
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
  marcar(a, "uuv", "control", paso("quickstart.md"), true);
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
  assert.doesNotThrow(() => marcar(roto, "uuv", "control", paso("quickstart.md"), true));
});

test("scripts/rutas.ts: las dos llamadas a marcar pasan el PasoRuta con su índice", () => {
  const src = readFileSync(new URL("../src/scripts/rutas.ts", import.meta.url), "utf8");
  const llamadas = [...src.matchAll(/\bmarcar\(([^\n]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(llamadas, [
    "alm, proyecto, ruta.id, ruta.pasos[Number(c.dataset.i)], c.checked, Number(c.dataset.i)",
    "alm, proyecto, ruta.id, ruta.pasos[i], box.checked, i)", // la regex voraz incluye el cierre de addEventListener
  ]);
});

test("pasos de la misma página con distinto anchor tienen claves distintas", () => {
  const ls = memoria();
  const a = almacenSeguro(() => ls);
  const R2 = { id: "control", nombre: "C", pasos: [{ ...paso("operations/hardware.md"), route: "/uuv/operations/hardware/#banco" }, { ...paso("operations/hardware.md"), route: "/uuv/operations/hardware/#motores" }] };
  marcar(a, "uuv", "control", R2.pasos[0], true, 0);
  assert.deepEqual(leidos(a, "uuv", R2), [true, false]);
});

test("con la clave nueva en '1' se borra la vieja; marcar(false) con índice borra la vieja", () => {
  const ls = memoria({ "rutas:uuv:control:1": "1" });
  const a = almacenSeguro(() => ls);
  marcar(a, "uuv", "control", RUTA.pasos[1], true, 1);
  leidos(a, "uuv", RUTA);
  assert.equal(ls.getItem("rutas:uuv:control:1"), null);
  ls.setItem("rutas:uuv:control:2", "1");
  marcar(a, "uuv", "control", RUTA.pasos[2], false, 2);
  assert.equal(ls.getItem("rutas:uuv:control:2"), null);
});

test("reiniciar borra todas las claves viejas numéricas del rol, aun fuera de la longitud actual", () => {
  const m = new Map(Object.entries({ "rutas:uuv:control:7": "1", "rutas:uuv:control:12": "1", "rutas:uuv:vision:7": "1", "rutas:uuv:control:rol": "x" }));
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
  reiniciar(almacenSeguro(() => st), "uuv", RUTA);
  assert.equal(m.has("rutas:uuv:control:7"), false);
  assert.equal(m.has("rutas:uuv:control:12"), false);
  assert.equal(m.has("rutas:uuv:vision:7"), true);
  assert.equal(m.get("rutas:uuv:control:rol"), "x", "la clave del rol sobrevive");
});

test("reiniciar borra también la clave intermedia sin anchor", () => {
  const p0 = { ...paso("operations/hardware.md"), route: "/uuv/operations/hardware/#banco" };
  const m = new Map([[clavePaso("uuv", "control", "operations/hardware.md"), "1"], [clavePaso("uuv", "control", "operations/hardware.md#banco"), "1"]]);
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  reiniciar(almacenSeguro(() => st), "uuv", { id: "control", nombre: "C", pasos: [p0] });
  assert.equal(m.size, 0);
});

test("marcar con string ya no es válido: solo acepta el paso", () => {
  const ls = memoria();
  assert.throws(() => R.marcar(almacenSeguro(() => ls), "uuv", "control", "quickstart.md", true));
});

test("pasoEnPagina / pasoActivo con dos pasos de la misma página prefieren el anchor del hash", () => {
  const R2 = { id: "control", nombre: "C", pasos: [{ ...paso("h.md"), route: "/uuv/h/#banco" }, { ...paso("h.md"), route: "/uuv/h/#motores" }] };
  assert.equal(R.pasoEnPagina(R2, "h.md", [false, false], "#motores"), 1);
  assert.equal(R.pasoEnPagina(R2, "h.md", [false, false], "#banco"), 0);
  assert.equal(R.pasoEnPagina(R2, "h.md", [false, false], ""), 0, "sin hash: primero no leído");
  assert.equal(R.pasoEnPagina(R2, "h.md", [true, false], ""), 1);
  assert.equal(R.pasoEnPagina(R2, "h.md", [true, false], "#otro"), 1, "hash desconocido: primero no leído");
  const ms = memoria();
  const a = almacenSeguro(() => ms);
  R.activarRuta(a, "uuv", "control");
  assert.deepEqual(R.pasoActivo(a, "uuv", [R2], "h.md", "#motores"), { ruta: R2, i: 1 });
});

test("pasoEnPagina: anchor no ASCII percent-encoded en location.hash coincide", () => {
  const R2 = { id: "c", nombre: "C", pasos: [{ ...paso("h.md"), route: "/uuv/h/#otro" }, { ...paso("h.md"), route: "/uuv/h/#instalación" }] };
  assert.equal(R.pasoEnPagina(R2, "h.md", [false, false], "#instalaci%C3%B3n"), 1);
  assert.equal(R.pasoEnPagina(R2, "h.md", [false, false], "#instalación"), 1);
  assert.equal(R.pasoEnPagina(R2, "h.md", [false, false], "#%E0%A4%A"), 0, "hash mal formado no lanza");
});

test("pasoActivo se recalcula al cambiar el hash", () => {
  const R2 = { id: "control", nombre: "C", pasos: [{ ...paso("h.md"), route: "/uuv/h/#banco" }, { ...paso("h.md"), route: "/uuv/h/#motores" }] };
  const ms = memoria();
  const a = almacenSeguro(() => ms);
  R.activarRuta(a, "uuv", "control");
  assert.equal(R.pasoActivo(a, "uuv", [R2], "h.md", "#banco").i, 0);
  assert.equal(R.pasoActivo(a, "uuv", [R2], "h.md", "#motores").i, 1);
  assert.equal(R.pasoActivo(a, "uuv", [R2], "otra.md", ""), null);
  const src = readFileSync(new URL("../src/scripts/rutas.ts", import.meta.url), "utf8");
  assert.match(src, /addEventListener\("hashchange"/);
});

test("reiniciar borra claves pagina:* de pasos eliminados, solo de ese proyecto y rol", () => {
  const m = new Map(Object.entries({
    "rutas:uuv:control:pagina:viejo.md": "1",
    "rutas:uuv:control:pagina:a.b+c.md#x": "1",
    "rutas:uuv:vision:pagina:viejo.md": "1",
    "rutas:otro:control:pagina:viejo.md": "1",
    "rutas:uuv:control:rol": "x",
    "rutas:uuv:rol": "control",
  }));
  const st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null };
  reiniciar(almacenSeguro(() => st), "uuv", RUTA);
  assert.deepEqual([...m.keys()].sort(), ["rutas:otro:control:pagina:viejo.md", "rutas:uuv:control:rol", "rutas:uuv:rol", "rutas:uuv:vision:pagina:viejo.md"]);
});
