// Protege contra desborde horizontal a 375 px: el .sr-only absoluto dentro de .ptabs (overflow-x) debe quedar
// contenido (.ptabs es el bloque contenedor) y el diálogo de atajos no debe depender de vw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles/global.css", import.meta.url), "utf8");
const regla = (sel) => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i));
};

test(".ptabs contiene a los hijos absolutos (position: relative + overflow-x)", () => {
  const r = regla(".ptabs");
  assert.match(r, /position:\s*relative/);
  assert.match(r, /overflow-x:\s*auto/);
});

test(".atajos-dialog no usa vw", () => {
  assert.doesNotMatch(regla(".atajos-dialog"), /vw/);
});
