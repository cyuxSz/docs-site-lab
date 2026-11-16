// M1: el portal servido desde un Cloudflare Worker con static assets y el mismo login que middleware.js.
// Todo es aditivo: Vercel sigue en producción, así que también se comprueba que middleware.js, vercel.json y las
// dependencias de Vercel siguen igual.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const leer = (rel) => readFileSync(new URL(rel, root), "utf8");
const existe = (rel) => existsSync(new URL(rel, root));

// Import dinámico: si el módulo aún no existe, solo fallan sus tests (no todo el archivo).
const cargarWorker = async () => (await import("../worker/index.mjs")).default;
const cargarCore = async () => import("../lib/login-core.mjs");

const SECRET = "w".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const realFetch = globalThis.fetch;
const ENV_VERCEL = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET", "ALLOWED_ORG", "ALLOWED_USERS", "VERCEL_ENV", "PREVIEW_TRUST_VERCEL_AUTH"];
let guardado = {};

// El Worker no debe leer process.env: se vacía para que cualquier fuga a process.env haga fallar los tests.
beforeEach(() => {
  guardado = Object.fromEntries(ENV_VERCEL.map((k) => [k, process.env[k]]));
  for (const k of ENV_VERCEL) delete process.env[k];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(guardado)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// Cabeceras inmutables, como las de una respuesta de env.ASSETS.fetch() en Workers.
class HeadersInmutables extends Headers {
  set() { throw new TypeError("immutable"); }
  append() { throw new TypeError("immutable"); }
  delete() { throw new TypeError("immutable"); }
}

// env.ASSETS falso: sirve un HTML (o 404) y registra qué peticiones le llegan.
function crearEnv(extra = {}) {
  const llamadas = [];
  const ASSETS = {
    async fetch(req) {
      const r = req instanceof Request ? req : new Request(req);
      llamadas.push(r);
      const path = new URL(r.url).pathname;
      const status = path.includes("no-existe") ? 404 : 200;
      const res = new Response(status === 404 ? "<h1>404</h1>" : "<h1>asset</h1>", {
        status,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", etag: '"abc"' },
      });
      const inmutables = new HeadersInmutables(res.headers);
      Object.defineProperty(res, "headers", { value: inmutables });
      return res;
    },
  };
  const env = { GITHUB_CLIENT_ID: "cid", GITHUB_CLIENT_SECRET: "csecret", SESSION_SECRET: SECRET, ALLOWED_ORG: "vanttec", ALLOWED_USERS: "", ASSETS, ...extra };
  return { env, llamadas };
}

// Misma firma que sign() de lib/sesion.mjs.
function sesion(login, secret = SECRET) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${mac}`)}`;
}

async function pedir(path, { cookie, method = "GET", headers = {}, env, body } = {}) {
  const worker = await cargarWorker();
  const e = env ?? crearEnv().env;
  const req = new Request(`${ORIGIN}${path}`, { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, body });
  return worker.fetch(req, e, { waitUntil() {}, passThroughOnException() {} });
}

const GLOBALES = {
  "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
};
const SANDBOX = "sandbox allow-scripts allow-downloads allow-popups; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";

// ---------- módulo compartido ----------

test("core: lib/login-core.mjs exporta manejarLogin y no depende de Vercel ni de process.env", async () => {
  const core = await cargarCore();
  assert.equal(typeof core.manejarLogin, "function");
  const src = leer("lib/login-core.mjs");
  assert.ok(!/@vercel\//.test(src), "el core no puede importar paquetes de Vercel");
  assert.ok(!/process\.env/.test(src), "el core recibe env como parámetro, no lee process.env");
});

test("core: sin sesión llama a continuar solo tras autenticar; con sesión pasa Cache-Control private, no-store", async () => {
  const { manejarLogin } = await cargarCore();
  const { env } = crearEnv();
  let extra = null;
  const continuar = async (h) => {
    extra = h;
    return new Response("ok");
  };
  const sin = await manejarLogin(new Request(`${ORIGIN}/uuv/`), env, { continuar });
  assert.equal(sin.status, 302);
  assert.equal(extra, null, "sin sesión no debe llamar a continuar");
  const con = await manejarLogin(new Request(`${ORIGIN}/uuv/`, { headers: { cookie: sesion("ana") } }), env, { continuar });
  assert.equal(await con.text(), "ok");
  const h = new Headers(extra ?? {});
  assert.equal(h.get("cache-control"), "private, no-store");
});

test("core: firma y verifica con env.SESSION_SECRET aunque process.env no lo tenga", async () => {
  const { manejarLogin } = await cargarCore();
  const { env } = crearEnv();
  const otro = sesion("ana", "x".repeat(40));
  const res = await manejarLogin(new Request(`${ORIGIN}/uuv/`, { headers: { cookie: otro } }), env, { continuar: async () => new Response("ok") });
  assert.equal(res.status, 302, "una cookie firmada con otro secreto no vale");
});

// ---------- Worker: login ----------

test("worker: exporta default { fetch }", async () => {
  const worker = await cargarWorker();
  assert.equal(typeof worker.fetch, "function");
});

test("worker: sin sesión redirige 302 a /auth/login con next (ruta + query) y no toca ASSETS", async () => {
  const { env, llamadas } = crearEnv();
  const res = await pedir("/uuv/grafo/?vista=plan", { env });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), `/auth/login?next=${encodeURIComponent("/uuv/grafo/?vista=plan")}`);
  assert.equal(llamadas.length, 0);
});

test("worker: /api sin sesión responde 401 JSON; el callback de Vercel Blob no tiene excepción", async () => {
  const { env, llamadas } = crearEnv();
  for (const [path, method, headers] of [
    ["/api/comentarios/", "GET", {}],
    ["/api", "GET", {}],
    ["/api/archivos/", "POST", { "x-vercel-signature": "abc", "content-type": "application/json" }],
    ["/api/archivos", "POST", { "x-vercel-signature": "abc", "content-type": "application/json" }],
  ]) {
    const res = await pedir(path, { env, method, headers, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: "Sesión requerida" });
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(llamadas.length, 0);
});

test("worker: /auth/me sin sesión 401 {login:null}; con sesión {login}", async () => {
  const sin = await pedir("/auth/me");
  assert.equal(sin.status, 401);
  assert.deepEqual(await sin.json(), { login: null });
  const con = await pedir("/auth/me/", { cookie: sesion("ana") });
  assert.equal(con.status, 200);
  assert.deepEqual(await con.json(), { login: "ana" });
});

test("worker: cookie válida pasa a ASSETS con las cabeceras globales y Cache-Control private, no-store", async () => {
  const { env, llamadas } = crearEnv();
  const res = await pedir("/uuv/", { env, cookie: sesion("ana") });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "<h1>asset</h1>");
  assert.equal(llamadas.length, 1);
  assert.equal(new URL(llamadas[0].url).pathname, "/uuv/");
  for (const [k, v] of Object.entries(GLOBALES)) assert.equal(res.headers.get(k), v, k);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("etag"), '"abc"', "conserva las demás cabeceras del asset");
});

test("worker: el 404 de ASSETS también lleva las cabeceras de seguridad", async () => {
  const res = await pedir("/uuv/no-existe/", { cookie: sesion("ana") });
  assert.equal(res.status, 404);
  for (const [k, v] of Object.entries(GLOBALES)) assert.equal(res.headers.get(k), v, k);
});

test("worker: /:project/arch/* lleva la CSP sandbox (también con mayúsculas o codificado); el resto no", async () => {
  for (const path of ["/uuv/arch/x.html", "/uuv/arch/sub/y.html", "/uuv/ARCH/x.html", "/uuv/%61rch/x.html", "/uuv/%5carch/x.html", "/uuv//arch/x.html"]) {
    const res = await pedir(path, { cookie: sesion("ana") });
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get("content-security-policy"), SANDBOX, path);
    assert.equal(res.headers.get("x-frame-options"), "DENY", path);
  }
  for (const path of ["/uuv/", "/uuv/grafo/", "/arch/x.html", "/uuv/archivo/x.html"]) {
    const res = await pedir(path, { cookie: sesion("ana") });
    assert.equal(res.headers.get("content-security-policy"), GLOBALES["content-security-policy"], path);
  }
});

test("worker: las páginas propias del login conservan sus cabeceras (no se pisan con las globales)", async () => {
  const res = await pedir("/proyecto-x/", { cookie: sesion("otro") });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(res.headers.get("permissions-policy"), GLOBALES["permissions-policy"], "las globales que faltan sí se añaden");
});

test("worker: proyecto restringido responde 403 a quien no está en la lista y pasa a cyuxSz", async () => {
  const { env, llamadas } = crearEnv();
  for (const path of ["/proyecto-x/", "/proyecto-x/arch/general.html", "/PROYECTO-X/grafo/", "/proyecto-x/ros.json"]) {
    const res = await pedir(path, { env, cookie: sesion("otro") });
    assert.equal(res.status, 403, path);
    assert.match(await res.text(), /Este proyecto es privado/);
  }
  assert.equal(llamadas.length, 0, "ningún asset restringido llega a ASSETS");
  const ok = await pedir("/proyecto-x/", { env, cookie: sesion("CyuxSZ") });
  assert.equal(ok.status, 200);
  assert.equal(llamadas.length, 1);
});

test("worker: VERCEL_ENV=preview no abre nada (la rama de Preview de Vercel no existe en el Worker)", async () => {
  const { env, llamadas } = crearEnv({ VERCEL_ENV: "preview", PREVIEW_TRUST_VERCEL_AUTH: "1" });
  const res = await pedir("/uuv/", { env });
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /^\/auth\/login\?next=/);
  assert.equal(llamadas.length, 0);
});

// ---------- Worker: OAuth ----------

function cookieDe(res, nombre) {
  const todas = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")];
  const c = todas.find((x) => x && x.startsWith(`${nombre}=`));
  return c ? decodeURIComponent(c.slice(nombre.length + 1).split(";")[0]) : null;
}

test("worker: /auth/login y /auth/login/ redirigen a GitHub con state, redirect_uri del Worker y cookie oauth_state", async () => {
  for (const path of ["/auth/login?next=/uuv/grafo/", "/auth/login/?next=/uuv/grafo/"]) {
    const res = await pedir(path);
    assert.equal(res.status, 302, path);
    const loc = new URL(res.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(loc.searchParams.get("client_id"), "cid");
    assert.equal(loc.searchParams.get("redirect_uri"), `${ORIGIN}/auth/callback`);
    assert.equal(loc.searchParams.get("scope"), "read:org");
    const pend = JSON.parse(cookieDe(res, "oauth_state"));
    assert.ok(pend.state && pend.state.length >= 24);
    assert.equal(loc.searchParams.get("state"), pend.state);
    assert.equal(pend.back, "/uuv/grafo/");
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("oauth_state="));
    assert.match(raw, /HttpOnly/);
    assert.match(raw, /Secure/);
    assert.match(raw, /SameSite=Lax/);
  }
});

test("worker: safeTarget anti open-redirect en next", async () => {
  for (const malo of ["//evil.com", "/\\evil.com", "https://evil.com", "/ruta con espacio", "javascript:alert(1)", "/\\/evil.com"]) {
    const res = await pedir(`/auth/login?next=${encodeURIComponent(malo)}`);
    assert.equal(JSON.parse(cookieDe(res, "oauth_state")).back, "/", malo);
  }
});

function mockGitHub({ login, miembro = true, token = "tok" }) {
  const vistas = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    vistas.push({ url, init });
    if (url.includes("/login/oauth/access_token")) return Response.json(token ? { access_token: token } : { error: "bad" });
    if (url.endsWith("/user")) return Response.json({ login });
    if (url.includes("/user/memberships/orgs/")) return miembro ? Response.json({ state: "active" }) : new Response(null, { status: 404 });
    return new Response(null, { status: 404 });
  };
  return vistas;
}
const pendiente = (state, back) => `oauth_state=${encodeURIComponent(JSON.stringify({ state, back }))}`;

test("worker: callback con state distinto o sin cookie responde 400 y no llama a GitHub", async () => {
  const vistas = mockGitHub({ login: "ana" });
  assert.equal((await pedir("/auth/callback?state=OTRO&code=C", { cookie: pendiente("S", "/") })).status, 400);
  assert.equal((await pedir("/auth/callback?state=S&code=C")).status, 400);
  assert.equal(vistas.length, 0);
});

test("worker: callback válido de un miembro emite docs_session firmada con env.SESSION_SECRET y vuelve a back", async () => {
  const vistas = mockGitHub({ login: "ana" });
  const res = await pedir("/auth/callback/?state=S&code=C", { cookie: pendiente("S", "/uuv/grafo/") });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/uuv/grafo/");
  const tokenReq = vistas.find((v) => v.url.includes("/login/oauth/access_token"));
  const cuerpo = JSON.parse(tokenReq.init.body);
  assert.equal(cuerpo.client_secret, "csecret");
  assert.equal(cuerpo.redirect_uri, `${ORIGIN}/auth/callback`);
  const valor = cookieDe(res, "docs_session");
  const [body, mac] = valor.split(".");
  assert.equal(mac, createHmac("sha256", SECRET).update(body).digest("base64url"));
  assert.equal(JSON.parse(Buffer.from(body, "base64url").toString()).login, "ana");
  // La cookie emitida abre el portal.
  const ok = await pedir("/uuv/", { cookie: `docs_session=${encodeURIComponent(valor)}` });
  assert.equal(ok.status, 200);
});

test("worker: callback con back malicioso en la cookie vuelve a /", async () => {
  mockGitHub({ login: "ana" });
  const res = await pedir("/auth/callback?state=S&code=C", { cookie: pendiente("S", "//evil.com") });
  assert.equal(res.headers.get("location"), "/");
});

test("worker: callback de alguien fuera de la org responde 403 con los pasos; ALLOWED_USERS deja pasar", async () => {
  mockGitHub({ login: "ana", miembro: false });
  const no = await pedir("/auth/callback?state=S&code=C", { cookie: pendiente("S", "/") });
  assert.equal(no.status, 403);
  assert.match(await no.text(), /github\.com\/orgs\/vanttec\/people/);
  const { env } = crearEnv({ ALLOWED_USERS: "Pepe, ANA" });
  const si = await pedir("/auth/callback?state=S&code=C", { env, cookie: pendiente("S", "/") });
  assert.equal(si.status, 302);
  assert.ok(cookieDe(si, "docs_session"));
});

test("worker: logout borra la cookie y signed-out responde 200", async () => {
  const res = await pedir("/auth/logout", { cookie: sesion("ana") });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/auth/signed-out");
  assert.match(res.headers.getSetCookie().find((c) => c.startsWith("docs_session=")), /Max-Age=0/);
  assert.equal((await pedir("/auth/signed-out/")).status, 200);
});

// ---------- Worker: configuración ----------

test("worker: 503 si falta GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET o SESSION_SECRET (o es corto)", async () => {
  for (const quitar of [{ GITHUB_CLIENT_ID: "" }, { GITHUB_CLIENT_SECRET: undefined }, { SESSION_SECRET: undefined }, { SESSION_SECRET: "corto" }]) {
    const { env, llamadas } = crearEnv(quitar);
    for (const path of ["/uuv/", "/auth/login", "/api/comentarios/"]) {
      const res = await pedir(path, { env, cookie: sesion("ana") });
      assert.equal(res.status, 503, `${JSON.stringify(quitar)} ${path}`);
    }
    assert.equal(llamadas.length, 0);
  }
});

// ---------- Worker: redirecciones y API ----------

test("worker: redirecciones 301 de vercel.json (wiki → grafo, content → software) tras el login", async () => {
  const casos = [
    ["/uuv/wiki/", "/uuv/grafo/"],
    ["/uuv/wiki", "/uuv/grafo/"],
    ["/uuv/content/", "/uuv/software/"],
    ["/uuv/content/a/b.html", "/uuv/software/"],
  ];
  for (const [desde, hacia] of casos) {
    const { env, llamadas } = crearEnv();
    const res = await pedir(desde, { env, cookie: sesion("ana") });
    assert.equal(res.status, 301, desde);
    assert.equal(res.headers.get("location"), hacia, desde);
    assert.equal(llamadas.length, 0, desde);
    assert.equal(res.headers.get("x-frame-options"), "DENY", `${desde} lleva cabeceras`);
  }
  // Sin sesión primero va al login.
  assert.equal((await pedir("/uuv/wiki/")).status, 302);
  // Proyecto restringido: 403 antes que la redirección.
  assert.equal((await pedir("/proyecto-x/wiki/", { cookie: sesion("otro") })).status, 403);
});

test("worker: la redirección nunca produce un Location a otro sitio", async () => {
  for (const path of ["//evil.com/wiki/", "/%2F%2Fevil.com/wiki/", "/\\evil.com/wiki/", "/%5Cevil.com/content/x"]) {
    const res = await pedir(path, { cookie: sesion("ana") });
    const loc = res.headers.get("location");
    if (loc) assert.match(loc, /^\/(?![/\\])/, `${path} → ${loc}`);
  }
});

// M2b: /api/hardware ya lo atiende hardware-core en el Worker (tests/m2b-hardware-cliente.test.mjs). Sin Upstash → 503.
test("worker: /api/hardware con sesión ya no responde 501; sin Upstash → 503 JSON con las cabeceras de API", async () => {
  const { env, llamadas } = crearEnv();
  for (const [path, method] of [["/api/hardware/?proyecto=uuv&disciplina=electronica", "GET"], ["/api/hardware?proyecto=uuv&disciplina=electronica", "GET"]]) {
    const res = await pedir(path, { env, method, cookie: sesion("ana") });
    assert.equal(res.status, 503, path);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    assert.notDeepEqual(await res.json(), { error: "No disponible aún en Cloudflare" });
    assert.match(res.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  }
  assert.equal(llamadas.length, 0);
});

// ---------- Vercel intacto ----------

test("vercel: middleware.js es un envoltorio del core y conserva @vercel/functions", () => {
  const src = leer("middleware.js");
  assert.ok(/from\s+["']\.\/lib\/login-core\.mjs["']/.test(src), "middleware.js debe importar ./lib/login-core.mjs");
  assert.ok(/from\s+["']@vercel\/functions["']/.test(src), "middleware.js sigue usando next de @vercel/functions");
  assert.ok(/export\s+const\s+config/.test(src), "middleware.js conserva config.matcher");
  assert.ok(!/github\.com\/login\/oauth/.test(src), "la lógica del OAuth vive en el core, no duplicada");
});

test("vercel: vercel.json no cambió", () => {
  const esperado = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    installCommand: "npm ci",
    buildCommand: "npm run build",
    outputDirectory: "dist",
    framework: null,
    trailingSlash: true,
    redirects: [
      { source: "/:project/wiki/", destination: "/:project/grafo/", permanent: true },
      { source: "/:project/content/:path*", destination: "/:project/software/", permanent: true },
    ],
    headers: [
      { source: "/(.*)", headers: Object.entries({ "Content-Security-Policy": GLOBALES["content-security-policy"], "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": GLOBALES["permissions-policy"], "Cross-Origin-Opener-Policy": "same-origin" }).map(([key, value]) => ({ key, value })) },
      { source: "/:project/arch/:file*", headers: [{ key: "Content-Security-Policy", value: SANDBOX }] },
    ],
  };
  assert.deepEqual(JSON.parse(leer("vercel.json")), esperado);
});

test("vercel: siguen las dependencias de Vercel; wrangler es devDependency con versión exacta", () => {
  const pkg = JSON.parse(leer("package.json"));
  assert.ok(pkg.dependencies["@vercel/functions"]);
  assert.ok(pkg.dependencies["@vercel/blob"]);
  const v = pkg.devDependencies?.wrangler;
  assert.ok(v, "falta wrangler en devDependencies");
  assert.match(v, /^\d+\.\d+\.\d+$/, "versión exacta, sin ^ ni ~");
  assert.ok(!pkg.dependencies.wrangler, "wrangler no va en dependencies");
  assert.equal(pkg.scripts["cf:dev"], "wrangler dev");
  assert.equal(pkg.scripts["cf:deploy"], "wrangler deploy");
});

// ---------- Configuración de Cloudflare ----------

// Quita comentarios // y /* */ fuera de cadenas y comas finales.
function jsonc(texto) {
  let out = "";
  for (let i = 0, cad = false; i < texto.length; i++) {
    const c = texto[i];
    if (cad) {
      out += c;
      if (c === "\\") out += texto[++i];
      else if (c === '"') cad = false;
    } else if (c === '"') {
      cad = true;
      out += c;
    } else if (c === "/" && texto[i + 1] === "/") {
      while (i < texto.length && texto[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && texto[i + 1] === "*") {
      i = texto.indexOf("*/", i + 2) + 1;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

test("wrangler.jsonc: nombre, main, compat fija, nodejs_compat y assets con run_worker_first", () => {
  assert.ok(existe("wrangler.jsonc"), "falta wrangler.jsonc");
  const c = jsonc(leer("wrangler.jsonc"));
  assert.equal(c.name, "docs-site-lab");
  assert.equal(c.main, "worker/index.mjs");
  assert.match(c.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(c.compatibility_date >= "2025-01-01", "compatibility_date reciente");
  assert.ok(c.compatibility_flags.includes("nodejs_compat"));
  assert.deepEqual(c.assets, { directory: "./dist", binding: "ASSETS", run_worker_first: true, not_found_handling: "404-page", html_handling: "force-trailing-slash" });
  assert.ok(!("account_id" in c), "account_id va por variable de entorno");
  assert.ok(!c.vars || !Object.keys(c.vars).some((k) => /SECRET|CLIENT/.test(k)), "los secretos no van en vars");
});

test(".dev.vars.example lista las variables sin valores y .dev.vars está ignorado", () => {
  assert.ok(existe(".dev.vars.example"), "falta .dev.vars.example");
  const ej = leer(".dev.vars.example");
  for (const k of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "SESSION_SECRET", "ALLOWED_ORG", "ALLOWED_USERS"]) {
    const linea = ej.split(/\r?\n/).find((l) => l.startsWith(`${k}=`));
    assert.ok(linea, `falta ${k}`);
    assert.equal(linea, `${k}=`, `${k} sin valor`);
  }
  const gi = leer(".gitignore").split(/\r?\n/).map((l) => l.trim());
  assert.ok(gi.includes(".dev.vars"), ".dev.vars en .gitignore");
  assert.ok(gi.some((l) => l === ".wrangler" || l === ".wrangler/"), ".wrangler en .gitignore");
});

test("README: sección Cloudflare (en preparación) con npm run cf:dev y .dev.vars", () => {
  const md = leer("README.md");
  const i = md.indexOf("Cloudflare (en preparación)");
  assert.ok(i >= 0, "falta la sección");
  const sec = md.slice(i, md.indexOf("\n## ", i + 1) === -1 ? undefined : md.indexOf("\n## ", i + 1));
  assert.match(sec, /npm run cf:dev/);
  assert.match(sec, /\.dev\.vars/);
  assert.match(sec, /SESSION_SECRET/);
});
