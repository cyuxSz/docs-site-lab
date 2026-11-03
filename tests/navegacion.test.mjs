// Anterior / Siguiente y migas de la wiki (src/lib/navegacion.ts), en el mismo orden que la navegación lateral.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anteriorSiguiente, migas } from "../src/lib/navegacion.ts";

// Misma ruta que pageRoute() de tools/fetch.mjs.
const slugOf = (path) => path.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
const page = (path, title, type = "page") => ({
  path,
  route: `/uuv/${slugOf(path) ? `${slugOf(path)}/` : ""}`,
  title,
  description: "",
  type,
  owner: "",
  claims: 0,
  updated: null,
  author: null,
});

// Desordenadas a propósito: el orden sale de sections() (Empezar, Arquitectura, Paquetes, Operación; índice primero).
const PAGES = [
  page("packages/uuv_vision.md", "uuv_vision", "component"),
  page("quickstart.md", "Inicio rápido", "guide"),
  page("INSTRUCTIONS.md", "Instrucciones", "meta"),
  page("packages/index.md", "Paquetes", "index"),
  page("index.md", "UUV", "index"),
  page("architecture/overview.md", "Visión general", "architecture"),
  page("packages/uuv_control.md", "uuv_control", "component"),
  page("operations/estado.md", "Estado", "guide"),
];
const PROJ = { id: "uuv", name: "UUV · uuv_software" };

test("anteriorSiguiente: sigue el orden de la navegación lateral y salta entre secciones", () => {
  const { prev, next } = anteriorSiguiente(PAGES, "/uuv/packages/");
  assert.deepEqual(prev, { route: "/uuv/architecture/overview/", label: "Visión general" });
  assert.deepEqual(next, { route: "/uuv/packages/uuv_control/", label: "uuv_control" });
});

test("anteriorSiguiente: los índices se llaman como en la barra lateral", () => {
  assert.deepEqual(anteriorSiguiente(PAGES, "/uuv/packages/uuv_control/").prev, { route: "/uuv/packages/", label: "Resumen de paquetes" });
});

test("anteriorSiguiente: null en los extremos, sin páginas meta y null si la ruta no existe", () => {
  assert.equal(anteriorSiguiente(PAGES, "/uuv/").prev, null);
  assert.deepEqual(anteriorSiguiente(PAGES, "/uuv/operations/estado/"), { prev: { route: "/uuv/packages/uuv_vision/", label: "uuv_vision" }, next: null });
  assert.deepEqual(anteriorSiguiente(PAGES, "/uuv/nada/"), { prev: null, next: null });
});

// Lote carátula: el proyecto enlaza a la carátula y le sigue la miga «Software» (/<id>/software/).
test("migas: proyecto › Software › sección › página, con enlace al índice de la sección", () => {
  assert.deepEqual(migas(PAGES, "/uuv/packages/uuv_control/", PROJ), [
    { label: "UUV · uuv_software", href: "/uuv/" }, { label: "Software", href: "/uuv/software/" },
    { label: "Paquetes", href: "/uuv/packages/" },
    { label: "uuv_control" },
  ]);
});

test("migas: en el índice de la sección, la sección es la página actual (sin enlace)", () => {
  assert.deepEqual(migas(PAGES, "/uuv/packages/", PROJ), [{ label: "UUV · uuv_software", href: "/uuv/" }, { label: "Software", href: "/uuv/software/" }, { label: "Paquetes" }]);
});

test("migas: sección sin índice va sin enlace; la sección raíz (Empezar) no aparece", () => {
  assert.deepEqual(migas(PAGES, "/uuv/operations/estado/", PROJ), [
    { label: "UUV · uuv_software", href: "/uuv/" }, { label: "Software", href: "/uuv/software/" },
    { label: "Operación" },
    { label: "Estado" },
  ]);
  assert.deepEqual(migas(PAGES, "/uuv/quickstart/", PROJ), [{ label: "UUV · uuv_software", href: "/uuv/" }, { label: "Software", href: "/uuv/software/" }, { label: "Inicio rápido" }]);
});
