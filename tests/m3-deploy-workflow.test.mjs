// M3 · comprobaciones estructurales (sin parser YAML) de .github/workflows/deploy-cloudflare.yml,
// del ejemplo para el repo de código (docs/notify-docs-site.cloudflare.yml.example) y del README.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const leer = (p) => {
  const url = new URL(`../${p}`, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8").replace(/\r\n/g, "\n") : null;
};
const WF = ".github/workflows/deploy-cloudflare.yml";
const EJ = "docs/notify-docs-site.cloudflare.yml.example";

// Quita comentarios de línea completa y comentarios finales " # ..." (los YAML de este repo no usan # dentro de cadenas).
const sinComentarios = (y) => y.split("\n").filter((l) => !/^\s*#/.test(l)).map((l) => l.replace(/\s+#\s.*$/, "")).join("\n");
const sangria = (l) => l.match(/^ */)[0].length;

// Bloques `run:` (una línea o `run: |` / `run: >`), con su contenido.
function bloquesRun(y) {
  const lineas = y.split("\n");
  const out = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(\s*)(-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const base = m[1].length + (m[2] ? m[2].length : 0);
    if (/^[|>][-+]?$/.test(m[3].trim())) {
      const cuerpo = [];
      for (let j = i + 1; j < lineas.length && (lineas[j].trim() === "" || sangria(lineas[j]) > base); j++) cuerpo.push(lineas[j]);
      out.push(cuerpo.join("\n"));
    } else out.push(m[3]);
  }
  return out;
}

// Pasos de los jobs: cada elemento de una lista `steps:`.
function pasos(y) {
  const lineas = y.split("\n");
  const out = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!/^\s*steps:\s*$/.test(lineas[i])) continue;
    const base = sangria(lineas[i]);
    let actual = null;
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j];
      if (l.trim() !== "" && sangria(l) <= base) break;
      if (/^\s*-\s/.test(l) && (actual === null || sangria(l) === actual.ind)) {
        actual = { ind: sangria(l), texto: l };
        out.push(actual);
      } else if (actual) actual.texto += `\n${l}`;
    }
  }
  return out.map((p) => p.texto);
}

const wf = () => {
  const y = leer(WF);
  assert.ok(y, `falta ${WF}`);
  return y;
};

test("deploy-cloudflare: push a cloudflare (main comentado) y sin pull_request_target", () => {
  const y = wf();
  const s = sinComentarios(y);
  assert.match(s, /\bpush:\s*\n\s+branches:\s*(\[\s*cloudflare\s*\]|\n\s+-\s*cloudflare\b)/);
  assert.match(y, /#.*\bmain\b/, "main queda comentado para cuando se haga el corte");
  assert.doesNotMatch(s, /branches:[^\n]*\bmain\b|^\s+-\s*main\s*$/m, "main todavía no dispara");
  assert.doesNotMatch(s, /pull_request_target/);
});

test("deploy-cloudflare: workflow_dispatch con input proyecto obligatorio", () => {
  const s = sinComentarios(wf());
  assert.match(s, /workflow_dispatch:\s*\n\s+inputs:\s*\n/);
  assert.match(s, /\n(\s+)proyecto:\s*\n(?:\1\s+.*\n)*?\1\s+required:\s*true\b/, "inputs.proyecto con required: true");
});

test("deploy-cloudflare: repository_dispatch tipo docs-actualizados", () => {
  const s = sinComentarios(wf());
  assert.match(s, /repository_dispatch:\s*\n\s+types:\s*(\[\s*["']?docs-actualizados["']?\s*\]|\n\s+-\s*["']?docs-actualizados["']?)/);
});

test("deploy-cloudflare: concurrency deploy-cloudflare sin cancelar el que está en curso", () => {
  const s = sinComentarios(wf());
  assert.match(s, /^concurrency:\s*\n\s+group:\s*["']?deploy-cloudflare["']?\s*\n\s+cancel-in-progress:\s*false\b/m);
});

test("deploy-cloudflare: permisos mínimos (contents: read) y nada con write", () => {
  const s = sinComentarios(wf());
  assert.match(s, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(s, /:\s*write\b|write-all/);
});

test("deploy-cloudflare: toda acción fijada por SHA de 40 hex", () => {
  const s = sinComentarios(wf());
  const usos = [...s.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(usos.length >= 4);
  for (const u of usos) assert.match(u, /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/, u);
  for (const a of ["actions/checkout", "actions/setup-node", "actions/cache", "cloudflare/wrangler-action"]) {
    assert.ok(usos.some((u) => u.startsWith(`${a}@`)), `usa ${a}`);
  }
});

test("deploy-cloudflare: ningún `${{ }}` dentro de run: (todo pasa por env:)", () => {
  const runs = bloquesRun(sinComentarios(wf()));
  assert.ok(runs.length >= 3);
  for (const r of runs) assert.doesNotMatch(r, /\$\{\{/, `run con interpolación directa: ${r.slice(0, 120)}`);
  assert.doesNotMatch(runs.join("\n"), /set -x|printenv|\benv\s*$/m, "no vuelca variables al log");
});

test("deploy-cloudflare: valida proyecto/sha/remitente antes de cache y build (salvo en push)", () => {
  const ps = pasos(sinComentarios(wf()));
  const iVal = ps.findIndex((p) => p.includes('node tools/proyecto-valido.mjs "$PROYECTO" "$SHA" "$REMITENTE"'));
  assert.ok(iVal >= 0, "paso de validación con las tres variables entre comillas");
  assert.match(ps[iVal], /if:\s*github\.event_name\s*!=\s*'push'/);
  const iCache = ps.findIndex((p) => /uses:\s*actions\/cache@/.test(p));
  const iBuild = ps.findIndex((p) => /run:\s*npm run build\b/.test(p));
  assert.ok(iCache > iVal && iBuild > iVal, "la validación va antes de la caché y del build");
  const s = sinComentarios(wf());
  assert.match(s, /PROYECTO:\s*\$\{\{[^}]*inputs\.proyecto[^}]*client_payload\.proyecto[^}]*\}\}|PROYECTO:\s*\$\{\{[^}]*client_payload\.proyecto[^}]*inputs\.proyecto[^}]*\}\}/);
  assert.match(s, /SHA:\s*\$\{\{[^}]*(inputs\.sha|client_payload\.sha)[^}]*\}\}/);
  assert.match(s, /REMITENTE:\s*\$\{\{\s*github\.event\.sender\.login\s*\}\}/);
});

test("deploy-cloudflare: caché de .content con clave única por ejecución e intento", () => {
  const ps = pasos(sinComentarios(wf()));
  const c = ps.find((p) => /uses:\s*actions\/cache@/.test(p));
  assert.ok(c);
  assert.match(c, /path:\s*\.content\/?/);
  const key = c.match(/key:\s*(.*)/)?.[1] ?? "";
  assert.match(key, /hashFiles\(/, "la clave cambia si cambian projects.json o tools/");
  assert.match(key, /github.run_id/, "clave única por ejecución: una clave exacta repetida restauraría una instantánea vieja");
  assert.match(key, /github.run_attempt/, "y por intento");
  assert.doesNotMatch(key, /env.SHA/, "el sha del disparo no entra en la clave");
  const rk = c.split(/restore-keys:/)[1]?.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== "|")[0] ?? "";
  assert.match(rk, /^content-[$][{][{] hashFiles[(][^)]*[)] [}][}]-$/, "restore-keys conserva el prefijo para tomar la más reciente");
  assert.ok(key.startsWith(rk), "la clave empieza por el prefijo de restore-keys");
});

test("deploy-cloudflare: build con DOCS_GITHUB_TOKEN y DOCS_SOLO_PROYECTO, después de npm ci", () => {
  const ps = pasos(sinComentarios(wf()));
  const iCi = ps.findIndex((p) => /run:\s*npm ci\b/.test(p));
  const iBuild = ps.findIndex((p) => /run:\s*npm run build\b/.test(p));
  assert.ok(iCi >= 0 && iBuild > iCi);
  const b = ps[iBuild];
  assert.match(b, /DOCS_GITHUB_TOKEN:\s*\$\{\{\s*secrets\.DOCS_GITHUB_TOKEN\s*\}\}/);
  assert.match(b, /DOCS_SOLO_PROYECTO:\s*\$\{\{\s*env\.PROYECTO\s*\}\}/);
  assert.match(sinComentarios(wf()), /node-version:\s*["']?26["']?/);
});

test("deploy-cloudflare: guarda de secrets → ::warning:: y salida, sin fallar", () => {
  const ps = pasos(sinComentarios(wf()));
  const g = ps.find((p) => /secrets\.CLOUDFLARE_API_TOKEN/.test(p) && /secrets\.CLOUDFLARE_ACCOUNT_ID/.test(p) && /::warning::/.test(p));
  assert.ok(g, "un paso lee ambos secrets por env: y avisa con ::warning:: si falta alguno");
  assert.match(g, /\bid:\s*[\w-]+/);
  assert.match(g, /GITHUB_OUTPUT/);
  assert.doesNotMatch(g, /exit 1|continue-on-error/, "sin secrets termina en verde");
});

test("deploy-cloudflare: wrangler-action deploy solo si la guarda lo permite", () => {
  const ps = pasos(sinComentarios(wf()));
  const iW = ps.findIndex((p) => /uses:\s*cloudflare\/wrangler-action@/.test(p));
  const iBuild = ps.findIndex((p) => /run:\s*npm run build\b/.test(p));
  assert.ok(iW > iBuild, "despliega después del build");
  const w = ps[iW];
  assert.match(w, /if:\s*.*steps\.[\w-]+\.outputs\.[\w-]+\s*==\s*'true'/);
  assert.match(w, /command:\s*deploy\s*$/m);
  assert.match(w, /apiToken:\s*\$\{\{\s*secrets\.CLOUDFLARE_API_TOKEN\s*\}\}/);
  assert.match(w, /accountId:\s*\$\{\{\s*secrets\.CLOUDFLARE_ACCOUNT_ID\s*\}\}/);
});

test("ejemplo notify: workflow_dispatch del deploy con proyecto y sha, token por env:", () => {
  const y = leer(EJ);
  assert.ok(y, `falta ${EJ}`);
  const s = sinComentarios(y);
  assert.match(s, /\bpush:\s*\n\s+branches:\s*(\[\s*main\s*\]|\n\s+-\s*main\b)/);
  assert.match(s, /paths:[\s\S]*openwiki\/\*\*/);
  assert.match(s, /workflow_dispatch:\s*\n\s+inputs:\s*\n/);
  assert.match(s, /\n(\s+)proyecto:\s*\n(?:\1\s+.*\n)*?\1\s+required:\s*true\b/);
  assert.match(s, /GH_TOKEN:\s*\$\{\{\s*secrets\.DOCS_SITE_DISPATCH_TOKEN\s*\}\}/);
  assert.match(s, /repos\/cyuxSz\/docs-site-lab\/actions\/workflows\/deploy-cloudflare\.yml\/dispatches/);
  assert.match(s, /inputs\[proyecto\]/);
  assert.match(s, /inputs\[sha\]/);
  for (const r of bloquesRun(s)) assert.doesNotMatch(r, /\$\{\{/, r.slice(0, 120));
  assert.match(s, /^permissions:\s*(\{\s*\}|\n\s+contents:\s*read\s*)$/m);
  for (const m of s.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/);
  assert.match(y, /#.*Actions.*(write|escritura)/i, "explica el permiso del token fine-grained");
});

test("README: sección de despliegue en Cloudflare con el comando por proyecto", () => {
  const r = leer("README.md");
  const i = r.search(/^## Despliegue en Cloudflare/m);
  assert.ok(i >= 0, "falta la sección ## Despliegue en Cloudflare");
  const sec = r.slice(i).split(/\n## /)[0];
  for (const t of ["deploy-cloudflare.yml", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "DOCS_SOLO_PROYECTO", "editoresDocs", "DOCS_SITE_DISPATCH_TOKEN", "notify-docs-site.cloudflare.yml.example"]) {
    assert.ok(sec.includes(t), `menciona ${t}`);
  }
  assert.match(sec, /gh workflow run deploy-cloudflare\.yml[^\n]*-f proyecto=uuv/);
});
