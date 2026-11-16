// QoL de navegación personal (src/lib/personal.ts): "Continuar donde te quedaste", favoritos y "cambió desde tu
// última visita". Todo por proyecto en localStorage, a través del almacén seguro de src/lib/rutas.ts (nunca lanza).
import { test } from "node:test";
import assert from "node:assert/strict";
import { almacenSeguro } from "../src/lib/rutas.ts";
import {
  claveUltima,
  claveFavoritos,
  claveVisto,
  guardarVisita,
  ultimaVisita,
  fraccionScroll,
  posicionScroll,
  urlContinuar,
  debeRestaurar,
  favoritos,
  esFavorito,
  alternarFavorito,
  quitarFavorito,
  MAX_FAVORITOS,
  firmaPagina,
  revisarCambio,
} from "../src/lib/personal.ts";

const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const nuevo = () => {
  const ls = memoria();
  return { ls, a: almacenSeguro(() => ls) };
};
const rotos = () => [
  almacenSeguro(() => {
    throw new Error("SecurityError");
  }),
  almacenSeguro(() => ({
    getItem() {
      throw new Error("x");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("x");
    },
  })),
  almacenSeguro(() => null),
];

test("claves: separadas por proyecto (y por página para lo visto)", () => {
  assert.equal(claveUltima("uuv"), "personal:uuv:ultima");
  assert.equal(claveFavoritos("uuv"), "personal:uuv:favoritos");
  assert.equal(claveVisto("uuv", "/uuv/quickstart/"), "personal:uuv:visto:/uuv/quickstart/");
  assert.notEqual(claveUltima("uuv"), claveUltima("otro-proyecto"));
});

// --- Continuar donde te quedaste ---
test("guardarVisita / ultimaVisita: recuerda la última página por proyecto, sin mezclar proyectos", () => {
  const { a } = nuevo();
  assert.equal(ultimaVisita(a, "uuv"), null, "sin visitas no hay tarjeta");
  guardarVisita(a, "uuv", { route: "/uuv/quickstart/", title: "Quickstart", scroll: 0.2 });
  guardarVisita(a, "uuv", { route: "/uuv/packages/uuv_control/", title: "uuv_control", scroll: 0.55 });
  guardarVisita(a, "otro-proyecto", { route: "/otro-proyecto/quickstart/", title: "Inicio X", scroll: 0 });
  assert.deepEqual(ultimaVisita(a, "uuv"), { route: "/uuv/packages/uuv_control/", title: "uuv_control", scroll: 0.55 });
  assert.deepEqual(ultimaVisita(a, "otro-proyecto"), { route: "/otro-proyecto/quickstart/", title: "Inicio X", scroll: 0 });
});

test("guardarVisita ignora rutas de otro proyecto o externas; ultimaVisita descarta datos corruptos o manipulados", () => {
  const { ls, a } = nuevo();
  guardarVisita(a, "uuv", { route: "/otro-proyecto/quickstart/", title: "X", scroll: 0 });
  guardarVisita(a, "uuv", { route: "https://evil.example/uuv/", title: "X", scroll: 0 });
  assert.equal(ultimaVisita(a, "uuv"), null);
  const malos = [
    "{no-json",
    "null",
    "[]",
    '"texto"',
    JSON.stringify({ route: "//evil.example/uuv/", title: "x", scroll: 0 }),
    JSON.stringify({ route: "javascript:alert(1)", title: "x", scroll: 0 }),
    JSON.stringify({ route: "/otro-proyecto/a/", title: "x", scroll: 0 }),
    JSON.stringify({ route: "/uuv/a/", title: 5, scroll: 0 }),
  ];
  for (const malo of malos) {
    ls.setItem(claveUltima("uuv"), malo);
    assert.equal(ultimaVisita(a, "uuv"), null, malo);
  }
  ls.setItem(claveUltima("uuv"), JSON.stringify({ route: "/uuv/a/", title: "A", scroll: 7 }));
  assert.deepEqual(ultimaVisita(a, "uuv"), { route: "/uuv/a/", title: "A", scroll: 1 }, "scroll fuera de rango se acota a [0, 1]");
  ls.setItem(claveUltima("uuv"), JSON.stringify({ route: "/uuv/a/", title: "A", scroll: "x" }));
  assert.deepEqual(ultimaVisita(a, "uuv"), { route: "/uuv/a/", title: "A", scroll: 0 }, "scroll no numérico cuenta como 0");
});

test("fraccionScroll / posicionScroll: posición aproximada como fracción (2 decimales) y de vuelta a píxeles", () => {
  assert.equal(fraccionScroll(0, 3000, 1000), 0);
  assert.equal(fraccionScroll(1000, 3000, 1000), 0.5);
  assert.equal(fraccionScroll(2000, 3000, 1000), 1);
  assert.equal(fraccionScroll(333, 3000, 1000), 0.17);
  assert.equal(fraccionScroll(500, 800, 1000), 0, "página más corta que la ventana: no hay scroll");
  assert.equal(fraccionScroll(-50, 3000, 1000), 0);
  assert.equal(fraccionScroll(9999, 3000, 1000), 1);
  assert.equal(posicionScroll(0.5, 3000, 1000), 1000);
  assert.equal(posicionScroll(1, 5000, 1000), 4000, "en otra pantalla se escala al nuevo alto");
  assert.equal(posicionScroll(0.5, 800, 1000), 0);
});

test("urlContinuar / debeRestaurar: solo se restaura el scroll al llegar desde la tarjeta a esa misma página", () => {
  const v = { route: "/uuv/packages/uuv_control/", title: "uuv_control", scroll: 0.4 };
  assert.equal(urlContinuar(v), "/uuv/packages/uuv_control/?continuar=1");
  assert.equal(debeRestaurar(v, "/uuv/packages/uuv_control/", "?continuar=1"), true);
  assert.equal(debeRestaurar(v, "/uuv/packages/uuv_control/", ""), false, "una visita normal empieza arriba");
  assert.equal(debeRestaurar(v, "/uuv/quickstart/", "?continuar=1"), false, "otra página no");
  assert.equal(debeRestaurar(null, "/uuv/quickstart/", "?continuar=1"), false);
  assert.equal(debeRestaurar({ ...v, scroll: 0 }, v.route, "?continuar=1"), false, "nada que restaurar");
});

// --- Favoritos ---
test("favoritos: alternar agrega y quita, sin duplicados, en orden de alta y por proyecto", () => {
  const { a } = nuevo();
  assert.deepEqual(favoritos(a, "uuv"), []);
  assert.equal(alternarFavorito(a, "uuv", { route: "/uuv/quickstart/", title: "Quickstart" }), true);
  assert.equal(alternarFavorito(a, "uuv", { route: "/uuv/glosario/", title: "Glosario" }), true);
  alternarFavorito(a, "otro-proyecto", { route: "/otro-proyecto/quickstart/", title: "Inicio X" });
  assert.equal(esFavorito(a, "uuv", "/uuv/quickstart/"), true);
  assert.deepEqual(favoritos(a, "uuv").map((f) => f.route), ["/uuv/quickstart/", "/uuv/glosario/"]);
  assert.equal(alternarFavorito(a, "uuv", { route: "/uuv/quickstart/", title: "Quickstart" }), false, "segunda vez lo quita");
  assert.equal(esFavorito(a, "uuv", "/uuv/quickstart/"), false);
  assert.deepEqual(favoritos(a, "uuv"), [{ route: "/uuv/glosario/", title: "Glosario" }]);
  assert.deepEqual(favoritos(a, "otro-proyecto"), [{ route: "/otro-proyecto/quickstart/", title: "Inicio X" }]);
});

test("quitarFavorito: quita desde la lista y no toca otros proyectos; quitar uno inexistente no hace nada", () => {
  const { a } = nuevo();
  alternarFavorito(a, "uuv", { route: "/uuv/a/", title: "A" });
  alternarFavorito(a, "uuv", { route: "/uuv/b/", title: "B" });
  alternarFavorito(a, "otro-proyecto", { route: "/otro-proyecto/a/", title: "A" });
  quitarFavorito(a, "uuv", "/uuv/a/");
  quitarFavorito(a, "uuv", "/uuv/no-existe/");
  assert.deepEqual(favoritos(a, "uuv"), [{ route: "/uuv/b/", title: "B" }]);
  assert.equal(favoritos(a, "otro-proyecto").length, 1);
});

test("favoritos: JSON corrupto o entradas ajenas se descartan; tope de MAX_FAVORITOS", () => {
  const { ls, a } = nuevo();
  ls.setItem(claveFavoritos("uuv"), "{roto");
  assert.deepEqual(favoritos(a, "uuv"), []);
  ls.setItem(
    claveFavoritos("uuv"),
    JSON.stringify([
      { route: "/uuv/a/", title: "A" },
      { route: "/uuv/a/", title: "A" },
      { route: "https://evil.example/", title: "E" },
      { route: "/otro-proyecto/a/", title: "X" },
      null,
      "x",
      { route: "/uuv/b/" },
    ]),
  );
  assert.deepEqual(favoritos(a, "uuv"), [{ route: "/uuv/a/", title: "A" }]);
  assert.equal(typeof MAX_FAVORITOS, "number");
  for (let i = 0; i < MAX_FAVORITOS + 5; i++) alternarFavorito(a, "uuv", { route: `/uuv/p${i}/`, title: `P${i}` });
  assert.ok(favoritos(a, "uuv").length <= MAX_FAVORITOS);
});

// --- Cambió desde tu última visita ---
test("firmaPagina: el commit manda; si no hay, la fecha; si no hay nada, vacío", () => {
  assert.equal(firmaPagina("2026-10-20T10:00:00Z", "abc1234"), "abc1234");
  assert.equal(firmaPagina("2026-10-20T10:00:00Z", null), "2026-10-20T10:00:00Z");
  assert.equal(firmaPagina(null, undefined), "");
});

test("revisarCambio: la primera visita no avisa; avisa solo si la firma cambió; recuerda la nueva firma", () => {
  const { ls, a } = nuevo();
  const r = "/uuv/quickstart/";
  assert.equal(revisarCambio(a, "uuv", r, "abc"), false, "primera visita");
  assert.equal(ls.getItem(claveVisto("uuv", r)), "abc");
  assert.equal(revisarCambio(a, "uuv", r, "abc"), false, "sin cambios");
  assert.equal(revisarCambio(a, "uuv", r, "def"), true, "cambió");
  assert.equal(revisarCambio(a, "uuv", r, "def"), false, "ya se vio la nueva versión");
  assert.equal(revisarCambio(a, "otro-proyecto", "/otro-proyecto/quickstart/", "def"), false, "otro proyecto es otra primera visita");
  assert.equal(revisarCambio(a, "uuv", "/uuv/otra/", ""), false, "sin firma nunca avisa");
  assert.equal(revisarCambio(a, "uuv", "/uuv/otra/", "x"), false, "y tampoco cuenta como visita previa");
});

test("almacén roto o sin localStorage: nada lanza y todo se comporta como 'sin datos'", () => {
  for (const a of rotos()) {
    assert.doesNotThrow(() => guardarVisita(a, "uuv", { route: "/uuv/a/", title: "A", scroll: 0.3 }));
    assert.equal(ultimaVisita(a, "uuv"), null);
    assert.doesNotThrow(() => alternarFavorito(a, "uuv", { route: "/uuv/a/", title: "A" }));
    assert.doesNotThrow(() => quitarFavorito(a, "uuv", "/uuv/a/"));
    assert.deepEqual(favoritos(a, "uuv"), []);
    assert.equal(esFavorito(a, "uuv", "/uuv/a/"), false);
    assert.equal(revisarCambio(a, "uuv", "/uuv/a/", "abc"), false);
  }
});
