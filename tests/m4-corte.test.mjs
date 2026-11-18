// M4 · corte a Cloudflare: producción despliega desde `main` (una sola fuente), CodeRabbit revisa PR contra `main`,
// el aviso de los repos de código apunta a `main` y el README lo cuenta, con Vercel de respaldo una semana.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const leer = (p) => {
  const url = new URL(`../${p}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8").replace(/\r\n/g, "\n") : null;
};
const WF = ".github/workflows/deploy-cloudflare.yml";
const CR = ".coderabbit.yaml";
const EJ = "docs/notify-docs-site.cloudflare.yml.example";

const sinComentarios = (y) => y.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#\s.*$/, "")).join("\n");
const sangria = (l) => l.match(/^ */)[0].length;

// Valores de una lista YAML `clave:` (forma en bloque `- x` o en línea `[x, y]`), sin comillas.
function lista(y, clave) {
  const lineas = y.split("\n");
  const i = lineas.findIndex((l) => new RegExp(`^\\s*${clave}:`).test(l));
  if (i < 0) return null;
  const enLinea = lineas[i].match(/:\s*\[(.*)\]\s*$/);
  const limpiar = (v) => v.trim().replace(/^["']|["']$/g, "");
  if (enLinea) return enLinea[1].split(",").map(limpiar).filter(Boolean);
  const base = sangria(lineas[i]);
  const out = [];
  for (let j = i + 1; j < lineas.length; j++) {
    const l = lineas[j];
    if (l.trim() === "") continue;
    if (sangria(l) <= base && !/^\s*-\s/.test(l)) break;
    const m = l.match(/^\s*-\s*(.+)$/);
    if (!m) break;
    out.push(limpiar(m[1]));
  }
  return out;
}

// Bloque `push:` de `on:` (hasta el siguiente disparador con la misma sangría).
function bloquePush(s) {
  const lineas = s.split("\n");
  const i = lineas.findIndex((l) => /^\s+push:\s*$/.test(l));
  assert.ok(i >= 0, "el workflow tiene un disparador push");
  const base = sangria(lineas[i]);
  const out = [lineas[i]];
  for (let j = i + 1; j < lineas.length && (lineas[j].trim() === "" || sangria(lineas[j]) > base); j++) out.push(lineas[j]);
  return out.join("\n");
}

const wf = () => {
  const y = leer(WF);
  assert.ok(y, `falta ${WF}`);
  return y;
};

test("deploy-cloudflare: push solo a main (una sola fuente de producción)", () => {
  const ramas = lista(bloquePush(sinComentarios(wf())), "branches");
  assert.deepEqual(ramas, ["main"], "push.branches debe ser exactamente [main]");
});

test("deploy-cloudflare: sin el comentario pendiente de M4 y sin pull_request/pull_request_target", () => {
  const y = wf();
  assert.doesNotMatch(y, /Tras el corte/i, "el comentario «Tras el corte (M4)» ya no aplica");
  assert.doesNotMatch(sinComentarios(y), /\bpull_request(_target)?\b/);
});

test("deploy-cloudflare: workflow_dispatch y repository_dispatch siguen igual", () => {
  const s = sinComentarios(wf());
  assert.match(s, /workflow_dispatch:\s*\n\s+inputs:\s*\n/);
  assert.match(s, /\n(\s+)proyecto:\s*\n(?:\1\s+.*\n)*?\1\s+required:\s*true\b/);
  assert.match(s, /repository_dispatch:\s*\n\s+types:\s*(\[\s*["']?docs-actualizados["']?\s*\]|\n\s+-\s*["']?docs-actualizados["']?)/);
});

test("deploy-cloudflare: permisos solo contents: read y ningún secret nuevo", () => {
  const s = sinComentarios(wf());
  assert.match(s, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(s, /:\s*write\b/);
  const secrets = new Set([...s.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...secrets].sort(), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "DOCS_GITHUB_TOKEN"]);
});

test(".coderabbit.yaml: base_branches incluye main y factory/.*", () => {
  const y = leer(CR);
  assert.ok(y, `falta ${CR}`);
  const ramas = lista(sinComentarios(y), "base_branches");
  assert.ok(ramas, "falta reviews.auto_review.base_branches");
  assert.ok(ramas.includes("main"), `base_branches debe incluir main (hoy: ${ramas.join(", ")})`);
  assert.ok(ramas.includes("factory/.*"), "base_branches conserva factory/.*");
});

test("ejemplo notify: el aviso dispara el deploy en la rama main del portal", () => {
  const y = leer(EJ);
  assert.ok(y, `falta ${EJ}`);
  const s = sinComentarios(y);
  assert.match(s, /RAMA_PORTAL:\s*["']?main["']?\s*$/m, "RAMA_PORTAL debe ser main");
  assert.doesNotMatch(s, /\bcloudflare\s*$/m, "ninguna rama `cloudflare` como destino");
});

test("README: producción despliega desde main; cloudflare ya no es la rama de despliegue", () => {
  const r = leer("README.md");
  assert.ok(r, "falta README.md");
  const intro = r.split("\n").find((l) => l.startsWith("Sitio que junta"));
  assert.ok(intro, "falta el párrafo de introducción");
  assert.match(intro, /rama `main`/, "la intro dice que producción sale de `main`");
  assert.doesNotMatch(intro, /rama `cloudflare`/, "la intro ya no da `cloudflare` como rama de producción");
  assert.doesNotMatch(r, /push a la rama `cloudflare`/, "ningún push a `cloudflare` despliega");
  assert.doesNotMatch(r, /comentado hasta M4/);
  assert.doesNotMatch(r, /--ref cloudflare/);

  const i = r.search(/^## Despliegue en Cloudflare/m);
  assert.ok(i >= 0, "falta la sección ## Despliegue en Cloudflare");
  const sec = r.slice(i).split(/\n## /)[0];
  assert.match(sec, /push a (la rama )?`main`/, "la sección dice que se despliega con push a `main`");
});

test("README: describe solo Cloudflare, sin respaldo en Vercel, Blob, Upstash ni Deploy Hook", () => {
  const r = leer("README.md");
  assert.ok(r.search(/^## Despliegue en Cloudflare/m) >= 0, "falta la sección ## Despliegue en Cloudflare");
  assert.doesNotMatch(r, /respaldo/i, "no hay apartado de respaldo");
  for (const re of [/vercel/i, /\bblob\b/i, /upstash/i, /deploy hook/i, /PREVIEW_TRUST_VERCEL_AUTH/, /KV_REST_API/, /BLOB_READ_WRITE_TOKEN/]) {
    assert.doesNotMatch(r, re, `el README no menciona ${re}`);
  }
});
