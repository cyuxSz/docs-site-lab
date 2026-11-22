// Lote d-modelo-3d, revisión de CodeRabbit sobre el PR 68 (commit 74c6235). Cuatro cosas:
//   1. Presupuesto de memoria de los accessors de un GLB (inspeccionarGlb, antes del loader).
//   2. Impresión con un modelo todavía sin cargar: el marcador «Cargando modelo 3D…» no sale en papel.
//   3. El paquete vendorizado solo pide un contexto «webgl2» (por eso soportaWebgl exige WebGL 2; ese test está en d-modelo-visor).
//   4. GLB válido con textura incrustada cargado con el GLTFLoader, el LoadingManager y el TextureLoader DE VERDAD (los del
//      paquete vendorizado), y revocación de las URL blob: de las imágenes cuando una no carga.
// El punto 4 es el único sitio donde los tests ejecutan código del paquete: solo los loaders, que no necesitan WebGL. El
// renderer, la cámara y los controles siguen siendo los del doble (tests/fixtures/three-falso.mjs). Node no decodifica
// imágenes: el <img> es un doble que avisa «load» o «error»; que la textura se vea de verdad queda para el navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { crearThreeFalso, glb, glbConTextura, PNG_1X1 } from "./fixtures/three-falso.mjs";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const md = () => import("../src/lib/hardware-md.ts");
const vis = () => import("../src/lib/visores.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const ventana = () => new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/mecanica/" }).window;
const bloque = (cuerpo) => "```modelo\n" + cuerpo + "\n```\n";
const src = (id) => `/api/archivos/?proyecto=uuv&id=${id}`;
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, mensaje, ms = 1500) {
  const fin = Date.now() + ms;
  for (;;) {
    const v = cond();
    if (v) return v;
    if (Date.now() > fin) assert.fail(`no ocurrió a tiempo: ${mensaje}`);
    await pausa(5);
  }
}
const aviso = (fig) => fig.querySelector(":scope > p[role=status]");
const GENERAL = "No se pudo mostrar el modelo 3D. Descarga el archivo para abrirlo en tu programa de CAD.";
const COMPLEJO = "El modelo es demasiado complejo para mostrarlo aquí. Descarga el archivo o expórtalo con menos detalle.";

// Pinta `texto` y monta los visores con la inyección `modelo`. Devuelve la primera figura.
async function montar(win, texto, modelo) {
  const { crearRenderizador, montarVisores } = await md();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
  await montarVisores(win.document.body, texto, { proyecto: "uuv", slug: "casco", vistaPrevia: false, descargar() {}, modelo });
  const fig = win.document.querySelector("figure.hw-modelo");
  assert.ok(fig, "el render debe dar figure.hw-modelo");
  return fig;
}

// ---------- 1. Presupuesto de memoria de los accessors ----------

const MB = 1024 * 1024;
const PRESUPUESTO = 64 * MB;
const TOPE_COUNT = 1_500_000; // 3 × MAX_TRIANGULOS_MODELO: tope por accessor, ya existente
const COMPONENTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const conAccessors = (accessors, extra = {}) => glb({ asset: { version: "2.0" }, accessors, ...extra });
// `elementos` repartidos en accessors de ese tipo, ninguno por encima del tope por accessor.
function repartir(elementos, type, componentType, extra = {}) {
  const lista = [];
  for (let quedan = elementos; quedan > 0; quedan -= TOPE_COUNT) lista.push({ componentType, type, count: Math.min(quedan, TOPE_COUNT), ...extra });
  return lista;
}

test("presupuesto de accessors: MAX_BYTES_ACCESSORS_GLB = 64 MB, más del triple de lo que cabe en un archivo de 20 MB", async () => {
  const v = await vis();
  assert.equal(v.MAX_BYTES_ACCESSORS_GLB, PRESUPUESTO);
  // Los bytes de un accessor con bufferView están en el propio archivo (≤ 20 MB): un modelo normal no se acerca al presupuesto.
  assert.ok(v.MAX_BYTES_ACCESSORS_GLB >= 3 * v.MAX_MODELO_VISOR);
  // Un accessor en el tope por elementos (posiciones de 500 000 triángulos sin índice) cabe de sobra.
  assert.ok(3 * v.MAX_TRIANGULOS_MODELO * 3 * 4 < v.MAX_BYTES_ACCESSORS_GLB);
});

test("inspeccionarGlb: complejo → la suma de bytes declarados por los accessors pasa de 64 MB aunque ninguno pase del tope por accessor", async () => {
  const { inspeccionarGlb } = await vis();
  const complejo = { ok: false, motivo: "complejo" };
  // El caso de la revisión: 128 accessors VEC3 de float con 1 500 000 elementos, sin bufferView (128 × 18 MB ≈ 2,3 GB a ceros).
  assert.deepEqual(inspeccionarGlb(conAccessors(repartir(128 * TOPE_COUNT, "VEC3", 5126))), complejo, "128 × 18 MB sin bufferView");
  // Cuatro de 18 MB (72 MB) ya pasan; tres (54 MB) caben.
  assert.deepEqual(inspeccionarGlb(conAccessors(repartir(4 * TOPE_COUNT, "VEC3", 5126))), complejo, "72 MB");
  assert.deepEqual(inspeccionarGlb(conAccessors(repartir(3 * TOPE_COUNT, "VEC3", 5126))), { ok: true }, "54 MB");
  // Cuentan todos: con bufferView (varios pueden compartir el mismo y, si son dispersos, el loader copia cada uno) y dispersos.
  assert.deepEqual(inspeccionarGlb(conAccessors(repartir(4 * TOPE_COUNT, "VEC3", 5126, { bufferView: 0 }))), complejo, "con bufferView");
  assert.deepEqual(inspeccionarGlb(conAccessors(repartir(4 * TOPE_COUNT, "VEC3", 5126, { bufferView: 0, sparse: { count: 1 } }))), complejo, "dispersos con bufferView");
  assert.deepEqual(inspeccionarGlb(conAccessors(repartir(4 * TOPE_COUNT, "VEC3", 5126, { sparse: { count: 1 } }))), complejo, "dispersos sin bufferView");
  // Un solo accessor dentro del tope por elementos puede pasar del presupuesto por su tipo: MAT4 de float son 64 bytes por elemento.
  assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType: 5126, type: "MAT4", count: TOPE_COUNT }])), complejo, "96 MB en un accessor");
  // Mezcla de tipos: 48 MB + 16 MB justos caben; un byte más, no.
  const mezcla = [...repartir(4 * MB, "VEC3", 5126), ...repartir(8 * MB, "SCALAR", 5123)];
  assert.deepEqual(inspeccionarGlb(conAccessors(mezcla)), { ok: true }, "64 MB justos");
  assert.deepEqual(inspeccionarGlb(conAccessors([...mezcla, { componentType: 5121, type: "SCALAR", count: 1 }])), complejo, "64 MB y un byte");
  // El tope por accessor sigue valiendo por su cuenta.
  assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType: 5121, type: "SCALAR", count: TOPE_COUNT + 1 }])), complejo, "1,5 MB pero más de 1 500 000 elementos");
});

test("inspeccionarGlb: los bytes de cada accessor son count × componentes del type × bytes del componentType (las 42 combinaciones)", async () => {
  const { inspeccionarGlb } = await vis();
  for (const [type, componentes] of Object.entries(COMPONENTES)) {
    for (const [ct, bytes] of Object.entries(BYTES)) {
      const porElemento = componentes * bytes;
      const caben = Math.floor(PRESUPUESTO / porElemento);
      const nombre = `${type} de ${ct} (${porElemento} bytes por elemento)`;
      assert.deepEqual(inspeccionarGlb(conAccessors(repartir(caben, type, Number(ct)))), { ok: true }, `${nombre}: ${caben} elementos caben`);
      assert.deepEqual(inspeccionarGlb(conAccessors(repartir(caben + 1, type, Number(ct)))), { ok: false, motivo: "complejo" }, `${nombre}: ${caben + 1} elementos no`);
    }
  }
});

test("inspeccionarGlb: formato → type o componentType desconocidos (el loader tampoco sabría leerlos); gana a «complejo» y pierde con «externo» y «comprimido»", async () => {
  const { inspeccionarGlb } = await vis();
  const formato = { ok: false, motivo: "formato" };
  // Incluye nombres que existen en Object.prototype: una tabla { VEC3: 3 } consultada sin más los daría por buenos.
  for (const type of [undefined, null, "", "VEC5", "vec3", "MAT5", 3, ["VEC3"], {}, "constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType: 5126, type, count: 3 }])), formato, `type = ${JSON.stringify(type)}`);
  }
  // 5124 (INT) y 5130 (DOUBLE) no son de glTF 2 ni están en la tabla del paquete; el número tiene que ser un número.
  for (const componentType of [undefined, null, 0, 5119, 5124, 5127, 5130, 5126.5, "5126", [5126], {}, "constructor", "__proto__"]) {
    assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType, type: "VEC3", count: 3 }])), formato, `componentType = ${JSON.stringify(componentType)}`);
  }
  // Con count 0 también: se valida la forma, no solo la cuenta.
  assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType: 5126, type: "VEC9", count: 0 }])), formato);
  // Un accessor mal formado en cualquier posición da «formato» aunque el resto pase del presupuesto.
  const gigas = repartir(128 * TOPE_COUNT, "VEC3", 5126);
  assert.deepEqual(inspeccionarGlb(conAccessors([...gigas, { componentType: 5126, type: "VEC5", count: 3 }])), formato, "mal formado al final");
  assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType: 5124, type: "VEC3", count: 3 }, ...gigas])), formato, "mal formado al principio");
  // Los avisos más concretos siguen ganando: la comprobación de accessors va la última.
  assert.deepEqual(inspeccionarGlb(conAccessors(gigas, { images: [{ uri: "t.png" }] })), { ok: false, motivo: "externo" });
  assert.deepEqual(inspeccionarGlb(conAccessors(gigas, { extensionsUsed: ["KHR_draco_mesh_compression"] })), { ok: false, motivo: "comprimido" });
  assert.deepEqual(inspeccionarGlb(conAccessors([{ componentType: 5126, type: "VEC5", count: 3 }], { images: [{ uri: "t.png" }] })), { ok: false, motivo: "externo" });
});

test("inspeccionarGlb: los modelos normales siguen pasando (500 000 triángulos con posición, normal y UV; indexado; el GLB con textura de las pruebas)", async () => {
  const { inspeccionarGlb } = await vis();
  const f = (type, count) => ({ bufferView: 0, componentType: 5126, type, count });
  // Sin índice: 1 500 000 vértices × (12 + 12 + 8) bytes = 48 MB (y ni siquiera cabría en un archivo de 20 MB).
  assert.deepEqual(inspeccionarGlb(conAccessors([f("VEC3", TOPE_COUNT), f("VEC3", TOPE_COUNT), f("VEC2", TOPE_COUNT)])), { ok: true }, "sin índice");
  // Indexado: 1 500 000 índices de 32 bits + 250 000 vértices con posición, normal, tangente, dos UV y color = 24 MB.
  const indexado = [{ bufferView: 0, componentType: 5125, type: "SCALAR", count: TOPE_COUNT }, f("VEC3", 250_000), f("VEC3", 250_000), f("VEC4", 250_000), f("VEC2", 250_000), f("VEC2", 250_000), f("VEC4", 250_000)];
  assert.deepEqual(inspeccionarGlb(conAccessors(indexado)), { ok: true }, "indexado");
  assert.deepEqual(inspeccionarGlb(glbConTextura()), { ok: true }, "GLB válido con textura incrustada");
  assert.deepEqual(inspeccionarGlb(glb()), { ok: true }, "sin accessors");
});

test("GLB cuyos accessors suman más de 64 MB: aviso «complejo» y enlace de descarga, sin pedir el paquete ni llegar a GLTFLoader", async () => {
  const win = ventana();
  const { THREE, registro } = crearThreeFalso(win);
  const llamadas = { three: 0, urls: [] };
  const archivo = conAccessors(repartir(128 * TOPE_COUNT, "VEC3", 5126));
  assert.ok(archivo.byteLength < 16 * 1024, "premisa: un archivo de pocos KB declara gigas");
  const modelo = {
    cargarThree: async () => (llamadas.three++, THREE),
    leer: async (url) => (llamadas.urls.push(url), archivo),
    webgl: () => true,
  };
  const fig = await montar(win, bloque(`archivo: ${A}`), modelo);
  assert.deepEqual(llamadas.urls, [src(A)]);
  assert.equal(aviso(fig)?.textContent, COMPLEJO);
  assert.equal(fig.firstElementChild, aviso(fig), "el aviso va al principio");
  assert.equal(fig.querySelector("canvas"), null);
  assert.equal(fig.querySelector("[role=region]"), null);
  assert.equal(fig.querySelector("button"), null);
  assert.equal(fig.querySelector(".hw-modelo-cargando"), null);
  assert.equal(fig.querySelector(":scope > a").getAttribute("href"), src(A), "el enlace de descarga sigue");
  assert.equal(llamadas.three, 0, "se rechaza antes de pedir el paquete: el loader reservaría la memoria que declara");
  assert.equal(registro.gltf.length, 0, "GLTFLoader no se instancia");
  assert.equal(registro.renderers.length, 0, "sin contexto WebGL");
  win.close();
});

// ---------- 2. Impresión con un modelo pendiente ----------

// Reglas de primer nivel o dentro de @media, en orden de aparición: [{ selector, cuerpo, media }]
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

test("impresión con un modelo aún sin cargar: @media print oculta .hw-modelo-cargando (ni «Cargando modelo 3D…» ni su recuadro) y el enlace de descarga queda", () => {
  const R = reglas(leer("src/styles/global.css").replace(/\/\*[\s\S]*?\*\//g, ""));
  const tiene = (r, re) => r.selector.split(",").some((s) => re.test(s.trim()));
  const MARCADOR = /^figure\.hw-modelo \.hw-modelo-cargando$/;
  const enPapel = R.map((r, i) => ({ ...r, i })).filter((r) => r.media !== null && /^print$/.test(r.media));
  const oculta = enPapel.filter((r) => tiene(r, MARCADOR) && prop(r.cuerpo, "display") !== null);
  assert.ok(oculta.length >= 1, "falta figure.hw-modelo .hw-modelo-cargando { display: none; } dentro de @media print");
  assert.equal(prop(oculta.at(-1).cuerpo, "display"), "none", "valor none a secas, sin !important");
  // Misma especificidad que la regla de pantalla (display: grid): la de impresión tiene que ir después para ganar.
  const pantalla = R.map((r, i) => ({ ...r, i })).filter((r) => r.media === null && tiene(r, MARCADOR) && prop(r.cuerpo, "display") !== null);
  assert.ok(pantalla.length >= 1, "premisa: el marcador tiene su caja en pantalla");
  assert.ok(oculta.at(-1).i > pantalla.at(-1).i, "la regla de impresión va después de la de pantalla");
  // Lo que ya se ocultaba sigue igual.
  const valorPapel = (re) => enPapel.filter((r) => tiene(r, re)).map((r) => prop(r.cuerpo, "display")).filter(Boolean).at(-1) ?? null;
  assert.equal(valorPapel(/^figure\.hw-modelo \[role="region"\]$/), "none");
  assert.equal(valorPapel(/^figure\.hw-modelo > \.btn$/), "none");
  // Y lo que debe salir en papel no se oculta: la figura, el enlace de descarga, el pie y los avisos.
  for (const r of enPapel.filter((x) => /hw-modelo/.test(x.selector))) {
    for (const s of r.selector.split(",").map((x) => x.trim())) {
      const permitido = MARCADOR.test(s) || /^figure\.hw-modelo \[role="region"\]$/.test(s) || /^figure\.hw-modelo > \.btn$/.test(s);
      if (!permitido) assert.doesNotMatch(r.cuerpo, /\b(display\s*:\s*none|visibility\s*:\s*hidden)\b/, `@media print no debe ocultar «${s}»`);
    }
  }
});

test("impresión con un modelo aún sin cargar: en ese estado la figura es marcador + enlace (+ pie), así que en papel quedan el enlace y el pie", async () => {
  // Estado pendiente real: con IntersectionObserver, montarVisores deja el marcador y no descarga nada.
  const win = ventana();
  win.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const { THREE } = crearThreeFalso(win);
  const modelo = { cargarThree: async () => THREE, leer: async () => assert.fail("pendiente: no descarga"), webgl: () => true };
  const fig = await montar(win, bloque(`archivo: ${A}\ntitulo: Carcasa`), modelo);
  assert.deepEqual([...fig.children].map((c) => (c.className ? `${c.tagName}.${c.className}` : c.tagName)), ["DIV.hw-modelo-cargando", "A", "FIGCAPTION"]);
  // Lo único que la hoja de impresión debe quitar aquí es el marcador: no hay región ni botón todavía.
  assert.equal(fig.querySelector("[role=region], button"), null);
  assert.equal(fig.querySelector(":scope > a").textContent, "Descargar modelo 3D");
  win.close();
});

// ---------- 3. El paquete solo pide WebGL 2 ----------

test("vendor: el WebGLRenderer del paquete pide solo un contexto «webgl2» (no hay respaldo a WebGL 1)", () => {
  const js = leer("public/vendor/three/three-visor.js");
  assert.match(js, /"webgl2"/);
  assert.doesNotMatch(js, /["'`]webgl["'`]/, "ningún getContext(\"webgl\")");
  assert.doesNotMatch(js, /experimental-webgl/);
});

// ---------- 4. GLB válido con el GLTFLoader real; revocación de las URL blob: ----------

const REAL = await import("../public/vendor/three/three-visor.js");

// Ventana de jsdom puesta como `self` y `document` globales, que es lo que usan los loaders del paquete:
//   self.URL.createObjectURL / revokeObjectURL  → anotados en `creadas` y `revocadas`
//   document.createElementNS("…", "img")        → <img> doble: al asignarle `src` avisa «load», o «error» si `falla(blob)`
//   fetch y createImageBitmap                   → anotados; no deben usarse (connect-src 'self' bloquea fetch(blob:))
// `revocadas` anota también URL.revokeObjectURL global, por si la implementación usa ese en vez del de la ventana.
function mundoReal({ falla = () => false } = {}) {
  const win = ventana();
  const creadas = [];
  const revocadas = [];
  const imgs = [];
  const fetches = [];
  const errores = [];
  let bitmaps = 0;
  win.URL.createObjectURL = (blob) => {
    const url = `blob:https://docs.example/${creadas.length + 1}`;
    creadas.push({ url, blob });
    return url;
  };
  const revocar = (url) => void revocadas.push(url);
  win.URL.revokeObjectURL = revocar;
  const crear = win.document.createElementNS.bind(win.document);
  win.document.createElementNS = (ns, nombre) => {
    const el = crear(ns, nombre);
    if (nombre !== "img") return el;
    const img = { el, src: null };
    imgs.push(img);
    Object.defineProperty(el, "src", {
      configurable: true,
      get: () => img.src,
      set(v) {
        img.src = String(v);
        const blob = creadas.find((c) => c.url === img.src)?.blob;
        // Como en el navegador: el resultado llega en otra tarea, no en la misma pila.
        setTimeout(() => el.dispatchEvent(new win.Event(blob && !falla(blob) ? "load" : "error")), 1);
      },
    });
    Object.defineProperty(el, "width", { configurable: true, value: 1 });
    Object.defineProperty(el, "height", { configurable: true, value: 1 });
    return el;
  };
  const pedir = async (url) => {
    fetches.push(String(url));
    throw new Error("sin red en el test");
  };
  const previo = {
    self: Object.getOwnPropertyDescriptor(globalThis, "self"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    createImageBitmap: Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap"),
    fetch: Object.getOwnPropertyDescriptor(globalThis, "fetch"),
    revocar: URL.revokeObjectURL,
    error: console.error,
    warn: console.warn,
  };
  const poner = (nombre, value) => Object.defineProperty(globalThis, nombre, { configurable: true, writable: true, value });
  poner("self", win);
  poner("document", win.document);
  // Con createImageBitmap disponible el GLTFLoader elegiría ImageBitmapLoader (fetch de la URL blob:) si nadie se lo cambia.
  poner("createImageBitmap", async () => {
    bitmaps++;
    throw new Error("sin createImageBitmap en el test");
  });
  poner("fetch", pedir);
  win.fetch = pedir;
  URL.revokeObjectURL = revocar;
  console.error = (...a) => void errores.push(a.map(String).join(" "));
  console.warn = () => {};
  const cerrar = () => {
    for (const nombre of ["self", "document", "createImageBitmap", "fetch"]) {
      if (previo[nombre]) Object.defineProperty(globalThis, nombre, previo[nombre]);
      else delete globalThis[nombre];
    }
    URL.revokeObjectURL = previo.revocar;
    console.error = previo.error;
    console.warn = previo.warn;
    win.close();
  };
  // THREE mixto: loaders del paquete; renderer, cámara, caja y controles del doble (no hay WebGL en Node).
  const falso = crearThreeFalso(win);
  const THREE = { ...falso.THREE, GLTFLoader: REAL.GLTFLoader, LoadingManager: REAL.LoadingManager, TextureLoader: REAL.TextureLoader };
  const modelo = (archivo) => ({ cargarThree: async () => THREE, leer: async () => archivo, webgl: () => true });
  return { win, creadas, revocadas, imgs, fetches, errores, bitmaps: () => bitmaps, registro: falso.registro, modelo, cerrar };
}
const mallasDe = (registro) => {
  const mallas = [];
  registro.escenas.at(-1).traverse((o) => o.isMesh && mallas.push(o));
  return mallas;
};

test("premisa: sin el plugin vt-texturas el GLTFLoader del paquete pediría la imagen incrustada con fetch(blob:), que la CSP bloquea", async () => {
  const m = mundoReal();
  try {
    const loader = new REAL.GLTFLoader(new REAL.LoadingManager());
    await new Promise((fin) => loader.parse(glbConTextura(), "", fin, fin));
    assert.equal(m.creadas.length, 1, "el loader crea una URL blob: para la imagen incrustada");
    assert.deepEqual(m.fetches, [m.creadas[0].url], "ImageBitmapLoader: fetch de la URL blob:");
    assert.equal(m.imgs.length, 0, "sin <img>");
  } finally {
    m.cerrar();
  }
});

test("GLB válido con textura incrustada y el GLTFLoader real: la imagen se carga con <img src=blob:> (sin fetch) y la malla conserva su textura", async () => {
  const m = mundoReal();
  try {
    const archivo = glbConTextura();
    const fig = await montar(m.win, bloque(`archivo: ${A}\ntitulo: Casco`), m.modelo(archivo));
    assert.equal(aviso(fig), null, `sin aviso (${m.errores.join(" | ")})`);
    assert.ok(fig.querySelector("[role=region] canvas"), "el visor se monta");
    // La imagen incrustada: un Blob con los bytes y el tipo que dice el GLB, y un <img> con esa URL blob:.
    assert.equal(m.creadas.length, 1, "una URL blob: por imagen incrustada");
    assert.equal(m.creadas[0].blob.type, "image/png");
    assert.deepEqual(new Uint8Array(await m.creadas[0].blob.arrayBuffer()), PNG_1X1, "los bytes del bufferView de la imagen");
    assert.equal(m.imgs.length, 1, "un <img>");
    assert.equal(m.imgs[0].src, m.creadas[0].url, "el <img> recibe la URL blob: tal cual (pasa el URL modifier)");
    assert.deepEqual(m.fetches, [], "ningún fetch: connect-src 'self' bloquearía fetch(blob:)");
    assert.equal(m.bitmaps(), 0, "sin createImageBitmap");
    // La escena que entra en el visor es la del loader real: un triángulo con su material y su textura de color.
    const mallas = mallasDe(m.registro);
    assert.equal(mallas.length, 1);
    assert.equal(mallas[0].geometry.attributes.position.count, 3);
    assert.equal(mallas[0].geometry.attributes.uv.count, 3);
    assert.equal(mallas[0].material.isMeshStandardMaterial, true);
    assert.equal(mallas[0].material.map?.isTexture, true, "material.map");
    assert.equal(mallas[0].material.map.image, m.imgs[0].el, "la textura usa el <img> cargado");
    assert.deepEqual(m.revocadas, [m.creadas[0].url], "tras cargar, la URL blob: se revoca una vez (lo hace el paquete)");
    assert.deepEqual(m.errores, [], "sin errores en la consola");
  } finally {
    m.cerrar();
  }
});

test("GLB con una imagen incrustada que no carga: el modelo se muestra sin esa textura y su URL blob: se revoca (el paquete solo revoca las que cargan)", async () => {
  // Dos imágenes: la PNG carga y la «JPEG» falla (bytes que no son un JPEG).
  const m = mundoReal({ falla: (blob) => blob.type === "image/jpeg" });
  try {
    const fig = await montar(m.win, bloque(`archivo: ${A}`), m.modelo(glbConTextura({ imagenes: ["image/png", "image/jpeg"] })));
    assert.equal(aviso(fig), null, "una textura rota no impide ver el modelo");
    assert.ok(fig.querySelector("[role=region] canvas"));
    assert.equal(m.creadas.length, 2, "premisa: una URL blob: por imagen");
    const [buena, rota] = ["image/png", "image/jpeg"].map((tipo) => m.creadas.find((c) => c.blob.type === tipo).url);
    const malla = mallasDe(m.registro)[0];
    assert.equal(malla.material.map?.isTexture, true, "la textura que sí carga se conserva");
    assert.equal(malla.material.emissiveMap ?? null, null, "la rota no está");
    await pausa(20);
    assert.ok(m.revocadas.includes(buena), "premisa: la que carga la revoca el paquete");
    assert.ok(m.revocadas.includes(rota), "la URL blob: de la imagen que falla también se revoca");
    for (const url of m.revocadas) assert.ok(m.creadas.some((c) => c.url === url), `solo se revocan URL creadas para este modelo (${url})`);
    assert.deepEqual(m.fetches, []);
  } finally {
    m.cerrar();
  }
});

test("GLB con una sola imagen incrustada y rota: sin textura, sin aviso y sin URL blob: retenida; al repintar tampoco se acumulan", async () => {
  const m = mundoReal({ falla: () => true });
  try {
    const texto = bloque(`archivo: ${A}`);
    const modelo = m.modelo(glbConTextura());
    for (let vuelta = 1; vuelta <= 3; vuelta++) {
      const fig = await montar(m.win, texto, modelo);
      assert.equal(aviso(fig), null, `vuelta ${vuelta}: sin aviso`);
      assert.equal(mallasDe(m.registro)[0].material.map ?? null, null, `vuelta ${vuelta}: sin textura`);
      await pausa(20);
      assert.equal(m.creadas.length, vuelta, `vuelta ${vuelta}: una URL blob: por carga`);
      assert.deepEqual([...new Set(m.revocadas)].sort(), m.creadas.map((c) => c.url).sort(), `vuelta ${vuelta}: todas revocadas`);
    }
  } finally {
    m.cerrar();
  }
});

test("GLB cuya geometría falla en el loader y cuya imagen tampoco carga: aviso general y la URL blob: no queda retenida", async () => {
  const m = mundoReal({ falla: () => true });
  try {
    const fig = await montar(m.win, bloque(`archivo: ${A}`), m.modelo(glbConTextura({ geometriaRota: true })));
    assert.equal(aviso(fig)?.textContent, GENERAL);
    assert.equal(fig.querySelector("canvas"), null);
    assert.ok(fig.querySelector(":scope > a"), "el enlace de descarga sigue");
    // El loader sigue con la imagen aunque la geometría ya haya fallado: se espera a que la pida y a que falle.
    await hasta(() => m.creadas.length === 1 && m.imgs.length === 1, "el loader crea la URL blob: y el <img>");
    await pausa(30);
    assert.deepEqual([...new Set(m.revocadas)], [m.creadas[0].url], "revocada aunque el modelo no se muestre");
  } finally {
    m.cerrar();
  }
});
