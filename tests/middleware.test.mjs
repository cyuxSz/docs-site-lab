// middleware.js: 403 propio para proyectos restringidos y mensaje de membresía con pasos.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import middleware from "../middleware.js";

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs.example";
const realFetch = globalThis.fetch;

beforeEach(() => {
  Object.assign(process.env, { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, ALLOWED_ORG: "vanttec", ALLOWED_USERS: "" });
  delete process.env.VERCEL_ENV;
  delete process.env.PREVIEW_TRUST_VERCEL_AUTH;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Misma firma que sign() de middleware.js.
function session(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  const mac = createHmac("sha256", SECRET).update(body).digest("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${mac}`)}`;
}

const get = (path, cookie) => middleware(new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} }));
const passes = (res) => res.headers.get("x-middleware-next") === "1";

test("restringido: un miembro que no está en la lista recibe 403 'Este proyecto es privado' en cualquier ruta del proyecto", async () => {
  for (const path of ["/proyecto-x/", "/proyecto-x/grafo/", "/proyecto-x/ros.json", "/proyecto-x/arch/general.html", "/proyecto-x"]) {
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
  const res = await get("/proyecto-x/", session('<img src=x onerror="a">'));
  assert.equal(res.status, 403);
  const html = await res.text();
  assert.ok(!html.includes("<img src=x"), "login sin escapar");
});

test("restringido: cyuxSz (con cualquier mayúscula) pasa al sitio estático", async () => {
  for (const login of ["cyuxSz", "CyuxSZ"]) {
    const res = await get("/proyecto-x/ros.json", session(login));
    assert.ok(passes(res), login);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
});

test("restringido: sin sesión sigue redirigiendo al login (no revela nada)", async () => {
  const res = await get("/proyecto-x/grafo/");
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/auth\/login\?next=/);
});

test("no restringido: el resto del portal sigue igual para cualquier sesión válida", async () => {
  for (const path of ["/", "/uuv/", "/uuv/ros.json", "/proyecto-x-bis/"]) assert.ok(passes(await get(path, session("otro"))), path);
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
const callback = () =>
  get("/auth/callback?state=S&code=C", `oauth_state=${encodeURIComponent(JSON.stringify({ state: "S", back: "/" }))}`);

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
  process.env.ALLOWED_ORG = 'v"><script>x</script>';
  mockGitHub("<b>ana</b>");
  const html = await (await callback()).text();
  assert.ok(!html.includes("<script>x"), "org sin escapar");
  assert.ok(!html.includes("<b>ana</b>"), "login sin escapar");
  assert.match(html, /github\.com\/orgs\/v%22%3E%3Cscript%3Ex%3C%2Fscript%3E\/people/);
});
