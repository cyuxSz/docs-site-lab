// C1: CSP para los editores de diagramas.
// - La CSP de las páginas va en <meta> (astro.config.mjs) y está dentro de dist/, así que la sirve tal cual el
//   Worker de Cloudflare. Se añade solo `frame-src https://embed.diagrams.net` (diagrams.net en iframe). D1a añade 'self' en
//   frame-src para el visor de PDF (/api/archivos); las páginas propias siguen sin poder enmarcarse (frame-ancestors 'none').
// - Excalidraw no necesita nada nuevo: sus fuentes se sirven desde este origen (EXCALIDRAW_ASSET_PATH, 'self') y el SVG se
//   exporta sin incrustar fuentes, así que no corre el subsetting WASM/embind (que usa new Function → 'unsafe-eval') ni su
//   Worker. Prohibido 'unsafe-eval', comodines y CDNs.
// - La cabecera CSP global del Worker no define frame-src/child-src/default-src: si lo hiciera, se intersecaría con el
//   <meta> y bloquearía el iframe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const config = (await import("../astro.config.mjs")).default;
const DIRECTIVAS = [
  "default-src 'self'",
  "img-src 'self' data: blob:", // C15: iconos de zoom de KiCanvas (blob:)
  "connect-src 'self'",
  "frame-src 'self' https://embed.diagrams.net", // D1a: 'self' para el visor de PDF
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

// Política efectiva tal como la vería el navegador: { directiva: [fuentes] }.
function politica(directivas) {
  const p = {};
  for (const d of directivas) {
    const [nombre, ...fuentes] = d.trim().split(/\s+/);
    p[nombre.toLowerCase()] = fuentes;
  }
  return p;
}
// ¿Permite la política cargar en un iframe esta URL? (frame-src → child-src → default-src, solo orígenes y 'self').
function permiteFrame(p, url, origenPagina) {
  const lista = p["frame-src"] ?? p["child-src"] ?? p["default-src"];
  if (!lista) return true;
  const u = new URL(url);
  return lista.some((f) => (f === "'self'" ? u.origin === origenPagina : f === "*" ? true : /^https?:\/\//.test(f) && new URL(f).origin === u.origin));
}

test("<meta> CSP: directivas exactas, con frame-src solo para el propio origen y embed.diagrams.net", () => {
  assert.deepEqual(config.security.csp.directives, DIRECTIVAS);
});

test("<meta> CSP: se permiten el iframe de diagrams.net y el propio origen (PDF); otros orígenes no", () => {
  const p = politica(config.security.csp.directives);
  const pagina = "https://docs-site-lab.ejemplo.workers.dev";
  assert.equal(permiteFrame(p, "https://embed.diagrams.net/?embed=1&proto=json", pagina), true);
  assert.equal(permiteFrame(p, `${pagina}/api/archivos/?proyecto=uuv&id=x`, pagina), true, "D1a: PDF del propio origen");
  // Las páginas propias (p. ej. /uuv/arch/x.html) las bloquea su frame-ancestors 'none', no el frame-src.
  for (const u of ["https://app.diagrams.net/", "https://evil.example/", "http://embed.diagrams.net/"]) assert.equal(permiteFrame(p, u, pagina), false, u);
});

test("<meta> CSP: sin 'unsafe-eval', sin comodines, sin CDNs; scripts y estilos sin cambios", () => {
  const csp = config.security.csp;
  const todo = JSON.stringify(csp);
  assert.doesNotMatch(todo, /'unsafe-eval'|\*|esm\.sh|unpkg|jsdelivr|worker-src/);
  // C15 (d1b): blob: solo en img-src (iconos de KiCanvas), en ninguna otra directiva.
  assert.deepEqual(csp.directives.filter((d) => /blob:/.test(d)), ["img-src 'self' data: blob:"]);
  assert.doesNotMatch(JSON.stringify([csp.scriptDirective, csp.styleDirective]), /blob:/);
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
  const p = politica(csp.directives);
  assert.equal(p["font-src"], undefined, "las fuentes de Excalidraw salen de default-src 'self'");
});

const DIRECTIVAS_DE_CARGA = /(^|;)\s*(default-src|frame-src|child-src|script-src|style-src|font-src|connect-src|img-src)\b/i;

test("Worker: la CSP global de las páginas no restringe la carga (no tapa el frame-src del <meta>) y conserva frame-ancestors", async () => {
  const worker = (await import("../worker/index.mjs")).default;
  const env = {
    SESSION_SECRET: "x".repeat(40),
    GITHUB_CLIENT_ID: "a",
    GITHUB_CLIENT_SECRET: "b",
    ALLOWED_ORG: "vanttec",
    ASSETS: { fetch: async () => new Response("<h1>x</h1>", { headers: { "content-type": "text/html" } }) },
  };
  // Sin sesión el login responde (redirección o página propia); en ambos casos la cabecera CSP es la global.
  const res = await worker.fetch(new Request("https://docs.example/uuv/electronica/"), env, { waitUntil() {} });
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, DIRECTIVAS_DE_CARGA);
});

test("la CSP de carga viene del <meta> de dist/, no de cabeceras propias del Worker", () => {
  // Si alguien añade frame-src al Worker en vez de al <meta>, se intersecaría con el <meta>.
  const w = leer("worker/index.mjs");
  assert.doesNotMatch(w, /embed\.diagrams\.net/, "el Worker no lleva su propia lista de frames");
  assert.match(leer("astro.config.mjs"), /frame-src 'self' https:\/\/embed\.diagrams\.net/);
});
