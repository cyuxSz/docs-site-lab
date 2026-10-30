// "Copiar como cita Markdown" (lote 4b-2): lógica pura en tools/citas.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as citas from "../tools/citas.mjs";

const { lenguajeDe, citaMarkdown } = citas;
const HREF = "https://github.com/o/r/blob/3f2820a/src/uuv_master/a.py#L3-L4";

test("lenguajeDe: por nombre y extensión, sin distinguir mayúsculas", () => {
  assert.equal(typeof lenguajeDe, "function", "falta lenguajeDe en tools/citas.mjs");
  const casos = {
    "src/CMakeLists.txt": "cmake",
    "a/b.py": "python",
    "x.cpp": "cpp",
    "x.HPP": "cpp",
    "x.h": "cpp",
    "x.cc": "cpp",
    "fw/main.ino": "cpp",
    "x.mjs": "javascript",
    "x.ts": "typescript",
    "x.json": "json",
    "cfg/a.yaml": "yaml",
    "cfg/a.yml": "yaml",
    "launch/a.launch": "xml",
    "urdf/sub.xacro": "xml",
    "package.xml": "xml",
    "run.sh": "bash",
    "README.md": "markdown",
    "matlab/pid.m": "matlab",
    "msg/Pose.msg": "",
    "LICENSE": "",
  };
  for (const [f, l] of Object.entries(casos)) assert.equal(lenguajeDe(f), l, f);
  assert.equal(lenguajeDe(null), "");
  assert.equal(lenguajeDe(42), "");
});

test("citaMarkdown: enlace con rango y bloque de código con lenguaje", () => {
  assert.equal(typeof citaMarkdown, "function", "falta citaMarkdown en tools/citas.mjs");
  const md = citaMarkdown({ file: "src/uuv_master/a.py", start: 3, end: 4, lines: ["x = 1", "y = 2"], truncated: false, href: HREF });
  assert.equal(md, `[src/uuv_master/a.py:L3-L4](${HREF})\n\n\`\`\`python\nx = 1\ny = 2\n\`\`\`\n`);
});

test("citaMarkdown: línea suelta y archivo sin lenguaje", () => {
  const href = "https://github.com/o/r/blob/abc/msg/Pose.msg#L5";
  assert.equal(citaMarkdown({ file: "msg/Pose.msg", start: 5, end: 5, lines: ["float64 x"], href }), `[msg/Pose.msg:L5](${href})\n\n\`\`\`\nfloat64 x\n\`\`\`\n`);
});

test("citaMarkdown: truncado agrega … al final del bloque", () => {
  const md = citaMarkdown({ file: "a.py", start: 1, end: 50, lines: ["a", "b"], truncated: true, href: "https://github.com/o/r/blob/s/a.py#L1-L50" });
  assert.ok(md.endsWith("a\nb\n…\n```\n"), md);
  assert.ok(md.startsWith("[a.py:L1-L50]("));
});

test("citaMarkdown: escapa la etiqueta y el href", () => {
  const md = citaMarkdown({ file: "src/[x]\\y (1).py", start: 1, end: 2, lines: ["z"], href: "https://github.com/o/r/blob/s/src/[x]/y (1).py#L1-L2" });
  const primera = md.split("\n")[0];
  assert.equal(primera, "[src/\\[x\\]\\\\y (1).py:L1-L2](https://github.com/o/r/blob/s/src/[x]/y%20%281%29.py#L1-L2)");
});

test("citaMarkdown: el fence es más largo que cualquier racha de comillas invertidas del código", () => {
  const md = citaMarkdown({ file: "README.md", start: 1, end: 3, lines: ["```bash", "ls", "```"], href: "https://github.com/o/r/blob/s/README.md#L1-L3" });
  assert.ok(md.includes("\n\n````markdown\n```bash\nls\n```\n````\n"), md);
  const md5 = citaMarkdown({ file: "a.md", start: 1, end: 1, lines: ["`````"], href: "https://github.com/o/r/blob/s/a.md#L1" });
  assert.ok(md5.includes("``````markdown\n`````\n``````\n"), md5);
});

test("citaMarkdown: null con href ajeno a GitHub o entradas inválidas", () => {
  const ok = { file: "a.py", start: 1, end: 1, lines: ["x"], href: "https://github.com/o/r/blob/s/a.py#L1" };
  assert.equal(citaMarkdown({ ...ok, href: "javascript:alert(1)" }), null);
  assert.equal(citaMarkdown({ ...ok, href: "https://evil.example/github.com/" }), null);
  assert.equal(citaMarkdown({ ...ok, href: "http://github.com/o/r" }), null);
  assert.equal(citaMarkdown({ ...ok, lines: "x" }), null);
  assert.equal(citaMarkdown({ ...ok, lines: [1, 2] }), null);
  assert.equal(citaMarkdown({ ...ok, start: 0 }), null);
  assert.equal(citaMarkdown({ ...ok, end: 1.5 }), null);
  assert.equal(citaMarkdown({ ...ok, start: "1" }), null);
});
