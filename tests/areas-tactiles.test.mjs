// Áreas tocables mínimas (36 px) en los summary móviles de la SideNav y del índice «En esta página».
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const cuerpo = (sel) => {
  const m = css.split("\n").find((l) => l.startsWith(`${sel} {`));
  assert.ok(m, `existe la regla ${sel}`);
  return m;
};

for (const sel of [".nav-grupo summary", ".toc-movil summary"]) {
  test(`${sel}: área tocable de al menos 36 px`, () => {
    const r = cuerpo(sel);
    const mh = r.match(/min-height:\s*(\d+)px/);
    assert.ok(mh && Number(mh[1]) >= 36, "min-height >= 36px");
  });
}
