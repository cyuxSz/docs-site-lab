// G4a · CLI tools/vanttec-dibujo.mjs: entrar, salir, estado y subir.
// Sin red: un servidor node:http falso en 127.0.0.1 hace de portal, y APPDATA/HOME/XDG_CONFIG_HOME apuntan a un temporal.
// La CLI se ejecuta como proceso aparte (spawn asíncrono, para que el servidor del test siga atendiendo).
// Todas las ejecuciones comprueban que el token no aparece en stdout ni en stderr (criterio 15).
import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(RAIZ, "tools", "vanttec-dibujo.mjs");

const SECRETO = "Qx7" + "k".repeat(18) + "Z9_-" + "m".repeat(18);
const TOKEN = "vts_" + SECRETO; // 4 + 43
const OTRO = "vts_" + "R".repeat(21) + "s".repeat(22);
const VTD = "vtd_" + SECRETO.split("").reverse().join("");
const TOKENS = [TOKEN, OTRO, VTD];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------- servidor falso ----------
let servidor;
let PORTAL;
let peticiones = [];
let atender = (req, res) => responder(res, 404, { error: "No encontrado" });

function responder(res, status, cuerpo, cabeceras = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...cabeceras });
  res.end(cuerpo === undefined ? "" : JSON.stringify(cuerpo));
}

function escuchar(manejador) {
  return new Promise((ok) => {
    const s = createServer(manejador);
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

before(async () => {
  servidor = await escuchar((req, res) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const p = { method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, body: Buffer.concat(trozos) };
      peticiones.push(p);
      atender(p, res);
    });
  });
  PORTAL = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => new Promise((ok) => servidor.close(ok)));

// ---------- entorno de cada test ----------
let DIR;
beforeEach(() => {
  DIR = mkdtempSync(join(tmpdir(), "g4a-dibujo-"));
  peticiones = [];
  atender = (req, res) => responder(res, 404, { error: "No encontrado" });
});
afterEach(() => rmSync(DIR, { recursive: true, force: true }));

// Ruta del token según D1 de la spec, calculada aquí sin usar el código de la CLI.
function rutaArchivo() {
  if (process.platform === "win32") return join(DIR, "vanttec-dibujo", "token.json");
  if (process.platform === "darwin") return join(DIR, "Library", "Application Support", "vanttec-dibujo", "token.json");
  return join(DIR, "vanttec-dibujo", "token.json"); // XDG_CONFIG_HOME = DIR
}

function guardarArchivo(token, portal = PORTAL) {
  const ruta = rutaArchivo();
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, JSON.stringify({ portal, token }));
}

const leerArchivo = () => JSON.parse(readFileSync(rutaArchivo(), "utf8"));

function sinToken(texto, donde) {
  for (const t of TOKENS) {
    const secreto = t.slice(4);
    assert.ok(!texto.includes(t), `${donde} contiene un token completo`);
    assert.ok(!texto.includes(secreto), `${donde} contiene la parte secreta de un token`);
    for (let i = 0; i + 10 <= secreto.length; i++) {
      assert.ok(!texto.includes(secreto.slice(i, i + 10)), `${donde} contiene un trozo del token`);
    }
  }
}

function ejecutar(args, { stdin = "", env = {}, portal = PORTAL } = {}) {
  const base = { ...process.env };
  for (const k of Object.keys(base)) if (k.startsWith("VANTTEC_DIBUJO_")) delete base[k];
  const entorno = { ...base, APPDATA: DIR, HOME: DIR, USERPROFILE: DIR, XDG_CONFIG_HOME: DIR, ...env };
  if (portal !== null && !("VANTTEC_DIBUJO_PORTAL" in env)) entorno.VANTTEC_DIBUJO_PORTAL = portal;
  return new Promise((ok, mal) => {
    const hijo = spawn(process.execPath, [CLI, ...args], { cwd: DIR, env: entorno, stdio: ["pipe", "pipe", "pipe"] });
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
}

const okMe = (login = "ana") => (req, res) =>
  req.path === "/auth/me" ? responder(res, 200, { login }) : responder(res, 404, { error: "No encontrado" });

async function puertoCerrado() {
  const s = await escuchar(() => {});
  const puerto = s.address().port;
  await new Promise((ok) => s.close(ok));
  return `http://127.0.0.1:${puerto}`;
}

// ---------- 1. uso ----------
test("sin comando: ayuda en stderr y código ≠ 0", async () => {
  const r = await ejecutar([]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /entrar/);
  assert.match(r.stderr, /subir/);
  assert.equal(peticiones.length, 0);
});

test("comando desconocido: código ≠ 0 y ayuda", async () => {
  const r = await ejecutar(["volar"]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /entrar/);
});

test("--help y ayuda: ayuda en stdout y código 0", async () => {
  for (const a of ["--help", "-h", "ayuda"]) {
    const r = await ejecutar([a]);
    assert.equal(r.codigo, 0, a);
    for (const c of ["entrar", "salir", "estado", "subir", "--proyecto", "--disciplina", "--portal", "VANTTEC_DIBUJO_TOKEN"]) {
      assert.ok(r.stdout.includes(c), `${a}: la ayuda menciona ${c}`);
    }
  }
  assert.equal(peticiones.length, 0);
});

// ---------- 2. el token nunca por argumentos ----------
test("un token en argv se rechaza sin red y sin eco", async () => {
  atender = okMe();
  for (const args of [
    ["entrar", TOKEN],
    ["entrar", `--token=${TOKEN}`],
    ["entrar", "--token", TOKEN],
    ["estado", VTD],
    ["subir", "x.drawio", "--proyecto", "uuv", "--disciplina", "electronica", "--token", TOKEN],
  ]) {
    const r = await ejecutar(args, { stdin: `${OTRO}\n` });
    assert.notEqual(r.codigo, 0, args[0]);
    assert.match(r.stderr, /argumento|token/i);
  }
  assert.equal(peticiones.length, 0, "no debe hacer ninguna petición");
  assert.equal(existsSync(rutaArchivo()), false);
});

// ---------- 3, 5, 6. entrar ----------
test("entrar lee el token de stdin, valida con /auth/me y lo guarda", async () => {
  atender = okMe("ana");
  const r = await ejecutar(["entrar"], { stdin: `  ${TOKEN}  \r\n` });
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /Sesión iniciada como ana/);
  assert.ok(r.stdout.includes(PORTAL), "muestra el portal");
  assert.equal(peticiones.length, 1);
  const p = peticiones[0];
  assert.equal(p.method, "GET");
  assert.equal(p.path, "/auth/me");
  assert.equal(p.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(p.headers.origin, undefined, "no envía Origin");
  assert.equal(p.headers.cookie, undefined);
  assert.deepEqual(leerArchivo(), { portal: PORTAL, token: TOKEN });
});

test("entrar con --portal usa ese portal", async () => {
  atender = okMe("ana");
  const r = await ejecutar(["entrar", "--portal", PORTAL], { stdin: `${TOKEN}\n`, portal: null });
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(peticiones.length, 1);
  assert.equal(leerArchivo().portal, PORTAL);
});

test("permisos del archivo: 0600 y carpeta 0700 (POSIX)", { skip: process.platform === "win32" && "en Windows el modo no aplica" }, async () => {
  atender = okMe();
  const r = await ejecutar(["entrar"], { stdin: `${TOKEN}\n` });
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(statSync(rutaArchivo()).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(rutaArchivo())).mode & 0o777, 0o700);
});

test("entrar con 401 no guarda ni pisa el archivo previo", async () => {
  guardarArchivo(OTRO);
  atender = (req, res) => responder(res, 401, { error: "Token inválido" }, { "www-authenticate": "Bearer" });
  const r = await ejecutar(["entrar"], { stdin: `${TOKEN}\n` });
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /entrar|caduc|revoc|inválido/i);
  assert.equal(peticiones.length, 1);
  assert.deepEqual(leerArchivo(), { portal: PORTAL, token: OTRO });
});

test("entrar con error de red no guarda", async () => {
  const cerrado = await puertoCerrado();
  const r = await ejecutar(["entrar"], { stdin: `${TOKEN}\n`, portal: cerrado });
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /No se pudo conectar/);
  assert.doesNotMatch(r.stderr, /\n\s+at /, "sin traza de pila");
  assert.equal(existsSync(rutaArchivo()), false);
});

test("entrar con una respuesta 200 sin login no guarda", async () => {
  atender = (req, res) => responder(res, 200, { login: null });
  const r = await ejecutar(["entrar"], { stdin: `${TOKEN}\n` });
  assert.notEqual(r.codigo, 0);
  assert.equal(peticiones.length, 1, "sí consulta /auth/me");
  assert.equal(existsSync(rutaArchivo()), false);
});

// ---------- 4. solo vts_ ----------
test("entrar rechaza vtd_ y formatos raros sin red", async () => {
  atender = okMe();
  const r = await ejecutar(["entrar"], { stdin: `${VTD}\n` });
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /vts_/);
  assert.match(r.stderr, /dispositivo/i);
  for (const malo of ["", "hola", TOKEN.slice(0, -1), `${TOKEN}x`, `Bearer ${TOKEN}`]) {
    const r2 = await ejecutar(["entrar"], { stdin: `${malo}\n` });
    assert.notEqual(r2.codigo, 0, JSON.stringify(malo.slice(0, 8)));
    assert.match(r2.stderr, /vts_/);
  }
  assert.equal(peticiones.length, 0);
  assert.equal(existsSync(rutaArchivo()), false);
});

// ---------- 7. portal ----------
test("portal http no local se rechaza sin red (variable y --portal)", async () => {
  const r1 = await ejecutar(["entrar"], { stdin: `${TOKEN}\n`, portal: "http://docs.vanttec.workers.dev" });
  assert.notEqual(r1.codigo, 0);
  assert.match(r1.stderr, /https/);
  const r2 = await ejecutar(["entrar", "--portal", "http://192.168.1.20:8799"], { stdin: `${TOKEN}\n`, portal: null });
  assert.notEqual(r2.codigo, 0);
  assert.match(r2.stderr, /https/);
  const r3 = await ejecutar(["estado", "--portal", "http://ejemplo.invalid"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN }, portal: null });
  assert.notEqual(r3.codigo, 0);
  assert.match(r3.stderr, /https/);
  assert.equal(existsSync(rutaArchivo()), false);
});

test("--portal sin valor es un error de uso", async () => {
  const r = await ejecutar(["estado", "--portal"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /--portal/);
  assert.equal(peticiones.length, 0);
});

test("el token del archivo no se envía a otro portal", async () => {
  guardarArchivo(TOKEN, "https://docs.vanttec.workers.dev");
  atender = okMe();
  const r = await ejecutar(["estado"]); // VANTTEC_DIBUJO_PORTAL = servidor falso, distinto del guardado
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /portal/i);
  assert.match(r.stderr, /entrar/);
  assert.equal(peticiones.length, 0, "no debe enviar el token a un portal distinto del de entrar");
});

// ---------- 8. variable de entorno ----------
test("VANTTEC_DIBUJO_TOKEN tiene prioridad sobre el archivo y no se guarda", async () => {
  atender = okMe("beto");
  const r = await ejecutar(["estado"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(peticiones[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(existsSync(rutaArchivo()), false, "la variable no se guarda");

  guardarArchivo(OTRO);
  peticiones = [];
  const r2 = await ejecutar(["estado"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.equal(r2.codigo, 0, r2.stderr);
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].headers.authorization, `Bearer ${TOKEN}`, "gana la variable");
  assert.deepEqual(leerArchivo(), { portal: PORTAL, token: OTRO }, "el archivo no cambia");
});

test("VANTTEC_DIBUJO_TOKEN con formato malo: error sin red y sin usar el archivo", async () => {
  guardarArchivo(OTRO);
  atender = okMe();
  const r = await ejecutar(["estado"], { env: { VANTTEC_DIBUJO_TOKEN: VTD } });
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /VANTTEC_DIBUJO_TOKEN/);
  assert.match(r.stderr, /vts_/);
  assert.equal(peticiones.length, 0);
});

// ---------- 9. estado ----------
test("estado con sesión: login, portal, origen y caducidad, sin token", async () => {
  guardarArchivo(TOKEN);
  atender = okMe("ana");
  const r = await ejecutar(["estado"]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /ana/);
  assert.ok(r.stdout.includes(PORTAL));
  assert.match(r.stdout, /archivo/i);
  assert.match(r.stdout, /caducidad/i);
  assert.match(r.stdout, /\/auth\/dispositivos/);
  assert.equal(peticiones.length, 1);
  assert.equal(peticiones[0].path, "/auth/me");
  assert.equal(peticiones[0].headers.authorization, `Bearer ${TOKEN}`);
});

test("estado con la variable indica el origen", async () => {
  atender = okMe("ana");
  const r = await ejecutar(["estado"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /VANTTEC_DIBUJO_TOKEN/);
});

test("estado sin sesión: código ≠ 0 y pista de entrar", async () => {
  const r = await ejecutar(["estado"]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stdout + r.stderr, /Sin sesión/);
  assert.match(r.stdout + r.stderr, /entrar/);
  assert.equal(peticiones.length, 0);
});

test("estado con 401: pide entrar otra vez", async () => {
  guardarArchivo(TOKEN);
  atender = (req, res) => responder(res, 401, { error: "Token inválido" }, { "www-authenticate": "Bearer" });
  const r = await ejecutar(["estado"]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /caduc|revoc/i);
  assert.match(r.stderr, /entrar/);
});

test("archivo del token dañado: se trata como sin sesión y no se muestra su contenido", async () => {
  const ruta = rutaArchivo();
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, `{"portal":"${PORTAL}","token":"${VTD}"`);
  const r = await ejecutar(["estado"]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stdout + r.stderr, /entrar/);
  assert.equal(peticiones.length, 0);
});

// ---------- 10. salir ----------
const revocarCon = (status) => (req, res) =>
  req.path === "/auth/app/revocar" ? responder(res, status, status === 200 ? { ok: true } : { error: "x" }) : responder(res, 404, {});

test("salir revoca y borra el archivo", async () => {
  guardarArchivo(TOKEN);
  atender = revocarCon(200);
  const r = await ejecutar(["salir"]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(peticiones.length, 1);
  const p = peticiones[0];
  assert.equal(p.method, "POST");
  assert.equal(p.path, "/auth/app/revocar");
  assert.equal(p.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(p.body.length, 0, "sin cuerpo");
  assert.equal(p.headers.origin, undefined);
  assert.equal(existsSync(rutaArchivo()), false);
});

test("salir con 401 (ya revocado) borra y sale con 0", async () => {
  guardarArchivo(TOKEN);
  atender = revocarCon(401);
  const r = await ejecutar(["salir"]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(existsSync(rutaArchivo()), false);
});

test("salir borra el archivo aunque la revocación falle (500)", async () => {
  guardarArchivo(TOKEN);
  atender = revocarCon(500);
  const r = await ejecutar(["salir"]);
  assert.notEqual(r.codigo, 0);
  assert.equal(existsSync(rutaArchivo()), false, "el archivo se borra igual");
  assert.match(r.stderr, /sigue/i);
  assert.match(r.stderr, /\/auth\/dispositivos/);
});

test("salir borra el archivo aunque la revocación falle (red)", async () => {
  const cerrado = await puertoCerrado();
  guardarArchivo(TOKEN, cerrado);
  const r = await ejecutar(["salir"], { portal: cerrado });
  assert.notEqual(r.codigo, 0);
  assert.equal(existsSync(rutaArchivo()), false);
  assert.match(r.stderr, /No se pudo conectar/);
  assert.match(r.stderr, /sigue/i);
});

test("salir revoca el token del archivo y el de la variable si son distintos, y recuerda quitar la variable", async () => {
  guardarArchivo(OTRO);
  atender = revocarCon(200);
  const r = await ejecutar(["salir"], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.equal(r.codigo, 0, r.stderr);
  const usados = peticiones.filter((p) => p.path === "/auth/app/revocar").map((p) => p.headers.authorization).sort();
  assert.deepEqual(usados, [`Bearer ${OTRO}`, `Bearer ${TOKEN}`].sort());
  assert.equal(existsSync(rutaArchivo()), false);
  assert.match(r.stdout + r.stderr, /VANTTEC_DIBUJO_TOKEN/);
});

test("salir sin sesión: «No había sesión» y código 0", async () => {
  const r = await ejecutar(["salir"]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.match(r.stdout, /No había sesión/);
  assert.equal(peticiones.length, 0);
});

// ---------- 11. subir: validación local ----------
function archivo(nombre, contenido) {
  const ruta = join(DIR, nombre);
  writeFileSync(ruta, contenido);
  return ruta;
}
const DRAWIO = '<mxfile host="test"><diagram id="a" name="P">x</diagram></mxfile>\n';
const OPC = ["--proyecto", "uuv", "--disciplina", "electronica"];

test("subir: faltan el archivo, --proyecto o --disciplina, o una opción sin valor", async () => {
  guardarArchivo(TOKEN);
  const f = archivo("a.drawio", DRAWIO);
  for (const args of [
    ["subir"],
    ["subir", "--proyecto", "uuv", "--disciplina", "electronica"],
    ["subir", f, "--disciplina", "electronica"],
    ["subir", f, "--proyecto", "uuv"],
    ["subir", f, "--proyecto", "uuv", "--disciplina"],
  ]) {
    const r = await ejecutar(args);
    assert.notEqual(r.codigo, 0, args.join(" "));
    assert.match(r.stderr, /--proyecto/, `${args.join(" ")}: muestra el uso de subir`);
  }
  assert.equal(peticiones.length, 0);
});

test("subir: tipo no permitido se rechaza sin red y enumera los tipos", async () => {
  guardarArchivo(TOKEN);
  for (const nombre of ["foto.png", "doc.pdf", "sin-extension", "pieza.step", "boceto.excalidraw"]) {
    const r = await ejecutar(["subir", archivo(nombre, "contenido"), ...OPC]);
    assert.notEqual(r.codigo, 0, nombre);
    for (const t of ["drawio", "svg", "kicad_sch", "kicad_pcb"]) assert.ok(r.stderr.includes(t), `${nombre}: menciona ${t}`);
  }
  assert.equal(peticiones.length, 0);
});

test("subir: archivo inexistente o vacío se rechaza sin red", async () => {
  guardarArchivo(TOKEN);
  const r1 = await ejecutar(["subir", join(DIR, "no-existe.drawio"), ...OPC]);
  assert.notEqual(r1.codigo, 0);
  assert.match(r1.stderr, /no existe|no se encontr|no se pudo leer/i);
  const r2 = await ejecutar(["subir", archivo("vacio.svg", ""), ...OPC]);
  assert.notEqual(r2.codigo, 0);
  assert.match(r2.stderr, /vacío/i);
  const carpeta = join(DIR, "carpeta.drawio");
  mkdirSync(carpeta);
  const r3 = await ejecutar(["subir", carpeta, ...OPC]);
  assert.notEqual(r3.codigo, 0);
  assert.equal(peticiones.length, 0);
});

test("subir: más grande que el tope del tipo, sin red", async () => {
  guardarArchivo(TOKEN);
  const grande = archivo("grande.drawio", Buffer.alloc(10 * 1024 * 1024 + 1, 0x41));
  const r = await ejecutar(["subir", grande, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /grande|tope|MB/i);
  assert.equal(peticiones.length, 0);
});

test("subir sin sesión: pide entrar, sin red", async () => {
  const r = await ejecutar(["subir", archivo("a.drawio", DRAWIO), ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /entrar/);
  assert.equal(peticiones.length, 0);
});

// ---------- 12. subir: la petición ----------
const okSubida = (req, res) => {
  if (req.method === "POST" && req.path === "/api/archivos") {
    return responder(res, 201, { id: req.query.get("id"), nombre: req.query.get("nombre"), tipo: "drawio" });
  }
  responder(res, 404, { error: "No encontrado" });
};

test("subir manda la petición exacta y muestra el id", async () => {
  guardarArchivo(TOKEN);
  atender = okSubida;
  const f = archivo("Mi diagrama.drawio", DRAWIO);
  const r = await ejecutar(["subir", f, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(peticiones.length, 1);
  const p = peticiones[0];
  assert.equal(p.method, "POST");
  assert.equal(p.path, "/api/archivos");
  assert.deepEqual([...p.query.keys()].sort(), ["disciplina", "id", "nombre", "proyecto"], "exactamente las 4 claves de la lista blanca");
  assert.equal(p.query.get("proyecto"), "uuv");
  assert.equal(p.query.get("disciplina"), "electronica");
  assert.match(p.query.get("id"), UUID_V4);
  assert.equal(p.query.get("nombre"), "Mi-diagrama.drawio", "nombre saneado con sanearNombre");
  assert.equal(p.headers.authorization, `Bearer ${TOKEN}`);
  assert.match(p.headers["content-type"], /^application\/octet-stream/);
  assert.equal(p.headers["content-length"], String(Buffer.byteLength(DRAWIO)));
  assert.equal(p.headers["transfer-encoding"], undefined, "sin chunked: Content-Length exacto");
  assert.equal(p.headers.origin, undefined);
  assert.deepEqual(p.body, Buffer.from(DRAWIO));
  assert.ok(r.stdout.includes(p.query.get("id")), "muestra el id devuelto");
  assert.ok(r.stdout.includes("Mi-diagrama.drawio"), "muestra el nombre devuelto");
});

test("subir acepta svg, kicad_sch y kicad_pcb, y un id nuevo cada vez", async () => {
  guardarArchivo(TOKEN);
  atender = okSubida;
  const casos = [
    ["esquema.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>'],
    ["placa.kicad_sch", "(kicad_sch (version 20231120))"],
    ["placa.kicad_pcb", "(kicad_pcb (version 20240108))"],
    ["otra.drawio", DRAWIO],
  ];
  for (const [nombre, contenido] of casos) {
    const r = await ejecutar(["subir", archivo(nombre, contenido), ...OPC]);
    assert.equal(r.codigo, 0, `${nombre}: ${r.stderr}`);
  }
  assert.deepEqual(peticiones.map((p) => p.query.get("nombre")), casos.map(([n]) => n));
  assert.equal(new Set(peticiones.map((p) => p.query.get("id"))).size, casos.length, "un UUID distinto por subida");
});

test("subir funciona con VANTTEC_DIBUJO_TOKEN sin archivo", async () => {
  atender = okSubida;
  const r = await ejecutar(["subir", archivo("a.drawio", DRAWIO), ...OPC], { env: { VANTTEC_DIBUJO_TOKEN: TOKEN } });
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(peticiones[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(existsSync(rutaArchivo()), false);
});

// ---------- 13. subir: errores HTTP ----------
test("subir: errores HTTP en español y código ≠ 0", async () => {
  guardarArchivo(TOKEN);
  const f = archivo("a.drawio", DRAWIO);
  const casos = [
    [401, { error: "Token inválido" }, {}, [/caduc|revoc/i, /entrar/]],
    [403, { error: "Este token no permite esta operación", codigo: "alcance" }, {}, [/no permite|alcance/i]],
    [403, { error: "Solo los editores pueden subir archivos" }, {}, [/Solo los editores pueden subir archivos/]],
    [409, { error: "Ese id de archivo ya existe" }, {}, [/ya exist/i]],
    [413, { error: "Archivo demasiado grande" }, {}, [/demasiado grande/i]],
    [429, { error: "Demasiadas escrituras; espera un momento" }, { "retry-after": "42" }, [/42/, /espera|demasiadas/i]],
    [500, { error: "Error interno" }, {}, [/500/]],
  ];
  for (const [status, cuerpo, cabeceras, esperados] of casos) {
    atender = (req, res) => responder(res, status, cuerpo, cabeceras);
    peticiones = [];
    const r = await ejecutar(["subir", f, ...OPC]);
    assert.notEqual(r.codigo, 0, String(status));
    for (const e of esperados) assert.match(r.stderr, e, `${status}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /\n\s+at /, `${status}: sin traza de pila`);
    assert.equal(peticiones.length, 1, `${status}: sin reintentos`);
  }
});

test("subir: una redirección no se sigue y el token no viaja a otro origin", async () => {
  const ajenas = [];
  const otro = await escuchar((req, res) => {
    ajenas.push(req.headers);
    res.writeHead(201, { "content-type": "application/json" });
    res.end("{}");
  });
  try {
    guardarArchivo(TOKEN);
    atender = (req, res) => responder(res, 307, {}, { location: `http://127.0.0.1:${otro.address().port}/api/archivos` });
    const r = await ejecutar(["subir", archivo("a.drawio", DRAWIO), ...OPC]);
    assert.notEqual(r.codigo, 0);
    assert.equal(ajenas.length, 0, "no debe seguir la redirección");
    assert.equal(peticiones.length, 1);
  } finally {
    await new Promise((ok) => otro.close(ok));
  }
});

// ---------- 14. red ----------
test("subir: error de red", async () => {
  const cerrado = await puertoCerrado();
  guardarArchivo(TOKEN, cerrado);
  const r = await ejecutar(["subir", archivo("a.drawio", DRAWIO), ...OPC], { portal: cerrado });
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /No se pudo conectar/);
  assert.ok(r.stderr.includes(cerrado), "dice a qué portal");
  assert.doesNotMatch(r.stderr, /\n\s+at /, "sin traza de pila");
});
