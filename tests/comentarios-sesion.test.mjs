// Lote 7a: la sesión (sign/verify/cookies) vive en lib/sesion.mjs y la comparten el login (lib/login-core.mjs, servido
// por worker/index.mjs) y las APIs. /api/* sin sesión responde 401 JSON en vez de redirigir a GitHub (un fetch del
// navegador no puede seguir el login de OAuth).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const sesion = () => import("../lib/sesion.mjs");
// El Worker recibe la configuración en env (sin process.env) y sirve el contenido con env.ASSETS.
const ENV = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, ALLOWED_ORG: "vanttec", ALLOWED_USERS: "" };
async function pedirWorker(request) {
  const { crearWorker } = await import("../worker/index.mjs");
  const ASSETS = { fetch: async () => new Response("<h1>asset</h1>", { headers: { "content-type": "text/html" } }) };
  return crearWorker().fetch(request, { ...ENV, ASSETS }, { waitUntil() {}, passThroughOnException() {} });
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

// Formato de la cookie que emitía el login desde el principio (HMAC-SHA256 en base64url sobre el cuerpo JSON en base64url).
function token(payload, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

test("lib/sesion.mjs: exporta COOKIE, sign, verify y cookies", async () => {
  const s = await sesion();
  assert.equal(s.COOKIE, "docs_session");
  for (const f of ["sign", "verify", "cookies"]) assert.equal(typeof s[f], "function", f);
});

test("sesion: sign → verify devuelve el payload y es compatible con las cookies ya emitidas", async () => {
  const { sign, verify } = await sesion();
  const exp = Date.now() + 864e5;
  assert.deepEqual(await verify(await sign({ login: "ana", exp })), { login: "ana", exp });
  assert.deepEqual(await verify(token({ login: "ana", exp })), { login: "ana", exp }, "una cookie ya emitida sigue valiendo");
});

test("sesion: verify devuelve null (sin lanzar) con token alterado, caducado, de otro secreto o basura", async () => {
  const { verify } = await sesion();
  const ok = token({ login: "ana", exp: Date.now() + 864e5 });
  const casos = [
    undefined,
    "",
    "sinpunto",
    "a.b",
    "%%%.%%%",
    `${ok}x`,
    token({ login: "ana", exp: Date.now() - 1 }),
    token({ login: "ana", exp: Date.now() + 864e5 }, "otro".repeat(10)),
    `${Buffer.from("no-json").toString("base64url")}.${createHmac("sha256", SECRET).update(Buffer.from("no-json").toString("base64url")).digest("base64url")}`,
  ];
  for (const t of casos) assert.equal(await verify(t).catch((e) => `lanzó ${e}`), null, String(t));
});

test("sesion: cookies() tolera un % mal formado y separa por ;", async () => {
  const { cookies } = await sesion();
  const req = new Request(ORIGIN, { headers: { cookie: "a=%E0%A4%A; docs_session=x.y; b=1=2" } });
  const jar = cookies(req);
  assert.equal(jar.docs_session, "x.y");
  assert.equal(jar.b, "1=2");
  assert.ok(!("a" in jar));
});

test("lib/login-core.mjs usa ./sesion.mjs y no define su propia firma", () => {
  const src = readFileSync(new URL("../lib/login-core.mjs", import.meta.url), "utf8");
  assert.match(src, /from\s+["']\.\/sesion\.mjs["']/);
  assert.doesNotMatch(src, /async function (hmac|sign|verify)\b/);
  assert.doesNotMatch(src, /function cookies\b/);
});

test("worker: /api/comentarios/ con sesión válida llega a la API (no es el 401 del login)", async () => {
  const cookie = `docs_session=${encodeURIComponent(token({ login: "ana", exp: Date.now() + 864e5 }))}`;
  const res = await pedirWorker(new Request(`${ORIGIN}/api/comentarios/?pagina=/uuv/a/`, { headers: { cookie } }));
  assert.notEqual(res.status, 401);
  assert.notEqual(res.status, 302);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
});

test("worker: /api/* sin sesión responde 401 JSON no-store (no redirige al login)", async () => {
  for (const path of ["/api/comentarios", "/api/comentarios/?pagina=/uuv/a/"]) {
    const res = await pedirWorker(new Request(`${ORIGIN}${path}`, { headers: { cookie: "docs_session=basura.x" } }));
    assert.equal(res.status, 401, path);
    assert.equal(res.headers.get("location"), null, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(typeof (await res.json()).error, "string");
  }
  const pagina = await pedirWorker(new Request(`${ORIGIN}/uuv/`));
  assert.equal(pagina.status, 302, "el resto del portal sigue redirigiendo al login");
});
