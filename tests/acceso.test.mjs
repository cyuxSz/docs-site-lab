// Proyectos restringidos (access.config.js): una sola fuente de verdad para middleware.js y el build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Import dinámico: si el módulo no existe, cada prueba falla por eso y no todo el archivo.
const acceso = () => import("../access.config.js");

test("access.config: proyecto-x restringido a cyuxSz; uuv no", async () => {
  const { RESTRICTED, isRestricted } = await acceso();
  assert.deepEqual(Object.keys(RESTRICTED), ["proyecto-x"]);
  assert.deepEqual(RESTRICTED["proyecto-x"].map((l) => l.toLowerCase()), ["cyuxsz"]);
  assert.equal(isRestricted("proyecto-x"), true);
  assert.equal(isRestricted("uuv"), false);
  assert.equal(isRestricted(""), false);
});

test("access.config: cada id restringido existe en projects.json", async () => {
  const { RESTRICTED } = await acceso();
  const ids = JSON.parse(readFileSync(new URL("../projects.json", import.meta.url), "utf8")).map((p) => p.id);
  for (const id of Object.keys(RESTRICTED)) assert.ok(ids.includes(id), `${id} no está en projects.json`);
});

test("canAccess: el usuario autorizado entra a todo /proyecto-x/ (sin distinguir mayúsculas en el login)", async () => {
  const { canAccess } = await acceso();
  for (const login of ["cyuxSz", "cyuxsz", "CYUXSZ"]) {
    for (const path of ["/proyecto-x", "/proyecto-x/", "/proyecto-x/grafo/", "/proyecto-x/ros.json", "/proyecto-x/arch/general.html", "/proyecto-x/packages/foo/"]) {
      assert.equal(canAccess(login, path), true, `${login} ${path}`);
    }
  }
});

test("canAccess: cualquier otro login (o ninguno) no entra a nada bajo /proyecto-x/", async () => {
  const { canAccess } = await acceso();
  const paths = [
    "/proyecto-x",
    "/proyecto-x/",
    "/proyecto-x/novedades/",
    "/proyecto-x/ros.json",
    "/proyecto-x/paginas.json",
    "/proyecto-x/arch/general.html",
    "//proyecto-x/",
    "/proyecto%2Dx/",
    "/PROYECTO-X/",
  ];
  for (const login of ["otro", "cyuxSz2", "", null, undefined]) {
    for (const path of paths) assert.equal(canAccess(login, path), false, `${String(login)} ${path}`);
  }
});

test("canAccess: el resto del portal no cambia (portada, uuv, assets, ids parecidos)", async () => {
  const { canAccess } = await acceso();
  for (const path of ["/", "/uuv/", "/uuv/ros.json", "/_astro/x.js", "/pagefind/pagefind.js", "/proyecto-x-bis/", "/auth/me"]) {
    assert.equal(canAccess("otro", path), true, path);
  }
});

test("canAccess: una ruta con % mal formado no lanza error", async () => {
  const { canAccess } = await acceso();
  assert.doesNotThrow(() => canAccess("otro", "/proyecto-x/%E0%A4%A/"));
  assert.equal(canAccess("otro", "/proyecto-x/%E0%A4%A/"), false);
});

test("canAccess/isRestricted: la clave de RESTRICTED también se normaliza (clave en mayúsculas)", async () => {
  const { RESTRICTED, canAccess, isRestricted } = await acceso();
  RESTRICTED["Secreto-Z"] = ["Ana"];
  try {
    assert.equal(canAccess("otro", "/secreto-z/"), false);
    assert.equal(canAccess("ANA", "/SECRETO-Z/x"), true);
    assert.equal(isRestricted("secreto-z"), true);
  } finally {
    delete RESTRICTED["Secreto-Z"];
  }
});

test("Pagefind: Base.astro ignora explícitamente (data-pagefind-ignore=all) las páginas de proyectos restringidos", () => {
  const src = readFileSync(new URL("../src/layouts/Base.astro", import.meta.url), "utf8");
  assert.match(src, /<body[^>]*data-pagefind-ignore=\{project && isRestricted\(project\.id\) \? "all" : undefined\}/);
  assert.match(readFileSync(new URL("../access.config.js", import.meta.url), "utf8"), /data-pagefind-ignore="all"/);
});
