// Visor 3D del bloque ```modelo (STL o GLB ya subido como adjunto). three.js llega vendorizado y se carga solo cuando hace
// falta (public/vendor/three/three-visor.js; ver tools/vendor-three/README.md). Todo se inyecta para probarlo sin WebGL.
// Orden del montaje: plaza del tope -> WebGL -> descarga -> tamaño -> tipo por contenido -> inspección del GLB -> paquete ->
// modelo -> lienzo. Con cualquier fallo anterior al paquete, el paquete no se pide.
// El dibujo es bajo demanda (al cargar, al mover la vista, al redimensionar y tras cada tecla): no hay bucle de cuadros ni
// giro propio, así que no hay movimiento que reducir.
import { inspeccionarGlb, tipoModelo, MAX_MODELO_VISOR, type DatosModelo } from "./visores.ts";

export const AVISO_MODELO_GENERAL = "No se pudo mostrar el modelo 3D. Descarga el archivo para abrirlo en tu programa de CAD.";
export const AVISO_MODELO_SIN_WEBGL = "Este navegador no puede mostrar modelos 3D. Descarga el archivo.";
export const AVISO_MODELO_COMPRIMIDO = "Este GLB usa compresión (Draco, Meshopt o KTX2) que el visor no admite. Descarga el archivo o expórtalo sin compresión.";
export const AVISO_MODELO_EXTERNO = "Este GLB depende de archivos externos y no se muestra aquí. Expórtalo como un solo archivo.";
export const AVISO_MODELO_GRANDE = "El modelo pesa más de 20 MB y no se muestra aquí. Descarga el archivo.";
export const AVISO_MODELO_DEMASIADOS = "Hay demasiados modelos 3D abiertos en esta página. Descarga el archivo.";
export const TEXTO_CARGANDO_MODELO = "Cargando modelo 3D…";
export const TECLAS_MODELO = "Flechas para girar, más y menos para acercar, Mayús con flechas para desplazar, cero para restablecer.";

// Cada visor vivo ocupa un contexto WebGL y el navegador da pocos por pestaña.
export const MAX_MODELOS_ACTIVOS = 8;
export const PASO_GIRO_MODELO = Math.PI / 18;
export const URL_THREE = "/vendor/three/three-visor.js";

const FACTOR_ZOOM = 0.8;
const PASO_DESPLAZAR = 0.1; // fracción de la distancia al punto de mira
const MARGEN_POLO = 0.02; // rad: la cámara no llega a ponerse justo encima ni justo debajo
const CAMPO_VISION = 40; // grados, en vertical
const ELEVACION_INICIAL = (55 * Math.PI) / 180; // ángulo con el eje vertical: unos 35° sobre el horizonte
const ACIMUT_INICIAL = Math.PI / 4;
const OCUPACION = 0.75; // parte del lienzo que ocupa la esfera que envuelve al modelo (el modelo, en torno al 70 %)
const GRIS_STL = 0x9aa3ad;
const DOS_CARAS = 2; // THREE.DoubleSide (el paquete no exporta la constante)

// ---------- Teclado (mapeo puro) ----------
export type AccionModelo =
  | { accion: "girar"; x: number; y: number }
  | { accion: "desplazar"; x: number; y: number }
  | { accion: "zoom"; sentido: 1 | -1 }
  | { accion: "restablecer" };

const FLECHAS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

// Con Ctrl, Alt o Meta la tecla es del navegador (Ctrl + y Ctrl - son el zoom de la página). Tab y el resto no se tocan.
export function teclaModelo(e: { key: string; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): AccionModelo | null {
  if (!e || e.ctrlKey || e.altKey || e.metaKey) return null;
  const flecha = Object.prototype.hasOwnProperty.call(FLECHAS, e.key) ? FLECHAS[e.key] : null;
  if (flecha) return { accion: e.shiftKey ? "desplazar" : "girar", x: flecha[0], y: flecha[1] };
  if (e.key === "+" || e.key === "=") return { accion: "zoom", sentido: 1 };
  if (e.key === "-") return { accion: "zoom", sentido: -1 };
  if (e.key === "0" || e.key === "Home") return { accion: "restablecer" };
  return null;
}

// ---------- Paquete, descarga y WebGL ----------
const cargasThree = new WeakMap<object, Promise<any>>();
let reintentosThree = 0;
const importarModulo = (url: string): Promise<any> => import(/* @vite-ignore */ url);

// import() dinámico del paquete (mismo origen, permitido por script-src 'self'), una vez por documento. Devuelve siempre la
// misma promesa mientras carga o si cargó. Si falla se olvida, y el reintento usa otra URL (?reintento=N) porque el mapa de
// módulos del navegador recuerda el fallo por URL.
export function cargarThree(doc: any, importar: (url: string) => Promise<any> = importarModulo): Promise<any> {
  const previa = cargasThree.get(doc);
  if (previa) return previa;
  const url = reintentosThree ? `${URL_THREE}?reintento=${reintentosThree}` : URL_THREE;
  let p: Promise<any>;
  try {
    p = Promise.resolve(importar(url));
  } catch (err) {
    p = Promise.reject(err);
  }
  cargasThree.set(doc, p);
  p.catch(() => {
    if (cargasThree.get(doc) === p) cargasThree.delete(doc);
    reintentosThree++;
  });
  return p;
}

const errorGrande = () => Object.assign(new Error("Archivo demasiado grande"), { motivo: "grande" });

// Descarga del portal (mismo origen, con la sesión). Tope de 20 MB por content-length, sin leer el cuerpo, y por bytes reales.
export async function leerArchivoModelo(doc: any, url: string): Promise<ArrayBuffer> {
  const win = doc.defaultView ?? globalThis;
  const res = await win.fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const largo = Number(res.headers.get("content-length"));
  if (Number.isFinite(largo) && largo > MAX_MODELO_VISOR) throw errorGrande();
  const bytes: ArrayBuffer = await res.arrayBuffer();
  if (bytes.byteLength > MAX_MODELO_VISOR) throw errorGrande();
  return bytes;
}

// ¿El navegador da un contexto WebGL? Se prueba con un <canvas> desechable.
export function soportaWebgl(doc: any): boolean {
  try {
    const lienzo = doc.createElement("canvas");
    return lienzo.getContext("webgl2") != null || lienzo.getContext("webgl") != null;
  } catch {
    return false;
  }
}

// ---------- Registro por documento ----------
export type OpcionesModelo = { cargarThree(): Promise<any>; leer(url: string): Promise<ArrayBuffer>; webgl(): boolean };

type VisorModelo = {
  fig: any;
  liberado: boolean;
  objeto: any; // modelo cargado (malla del STL o escena del GLB)
  renderer: any;
  controles: any;
  soltar: (() => void)[]; // observadores y listeners por retirar
};
type Registro = { visores: Set<VisorModelo>; pendientes: Map<any, () => void>; io: any };

const registros = new WeakMap<object, Registro>();
const atendidas = new WeakSet<object>(); // figuras que ya tienen visor, marcador o aviso: no se vuelven a montar

function registroDe(doc: any): Registro {
  let reg = registros.get(doc);
  if (!reg) {
    reg = { visores: new Set(), pendientes: new Map(), io: null };
    registros.set(doc, reg);
    // Al salir de la página se sueltan los contextos WebGL de los visores que ya no están en el DOM.
    doc.defaultView?.addEventListener?.("pagehide", () => liberarModelos(doc));
  }
  return reg;
}

function soltarObjeto(objeto: any): void {
  objeto?.traverse?.((o: any) => {
    o.geometry?.dispose?.();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const valor of Object.values(m ?? {})) if ((valor as any)?.isTexture) (valor as any).dispose?.();
      m?.dispose?.();
    }
  });
}

// Suelta todo lo que retiene un visor. Cada paso va protegido: un fallo al soltar una parte no deja viva la siguiente.
function liberar(reg: Registro, v: VisorModelo): void {
  if (v.liberado) return;
  v.liberado = true;
  reg.visores.delete(v);
  const intentar = (fn: () => void) => {
    try {
      fn();
    } catch {
      // nada que hacer: se sigue soltando el resto
    }
  };
  for (const fn of v.soltar.splice(0)) intentar(fn);
  intentar(() => v.controles?.dispose());
  intentar(() => soltarObjeto(v.objeto));
  intentar(() => v.renderer?.dispose());
  intentar(() => v.renderer?.forceContextLoss());
  v.objeto = v.renderer = v.controles = null;
}

// Libera los visores (y los montajes pendientes) cuyas figuras ya no están en el documento. Lo llama montarVisores al
// empezar, también cuando la página nueva no tiene modelos.
export function liberarModelos(doc: any): void {
  const reg = registros.get(doc);
  if (!reg) return;
  for (const v of [...reg.visores]) if (!v.fig.isConnected) liberar(reg, v);
  for (const fig of [...reg.pendientes.keys()]) {
    if (fig.isConnected) continue;
    reg.pendientes.delete(fig);
    reg.io?.unobserve(fig);
  }
}

// ---------- Montaje ----------
function ponerAviso(doc: any, fig: any, texto: string): void {
  for (const el of fig.querySelectorAll(":scope > .hw-modelo-cargando, :scope > [role=region], :scope > button.btn, :scope > [role=status]")) el.remove();
  const aviso = doc.createElement("p");
  aviso.setAttribute("role", "status");
  aviso.textContent = texto;
  fig.insertBefore(aviso, fig.firstChild);
}

const conAviso = (aviso: string) => Object.assign(new Error(aviso), { aviso });

function mallaStl(THREE: any, bytes: ArrayBuffer): any {
  const geometria = new THREE.STLLoader().parse(bytes);
  // Sombreado plano y a dos caras: el STL no garantiza normales ni sentido de los triángulos, y así ninguna cara sale negra.
  const material = new THREE.MeshStandardMaterial({ color: GRIS_STL, metalness: 0.05, roughness: 0.7, flatShading: true, side: DOS_CARAS });
  return new THREE.Mesh(geometria, material);
}

// GLTFLoader.parse con ruta base vacía. Defensa en profundidad tras inspeccionarGlb: el LoadingManager solo deja pasar URLs
// blob: (las que crea el propio loader para las imágenes embebidas). Las texturas se cargan con <img> (TextureLoader), que la
// CSP permite por img-src blob:, en lugar de fetch(blob:), que connect-src 'self' bloquea.
function escenaGlb(THREE: any, bytes: ArrayBuffer): Promise<any> {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url: unknown) => (typeof url === "string" && url.startsWith("blob:") ? url : "about:invalid"));
  const loader = new THREE.GLTFLoader(manager);
  loader.register((parser: any) => {
    parser.textureLoader = new THREE.TextureLoader(manager);
    return { name: "vt-texturas" };
  });
  return new Promise((bien, mal) => {
    loader.parse(bytes, "", (gltf: any) => {
      const escena = gltf?.scene ?? gltf?.scenes?.[0];
      if (escena) bien(escena);
      else mal(new Error("GLB sin escena"));
    }, mal);
  });
}

// Con Z hacia arriba se permutan los ejes (x, y, z) -> (y, z, x) para medir las esféricas sobre el eje vertical con Spherical,
// que mide sobre Y (el paquete no trae Quaternion). aMundo deshace la permutación.
const aLocal = (THREE: any, d: any, ejeZ: boolean) => (ejeZ ? new THREE.Vector3(d.y, d.z, d.x) : new THREE.Vector3(d.x, d.y, d.z));
const aMundo = (l: any, ejeZ: boolean) => (ejeZ ? l.set(l.z, l.x, l.y) : l);
const acotar = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

// Crea lienzo, escena, cámara y controles dentro de la figura. Si algo lanza, quien llama libera `v` y pone el aviso.
function crearVisor(THREE: any, doc: any, fig: any, d: DatosModelo, reg: Registro, v: VisorModelo, ejeZ: boolean): void {
  const win = doc.defaultView ?? globalThis;
  const caja = new THREE.Box3().setFromObject(v.objeto);
  if (caja.isEmpty()) throw new Error("Modelo vacío");
  const centro = caja.getCenter(new THREE.Vector3());
  const radio = caja.getSize(new THREE.Vector3()).length() / 2;
  if (!(radio > 0) || ![radio, centro.x, centro.y, centro.z].every(Number.isFinite)) throw new Error("Modelo sin medidas");

  const region = doc.createElement("div");
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", d.titulo ? `Modelo 3D: ${d.titulo}` : "Modelo 3D");
  const lienzo = doc.createElement("canvas");
  lienzo.setAttribute("tabindex", "0");
  lienzo.setAttribute("aria-label", `Vista 3D interactiva. ${TECLAS_MODELO}`);
  const ayuda = doc.createElement("p");
  ayuda.className = "hw-modelo-ayuda";
  ayuda.setAttribute("aria-hidden", "true");
  ayuda.textContent = TECLAS_MODELO;
  region.append(lienzo, ayuda);
  // El lienzo ocupa el sitio del marcador (misma caja en el CSS): no hay salto y ya se puede medir.
  const marcador = fig.querySelector(":scope > .hw-modelo-cargando");
  if (marcador) marcador.replaceWith(region);
  else fig.insertBefore(region, fig.firstChild);

  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, alpha: true, antialias: true });
  v.renderer = renderer;
  renderer.setPixelRatio(Math.min(Number(win.devicePixelRatio) || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const medida = (): [number, number] => [Math.floor(lienzo.clientWidth || 0), Math.floor(lienzo.clientHeight || 0)];
  const [ancho0, alto0] = medida();
  const aspecto = ancho0 > 0 && alto0 > 0 ? ancho0 / alto0 : 1;
  // Distancia para que la esfera del modelo quepa con margen en el lado más corto del lienzo.
  const tangente = Math.tan((CAMPO_VISION * Math.PI) / 360) * Math.min(1, aspecto);
  const distancia = radio / (OCUPACION * tangente);
  const lejos = distancia * 8;

  const escena = new THREE.Scene();
  escena.add(v.objeto);
  const ambiente = new THREE.HemisphereLight(0xffffff, 0xb4b8bd, 1.6);
  if (ejeZ) ambiente.position.set(0, 0, 1); // el «cielo» de la luz sigue al eje vertical del modelo
  escena.add(ambiente);
  const camara = new THREE.PerspectiveCamera(CAMPO_VISION, aspecto, radio / 100, lejos + radio * 2);
  // La luz direccional cuelga de la cámara (ella y su objetivo): alumbra siempre lo que se mira, desde arriba a la izquierda.
  const luz = new THREE.DirectionalLight(0xffffff, 2);
  luz.position.set(-1, 1.5, 1);
  luz.target.position.set(0, 0, -1);
  camara.add(luz);
  camara.add(luz.target);
  escena.add(camara);

  // OrbitControls toma su eje vertical de camera.up al construirse: se fija antes.
  if (ejeZ) camara.up.set(0, 0, 1);
  // Vista de tres cuartos desde arriba. En un STL (Z arriba, frente en -Y) y en un GLB (Y arriba, frente en +Z) queda delante a la derecha.
  const inicial = aMundo(new THREE.Vector3().setFromSphericalCoords(distancia, ELEVACION_INICIAL, ejeZ ? -ACIMUT_INICIAL : ACIMUT_INICIAL), ejeZ);
  camara.position.copy(centro).add(inicial);
  const controles = new THREE.OrbitControls(camara, lienzo);
  v.controles = controles;
  controles.enableDamping = false;
  controles.enableZoom = false; // la rueda solo hace zoom con el foco en el lienzo
  controles.cursorStyle = "grab"; // mano abierta, y cerrada mientras se arrastra
  controles.minDistance = radio * 0.05;
  controles.maxDistance = lejos;
  controles.target.copy(centro);
  controles.update();
  // OrbitControls bloquea los gestos táctiles del navegador: se devuelve el desplazamiento vertical de la página.
  lienzo.style.setProperty("touch-action", "pan-y");
  const posicion0 = camara.position.clone();
  const mira0 = controles.target.clone();

  let dibujos = 0;
  const dibujar = () => {
    if (v.liberado) return;
    dibujos++;
    renderer.render(escena, camara);
  };
  // Tamaño del búfer sin escribir estilos en línea (el ancho y el alto los pone el CSS).
  const ajustar = () => {
    if (v.liberado) return;
    const [ancho, alto] = medida();
    if (ancho > 0 && alto > 0) {
      renderer.setSize(ancho, alto, false);
      camara.aspect = ancho / alto;
      camara.updateProjectionMatrix();
    }
    dibujar();
  };
  // controls.update() avisa con «change» si la vista cambió y eso ya dibuja: solo se dibuja aparte si no lo hizo.
  const refrescar = () => {
    const antes = dibujos;
    controles.update();
    if (dibujos === antes) dibujar();
  };
  const restablecer = () => {
    if (v.liberado) return;
    camara.position.copy(posicion0);
    controles.target.copy(mira0);
    refrescar();
  };
  const aplicar = (a: AccionModelo) => {
    if (a.accion === "restablecer") return restablecer();
    const delta = new THREE.Vector3().subVectors(camara.position, controles.target);
    if (a.accion === "desplazar") {
      // Cámara y punto de mira se mueven lo mismo, sobre el plano de la pantalla.
      const hacia = delta.clone().negate().normalize();
      const derecha = new THREE.Vector3().crossVectors(hacia, camara.up);
      if (derecha.length() < 1e-9) return;
      derecha.normalize();
      const arriba = new THREE.Vector3().crossVectors(derecha, hacia).normalize();
      const paso = delta.length() * PASO_DESPLAZAR;
      const mover = derecha.multiplyScalar(a.x * paso).addScaledVector(arriba, a.y * paso);
      camara.position.add(mover);
      controles.target.add(mover);
    } else {
      const s = new THREE.Spherical().setFromVector3(aLocal(THREE, delta, ejeZ));
      if (a.accion === "girar") {
        s.theta += a.x * PASO_GIRO_MODELO;
        s.phi = acotar(s.phi - a.y * PASO_GIRO_MODELO, MARGEN_POLO, Math.PI - MARGEN_POLO);
      } else {
        s.radius = acotar(a.sentido > 0 ? s.radius * FACTOR_ZOOM : s.radius / FACTOR_ZOOM, controles.minDistance, controles.maxDistance);
      }
      camara.position.copy(controles.target).add(aMundo(new THREE.Vector3().setFromSpherical(s), ejeZ));
    }
    refrescar();
  };

  const oir = (el: any, tipo: string, fn: (e: any) => void) => {
    el.addEventListener(tipo, fn);
    v.soltar.push(() => el.removeEventListener(tipo, fn));
  };
  oir(controles, "change", dibujar);
  oir(lienzo, "keydown", (e: any) => {
    if (v.liberado) return;
    const a = teclaModelo(e);
    if (!a) return;
    e.preventDefault();
    aplicar(a);
  });
  oir(lienzo, "focus", () => {
    if (v.controles) controles.enableZoom = true;
  });
  oir(lienzo, "blur", () => {
    if (v.controles) controles.enableZoom = false;
  });
  // El pellizco no secuestra el desplazamiento de la página: en táctil el zoom vale mientras haya dedos sobre el lienzo.
  oir(lienzo, "pointerdown", (e: any) => {
    if (v.controles && e.pointerType === "touch") controles.enableZoom = true;
  });
  for (const tipo of ["pointerup", "pointercancel"]) {
    oir(lienzo, tipo, (e: any) => {
      if (v.controles && e.pointerType === "touch" && doc.activeElement !== lienzo) controles.enableZoom = false;
    });
  }
  oir(lienzo, "webglcontextlost", () => {
    if (v.liberado) return;
    liberar(reg, v);
    ponerAviso(doc, fig, AVISO_MODELO_GENERAL);
  });

  const boton = doc.createElement("button");
  boton.setAttribute("type", "button");
  boton.className = "btn";
  boton.textContent = "Restablecer vista";
  oir(boton, "click", restablecer);
  const enlaces = [...fig.children].filter((c: any) => c.tagName === "A");
  const ultimo = enlaces[enlaces.length - 1];
  if (ultimo) ultimo.after(boton);
  else fig.insertBefore(boton, fig.querySelector("figcaption"));

  if (typeof win.ResizeObserver === "function") {
    const observador = new win.ResizeObserver(ajustar);
    observador.observe(lienzo);
    v.soltar.push(() => observador.disconnect());
  }
  ajustar();
}

async function montarAhora(doc: any, fig: any, d: DatosModelo, url: string, o: OpcionesModelo, reg: Registro): Promise<void> {
  if (!fig.isConnected) return;
  // La plaza se reserva antes de descargar nada.
  if (reg.visores.size >= MAX_MODELOS_ACTIVOS) {
    ponerAviso(doc, fig, AVISO_MODELO_DEMASIADOS);
    return;
  }
  const v: VisorModelo = { fig, liberado: false, objeto: null, renderer: null, controles: null, soltar: [] };
  reg.visores.add(v);
  // Tras cada espera: si la figura salió del documento (o ya se liberó el visor) no se sigue.
  const sigue = () => {
    if (!v.liberado && !fig.isConnected) liberar(reg, v);
    return !v.liberado;
  };
  try {
    if (!o.webgl()) throw conAviso(AVISO_MODELO_SIN_WEBGL);
    let bytes: ArrayBuffer;
    try {
      bytes = await o.leer(url);
    } catch (err: any) {
      throw conAviso(err?.motivo === "grande" ? AVISO_MODELO_GRANDE : AVISO_MODELO_GENERAL);
    }
    if (!sigue()) return;
    if (!(bytes?.byteLength >= 0)) throw new Error("Sin datos");
    if (bytes.byteLength > MAX_MODELO_VISOR) throw conAviso(AVISO_MODELO_GRANDE);
    const tipo = tipoModelo(bytes);
    if (!tipo) throw new Error("No es un modelo");
    if (tipo === "glb") {
      const r = inspeccionarGlb(bytes);
      if (!r.ok) throw conAviso(r.motivo === "externo" ? AVISO_MODELO_EXTERNO : r.motivo === "comprimido" ? AVISO_MODELO_COMPRIMIDO : AVISO_MODELO_GENERAL);
    }
    const THREE = await o.cargarThree();
    if (!sigue()) return;
    const objeto = tipo === "stl" ? mallaStl(THREE, bytes) : await escenaGlb(THREE, bytes);
    if (!sigue()) {
      soltarObjeto(objeto);
      return;
    }
    v.objeto = objeto;
    crearVisor(THREE, doc, fig, d, reg, v, tipo === "stl");
  } catch (err: any) {
    liberar(reg, v);
    if (fig.isConnected) ponerAviso(doc, fig, typeof err?.aviso === "string" ? err.aviso : AVISO_MODELO_GENERAL);
  }
}

// Monta el visor en una figura ya pintada. `url` sale de los datos del bloque, nunca del DOM. Si el navegador tiene
// IntersectionObserver, deja un marcador y no descarga nada hasta que la figura se acerca a la pantalla: en ese caso la
// promesa se resuelve ya. Es idempotente: una figura con visor, marcador o aviso no se vuelve a montar.
export function montarModelo(doc: any, fig: any, d: DatosModelo, url: string, o: OpcionesModelo): Promise<void> {
  if (atendidas.has(fig)) return Promise.resolve();
  atendidas.add(fig);
  const reg = registroDe(doc);
  const marcador = doc.createElement("div");
  marcador.className = "hw-modelo-cargando";
  marcador.textContent = TEXTO_CARGANDO_MODELO;
  fig.insertBefore(marcador, fig.firstChild);
  const Observador = doc.defaultView?.IntersectionObserver;
  if (typeof Observador !== "function") return montarAhora(doc, fig, d, url, o, reg);
  reg.io ??= new Observador(
    (entradas: any[]) => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        const montar = reg.pendientes.get(e.target);
        if (!montar) continue;
        reg.pendientes.delete(e.target);
        reg.io.unobserve(e.target);
        montar();
      }
    },
    { rootMargin: "200px" },
  );
  reg.pendientes.set(fig, () => void montarAhora(doc, fig, d, url, o, reg));
  reg.io.observe(fig);
  return Promise.resolve();
}
