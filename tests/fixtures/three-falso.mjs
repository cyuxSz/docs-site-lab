// Doble de three.js para los tests del visor de modelos 3D (lote d-modelo-3d). Sin WebGL: solo anota lo que el portal le hace.
// Expone exactamente los nombres que exporta public/vendor/three/three-visor.js. La matemática (Vector3, Spherical, Box3) es
// real y cubre los métodos habituales; si la implementación necesita otro método de three, se añade aquí sin tocar aserciones.
//
//   const { THREE, registro } = crearThreeFalso(win, { caja, cajaVacia, errorStl, errorGltf, triangulos, indices, mallas, instancias, texturas });
//   Tamaño del modelo (para los topes): triangulos = n → geometría sin índice con 3·n vértices; indices = n → geometry.index.count;
//   mallas = k → el GLB trae k mallas que comparten geometría y material; instancias = k → la malla del GLB es una InstancedMesh
//   (isInstancedMesh, count = k); texturas = [imagen, …] → una textura por entrada con esa `image` ({ width, height }); el mismo
//   objeto repetido es una imagen compartida por varias texturas. Sin `texturas`, el GLB lleva una textura sin imagen.
//   registro.renderers[i]  -> { parametros, domElement, pixelRatio, tamanos, renders, liberado, contextoPerdido }
//   registro.controles[i]  -> { object, domElement, target, enableZoom, enableDamping, autoRotate, upAlCrear, actualizaciones, liberado, emitir(tipo) }
//   registro.gltf[i]       -> { manager, llamadas: [{ datos, ruta }], parsers: [{ textureLoader }], plugins, prohibidos }
//   registro.stl[i]        -> { llamadas: [datos] }
//   registro.managers[i]   -> { modificador }           registro.texturas[i] -> { manager }
//   registro.escenas, registro.camaras, registro.geometrias, registro.materiales, registro.mapas (con .liberado)

const EXPORTS = [
  "AmbientLight", "Box3", "Color", "DirectionalLight", "HemisphereLight", "LoadingManager", "Mesh", "MeshStandardMaterial",
  "PerspectiveCamera", "Scene", "Spherical", "SRGBColorSpace", "TextureLoader", "Vector3", "WebGLRenderer", "REVISION",
  "STLLoader", "GLTFLoader", "OrbitControls",
];
export const EXPORTS_THREE = Object.freeze([...EXPORTS]);

const acotar = (v, a, b) => Math.max(a, Math.min(b, v));

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.isVector3 = true;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(s) {
    return this.set(s, s, s);
  }
  setX(x) {
    this.x = x;
    return this;
  }
  setY(y) {
    this.y = y;
    return this;
  }
  setZ(z) {
    this.z = z;
    return this;
  }
  copy(v) {
    return this.set(v.x, v.y, v.z);
  }
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  add(v) {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  addScalar(s) {
    return this.set(this.x + s, this.y + s, this.z + s);
  }
  addVectors(a, b) {
    return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }
  addScaledVector(v, s) {
    return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s);
  }
  sub(v) {
    return this.set(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  subVectors(a, b) {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  multiply(v) {
    return this.set(this.x * v.x, this.y * v.y, this.z * v.z);
  }
  multiplyScalar(s) {
    return this.set(this.x * s, this.y * s, this.z * s);
  }
  divideScalar(s) {
    return this.multiplyScalar(1 / s);
  }
  negate() {
    return this.multiplyScalar(-1);
  }
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  lengthSq() {
    return this.dot(this);
  }
  length() {
    return Math.sqrt(this.lengthSq());
  }
  setLength(l) {
    return this.normalize().multiplyScalar(l);
  }
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  distanceToSquared(v) {
    return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2;
  }
  distanceTo(v) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  crossVectors(a, b) {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  cross(v) {
    return this.crossVectors(this.clone(), v);
  }
  lerp(v, t) {
    return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t);
  }
  lerpVectors(a, b, t) {
    return this.copy(a).lerp(b, t);
  }
  min(v) {
    return this.set(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z));
  }
  max(v) {
    return this.set(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z));
  }
  equals(v) {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
  toArray(a = [], o = 0) {
    a[o] = this.x;
    a[o + 1] = this.y;
    a[o + 2] = this.z;
    return a;
  }
  fromArray(a, o = 0) {
    return this.set(a[o], a[o + 1], a[o + 2]);
  }
  setFromSphericalCoords(radio, phi, theta) {
    const s = Math.sin(phi) * radio;
    return this.set(s * Math.sin(theta), Math.cos(phi) * radio, s * Math.cos(theta));
  }
  setFromSpherical(s) {
    return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
  }
  setFromMatrixColumn(m, i) {
    return this.fromArray(m.elements, i * 4);
  }
  // Rodrigues: giro de `angulo` radianes alrededor de un eje unitario.
  applyAxisAngle(eje, angulo) {
    const c = Math.cos(angulo);
    const s = Math.sin(angulo);
    const k = eje;
    const kxv = new Vector3().crossVectors(k, this);
    const kv = k.dot(this) * (1 - c);
    return this.set(this.x * c + kxv.x * s + k.x * kv, this.y * c + kxv.y * s + k.y * kv, this.z * c + kxv.z * s + k.z * kv);
  }
}

export class Spherical {
  constructor(radius = 1, phi = 0, theta = 0) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
  }
  set(radius, phi, theta) {
    this.radius = radius;
    this.phi = phi;
    this.theta = theta;
    return this;
  }
  copy(o) {
    return this.set(o.radius, o.phi, o.theta);
  }
  clone() {
    return new Spherical(this.radius, this.phi, this.theta);
  }
  makeSafe() {
    const EPS = 0.000001;
    this.phi = acotar(this.phi, EPS, Math.PI - EPS);
    return this;
  }
  setFromCartesianCoords(x, y, z) {
    this.radius = Math.sqrt(x * x + y * y + z * z);
    if (this.radius === 0) {
      this.theta = 0;
      this.phi = 0;
    } else {
      this.theta = Math.atan2(x, z);
      this.phi = Math.acos(acotar(y / this.radius, -1, 1));
    }
    return this;
  }
  setFromVector3(v) {
    return this.setFromCartesianCoords(v.x, v.y, v.z);
  }
}

class Color {
  constructor(...args) {
    this.isColor = true;
    this.args = args;
  }
  set(...args) {
    this.args = args;
    return this;
  }
}

const identidad = () => ({ elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });

class Objeto3D {
  constructor() {
    this.isObject3D = true;
    this.children = [];
    this.parent = null;
    this.position = new Vector3();
    this.scale = new Vector3(1, 1, 1);
    this.up = new Vector3(0, 1, 0);
    this.rotation = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
    this.matrix = identidad();
    this.matrixWorld = identidad();
    this.userData = {};
    this.visible = true;
    this.miradas = [];
  }
  add(...objetos) {
    for (const o of objetos) {
      o.parent = this;
      this.children.push(o);
    }
    return this;
  }
  remove(...objetos) {
    for (const o of objetos) {
      const i = this.children.indexOf(o);
      if (i >= 0) this.children.splice(i, 1);
      o.parent = null;
    }
    return this;
  }
  clear() {
    return this.remove(...this.children.slice());
  }
  traverse(fn) {
    fn(this);
    for (const c of this.children.slice()) c.traverse(fn);
  }
  lookAt(x, y, z) {
    this.miradas.push(x?.isVector3 ? x.clone() : new Vector3(x, y, z));
  }
  getWorldPosition(destino) {
    return destino.copy(this.position);
  }
  updateMatrix() {}
  updateMatrixWorld() {}
  updateWorldMatrix() {}
  rotateX() {
    return this;
  }
  rotateY() {
    return this;
  }
  rotateZ() {
    return this;
  }
}

export function crearThreeFalso(win, opciones = {}) {
  const doc = win.document;
  const caja = opciones.caja ?? { min: [-1, -2, -3], max: [1, 2, 3] };
  const registro = {
    renderers: [], controles: [], gltf: [], stl: [], managers: [], texturas: [], escenas: [], camaras: [],
    geometrias: [], materiales: [], mapas: [], mallas: [],
  };
  const liberable = (lista, extra = {}) => {
    const o = { liberado: 0, dispose() { o.liberado++; }, ...extra };
    lista.push(o);
    return o;
  };

  class Box3 {
    constructor(min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)) {
      this.isBox3 = true;
      this.min = min;
      this.max = max;
    }
    makeEmpty() {
      this.min.setScalar(Infinity);
      this.max.setScalar(-Infinity);
      return this;
    }
    set(min, max) {
      this.min.copy(min);
      this.max.copy(max);
      return this;
    }
    copy(b) {
      return this.set(b.min, b.max);
    }
    clone() {
      return new Box3(this.min.clone(), this.max.clone());
    }
    // El doble no tiene vértices: cualquier objeto mide lo que diga `opciones.caja` (o nada si `cajaVacia`).
    setFromObject() {
      if (opciones.cajaVacia) return this.makeEmpty();
      this.min.fromArray(caja.min);
      this.max.fromArray(caja.max);
      return this;
    }
    expandByObject() {
      if (opciones.cajaVacia) return this;
      this.min.min(new Vector3().fromArray(caja.min));
      this.max.max(new Vector3().fromArray(caja.max));
      return this;
    }
    union(b) {
      this.min.min(b.min);
      this.max.max(b.max);
      return this;
    }
    isEmpty() {
      return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
    }
    getCenter(destino) {
      return this.isEmpty() ? destino.set(0, 0, 0) : destino.addVectors(this.min, this.max).multiplyScalar(0.5);
    }
    getSize(destino) {
      return this.isEmpty() ? destino.set(0, 0, 0) : destino.subVectors(this.max, this.min);
    }
    getBoundingSphere(destino) {
      destino.center ??= new Vector3();
      this.getCenter(destino.center);
      destino.radius = this.isEmpty() ? -1 : this.getSize(new Vector3()).length() / 2;
      return destino;
    }
  }

  const cajaDeModelo = () => new Box3().setFromObject();
  function crearGeometria() {
    const vertices = opciones.triangulos != null ? opciones.triangulos * 3 : 36;
    const g = liberable(registro.geometrias, {
      isBufferGeometry: true,
      attributes: opciones.cajaVacia ? {} : { position: { count: vertices }, normal: { count: vertices } },
      // Como el real: null si la geometría no está indexada.
      index: opciones.indices != null ? { count: opciones.indices } : null,
      boundingBox: null,
      boundingSphere: null,
      computeVertexNormals() {},
      computeBoundingBox() {
        g.boundingBox = cajaDeModelo();
      },
      computeBoundingSphere() {
        g.boundingSphere = cajaDeModelo().getBoundingSphere({});
      },
      center() {
        return g;
      },
      translate() {
        return g;
      },
      rotateX() {
        return g;
      },
      hasAttribute: (n) => Boolean(g.attributes[n]),
      getAttribute: (n) => g.attributes[n],
    });
    return g;
  }

  class Scene extends Objeto3D {
    constructor() {
      super();
      this.isScene = true;
      this.background = null;
      registro.escenas.push(this);
    }
  }
  class Mesh extends Objeto3D {
    constructor(geometry, material) {
      super();
      this.isMesh = true;
      this.geometry = geometry;
      this.material = material;
      registro.mallas.push(this);
    }
  }
  class Luz extends Objeto3D {
    constructor(...args) {
      super();
      this.isLight = true;
      this.args = args;
      this.intensity = 1;
      this.color = new Color();
      this.target = new Objeto3D();
    }
  }
  class AmbientLight extends Luz {}
  class DirectionalLight extends Luz {}
  class HemisphereLight extends Luz {}
  class MeshStandardMaterial {
    constructor(parametros = {}) {
      this.isMaterial = true;
      this.parametros = parametros;
      this.liberado = 0;
      Object.assign(this, parametros);
      registro.materiales.push(this);
    }
    dispose() {
      this.liberado++;
    }
  }
  class PerspectiveCamera extends Objeto3D {
    constructor(fov = 50, aspect = 1, near = 0.1, far = 2000) {
      super();
      this.isPerspectiveCamera = true;
      this.isCamera = true;
      Object.assign(this, { fov, aspect, near, far, zoom: 1, proyecciones: 0 });
      registro.camaras.push(this);
    }
    updateProjectionMatrix() {
      this.proyecciones++;
    }
    getWorldDirection(destino) {
      const a = this.miradas[this.miradas.length - 1] ?? new Vector3(0, 0, -1).add(this.position);
      return destino.subVectors(a, this.position).normalize();
    }
  }
  class WebGLRenderer {
    constructor(parametros = {}) {
      this.parametros = parametros;
      this.domElement = parametros.canvas ?? doc.createElement("canvas");
      this.pixelRatio = 1;
      this.tamanos = [];
      this.renders = 0;
      this.ultimo = null;
      this.liberado = 0;
      this.contextoPerdido = 0;
      this.shadowMap = {};
      this.outputColorSpace = "";
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.info = { memory: {}, render: {} };
      registro.renderers.push(this);
    }
    setPixelRatio(n) {
      this.pixelRatio = n;
    }
    getPixelRatio() {
      return this.pixelRatio;
    }
    setSize(w, h, estilo) {
      this.tamanos.push([w, h, estilo]);
    }
    setClearColor(...args) {
      this.fondo = args;
    }
    setClearAlpha(a) {
      this.alfa = a;
    }
    getContext() {
      return { isContextLost: () => this.contextoPerdido > 0 };
    }
    render(escena, camara) {
      this.renders++;
      this.ultimo = { escena, camara };
    }
    dispose() {
      this.liberado++;
    }
    forceContextLoss() {
      this.contextoPerdido++;
    }
    setAnimationLoop(fn) {
      this.bucle = fn;
    }
  }
  class LoadingManager {
    constructor(...args) {
      this.args = args;
      this.modificador = null;
      registro.managers.push(this);
    }
    setURLModifier(fn) {
      this.modificador = fn;
      return this;
    }
    resolveURL(url) {
      return this.modificador ? this.modificador(url) : url;
    }
    itemStart() {}
    itemEnd() {}
    itemError() {}
  }
  class TextureLoader {
    constructor(manager) {
      this.isTextureLoader = true;
      this.manager = manager;
      registro.texturas.push(this);
    }
    load() {
      return liberable(registro.mapas, { isTexture: true });
    }
    setCrossOrigin() {
      return this;
    }
    setRequestHeader() {
      return this;
    }
  }
  class STLLoader {
    constructor(manager) {
      this.manager = manager;
      this.llamadas = [];
      registro.stl.push(this);
    }
    parse(datos) {
      this.llamadas.push(datos);
      if (opciones.errorStl) throw new Error("STL roto");
      return crearGeometria();
    }
    load() {
      throw new Error("El visor no debe usar STLLoader.load: descarga el portal y se llama a parse()");
    }
  }
  // Escena de un GLB: un grupo con una malla cuyo material lleva una textura (map). Con `texturas`, una textura por imagen
  // (map, normalMap…); con `mallas`, varias mallas con la misma geometría y material; con `instancias`, cada malla es instanciada.
  const RANURAS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "bumpMap"];
  function escenaGltf() {
    const grupo = new Objeto3D();
    grupo.isGroup = true;
    const mapas = opciones.texturas
      ? opciones.texturas.map((image) => liberable(registro.mapas, { isTexture: true, image }))
      : [liberable(registro.mapas, { isTexture: true })];
    if (mapas.length > RANURAS.length) throw new Error("El doble admite hasta 8 texturas por material");
    const material = new MeshStandardMaterial(Object.fromEntries(mapas.map((m, i) => [RANURAS[i], m])));
    const geometria = crearGeometria();
    for (let i = 0; i < (opciones.mallas ?? 1); i++) {
      const malla = new Mesh(geometria, material);
      if (opciones.instancias != null) {
        malla.isInstancedMesh = true;
        malla.count = opciones.instancias;
      }
      grupo.add(malla);
    }
    return grupo;
  }
  class GLTFLoader {
    constructor(manager) {
      this.manager = manager;
      this.llamadas = [];
      this.parsers = [];
      this.plugins = [];
      this.registrados = [];
      this.prohibidos = [];
      registro.gltf.push(this);
    }
    register(fn) {
      this.registrados.push(fn);
      return this;
    }
    setDRACOLoader() {
      this.prohibidos.push("draco");
      return this;
    }
    setKTX2Loader() {
      this.prohibidos.push("ktx2");
      return this;
    }
    setMeshoptDecoder() {
      this.prohibidos.push("meshopt");
      return this;
    }
    load() {
      throw new Error("El visor no debe usar GLTFLoader.load: descarga el portal y se llama a parse()");
    }
    parse(datos, ruta, bien, mal) {
      this.llamadas.push({ datos, ruta });
      // Como el real: el parser nace con ImageBitmapLoader y los plugins registrados pueden cambiarlo.
      const parser = { options: { manager: this.manager, path: ruta }, textureLoader: { isImageBitmapLoader: true } };
      this.parsers.push(parser);
      for (const fn of this.registrados) this.plugins.push(fn(parser));
      queueMicrotask(() => {
        if (opciones.errorGltf) mal?.(new Error("GLB roto"));
        else bien?.({ scene: escenaGltf(), scenes: [], animations: [{ name: "giro" }], cameras: [], asset: { version: "2.0" }, parser });
      });
    }
    parseAsync(datos, ruta) {
      return new Promise((bien, mal) => this.parse(datos, ruta, bien, mal));
    }
  }
  class OrbitControls {
    constructor(object, domElement) {
      if (!domElement) throw new Error("OrbitControls necesita el lienzo");
      Object.assign(this, {
        object, domElement, target: new Vector3(), enabled: true, enableDamping: false, enableZoom: true, enablePan: true, enableRotate: true,
        autoRotate: false, minDistance: 0, maxDistance: Infinity, zoomSpeed: 1, rotateSpeed: 1, panSpeed: 1, screenSpacePanning: true,
        actualizaciones: 0, liberado: 0, teclado: null, oyentes: new Map(),
        mouseButtons: {}, touches: {},
        // El real fija su eje vertical con object.up al construirse: cambiar camera.up después no le afecta.
        upAlCrear: object.up.clone(),
      });
      // Como el real (connect): bloquea los gestos táctiles del navegador sobre el lienzo.
      domElement.style.touchAction = "none";
      registro.controles.push(this);
    }
    addEventListener(tipo, fn) {
      if (!this.oyentes.has(tipo)) this.oyentes.set(tipo, new Set());
      this.oyentes.get(tipo).add(fn);
    }
    removeEventListener(tipo, fn) {
      this.oyentes.get(tipo)?.delete(fn);
    }
    dispatchEvent(ev) {
      for (const fn of [...(this.oyentes.get(ev.type) ?? [])]) fn.call(this, { ...ev, target: this });
    }
    emitir(tipo) {
      this.dispatchEvent({ type: tipo });
    }
    listenToKeyEvents(el) {
      this.teclado = el;
    }
    stopListenToKeyEvents() {
      this.teclado = null;
    }
    saveState() {
      this.guardado = { target: this.target.clone(), position: this.object.position.clone(), zoom: this.object.zoom };
    }
    reset() {
      if (!this.guardado) return;
      this.target.copy(this.guardado.target);
      this.object.position.copy(this.guardado.position);
      this.object.zoom = this.guardado.zoom;
      this.object.updateProjectionMatrix?.();
      this.emitir("change");
      this.update();
    }
    getDistance() {
      return this.object.position.distanceTo(this.target);
    }
    update() {
      this.actualizaciones++;
      this.object.lookAt(this.target);
      return false;
    }
    dispose() {
      this.liberado++;
    }
  }

  const THREE = {
    AmbientLight, Box3, Color, DirectionalLight, HemisphereLight, LoadingManager, Mesh, MeshStandardMaterial,
    PerspectiveCamera, Scene, Spherical, SRGBColorSpace: "srgb", TextureLoader, Vector3, WebGLRenderer, REVISION: "187",
    STLLoader, GLTFLoader, OrbitControls,
  };
  for (const k of Object.keys(THREE)) if (!EXPORTS.includes(k)) throw new Error(`El doble exporta de más: ${k}`);
  return { THREE: Object.freeze(THREE), registro };
}

// ---------- Archivos de prueba ----------

// GLB mínimo: cabecera (magia, versión, longitud), chunk JSON relleno a 4 bytes con espacios y, opcional, chunk BIN.
export function glb(json = { asset: { version: "2.0" } }, { version = 2, bin = null, declarado = null, tipoChunk = 0x4e4f534a, magia = 0x46546c67, textoJson = null } = {}) {
  let texto = new TextEncoder().encode(textoJson ?? JSON.stringify(json));
  const relleno = (4 - (texto.length % 4)) % 4;
  if (relleno) texto = Uint8Array.from([...texto, ...new Array(relleno).fill(0x20)]);
  const binLargo = bin ? bin.length + ((4 - (bin.length % 4)) % 4) : 0;
  const total = 12 + 8 + texto.length + (bin ? 8 + binLargo : 0);
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, magia, true);
  v.setUint32(4, version, true);
  v.setUint32(8, declarado ?? total, true);
  v.setUint32(12, texto.length, true);
  v.setUint32(16, tipoChunk, true);
  bytes.set(texto, 20);
  if (bin) {
    const o = 20 + texto.length;
    v.setUint32(o, binLargo, true);
    v.setUint32(o + 4, 0x004e4942, true);
    bytes.set(bin, o + 8);
  }
  return bytes.buffer;
}

// STL binario: 80 bytes de cabecera, uint32 con el número de triángulos y 50 bytes por triángulo.
export function stlBinario(triangulos = 2, cabecera = "portal") {
  const bytes = new Uint8Array(84 + 50 * triangulos);
  bytes.set(new TextEncoder().encode(cabecera).slice(0, 80), 0);
  new DataView(bytes.buffer).setUint32(80, triangulos, true);
  return bytes.buffer;
}

export const STL_ASCII = "solid pieza\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid pieza\n";
export const stlAscii = (texto = STL_ASCII) => new TextEncoder().encode(texto).buffer;
