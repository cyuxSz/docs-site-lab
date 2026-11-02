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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { walk, leerDentro } from "./archivos.mjs";
import { citasDe, extraerLineas } from "./citas.mjs";
import { clasificarError, limpiarControl } from "./estado.mjs";
import { marcarGlosario, parseGlosario } from "./glosario.mjs";
import { historial } from "./historial.mjs";
import { neutralizeHtml, statusBadges } from "./neutralizar.mjs";
import { pageRoute, parseRutas } from "./rutas.mjs";
import { corregirH1, tituloPagina } from "./titulos.mjs";

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
    const out = git(["-C", dir, "log", "-1", "--format=%cI|%H|%an", "--", path]);
    if (!out) return {};
    const [date, commit, ...author] = out.split("|");
    return { date, commit, author: author.join("|") };
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

// Vista previa de citas: lee cada archivo citado una sola vez con `git show <sha>:<ruta>` (en el clon parcial baja el
// blob bajo demanda) y guarda solo las líneas citadas. Un archivo que no se puede leer deja su cita sin vista previa.
const MAX_BYTES = 512 * 1024;
const MAX_CITAS = 500;
function leerCitas(dir, sha, citas) {
  const porArchivo = new Map();
  const unicas = [...new Map(citas.map((c) => [c.key, c])).values()];
  for (const c of unicas.slice(0, MAX_CITAS)) porArchivo.set(c.file, [...(porArchivo.get(c.file) ?? []), c]);
  const out = {};
  for (const [file, lista] of porArchivo) {
    try {
      const texto = execFileSync("git", ["-C", dir, "show", `${sha}:${file}`], {
        encoding: "utf8",
        maxBuffer: MAX_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      for (const c of lista) {
        const r = extraerLineas(texto, c.start, c.end);
        if (r) out[c.key] = r;
      }
    } catch {
      // Archivo ausente, binario o más grande que el tope: la cita queda como enlace normal.
    }
  }
  return out;
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

  // Toda lectura del checkout pasa por leerDentro(dir, ...): ignora symlinks y rutas que se salgan del clon.
  const claimsTxt = leerDentro(dir, join(wikiRoot, ".claims", "claims.json"));
  const claims = claimsTxt !== null ? JSON.parse(claimsTxt).claims : [];
  const claimsByPage = {};
  for (const c of claims) claimsByPage[c.page] = (claimsByPage[c.page] || 0) + 1;

  const glosarioTxt = leerDentro(dir, join(wikiRoot, "glosario.md"));
  const glosario = glosarioTxt !== null ? parseGlosario(splitFrontmatter(glosarioTxt).body) : [];
  const pages = [];
  const edges = [];
  const citas = [];
  for (const file of walk(wikiRoot, dir)) {
    const rel = toPosix(relative(wikiRoot, file));
    if (rel.startsWith(".") || !rel.endsWith(".md")) continue;
    const contenido = leerDentro(dir, file);
    if (contenido === null) continue;
    const { fields, body } = splitFrontmatter(contenido);
    const links = new Set();
    const title = tituloPagina(fields, body, rel);
    const linked = rewriteLinks(statusBadges(neutralizeHtml(corregirH1(body, title, rel))), project.id, rel, repoUrl, sha, links);
    citas.push(...citasDe(linked, repoUrl, sha));
    // Tooltips del glosario (después de neutralizeHtml: el <abbr> lo genera el portal). El glosario no se marca a sí mismo.
    const text = rel === "glosario.md" ? linked : marcarGlosario(linked, glosario);
    const { date, commit, author } = lastChange(dir, `openwiki/${rel}`);
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
      commit: commit || null,
      historial: historial(dir, `openwiki/${rel}`, { repoUrl }),
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
  for (const file of walk(archDir, dir)) {
    const name = relative(archDir, file);
    if (name.includes(sep) || !name.endsWith(".html")) continue;
    const html = leerDentro(dir, file);
    if (html === null) continue;
    const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || name).replace(/\s*·\s*Diagrama$/, "");
    mkdirSync(join(OUT, "arch", project.id), { recursive: true });
    writeFileSync(join(OUT, "arch", project.id, name), html);
    diagrams.push({ file: `/${project.id}/arch/${name}`, title, kb: Math.round(html.length / 1024) });
  }

  if (!pages.length && !diagrams.length) {
    // Repo sin documentación en esta rama: lo dice en la portada y sugiere ramas docs/* sin mergear.
    let pending = [];
    try {
      pending = git(["-C", dir, "ls-remote", "--heads", "origin", "docs/*"]).split("\n").filter(Boolean).map((l) => l.split("refs/heads/")[1]);
    } catch {}
    return { ...project, empty: true, causa: "vacio", ramas: pending };
  }

  const rosTxt = leerDentro(dir, join(wikiRoot, ".graph", "ros.json"));
  const ros = rosTxt !== null ? JSON.parse(rosTxt) : null;
  const lastTxt = leerDentro(dir, join(wikiRoot, ".last-update.json"));
  const lastUpdate = lastTxt !== null ? JSON.parse(lastTxt) : null;
  const known = new Set(pages.map((p) => p.path));
  // Rutas por rol: solo si la wiki trae rutas.md con pasos válidos; los pasos inválidos avisan y se ignoran.
  const rutasTxt = leerDentro(dir, join(wikiRoot, "rutas.md"));
  const { rutas, avisos } = rutasTxt !== null
    ? parseRutas(splitFrontmatter(rutasTxt).body, { project: project.id, pages: pages.map((p) => p.path) })
    : { rutas: [], avisos: [] };
  for (const a of avisos) console.warn(`⚠ ${project.id}: ${limpiarControl(a)}`);
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
    JSON.stringify({ ...summary, lastUpdate, pageList: pages, diagramList: diagrams, links: edges.filter((e) => known.has(e.target)), ros, citas: leerCitas(dir, sha, citas), ...(rutas.length ? { rutas } : {}) }, null, 1),
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
    console.log(result.empty ? `○ ${p.id}: sin openwiki/ ni docs/arch/ en ${p.branch}` : `✓ ${p.id}: ${result.pages} páginas, ${result.rosNodes} nodos ROS`);
  } catch (err) {
    const causa = clasificarError(err, { token: Boolean(TOKEN) });
    const linea = hideToken(err instanceof Error ? err.message : String(err)).split(/\r?\n/).find((l) => l.trim()) ?? "";
    console.error(`✗ ${p.id} (${causa}): ${limpiarControl(linea).slice(0, 240) || "error desconocido"}`);
    summary.push({ ...p, error: true, auth: causa === "sin-token" || causa === "sin-acceso", causa });
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
