import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodificar } from "../lib/decodificar-ruta.mjs";

const leer = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("decodificar-ruta.mjs no contiene ni importa RESTRICTED ni access.config", () => {
  const s = leer("lib/decodificar-ruta.mjs");
  assert.doesNotMatch(s, /RESTRICTED/);
  assert.doesNotMatch(s, /access\.config/);
  assert.doesNotMatch(s, /^\s*import\b/m);
});

test("access.config.js y src/lib/personal.ts importan decodificar-ruta y no la redefinen", () => {
  for (const f of ["access.config.js", "src/lib/personal.ts"]) {
    const s = leer(f);
    assert.match(s, /import\s*\{\s*decodificar\s*\}\s*from\s*"[^"]*lib\/decodificar-ruta\.mjs"|from\s*"\.\/lib\/decodificar-ruta\.mjs"/, f);
    assert.doesNotMatch(s, /function decodificar\s*\(/, f);
  }
});

test("decodificar: comportamiento", () => {
  assert.equal(decodificar("/a%20b"), "/a b");
  assert.equal(decodificar("/a%2e%2e"), "/a..");
  assert.equal(decodificar("/%zz"), null);
  assert.equal(decodificar("/%252525252525"), null);
});
