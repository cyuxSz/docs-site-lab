#!/usr/bin/env node
// Paso 1 del build: trae de cada repo de projects.json solo openwiki/ y docs/arch/ y los deja en .content/
// listos para Astro:
//   .content/docs/<id>/<ruta>.md   páginas con enlaces reescritos y metadatos de git en el frontmatter
//   .content/data/<id>.json        resumen del proyecto, grafo ROS (si hay) y grafo de enlaces entre páginas
//   .content/arch/<id>/*.html      diagramas de Archify (tools/postbuild.mjs los copia a dist/<id>/arch/)
//   .content/projects.json         portada: proyectos, estado y avisos
// No llama a ningún LLM. Para repos privados necesita DOCS_GITHUB_TOKEN con permiso de lectura de contenido.
// DOCS_STRICT=1 (CI) termina con error si algún proyecto falla, salvo repos privados cuando no hay token.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".content");
const WORK = join(ROOT, ".build");
const TOKEN = process.env.DOCS_GITHUB_TOKEN || "";
const STRICT = process.env.DOCS_STRICT === "1";
const LOCAL = Object.fromEntries((process.env.DOCS_LOCAL_REPOS || "").split(",").filter(Boolean).map((p) => p.split("=")));

const toPosix = (p) => p.split(sep).join(posix.sep);
const hideToken = (s) => (TOKEN ? s.split(TOKEN).join("***") : s);

// git con stderr capturado y sin pedir usuario/contraseña; el error nunca incluye el token.
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
  } catch (err) {
    throw new Error(hideToken(String(err.stderr || "").trim() || err.message));
  }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Ruta de una página en el portal: openwiki/packages/index.md -> /<id>/packages/
export function pageRoute(id, rel) {
  const slug = rel.replace(/\.md$/, "").replace(/(^|\/)index$/, "");
  return `/${id}/${slug ? `${slug}/` : ""}`;
}

// Traduce el error de git a algo que se pueda mostrar en la portada.
function describeError(err, project) {
  const msg = hideToken(err.message);
  if (/Authentication failed|could not read Username|Repository not found|returned error: 40[34]/i.test(msg)) {
    return {
      auth: true,
      message: TOKEN
        ? `DOCS_GITHUB_TOKEN no puede leer ${project.repo}: caducó, se revocó o no incluye ese repo.`
        : `${project.repo} es privado y falta DOCS_GITHUB_TOKEN.`,
    };
  }
  if (/Remote branch .* not found/i.test(msg)) return { message: `No existe la rama ${project.branch} en ${project.repo}.` };
  return { message: msg.split("\n").find((l) => l.trim())?.slice(0, 240) || "Error desconocido." };
}

// Los tokens fine-grained traen su fecha de caducidad en un header; avisa si faltan 14 días o menos.
async function tokenAlert() {
  if (!TOKEN) return null;
  try {
    const res = await fetch("https://api.github.com/rate_limit", { headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "docs-site-lab" } });
    if (res.status === 401) return { level: "error", text: "DOCS_GITHUB_TOKEN ya no es válido (caducó o se revocó). Genera otro y actualízalo en Vercel." };
    const raw = res.headers.get("github-authentication-token-expiration");
    if (!raw) return null;
    const expires = new Date(raw.replace(/^(\S+) (\S+) ([+-]\d\d)(\d\d)$/, "$1T$2$3:$4"));
    const days = Math.floor((expires - Date.now()) / 864e5);
    if (Number.isNaN(days) || days > 14) return null;
    const when = expires.toLocaleDateString("es-MX", { dateStyle: "medium" });
    return { level: days < 0 ? "error" : "warn", text: days < 0 ? `DOCS_GITHUB_TOKEN caducó el ${when}.` : `DOCS_GITHUB_TOKEN caduca el ${when} (en ${days} día(s)). Renuévalo en GitHub y actualízalo en Vercel.` };
  } catch {
    return null;
  }
}

// Trae solo openwiki/ y docs/arch/ con el historial de commits (sin blobs viejos) para fechar cada página.
function fetchRepo(project) {
  if (LOCAL[project.id]) return LOCAL[project.id];
  const dest = join(WORK, project.id);
  const auth = TOKEN ? `x-access-token:${TOKEN}@` : "";
  git(["clone", "--quiet", "--filter=blob:none", "--no-checkout", "--branch", project.branch, `https://${auth}github.com/${project.repo}.git`, dest]);
  git(["-C", dest, "sparse-checkout", "set", "--no-cone", "/openwiki/", "/docs/arch/"]);
  git(["-C", dest, "checkout", "--quiet", project.branch]);
  return dest;
}

function lastChange(dir, path) {
  try {
    const out = git(["-C", dir, "log", "-1", "--format=%cI|%an", "--", path]);
    if (!out) return {};
    const [date, author] = out.split("|");
    return { date, author };
  } catch {
    return {};
  }
}

function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fields: {}, body: text };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { fields, body: text.slice(m[0].length) };
}

// Las wikis son Markdown puro (la auditoría no encontró HTML incrustado). Cualquier etiqueta HTML fuera de bloques de
// código se escapa y se muestra como texto: así nadie mete <script>, <iframe> o formularios en el portal desde un repo.
// La CSP del sitio es la segunda barrera.
export function neutralizeHtml(body) {
  let fence = null;
  return body
    .split("\n")
    .map((line) => {
      const f = line.match(/^\s*(`{3,}|~{3,})/);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      // Fuera de `código en línea`, "<" seguido de letra, "/", "!" o "?" abre HTML: se escapa.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part, i) => (i % 2 ? part : part.replace(/<(?=[A-Za-z\/!?])/g, "&lt;")))
        .join("");
    })
    .join("\n");
}

// Enlaces de la wiki: .md -> ruta del portal; código -> GitHub en el commit construido.
function rewriteLinks(body, id, rel, repoUrl, sha, links) {
  return body.replace(/\]\((?!https?:|mailto:|#)([^)\s]+?)(#[^)\s]*)?\)/g, (all, target, anchor = "") => {
    const abs = posix.normalize(posix.join(posix.dirname(`openwiki/${rel}`), target));
    if (abs.startsWith("..")) return all;
    if (abs.startsWith("openwiki/") && (abs.endsWith(".md") || abs.endsWith("/"))) {
      const to = abs.slice("openwiki/".length).replace(/\/$/, "/index.md");
      links.add(to);
      return `](${pageRoute(id, to)}${anchor})`;
    }
    return `](${repoUrl}/blob/${sha}/${abs}${anchor})`;
  });
}

function buildProject(project) {
  const dir = fetchRepo(project);
  const sha = git(["-C", dir, "rev-parse", "HEAD"]);
  const repoUrl = `https://github.com/${project.repo}`;
  const wikiRoot = join(dir, "openwiki");

  const claimsFile = join(wikiRoot, ".claims", "claims.json");
  const claims = existsSync(claimsFile) ? JSON.parse(readFileSync(claimsFile, "utf8")).claims : [];
  const claimsByPage = {};
  for (const c of claims) claimsByPage[c.page] = (claimsByPage[c.page] || 0) + 1;

  const pages = [];
  const edges = [];
  for (const file of existsSync(wikiRoot) ? walk(wikiRoot) : []) {
    const rel = toPosix(relative(wikiRoot, file));
    if (rel.startsWith(".") || !rel.endsWith(".md")) continue;
    const { fields, body } = splitFrontmatter(readFileSync(file, "utf8"));
    const links = new Set();
    const text = rewriteLinks(neutralizeHtml(body), project.id, rel, repoUrl, sha, links);
    const { date, author } = lastChange(dir, `openwiki/${rel}`);
    const title = fields.title || (body.match(/^#\s+(.+)$/m) || [])[1] || rel;
    const page = {
      path: rel,
      route: pageRoute(project.id, rel),
      title,
      description: fields.description || "",
      type: fields.type || (rel === "INSTRUCTIONS.md" ? "meta" : rel.endsWith("index.md") ? "index" : "page"),
      owner: fields.owner || "",
      claims: claimsByPage[`openwiki/${rel}`] || 0,
      updated: date || null,
      author: author || null,
    };
    pages.push(page);
    for (const to of links) if (to !== rel) edges.push({ source: rel, target: to });
    // El frontmatter se vuelve a escribir con cada valor en JSON (YAML válido aunque el original traiga ": " sin comillas)
    // y se le agregan los datos del portal.
    const extra = { project: project.id, path: rel, title, type: page.type, claims: page.claims, updated: page.updated, author: page.author, source: `${repoUrl}/blob/${sha}/openwiki/${rel}` };
    const fm = Object.entries({ ...fields, ...extra }).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
    const dest = join(OUT, "docs", project.id, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `---\n${fm}\n---\n${text}`);
  }

  const diagrams = [];
  const archDir = join(dir, "docs", "arch");
  if (existsSync(archDir)) {
    for (const name of readdirSync(archDir).filter((n) => n.endsWith(".html"))) {
      const html = readFileSync(join(archDir, name), "utf8");
      const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || name).replace(/\s*·\s*Diagrama$/, "");
      mkdirSync(join(OUT, "arch", project.id), { recursive: true });
      cpSync(join(archDir, name), join(OUT, "arch", project.id, name));
      diagrams.push({ file: `/${project.id}/arch/${name}`, title, kb: Math.round(html.length / 1024) });
    }
  }

  if (!pages.length && !diagrams.length) {
    // Repo sin documentación en esta rama: lo dice en la portada y sugiere ramas docs/* sin mergear.
    let pending = [];
    try {
      pending = git(["-C", dir, "ls-remote", "--heads", "origin", "docs/*"]).split("\n").filter(Boolean).map((l) => l.split("refs/heads/")[1]);
    } catch {}
    const hint = pending.length ? ` Hay ramas de documentación sin mergear: ${pending.join(", ")}.` : "";
    return { ...project, empty: true, message: `La rama ${project.branch} todavía no tiene openwiki/ ni docs/arch/.${hint}` };
  }

  const rosFile = join(wikiRoot, ".graph", "ros.json");
  const ros = existsSync(rosFile) ? JSON.parse(readFileSync(rosFile, "utf8")) : null;
  const lastUpdate = existsSync(join(wikiRoot, ".last-update.json")) ? JSON.parse(readFileSync(join(wikiRoot, ".last-update.json"), "utf8")) : null;
  const known = new Set(pages.map((p) => p.path));
  const summary = {
    ...project,
    repoUrl,
    sha,
    pages: pages.length,
    claims: claims.length,
    diagrams: diagrams.length,
    rosNodes: ros ? ros.nodes.length : 0,
    updated: pages.map((p) => p.updated).filter(Boolean).sort().pop() || null,
  };
  mkdirSync(join(OUT, "data"), { recursive: true });
  writeFileSync(
    join(OUT, "data", `${project.id}.json`),
    JSON.stringify({ ...summary, lastUpdate, pageList: pages, diagramList: diagrams, links: edges.filter((e) => known.has(e.target)), ros }, null, 1),
  );
  return summary;
}

rmSync(OUT, { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(join(OUT, "docs"), { recursive: true });

const alerts = [await tokenAlert()].filter(Boolean);
const projects = JSON.parse(readFileSync(join(ROOT, "projects.json"), "utf8"));
const summary = [];
for (const p of projects) {
  try {
    const result = buildProject(p);
    summary.push(result);
    console.log(result.empty ? `○ ${p.id}: ${result.message}` : `✓ ${p.id}: ${result.pages} páginas, ${result.rosNodes} nodos ROS`);
  } catch (err) {
    const { auth, message } = describeError(err, p);
    console.error(`✗ ${p.id}: ${message}`);
    summary.push({ ...p, error: true, auth: Boolean(auth), message });
  }
}
writeFileSync(join(OUT, "projects.json"), JSON.stringify({ builtAt: new Date().toISOString(), alerts, projects: summary }, null, 2));
rmSync(WORK, { recursive: true, force: true });

if (summary.every((p) => p.error)) process.exit(1);
// En CI sin el secret, los repos privados fallan por autenticación: eso solo avisa.
const blocking = summary.filter((p) => p.error && !(p.auth && !TOKEN));
if (STRICT && blocking.length) {
  console.error(`Modo estricto: ${blocking.length} proyecto(s) con error.`);
  process.exit(1);
}
