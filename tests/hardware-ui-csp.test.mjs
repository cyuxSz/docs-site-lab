// Lote 1b: CSP mínima para la subida directa del navegador a Vercel Blob. upload() de @vercel/blob/client manda el
// archivo a https://vercel.com/api/blob/ (PUT /?pathname=…, y /mpu… en multipart); no usa Workers ni lee del host
// *.blob.vercel-storage.com (las imágenes van por el proxy /api/archivos/). Se fija la lista exacta de directivas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const config = (await import("../astro.config.mjs")).default;

test("CSP: directivas exactas; connect-src solo añade https://vercel.com/api/blob/ (con barra final: prefijo de ruta)", () => {
  assert.deepEqual(config.security.csp.directives, [
    "default-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://vercel.com/api/blob/",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]);
});

test("CSP: sin comodines, sin worker-src ni hosts de almacenamiento; scripts y estilos sin cambios", () => {
  const csp = config.security.csp;
  const todo = JSON.stringify(csp);
  assert.doesNotMatch(todo, /\*|blob\.vercel-storage\.com|worker-src|blob:/);
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.equal(csp.scriptDirective.hashes.length, 1, "solo el hash del tema");
  assert.match(leer("astro.config.mjs"), /hashes:\s*\[\s*temaHash\s*\]/);
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
});

test("@vercel/blob instalado sigue usando https://vercel.com/api/blob como API (si cambia, revisar la CSP)", () => {
  const pkg = JSON.parse(leer("node_modules/@vercel/blob/package.json"));
  assert.equal(pkg.version, "2.8.2");
  const dist = readFileSync(new URL("../node_modules/@vercel/blob/dist/" + leer("node_modules/@vercel/blob/dist/client.js").match(/from\s+["']\.\/(chunk-[A-Z0-9]+\.js)["']/)[1], import.meta.url), "utf8");
  assert.match(dist, /defaultVercelBlobApiUrl = "https:\/\/vercel\.com\/api\/blob"/);
  assert.doesNotMatch(dist, /new Worker\(/, "upload() no crea Workers: no hace falta worker-src");
});

test("vercel.json: la cabecera CSP global no define connect-src (manda la del <meta>)", () => {
  const v = JSON.parse(leer("vercel.json"));
  for (const h of v.headers ?? []) for (const x of h.headers) if (/content-security-policy/i.test(x.key)) assert.doesNotMatch(x.value, /connect-src|default-src/);
});
