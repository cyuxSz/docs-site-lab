// Fase 0 · 4 y 5: el CI corre los tests antes del build y el README no documenta variables que nadie lee.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("build.yml: hay un paso `npm test` después de `npm ci` y antes del build", () => {
  const y = read(".github/workflows/build.yml");
  const ci = y.search(/run:\s*npm ci\b/);
  const tst = y.search(/run:\s*npm test\b/);
  const build = y.search(/run:\s*npm run build\b/);
  assert.ok(ci >= 0 && build >= 0, "siguen npm ci y npm run build");
  assert.ok(tst >= 0, "falta el paso npm test");
  assert.ok(ci < tst && tst < build, "orden: npm ci → npm test → npm run build");
});

test("README: no menciona PRODUCTION_HOST (nada la lee)", () => {
  assert.ok(!read("README.md").includes("PRODUCTION_HOST"));
});
