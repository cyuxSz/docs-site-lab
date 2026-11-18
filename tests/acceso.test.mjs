// Proyectos restringidos (access.config.js): una sola fuente de verdad para el login del Worker, las APIs y el build.
// El portal no tiene proyectos restringidos (RESTRICTED = {}), pero el mecanismo se mantiene: canAccess e isRestricted
// aceptan una tabla opcional como último parámetro, y estas pruebas inyectan la de tests/fixtures/acceso-demo.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEMO, ID_DEMO } from "./fixtures/acceso-demo.mjs";

// Import dinámico: si el módulo no existe, cada prueba falla por eso y no todo el archivo.
const config = () => import("../access.config.js");
// Mismas funciones con la tabla de prueba inyectada.
const acceso = async () => {
  const m = await config();
  return {
    ...m,
    canAccess: (login, pathname) => m.canAccess(login, pathname, DEMO),
    isRestricted: (id) => m.isRestricted(id, DEMO),
  };
};
const ids = () => JSON.parse(readFileSync(new URL("../projects.json", import.meta.url), "utf8")).map((p) => p.id);

test("access.config: por defecto no hay proyectos restringidos (RESTRICTED = {})", async () => {
  const { RESTRICTED, isRestricted, canAccess } = await config();
  assert.deepEqual(RESTRICTED, {});
  assert.equal(isRestricted("uuv"), false);
  assert.equal(isRestricted(ID_DEMO), false, "la tabla de prueba no se cuela en la de producción");
  assert.equal(isRestricted(""), false);
  assert.equal(canAccess("otro", `/${ID_DEMO}/`), true);
  assert.equal(canAccess(null, "/uuv/"), true);
});

test("access.config: la tabla inyectada restringe el id de prueba a su login; uuv no", async () => {
  const { isRestricted } = await acceso();
  assert.deepEqual(Object.keys(DEMO), [ID_DEMO]);
  assert.deepEqual(DEMO[ID_DEMO].map((l) => l.toLowerCase()), ["cyuxsz"]);
  assert.equal(isRestricted(ID_DEMO), true);
  assert.equal(isRestricted(ID_DEMO.toUpperCase()), true);
  assert.equal(isRestricted("uuv"), false);
  assert.equal(isRestricted(""), false);
});

test("access.config: cada id restringido existe en projects.json, y el id de prueba no", async () => {
  const { RESTRICTED } = await config();
  for (const id of Object.keys(RESTRICTED)) assert.ok(ids().includes(id), `${id} no está en projects.json`);
  assert.ok(!ids().includes(ID_DEMO), `${ID_DEMO} es solo de prueba y no debe estar en projects.json`);
});

test("access.config: inyectar una tabla no modifica RESTRICTED", async () => {
  const m = await config();
  m.canAccess("otro", `/${ID_DEMO}/`, DEMO);
  m.isRestricted(ID_DEMO, DEMO);
  assert.deepEqual(m.RESTRICTED, {});
});

test("canAccess: el usuario autorizado entra a todo el proyecto restringido (sin distinguir mayúsculas en el login)", async () => {
  const { canAccess } = await acceso();
  for (const login of ["cyuxSz", "cyuxsz", "CYUXSZ"]) {
    for (const path of ["/restringido-demo", "/restringido-demo/", "/restringido-demo/grafo/", "/restringido-demo/ros.json", "/restringido-demo/arch/general.html", "/restringido-demo/packages/foo/"]) {
      assert.equal(canAccess(login, path), true, `${login} ${path}`);
    }
  }
});

test("canAccess: cualquier otro login (o ninguno) no entra a nada bajo el proyecto restringido", async () => {
  const { canAccess } = await acceso();
  const paths = [
    "/restringido-demo",
    "/restringido-demo/",
    "/restringido-demo/novedades/",
    "/restringido-demo/ros.json",
    "/restringido-demo/paginas.json",
    "/restringido-demo/arch/general.html",
    "//restringido-demo/",
    "/restringido%2Ddemo/",
    "/RESTRINGIDO-DEMO/",
  ];
  for (const login of ["otro", "cyuxSz2", "", null, undefined]) {
    for (const path of paths) assert.equal(canAccess(login, path), false, `${String(login)} ${path}`);
  }
});

test("canAccess: el resto del portal no cambia (portada, uuv, assets, ids parecidos)", async () => {
  const { canAccess } = await acceso();
  for (const path of ["/", "/uuv/", "/uuv/ros.json", "/_astro/x.js", "/pagefind/pagefind.js", "/restringido-demo-bis/", "/auth/me"]) {
    assert.equal(canAccess("otro", path), true, path);
  }
});

test("canAccess: una ruta con % mal formado no lanza error", async () => {
  const { canAccess } = await acceso();
  assert.doesNotThrow(() => canAccess("otro", "/restringido-demo/%E0%A4%A/"));
  assert.equal(canAccess("otro", "/restringido-demo/%E0%A4%A/"), false);
});

test("canAccess/isRestricted: la clave de la tabla también se normaliza (clave en mayúsculas)", async () => {
  const { canAccess, isRestricted } = await config();
  const tabla = { "Secreto-Z": ["Ana"] };
  assert.equal(canAccess("otro", "/secreto-z/", tabla), false);
  assert.equal(canAccess("ANA", "/SECRETO-Z/x", tabla), true);
  assert.equal(isRestricted("secreto-z", tabla), true);
  assert.equal(isRestricted("secreto-z"), false, "sin tabla se usa RESTRICTED, que está vacío");
});

test("Pagefind: Base.astro ignora explícitamente (data-pagefind-ignore=all) las páginas de proyectos restringidos", () => {
  const src = readFileSync(new URL("../src/layouts/Base.astro", import.meta.url), "utf8");
  assert.match(src, /<body[^>]*data-pagefind-ignore=\{project && isRestricted\(project\.id\) \? "all" : undefined\}/);
  assert.match(readFileSync(new URL("../access.config.js", import.meta.url), "utf8"), /data-pagefind-ignore="all"/);
});

test("canAccess: rutas con ., %2e, %2F, %5C o .. no esquivan la restricción", async () => {
  const { canAccess } = await acceso();
  const paths = ["/./restringido-demo/", "/%2e/restringido-demo/", "/restringido-demo%2Fros.json", "/%5Crestringido-demo/", "/a/../restringido-demo/"];
  for (const path of paths) {
    assert.equal(canAccess("otro", path), false, path);
    assert.equal(canAccess(null, path), false, path);
  }
  assert.equal(canAccess("cyuxSz", "/./restringido-demo/"), true);
  assert.equal(canAccess("otro", "/uuv/"), true);
  assert.equal(canAccess(null, "/uuv/"), true);
});

test("canAccess sin tabla (producción): sigue fallando cerrado con '..' y escapes mal formados", async () => {
  const { canAccess } = await config();
  for (const login of ["otro", null]) {
    for (const path of ["/a/../uuv/", "/uuv/%2e%2e/x/", "/uuv/%252e%252e/x/", "/%ZZ/uuv/", "/uuv/%E0%A4%A/"]) {
      assert.equal(canAccess(login, path), false, `${login} ${path}`);
    }
  }
  let capas = "%41";
  for (let i = 0; i < 10; i++) capas = capas.replace(/%/g, "%25");
  assert.equal(canAccess("otro", `/uuv/${capas}/`), false, "10 capas sin estabilizar");
});
