// Lote d-modelo-3d: lo que rodea al visor 3D. three.js vendorizado (sha fijado, sin dependencia npm), CSP sin cambios,
// estilos, sexto ítem del menú «Insertar» (sube el STL o GLB e inserta el bloque ```modelo) y la API de archivos.
// El paquete de 646 KB solo se lee como texto: aquí no se ejecuta three.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { crearD1 } from "./fixtures/d1-sqlite.mjs";
import { EXPORTS_THREE, glb, stlBinario } from "./fixtures/three-falso.mjs";
import PROYECTOS_REALES from "../projects.json" with { type: "json" };

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const url = (rel) => new URL(`../${rel}`, import.meta.url);
const leer = (rel) => readFileSync(url(rel), "utf8");
const existe = (rel) => existsSync(url(rel));
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const MB = 1024 * 1024;

// ---------- 1. three.js vendorizado ----------

const VENDOR = "public/vendor/three/three-visor.js";
// three.js 0.187.0 (r187) empaquetado con esbuild desde tools/vendor-three/entrada.js; ver tools/vendor-three/README.md.
const SHA_THREE = "3ec0656145b934c9f0c1b5f009df4e2cf1a11aeb17c39158b53c885743e0caa8";
const BYTES_THREE = 645621;

test("vendor: three-visor.js es el paquete construido (sha256 y tamaño fijados, byte a byte)", () => {
  assert.ok(existe(VENDOR), `falta ${VENDOR}`);
  const bytes = readFileSync(url(VENDOR));
  assert.equal(bytes.length, BYTES_THREE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), SHA_THREE);
  assert.match(leer(".gitattributes"), /^public\/vendor\/\*\* -text\r?$/m, "git no debe convertir los finales de línea del paquete");
});

test("vendor: banner de three.js r187 (MIT), exporta justo lo que usa el visor y no trae eval, Function, workers, WASM ni URLs ajenas", () => {
  assert.ok(existe(VENDOR), `falta ${VENDOR}`);
  const js = leer(VENDOR);
  assert.match(js, /^\/\* three\.js r187 \(0\.187\.0, MIT, https:\/\/github\.com\/mrdoob\/three\.js\)/);
  const lista = /export\{([^}]*)\};?\s*$/.exec(js)?.[1] ?? "";
  const exportados = lista.split(",").map((p) => p.split(" as ")[1] ?? p).sort();
  assert.deepEqual(exportados, [...EXPORTS_THREE].sort());
  for (const re of [/\beval\s*\(/, /new\s+Function\b/, /new\s+Worker\b/, /importScripts/, /WebAssembly/, /sourceMappingURL/, /\bimport\s*\(/, /XMLHttpRequest/, /document\.write/]) {
    assert.doesNotMatch(js, re, String(re));
  }
  const urls = [...new Set(js.match(/https?:\/\/[^\s"'`)\\<>]+/g) ?? [])].sort();
  assert.deepEqual(urls, ["http://www.w3.org/1999/xhtml", "https://github.com/mrdoob/three.js"]);
});

test("vendor: LICENSE MIT de three.js junto al paquete; entrada de esbuild y README de cómo se regenera", () => {
  assert.ok(existe("public/vendor/three/LICENSE"), "falta public/vendor/three/LICENSE");
  const lic = leer("public/vendor/three/LICENSE");
  assert.match(lic, /The MIT License/);
  assert.match(lic, /three\.js authors/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
  assert.ok(existe("tools/vendor-three/entrada.js"), "falta tools/vendor-three/entrada.js");
  const entrada = leer("tools/vendor-three/entrada.js");
  assert.match(entrada, /from "three"/);
  assert.match(entrada, /three\/addons\/loaders\/STLLoader\.js/);
  assert.match(entrada, /three\/addons\/loaders\/GLTFLoader\.js/);
  assert.match(entrada, /three\/addons\/controls\/OrbitControls\.js/);
  assert.doesNotMatch(entrada, /DRACOLoader|KTX2Loader|meshopt/i);
  assert.ok(existe("tools/vendor-three/README.md"), "falta tools/vendor-three/README.md");
  const readme = leer("tools/vendor-three/README.md");
  assert.match(readme, /three@0\.187\.0/);
  assert.ok(readme.includes("sha512-Qiu7R+Cmh8CstZsY1uJOSWnVlfo7ZtNLV7mF8Jltk3LB3AtDu9cRZlcnRKkAk8Y4z6KKw35z7Y7Urd7jWY8etA=="), "integridad del tarball de npm");
  assert.match(readme, /--legal-comments=none/);
  assert.match(readme, /--format=esm/);
  assert.ok(readme.includes(SHA_THREE), "sha256 del paquete resultante");
});

test("dependencias: three no entra por npm (package.json y package-lock.json sin three) ni se importa de forma estática en src/", () => {
  const pkg = JSON.parse(leer("package.json"));
  for (const grupo of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const nombre of Object.keys(pkg[grupo] ?? {})) assert.doesNotMatch(nombre, /^(three|@types\/three|three-stdlib|@google\/model-viewer|@babylonjs\/.*)$/, `${grupo}: ${nombre}`);
  }
  assert.doesNotMatch(leer("package-lock.json"), /"node_modules\/(three|@types\/three|@google\/model-viewer)"/);
  for (const rel of ["src/lib/modelo-visor.ts", "src/lib/hardware-md.ts", "src/lib/visores.ts", "src/scripts/hardware-insertar-modelo.ts"]) {
    assert.ok(existe(rel), `falta ${rel}`);
    assert.doesNotMatch(leer(rel), /from\s+["']three|import\(\s*["']three/, rel);
  }
});

// ---------- 2. CSP: no se toca ----------

test("CSP: idéntica a la de antes del lote (sin worker-src, blob: solo en img-src, connect-src 'self', script-src sin orígenes nuevos)", async () => {
  const config = (await import("../astro.config.mjs")).default;
  const csp = config.security.csp;
  assert.deepEqual(csp.scriptDirective.resources, ["'self'", "'wasm-unsafe-eval'"]);
  assert.equal(csp.scriptDirective.hashes.length, 1, "solo el hash del script del tema");
  assert.deepEqual(csp.styleDirective.resources, ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.directives, [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self' https://embed.diagrams.net",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]);
  assert.doesNotMatch(JSON.stringify(csp), /worker-src|child-src|threejs|unpkg|jsdelivr|cdnjs/);
  // Las cabeceras del Worker tampoco ganan nada para el visor.
  const worker = leer("worker/index.mjs") + leer("lib/archivos-core.mjs");
  assert.doesNotMatch(worker, /worker-src|vendor\/three/);
});

// ---------- 3. Estilos ----------

// Reglas de primer nivel o dentro de @media: [{ selector, cuerpo, media }]
function reglas(css) {
  const out = [];
  const re = /@media([^{]*)\{((?:[^{}]*\{[^{}]*\})*)\s*\}|([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1] !== undefined) {
      const media = m[1].trim();
      const r2 = /([^{}]+)\{([^{}]*)\}/g;
      let n;
      while ((n = r2.exec(m[2]))) out.push({ selector: n[1].trim(), cuerpo: n[2], media });
    } else out.push({ selector: m[3].trim(), cuerpo: m[4], media: null });
  }
  return out;
}
const prop = (cuerpo, p) => new RegExp(`(?:^|;|\\s)${p}\\s*:\\s*([^;]+)`).exec(cuerpo)?.[1].trim().replace(/\s+/g, " ") ?? null;
const CSS = sinComentarios(leer("src/styles/global.css"));
const R = reglas(CSS);
// Último valor de `p` entre las reglas con alguna parte del selector (separado por comas) que cumpla `re`, en ese @media (null = sin media).
function valor(re, p, media = null) {
  let v = null;
  for (const r of R) {
    if (media === null ? r.media !== null : !(r.media !== null && media.test(r.media))) continue;
    if (!r.selector.split(",").some((s) => re.test(s.trim()))) continue;
    v = prop(r.cuerpo, p) ?? v;
  }
  return v;
}
const FIG = /^figure\.hw-modelo$/;
const LIENZO = /^figure\.hw-modelo canvas$/;
const MARCADOR = /^figure\.hw-modelo \.hw-modelo-cargando$/;

test("estilos: figure.hw-modelo igual que hw-kicad (tokens del sitio) y sin desborde", () => {
  assert.equal(valor(FIG, "margin"), "1.5em 0");
  assert.equal(valor(FIG, "padding"), "12px");
  assert.equal(valor(FIG, "border"), "1px solid var(--line)");
  assert.equal(valor(FIG, "border-radius"), "var(--radius)");
  assert.equal(valor(FIG, "background"), "var(--surface)");
  assert.equal(valor(FIG, "color"), "var(--text)");
  assert.equal(valor(FIG, "min-width"), "0");
  assert.equal(valor(FIG, "max-width"), "100%");
  assert.equal(valor(/^figure\.hw-modelo > a$/, "display"), "inline-block");
  assert.equal(valor(/^figure\.hw-modelo figcaption$/, "color"), "var(--muted)");
  assert.equal(valor(/^figure\.hw-modelo \[role="status"\]$/, "color"), "var(--muted)");
});

test("estilos: lienzo y marcador de carga miden lo mismo (sin salto de maquetación), en escritorio y en móvil", () => {
  for (const [nombre, sel] of [["lienzo", LIENZO], ["marcador", MARCADOR]]) {
    assert.match(valor(sel, "display") ?? "", nombre === "lienzo" ? /^block$/ : /^(block|grid|flex)$/, `${nombre}: caja de bloque`);
    assert.equal(valor(sel, "width"), "100%", nombre);
    assert.equal(valor(sel, "height"), "min(60vh, 520px)", nombre);
    assert.equal(valor(sel, "min-height"), "280px", nombre);
    assert.equal(valor(sel, "border"), "1px solid var(--line)", nombre);
    assert.equal(valor(sel, "border-radius"), "4px", nombre);
    assert.equal(valor(sel, "height", /max-width:\s*600px/), "min(55vh, 380px)", `${nombre} en móvil`);
    assert.equal(valor(sel, "min-height", /max-width:\s*600px/), "240px", `${nombre} en móvil`);
  }
  assert.equal(valor(MARCADOR, "color"), "var(--muted)");
  assert.match(CSS, /\*\s*\{\s*box-sizing:\s*border-box;?\s*\}/, "el borde no suma al 100% de ancho");
});

test("estilos: foco visible del lienzo como en el resto del sitio, cursor de arrastre y ayuda de teclas solo con :focus-visible", () => {
  const foco = /^figure\.hw-modelo canvas:focus-visible$/;
  assert.equal(valor(foco, "outline"), "2px solid var(--accent)");
  assert.equal(valor(foco, "outline-offset"), "2px");
  assert.equal(valor(LIENZO, "cursor"), "grab");
  assert.equal(valor(/^figure\.hw-modelo canvas:active$/, "cursor"), "grabbing");
  // La ayuda ocupa siempre su línea (visibility, no display): al enfocar no hay salto de maquetación.
  assert.equal(valor(/^figure\.hw-modelo \.hw-modelo-ayuda$/, "visibility"), "hidden");
  assert.equal(valor(/^figure\.hw-modelo canvas:focus-visible\s*[+~]\s*\.hw-modelo-ayuda$/, "visibility"), "visible");
  assert.equal(valor(/^figure\.hw-modelo \.hw-modelo-ayuda$/, "color"), "var(--muted)");
  const botonFoco = /^figure\.hw-modelo > \.btn:focus-visible$/;
  assert.equal(valor(botonFoco, "outline"), "2px solid var(--accent)");
});

test("estilos: nada de animation ni transition en .hw-modelo; al imprimir se oculta el lienzo y el botón y queda el enlace", () => {
  const propias = R.filter((r) => /hw-modelo/.test(r.selector));
  assert.ok(propias.length >= 6, "reglas de .hw-modelo en global.css");
  for (const r of propias) assert.doesNotMatch(r.cuerpo, /\b(animation|transition)\b/, r.selector);
  const print = /^print$/;
  assert.equal(valor(/^figure\.hw-modelo \[role="region"\]$/, "display", print), "none", "@media print: sin lienzo (un canvas WebGL sale en blanco)");
  assert.equal(valor(/^figure\.hw-modelo > \.btn$/, "display", print), "none", "@media print: sin botón");
});

// ---------- 4. Editor: sexto ítem del menú «Insertar» ----------

const PAGINA = leer("src/pages/[project]/[disciplina].astro");

test("página de hardware: ítem «Modelo 3D (STL o GLB)» después del de KiCad, con su input de un solo archivo", () => {
  const boton = /<button type="button" class="btn" data-hw-insertar-modelo role="menuitem" tabindex="-1">Modelo 3D \(STL o GLB\)<\/button>/;
  assert.match(PAGINA, boton);
  assert.ok(PAGINA.search(boton) > PAGINA.indexOf("data-hw-insertar-kicad"), "va después de KiCad");
  const input = PAGINA.match(/<input type="file"[^>]*data-hw-archivo-modelo[^>]*>/)?.[0] ?? "";
  assert.ok(input, "input data-hw-archivo-modelo");
  assert.match(input, /class="hw-archivo"/);
  assert.match(input, /accept="\.stl,\.glb,model\/stl,model\/gltf-binary"/);
  assert.match(input, /tabindex="-1"/);
  assert.match(input, /aria-hidden="true"/);
  assert.doesNotMatch(input, /\bmultiple\b/, "un solo archivo");
});

test("script del editor: conecta el ítem con conectarInsertarModelo y lo trata igual que KiCad (disabled, hidden, modo visual)", () => {
  const s = leer("src/scripts/hardware-editor.ts");
  assert.match(s, /import\s*\{[^}]*\bconectarInsertarModelo\b[^}]*\}\s*from\s*["']\.\/hardware-insertar-modelo["']/);
  assert.match(s, /conectarInsertarModelo\(/);
  assert.match(s, /btnInsertarModelo\s*=\s*\$<HTMLButtonElement>\("\[data-hw-insertar-modelo\]"\)/);
  assert.match(s, /\$<HTMLInputElement>\("\[data-hw-archivo-modelo\]"\)/);
  assert.match(s, /btnInsertarModelo\.disabled = insercionBloqueada\(guardando, cargandoVisual\)/);
  assert.match(s, /btnInsertarModelo\.hidden = !lado && modo !== "escribir"/);
  assert.match(s, /for \(const x of \[[^\]]*btnInsertarKicad, btnInsertarModelo\]\) x\.hidden = false/);
  // La lógica vive en el módulo aparte: el script no valida ni arma el bloque, ni crea el lienzo.
  assert.doesNotMatch(s, /archivoModelo\(|bloqueModelo\(/);
  assert.doesNotMatch(s, /createElement\(\s*["']canvas["']\s*\)/);
  assert.doesNotMatch(s, /three-visor|vendor\/three/);
  assert.doesNotMatch(s, /\.innerHTML\s*=/);
});

// Conexión de prueba: botón e input reales (jsdom) y el resto del editor como dobles que anotan.
function conexion({ guardando = false, subeBien = true } = {}) {
  const win = new JSDOM('<!doctype html><html><body><button type="button" data-hw-insertar-modelo>Modelo 3D (STL o GLB)</button><input type="file" data-hw-archivo-modelo /></body></html>', { url: "https://docs.example/uuv/mecanica/" }).window;
  const boton = win.document.querySelector("button");
  const input = win.document.querySelector("input");
  const log = { clics: 0, subidas: [], bloques: [], errores: [], activas: [], enfoques: 0, estado: { guardando } };
  input.click = () => log.clics++;
  const o = {
    boton,
    input,
    escuchar: (el, tipo, fn) => el.addEventListener(tipo, fn),
    guardando: () => log.estado.guardando,
    subir: async (archivo, bloque) => {
      log.subidas.push({ archivo, tipos: bloque.tipos });
      if (!subeBien) return false;
      bloque.alSubir(B);
      return true;
    },
    insertar: (bloque) => log.bloques.push(bloque),
    error: (texto) => log.errores.push(texto),
    subidas: (delta) => log.activas.push(delta),
    enfocar: () => log.enfoques++,
  };
  const elegir = async (archivos) => {
    Object.defineProperty(input, "files", { value: archivos, configurable: true });
    input.dispatchEvent(new win.Event("change", { bubbles: true }));
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  };
  return { win, boton, input, log, o, elegir };
}
const insertar = () => import("../src/scripts/hardware-insertar-modelo.ts");

test("conectarInsertarModelo: el ítem abre el selector de archivos (salvo mientras se guarda)", async () => {
  const { conectarInsertarModelo } = await insertar();
  const c = conexion();
  conectarInsertarModelo(c.o);
  c.boton.click();
  assert.equal(c.log.clics, 1);
  c.log.estado.guardando = true;
  c.boton.click();
  assert.equal(c.log.clics, 1, "guardando: no abre el selector");
});

test("conectarInsertarModelo: sube el archivo (tipos stl y glb) e inserta ```modelo con el uuid y el título del nombre", async () => {
  const { conectarInsertarModelo } = await insertar();
  const { parsearModelo } = await import("../src/lib/visores.ts");
  const c = conexion();
  conectarInsertarModelo(c.o);
  const archivo = { name: "Carcasa del casco.STL", size: 1234 };
  await c.elegir([archivo]);
  assert.equal(c.log.subidas.length, 1);
  assert.equal(c.log.subidas[0].archivo, archivo);
  assert.deepEqual(c.log.subidas[0].tipos, ["stl", "glb"]);
  assert.deepEqual(c.log.bloques, [`\`\`\`modelo\narchivo: ${B}\ntitulo: Carcasa del casco\n\`\`\`\n`]);
  assert.deepEqual(parsearModelo(c.log.bloques[0].replace(/^```modelo\n/, "").replace(/```\n$/, "")), { archivo: B, titulo: "Carcasa del casco" });
  assert.deepEqual(c.log.errores.filter(Boolean), []);
  assert.deepEqual(c.log.activas, [1, -1], "cuenta como subida activa mientras dura (bloquea Guardar)");
  assert.equal(c.log.enfoques, 1, "al terminar devuelve el foco al editor");
  assert.equal(c.input.value, "", "el input queda vacío para poder elegir el mismo archivo otra vez");
});

test("conectarInsertarModelo: archivo no válido o de más de 20 MB → error en el editor, sin subir ni insertar nada", async () => {
  const { conectarInsertarModelo } = await insertar();
  const casos = [
    [[{ name: "pieza.step", size: 10 }], /\.stl.*\.glb|\.glb.*\.stl/],
    [[{ name: "a.stl", size: 10 }, { name: "b.glb", size: 10 }], /\.stl.*\.glb|\.glb.*\.stl/],
    [[{ name: "enorme.glb", size: 20 * MB + 1 }], /^El visor muestra modelos de hasta 20 MB\. Súbelo con "Adjuntar archivo"\.$/],
  ];
  for (const [archivos, re] of casos) {
    const c = conexion();
    conectarInsertarModelo(c.o);
    await c.elegir(archivos);
    assert.equal(c.log.subidas.length, 0, "no se sube");
    assert.equal(c.log.bloques.length, 0, "no se inserta");
    assert.deepEqual(c.log.activas, [], "no cuenta como subida");
    assert.match(c.log.errores.at(-1) ?? "", re);
  }
});

test("conectarInsertarModelo: si la subida falla no inserta el bloque y libera la subida activa; guardando o sin archivo no hace nada", async () => {
  const { conectarInsertarModelo } = await insertar();
  const falla = conexion({ subeBien: false });
  conectarInsertarModelo(falla.o);
  await falla.elegir([{ name: "casco.glb", size: 10 }]);
  assert.equal(falla.log.subidas.length, 1);
  assert.equal(falla.log.bloques.length, 0);
  assert.deepEqual(falla.log.activas, [1, -1]);
  const ocupado = conexion({ guardando: true });
  conectarInsertarModelo(ocupado.o);
  await ocupado.elegir([{ name: "casco.glb", size: 10 }]);
  assert.equal(ocupado.log.subidas.length, 0);
  assert.deepEqual(ocupado.log.activas, []);
  const vacio = conexion();
  conectarInsertarModelo(vacio.o);
  await vacio.elegir([]);
  assert.equal(vacio.log.subidas.length, 0);
  assert.deepEqual(vacio.log.errores.filter(Boolean), []);
});

// ---------- 5. API de archivos (sin cambios: ya admite stl y glb) ----------

const SECRET = "s".repeat(40);
const ORIGIN = "https://docs-site-lab.ejemplo.workers.dev";
const realFetch = globalThis.fetch;
let db;
beforeEach(() => {
  db = crearD1();
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
function fakeR2() {
  const objetos = new Map();
  return {
    async put(key, value, opciones = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objetos.set(key, { bytes, httpMetadata: { ...(opciones.httpMetadata ?? {}) } });
      return { key, size: bytes.length };
    },
    async get(key) {
      const o = objetos.get(key);
      return o ? { key, size: o.bytes.length, httpMetadata: o.httpMetadata, body: new Response(o.bytes).body } : null;
    },
    async delete(key) {
      objetos.delete(key);
    },
  };
}
const env = () => ({
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  SESSION_SECRET: SECRET,
  ALLOWED_ORG: "vanttec",
  ALLOWED_USERS: "",
  DB: db,
  ASSETS: { fetch: async () => new Response("<h1>asset</h1>", { headers: { "content-type": "text/html" } }) },
  ARCHIVOS: fakeR2(),
});
function sesion(login) {
  const body = Buffer.from(JSON.stringify({ login, exp: Date.now() + 864e5 })).toString("base64url");
  return `docs_session=${encodeURIComponent(`${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`)}`;
}
async function pedir(e, path, { login, method = "GET", headers = {}, body } = {}) {
  const worker = (await import("../worker/index.mjs")).crearWorker({ proyectos: PROYECTOS_REALES });
  const h = { ...headers };
  if (login) h.cookie = sesion(login);
  if (method !== "GET") h.origin = ORIGIN;
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body }), e, { waitUntil() {}, passThroughOnException() {} });
}
const qs = (o) => new URLSearchParams(o).toString();
const subir = (e, id, nombre, bytes) =>
  pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", disciplina: "mecanica", id, nombre })}`, {
    login: "cyuxSz",
    method: "POST",
    headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length) },
    body: bytes,
  });

test("Worker /api/archivos: sirve .stl y .glb como descarga (model/*, attachment, nosniff, no enmarcable) y exige sesión; el visor los lee con fetch", async () => {
  const e = env();
  const stl = new Uint8Array(stlBinario(2));
  const modelo = new Uint8Array(glb());
  assert.equal((await subir(e, A, "carcasa.stl", stl)).status, 201);
  assert.equal((await subir(e, B, "casco.glb", modelo)).status, 201);
  for (const [id, bytes, nombre, mime] of [[A, stl, "carcasa.stl", "model/stl"], [B, modelo, "casco.glb", "model/gltf-binary"]]) {
    const r = await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id })}`, { login: "ana" });
    assert.equal(r.status, 200, nombre);
    assert.equal(r.headers.get("content-type"), mime);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("content-disposition") ?? "", new RegExp(`^attachment; filename="${nombre.replace(".", "\\.")}"`));
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), bytes);
  }
  assert.equal((await pedir(e, `/api/archivos/?${qs({ proyecto: "uuv", id: A })}`)).status, 401);
});
