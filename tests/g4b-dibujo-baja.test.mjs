// G4b · arreglos BAJA de la revisión de G4a en la CLI vanttec-dibujo:
// (a) `salir` solo con la variable de entorno no habla de borrar un archivo;
// (b) login, id y nombre que vienen del portal se imprimen sin caracteres de control, ANSI ni bidi;
// (c) mensajeHttp no refleja nada con pinta de token del `error` del servidor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { usarPortal, responder, TOKEN, OTRO } from "./fixtures/g4b-portal.mjs";

const ctx = usarPortal("g4b-baja-");

const DRAWIO = '<mxfile host="test"><diagram id="a" name="P">x</diagram></mxfile>\n';
const OPC = ["--proyecto", "uuv", "--disciplina", "electronica"];
// Todo lo de C0 y C1 salvo el salto de línea, más los controles de dirección (bidi) de Unicode.
const RAROS = /[\x00-\x09\x0b-\x1f\x7f-\x9f؜‎‏‪-‮⁦-⁩]/;
const SUCIO = "ana\x1b[31m‮roja\x07\r\n\x1b]0;titulo\x07⁦x⁩\x9b";

const revocar200 = (req, res) =>
  req.path === "/auth/app/revocar" ? responder(res, 200, { ok: true }) : responder(res, 404, { error: "No encontrado" });

// ---------- (a) salir ----------
test("(a) salir solo con VANTTEC_DIBUJO_TOKEN: revoca y no dice que borró un archivo", async () => {
  ctx.atender = revocar200;
  const r = await ctx.ejecutar(["salir"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(ctx.peticiones.length, 1);
  assert.match(r.stdout, /revocado/i);
  assert.doesNotMatch(r.stdout, /archivo/i, "no había archivo que borrar");
  assert.match(r.stdout + r.stderr, /VANTTEC_DIBUJO_TOKEN/, "recuerda quitar la variable");
});

test("(a) salir con archivo sigue diciendo que lo borró", async () => {
  ctx.guardarArchivo(OTRO);
  ctx.atender = revocar200;
  const r = await ctx.ejecutar(["salir"]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /revocado/i);
  assert.match(r.stdout, /archivo borrado/i);
  assert.equal(existsSync(ctx.rutaArchivo()), false);
});

// ---------- (b) impresión sin caracteres de control ----------
test("(b) entrar y estado imprimen el login sin control, ANSI ni bidi", async () => {
  ctx.atender = (req, res) => (req.path === "/auth/me" ? responder(res, 200, { login: SUCIO }) : responder(res, 404, {}));
  const r1 = await ctx.ejecutar(["entrar"], { stdin: `${TOKEN}\n` });
  assert.equal(r1.codigo, 0, r1.stderr);
  assert.match(r1.stdout, /ana/);
  assert.doesNotMatch(r1.stdout, RAROS, `entrar: ${JSON.stringify(r1.stdout)}`);
  const r2 = await ctx.ejecutar(["estado"]);
  assert.equal(r2.codigo, 0, r2.stderr);
  assert.match(r2.stdout, /ana/);
  assert.doesNotMatch(r2.stdout, RAROS, `estado: ${JSON.stringify(r2.stdout)}`);
});

test("(b) subir imprime id y nombre devueltos sin control, ANSI ni bidi", async () => {
  ctx.guardarArchivo();
  ctx.atender = (req, res) =>
    req.path === "/api/archivos" ? responder(res, 201, { id: `id-${SUCIO}`, nombre: `n-${SUCIO}.drawio`, tipo: "drawio" }) : responder(res, 404, {});
  const r = await ctx.ejecutar(["subir", ctx.archivo("a.drawio", DRAWIO), ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /id-ana/);
  assert.match(r.stdout, /n-ana/);
  assert.doesNotMatch(r.stdout, RAROS, JSON.stringify(r.stdout));
});

test("(b) el texto de error del servidor tampoco lleva ANSI ni bidi", async () => {
  ctx.guardarArchivo();
  ctx.atender = (req, res) => responder(res, 403, { error: `Sin permiso ${SUCIO}` });
  const r = await ctx.ejecutar(["subir", ctx.archivo("a.drawio", DRAWIO), ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.doesNotMatch(r.stderr, RAROS, JSON.stringify(r.stderr));
});

// ---------- (c) mensajeHttp no refleja tokens ----------
const BASE64_43 = "Zq9" + "w".repeat(20) + "_-" + "K".repeat(18);

test("(c) mensajeHttp: quita vtd_/vts_ y cadenas largas tipo base64url del error del servidor", async () => {
  const { mensajeHttp } = await import("../tools/dibujo/api.mjs");
  const casos = [
    `Sin permiso para vtd_${BASE64_43}`,
    `Sin permiso para vts_${BASE64_43}`,
    "Sin permiso para vts_corto",
    `Sin permiso: ${BASE64_43}`,
  ];
  for (const error of casos) {
    const m = mensajeHttp({ status: 403, json: { error }, retryAfter: null });
    assert.match(m, /^Error 403/, error);
    assert.doesNotMatch(m, /vt[ds]_/, `${error}: sin prefijo de token`);
    assert.ok(!m.includes(BASE64_43), `${error}: sin la cadena larga`);
    assert.ok(!m.includes(BASE64_43.slice(0, 20)), `${error}: sin trozos de la cadena larga`);
  }
  const normal = mensajeHttp({ status: 403, json: { error: "Solo los editores pueden subir archivos" }, retryAfter: null });
  assert.match(normal, /Solo los editores pueden subir archivos/, "el texto normal se sigue mostrando");
});

test("(c) por la CLI: un token desconocido en el error del servidor no llega a stderr", async () => {
  ctx.guardarArchivo();
  ctx.atender = (req, res) => responder(res, 403, { error: `Sin permiso: ${BASE64_43}` });
  const r = await ctx.ejecutar(["subir", ctx.archivo("a.drawio", DRAWIO), ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.ok(!r.stderr.includes(BASE64_43.slice(0, 20)), r.stderr);
});
