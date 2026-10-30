// sections() (src/lib/data.ts): carpeta discrepancias/ y etiquetas de carpetas desconocidas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sections } from "../src/lib/data.ts";

const page = (path, title, type = "page") => ({ path, route: `/uuv/${path}/`, title, description: "", type, owner: "", claims: 0, updated: null, author: null });

const PAGES = [
  page("zeta/index.md", "Cosas raras", "index"),
  page("zeta/a.md", "A"),
  page("discrepancias/launch.md", "Launch roto"),
  page("discrepancias/index.md", "Discrepancias (a revisar)", "index"),
  page("operations/estado.md", "Estado", "guide"),
  page("quickstart.md", "Inicio rápido", "guide"),
  page("sinindice/b.md", "B"),
];

test("sections: discrepancias/ va al final de las conocidas con su etiqueta", () => {
  const labels = sections(PAGES).map((g) => g.label);
  assert.ok(labels.includes("Discrepancias (a revisar)"), labels.join(", "));
  assert.ok(labels.indexOf("Discrepancias (a revisar)") > labels.indexOf("Operación"));
  assert.ok(labels.indexOf("Discrepancias (a revisar)") < labels.indexOf("Cosas raras"), "las conocidas van antes que las desconocidas");
});

test("sections: discrepancias/ se reconoce aunque su index.md tenga otro título", () => {
  const pages = [page("discrepancias/index.md", "Otro título", "index")];
  assert.deepEqual(sections(pages).map((g) => g.label), ["Discrepancias (a revisar)"]);
});

test("sections: una carpeta desconocida usa el title de su index.md; sin índice, el nombre de la carpeta", () => {
  assert.deepEqual(sections(PAGES).map((g) => g.label), ["Empezar", "Operación", "Discrepancias (a revisar)", "Cosas raras", "sinindice"]);
});

test("sections: la etiqueta de una carpeta desconocida no sale de un sub/index.md", () => {
  const pages = [page("zeta/sub/index.md", "Sub", "index"), page("zeta/a.md", "A")];
  assert.deepEqual(sections(pages).map((g) => g.label), ["zeta"]);
});
