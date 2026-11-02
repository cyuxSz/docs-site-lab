// Fase 0 · 1: el Markdown de Limpieza ya no mete U+200B y muestra archivos y configs como código en línea.
// Un code span de CommonMark no admite escapes con "\": el delimitador es una racha de backticks más larga que
// cualquiera del contenido, con un espacio de relleno si el contenido empieza o acaba en backtick.
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/lib/limpieza.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/limpieza.ts → ${name}`);
  return mod[name](...args);
};
const filasLimpieza = fn("filasLimpieza");
const limpiezaMarkdown = fn("limpiezaMarkdown");

const REPO = "https://github.com/o/r";
const SHA = "abc123";
const ZWSP = "​";
const nodo = (id, extra = {}) => ({ id, label: id.split("/").pop(), category: "ros2_node", package: id.split("/")[0], layer: "control", status: "sin_uso", file: `src/${id}.cpp`, line: 10, configs: [], launches: [], ...extra });
const md = (nodes, { repo = REPO, nombre = "X", configs = [] } = {}) => limpiezaMarkdown(nombre, filasLimpieza({ configs, launches: [], nodes }, repo, SHA), new Set());

test("sin U+200B en ningún caso (http://, www., @ en archivo, config, nombre y motivo)", () => {
  const configs = [{ id: "c", label: "ver http://x.example o www.y.example o a@b.example", launch: "l.py", legado: true }];
  const out = md(
    [nodo("p/a", { file: "src/http://x/www.y/user@host.cpp" }), nodo("p/b", { status: "legado", configs: ["c"], file: "src/www.z@q.cpp" })],
    { configs, nombre: "Proyecto www.uuv.example @vanttec" },
  );
  assert.ok(!out.includes(ZWSP), "el Markdown no debe contener U+200B");
  const sinUrl = md([nodo("p/a", { file: "src/user@host.cpp" })], { repo: "no-es-github" });
  assert.ok(!sinUrl.includes(ZWSP));
});

test("archivo con enlace: el texto del enlace es un code span con la ruta tal cual", () => {
  const out = md([nodo("ctl/zz_sin")]);
  assert.ok(out.includes("[`src/ctl/zz_sin.cpp`](https://github.com/o/r/blob/abc123/src/ctl/zz_sin.cpp#L10)"), out);
});

test("archivo sin enlace: code span sin barras invertidas", () => {
  const out = md([nodo("ctl/zz_sin", { file: "src/a_b/c(1).cpp" })], { repo: "no-es-github" });
  assert.ok(out.includes("`src/a_b/c(1).cpp`"), out);
  assert.ok(!out.includes("\\"), "dentro de un code span el \\ se vería literal");
});

test("ruta con '](' dentro del enlace: queda dentro del code span y el destino sigue con %28/%29", () => {
  const out = md([nodo("p/a", { file: "src/a](https://evil.example)" })]);
  assert.ok(out.includes("[`src/a](https://evil.example)`](https://github.com/o/r/blob/abc123/src/a%5D%28https%3A//evil.example%29#L10)"), out);
});

test("backticks en la ruta: el delimitador es más largo que la racha interna", () => {
  const uno = md([nodo("p/a", { file: "src/a`b.cpp" })], { repo: "no-es-github" });
  assert.ok(uno.includes("``src/a`b.cpp``"), uno);
  const dos = md([nodo("p/a", { file: "src/a``b.cpp" })], { repo: "no-es-github" });
  assert.ok(dos.includes("```src/a``b.cpp```"), dos);
});

test("backtick al inicio o al final: relleno con un espacio a cada lado", () => {
  const out = md([nodo("p/a", { file: "`x.cpp" })], { repo: "no-es-github" });
  assert.ok(out.includes("`` `x.cpp ``"), out);
});

test("saltos de línea en la ruta se aplanan: no pueden abrir un bloque nuevo", () => {
  const out = md([nodo("p/a", { file: "src/a\n# titulo falso.cpp" })], { repo: "no-es-github" });
  assert.doesNotMatch(out, /^# titulo falso/m);
  assert.ok(out.includes("`src/a # titulo falso.cpp`"), out);
});

test("configs a retirar: cada una como code span", () => {
  const configs = [
    { id: "c1", label: "Sistema anterior (gazebo_launch)", launch: "a.py", legado: true },
    { id: "c2", label: "[clic](https://evil.example)", launch: "b.py", legado: true },
  ];
  const out = md([nodo("p/a", { status: "legado", configs: ["c1", "c2"] })], { configs });
  assert.ok(out.includes("Configs a retirar: `Sistema anterior (gazebo_launch)`, `[clic](https://evil.example)`"), out);
});

test("el motivo sigue como texto plano (no code span)", () => {
  const out = md([nodo("p/a")]);
  assert.match(out, / — Ningún launch file lo lanza\.$/m);
});
