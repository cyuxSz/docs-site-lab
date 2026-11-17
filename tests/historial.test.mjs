// QoL 7: historial por página. tools/historial.mjs corre `git log` en el build (sin API de GitHub en runtime) y
// tools/fetch.mjs guarda los últimos 10 commits de cada página en pageList[].historial. La página de wiki los muestra
// en un <details> "Historial" del panel derecho; sin historial, el bloque no aparece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let mod = null;
let fallo = null;
try {
  mod = await import("../tools/historial.mjs");
} catch (e) {
  fallo = e;
}
const H = (...fns) => {
  assert.ok(mod, `falta tools/historial.mjs (${fallo?.code ?? fallo?.message})`);
  for (const f of fns) assert.equal(typeof mod[f], "function", `tools/historial.mjs no exporta ${f}`);
  return mod;
};

const REPO = "https://github.com/org/repo";
const SHA = "a".repeat(40);
const SHA2 = "b".repeat(40);
const US = "\x1f";
const RS = "\x1e";
const reg = (sha, fecha, autor, msg) => [sha, fecha, autor, msg].join(US) + RS;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

test("FORMATO: separa campos con %x1f y registros con %x1e (hash, fecha ISO, autor, asunto)", () => {
  const { FORMATO } = H();
  assert.equal(FORMATO, "%H%x1f%cI%x1f%an%x1f%s%x1e");
});

test("parseLog: arma fecha, autor, mensaje, enlace al commit y enlace al diff del archivo", () => {
  const { parseLog } = H("parseLog");
  const out = parseLog(reg(SHA, "2026-10-27T11:14:34-06:00", "Ana", "Corrige topics") + "\n" + reg(SHA2, "2026-10-20T09:00:00-06:00", "Beto", "Agrega página"), {
    repoUrl: REPO,
    path: "openwiki/architecture/topics.md",
  });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], {
    sha: SHA,
    corto: "aaaaaaa",
    fecha: "2026-10-27T11:14:34-06:00",
    autor: "Ana",
    mensaje: "Corrige topics",
    url: `${REPO}/commit/${SHA}`,
    diff: `${REPO}/commit/${SHA}#diff-${sha256("openwiki/architecture/topics.md")}`,
  });
  assert.equal(out[1].autor, "Beto");
});

test("parseLog: mensaje corto (≤ 72 caracteres con …), sin caracteres de control; descarta hash o fecha inválidos; tope max", () => {
  const { parseLog } = H("parseLog");
  const largo = "x".repeat(100);
  const [a] = parseLog(reg(SHA, "2026-10-27T11:14:34-06:00", "An\x07a", largo), { repoUrl: REPO, path: "openwiki/a.md" });
  assert.equal(a.mensaje.length, 72);
  assert.ok(a.mensaje.endsWith("…"));
  assert.equal(a.autor, "Ana");
  assert.deepEqual(parseLog(reg("zzz", "2026-10-27T11:14:34-06:00", "A", "m"), { repoUrl: REPO, path: "openwiki/a.md" }), []);
  assert.deepEqual(parseLog(reg(SHA, "no-es-fecha", "A", "m"), { repoUrl: REPO, path: "openwiki/a.md" }), []);
  assert.deepEqual(parseLog("", { repoUrl: REPO, path: "openwiki/a.md" }), []);
  const muchos = Array.from({ length: 15 }, () => reg(SHA, "2026-10-27T11:14:34-06:00", "A", "m")).join("\n");
  assert.equal(parseLog(muchos, { repoUrl: REPO, path: "openwiki/a.md", max: 10 }).length, 10);
});

test("historial: git log real, solo commits del archivo, del más nuevo al más viejo, máximo 10; [] si no hay repo", () => {
  const { historial } = H("historial");
  const dir = mkdtempSync(join(tmpdir(), "historial-"));
  const env = { ...process.env, GIT_AUTHOR_NAME: "Ana", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "Ana", GIT_COMMITTER_EMAIL: "a@x" };
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("init", "-q");
    mkdirSync(join(dir, "openwiki"));
    for (let i = 1; i <= 12; i++) {
      writeFileSync(join(dir, "openwiki", "a.md"), `v${i}\n`);
      git("add", ".");
      git("commit", "-q", "-m", `cambio ${i}`);
    }
    writeFileSync(join(dir, "openwiki", "b.md"), "otra\n");
    git("add", ".");
    git("commit", "-q", "-m", "solo b");
    const h = historial(dir, "openwiki/a.md", { repoUrl: REPO });
    assert.equal(h.length, 10);
    assert.equal(h[0].mensaje, "cambio 12");
    assert.equal(h[9].mensaje, "cambio 3");
    assert.ok(h.every((c) => c.autor === "Ana" && /^[0-9a-f]{40}$/.test(c.sha)));
    assert.equal(historial(dir, "openwiki/b.md", { repoUrl: REPO }).length, 1);
    assert.deepEqual(historial(dir, "openwiki/no-existe.md", { repoUrl: REPO }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const vacio = mkdtempSync(join(tmpdir(), "sin-git-"));
  try {
    assert.deepEqual(historial(vacio, "openwiki/a.md", { repoUrl: REPO }), []);
  } finally {
    rmSync(vacio, { recursive: true, force: true });
  }
});

test("tools/fetch.mjs guarda historial por página con tools/historial.mjs (git log, sin API de GitHub)", () => {
  const src = read("tools/fetch.mjs");
  assert.match(src, /import\s*\{[^}]*historial[^}]*\}\s*from\s*["']\.\/historial\.mjs["']/);
  assert.match(src, /historial:\s*historial\(dir,\s*`openwiki\/\$\{rel\}`/);
  const h = read("tools/historial.mjs");
  assert.doesNotMatch(h, /api\.github\.com|fetch\(/);
  assert.doesNotMatch(h, /--follow/, "--follow en un clon --filter=blob:none baja blobs bajo demanda");
});

test("src/lib/data.ts: PageInfo.historial opcional", () => {
  assert.match(read("src/lib/data.ts"), /historial\?:\s*Commit\[\]/);
});

// Lote "Menos ruido": el historial pasa del panel derecho al menú "⋯" de la página (#pagina-menu).
test("página de wiki: <details> 'Historial' en el menú ⋯ de la página, solo si hay commits, con enlaces al commit y 'ver diff'", () => {
  const src = read("src/pages/[project]/[...slug].astro");
  const ini = src.indexOf('id="pagina-menu"');
  assert.ok(ini >= 0, "falta el menú id=\"pagina-menu\"");
  const aside = src.slice(ini, src.indexOf("</details>", ini) + 10);
  assert.match(aside, /<details class="historial"/);
  assert.match(aside, /<summary>Historial<\/summary>/);
  assert.match(src, /historial\.length\s*>\s*0\s*&&/);
  assert.match(aside, /<time datetime=\{c\.fecha\}/);
  assert.match(aside, /href=\{c\.url\}/);
  assert.match(aside, /href=\{c\.diff\}/);
  assert.match(aside, /[Vv]er diff/);
  assert.doesNotMatch(src, /set:html/);
});

test("global.css: estilos de .historial con tokens (sin colores fijos)", () => {
  const css = read("src/styles/global.css");
  const i = css.indexOf(".historial");
  assert.ok(i >= 0, "faltan estilos .historial");
  const bloque = css.slice(i, css.indexOf("\n\n", i) > 0 ? css.indexOf("\n\n", i) : undefined);
  assert.doesNotMatch(bloque, /#[0-9a-fA-F]{3,6}\b/);
});
