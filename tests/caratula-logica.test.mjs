// Carátula del proyecto (lote 1): lógica pura. src/lib/caratula.ts corre en el navegador (sin node:fs);
// tarjetasCaratula, entradaProyecto y slugReservado viven en src/lib/data.ts (build); pageRoute en tools/rutas.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

const caratula = () => import("../src/lib/caratula.ts");
const data = () => import("../src/lib/data.ts");

const base = (extra = {}) => ({
  id: "uuv",
  name: "UUV",
  summary: "",
  repo: "x/y",
  branch: "main",
  lastUpdate: null,
  pageList: [],
  diagramList: [],
  links: [],
  ros: null,
  ...extra,
});
const DISC = {
  mecanica: { plantilla: "mecanica", editores: ["cyuxSz"] },
  electronica: { plantilla: "electronica", editores: ["cyuxSz", "otra-persona"] },
};

// ---------- tarjetas y entrada ----------

test("tarjetasCaratula: Software, Electrónica, Mecánica en ese orden, con href y descripción", async () => {
  const { tarjetasCaratula } = await data();
  const t = tarjetasCaratula(base({ disciplinas: DISC }));
  assert.deepEqual(
    t.map(({ id, titulo, href }) => ({ id, titulo, href })),
    [
      { id: "software", titulo: "Software", href: "/uuv/software/" },
      { id: "electronica", titulo: "Electrónica", href: "/uuv/electronica/" },
      { id: "mecanica", titulo: "Mecánica", href: "/uuv/mecanica/" },
    ],
  );
  for (const x of t) assert.ok(typeof x.descripcion === "string" && x.descripcion.length > 0, `${x.id}: descripción`);
});

test("tarjetasCaratula: solo las disciplinas declaradas; sin disciplinas solo Software", async () => {
  const { tarjetasCaratula } = await data();
  assert.deepEqual(tarjetasCaratula(base({ disciplinas: { mecanica: DISC.mecanica } })).map((x) => x.id), ["software", "mecanica"]);
  assert.deepEqual(tarjetasCaratula(base()).map((x) => x.id), ["software"]);
});

test("tarjetasCaratula: nunca expone editores ni plantillas (van al HTML)", async () => {
  const { tarjetasCaratula } = await data();
  assert.doesNotMatch(JSON.stringify(tarjetasCaratula(base({ disciplinas: DISC }))), /editores|cyuxSz|otra-persona|plantilla/);
});

test("entradaProyecto: con disciplinas la carátula; sin ellas directo a Software", async () => {
  const { entradaProyecto } = await data();
  assert.equal(entradaProyecto(base({ disciplinas: DISC })), "/uuv/");
  assert.equal(entradaProyecto(base({ id: "otro-proyecto" })), "/otro-proyecto/software/");
  assert.equal(entradaProyecto(base({ id: "otro-proyecto", disciplinas: {} })), "/otro-proyecto/software/");
});

// ---------- precedencia de rutas ----------

test("slugReservado: software y las páginas fijas no se generan desde la wiki; subrutas sí", async () => {
  const { slugReservado } = await data();
  for (const s of ["software", "grafo", "limpieza", "novedades", "comentarios"]) assert.equal(slugReservado(s), true, s);
  for (const s of ["software/x", "packages", "rutas", "quickstart", "discrepancias"]) assert.equal(slugReservado(s), false, s);
  assert.equal(slugReservado("electronica", ["electronica", "mecanica"]), true, "una disciplina del proyecto gana a la wiki");
  assert.equal(slugReservado("electronica"), false, "sin esa disciplina, el slug es de la wiki");
});

test("pageRoute: el index.md raíz de la wiki es el resumen de Software; las demás rutas no cambian", async () => {
  const { pageRoute } = await import("../tools/rutas.mjs");
  assert.equal(pageRoute("uuv", "index.md"), "/uuv/software/");
  assert.equal(pageRoute("uuv", "packages/index.md"), "/uuv/packages/");
  assert.equal(pageRoute("uuv", "quickstart.md"), "/uuv/quickstart/");
});

// ---------- anclas de la portada vieja ----------

test("redirigirAncla: anclas de la portada vieja → /<id>/software/#<ancla>", async () => {
  const { redirigirAncla, ANCLAS_SOFTWARE } = await caratula();
  assert.deepEqual([...ANCLAS_SOFTWARE].sort(), ["configuraciones", "diagramas", "empieza", "favoritos", "novedades", "paquetes"]);
  for (const a of ANCLAS_SOFTWARE) assert.equal(redirigirAncla("uuv", `#${a}`), `/uuv/software/#${a}`, a);
});

test("redirigirAncla: enlaces del portal anterior #/p/<ruta>.md siguen funcionando", async () => {
  const { redirigirAncla } = await caratula();
  assert.equal(redirigirAncla("uuv", "#/p/packages/uuv_control.md"), "/uuv/packages/uuv_control/");
  assert.equal(redirigirAncla("uuv", "#/p/packages/index.md"), "/uuv/packages/");
  assert.equal(redirigirAncla("uuv", "#/p/index.md"), "/uuv/software/");
  assert.equal(redirigirAncla("uuv", "#/p/a%20b.md"), null, "espacios: no es una ruta interna válida");
});

test("redirigirAncla: sin hash, ancla desconocida o intento de salir del sitio → null", async () => {
  const { redirigirAncla } = await caratula();
  for (const h of ["", "#", "#otra", "#Diagramas", "#/p/../../x.md", "#/p//evil.com/x.md", "#/p/https://evil.com.md", "#diagramas\u0000"]) {
    assert.equal(redirigirAncla("uuv", h), null, JSON.stringify(h));
  }
});

// ---------- pestaña activa ----------

test("pestanaActiva: #diagramas marca Diagramas; cualquier otro hash, Resumen", async () => {
  const { pestanaActiva } = await caratula();
  assert.equal(pestanaActiva("#diagramas"), "diagramas");
  for (const h of ["", "#", "#paquetes", "#diagramas-x"]) assert.equal(pestanaActiva(h), "resumen", h);
});

// ---------- cifras de las tarjetas de hardware ----------

test("datosTarjeta: índice válido de /api/hardware/ → páginas y última edición", async () => {
  const { datosTarjeta } = await caratula();
  const paginas = [{ slug: "a", titulo: "A" }, { slug: "b", titulo: "B" }];
  assert.deepEqual(datosTarjeta({ paginas, actualizado: "2026-11-02T12:00:00.000Z" }), { paginas: 2, actualizado: "2026-11-02T12:00:00.000Z" });
  assert.deepEqual(datosTarjeta({ paginas: [], actualizado: null }), { paginas: 0, actualizado: null });
  assert.deepEqual(datosTarjeta({ paginas }), { paginas: 2, actualizado: null }, "API sin fecha: solo el conteo");
  assert.deepEqual(datosTarjeta({ paginas, actualizado: "no-es-fecha" }), { paginas: 2, actualizado: null });
});

test("datosTarjeta: error, sin sesión o forma inesperada → null (la tarjeta queda solo con título)", async () => {
  const { datosTarjeta } = await caratula();
  for (const j of [null, undefined, "x", {}, { error: "Sin sesión" }, { paginas: "3" }, { paginas: null }]) assert.equal(datosTarjeta(j), null, JSON.stringify(j));
});

test("textoCifras: singular/plural, vacío y fecha es-MX de Monterrey", async () => {
  const { textoCifras } = await caratula();
  const iso = "2026-11-02T12:00:00.000Z";
  const fecha = new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: "America/Monterrey" });
  assert.equal(textoCifras({ paginas: 1, actualizado: null }), "1 página");
  assert.equal(textoCifras({ paginas: 3, actualizado: null }), "3 páginas");
  assert.equal(textoCifras({ paginas: 3, actualizado: iso }), `3 páginas · editado ${fecha}`);
  assert.equal(textoCifras({ paginas: 0, actualizado: null }), "Sin páginas todavía");
});
