// Lote d-modelo-3d: montaje del visor 3D (src/lib/modelo-visor.ts) a través de montarVisores, con un THREE falso
// (tests/fixtures/three-falso.mjs). Aquí no hay WebGL ni se ejecuta el paquete vendorizado de three (los loaders del paquete
// se ejecutan solo en tests/d-modelo-cr68.test.mjs).
// Inyección, igual que OpcionesKicad:  montarVisores(raiz, md, { …, modelo: { cargarThree(), leer(url), webgl() } })
//   cargarThree(): Promise<THREE>          el paquete (en producción, import() de /vendor/three/three-visor.js)
//   leer(url): Promise<ArrayBuffer>        descarga del portal; rechaza con error.motivo === "grande" si pasa de 20 MB
//   webgl(): boolean                       ¿el navegador da un contexto WebGL?
// Estructura que se monta en la figura:
//   figure.hw-modelo > [ div[role=region] > ( canvas[tabindex=0] , p.hw-modelo-ayuda ) ] , a , button.btn , figcaption
// Mientras carga: div.hw-modelo-cargando (sin role). Si falla: p[role=status] al principio y el enlace sigue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { crearThreeFalso, glb, glbConTextura, stlAscii, stlBinario, Spherical, Vector3 } from "./fixtures/three-falso.mjs";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const uuid = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const md = () => import("../src/lib/hardware-md.ts");
const mv = () => import("../src/lib/modelo-visor.ts");
const vis = () => import("../src/lib/visores.ts");
const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const ventana = () => new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/mecanica/" }).window;
const bloque = (cuerpo) => "```modelo\n" + cuerpo + "\n```\n";
const src = (id, proyecto = "uuv") => `/api/archivos/?proyecto=${proyecto}&id=${id}`;
const opciones = (extra = {}) => ({ proyecto: "uuv", slug: "casco", vistaPrevia: false, descargar() {}, ...extra });
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

const GENERAL = "No se pudo mostrar el modelo 3D. Descarga el archivo para abrirlo en tu programa de CAD.";
const SIN_WEBGL = "Este navegador no puede mostrar modelos 3D. Descarga el archivo.";
const COMPRIMIDO = "Este GLB usa compresión (Draco, Meshopt o KTX2) que el visor no admite. Descarga el archivo o expórtalo sin compresión.";
const EXTERNO = "Este GLB depende de archivos externos y no se muestra aquí. Expórtalo como un solo archivo.";
const GRANDE = "El modelo pesa más de 20 MB y no se muestra aquí. Descarga el archivo.";
const DEMASIADOS = "Hay demasiados modelos 3D abiertos en esta página. Descarga el archivo.";
const CARGANDO = "Cargando modelo 3D…";
const TECLAS = "Flechas para girar, más y menos para acercar, Mayús con flechas para desplazar, cero para restablecer.";
const ARIA_LIENZO = `Vista 3D interactiva. ${TECLAS}`;

// Inyección para montarVisores. `archivo` puede ser un ArrayBuffer, un Error (la descarga falla) o una función (url) => ArrayBuffer.
function falsoModelo(win, archivo = stlBinario(2), { webgl = true, three: opThree = {}, fallaPaquete = false } = {}) {
  const { THREE, registro } = crearThreeFalso(win, opThree);
  const llamadas = { three: 0, urls: [], webgl: 0 };
  return {
    THREE,
    registro,
    llamadas,
    modelo: {
      cargarThree: async () => {
        llamadas.three++;
        if (fallaPaquete) throw new Error("No se pudo cargar three");
        return THREE;
      },
      leer: async (url) => {
        llamadas.urls.push(url);
        const v = typeof archivo === "function" ? archivo(url) : archivo;
        if (v instanceof Error) throw v;
        return v;
      },
      webgl: () => {
        llamadas.webgl++;
        return webgl;
      },
    },
  };
}
async function pintar(win, texto) {
  const { crearRenderizador } = await md();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(texto));
}
// Pinta `texto` y monta los visores. Devuelve la ventana, el doble y la primera figura.
async function montar(texto, { archivo, falso, win = ventana(), extra = {}, ...resto } = {}) {
  const { montarVisores } = await md();
  await pintar(win, texto);
  const f = falso ?? falsoModelo(win, archivo, resto);
  await montarVisores(win.document.body, texto, opciones({ modelo: f.modelo, ...extra }));
  const fig = win.document.querySelector("figure.hw-modelo");
  assert.ok(fig, "el render debe dar figure.hw-modelo");
  return { win, f, fig, doc: win.document };
}
const lienzoDe = (fig) => {
  const c = fig.querySelector("[role=region] canvas");
  assert.ok(c, "falta el <canvas> dentro de la región del visor");
  return c;
};
const aviso = (fig) => fig.querySelector(":scope > p[role=status]");
const tecla = (win, el, key, extra = {}) => {
  const e = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
  el.dispatchEvent(e);
  return e;
};
// Estado de la cámara respecto al punto que mira, en esféricas sobre el eje vertical de la cámara (camera.up):
// Z en un STL (convención de CAD) e Y en un GLB (norma glTF). phi = ángulo con el eje vertical; theta = giro alrededor de él.
// Con Z arriba se permutan los ejes (x, y, z) → (y, z, x) para reutilizar Spherical, que mide sobre Y.
function estado(f) {
  const cam = f.registro.camaras.at(-1);
  const ctl = f.registro.controles.at(-1);
  const up = cam.up.toArray();
  assert.ok(up.join() === "0,1,0" || up.join() === "0,0,1", `camera.up debe ser Y o Z (${up})`);
  const delta = new Vector3().subVectors(cam.position, ctl.target);
  const local = up[2] === 1 ? new Vector3(delta.y, delta.z, delta.x) : delta.clone();
  const s = new Spherical().setFromVector3(local);
  return { pos: cam.position.clone(), target: ctl.target.clone(), delta, radio: s.radius, phi: s.phi, theta: s.theta, up };
}
// Color de un material tal como lo recibió el constructor: número, texto o Color.
const hexDe = (c) => {
  const v = c?.isColor ? c.args[0] : c;
  return typeof v === "number" ? `#${v.toString(16).padStart(6, "0")}` : String(v ?? "").toLowerCase();
};
const angulo = (a, b) => {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const cerca = (a, b, eps, mensaje) => assert.ok(Math.abs(a - b) <= eps, `${mensaje}: ${a} frente a ${b}`);
const cercaV = (a, b, eps, mensaje) => assert.ok(a.distanceTo(b) <= eps, `${mensaje}: (${a.toArray()}) frente a (${b.toArray()})`);
const GRADOS_10 = Math.PI / 18;

// ---------- 1. Estructura y accesibilidad ----------

test("montarVisores: STL → región «Modelo 3D: título» con <canvas tabindex=0> y su aria-label, línea de ayuda y botón «Restablecer vista»", async () => {
  const texto = `# Casco\n\n${bloque(`archivo: ${A}\ntitulo: Carcasa`)}`;
  const { f, fig, doc } = await montar(texto);
  assert.deepEqual(f.llamadas.urls, [src(A)]);
  assert.equal(f.llamadas.three, 1);
  const region = fig.querySelector(":scope > div[role=region]");
  assert.ok(region, "div[role=region] hijo directo de la figura");
  assert.equal(fig.firstElementChild, region, "la región va antes del enlace");
  assert.equal(region.getAttribute("aria-label"), "Modelo 3D: Carcasa");
  const lienzo = lienzoDe(fig);
  assert.equal(lienzo.getAttribute("tabindex"), "0");
  assert.equal(lienzo.getAttribute("aria-label"), ARIA_LIENZO);
  const ayuda = region.querySelector("p.hw-modelo-ayuda");
  assert.ok(ayuda, "p.hw-modelo-ayuda");
  assert.equal(ayuda.textContent, TECLAS);
  assert.equal(ayuda.getAttribute("aria-hidden"), "true", "el lector de pantalla ya lo oye en el aria-label del lienzo");
  assert.deepEqual([...region.children].map((c) => c.tagName), ["CANVAS", "P"]);
  // Fuera de la región: enlace de descarga, un solo botón y el pie.
  assert.deepEqual([...fig.children].map((c) => c.tagName), ["DIV", "A", "BUTTON", "FIGCAPTION"]);
  const boton = fig.querySelector(":scope > button.btn");
  assert.equal(boton.getAttribute("type"), "button");
  assert.equal(boton.textContent, "Restablecer vista");
  assert.equal(fig.querySelectorAll("button").length, 1, "un único botón: no saturar");
  assert.equal(fig.querySelector("a").getAttribute("href"), src(A));
  assert.equal(fig.querySelector(".hw-modelo-cargando"), null, "el marcador de carga desaparece");
  assert.equal(aviso(fig), null);
  assert.equal(doc.querySelectorAll("script, iframe").length, 0);
});

test("montarVisores: sin título la región se llama «Modelo 3D»; la URL sale del bloque, no del enlace del DOM", async () => {
  const texto = bloque(`archivo: ${A}`);
  const win = ventana();
  const { montarVisores } = await md();
  await pintar(win, texto);
  const enlace = win.document.querySelector("figure.hw-modelo a");
  assert.ok(enlace, "el render debe dar figure.hw-modelo con su enlace");
  enlace.setAttribute("href", "https://evil.example/x.glb");
  const f = falsoModelo(win);
  await montarVisores(win.document.body, texto, opciones({ modelo: f.modelo }));
  assert.deepEqual(f.llamadas.urls, [src(A)]);
  assert.equal(win.document.querySelector("figure.hw-modelo [role=region]").getAttribute("aria-label"), "Modelo 3D");
});

test("montarVisores: es idempotente (segunda llamada no descarga, no crea otro lienzo ni otro botón)", async () => {
  const texto = `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}\ntitulo: Tapa`)}`;
  const { win, f, doc } = await montar(texto);
  const { montarVisores } = await md();
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  assert.deepEqual(f.llamadas.urls, [src(A), src(B)]);
  assert.equal(doc.querySelectorAll("figure.hw-modelo canvas").length, 2);
  assert.equal(doc.querySelectorAll("figure.hw-modelo button").length, 2);
  assert.equal(f.registro.renderers.length, 2);
  win.close();
});

test("montarVisores: en la vista previa del editor no descarga, no carga el paquete ni crea lienzo o marcador", async () => {
  const texto = bloque(`archivo: ${A}`);
  const { f, fig } = await montar(texto, { extra: { vistaPrevia: true } });
  assert.equal(f.llamadas.three, 0);
  assert.equal(f.llamadas.urls.length, 0);
  assert.equal(fig.querySelector("canvas"), null);
  assert.equal(fig.querySelector(".hw-modelo-cargando"), null);
  assert.deepEqual([...fig.children].map((c) => c.tagName), ["A"]);
});

test("montarVisores: sin bloques ```modelo no se carga el paquete ni se consulta WebGL", async () => {
  const texto = `# Placa\n\n\`\`\`pdf\narchivo: ${A}\n\`\`\`\n`;
  const win = ventana();
  const { montarVisores } = await md();
  await pintar(win, texto);
  const f = falsoModelo(win);
  await montarVisores(win.document.body, texto, opciones({ modelo: f.modelo }));
  assert.equal(f.llamadas.three, 0);
  assert.equal(f.llamadas.webgl, 0);
  assert.equal(f.llamadas.urls.length, 0);
});

test("montarVisores: convive con pdf, kicad y bom en la misma página (emparejamiento por orden)", async () => {
  const texto = `\`\`\`pdf\narchivo: ${B}\n\`\`\`\n\n${bloque(`archivo: ${A}`)}\n\`\`\`bom\nreferencia,descripcion,cantidad,costo_unitario\nR1,Res,2,0.5\n\`\`\`\n`;
  const { fig, doc } = await montar(texto);
  assert.ok(lienzoDe(fig));
  assert.ok(doc.querySelector("figure.hw-pdf iframe"), "el PDF sigue montándose");
  assert.ok(doc.querySelector("figure.hw-bom button"), "el BOM sigue montándose");
});

// ---------- 2. Escena, cámara y render bajo demanda ----------

test("escena STL: STLLoader.parse(ArrayBuffer), malla con MeshStandardMaterial, luz hemisférica y direccional, lienzo transparente y pixelRatio ≤ 2", async () => {
  const bytes = stlAscii();
  const win = ventana();
  win.devicePixelRatio = 3;
  const { f, fig } = await montar(bloque(`archivo: ${A}`), { win, archivo: bytes });
  const { THREE, registro } = f;
  assert.equal(registro.stl.length, 1);
  assert.equal(registro.gltf.length, 0, "un STL no pasa por GLTFLoader");
  assert.equal(registro.stl[0].llamadas.length, 1);
  assert.ok(registro.stl[0].llamadas[0] instanceof ArrayBuffer, "parse recibe el ArrayBuffer descargado por el portal");
  assert.equal(registro.stl[0].llamadas[0].byteLength, bytes.byteLength);
  assert.equal(registro.renderers.length, 1);
  const r = registro.renderers[0];
  assert.equal(r.parametros.alpha, true, "fondo transparente: se ve la superficie de la figura en ambos temas");
  assert.equal(r.parametros.canvas, lienzoDe(fig), "el renderer dibuja en el <canvas> creado por el portal");
  assert.equal(r.pixelRatio, 2, "devicePixelRatio acotado a 2");
  assert.ok(r.renders >= 1, "se dibuja al cargar");
  const escena = registro.escenas.at(-1);
  const objetos = [];
  escena.traverse((o) => objetos.push(o));
  assert.equal(r.ultimo.escena, escena);
  assert.ok(objetos.some((o) => o instanceof THREE.HemisphereLight), "luz hemisférica");
  assert.ok(objetos.some((o) => o instanceof THREE.DirectionalLight), "luz direccional");
  const malla = objetos.find((o) => o.isMesh);
  assert.ok(malla, "la malla del STL está en la escena");
  assert.ok(malla.material instanceof THREE.MeshStandardMaterial);
  assert.equal(hexDe(malla.material.parametros.color), "#9aa3ad", "gris neutro: se lee sobre la superficie clara y la oscura");
  assert.equal(escena.background, null, "sin color de fondo en la escena");
});

test("ejes: un STL se ve con Z hacia arriba (camera.up fijado antes de crear OrbitControls) y un GLB con Y; las flechas giran sobre ese eje", async () => {
  for (const [nombre, archivo, up, vertical] of [["STL", stlBinario(2), [0, 0, 1], "z"], ["GLB", glb(), [0, 1, 0], "y"]]) {
    const { win, f, fig } = await montar(bloque(`archivo: ${A}`), { archivo });
    const cam = f.registro.camaras.at(-1);
    const ctl = f.registro.controles.at(-1);
    assert.deepEqual(cam.up.toArray(), up, `${nombre}: camera.up`);
    assert.deepEqual(ctl.upAlCrear.toArray(), up, `${nombre}: camera.up se fija antes de new OrbitControls (después ya no lo lee)`);
    const e0 = estado(f);
    assert.ok(e0.delta[vertical] > 0, `${nombre}: la vista inicial mira el modelo desde arriba`);
    tecla(win, lienzoDe(fig), "ArrowRight");
    const e1 = estado(f);
    cerca(e1.delta[vertical], e0.delta[vertical], 1e-9, `${nombre}: → gira alrededor del eje vertical (la altura no cambia)`);
    cerca(Math.abs(angulo(e1.theta, e0.theta)), GRADOS_10, 1e-6, `${nombre}: → gira 10°`);
    tecla(win, lienzoDe(fig), "ArrowUp");
    assert.ok(Math.abs(estado(f).delta[vertical] - e1.delta[vertical]) > 1e-6, `${nombre}: ↑ cambia la altura de la cámara`);
    win.close();
  }
});

test("cámara: encuadra la caja del modelo (fuera de su esfera, entre near y far) y OrbitControls usa el lienzo, sin inercia ni giro automático", async () => {
  const { f, fig } = await montar(bloque(`archivo: ${A}`), { three: { caja: { min: [10, 20, 30], max: [14, 28, 42] } } });
  const cam = f.registro.camaras.at(-1);
  const ctl = f.registro.controles.at(-1);
  assert.equal(f.registro.controles.length, 1);
  assert.equal(ctl.object, cam);
  assert.equal(ctl.domElement, lienzoDe(fig));
  assert.equal(ctl.enableDamping, false);
  assert.notEqual(ctl.autoRotate, true, "nunca hay giro automático");
  const radio = new Vector3(4, 8, 12).length() / 2;
  const e = estado(f);
  assert.ok(e.radio > radio, `la cámara queda fuera del modelo (${e.radio} > ${radio})`);
  assert.ok(e.radio < radio * 20, "y no absurdamente lejos");
  assert.ok(cam.near > 0 && cam.near < e.radio - radio, "near por delante del modelo");
  assert.ok(cam.far > e.radio + radio, "far por detrás del modelo");
  assert.ok(e.phi > Math.PI / 6 - 1e-9 && e.phi < Math.PI / 2 + 1e-9, `vista inicial entre 30° y 90° del eje vertical (${e.phi})`);
  assert.ok(Number.isFinite(cam.aspect) && cam.aspect > 0, "aspect válido aunque el lienzo mida 0 (jsdom)");
});

test("render bajo demanda: dibuja en el evento change de OrbitControls y al cambiar el tamaño (ResizeObserver); sin bucle", async () => {
  const win = ventana();
  const observadores = [];
  win.ResizeObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.objetivos = [];
      this.desconectado = false;
      observadores.push(this);
    }
    observe(el) {
      this.objetivos.push(el);
    }
    unobserve() {}
    disconnect() {
      this.desconectado = true;
    }
  };
  let cuadros = 0;
  win.requestAnimationFrame = () => ++cuadros;
  const { f, fig } = await montar(bloque(`archivo: ${A}`), { win });
  const r = f.registro.renderers[0];
  const ctl = f.registro.controles[0];
  await pausa(30);
  const base = r.renders;
  await pausa(30);
  assert.equal(r.renders, base, "sin interacción no se vuelve a dibujar");
  assert.equal(cuadros, 0, "no se usa requestAnimationFrame");
  assert.equal(r.bucle, undefined, "no se usa setAnimationLoop");
  ctl.emitir("change");
  assert.equal(r.renders, base + 1, "change → un dibujo");
  assert.equal(observadores.length, 1, "un ResizeObserver por visor");
  const lienzo = lienzoDe(fig);
  assert.ok(observadores[0].objetivos.some((el) => el === lienzo || el.contains(lienzo)), "observa el lienzo o su contenedor");
  // jsdom no maqueta: se le da tamaño al lienzo y a su contenedor antes de avisar del cambio.
  for (const el of [lienzo, lienzo.parentElement, fig]) {
    Object.defineProperty(el, "clientWidth", { value: 640, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 360, configurable: true });
  }
  const tamanos = r.tamanos.length;
  const proyecciones = f.registro.camaras[0].proyecciones;
  observadores[0].cb([{ target: observadores[0].objetivos[0], contentRect: { width: 640, height: 360 } }], observadores[0]);
  assert.ok(r.tamanos.length > tamanos, "cambia el tamaño del renderer");
  assert.ok(f.registro.camaras[0].proyecciones > proyecciones, "actualiza la proyección");
  assert.ok(r.renders > base + 1, "y vuelve a dibujar");
});

test("fuente: modelo-visor.ts no usa requestAnimationFrame, setAnimationLoop, autoRotate, animaciones, innerHTML ni decodificadores", () => {
  const s = leer("src/lib/modelo-visor.ts");
  assert.doesNotMatch(s, /requestAnimationFrame|setAnimationLoop/);
  assert.doesNotMatch(s, /autoRotate\s*=\s*true/);
  assert.doesNotMatch(s, /AnimationMixer|\.animations\b/);
  assert.doesNotMatch(s, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
  assert.doesNotMatch(s, /setDRACOLoader|setKTX2Loader|setMeshoptDecoder|new\s+Worker|importScripts/);
  assert.doesNotMatch(s, /from\s+["']three/);
});

// ---------- 3. GLB: texturas por <img>, URL modifier, sin animaciones ----------

test("GLB: GLTFLoader.parse(buffer, \"\", …) con plugin vt-texturas (TextureLoader) y URL modifier que solo deja pasar blob:", async () => {
  // GLB válido (escena, malla, material e imagen incrustada). Aquí el loader es el doble y solo se comprueba cómo lo configura
  // el portal; el mismo archivo se carga con el GLTFLoader del paquete en tests/d-modelo-cr68.test.mjs.
  const bytes = glbConTextura();
  const { f, fig } = await montar(bloque(`archivo: ${A}\ntitulo: Casco`), { archivo: bytes });
  const { THREE, registro } = f;
  assert.ok(lienzoDe(fig));
  assert.equal(registro.stl.length, 0);
  assert.equal(registro.gltf.length, 1);
  const loader = registro.gltf[0];
  assert.equal(loader.llamadas.length, 1);
  assert.ok(loader.llamadas[0].datos instanceof ArrayBuffer);
  assert.equal(loader.llamadas[0].datos.byteLength, bytes.byteLength);
  assert.equal(loader.llamadas[0].ruta, "", "sin ruta base: nada se resuelve contra el portal");
  assert.deepEqual(loader.prohibidos, [], "sin Draco, KTX2 ni Meshopt");
  // LoadingManager propio con el modificador de URL.
  assert.ok(loader.manager instanceof THREE.LoadingManager, "GLTFLoader recibe un LoadingManager propio");
  const mod = loader.manager.modificador;
  assert.equal(typeof mod, "function", "manager.setURLModifier(…)");
  const blobUrl = "blob:https://docs.example/7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
  assert.equal(mod(blobUrl), blobUrl);
  for (const u of ["https://evil.example/t.png", "//evil.example/t.png", "/auth/logout", "textura.png", "../x.bin", "data:image/png;base64,AAAA", "javascript:alert(1)", "BLOB:x", " blob:x", ""]) {
    assert.equal(mod(u), "about:invalid", JSON.stringify(u));
  }
  // Plugin: cambia ImageBitmapLoader (fetch de blob:, bloqueado por connect-src) por TextureLoader (<img>, permitido por img-src blob:).
  assert.equal(loader.plugins.length, 1);
  assert.equal(loader.plugins[0]?.name, "vt-texturas");
  const parser = loader.parsers[0];
  assert.ok(parser.textureLoader instanceof THREE.TextureLoader, "parser.textureLoader = new TextureLoader(manager)");
  assert.equal(parser.textureLoader.manager, loader.manager, "el TextureLoader usa el mismo manager (y su URL modifier)");
  // La escena que devuelve el loader entra tal cual, con sus materiales (el doble siempre pone una textura: que el loader real
  // abra la imagen incrustada se comprueba en d-modelo-cr68).
  const objetos = [];
  registro.escenas.at(-1).traverse((o) => objetos.push(o));
  const malla = objetos.find((o) => o.isMesh);
  assert.ok(malla, "la escena del GLB está en la escena del visor");
  assert.ok(malla.material.map?.isTexture, "conserva el material y la textura del GLB");
});

// ---------- 4. Fallos ----------

test("mensajes exportados: los textos de aviso, carga y teclas son constantes de modelo-visor.ts", async () => {
  const m = await mv();
  assert.equal(m.AVISO_MODELO_GENERAL, GENERAL);
  assert.equal(m.AVISO_MODELO_SIN_WEBGL, SIN_WEBGL);
  assert.equal(m.AVISO_MODELO_COMPRIMIDO, COMPRIMIDO);
  assert.equal(m.AVISO_MODELO_EXTERNO, EXTERNO);
  assert.equal(m.AVISO_MODELO_GRANDE, GRANDE);
  assert.equal(m.AVISO_MODELO_DEMASIADOS, DEMASIADOS);
  assert.equal(m.TEXTO_CARGANDO_MODELO, CARGANDO);
  assert.equal(m.TECLAS_MODELO, TECLAS);
  assert.equal(m.MAX_MODELOS_ACTIVOS, 8);
  const todos = [GENERAL, SIN_WEBGL, COMPRIMIDO, EXTERNO, GRANDE, DEMASIADOS, CARGANDO, TECLAS].join(" ");
  assert.doesNotMatch(todos, /[—–]/, "sin rayas largas");
});

// Comprueba un fallo: aviso role=status al principio, sin lienzo ni botón, y el enlace de descarga sigue.
function esperaFallo(fig, f, texto, nombre) {
  const p = aviso(fig);
  assert.ok(p, `${nombre}: falta p[role=status]`);
  assert.equal(p.textContent, texto, nombre);
  assert.equal(fig.firstElementChild, p, `${nombre}: el aviso va al principio`);
  assert.equal(fig.querySelector("canvas"), null, `${nombre}: sin lienzo`);
  assert.equal(fig.querySelector("[role=region]"), null, `${nombre}: sin región`);
  assert.equal(fig.querySelector("button"), null, `${nombre}: sin botón`);
  assert.equal(fig.querySelector(".hw-modelo-cargando"), null, `${nombre}: sin marcador de carga`);
  assert.equal(fig.querySelector("a").getAttribute("href"), src(A), `${nombre}: el enlace de descarga sigue`);
  assert.equal(f.registro.renderers.length, 0, `${nombre}: no se crea ningún contexto WebGL`);
}

test("fallo general: la descarga falla o el archivo no es un modelo → aviso, sin cargar el paquete", async () => {
  const texto = bloque(`archivo: ${A}\ntitulo: Casco`);
  const html = new TextEncoder().encode("<!doctype html><html>no</html>").buffer;
  for (const [nombre, archivo] of [["HTTP 500", new Error("HTTP 500")], ["HTML", html], ["vacío", new ArrayBuffer(0)], ["GLB versión 1", glb(undefined, { version: 1 })], ["GLB truncado", glb().slice(0, 16)]]) {
    const { f, fig } = await montar(texto, { archivo });
    esperaFallo(fig, f, GENERAL, nombre);
    assert.equal(f.llamadas.three, 0, `${nombre}: el paquete de three no se pide`);
  }
});

test("fallo general: el paquete no carga, el loader lanza (STL o GLB) o el modelo sale vacío", async () => {
  const texto = bloque(`archivo: ${A}`);
  const casos = [
    ["paquete", { fallaPaquete: true }],
    ["STLLoader lanza", { three: { errorStl: true } }],
    ["GLTFLoader llama a onError", { archivo: glb(), three: { errorGltf: true } }],
    ["caja vacía", { three: { cajaVacia: true } }],
  ];
  for (const [nombre, op] of casos) {
    const { win, f, fig } = await montar(texto, op);
    const p = aviso(fig);
    assert.ok(p, `${nombre}: falta el aviso`);
    assert.equal(p.textContent, GENERAL, nombre);
    assert.equal(fig.querySelector("canvas"), null, nombre);
    assert.equal(fig.querySelector("button"), null, nombre);
    assert.ok(fig.querySelector("a"), nombre);
    // Si se llegó a crear el renderer, se libera (no queda un contexto WebGL vivo por un modelo roto).
    for (const r of f.registro.renderers) assert.ok(r.liberado >= 1 && r.contextoPerdido >= 1, `${nombre}: renderer liberado`);
    win.close();
  }
});

test("sin WebGL: aviso propio, sin descargar el archivo ni pedir el paquete", async () => {
  const { f, fig } = await montar(bloque(`archivo: ${A}`), { webgl: false });
  esperaFallo(fig, f, SIN_WEBGL, "sin WebGL");
  assert.equal(f.llamadas.webgl, 1);
  assert.equal(f.llamadas.urls.length, 0);
  assert.equal(f.llamadas.three, 0);
});

test("GLB comprimido o con recursos externos: aviso propio y el archivo nunca llega a GLTFLoader (ni se pide el paquete)", async () => {
  const texto = bloque(`archivo: ${A}`);
  const casos = [
    [COMPRIMIDO, glb({ asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression"] })],
    [COMPRIMIDO, glb({ asset: { version: "2.0" }, extensionsUsed: ["KHR_texture_basisu"] })],
    [COMPRIMIDO, glb({ asset: { version: "2.0" }, extensionsUsed: ["EXT_meshopt_compression"] })],
    [EXTERNO, glb({ asset: { version: "2.0" }, buffers: [{ byteLength: 4, uri: "https://evil.example/geo.bin" }] })],
    [EXTERNO, glb({ asset: { version: "2.0" }, images: [{ uri: "/auth/logout" }] })],
    [EXTERNO, glb({ asset: { version: "2.0" }, images: [{ uri: "data:image/png;base64,AAAA" }] })],
  ];
  for (const [mensaje, archivo] of casos) {
    const { f, fig } = await montar(texto, { archivo });
    esperaFallo(fig, f, mensaje, mensaje.slice(0, 30));
    assert.equal(f.registro.gltf.length, 0, "GLTFLoader no se instancia");
    assert.equal(f.llamadas.three, 0);
  }
});

test("más de 20 MB: aviso propio, tanto si lo dice la descarga (error.motivo = \"grande\") como si llegan más bytes de la cuenta", async () => {
  const { MAX_MODELO_VISOR } = await vis();
  assert.equal(MAX_MODELO_VISOR, 20 * 1024 * 1024);
  const texto = bloque(`archivo: ${A}`);
  const error = Object.assign(new Error("Archivo demasiado grande"), { motivo: "grande" });
  for (const archivo of [error, new ArrayBuffer(MAX_MODELO_VISOR + 1)]) {
    const { f, fig } = await montar(texto, { archivo });
    esperaFallo(fig, f, GRANDE, "grande");
    assert.equal(f.llamadas.three, 0);
  }
});

test("reintento: la figura con aviso no se reintenta sola, pero un repintado (figuras nuevas) vuelve a intentarlo", async () => {
  const texto = bloque(`archivo: ${A}`);
  let falla = true;
  const win = ventana();
  const f = falsoModelo(win, () => (falla ? new Error("HTTP 503") : stlBinario(2)));
  const { fig, doc } = await montar(texto, { win, falso: f });
  assert.equal(aviso(fig)?.textContent, GENERAL);
  const { montarVisores } = await md();
  falla = false;
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  assert.equal(f.llamadas.urls.length, 1, "misma figura: idempotente, el aviso se queda");
  assert.equal(doc.querySelectorAll("p[role=status]").length, 1);
  // El editor repinta la página (replaceChildren con un fragmento nuevo) y llama otra vez a montarVisores.
  await pintar(win, texto);
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  assert.equal(f.llamadas.urls.length, 2);
  assert.ok(lienzoDe(doc.querySelector("figure.hw-modelo")));
  assert.equal(doc.querySelector("p[role=status]"), null);
});

test("pérdida de contexto WebGL: el lienzo se sustituye por el aviso general y el visor se libera", async () => {
  const { win, f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  const ev = new win.Event("webglcontextlost", { cancelable: true });
  lienzo.dispatchEvent(ev);
  assert.equal(fig.querySelector("canvas"), null);
  assert.equal(fig.querySelector("[role=region]"), null);
  assert.equal(fig.querySelector("button"), null, "sin lienzo no hay nada que restablecer");
  assert.equal(aviso(fig)?.textContent, GENERAL);
  assert.equal(fig.firstElementChild, aviso(fig));
  assert.ok(fig.querySelector("a"), "el enlace de descarga sigue");
  assert.ok(f.registro.renderers[0].liberado >= 1, "renderer.dispose()");
  assert.ok(f.registro.controles[0].liberado >= 1, "controls.dispose()");
});

// ---------- 5. Tope de visores y liberación ----------

test("tope: con 9 modelos se montan 8 y el noveno avisa (role=status) sin descargar su archivo", async () => {
  const ids = Array.from({ length: 9 }, (_, i) => uuid(i + 1));
  const texto = ids.map((id) => bloque(`archivo: ${id}`)).join("\n");
  const { f, doc } = await montar(texto);
  const figs = [...doc.querySelectorAll("figure.hw-modelo")];
  assert.equal(figs.length, 9);
  assert.equal(doc.querySelectorAll("figure.hw-modelo canvas").length, 8);
  assert.equal(f.registro.renderers.length, 8, "8 contextos WebGL como máximo");
  for (const fig of figs.slice(0, 8)) assert.equal(aviso(fig), null);
  const noveno = figs[8];
  assert.equal(aviso(noveno)?.textContent, DEMASIADOS);
  assert.equal(noveno.querySelector("canvas"), null);
  assert.equal(noveno.querySelector(".hw-modelo-cargando"), null);
  assert.equal(noveno.querySelector("a").getAttribute("href"), src(ids[8]));
  assert.deepEqual(f.llamadas.urls, ids.slice(0, 8).map((id) => src(id)), "la plaza se reserva antes de descargar");
});

test("liberación: al repintar y volver a llamar a montarVisores se liberan los visores desconectados y baja el contador", async () => {
  const ids = Array.from({ length: 8 }, (_, i) => uuid(i + 1));
  const texto = ids.map((id) => bloque(`archivo: ${id}`)).join("\n");
  const win = ventana();
  const observadores = [];
  win.ResizeObserver = class {
    constructor() {
      this.desconectado = false;
      observadores.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.desconectado = true;
    }
  };
  // Los modelos son GLB: así hay geometría, material y textura que soltar.
  const { f, doc } = await montar(texto, { win, archivo: glb() });
  // Los recursos del primer montaje, guardados antes de repintar: ocho de cada tipo, uno por visor.
  const tipos = ["renderers", "controles", "geometrias", "materiales", "mapas"];
  const antiguos = { ...Object.fromEntries(tipos.map((t) => [t, [...f.registro[t]]])), observadores: [...observadores] };
  for (const [tipo, lista] of Object.entries(antiguos)) assert.equal(lista.length, 8, `premisa: 8 ${tipo} tras el primer montaje`);
  const { montarVisores } = await md();
  // Mientras siguen en el DOM no se libera nada ni se crea nada nuevo.
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  for (const tipo of tipos) {
    assert.equal(f.registro[tipo].length, 8, `${tipo}: la segunda llamada no crea más`);
    assert.ok(antiguos[tipo].every((x) => x.liberado === 0), `${tipo}: los visores conectados no se tocan`);
  }
  assert.ok(antiguos.renderers.every((r) => r.contextoPerdido === 0), "sin forceContextLoss mientras están conectados");
  assert.equal(observadores.length, 8);
  assert.ok(antiguos.observadores.every((o) => !o.desconectado), "los ResizeObserver siguen conectados");
  // Repintado tras guardar: figuras nuevas, las viejas quedan fuera del DOM.
  await pintar(win, texto);
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  // Esos mismos ocho de cada tipo quedan liberados.
  const nombres = { renderers: "renderer.dispose()", controles: "controls.dispose()", geometrias: "geometry.dispose()", materiales: "material.dispose()", mapas: "texture.dispose()" };
  for (const tipo of tipos) antiguos[tipo].forEach((x, i) => assert.ok(x.liberado >= 1, `${nombres[tipo]} del visor antiguo ${i + 1}`));
  antiguos.renderers.forEach((r, i) => assert.ok(r.contextoPerdido >= 1, `renderer.forceContextLoss() del visor antiguo ${i + 1}`));
  antiguos.observadores.forEach((o, i) => assert.ok(o.desconectado, `ResizeObserver desconectado del visor antiguo ${i + 1}`));
  // Aparte: el contador bajó, así que caben los ocho nuevos, y esos siguen vivos.
  assert.equal(doc.querySelectorAll("figure.hw-modelo canvas").length, 8);
  assert.equal(doc.querySelector("p[role=status]"), null, "ningún aviso de «demasiados»");
  for (const tipo of tipos) {
    const nuevos = f.registro[tipo].filter((x) => !antiguos[tipo].includes(x));
    assert.equal(nuevos.length, 8, `8 ${tipo} nuevos`);
    assert.ok(nuevos.every((x) => x.liberado === 0), `${tipo}: los nuevos no se liberan`);
  }
  const observadoresNuevos = observadores.filter((o) => !antiguos.observadores.includes(o));
  assert.equal(observadoresNuevos.length, 8, "8 ResizeObserver nuevos");
  assert.ok(observadoresNuevos.every((o) => !o.desconectado), "y siguen conectados");
});

test("liberación: también al pintar una página sin modelos, y en pagehide", async () => {
  const texto = bloque(`archivo: ${A}`);
  const { win, f, doc } = await montar(texto);
  const { montarVisores } = await md();
  const otra = "# Otra página\n\nSin modelos.\n";
  await pintar(win, otra);
  await montarVisores(doc.body, otra, opciones({ modelo: f.modelo }));
  assert.ok(f.registro.renderers[0].liberado >= 1, "se libera aunque la página nueva no tenga visores");
  assert.ok(f.registro.renderers[0].contextoPerdido >= 1);
  // pagehide: un visor que ya no está en el DOM se libera sin esperar a otro montarVisores.
  await pintar(win, texto);
  await montarVisores(doc.body, texto, opciones({ modelo: f.modelo }));
  assert.equal(f.registro.renderers.length, 2);
  doc.body.replaceChildren();
  assert.equal(f.registro.renderers[1].liberado, 0);
  win.dispatchEvent(new win.Event("pagehide"));
  assert.ok(f.registro.renderers[1].liberado >= 1, "pagehide libera los desconectados");
  assert.ok(f.registro.controles[1].liberado >= 1);
});

test("liberado: las teclas y el botón de un visor ya liberado no dibujan ni fallan", async () => {
  const texto = bloque(`archivo: ${A}`);
  const { win, f, fig, doc } = await montar(texto);
  const { montarVisores } = await md();
  const lienzo = lienzoDe(fig);
  const boton = fig.querySelector("button");
  await pintar(win, "nada\n");
  await montarVisores(doc.body, "nada\n", opciones({ modelo: f.modelo }));
  const r = f.registro.renderers[0];
  const antes = r.renders;
  tecla(win, lienzo, "ArrowRight");
  boton.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  f.registro.controles[0].emitir("change");
  assert.equal(r.renders, antes, "tras liberar no se vuelve a dibujar");
});

// ---------- 6. Montaje diferido por visibilidad ----------

function conInterseccion(win) {
  const ios = [];
  win.IntersectionObserver = class {
    constructor(cb, op = {}) {
      this.cb = cb;
      this.op = op;
      this.objetivos = new Set();
      ios.push(this);
    }
    observe(el) {
      this.objetivos.add(el);
    }
    unobserve(el) {
      this.objetivos.delete(el);
    }
    disconnect() {
      this.objetivos.clear();
    }
    takeRecords() {
      return [];
    }
  };
  // Simula que la figura entra (o no) en el margen del viewport.
  const cruzar = (fig, visible = true) => {
    let n = 0;
    for (const io of ios) {
      for (const el of [...io.objetivos]) {
        if (el !== fig && !fig.contains(el)) continue;
        n++;
        io.cb([{ target: el, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }], io);
      }
    }
    return n;
  };
  return { ios, cruzar };
}

test("diferido: con IntersectionObserver deja un marcador «Cargando modelo 3D…» y no descarga nada hasta que la figura se acerca (margen 200 px)", async () => {
  const win = ventana();
  const { ios, cruzar } = conInterseccion(win);
  const texto = `${bloque(`archivo: ${A}`)}\n${bloque(`archivo: ${B}`)}`;
  // montarVisores no espera a los visores que aún no se ven: su promesa se resuelve ya.
  const { f, doc } = await montar(texto, { win });
  const [uno, dos] = [...doc.querySelectorAll("figure.hw-modelo")];
  assert.equal(f.llamadas.urls.length, 0, "nada descargado");
  assert.equal(f.llamadas.three, 0, "paquete sin pedir");
  assert.ok(ios.length >= 1, "se usa IntersectionObserver");
  assert.ok(ios.every((io) => /200px/.test(String(io.op.rootMargin ?? ""))), "rootMargin de 200 px");
  for (const fig of [uno, dos]) {
    const marcador = fig.querySelector(":scope > div.hw-modelo-cargando");
    assert.ok(marcador, "marcador de carga");
    assert.equal(fig.firstElementChild, marcador);
    assert.equal(marcador.textContent, CARGANDO);
    assert.equal(marcador.hasAttribute("role"), false, "role=status queda para los avisos de fallo");
    assert.equal(fig.querySelector("canvas"), null);
  }
  // Una entrada que no cruza no monta nada.
  assert.ok(cruzar(dos, false) >= 1, "la figura (o su marcador) está observada");
  await pausa(20);
  assert.equal(f.llamadas.urls.length, 0);
  // Se acerca la segunda: solo esa se monta.
  cruzar(dos, true);
  await hasta(() => dos.querySelector("canvas"), "el segundo visor se monta al acercarse");
  assert.deepEqual(f.llamadas.urls, [src(B)]);
  assert.equal(dos.querySelector(".hw-modelo-cargando"), null);
  assert.equal(uno.querySelector("canvas"), null);
  assert.ok(uno.querySelector(".hw-modelo-cargando"));
  // Otra entrada de la misma figura no la monta dos veces.
  cruzar(dos, true);
  await pausa(20);
  assert.equal(f.llamadas.urls.length, 1);
  assert.equal(f.registro.renderers.length, 1);
});

test("diferido: una figura retirada antes de verse no se monta; el tope de 8 cuenta los visores vivos, no los pendientes", async () => {
  const win = ventana();
  const { cruzar } = conInterseccion(win);
  const ids = Array.from({ length: 10 }, (_, i) => uuid(i + 1));
  const texto = ids.map((id) => bloque(`archivo: ${id}`)).join("\n");
  const { f, doc } = await montar(texto, { win });
  const figs = [...doc.querySelectorAll("figure.hw-modelo")];
  assert.equal(doc.querySelectorAll("p[role=status]").length, 0, "pendientes: aún no hay avisos");
  // Se ven las 9 últimas: 8 se montan y una avisa. La primera sigue pendiente.
  for (const fig of figs.slice(1)) cruzar(fig, true);
  await hasta(() => doc.querySelectorAll("figure.hw-modelo canvas").length === 8 && doc.querySelectorAll("p[role=status]").length === 1, "8 visores y un aviso");
  assert.equal(aviso(figs[9])?.textContent, DEMASIADOS);
  // La primera se retira del DOM antes de verse: su entrada tardía no hace nada.
  const primera = figs[0];
  primera.remove();
  cruzar(primera, true);
  await pausa(20);
  assert.equal(primera.querySelector("canvas"), null);
  assert.ok(!f.llamadas.urls.includes(src(ids[0])), "no se descarga el archivo de una figura retirada");
});

// ---------- 7. Teclado, rueda y táctil ----------

test("teclaModelo: mapeo puro tecla → acción (flechas giran, + = - acercan o alejan, Mayús+flechas desplazan, 0 e Inicio restablecen)", async () => {
  const { teclaModelo, PASO_GIRO_MODELO } = await mv();
  assert.equal(typeof teclaModelo, "function");
  cerca(PASO_GIRO_MODELO, GRADOS_10, 1e-12, "paso de giro de 10°");
  const k = (key, extra = {}) => teclaModelo({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...extra });
  assert.deepEqual(k("ArrowLeft"), { accion: "girar", x: -1, y: 0 });
  assert.deepEqual(k("ArrowRight"), { accion: "girar", x: 1, y: 0 });
  assert.deepEqual(k("ArrowUp"), { accion: "girar", x: 0, y: 1 });
  assert.deepEqual(k("ArrowDown"), { accion: "girar", x: 0, y: -1 });
  assert.deepEqual(k("ArrowLeft", { shiftKey: true }), { accion: "desplazar", x: -1, y: 0 });
  assert.deepEqual(k("ArrowRight", { shiftKey: true }), { accion: "desplazar", x: 1, y: 0 });
  assert.deepEqual(k("ArrowUp", { shiftKey: true }), { accion: "desplazar", x: 0, y: 1 });
  assert.deepEqual(k("ArrowDown", { shiftKey: true }), { accion: "desplazar", x: 0, y: -1 });
  assert.deepEqual(k("+"), { accion: "zoom", sentido: 1 });
  assert.deepEqual(k("+", { shiftKey: true }), { accion: "zoom", sentido: 1 }, "en muchos teclados + es Mayús+=");
  assert.deepEqual(k("="), { accion: "zoom", sentido: 1 });
  assert.deepEqual(k("-"), { accion: "zoom", sentido: -1 });
  assert.deepEqual(k("0"), { accion: "restablecer" });
  assert.deepEqual(k("Home"), { accion: "restablecer" });
  for (const key of ["Tab", "Enter", " ", "Escape", "a", "PageDown", "End", "1", "F5"]) assert.equal(k(key), null, key);
  // Con Ctrl, Alt o Meta la tecla es del navegador (Ctrl + y Ctrl - son el zoom de la página).
  for (const m of ["ctrlKey", "altKey", "metaKey"]) {
    for (const key of ["ArrowLeft", "+", "-", "0", "Home"]) assert.equal(k(key, { [m]: true }), null, `${m}+${key}`);
  }
});

test("teclado: las flechas giran unos 10° alrededor del punto de mira, sin cambiar la distancia, y dibujan", async () => {
  const { win, f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  const r = f.registro.renderers[0];
  const ctl = f.registro.controles[0];
  const e0 = estado(f);
  let renders = r.renders;
  let actualizaciones = ctl.actualizaciones;
  const pulsa = (key, extra) => {
    const ev = tecla(win, lienzo, key, extra);
    assert.ok(ev.defaultPrevented, `${key}: preventDefault (no desplaza la página)`);
    assert.ok(r.renders > renders, `${key}: dibuja`);
    assert.ok(ctl.actualizaciones > actualizaciones, `${key}: controls.update()`);
    renders = r.renders;
    actualizaciones = ctl.actualizaciones;
    return estado(f);
  };
  const der = pulsa("ArrowRight");
  cerca(Math.abs(angulo(der.theta, e0.theta)), GRADOS_10, 1e-6, "→ gira 10° en horizontal");
  cerca(der.phi, e0.phi, 1e-6, "→ no cambia la elevación");
  cerca(der.radio, e0.radio, 1e-6, "→ misma distancia");
  cercaV(der.target, e0.target, 1e-9, "→ no mueve el punto de mira");
  const izq = pulsa("ArrowLeft");
  cerca(angulo(izq.theta, e0.theta), 0, 1e-6, "← deshace →");
  const otra = pulsa("ArrowLeft");
  cerca(angulo(otra.theta, e0.theta), -angulo(der.theta, e0.theta), 1e-6, "← gira al lado contrario que →");
  pulsa("ArrowRight");
  const arr = pulsa("ArrowUp");
  cerca(Math.abs(arr.phi - e0.phi), GRADOS_10, 1e-6, "↑ gira 10° en vertical");
  cerca(angulo(arr.theta, e0.theta), 0, 1e-6, "↑ no gira en horizontal");
  cerca(arr.radio, e0.radio, 1e-6, "↑ misma distancia");
  const aba = pulsa("ArrowDown");
  cerca(aba.phi, e0.phi, 1e-6, "↓ deshace ↑");
  // Nunca se cruza el polo: tras muchas pulsaciones la elevación sigue dentro de (0, π).
  for (let i = 0; i < 40; i++) tecla(win, lienzo, "ArrowUp");
  const tope = estado(f);
  assert.ok(tope.phi > 0 && tope.phi < Math.PI, `elevación acotada (${tope.phi})`);
  assert.ok(Number.isFinite(tope.pos.x + tope.pos.y + tope.pos.z));
});

test("teclado: + y = acercan, - aleja, Mayús+flechas desplazan cámara y punto de mira, 0 e Inicio restablecen", async () => {
  const { win, f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  const r = f.registro.renderers[0];
  const e0 = estado(f);
  const pulsa = (key, extra) => {
    const antes = r.renders;
    const ev = tecla(win, lienzo, key, extra);
    assert.ok(ev.defaultPrevented, `${key}: preventDefault`);
    assert.ok(r.renders > antes, `${key}: dibuja`);
    return estado(f);
  };
  const mas = pulsa("+");
  assert.ok(mas.radio < e0.radio, "+ acerca");
  cerca(angulo(mas.theta, e0.theta), 0, 1e-6, "+ no gira");
  cerca(mas.phi, e0.phi, 1e-6, "+ no gira");
  const igual = pulsa("=");
  assert.ok(igual.radio < mas.radio, "= también acerca");
  const menos = pulsa("-");
  assert.ok(menos.radio > igual.radio, "- aleja");
  assert.ok(menos.radio > 0);
  const base = estado(f);
  const pan = pulsa("ArrowRight", { shiftKey: true });
  assert.ok(pan.target.distanceTo(base.target) > 1e-6, "Mayús+→ mueve el punto de mira");
  cercaV(pan.delta, base.delta, 1e-6, "Mayús+→ mueve la cámara lo mismo (no gira ni acerca)");
  const vuelta = pulsa("ArrowLeft", { shiftKey: true });
  cercaV(vuelta.target, base.target, 1e-6, "Mayús+← deshace Mayús+→");
  const sube = pulsa("ArrowUp", { shiftKey: true });
  assert.ok(sube.target.distanceTo(base.target) > 1e-6, "Mayús+↑ desplaza");
  cercaV(sube.delta, base.delta, 1e-6, "Mayús+↑ conserva la vista");
  const baja = pulsa("ArrowDown", { shiftKey: true });
  cercaV(baja.target, base.target, 1e-6, "Mayús+↓ deshace Mayús+↑");
  // Restablecer: vuelve exactamente a la vista inicial.
  tecla(win, lienzo, "ArrowRight");
  tecla(win, lienzo, "ArrowUp", { shiftKey: true });
  const cero = pulsa("0");
  cercaV(cero.pos, e0.pos, 1e-9, "0 restablece la cámara");
  cercaV(cero.target, e0.target, 1e-9, "0 restablece el punto de mira");
  tecla(win, lienzo, "-");
  tecla(win, lienzo, "ArrowLeft");
  const inicio = pulsa("Home");
  cercaV(inicio.pos, e0.pos, 1e-9, "Inicio restablece la cámara");
  cercaV(inicio.target, e0.target, 1e-9, "Inicio restablece el punto de mira");
});

test("teclado: Tab nunca queda atrapado y las teclas ajenas (o con Ctrl/Alt/Meta) pasan sin tocar la vista", async () => {
  const { win, f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  const r = f.registro.renderers[0];
  const e0 = estado(f);
  const antes = r.renders;
  const casos = [["Tab"], ["Tab", { shiftKey: true }], ["Enter"], [" "], ["a"], ["Escape"], ["PageDown"], ["+", { ctrlKey: true }], ["-", { ctrlKey: true }], ["0", { ctrlKey: true }], ["ArrowLeft", { altKey: true }], ["ArrowRight", { metaKey: true }]];
  for (const [key, extra] of casos) {
    const ev = tecla(win, lienzo, key, extra);
    assert.equal(ev.defaultPrevented, false, `${key} ${JSON.stringify(extra ?? {})}: sin preventDefault`);
  }
  const e1 = estado(f);
  cercaV(e1.pos, e0.pos, 0, "la cámara no se mueve");
  cercaV(e1.target, e0.target, 0, "el punto de mira no se mueve");
  assert.equal(r.renders, antes, "no se dibuja");
  // Las teclas solo valen con el foco en el lienzo: en el botón o en el documento no hacen nada.
  const fuera = tecla(win, fig.querySelector("button"), "ArrowRight");
  assert.equal(fuera.defaultPrevented, false);
  cercaV(estado(f).pos, e0.pos, 0, "flecha en el botón: la vista no cambia");
});

test("botón «Restablecer vista»: vuelve a la vista inicial y dibuja", async () => {
  const { win, f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  const r = f.registro.renderers[0];
  const e0 = estado(f);
  tecla(win, lienzo, "ArrowRight");
  tecla(win, lienzo, "+");
  tecla(win, lienzo, "ArrowDown", { shiftKey: true });
  assert.ok(estado(f).pos.distanceTo(e0.pos) > 1e-6);
  const antes = r.renders;
  fig.querySelector(":scope > button.btn").dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  cercaV(estado(f).pos, e0.pos, 1e-9, "cámara inicial");
  cercaV(estado(f).target, e0.target, 1e-9, "punto de mira inicial");
  assert.ok(r.renders > antes, "dibuja");
});

test("rueda: el zoom de OrbitControls solo está activo con el foco en el lienzo (no secuestra el scroll de la página)", async () => {
  const { win, f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  const ctl = f.registro.controles[0];
  assert.equal(ctl.enableZoom, false, "sin foco: la rueda desplaza la página");
  lienzo.dispatchEvent(new win.FocusEvent("focus"));
  assert.equal(ctl.enableZoom, true, "con foco: la rueda hace zoom");
  lienzo.dispatchEvent(new win.FocusEvent("blur"));
  assert.equal(ctl.enableZoom, false, "al perder el foco se desactiva otra vez");
});

test("táctil: tras crear OrbitControls el lienzo queda con touch-action: pan-y (el gesto vertical sigue desplazando la página)", async () => {
  const { f, fig } = await montar(bloque(`archivo: ${A}`));
  const lienzo = lienzoDe(fig);
  assert.equal(f.registro.controles.length, 1, "OrbitControls creado (pone touch-action: none)");
  assert.equal(lienzo.style.getPropertyValue("touch-action"), "pan-y");
});

// ---------- 8. Carga del paquete y lectura del archivo ----------

test("cargarThree: import() de /vendor/three/three-visor.js, memoizado por documento; si falla se olvida y reintenta con ?reintento=N", async () => {
  const { cargarThree, URL_THREE } = await mv();
  assert.equal(URL_THREE, "/vendor/three/three-visor.js");
  const win = ventana();
  const pedidas = [];
  const pendientes = [];
  const importar = (url) => {
    pedidas.push(url);
    return new Promise((bien, mal) => pendientes.push({ bien, mal }));
  };
  const p1 = cargarThree(win.document, importar);
  assert.equal(cargarThree(win.document, importar), p1, "en curso: misma promesa");
  assert.deepEqual(pedidas, [URL_THREE]);
  pendientes[0].mal(new Error("red"));
  await assert.rejects(p1);
  const p2 = cargarThree(win.document, importar);
  assert.notEqual(p2, p1, "tras el fallo no se reutiliza la promesa rechazada");
  assert.equal(pedidas.length, 2);
  // El mapa de módulos del navegador recuerda el fallo por URL: el reintento usa otra URL del mismo origen.
  assert.match(pedidas[1], /^\/vendor\/three\/three-visor\.js\?reintento=\d+$/);
  const modulo = { REVISION: "187" };
  pendientes[1].bien(modulo);
  assert.equal(await p2, modulo);
  assert.equal(cargarThree(win.document, importar), p2, "carga correcta: se sigue deduplicando");
  assert.equal(pedidas.length, 2);
  // Otro documento, otra carga.
  const win2 = ventana();
  void cargarThree(win2.document, importar);
  assert.equal(pedidas.length, 3);
  for (const u of pedidas) assert.ok(u.startsWith("/vendor/three/three-visor.js"), "siempre mismo origen");
});

test("fuente: el paquete se pide con import() dinámico y /* @vite-ignore */ (sin <script> ni import estático de three)", () => {
  const s = leer("src/lib/modelo-visor.ts");
  assert.match(s, /import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*\w+\s*\)/);
  assert.doesNotMatch(s, /createElement\(\s*["']script["']\s*\)/);
});

function respuesta({ bytes = new ArrayBuffer(4), largo = null, ok = true, status = 200 }) {
  return { ok, status, headers: new Headers(largo === null ? {} : { "content-length": String(largo) }), arrayBuffer: async () => bytes };
}

test("leerArchivoModelo: fetch same-origin de la URL; devuelve el ArrayBuffer; HTTP no 2xx rechaza", async () => {
  const { leerArchivoModelo } = await mv();
  assert.equal(typeof leerArchivoModelo, "function");
  const win = ventana();
  const vistos = [];
  const bytes = stlBinario(1);
  win.fetch = async (url, init) => {
    vistos.push([url, init]);
    return respuesta({ bytes, largo: bytes.byteLength });
  };
  assert.equal(await leerArchivoModelo(win.document, src(A)), bytes);
  assert.equal(vistos.length, 1);
  assert.equal(vistos[0][0], src(A));
  assert.equal(vistos[0][1]?.credentials, "same-origin");
  win.fetch = async () => respuesta({ ok: false, status: 404 });
  await assert.rejects(leerArchivoModelo(win.document, src(A)), (e) => e.motivo !== "grande");
});

test("leerArchivoModelo: tope de 20 MB por content-length (sin leer el cuerpo) y por bytes reales; el error lleva motivo = \"grande\"", async () => {
  const { leerArchivoModelo } = await mv();
  const { MAX_MODELO_VISOR } = await vis();
  const win = ventana();
  let leido = false;
  win.fetch = async () => ({ ...respuesta({ largo: MAX_MODELO_VISOR + 1 }), arrayBuffer: async () => ((leido = true), new ArrayBuffer(1)) });
  await assert.rejects(leerArchivoModelo(win.document, src(A)), (e) => e.motivo === "grande");
  assert.equal(leido, false, "con content-length por encima del tope no se lee el cuerpo");
  // Sin content-length (o con uno falso): mandan los bytes reales.
  win.fetch = async () => respuesta({ bytes: new ArrayBuffer(MAX_MODELO_VISOR + 1), largo: 10 });
  await assert.rejects(leerArchivoModelo(win.document, src(A)), (e) => e.motivo === "grande");
  win.fetch = async () => respuesta({ bytes: new ArrayBuffer(MAX_MODELO_VISOR) });
  assert.equal((await leerArchivoModelo(win.document, src(A))).byteLength, MAX_MODELO_VISOR, "20 MB justos pasan");
});

// El WebGLRenderer del paquete (three 0.187) solo pide «webgl2»: con WebGL 1 a secas lanzaría al crear el visor.
test("soportaWebgl(doc): true solo si un <canvas> nuevo da contexto webgl2; con solo WebGL 1, sin contexto o si lanza, false", async () => {
  const { soportaWebgl } = await mv();
  assert.equal(typeof soportaWebgl, "function");
  const pedidos = [];
  const docCon = (getContext) => ({ createElement: (tag) => (assert.equal(tag, "canvas"), { getContext: (t, ...resto) => (pedidos.push(t), getContext(t, ...resto)) }) });
  assert.equal(soportaWebgl(docCon((t) => (t === "webgl2" ? {} : null))), true);
  assert.equal(soportaWebgl(docCon((t) => (t === "webgl" || t === "experimental-webgl" ? {} : null))), false, "solo WebGL 1: el visor no puede montarse");
  assert.equal(soportaWebgl(docCon(() => null)), false);
  assert.equal(soportaWebgl(docCon(() => { throw new Error("bloqueado"); })), false);
  assert.deepEqual([...new Set(pedidos)], ["webgl2"], "solo se pide webgl2 (no se crea un contexto WebGL 1 que no sirve)");
});

// ---------- 9. Ampliación: rol del lienzo, foco al perder el contexto y topes de triángulos y texturas ----------

const COMPLEJO = "El modelo es demasiado complejo para mostrarlo aquí. Descarga el archivo o expórtalo con menos detalle.";
const TOPE_TRIANGULOS = 500_000;
const TOPE_LADO = 4096;
const imagen = (width, height = width) => ({ width, height });

test("lienzo: role=application (recibe foco y maneja flechas, +, - y 0), con el mismo aria-label; la región sigue siendo role=region", async () => {
  for (const [nombre, archivo] of [["STL", stlBinario(2)], ["GLB", glb()]]) {
    const { win, fig } = await montar(bloque(`archivo: ${A}\ntitulo: Carcasa`), { archivo });
    const lienzo = lienzoDe(fig);
    assert.equal(lienzo.getAttribute("role"), "application", `${nombre}: el lector de pantalla deja pasar las teclas al lienzo`);
    assert.equal(lienzo.getAttribute("aria-label"), ARIA_LIENZO, `${nombre}: el nombre accesible no cambia`);
    assert.equal(lienzo.getAttribute("tabindex"), "0", nombre);
    assert.equal(lienzo.hasAttribute("aria-roledescription"), false, `${nombre}: sin descripción de rol inventada`);
    assert.equal(lienzo.parentElement.getAttribute("role"), "region", nombre);
    assert.equal(fig.querySelectorAll("[role=application]").length, 1, `${nombre}: solo el lienzo es application`);
    win.close();
  }
});

test("pérdida de contexto WebGL: si el foco estaba en el lienzo o en «Restablecer vista» pasa al enlace de descarga; si estaba fuera del visor no se mueve", async () => {
  const texto = bloque(`archivo: ${A}`);
  const perder = (win, lienzo) => lienzo.dispatchEvent(new win.Event("webglcontextlost", { cancelable: true }));
  // Foco en lo que el aviso retira (el lienzo o el botón): sin esto caería en <body>.
  for (const [nombre, elegir] of [["lienzo", (fig) => lienzoDe(fig)], ["botón «Restablecer vista»", (fig) => fig.querySelector(":scope > button.btn")]]) {
    const { win, fig, doc } = await montar(texto);
    const lienzo = lienzoDe(fig);
    const enfocado = elegir(fig);
    enfocado.focus();
    assert.equal(doc.activeElement, enfocado, `${nombre}: premisa, el foco está en el visor`);
    perder(win, lienzo);
    assert.equal(aviso(fig)?.textContent, GENERAL, nombre);
    const enlace = fig.querySelector(":scope > a");
    assert.equal(enlace.textContent, "Descargar modelo 3D");
    assert.equal(doc.activeElement, enlace, `${nombre}: el foco pasa al enlace «Descargar modelo 3D», no a <body>`);
    win.close();
  }
  // Foco fuera del visor: no se roba.
  {
    const { win, fig, doc } = await montar(texto);
    const fuera = doc.createElement("button");
    doc.body.append(fuera);
    fuera.focus();
    perder(win, lienzoDe(fig));
    assert.equal(aviso(fig)?.textContent, GENERAL);
    assert.equal(doc.activeElement, fuera, "el foco estaba en otro control de la página: se queda ahí");
    win.close();
  }
  // Sin foco en ningún control: tampoco.
  {
    const { win, fig, doc } = await montar(texto);
    assert.equal(doc.activeElement, doc.body, "premisa: nada enfocado");
    perder(win, lienzoDe(fig));
    assert.equal(doc.activeElement, doc.body, "no se enfoca nada por su cuenta");
    win.close();
  }
  // Dos visores: el foco está en el lienzo del primero y pierde el contexto el segundo.
  {
    const { win, doc } = await montar(`${texto}\n${bloque(`archivo: ${B}`)}`);
    const [uno, dos] = [...doc.querySelectorAll("figure.hw-modelo")];
    const lienzoUno = lienzoDe(uno);
    lienzoUno.focus();
    perder(win, lienzoDe(dos));
    assert.equal(aviso(dos)?.textContent, GENERAL);
    assert.equal(doc.activeElement, lienzoUno, "el foco sigue en el lienzo del otro visor");
    assert.equal(aviso(uno), null, "el otro visor sigue vivo");
    win.close();
  }
});

test("topes exportados: MAX_TRIANGULOS_MODELO, MAX_LADO_TEXTURA_MODELO, MAX_PIXELES_TEXTURAS_MODELO y el aviso AVISO_MODELO_COMPLEJO", async () => {
  const v = await vis();
  const m = await mv();
  assert.equal(v.MAX_TRIANGULOS_MODELO, 500_000);
  assert.equal(v.MAX_LADO_TEXTURA_MODELO, 4096);
  assert.equal(v.MAX_PIXELES_TEXTURAS_MODELO, 4 * 4096 * 4096);
  assert.equal(m.AVISO_MODELO_COMPLEJO, COMPLEJO);
  assert.doesNotMatch(COMPLEJO, /[—–]/, "sin rayas largas");
  assert.doesNotMatch(COMPLEJO, /tri[aá]ngulo|textura|p[ií]xel|v[eé]rtice|WebGL|GPU|pol[ií]gono/i, "sin jerga");
  assert.ok(COMPLEJO.length <= 110, "corto");
  // El tope no rechaza ningún STL que ya cabía en 20 MB: el binario más grande admitido tiene menos triángulos.
  assert.ok(Math.floor((v.MAX_MODELO_VISOR - 84) / 50) < v.MAX_TRIANGULOS_MODELO);
});

// Fallo por tamaño medido tras cargar: aviso, sin contexto WebGL, y lo cargado (geometría, material, texturas) se suelta.
function esperaComplejo(fig, f, nombre) {
  esperaFallo(fig, f, COMPLEJO, nombre);
  assert.equal(f.llamadas.three, 1, `${nombre}: se mide lo que cargó el loader`);
  assert.equal(f.registro.controles.length, 0, `${nombre}: sin OrbitControls`);
  assert.ok(f.registro.geometrias.length >= 1 && f.registro.geometrias.every((g) => g.liberado >= 1), `${nombre}: geometry.dispose()`);
  assert.ok(f.registro.materiales.every((x) => x.liberado >= 1), `${nombre}: material.dispose()`);
  assert.ok(f.registro.mapas.every((t) => t.liberado >= 1), `${nombre}: texture.dispose()`);
}

test("tope de triángulos: más de 500 000 (por vértices, por índices, sumando mallas o por instancias) → aviso sin crear el lienzo; 500 000 justos se muestran", async () => {
  const texto = bloque(`archivo: ${A}`);
  const pasan = [
    ["STL sin índice", { three: { triangulos: TOPE_TRIANGULOS + 1 } }],
    ["GLB sin índice", { archivo: glb(), three: { triangulos: TOPE_TRIANGULOS + 1 } }],
    ["GLB indexado (pocos vértices, muchos índices)", { archivo: glb(), three: { indices: 3 * (TOPE_TRIANGULOS + 1) } }],
    ["GLB con dos mallas que comparten geometría", { archivo: glb(), three: { triangulos: TOPE_TRIANGULOS / 2 + 1, mallas: 2 } }],
    ["GLB con malla instanciada", { archivo: glb(), three: { triangulos: 200_000, instancias: 3 } }],
  ];
  for (const [nombre, op] of pasan) {
    const { win, f, fig } = await montar(texto, op);
    esperaComplejo(fig, f, nombre);
    win.close();
  }
  const caben = [
    ["STL de 500 000 triángulos", { three: { triangulos: TOPE_TRIANGULOS } }],
    ["GLB de 500 000 triángulos por índices", { archivo: glb(), three: { indices: 3 * TOPE_TRIANGULOS } }],
    ["GLB indexado: cuentan los índices, no los vértices", { archivo: glb(), three: { triangulos: 600_000, indices: 3 } }],
    ["GLB con dos mallas de 250 000", { archivo: glb(), three: { triangulos: TOPE_TRIANGULOS / 2, mallas: 2 } }],
    ["GLB con 5 instancias de 100 000", { archivo: glb(), three: { triangulos: 100_000, instancias: 5 } }],
    // El STL binario más grande que cabe en 20 MB (419 428 triángulos) sigue viéndose.
    ["STL binario de 20 MB", { archivo: stlBinario(419_428), three: { triangulos: 419_428 } }],
  ];
  for (const [nombre, op] of caben) {
    const { win, f, fig } = await montar(texto, op);
    assert.equal(aviso(fig), null, `${nombre}: sin aviso`);
    assert.ok(lienzoDe(fig), nombre);
    assert.equal(f.registro.renderers.length, 1, nombre);
    win.close();
  }
});

test("tope de texturas: un lado de más de 4096 px, o más de 4 × 4096² px sumando las imágenes distintas → aviso sin crear el lienzo", async () => {
  const texto = bloque(`archivo: ${A}`);
  const cinco = () => Array.from({ length: 5 }, () => imagen(TOPE_LADO));
  const pasan = [
    ["ancho de 4097 px", [imagen(TOPE_LADO + 1, 16)]],
    ["alto de 4097 px", [imagen(16, TOPE_LADO + 1)]],
    ["8192 × 8192", [imagen(8192)]],
    ["una grande entre varias pequeñas", [imagen(256), imagen(512), imagen(TOPE_LADO + 1, 4)]],
    ["cinco imágenes distintas de 4096 × 4096", cinco()],
  ];
  for (const [nombre, texturas] of pasan) {
    const { win, f, fig } = await montar(texto, { archivo: glb(), three: { texturas } });
    esperaComplejo(fig, f, nombre);
    win.close();
  }
  const compartida = imagen(TOPE_LADO);
  const caben = [
    ["una de 4096 × 4096", [imagen(TOPE_LADO)]],
    ["cuatro de 4096 × 4096", cinco().slice(0, 4)],
    ["la misma imagen de 4096 × 4096 en cinco texturas (cuenta una vez)", [compartida, compartida, compartida, compartida, compartida]],
    ["textura sin imagen medible", [undefined, {}, imagen(64)]],
  ];
  for (const [nombre, texturas] of caben) {
    const { win, f, fig } = await montar(texto, { archivo: glb(), three: { texturas } });
    assert.equal(aviso(fig), null, `${nombre}: sin aviso`);
    assert.ok(lienzoDe(fig), nombre);
    assert.equal(f.registro.renderers.length, 1, nombre);
    win.close();
  }
});

test("GLB que declara un accessor de más de 1 500 000 elementos: aviso «complejo» sin pedir el paquete ni llegar a GLTFLoader", async () => {
  const texto = bloque(`archivo: ${A}`);
  const conAccessor = (count) => glb({ asset: { version: "2.0" }, accessors: [{ componentType: 5126, type: "VEC3", count: 3 }, { componentType: 5126, type: "VEC3", count }] });
  const { win, f, fig } = await montar(texto, { archivo: conAccessor(3 * TOPE_TRIANGULOS + 1) });
  esperaFallo(fig, f, COMPLEJO, "accessor enorme");
  assert.equal(f.llamadas.three, 0, "se rechaza antes de pedir el paquete: el loader reservaría la memoria que declara");
  assert.equal(f.registro.gltf.length, 0, "GLTFLoader no se instancia");
  win.close();
  // En el tope justo pasa la inspección y se muestra.
  const justo = await montar(texto, { archivo: conAccessor(3 * TOPE_TRIANGULOS) });
  assert.equal(aviso(justo.fig), null);
  assert.ok(lienzoDe(justo.fig));
  justo.win.close();
});
