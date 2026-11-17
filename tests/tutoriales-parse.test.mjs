// Mini tutoriales: parser de openwiki/rutas/<slug>.md (parseTutorial en tools/rutas.mjs, junto a parseRutas). Cada
// "## Paso: <título>" trae Objetivo, Enlace (wiki, grafo: o hardware:) y "Hecho cuando"; lo inválido avisa y se ignora.
// El formato de rutas.md (## Rol + lista numerada) no cambia: lo cubren tests/rutas-parse.test.mjs y el último test.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../tools/rutas.mjs";
import { META_MOTOR, TUTORIAL_MOTOR, OPCIONES, PAGES_TUT } from "./fixtures/tutoriales-mini.mjs";
import { RUTAS_MD, PAGES } from "./fixtures/rutas-mini.mjs";

const parseTutorial = (...a) => {
  assert.equal(typeof T.parseTutorial, "function", "falta parseTutorial en tools/rutas.mjs");
  return T.parseTutorial(...a);
};
const motor = () => parseTutorial(TUTORIAL_MOTOR, { ...OPCIONES, meta: META_MOTOR });

test("parseTutorial: datos del tutorial desde el frontmatter, id = nombre del archivo y route del portal", () => {
  const { tutorial } = motor();
  assert.ok(tutorial, "el tutorial con pasos válidos sale");
  assert.equal(tutorial.id, "motor-uno");
  assert.equal(tutorial.titulo, "Probar un motor desde la Jetson");
  assert.equal(tutorial.descripcion, "Del launch al motor girando, paso a paso.");
  assert.equal(tutorial.rol, "electronica");
  assert.equal(tutorial.disciplina, "electronica");
  assert.equal(tutorial.page, "rutas/motor-uno.md");
  assert.equal(tutorial.route, "/uuv/rutas/motor-uno/");
});

test("parseTutorial: cada paso válido trae id, título, objetivo, enlace {tipo, href, texto} y 'hecho cuando'", () => {
  const { tutorial } = motor();
  const [uno] = tutorial.pasos;
  assert.deepEqual(uno, {
    id: "ubica-el-banco-de-pruebas",
    titulo: "Ubica el banco de pruebas",
    objetivo: "saber qué Arduino controla cada motor.",
    enlace: { tipo: "wiki", href: "/uuv/operations/hardware/#probar-motores", texto: "Hardware" },
    hecho: "identificas el pin de cada uno de los 6 motores.",
  });
});

test("parseTutorial: enlace grafo: va a /<id>/grafo/ con solo parámetros permitidos (config, node, seccion)", () => {
  const paso = motor().tutorial.pasos.find((p) => p.titulo === "Mira quién publica las fuerzas");
  assert.ok(paso, "falta el paso del grafo");
  assert.equal(paso.enlace.tipo, "grafo");
  const u = new URL(paso.enlace.href, "https://portal.test");
  assert.equal(u.pathname, "/uuv/grafo/");
  assert.equal(u.searchParams.get("node"), "uuv_control/thrust_allocator");
  assert.equal(u.searchParams.get("config"), "sim");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["config", "node"]);
});

test("parseTutorial: enlace hardware: va a /<id>/<disciplina>/?p=<slug> solo si la disciplina está configurada", () => {
  const paso = motor().tutorial.pasos.find((p) => p.titulo === "Revisa la arquitectura eléctrica");
  assert.ok(paso, "falta el paso de hardware");
  assert.deepEqual(paso.enlace, { tipo: "hardware", href: "/uuv/electronica/?p=arquitectura-electrica", texto: "Arquitectura eléctrica" });
});

test("parseTutorial: ignora pasos incompletos o con enlaces no válidos, con un aviso que nombra cada uno", () => {
  const { tutorial, avisos } = motor();
  assert.deepEqual(
    tutorial.pasos.map((p) => p.titulo),
    ["Ubica el banco de pruebas", "Mira quién publica las fuerzas", "Revisa la arquitectura eléctrica", "Ubica el banco de pruebas"],
  );
  for (const t of ["Sin comprobación", "Sin enlace", "Blog externo", "Script", "Página fantasma", "Fuera de la wiki", "Grafo raro", "Plano mecánico", "Slug malo"]) {
    assert.ok(avisos.some((a) => a.includes(t)), `falta aviso para "${t}": ${JSON.stringify(avisos)}`);
  }
});

test("parseTutorial: ningún href sale del portal ni trae esquemas peligrosos", () => {
  for (const p of motor().tutorial.pasos) {
    assert.match(p.enlace.href, /^\/uuv\//, p.enlace.href);
    assert.doesNotMatch(p.enlace.href, /javascript:|^\/\/|\.\.\//i, p.enlace.href);
  }
});

test("parseTutorial: ids de paso estables y únicos aunque se repita el título", () => {
  const ids = motor().tutorial.pasos.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, JSON.stringify(ids));
  assert.equal(ids[0], "ubica-el-banco-de-pruebas");
  assert.equal(ids[3], "ubica-el-banco-de-pruebas-2");
  for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
});

test("parseTutorial: disciplina obligatoria (software, electronica o mecanica); si falta o es otra, no sale y avisa", () => {
  for (const disciplina of [undefined, "quimica"]) {
    const { tutorial, avisos } = parseTutorial(TUTORIAL_MOTOR, { ...OPCIONES, meta: { ...META_MOTOR, disciplina } });
    assert.equal(tutorial, null, `disciplina ${disciplina}`);
    assert.ok(avisos.some((a) => /disciplina/i.test(a)), JSON.stringify(avisos));
  }
  const sw = parseTutorial(TUTORIAL_MOTOR, { ...OPCIONES, meta: { ...META_MOTOR, disciplina: "software" } });
  assert.equal(sw.tutorial?.disciplina, "software");
});

test("parseTutorial: rol opcional; si no existe en rutas.md el tutorial sale sin rol y avisa", () => {
  const sinRol = parseTutorial(TUTORIAL_MOTOR, { ...OPCIONES, meta: { ...META_MOTOR, rol: undefined } });
  assert.equal(sinRol.tutorial?.rol, null);
  const raro = parseTutorial(TUTORIAL_MOTOR, { ...OPCIONES, meta: { ...META_MOTOR, rol: "astronauta" } });
  assert.equal(raro.tutorial?.rol, null);
  assert.ok(raro.avisos.some((a) => a.includes("astronauta")), JSON.stringify(raro.avisos));
});

test("parseTutorial: sin pasos válidos el tutorial no sale y avisa", () => {
  const { tutorial, avisos } = parseTutorial("## Paso: Solo\nObjetivo: nada.\n", { ...OPCIONES, meta: META_MOTOR });
  assert.equal(tutorial, null);
  assert.ok(avisos.length > 0);
});

test("retrocompatible: rutas.md se parsea igual aunque la wiki tenga openwiki/rutas/ y un rol puede enlazar un tutorial", () => {
  const antes = T.parseRutas(RUTAS_MD, { project: "uuv", pages: PAGES });
  const despues = T.parseRutas(RUTAS_MD, { project: "uuv", pages: [...PAGES, "rutas/motor-uno.md"] });
  assert.deepEqual(despues, antes);
  const conTutorial = T.parseRutas("## Electrónica\n1. [Probar un motor](rutas/motor-uno.md): tutorial guiado.\n", { project: "uuv", pages: PAGES_TUT });
  assert.deepEqual(conTutorial.rutas[0].pasos[0], { route: "/uuv/rutas/motor-uno/", page: "rutas/motor-uno.md", title: "Probar un motor", nota: "tutorial guiado." });
});

const cuerpo = (...titulos) => titulos.map((t) => `## Paso: ${t}\nObjetivo: o.\nEnlace: [Q](../quickstart.md)\nHecho cuando: h.\n`).join("\n");

test("parseTutorial: el id de paso nunca se repite aunque un título se parezca al sufijo de otro", () => {
  const { tutorial } = parseTutorial(cuerpo("Conectar", "Conectar", "Conectar 2"), { ...OPCIONES, meta: META_MOTOR });
  const ids = tutorial.pasos.map((p) => p.id);
  assert.equal(new Set(ids).size, 3, JSON.stringify(ids));
});

test("parseTutorial: el ancla de un enlace wiki conserva los caracteres Unicode", () => {
  const b = "## Paso: Cámara\nObjetivo: o.\nEnlace: [H](../operations/hardware.md#cámara-zed-2i)\nHecho cuando: h.\n";
  const { tutorial } = parseTutorial(b, { ...OPCIONES, meta: META_MOTOR });
  assert.equal(tutorial.pasos[0].enlace.href, "/uuv/operations/hardware/#cámara-zed-2i");
  const raro = parseTutorial(b.replace("#cámara-zed-2i", "#a\"><b"), { ...OPCIONES, meta: META_MOTOR });
  assert.match(raro.tutorial.pasos[0].enlace.href, /^[^"<>\s]+$/);
});

test("parseTutorial: rutas/index.md (choca con rutas.md) y ids con ':' no salen y avisan", () => {
  for (const from of ["rutas/index.md", "rutas/a:b.md"]) {
    const { tutorial, avisos } = parseTutorial(TUTORIAL_MOTOR, { ...OPCIONES, from, meta: META_MOTOR });
    assert.equal(tutorial, null, from);
    assert.ok(avisos.length > 0, from);
  }
});
