// Lote "quitar Vercel": el portal corre solo en Cloudflare (Worker `docs`, D1 y R2). Este test falla si reaparece
// cualquier rastro de Vercel, Upstash o Vercel Blob: archivos propios de Vercel, dependencias @vercel/* o @upstash/*,
// variables de esos servicios o la palabra Vercel/Upstash en el código y la documentación (fuera de tests/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const leer = (rel) => readFileSync(join(raiz, rel), "utf8");
const existe = (rel) => existsSync(join(raiz, rel));

// Carpetas que no son del repo (dependencias, salidas, contenido traído de otros repos, estado local) o son tests.
const EXCLUIR_DIRS = new Set(["node_modules", ".git", "dist", ".wrangler", ".factory", ".content", ".astro", ".build", "tests"]);
// Archivos locales no versionados (.env*, .dev.vars) y el lock (unstorage declara @vercel/* y @upstash/* como peers opcionales).
const EXCLUIR_ARCHIVOS = /^(\.env.*|\.dev\.vars|package-lock\.json)$/;
const BINARIO = /\.(png|jpe?g|webp|ico|gif|woff2?|ttf|otf|glb|pdf|zip)$/i;

function archivosDelRepo(dir = raiz, out = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    const st = statSync(ruta);
    if (st.isDirectory()) {
      if (!EXCLUIR_DIRS.has(nombre)) archivosDelRepo(ruta, out);
    } else if (!EXCLUIR_ARCHIVOS.test(nombre) && !BINARIO.test(nombre)) {
      out.push(relative(raiz, ruta).split(sep).join("/"));
    }
  }
  return out;
}

test("no existen vercel.json, middleware.js, api/ ni .vercel/", () => {
  for (const rel of ["vercel.json", "middleware.js", "api", ".vercel"]) assert.ok(!existe(rel), `${rel} debe borrarse`);
});

test("no existen las herramientas ni los fixtures de Upstash y Vercel", () => {
  for (const rel of ["tools/upstash-local.mjs", "tools/migrar-upstash-d1.mjs", "tests/migrar-upstash-d1.test.mjs", "tests/middleware.test.mjs", "tests/fixtures/redis-memoria.mjs", "tests/fixtures/servidor-hardware.mjs"]) {
    assert.ok(!existe(rel), `${rel} debe borrarse`);
  }
});

test("package.json: ninguna dependencia @vercel/* ni @upstash/*", () => {
  const pkg = JSON.parse(leer("package.json"));
  for (const campo of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = Object.keys(pkg[campo] ?? {});
    assert.deepEqual(deps.filter((d) => /^@(vercel|upstash)\//.test(d)), [], `${campo} con paquetes de Vercel o Upstash`);
  }
  assert.doesNotMatch(JSON.stringify(pkg.scripts ?? {}), /vercel|upstash/i, "scripts sin Vercel ni Upstash");
});

test("package-lock.json: sin paquetes @vercel/* ni @upstash/* instalados y la raíz coincide con package.json", () => {
  const lock = JSON.parse(leer("package-lock.json"));
  const instalados = Object.keys(lock.packages ?? {}).filter((k) => /(^|\/)node_modules\/@(vercel|upstash)\//.test(k));
  assert.deepEqual(instalados, [], "el lock aún instala paquetes de Vercel o Upstash");
  const raizLock = lock.packages?.[""] ?? {};
  for (const campo of ["dependencies", "devDependencies"]) {
    assert.deepEqual(Object.keys(raizLock[campo] ?? {}).filter((d) => /^@(vercel|upstash)\//.test(d)), [], `lock: ${campo} de la raíz`);
  }
});

test("ningún archivo del repo fuera de tests/ menciona Vercel ni Upstash", () => {
  const conRastro = [];
  for (const rel of archivosDelRepo()) {
    const texto = leer(rel);
    const lineas = texto.split(/\r?\n/);
    lineas.forEach((l, i) => {
      if (/vercel|upstash/i.test(l)) conRastro.push(`${rel}:${i + 1}: ${l.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(conRastro, [], `rastros de Vercel/Upstash:\n${conRastro.join("\n")}`);
});

test("ningún archivo del repo fuera de tests/ usa las variables de Upstash, Vercel Blob o los Preview de Vercel", () => {
  const VARS = /\b(KV_REST_API_URL|KV_REST_API_TOKEN|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN|BLOB_READ_WRITE_TOKEN|VERCEL_ENV|PREVIEW_TRUST_VERCEL_AUTH|x-vercel-signature)\b/;
  const conVars = archivosDelRepo().filter((rel) => VARS.test(leer(rel)));
  assert.deepEqual(conVars, []);
});

test("el código no importa paquetes de Vercel ni de Upstash (también imports dinámicos)", () => {
  const codigo = archivosDelRepo().filter((rel) => /\.(m?js|ts|tsx|astro|jsonc?)$/.test(rel));
  const malos = codigo.filter((rel) => /from\s+["']@(vercel|upstash)\/|import\(\s*["']@(vercel|upstash)\//.test(leer(rel)));
  assert.deepEqual(malos, []);
});

test("CI (build.yml): el paso de sintaxis no comprueba middleware.js ni api/ (borrados) y sigue comprobando el Worker y lib/", () => {
  const y = leer(".github/workflows/build.yml");
  assert.doesNotMatch(y, /middleware\.js|\bapi\//, "build.yml no puede referirse a archivos borrados");
  const paso = y.slice(y.indexOf("name: Sintaxis"), y.indexOf("name: Build"));
  assert.match(paso, /node --check/);
  assert.match(paso, /tools\/\*\.mjs/);
  assert.match(paso, /worker\/index\.mjs/);
  assert.match(paso, /lib\/login-core\.mjs/);
});

test(".gitignore: sin la entrada .vercel; conserva lo de Cloudflare y los .env", () => {
  const lineas = leer(".gitignore").split(/\r?\n/).map((l) => l.trim());
  assert.ok(!lineas.some((l) => /^\/?\.vercel\/?$/.test(l)), ".vercel ya no se ignora");
  for (const l of [".dev.vars", ".wrangler/", ".env*", "node_modules/", "dist/"]) assert.ok(lineas.includes(l), `falta ${l}`);
});

test(".coderabbit.yaml: auto_review solo para main y factory/*; la rama cloudflare ya no", () => {
  const y = leer(".coderabbit.yaml");
  const i = y.indexOf("base_branches:");
  assert.ok(i >= 0, "falta reviews.auto_review.base_branches");
  const ramas = [];
  for (const l of y.slice(i).split(/\r?\n/).slice(1)) {
    const m = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/.exec(l);
    if (!m) break;
    ramas.push(m[1]);
  }
  assert.deepEqual(ramas, ["main", "factory/.*"]);
  assert.doesNotMatch(y, /\bcloudflare\b/, "sin referencias a la rama cloudflare");
});

test("estado del build: los pasos indican GitHub Actions (secret y workflow deploy-cloudflare), nunca Vercel", async () => {
  const { tarjetaEstado, CAUSAS } = await import("../tools/estado.mjs");
  const p = { id: "uuv", repo: "vanttec/uuv_software", branch: "main", ramas: ["docs/x"] };
  for (const causa of CAUSAS) {
    const t = tarjetaEstado({ ...p, causa, empty: causa === "vacio" }, "2026-11-17T12:00:00Z");
    const texto = JSON.stringify(t);
    assert.doesNotMatch(texto, /vercel/i, causa);
    assert.match(texto, /deploy-cloudflare/, `${causa}: dice qué workflow volver a lanzar o revisar`);
  }
  for (const causa of ["sin-token", "sin-acceso"]) {
    const texto = JSON.stringify(tarjetaEstado({ ...p, causa }, "2026-11-17T12:00:00Z"));
    assert.match(texto, /secret/i, `${causa}: DOCS_GITHUB_TOKEN es un secret de GitHub Actions`);
    assert.match(texto, /DOCS_GITHUB_TOKEN/);
  }
});

test("fetch: los avisos del token dicen dónde actualizarlo (secret de GitHub Actions), no Vercel", () => {
  const src = leer("tools/fetch.mjs");
  assert.doesNotMatch(src, /vercel/i);
  const avisos = src.match(/DOCS_GITHUB_TOKEN (ya no es válido|caduca el)[^`"]*/g) ?? [];
  assert.equal(avisos.length, 2, "los dos avisos del token siguen existiendo");
  for (const a of avisos) assert.match(a, /secret/i, a);
});
