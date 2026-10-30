// Regla: la capa Plan nunca es el default ni se persiste (ni storage ni URL).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/components/RoboticsGraph.tsx", import.meta.url), "utf8");

test("showPlan inicia en false y no se lee ni guarda", () => {
  assert.match(src, /useState\(false\)/);
  assert.match(src, /const \[showPlan, setShowPlan\] = useState\(false\);/);
  for (const l of src.split("\n")) {
    if (!/showPlan|setShowPlan|planOn/.test(l)) continue;
    assert.doesNotMatch(l, /localStorage|sessionStorage|searchParams|storage\.(get|set)|URLSearchParams|history\./);
  }
  assert.doesNotMatch(src, /(storage\.(get|set)|localStorage|sessionStorage)[^\n]*plan/i);
  assert.doesNotMatch(src, /searchParams[^\n]*plan|\.set\(\s*["']plan/i);
});
