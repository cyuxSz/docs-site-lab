// G4b · arnés de los tests de la CLI vanttec-dibujo: portal falso node:http en 127.0.0.1 que registra las peticiones,
// carpeta temporal por test (APPDATA/HOME/XDG_CONFIG_HOME) y ejecución de la CLI como proceso aparte.
// Mismo esquema que tests/g4a-dibujo-cli.test.mjs. Cada ejecución comprueba que el token no sale por stdout ni stderr.
import { before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLI = join(RAIZ, "tools", "vanttec-dibujo.mjs");

const SECRETO = "Pw4" + "h".repeat(18) + "Y8_-" + "n".repeat(18);
export const TOKEN = "vts_" + SECRETO; // 4 + 43
export const OTRO = "vts_" + "T".repeat(21) + "u".repeat(22);
export const VTD = "vtd_" + SECRETO.split("").reverse().join("");
const TOKENS = [TOKEN, OTRO, VTD];
export const UUID_MIN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function responder(res, status, cuerpo, cabeceras = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...cabeceras });
  res.end(cuerpo === undefined ? "" : JSON.stringify(cuerpo));
}

function escuchar(manejador) {
  return new Promise((ok) => {
    const s = createServer(manejador);
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

export function sinToken(texto, donde) {
  for (const t of TOKENS) {
    const secreto = t.slice(4);
    assert.ok(!texto.includes(t), `${donde} contiene un token completo`);
    assert.ok(!texto.includes(secreto), `${donde} contiene la parte secreta de un token`);
    for (let i = 0; i + 10 <= secreto.length; i++) {
      assert.ok(!texto.includes(secreto.slice(i, i + 10)), `${donde} contiene un trozo del token`);
    }
  }
}

// Registra los hooks y devuelve el contexto del test: ctx.portal, ctx.dir, ctx.peticiones y ctx.atender (asignable).
export function usarPortal(prefijo = "g4b-dibujo-") {
  const ctx = {
    portal: null,
    dir: null,
    peticiones: [],
    atender: (req, res) => responder(res, 404, { error: "No encontrado" }),
  };
  let servidor;
  before(async () => {
    servidor = await escuchar((req, res) => {
      const trozos = [];
      req.on("data", (t) => trozos.push(t));
      req.on("end", () => {
        const url = new URL(req.url, "http://x");
        const body = Buffer.concat(trozos);
        let json = null;
        try { json = JSON.parse(body.toString("utf8")); } catch { /* no es JSON */ }
        const p = { method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body, json };
        ctx.peticiones.push(p);
        ctx.atender(p, res);
      });
    });
    ctx.portal = `http://127.0.0.1:${servidor.address().port}`;
  });
  after(() => new Promise((ok) => servidor.close(ok)));
  beforeEach(() => {
    ctx.dir = mkdtempSync(join(tmpdir(), prefijo));
    ctx.peticiones = [];
    ctx.atender = (req, res) => responder(res, 404, { error: "No encontrado" });
  });
  afterEach(() => rmSync(ctx.dir, { recursive: true, force: true }));

  ctx.rutaArchivo = () => {
    if (process.platform === "win32") return join(ctx.dir, "vanttec-dibujo", "token.json");
    if (process.platform === "darwin") return join(ctx.dir, "Library", "Application Support", "vanttec-dibujo", "token.json");
    return join(ctx.dir, "vanttec-dibujo", "token.json");
  };
  ctx.guardarArchivo = (token = TOKEN, portal = ctx.portal) => {
    const ruta = ctx.rutaArchivo();
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, JSON.stringify({ portal, token }));
  };
  ctx.archivo = (nombre, contenido) => {
    const ruta = join(ctx.dir, nombre);
    mkdirSync(dirname(ruta), { recursive: true });
    writeFileSync(ruta, contenido);
    return ruta;
  };
  ctx.ejecutar = (args, { stdin = "", env = {}, portal = ctx.portal } = {}) => {
    const base = { ...process.env };
    for (const k of Object.keys(base)) if (k.startsWith("VANTTEC_DIBUJO_")) delete base[k];
    const entorno = { ...base, APPDATA: ctx.dir, HOME: ctx.dir, USERPROFILE: ctx.dir, XDG_CONFIG_HOME: ctx.dir, ...env };
    if (portal !== null && !("VANTTEC_DIBUJO_PORTAL" in env)) entorno.VANTTEC_DIBUJO_PORTAL = portal;
    return new Promise((ok, mal) => {
      const hijo = spawn(process.execPath, [CLI, ...args], { cwd: ctx.dir, env: entorno, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      hijo.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
      hijo.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
      const reloj = setTimeout(() => {
        hijo.kill();
        mal(new Error(`La CLI no terminó en 20 s (${args.join(" ")})`));
      }, 20_000);
      hijo.on("error", mal);
      hijo.on("close", (codigo) => {
        clearTimeout(reloj);
        try {
          sinToken(stdout, "stdout");
          sinToken(stderr, "stderr");
        } catch (e) {
          return mal(e);
        }
        ok({ codigo, stdout, stderr });
      });
      hijo.stdin.on("error", () => {});
      hijo.stdin.end(stdin);
    });
  };
  return ctx;
}
