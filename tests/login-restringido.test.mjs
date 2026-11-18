// Login del Worker (lib/login-core.mjs vía worker/index.mjs): 403 propio para proyectos restringidos y mensaje de
// membresía con pasos. Migrado de tests/middleware.test.mjs (Routing Middleware de Vercel) al quitar Vercel: mismos
// casos, ahora contra crearWorker() con env inyectado y un env.ASSETS falso. "Pasa al sitio" = llega a env.ASSETS.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DEMO } from "./fixtures/acceso-demo.mjs";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// El portal no tiene proyectos restringidos por defecto: se prueba un Worker con la tabla de prueba inyectada.
const cargarWorker = async () => (await import("../worker/index.mjs")).crearWorker({ restringidos: DEMO });

function crearEnv(extra = {}) {
  const llamadas = [];
  const ASSETS = {
    async fetch(req) {
      llamadas.push(req);
      return new Response("<h1>asset</h1>", { headers: { "content-type": "text/html" } });
    },
  };
  return { env: { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, ALLOWED_ORG: "vanttec", ALLOWED_USERS: "", ASSETS, ...extra }, llamadas };
}

// Misma firma que sign() de lib/sesion.mjs.
function session(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  const mac = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${mac}`)}`;
}

async function get(path, cookie, extra = {}) {
  const worker = await cargarWorker();
  const { env, llamadas } = crearEnv(extra);
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} }), env, { waitUntil() {}, passThroughOnException() {} });
  res.paso = llamadas.length > 0;
  return res;
}
const passes = (res) => res.paso === true;

test("restringido: un miembro que no está en la lista recibe 403 'Este proyecto es privado' en cualquier ruta del proyecto", async () => {
  for (const path of ["/restringido-demo/", "/restringido-demo/grafo/", "/restringido-demo/ros.json", "/restringido-demo/arch/general.html", "/restringido-demo"]) {
    const res = await get(path, session("otro"));
    assert.equal(res.status, 403, path);
    assert.ok(!passes(res), `${path} no debe pasar al sitio estático`);
    const html = await res.text();
    assert.match(html, /Este proyecto es privado/, path);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(res.headers.get("content-security-policy"), "lleva la CSP de page()");
  }
});

test("restringido: el login de la sesión sale escapado en la página 403", async () => {
  const res = await get("/restringido-demo/", session('<img src=x onerror="a">'));
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.ok(!html.includes("<img src=x"), "login sin escapar");
});

test("restringido: cyuxSz (con cualquier mayúscula) pasa al sitio estático", async () => {
  for (const login of ["cyuxSz", "CyuxSZ"]) {
    const res = await get("/restringido-demo/ros.json", session(login));
    assert.ok(passes(res), login);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
});

test("restringido: sin sesión sigue redirigiendo al login (no revela nada)", async () => {
  const res = await get("/restringido-demo/grafo/");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/auth\/login\?next=/);
});

test("restringido: variables de un Preview de Vercel (VERCEL_ENV, PREVIEW_TRUST_VERCEL_AUTH) no abren nada", async () => {
  const extra = { VERCEL_ENV: "preview", PREVIEW_TRUST_VERCEL_AUTH: "1" };
  for (const path of ["/restringido-demo/", "/RESTRINGIDO-DEMO/grafo/", "/uuv/"]) {
    const res = await get(path, undefined, extra);
    assert.equal(res.status, 302, path);
    assert.ok(!passes(res), path);
  }
  assert.equal((await get("/restringido-demo/", session("otro"), extra)).status, 403);
});

test("no restringido: el resto del portal sigue igual para cualquier sesión válida", async () => {
  for (const path of ["/", "/uuv/", "/uuv/ros.json", "/restringido-demo-bis/"]) assert.ok(passes(await get(path, session("otro"))), path);
  const me = await get("/auth/me", session("otro"));
  assert.deepEqual(await me.json(), { login: "otro" });
});

// Simula GitHub para /auth/callback: token válido, /user con el login dado y membresía no confirmable.
function mockGitHub(login) {
  globalThis.fetch = async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/login/oauth/access_token")) return Response.json({ access_token: "tok" });
    if (url.endsWith("/user")) return Response.json({ login });
    return new Response(null, { status: 404 });
  };
}
const callback = (extra) => get("/auth/callback?state=S&code=C", `oauth_state=${encodeURIComponent(JSON.stringify({ state: "S", back: "/" }))}`, extra);

test("membresía no confirmada: 403 con pasos numerados (people → buscarte → Private a Public → reintentar)", async () => {
  mockGitHub("ana");
  const res = await callback();
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.match(html, /<ol>[\s\S]*<\/ol>/, "faltan los pasos numerados");
  assert.equal((html.match(/<li>/g) ?? []).length, 4, "deben ser 4 pasos");
  assert.match(html, /href="https:\/\/github\.com\/orgs\/vanttec\/people"/);
  assert.match(html, /Private/);
  assert.match(html, /Public/);
  assert.match(html, /href="\/auth\/login"/);
  assert.match(html, /@ana/);
  const pasos = html.slice(html.indexOf("<ol>"), html.indexOf("</ol>"));
  assert.ok(pasos.indexOf("people") < pasos.indexOf("Private") && pasos.indexOf("Private") < pasos.indexOf("/auth/login"), "orden de los pasos");
});

test("membresía no confirmada: login y org pasan por esc() / encodeURIComponent", async () => {
  mockGitHub("<b>ana</b>");
  const html = await (await callback({ ALLOWED_ORG: 'v"><script>x</script>' })).text();
  assert.ok(!html.includes("<script>x"), "org sin escapar");
  assert.ok(!html.includes("<b>ana</b>"), "login sin escapar");
  assert.match(html, /github\.com\/orgs\/v%22%3E%3Cscript%3Ex%3C%2Fscript%3E\/people/);
});

test("403 de proyecto privado ofrece un siguiente paso", async () => {
  const res = await get("/restringido-demo/", session("otro"));
  assert.match(await res.text(), /Pide acceso a quien administra el portal\./);
});
