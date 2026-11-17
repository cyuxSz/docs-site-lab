// Mini tutoriales en el navegador (src/lib/tutoriales.ts): progreso por tutorial en localStorage a través del almacén
// seguro de src/lib/rutas.ts (nunca truena), reanudar en el primer paso sin hacer, reiniciar, y filtro por rol y
// disciplina para la sección "Mini tutoriales" de /<id>/rutas/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { almacenSeguro } from "../src/lib/rutas.ts";

const RUTA_LIB = new URL("../src/lib/tutoriales.ts", import.meta.url);
const L = existsSync(RUTA_LIB) ? await import(RUTA_LIB) : {};
const fn = (nombre) => {
  assert.equal(typeof L[nombre], "function", `falta ${nombre} en src/lib/tutoriales.ts`);
  return L[nombre];
};

const memoria = (inicial = {}) => {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    m,
  };
};
const paso = (id) => ({ id, titulo: id, objetivo: "o", enlace: { tipo: "wiki", href: "/uuv/quickstart/", texto: "Q" }, hecho: "h" });
const tut = (id, disciplina, rol, ids = ["a", "b", "c"]) => ({
  id,
  titulo: id,
  descripcion: "",
  rol,
  disciplina,
  page: `rutas/${id}.md`,
  route: `/uuv/rutas/${id}/`,
  pasos: ids.map(paso),
});
const MOTOR = tut("motor", "electronica", "electronica");
const BUILD = tut("build", "software", "software", ["clonar", "compilar"]);
const CHASIS = tut("chasis", "mecanica", null, ["medir"]);
const TODOS = [CHASIS, MOTOR, BUILD];

test("claveTutorialPaso: separada por proyecto, tutorial y paso, sin chocar con las claves de rutas por rol", () => {
  const clave = fn("claveTutorialPaso");
  assert.equal(clave("uuv", "motor", "b"), "tutoriales:uuv:motor:paso:b");
  assert.notEqual(clave("uuv", "motor", "b"), clave("usv", "motor", "b"));
  assert.doesNotMatch(clave("uuv", "motor", "b"), /^rutas:/);
});

test("marcarPaso / hechos: guarda por id de paso; si el tutorial reordena pasos, lo hecho sigue al paso", () => {
  const [marcarPaso, hechos] = ["marcarPaso", "hechos"].map(fn);
  const s = memoria();
  const a = almacenSeguro(() => s);
  marcarPaso(a, "uuv", "motor", "b", true);
  assert.deepEqual(hechos(a, "uuv", MOTOR), [false, true, false]);
  const reordenado = { ...MOTOR, pasos: [paso("b"), paso("a"), paso("c")] };
  assert.deepEqual(hechos(a, "uuv", reordenado), [true, false, false]);
  marcarPaso(a, "uuv", "motor", "b", false);
  assert.deepEqual(hechos(a, "uuv", MOTOR), [false, false, false]);
  assert.equal(s.m.size, 0, "desmarcar borra la clave");
});

test("estadoTutorial: 'N de M', siguiente paso y estado sin-empezar / en-curso / completo", () => {
  const [marcarPaso, estadoTutorial] = ["marcarPaso", "estadoTutorial"].map(fn);
  const m = memoria();
  const a = almacenSeguro(() => m);
  let e = estadoTutorial(a, "uuv", MOTOR);
  assert.equal(e.estado, "sin-empezar");
  assert.equal(e.texto, "0 de 3");
  assert.equal(e.siguiente, 0);
  marcarPaso(a, "uuv", "motor", "a", true);
  e = estadoTutorial(a, "uuv", MOTOR);
  assert.equal(e.estado, "en-curso");
  assert.equal(e.siguiente, 1);
  for (const id of ["b", "c"]) marcarPaso(a, "uuv", "motor", id, true);
  e = estadoTutorial(a, "uuv", MOTOR);
  assert.equal(e.estado, "completo");
  assert.equal(e.texto, "3 de 3");
  assert.equal(e.siguiente, null);
});

test("enlaceReanudar y textoAccion: reanudar va al ancla del primer paso sin hacer; completo no tiene ancla", () => {
  const [marcarPaso, estadoTutorial, enlaceReanudar, textoAccion] = ["marcarPaso", "estadoTutorial", "enlaceReanudar", "textoAccion"].map(fn);
  const m = memoria();
  const a = almacenSeguro(() => m);
  assert.equal(enlaceReanudar(MOTOR, estadoTutorial(a, "uuv", MOTOR)), "/uuv/rutas/motor/#paso-a");
  assert.equal(textoAccion(estadoTutorial(a, "uuv", MOTOR)), "Empezar");
  marcarPaso(a, "uuv", "motor", "a", true);
  assert.equal(enlaceReanudar(MOTOR, estadoTutorial(a, "uuv", MOTOR)), "/uuv/rutas/motor/#paso-b");
  assert.equal(textoAccion(estadoTutorial(a, "uuv", MOTOR)), "Reanudar");
  for (const id of ["b", "c"]) marcarPaso(a, "uuv", "motor", id, true);
  assert.equal(enlaceReanudar(MOTOR, estadoTutorial(a, "uuv", MOTOR)), "/uuv/rutas/motor/");
  assert.equal(textoAccion(estadoTutorial(a, "uuv", MOTOR)), "Tutorial completo");
});

test("reiniciarTutorial: borra todo lo de ese tutorial (incluidos pasos que ya no existen) y nada más", () => {
  const [marcarPaso, reiniciarTutorial, hechos] = ["marcarPaso", "reiniciarTutorial", "hechos"].map(fn);
  const s = memoria({ "tutoriales:uuv:motor:paso:viejo": "1", "rutas:uuv:rol": "control" });
  const a = almacenSeguro(() => s);
  marcarPaso(a, "uuv", "motor", "a", true);
  marcarPaso(a, "uuv", "build", "clonar", true);
  marcarPaso(a, "usv", "motor", "a", true);
  reiniciarTutorial(a, "uuv", MOTOR);
  assert.deepEqual(hechos(a, "uuv", MOTOR), [false, false, false]);
  assert.equal(s.getItem("tutoriales:uuv:motor:paso:viejo"), null, "borra pasos huérfanos");
  assert.equal(s.getItem("tutoriales:uuv:build:paso:clonar"), "1", "otro tutorial intacto");
  assert.equal(s.getItem("tutoriales:usv:motor:paso:a"), "1", "otro proyecto intacto");
  assert.equal(s.getItem("rutas:uuv:rol"), "control", "las rutas por rol intactas");
});

test("almacén roto (modo privado, cuota): leer da todo sin hacer y escribir o reiniciar no truena", () => {
  const [marcarPaso, hechos, reiniciarTutorial, estadoTutorial] = ["marcarPaso", "hechos", "reiniciarTutorial", "estadoTutorial"].map(fn);
  const roto = () => {
    throw new Error("SecurityError");
  };
  const a = almacenSeguro(roto);
  assert.doesNotThrow(() => marcarPaso(a, "uuv", "motor", "a", true));
  assert.deepEqual(hechos(a, "uuv", MOTOR), [false, false, false]);
  assert.doesNotThrow(() => reiniciarTutorial(a, "uuv", MOTOR));
  assert.equal(estadoTutorial(a, "uuv", MOTOR).estado, "sin-empezar");
});

test("filtrarTutoriales: por rol (los sin rol siempre salen) y por disciplina; 'todos' no filtra", () => {
  const filtrar = fn("filtrarTutoriales");
  assert.deepEqual(filtrar(TODOS, { rol: "electronica" }).map((t) => t.id).sort(), ["chasis", "motor"]);
  assert.deepEqual(filtrar(TODOS, { disciplina: "software" }).map((t) => t.id), ["build"]);
  assert.deepEqual(filtrar(TODOS, { rol: "software", disciplina: "mecanica" }).map((t) => t.id), ["chasis"]);
  assert.equal(filtrar(TODOS, {}).length, 3);
  assert.equal(filtrar(TODOS, { rol: null, disciplina: "todas" }).length, 3);
});

test("agruparPorDisciplina: orden fijo software → electrónica → mecánica, con etiqueta y sin grupos vacíos", () => {
  const agrupar = fn("agruparPorDisciplina");
  assert.deepEqual(
    agrupar(TODOS).map((g) => [g.id, g.etiqueta, g.tutoriales.map((t) => t.id)]),
    [
      ["software", "Software", ["build"]],
      ["electronica", "Electrónica", ["motor"]],
      ["mecanica", "Mecánica", ["chasis"]],
    ],
  );
  assert.deepEqual(agrupar([MOTOR]).map((g) => g.id), ["electronica"]);
});

test("src/lib/tutoriales.ts reutiliza el almacén y el progreso de src/lib/rutas.ts (no los duplica)", () => {
  assert.ok(existsSync(RUTA_LIB), "falta src/lib/tutoriales.ts");
  const src = readFileSync(RUTA_LIB, "utf8");
  assert.match(src, /from\s+["']\.\/rutas(\.ts)?["']/);
  assert.doesNotMatch(src, /function\s+almacenSeguro|localStorage/, "el almacén se inyecta; no se accede a localStorage aquí");
});

test("ocultosPorRol: cuántos tutoriales esconde solo el filtro de rol (respeta la disciplina)", () => {
  const ocultos = fn("ocultosPorRol");
  assert.equal(ocultos(TODOS, { rol: "software" }), 1);
  assert.equal(ocultos(TODOS, { rol: "electronica" }), 1);
  assert.equal(ocultos(TODOS, { rol: null }), 0);
  assert.equal(ocultos(TODOS, { rol: "software", disciplina: "electronica" }), 1);
  assert.equal(ocultos(TODOS, { rol: "software", disciplina: "mecanica" }), 0);
});

test("reiniciarTutorial: un tutorial no borra el de otro cuyo id empieza igual", () => {
  const [marcarPaso, reiniciarTutorial, hechos] = ["marcarPaso", "reiniciarTutorial", "hechos"].map(fn);
  const a = almacenSeguro(() => memoria());
  const s = memoria();
  const b = almacenSeguro(() => s);
  const largo = tut("motor-2", "electronica", null, ["a"]);
  marcarPaso(b, "uuv", "motor-2", "a", true);
  reiniciarTutorial(b, "uuv", MOTOR);
  assert.deepEqual(hechos(b, "uuv", largo), [true]);
  void a;
});

test("almacenConRespaldo: con el almacén bloqueado, lo marcado en esta visita se recuerda en memoria", () => {
  const [con, marcarPaso, hechos, reiniciarTutorial] = ["almacenConRespaldo", "marcarPaso", "hechos", "reiniciarTutorial"].map(fn);
  const roto = () => {
    throw new Error("SecurityError");
  };
  const a = con(almacenSeguro(roto));
  marcarPaso(a, "uuv", "motor", "b", true);
  assert.deepEqual(hechos(a, "uuv", MOTOR), [false, true, false]);
  reiniciarTutorial(a, "uuv", MOTOR);
  assert.deepEqual(hechos(a, "uuv", MOTOR), [false, false, false]);
  // Con almacén sano no guarda nada aparte: lo que borra otra pestaña no resucita.
  const s = memoria();
  const b = con(almacenSeguro(() => s));
  marcarPaso(b, "uuv", "motor", "a", true);
  s.removeItem("tutoriales:uuv:motor:paso:a");
  assert.deepEqual(hechos(b, "uuv", MOTOR), [false, false, false]);
});
