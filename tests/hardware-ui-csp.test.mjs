// Lote 1b (revisado al quitar Vercel): CSP de las páginas. El navegador sube los archivos al propio Worker
// (POST /api/archivos/, mismo origen), así que connect-src es solo 'self': ya no hace falta https://vercel.com/api/blob/.
// Las imágenes van por el proxy /api/archivos/ (mismo origen). Se fija la lista exacta de directivas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const config = (await import("../astro.config.mjs")).default;

test("CSP: directivas exactas; connect-src es solo 'self' (sin https://vercel.com/api/blob/)", () => {
  assert.deepEqual(config.security.csp.directives, [
    "default-src 'self'",
    "img-src 'self' data: blob:", // C15 (d1b): iconos de zoom de KiCanvas
    "connect-src 'self'",
    "frame-src 'self' https://embed.diagrams.net", // D1a: 'self' para el visor de PDF; C1: iframe de diagrams.net (ver tests/c1-diagramas-csp.test.mjs)
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]);
});

test("CSP: sin comodines, sin worker-src ni hosts de almacenamiento; scripts y estilos sin cambios", () => {
  const csp = config.security.csp;
  const todo = JSON.stringify(csp);
  assert.doesNotMatch(todo, /\*|vercel|blob\.vercel-storage\.com|worker-src/);
  // C15 (d1b): blob: solo en img-src (iconos de KiCanvas).
  assert.deepEqual(csp.directives.filter((d) => /blob:/.test(d)), ["img-src 'self' data: blob:"]);
  assert.doesNotMatch(JSON.stringify([csp.scriptDirective, csp.styleDirective]), /blob:/);
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.equal(csp.scriptDirective.hashes.length, 1, "solo el hash del tema");
  assert.match(leer("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
});

test("Worker: la cabecera CSP global no define connect-src ni default-src (manda la del <meta>)", () => {
  const src = leer("worker/index.mjs");
  const globales = src.match(/"Content-Security-Policy":\s*"([^"]+)"/);
  assert.ok(globales, "el Worker fija una CSP global");
  assert.doesNotMatch(globales[1], /connect-src|default-src/);
  const sandbox = src.match(/const SANDBOX = "([^"]+)"/);
  assert.ok(sandbox, "CSP sandbox de /arch/");
  assert.doesNotMatch(sandbox[1], /connect-src|default-src/);
});
