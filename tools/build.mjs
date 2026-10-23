#!/usr/bin/env node
// Construye el portal de documentación en dist/ trayendo de cada repo de projects.json:
//   openwiki/        -> /<id>/wiki/ (visor de OpenWiki + capa móvil) y /<id>/content/
//   docs/arch/*.html -> /<id>/arch/ (diagramas de Archify)
// No llama a ningún LLM. Para repos privados necesita DOCS_GITHUB_TOKEN con permiso de lectura de contenido.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const WORK = join(ROOT, ".build");
const OPENWIKI_VERSION = "0.7.2";
const TOKEN = process.env.DOCS_GITHUB_TOKEN || "";
const LOCAL = Object.fromEntries((process.env.DOCS_LOCAL_REPOS || "").split(",").filter(Boolean).map((p) => p.split("=")));

const toPosix = (p) => p.split(sep).join(posix.sep);

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fields = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fields;
}

function plainText(md) {
  return md
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Trae solo openwiki/ y docs/arch/ con el historial de commits (sin blobs viejos) para fechar cada página.
function fetchRepo(project) {
  const dest = join(WORK, "repos", project.id);
  if (LOCAL[project.id]) return { dir: LOCAL[project.id], git: LOCAL[project.id] };
  const auth = TOKEN ? `x-access-token:${TOKEN}@` : "";
  run("git", ["clone", "--quiet", "--filter=blob:none", "--no-checkout", "--branch", project.branch, `https://${auth}github.com/${project.repo}.git`, dest]);
  run("git", ["-C", dest, "sparse-checkout", "set", "--no-cone", "/openwiki/", "/docs/arch/"]);
  run("git", ["-C", dest, "checkout", "--quiet", project.branch]);
  return { dir: dest, git: dest };
}

function lastChange(gitDir, path) {
  try {
    const out = run("git", ["-C", gitDir, "log", "-1", "--format=%cI|%an", "--", path]);
    if (!out) return null;
    const [date, author] = out.split("|");
    return { date, author };
  } catch {
    return null;
  }
}

// Enlaces relativos a código (../../src/x.py#L3) -> GitHub en el commit construido.
function rewriteCodeLinks(text, mdRel, repoUrl, sha) {
  return text.replace(/\]\((?!https?:|#|mailto:)([^)\s]+?)(#L\d+(?:-L\d+)?)?\)/g, (all, target, anchor = "") => {
    if (target.endsWith(".md") || target.endsWith("/")) return all;
    const abs = posix.normalize(posix.join(posix.dirname(`openwiki/${mdRel}`), target));
    if (abs.startsWith("..")) return all;
    return `](${repoUrl}/blob/${sha}/${abs}${anchor})`;
  });
}

function injectEnhancer(wikiDir) {
  cpSync(join(ROOT, "wiki-enhance"), wikiDir, { recursive: true });
  // Expone la instancia del grafo para poder encuadrarlo (zoomToFit) al cambiar de pestaña en celular.
  const client = join(wikiDir, "client.js");
  const js = readFileSync(client, "utf8");
  const patched = js.replace(/(\n\s*G = )(ForceGraph\(\))/, "$1window.__openwikiGraph = $2");
  if (patched === js) console.warn("  aviso: no se encontró la creación del grafo en client.js; el encuadre automático en celular queda desactivado");
  writeFileSync(client, patched);
  const index = join(wikiDir, "index.html");
  let html = readFileSync(index, "utf8");
  html = html
    .replace('<html lang="en"', '<html lang="es"')
    .replace("</head>", '<link rel="stylesheet" href="./enhance.css" />\n</head>')
    .replace("</body>", '<script src="./enhance.js" defer></script>\n</body>');
  writeFileSync(index, html);
}

function buildProject(project) {
  const src = fetchRepo(project);
  const sha = run("git", ["-C", src.git, "rev-parse", "HEAD"]);
  const repoUrl = `https://github.com/${project.repo}`;
  const out = join(DIST, project.id);
  const stage = join(WORK, "stage", project.id, "openwiki");
  mkdirSync(out, { recursive: true });

  const claimsFile = join(src.dir, "openwiki", ".claims", "claims.json");
  const claims = existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")).claims : [];
  const claimsByPage = {};
  for (const c of claims) claimsByPage[c.page] = (claimsByPage[c.page] || 0) + 1;

  const pages = [];
  const search = [];
  const wikiRoot = join(src.dir, "openwiki");
  for (const file of existsSync(wikiRoot) ? walk(wikiRoot) : []) {
    const rel = toPosix(relative(wikiRoot, file));
    if (rel.startsWith(".")) continue;
    const dest = join(stage, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (!rel.endsWith(".md")) {
      cpSync(file, dest);
      continue;
    }
    const text = rewriteCodeLinks(readFileSync(file, "utf8"), rel, repoUrl, sha);
    writeFileSync(dest, text);
    const fm = frontmatter(text);
    const title = fm.title || (text.match(/^#\s+(.+)$/m) || [])[1] || rel;
    const page = {
      path: rel,
      id: rel.replace(/\.md$/, ""),
      title,
      description: fm.description || "",
      type: fm.type || "",
      owner: fm.owner || "",
      claims: claimsByPage[`openwiki/${rel}`] || 0,
      updated: lastChange(src.git, `openwiki/${rel}`),
    };
    pages.push(page);
    search.push({ path: rel, id: page.id, title, text: plainText(text).slice(0, 4000) });
  }

  if (pages.length) {
    cpSync(stage, join(out, "content"), { recursive: true });
    run("npx", ["--yes", `openwiki@${OPENWIKI_VERSION}`, "visualize", stage, "--export", join(out, "wiki")], { shell: process.platform === "win32" });
    injectEnhancer(join(out, "wiki"));
  }

  const diagrams = [];
  const archDir = join(src.dir, "docs", "arch");
  if (existsSync(archDir)) {
    mkdirSync(join(out, "arch"), { recursive: true });
    for (const name of readdirSync(archDir).filter((n) => n.endsWith(".html"))) {
      const html = readFileSync(join(archDir, name), "utf8");
      const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || name).replace(/\s*·\s*Diagrama$/, "");
      cpSync(join(archDir, name), join(out, "arch", name));
      diagrams.push({ file: `arch/${name}`, title });
    }
  }

  const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const data = {
    ...project,
    repoUrl,
    sha,
    builtAt: new Date().toISOString(),
    claimCount: claims.length,
    lastUpdate: readJson(join(wikiRoot, ".last-update.json")),
    pages,
    packages: pages.filter((p) => p.path.startsWith("packages/") && !p.path.endsWith("index.md")),
    diagrams,
    home: ["quickstart.md", "operations/estado.md"].filter((p) => pages.some((x) => x.path === p)),
  };
  writeFileSync(join(out, "data.json"), JSON.stringify(data, null, 2));
  writeFileSync(join(out, "search.json"), JSON.stringify(search));
  cpSync(join(ROOT, "site", "project.html"), join(out, "index.html"));
  return { id: project.id, name: project.name, summary: project.summary, note: project.note || "", pages: pages.length, claims: claims.length, diagrams: diagrams.length, sha, updated: pages.map((p) => p.updated?.date).filter(Boolean).sort().pop() || null };
}

rmSync(DIST, { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const projects = JSON.parse(readFileSync(join(ROOT, "projects.json"), "utf8"));
const summary = [];
for (const p of projects) {
  try {
    summary.push(buildProject(p));
    console.log(`✓ ${p.id}`);
  } catch (err) {
    console.error(`✗ ${p.id}: ${err.message}`);
    summary.push({ id: p.id, name: p.name, summary: p.summary, error: true });
  }
}
writeFileSync(join(DIST, "projects.json"), JSON.stringify({ builtAt: new Date().toISOString(), projects: summary }, null, 2));
for (const f of ["index.html", "styles.css", "app.js", "home.js"]) cpSync(join(ROOT, "site", f), join(DIST, f));
rmSync(WORK, { recursive: true, force: true });
if (summary.every((p) => p.error)) process.exit(1);
console.log(`Portal listo en dist/: ${summary.length} proyecto(s).`);
