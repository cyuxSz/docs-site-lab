// C1 importar: fflate vendorizado (public/vendor/fflate) y lectura del zip con límites (src/lib/importar-zip.ts).
// leerZip(bytes, fflate, limites?) → Promise<{ ok: true, entradas: [{ ruta, tipo, bytes }], avisos: [{ ruta, motivo }] } | { ok: false, error }>
// El módulo fflate va inyectado: aquí se importa el archivo de public/vendor y se envuelve para vigilar cómo se usa.
// Los zips de prueba los fabrica tests/fixtures/zip-falso.mjs con node:zlib (sin fflate), incluidos los tramposos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { crearZip } from "./fixtures/zip-falso.mjs";

const VENDOR = "public/vendor/fflate/fflate.js";
// fflate 0.8.2 (npm), archivo esm/browser.js sin modificar: 89 198 bytes.
const SHA_FFLATE = "8cc1f687e0159e977addb6b85e274dbd11e622cf151f4fcb7b85d49622ea43e7";
const MB = 1024 * 1024;
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const existe = (rel) => existsSync(new URL(`../${rel}`, import.meta.url));
const texto = (b) => new TextDecoder().decode(b);

// Funciones de fflate que NO se pueden usar: las asíncronas crean Workers con blob: (la CSP los bloquea) y las «Sync»
// de un solo golpe inflan la entrada entera antes de poder cortar.
const PROHIBIDAS = ["unzip", "unzipSync", "inflate", "inflateSync", "decompress", "decompressSync", "gunzip", "gunzipSync", "unzlib", "unzlibSync", "AsyncUnzipInflate", "AsyncInflate", "AsyncDecompress", "AsyncGunzip", "AsyncUnzlib"];

// Módulo fflate vigilado: cuenta los bytes comprimidos que se le empujan y el trozo más grande, y revienta si se llama
// a una función prohibida.
async function vigilado() {
  assert.ok(existe(VENDOR), `falta ${VENDOR}`);
  const F = await import(`../${VENDOR}`);
  const uso = { empujado: 0, trozoMax: 0, prohibidas: [] };
  const contar = (trozo) => {
    uso.empujado += trozo.length;
    uso.trozoMax = Math.max(uso.trozoMax, trozo.length);
  };
  const envolver = (Clase) =>
    class extends Clase {
      push(trozo, final) {
        contar(trozo);
        return super.push(trozo, final);
      }
    };
  const fflate = { ...F, Inflate: envolver(F.Inflate), Unzip: envolver(F.Unzip), UnzipInflate: envolver(F.UnzipInflate) };
  for (const nombre of PROHIBIDAS) {
    fflate[nombre] = () => {
      uso.prohibidas.push(nombre);
      throw new Error(`fflate.${nombre} no se puede usar`);
    };
  }
  return { fflate, uso };
}

async function modulo() {
  assert.ok(existe("src/lib/importar-zip.ts"), "falta src/lib/importar-zip.ts");
  return import("../src/lib/importar-zip.ts");
}

async function abrir(zip, limites) {
  const { leerZip } = await modulo();
  const { fflate, uso } = await vigilado();
  const r = await leerZip(zip, fflate, limites);
  assert.deepEqual(uso.prohibidas, [], "solo la API síncrona por trozos de fflate");
  return { r, uso };
}
const rutas = (r) => r.entradas.map((e) => e.ruta);
// Todos los mensajes que vería el usuario: el error del zip o los motivos de los avisos.
const mensajes = (r) => (r.ok ? r.avisos.map((a) => `${a.ruta}: ${a.motivo}`) : [r.error]).join("\n");
const hayAviso = (r, ruta, re) => r.avisos.some((a) => a.ruta === ruta && re.test(a.motivo));

// ---------- vendor, dependencias y CSP ----------

test("vendor: fflate.js es el esm/browser.js de fflate 0.8.2 sin modificar (sha256 fijado) y lleva su LICENSE MIT con la procedencia", () => {
  assert.ok(existe(VENDOR), `falta ${VENDOR}`);
  const js = readFileSync(new URL(`../${VENDOR}`, import.meta.url));
  assert.equal(js.length, 89198);
  assert.equal(createHash("sha256").update(js).digest("hex"), SHA_FFLATE);
  assert.ok(existe("public/vendor/fflate/LICENSE"), "falta public/vendor/fflate/LICENSE");
  const lic = leer("public/vendor/fflate/LICENSE");
  assert.match(lic, /MIT License/);
  assert.match(lic, /Copyright \(c\) 2023 Arjun Barrett/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
  assert.match(lic, /fflate/);
  assert.match(lic, /0\.8\.2/);
  assert.match(lic, /esm\/browser\.js/);
  assert.ok(lic.includes(SHA_FFLATE), "la nota de procedencia cita el sha256");
});

test("sin dependencia npm nueva: fflate no aparece en package.json ni en package-lock.json", () => {
  assert.doesNotMatch(leer("package.json"), /fflate/i);
  assert.doesNotMatch(leer("package-lock.json"), /fflate/i);
});

test("la CSP no cambia: sin worker-src, blob: solo en img-src y los mismos orígenes de siempre", async () => {
  const csp = (await import("../astro.config.mjs")).default.security.csp;
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.directives, ["default-src 'self'", "img-src 'self' data: blob:", "connect-src 'self'", "frame-src 'self' https://embed.diagrams.net", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]);
});

test("importar-zip.ts no importa fflate por su cuenta (va inyectado) ni usa Workers, blob: ni las funciones de un solo golpe", async () => {
  await modulo();
  const src = leer("src/lib/importar-zip.ts");
  assert.doesNotMatch(src, /from\s+["'][^"']*fflate|import\s*\(/, "fflate entra como parámetro");
  assert.doesNotMatch(src, /\bnew\s+Worker\b|createObjectURL|blob:/);
  for (const nombre of PROHIBIDAS) assert.doesNotMatch(src, new RegExp(`\\.${nombre}\\b`), nombre);
});

// ---------- lectura normal ----------

test("leerZip: devuelve los .md y las imágenes (deflate y stored) con su ruta normalizada y su tipo", async () => {
  const png = new Uint8Array(3000).map((_, i) => i % 251);
  const zip = crearZip([
    { nombre: "docs/", datos: "", metodo: 0 },
    { nombre: "docs/guia.md", datos: "# Guía\n\n![v](img/vista.png)\n" },
    { nombre: "docs\\img\\vista.png", datos: png, metodo: 0 },
    { nombre: "potencia.md", datos: "# Potencia\n".repeat(500) },
    { nombre: "logo.SVG", datos: "<svg xmlns='http://www.w3.org/2000/svg'/>" },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(r.entradas.map((e) => [e.ruta, e.tipo]), [["docs/guia.md", "md"], ["docs/img/vista.png", "imagen"], ["potencia.md", "md"], ["logo.SVG", "imagen"]]);
  assert.equal(texto(r.entradas[0].bytes), "# Guía\n\n![v](img/vista.png)\n");
  assert.deepEqual([...r.entradas[1].bytes], [...png]);
  assert.equal(texto(r.entradas[2].bytes), "# Potencia\n".repeat(500));
  assert.deepEqual(r.avisos, []);
});

test("leerZip: lo que no es .md ni imagen NO se descomprime y se avisa; lo oculto y __MACOSX se ignoran en silencio", async () => {
  const basura = new Uint8Array(400).fill(0xff); // no es un flujo deflate válido: inflarlo daría error
  const zip = crearZip([
    { nombre: "plano.pdf", datos: "x".repeat(5000), crudo: basura },
    { nombre: "firmware.bin", datos: "x".repeat(5000), crudo: basura },
    { nombre: "__MACOSX/._a.md", datos: "x", crudo: basura },
    { nombre: ".git/config.md", datos: "x", crudo: basura },
    { nombre: "a.md", datos: "# A\n" },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["a.md"]);
  assert.equal(r.avisos.length, 2, mensajes(r));
  assert.ok(hayAviso(r, "plano.pdf", /tipo de archivo no admitido/) && hayAviso(r, "firmware.bin", /tipo de archivo no admitido/), mensajes(r));
});

test("leerZip: rutas maliciosas (.., absolutas, unidad, NUL, control) fuera con aviso; nunca llegan a las entradas", async () => {
  const md = "# Malo\n";
  const zip = crearZip([
    { nombre: "../../etc/fuera.md", datos: md },
    { nombre: "docs/../../fuera2.md", datos: md },
    { nombre: "/abs.md", datos: md },
    { nombre: "C:\\Windows\\win.md", datos: md },
    { nombre: "nul\u0000.md", datos: md },
    { nombre: "salto\n.md", datos: md },
    { nombre: "..\\img\\x.png", datos: new Uint8Array(10) },
    { nombre: "bien.md", datos: "# Bien\n" },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["bien.md"]);
  assert.equal(r.avisos.length, 7, mensajes(r));
  for (const a of r.avisos) assert.match(a.motivo, /ruta no permitida/, a.ruta);
});

test("leerZip: nombres repetidos tras normalizar, o que solo difieren en mayúsculas: gana el primero y los demás se avisan", async () => {
  const zip = crearZip([
    { nombre: "docs/guia.md", datos: "# Primera\n" },
    { nombre: "docs\\guia.md", datos: "# Segunda\n" },
    { nombre: "./docs/GUIA.md", datos: "# Tercera\n" },
    { nombre: "img/a.png", datos: new Uint8Array([1]) },
    { nombre: "IMG/A.PNG", datos: new Uint8Array([2]) },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["docs/guia.md", "img/a.png"]);
  assert.equal(texto(r.entradas[0].bytes), "# Primera\n");
  assert.deepEqual([...r.entradas[1].bytes], [1]);
  assert.equal(r.avisos.filter((a) => /nombre repetido/.test(a.motivo)).length, 3, mensajes(r));
});

test("leerZip: un nombre de entrada que no es UTF-8 se acepta si cumple las reglas de ruta", async () => {
  const cafe = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x2e, 0x6d, 0x64]); // "café.md" en latin-1, sin el bit de UTF-8
  const { r } = await abrir(crearZip([{ nombre: cafe, datos: "# Café\n" }]));
  assert.equal(r.ok, true, mensajes(r));
  assert.equal(r.entradas.length, 1);
  assert.equal(r.entradas[0].tipo, "md");
  assert.match(r.entradas[0].ruta, /^caf.+\.md$/);
  assert.equal(texto(r.entradas[0].bytes), "# Café\n");
});

// ---------- límites ----------

test("límite del zip: más de 50 MB se rechaza sin abrirlo; en el borde entra", async () => {
  const { LIMITES } = await import("../src/lib/importar-plan.ts");
  const { r, uso } = await abrir(new Uint8Array(LIMITES.zip + 1));
  assert.equal(r.ok, false);
  assert.match(r.error, /50 MB/);
  assert.equal(uso.empujado, 0);
  const dentro = crearZip([{ nombre: "a.md", datos: "# A\n" }]);
  assert.equal((await abrir(dentro, { zip: dentro.length })).r.ok, true);
  const fuera = await abrir(dentro, { zip: dentro.length - 1 });
  assert.equal(fuera.r.ok, false);
});

test("límite de entradas: 500 entran, 501 rechazan el zip entero", async () => {
  const hacer = (n) => crearZip(Array.from({ length: n }, (_, i) => ({ nombre: `notas/n${i}.txt`, datos: "x", metodo: 0 })).concat([{ nombre: "a.md", datos: "# A\n" }]));
  const justo = await abrir(hacer(499));
  assert.equal(justo.r.ok, true, mensajes(justo.r));
  assert.deepEqual(rutas(justo.r), ["a.md"]);
  const pasado = await abrir(hacer(500));
  assert.equal(pasado.r.ok, false);
  assert.match(pasado.r.error, /500/);
});

test("límite por .md: 200 KB descomprimidos justos entran; un byte más se omite con aviso y el resto del zip sigue", async () => {
  const { LIMITES } = await import("../src/lib/importar-plan.ts");
  const zip = crearZip([
    { nombre: "justo.md", datos: "a".repeat(LIMITES.md) },
    { nombre: "pasado.md", datos: "a".repeat(LIMITES.md + 1) },
    { nombre: "despues.md", datos: "# Después\n" },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["justo.md", "despues.md"]);
  assert.equal(r.entradas[0].bytes.length, LIMITES.md);
  assert.ok(hayAviso(r, "pasado.md", /200 KB/), mensajes(r));
});

test("límite por imagen: 10 MB justos entran; un byte más se omite con aviso", async () => {
  const { LIMITES } = await import("../src/lib/importar-plan.ts");
  const zip = crearZip([
    { nombre: "justa.png", datos: new Uint8Array(LIMITES.imagen) },
    { nombre: "pasada.png", datos: new Uint8Array(LIMITES.imagen + 1) },
    { nombre: "a.md", datos: "# A\n" },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["justa.png", "a.md"]);
  assert.equal(r.entradas[0].bytes.length, LIMITES.imagen);
  assert.ok(hayAviso(r, "pasada.png", /10 MB/), mensajes(r));
});

test("límite total descomprimido: en el borde entra; al pasarse se rechaza el zip entero", async () => {
  const zip = crearZip([
    { nombre: "a.md", datos: "a".repeat(600) },
    { nombre: "b.png", datos: new Uint8Array(400) },
    { nombre: "ignorado.bin", datos: new Uint8Array(100000) },
  ]);
  const justo = await abrir(zip, { total: 1000 });
  assert.equal(justo.r.ok, true, "lo que no se descomprime no cuenta para el total");
  const pasado = await abrir(zip, { total: 999 });
  assert.equal(pasado.r.ok, false);
  assert.match(pasado.r.error, /descomprimid/);
});

// ---------- bombas de descompresión ----------

test("tamaño declarado que miente: el límite se aplica a los bytes realmente inflados, no a la cabecera", async () => {
  const zip = crearZip([
    { nombre: "mentira.md", datos: "a".repeat(300 * 1024), declarado: 10 },
    { nombre: "mentira.png", datos: new Uint8Array(12 * MB), declarado: 1 },
    { nombre: "bien.md", datos: "# Bien\n" },
  ]);
  const { r } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["bien.md"]);
  // Vale cortar por el límite o, más estricto, en cuanto se pasa de lo declarado (entrada dañada).
  assert.ok(hayAviso(r, "mentira.md", /200 KB|dañad/) && hayAviso(r, "mentira.png", /10 MB|dañad/), mensajes(r));
});

test("bomba de descompresión: se corta en cuanto se pasa el límite (no se infla entera) y se alimenta a fflate en trozos ≤ 64 KB", async () => {
  // 200 MB de ceros caben en ~200 KB comprimidos. Cortar de verdad es dejar de empujar bytes comprimidos al inflador.
  const zip = crearZip([
    { nombre: "bomba.png", datos: new Uint8Array(200 * MB) },
    { nombre: "bien.md", datos: "# Bien\n" },
  ]);
  const { r, uso } = await abrir(zip);
  assert.equal(r.ok, true, mensajes(r));
  assert.deepEqual(rutas(r), ["bien.md"]);
  assert.ok(hayAviso(r, "bomba.png", /10 MB/), mensajes(r));
  assert.ok(uso.empujado > 0, "se usa Inflate (o Unzip) del módulo inyectado");
  assert.ok(uso.trozoMax <= 64 * 1024, `trozo más grande empujado a fflate: ${uso.trozoMax} bytes`);
  assert.ok(uso.empujado < zip.length / 2, `se empujaron ${uso.empujado} de ${zip.length} bytes: la bomba se infló (casi) entera`);
});

test("bomba por acumulación: muchas entradas muy compresibles se cortan al pasar el total descomprimido", async () => {
  const ceros = new Uint8Array(4 * MB);
  const zip = crearZip(Array.from({ length: 12 }, (_, i) => ({ nombre: `img/${i}.png`, datos: ceros })));
  const { r, uso } = await abrir(zip, { total: 10 * MB });
  assert.equal(r.ok, false);
  assert.match(r.error, /descomprimid/);
  assert.ok(uso.empujado < zip.length / 2, `se empujaron ${uso.empujado} de ${zip.length} bytes`);
});

// ---------- zips que no se admiten ----------

test("entrada cifrada, zip64 o con un método que no es stored/deflate: se rechaza con mensaje claro y nunca se entrega", async () => {
  const casos = [
    [{ nombre: "secreto.md", datos: "# Secreto\n", cifrado: true }, /cifrad/i],
    [{ nombre: "enorme.md", datos: "# Enorme\n", zip64: true }, /zip64/i],
    [{ nombre: "raro.md", datos: "# Raro\n", metodo: 12 }, /compresi/i],
    [{ nombre: "raro.png", datos: new Uint8Array(50), metodo: 93 }, /compresi/i],
  ];
  for (const [entrada, re] of casos) {
    const { r } = await abrir(crearZip([entrada, { nombre: "bien.md", datos: "# Bien\n" }]));
    assert.match(mensajes(r), re, entrada.nombre);
    if (r.ok) assert.deepEqual(rutas(r), ["bien.md"], entrada.nombre);
  }
});

test("zip corrupto: error claro, sin excepciones sin capturar", async () => {
  const bueno = crearZip([{ nombre: "a.md", datos: "# A\n".repeat(2000) }, { nombre: "b.md", datos: "# B\n" }]);
  const ruido = new Uint8Array(5000).map((_, i) => (i * 37 + 11) % 256);
  const corruptos = [
    new Uint8Array(0),
    new TextEncoder().encode("esto no es un zip"),
    ruido,
    bueno.slice(0, Math.floor(bueno.length / 2)), // truncado: sin directorio central
    bueno.slice(0, bueno.length - 10), // fin del directorio central cortado
  ];
  for (const [i, zip] of corruptos.entries()) {
    const { r } = await abrir(zip);
    assert.equal(r.ok, false, `caso ${i}`);
    assert.ok(typeof r.error === "string" && r.error.length > 0 && !/undefined|\[object|at .+:\d+/.test(r.error), `caso ${i}: ${r.error}`);
  }
});

test("datos comprimidos rotos en una entrada: esa entrada se omite con aviso (o se rechaza el zip), sin lanzar", async () => {
  const zip = crearZip([
    { nombre: "rota.md", datos: "# Rota\n".repeat(50), crudo: new Uint8Array(300).fill(0xff) },
    { nombre: "bien.md", datos: "# Bien\n" },
  ]);
  const { r } = await abrir(zip);
  assert.match(mensajes(r), /dañad/i);
  if (r.ok) assert.deepEqual(rutas(r), ["bien.md"]);
});
