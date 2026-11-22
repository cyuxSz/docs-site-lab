// Lote d-modelo-3d: bloque ```modelo (visor 3D de un STL o GLB ya subido como adjunto). Lógica pura y render saneado.
// Formato del bloque (una clave por línea, "clave: valor"):
//   ```modelo
//   archivo: <uuid del .stl o .glb en /api/archivos>
//   titulo: Carcasa del casco      (opcional, ≤ 120)
//   ```
// El HTML saneado solo lleva el enlace de descarga. El lienzo lo crea montarVisores (tests/d-modelo-visor.test.mjs).
// Un GLB es contenido no confiable: antes de dárselo a GLTFLoader se inspecciona con inspeccionarGlb (sin three).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { glb, stlAscii, stlBinario } from "./fixtures/three-falso.mjs";

const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const vis = () => import("../src/lib/visores.ts");
const md = () => import("../src/lib/hardware-md.ts");
const ventana = () => new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "https://docs.example/uuv/mecanica/" }).window;
const bloque = (cuerpo) => "```modelo\n" + cuerpo + "\n```\n";
const src = (id, proyecto = "uuv") => `/api/archivos/?proyecto=${proyecto}&id=${id}`;
const MB = 1024 * 1024;
const fn = (mod, nombre) => {
  assert.equal(typeof mod[nombre], "function", `src/lib/visores.ts debe exportar ${nombre}()`);
  return mod[nombre];
};

// ---------- 1. Bloque ```modelo (visores.ts) ----------

test("parsearModelo: archivo (uuid) y título opcional; orden libre, CRLF tolerado; uuid a minúsculas", async () => {
  const parsearModelo = fn(await vis(), "parsearModelo");
  assert.deepEqual(parsearModelo(`archivo: ${A}\ntitulo: Carcasa del casco`), { archivo: A, titulo: "Carcasa del casco" });
  assert.deepEqual(parsearModelo(`archivo: ${A}`), { archivo: A, titulo: "" });
  assert.deepEqual(parsearModelo(`\r\n titulo:  Carcasa \r\n\r\narchivo:${A.toUpperCase()}\r\n`), { archivo: A, titulo: "Carcasa" });
});

test("parsearModelo: rechaza (null) ids no uuid, rutas, URLs, claves desconocidas o repetidas y títulos largos", async () => {
  const parsearModelo = fn(await vis(), "parsearModelo");
  const malos = [
    "",
    "titulo: Solo título",
    "archivo: https://evil.example/pieza.glb",
    `archivo: ../../${A}`,
    `archivo: ${A}\narchivo: ${B}`,
    `archivo: ${A}\ntitulo: a\ntitulo: b`,
    `archivo: ${A}\nrespaldo: ${B}`,
    `archivo: ${A}\nsrc: https://evil.example/`,
    `archivo: ${A}\nautorotate: si`,
    `archivo: ${A}\ntitulo: ${"x".repeat(121)}`,
    `archivo: ${A}\nlinea sin dos puntos`,
  ];
  for (const m of malos) assert.equal(parsearModelo(m), null, JSON.stringify(m));
});

test("bloqueModelo: fence canónico (archivo, titulo), inverso de parsearModelo; limpia el título y lanza con ids no uuid", async () => {
  const mod = await vis();
  const bloqueModelo = fn(mod, "bloqueModelo");
  const parsearModelo = fn(mod, "parsearModelo");
  assert.equal(bloqueModelo({ archivo: A, titulo: "Carcasa" }), `\`\`\`modelo\narchivo: ${A}\ntitulo: Carcasa\n\`\`\`\n`);
  assert.equal(bloqueModelo({ archivo: A.toUpperCase() }), `\`\`\`modelo\narchivo: ${A}\n\`\`\`\n`);
  const raro = bloqueModelo({ archivo: A, titulo: "a\narchivo: x\u0007\n```" });
  assert.equal(raro.match(/```/g).length, 2, raro);
  assert.equal(parsearModelo(raro.replace(/^```modelo\n/, "").replace(/```\n$/, "")).archivo, A);
  assert.throws(() => bloqueModelo({ archivo: "../x" }));
  assert.throws(() => bloqueModelo({ archivo: "https://evil.example/x.glb" }));
  assert.throws(() => bloqueModelo({}));
});

test("MAX_MODELO_VISOR = 20 MB (la subida admite 50 MB, el visor no carga más de 20)", async () => {
  const { MAX_MODELO_VISOR } = await vis();
  assert.equal(MAX_MODELO_VISOR, 20 * MB);
});

test("archivoModelo: exactamente un .stl o .glb (sin distinguir mayúsculas) de hasta 20 MB", async () => {
  const archivoModelo = fn(await vis(), "archivoModelo");
  const stl = { name: "Carcasa.STL", size: 1000 };
  const ok = archivoModelo([stl]);
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.archivo, stl);
  assert.equal(archivoModelo([{ name: "casco.glb", size: 20 * MB }]).ok, true, "20 MB justos se aceptan");
  const malos = [
    [],
    [stl, { name: "otra.glb", size: 1 }],
    [{ name: "pieza.step", size: 1 }],
    [{ name: "pieza.gltf", size: 1 }],
    [{ name: "pieza.3mf", size: 1 }],
    [{ name: "pieza.stl.zip", size: 1 }],
    [{ name: "stl", size: 1 }],
  ];
  for (const m of malos) {
    const r = archivoModelo(m);
    assert.equal(r.ok, false, JSON.stringify(m));
    assert.match(r.error, /\.stl/);
    assert.match(r.error, /\.glb/);
  }
});

test("archivoModelo: más de 20 MB (o tamaño no numérico) → error que manda a «Adjuntar archivo», sin aceptar el archivo", async () => {
  const archivoModelo = fn(await vis(), "archivoModelo");
  for (const size of [20 * MB + 1, 50 * MB, Number.NaN]) {
    const r = archivoModelo([{ name: "grande.glb", size }]);
    assert.equal(r.ok, false, String(size));
    assert.equal(r.error, 'El visor muestra modelos de hasta 20 MB. Súbelo con "Adjuntar archivo".');
  }
});

// ---------- 2. Tipo por contenido (no por extensión) ----------

test("tipoModelo: magia glTF → glb; STL binario (84 + 50·n bytes exactos) o ASCII (empieza por solid) → stl; lo demás → null", async () => {
  const tipoModelo = fn(await vis(), "tipoModelo");
  assert.equal(tipoModelo(glb()), "glb");
  assert.equal(tipoModelo(stlBinario(2)), "stl");
  assert.equal(tipoModelo(stlBinario(3, "solid exportado por un CAD que escribe solid en la cabecera binaria")), "stl", "binario aunque la cabecera diga solid");
  assert.equal(tipoModelo(stlAscii()), "stl");
  assert.equal(tipoModelo(stlAscii("\n\t  solid pieza\nendsolid pieza\n")), "stl", "ASCII tras espacios iniciales");
  const texto = (t) => new TextEncoder().encode(t).buffer;
  const cortado = stlBinario(2).slice(0, 84 + 50 * 2 - 1);
  const malos = [
    new ArrayBuffer(0),
    new ArrayBuffer(10),
    cortado,
    new Uint8Array(84 + 50 * 2 + 7).buffer,
    texto("<!doctype html><html>solid</html>"),
    texto("%PDF-1.7\n"),
    texto("(kicad_pcb (version 20251024))"),
    texto("solido no es la palabra clave"),
    texto('{"asset":{"version":"2.0"}}'),
    texto("PK\u0003\u0004 esto es un zip (3mf)"),
  ];
  for (const m of malos) assert.equal(tipoModelo(m), null, `${m.byteLength} bytes`);
});

// ---------- 3. Inspección del GLB ----------

test("inspeccionarGlb: acepta un GLB 2.0 autocontenido (buffers e imágenes por bufferView, sin uri), con o sin chunk BIN", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  assert.deepEqual(inspeccionarGlb(glb()), { ok: true });
  const completo = {
    asset: { version: "2.0", generator: "prueba" },
    extensionsUsed: ["KHR_materials_emissive_strength", "KHR_texture_transform"],
    buffers: [{ byteLength: 8 }],
    bufferViews: [{ buffer: 0, byteLength: 8 }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
    textures: [{ source: 0 }],
  };
  assert.deepEqual(inspeccionarGlb(glb(completo, { bin: new Uint8Array(8) })), { ok: true });
});

test("inspeccionarGlb: formato → cabecera corta, magia o versión distinta de 2, longitud declarada que no cuadra, primer chunk que no es JSON o se sale", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const bueno = glb();
  const casos = {
    vacio: new ArrayBuffer(0),
    "cabecera de 12 bytes": bueno.slice(0, 12),
    "sin magia glTF": glb(undefined, { magia: 0x12345678 }),
    "versión 1": glb(undefined, { version: 1 }),
    "versión 3": glb(undefined, { version: 3 }),
    truncado: bueno.slice(0, bueno.byteLength - 4),
    "declara más bytes de los que hay": glb(undefined, { declarado: bueno.byteLength + 400 }),
    "declara menos bytes de los que hay": glb(undefined, { declarado: bueno.byteLength - 4 }),
    "primer chunk BIN": glb(undefined, { tipoChunk: 0x004e4942 }),
    "stl binario": stlBinario(2),
  };
  // Chunk JSON que dice medir más que el archivo.
  const salido = new Uint8Array(bueno.slice(0));
  new DataView(salido.buffer).setUint32(12, bueno.byteLength, true);
  casos["chunk JSON más largo que el archivo"] = salido.buffer;
  for (const [nombre, bytes] of Object.entries(casos)) assert.deepEqual(inspeccionarGlb(bytes), { ok: false, motivo: "formato" }, nombre);
});

test("inspeccionarGlb: formato → JSON inválido, que no es un objeto, o más grande que MAX_JSON_GLB (no se llega a parsear)", async () => {
  const mod = await vis();
  const inspeccionarGlb = fn(mod, "inspeccionarGlb");
  assert.equal(mod.MAX_JSON_GLB, 4 * MB, "tope del chunk JSON");
  for (const textoJson of ["{no es json", "[1,2,3]", "null", '"texto"', "42", ""]) {
    assert.deepEqual(inspeccionarGlb(glb(undefined, { textoJson })), { ok: false, motivo: "formato" }, JSON.stringify(textoJson));
  }
  // JSON válido pero enorme: se rechaza por tamaño. JSON.parse no debe verse nunca con ese texto.
  const enorme = glb(undefined, { textoJson: `{"asset":{"version":"2.0"},"x":"${"a".repeat(mod.MAX_JSON_GLB)}"}` });
  const real = JSON.parse;
  let vistos = 0;
  JSON.parse = (t, ...r) => {
    if (String(t).length > mod.MAX_JSON_GLB) vistos++;
    return real(t, ...r);
  };
  try {
    assert.deepEqual(inspeccionarGlb(enorme), { ok: false, motivo: "formato" });
  } finally {
    JSON.parse = real;
  }
  assert.equal(vistos, 0, "el chunk se rechaza por su tamaño declarado, antes de decodificar y parsear");
  for (const json of [{ asset: { version: "2.0" }, buffers: {} }, { asset: { version: "2.0" }, images: "x" }, { asset: { version: "2.0" }, extensionsUsed: "KHR_x" }]) {
    assert.deepEqual(inspeccionarGlb(glb(json)), { ok: false, motivo: "formato" }, JSON.stringify(json));
  }
});

test("inspeccionarGlb: externo → cualquier uri en buffers o images (remota, relativa al portal, data: o vacía)", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const uris = ["https://evil.example/geo.bin", "//evil.example/t.png", "/auth/logout", "textura.png", "../api/hardware/?proyecto=uuv", "data:application/octet-stream;base64,AAAA", "blob:https://docs.example/x", ""];
  for (const uri of uris) {
    assert.deepEqual(inspeccionarGlb(glb({ asset: { version: "2.0" }, buffers: [{ byteLength: 4, uri }] })), { ok: false, motivo: "externo" }, `buffer ${uri}`);
    assert.deepEqual(inspeccionarGlb(glb({ asset: { version: "2.0" }, images: [{ bufferView: 0, mimeType: "image/png" }, { uri }] })), { ok: false, motivo: "externo" }, `imagen ${uri}`);
  }
  // Una uri que no es texto tampoco pasa.
  assert.deepEqual(inspeccionarGlb(glb({ asset: { version: "2.0" }, images: [{ uri: 7 }] })), { ok: false, motivo: "externo" });
});

test("inspeccionarGlb: comprimido → Draco, Meshopt o KTX2/Basis en extensionsUsed o extensionsRequired; externo gana si se dan los dos", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  for (const ext of ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_meshopt_compression", "KHR_texture_basisu"]) {
    assert.deepEqual(inspeccionarGlb(glb({ asset: { version: "2.0" }, extensionsUsed: ["KHR_materials_clearcoat", ext] })), { ok: false, motivo: "comprimido" }, `used ${ext}`);
    assert.deepEqual(inspeccionarGlb(glb({ asset: { version: "2.0" }, extensionsRequired: [ext] })), { ok: false, motivo: "comprimido" }, `required ${ext}`);
  }
  const ambos = glb({ asset: { version: "2.0" }, extensionsUsed: ["KHR_draco_mesh_compression"], buffers: [{ byteLength: 4, uri: "/auth/logout" }] });
  assert.deepEqual(inspeccionarGlb(ambos), { ok: false, motivo: "externo" });
});

// GLTFLoader recorre todos los chunks y se queda con el ÚLTIMO JSON: la inspección tiene que ver lo mismo que él.
// GLB armado chunk a chunk: cada uno es { tipo, datos (objeto → JSON, o bytes), largo? (longitud declarada falsa) }.
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const INOCUO = { asset: { version: "2.0" } };
function glbChunks(chunks, { sobra = 0 } = {}) {
  const partes = chunks.map(({ tipo, datos, largo }) => {
    const esJson = !(datos instanceof Uint8Array);
    let cuerpo = esJson ? new TextEncoder().encode(JSON.stringify(datos)) : datos;
    const relleno = (4 - (cuerpo.length % 4)) % 4;
    if (relleno) cuerpo = Uint8Array.from([...cuerpo, ...new Array(relleno).fill(esJson ? 0x20 : 0)]);
    return { tipo, cuerpo, largo: largo ?? cuerpo.length };
  });
  const total = 12 + partes.reduce((n, p) => n + 8 + p.cuerpo.length, 0) + sobra;
  const bytes = new Uint8Array(total);
  const v = new DataView(bytes.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  let o = 12;
  for (const p of partes) {
    v.setUint32(o, p.largo, true);
    v.setUint32(o + 4, p.tipo, true);
    bytes.set(p.cuerpo, o + 8);
    o += 8 + p.cuerpo.length;
  }
  return bytes.buffer;
}

test("inspeccionarGlb: formato → dos chunks JSON, el primero inocuo y el segundo con images[0].uri (GLTFLoader usaría el último)", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const externo = { asset: { version: "2.0" }, images: [{ uri: "https://evil.example/t.png" }] };
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: JSON_CHUNK, datos: externo }])), { ok: false, motivo: "formato" }, "JSON + JSON");
  const conBin = glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: BIN_CHUNK, datos: new Uint8Array(8) }, { tipo: JSON_CHUNK, datos: externo }]);
  assert.deepEqual(inspeccionarGlb(conBin), { ok: false, motivo: "formato" }, "JSON + BIN + JSON");
  // Dos JSON inocuos tampoco: se admite un único chunk JSON.
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: JSON_CHUNK, datos: INOCUO }])), { ok: false, motivo: "formato" }, "JSON inocuo repetido");
});

test("inspeccionarGlb: formato → segundo chunk JSON con KHR_draco_mesh_compression", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  for (const clave of ["extensionsUsed", "extensionsRequired"]) {
    const draco = { asset: { version: "2.0" }, [clave]: ["KHR_draco_mesh_compression"] };
    assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: JSON_CHUNK, datos: draco }])), { ok: false, motivo: "formato" }, clave);
  }
});

test("inspeccionarGlb: formato → chunk BIN antes del chunk JSON", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const externo = { asset: { version: "2.0" }, images: [{ uri: "https://evil.example/t.png" }] };
  for (const [nombre, json] of Object.entries({ inocuo: INOCUO, externo })) {
    assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: BIN_CHUNK, datos: new Uint8Array(8) }, { tipo: JSON_CHUNK, datos: json }])), { ok: false, motivo: "formato" }, `BIN + JSON ${nombre}`);
    assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: 0x12345678, datos: new Uint8Array(8) }, { tipo: JSON_CHUNK, datos: json }])), { ok: false, motivo: "formato" }, `desconocido + JSON ${nombre}`);
  }
});

test("inspeccionarGlb: formato → un chunk posterior declara una longitud que se sale del archivo, o sobran bytes sin chunk", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const casos = {
    "BIN que declara más de lo que queda": glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: BIN_CHUNK, datos: new Uint8Array(8), largo: 12 }]),
    "BIN que declara 4 GB": glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: BIN_CHUNK, datos: new Uint8Array(8), largo: 0xfffffffc }]),
    "desconocido que se sale": glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: 0x12345678, datos: new Uint8Array(4), largo: 400 }]),
    "4 bytes sueltos al final (no cabe una cabecera de chunk)": glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }], { sobra: 4 }),
    "4 bytes sueltos tras el BIN": glbChunks([{ tipo: JSON_CHUNK, datos: INOCUO }, { tipo: BIN_CHUNK, datos: new Uint8Array(8) }], { sobra: 4 }),
  };
  for (const [nombre, bytes] of Object.entries(casos)) assert.deepEqual(inspeccionarGlb(bytes), { ok: false, motivo: "formato" }, nombre);
});

test("inspeccionarGlb: un GLB normal JSON + BIN (y chunks desconocidos después) sigue siendo { ok: true }", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 8 }], bufferViews: [{ buffer: 0, byteLength: 8 }], images: [{ bufferView: 0, mimeType: "image/png" }] };
  const bin = { tipo: BIN_CHUNK, datos: new Uint8Array(8) };
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: json }])), { ok: true }, "solo JSON");
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: json }, bin])), { ok: true }, "JSON + BIN");
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: json }, bin, { tipo: 0x12345678, datos: new Uint8Array(4) }])), { ok: true }, "JSON + BIN + desconocido");
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: json }, { tipo: BIN_CHUNK, datos: new Uint8Array(0) }])), { ok: true }, "BIN vacío");
  // El contenido del único JSON se sigue inspeccionando igual.
  assert.deepEqual(inspeccionarGlb(glbChunks([{ tipo: JSON_CHUNK, datos: { asset: { version: "2.0" }, images: [{ uri: "t.png" }] } }, bin])), { ok: false, motivo: "externo" }, "uri en el único JSON");
});

// Ampliación: tope de tamaño declarado. GLTFLoader reserva `count` elementos por accessor (sin bufferView, un arreglo a ceros
// del tamaño que diga el JSON), así que un JSON pequeño puede pedir gigas. Se mira antes de dárselo al loader.
test("inspeccionarGlb: complejo → algún accessor declara más de 3 × MAX_TRIANGULOS_MODELO elementos; el tope justo pasa; externo y comprimido ganan", async () => {
  const m = await vis();
  const inspeccionarGlb = fn(m, "inspeccionarGlb");
  assert.equal(m.MAX_TRIANGULOS_MODELO, 500_000);
  const tope = 3 * m.MAX_TRIANGULOS_MODELO;
  const con = (accessors, extra = {}) => glb({ asset: { version: "2.0" }, accessors, ...extra });
  const acc = (count, extra = {}) => ({ componentType: 5126, type: "VEC3", count, ...extra });
  assert.deepEqual(inspeccionarGlb(con([acc(tope + 1)])), { ok: false, motivo: "complejo" }, "sin bufferView: el loader reservaría un arreglo a ceros");
  assert.deepEqual(inspeccionarGlb(con([acc(3), acc(24), acc(4_000_000_000)])), { ok: false, motivo: "complejo" }, "basta uno, en cualquier posición");
  assert.deepEqual(inspeccionarGlb(con([acc(tope + 1, { bufferView: 0 })])), { ok: false, motivo: "complejo" }, "con bufferView también");
  assert.deepEqual(inspeccionarGlb(con([acc(tope + 1, { sparse: { count: 1 } })])), { ok: false, motivo: "complejo" }, "disperso también");
  // Lo que cabe sigue pasando.
  assert.deepEqual(inspeccionarGlb(con([])), { ok: true }, "sin accessors");
  assert.deepEqual(inspeccionarGlb(con([acc(0), acc(3), acc(tope)])), { ok: true }, "el tope justo pasa");
  assert.deepEqual(inspeccionarGlb(con([acc(tope, { bufferView: 0, byteOffset: 0, normalized: false, min: [0, 0, 0], max: [1, 1, 1], name: "posiciones" })])), { ok: true });
  // Los avisos más concretos ganan.
  assert.deepEqual(inspeccionarGlb(con([acc(tope + 1)], { images: [{ uri: "t.png" }] })), { ok: false, motivo: "externo" });
  assert.deepEqual(inspeccionarGlb(con([acc(tope + 1)], { extensionsUsed: ["KHR_draco_mesh_compression"] })), { ok: false, motivo: "comprimido" });
});

test("inspeccionarGlb: formato → accessors que no es un arreglo, entrada que no es un objeto o count que no es un entero ≥ 0", async () => {
  const inspeccionarGlb = fn(await vis(), "inspeccionarGlb");
  const formato = { ok: false, motivo: "formato" };
  const con = (accessors) => glb({ asset: { version: "2.0" }, accessors });
  // GLTFLoader indexa json.accessors[i] y multiplica count sin validar: un objeto con clave "0" o un count de texto le valen.
  for (const accessors of [{ 0: { componentType: 5126, type: "VEC3", count: 9_000_000 } }, "x", 7, null]) {
    assert.deepEqual(inspeccionarGlb(con(accessors)), formato, `accessors = ${JSON.stringify(accessors)}`);
  }
  for (const entrada of [null, 7, "x", []]) assert.deepEqual(inspeccionarGlb(con([entrada])), formato, `entrada ${JSON.stringify(entrada)}`);
  for (const count of [undefined, null, "9000000", "3", -1, 1.5, true, [3], {}]) {
    assert.deepEqual(inspeccionarGlb(con([{ componentType: 5126, type: "VEC3", count }])), formato, `count = ${JSON.stringify(count)}`);
  }
  // 1e999 es Infinity al parsear: no es un entero.
  const infinito = glb(undefined, { textoJson: '{"asset":{"version":"2.0"},"accessors":[{"componentType":5126,"type":"VEC3","count":1e999}]}' });
  assert.deepEqual(inspeccionarGlb(infinito), formato, "count = 1e999");
});

// ---------- 4. Render (hardware-md.ts) ----------

test("render: ```modelo → figure.hw-modelo con «Descargar modelo 3D» y figcaption; sin canvas, script ni iframe en el HTML", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const html = crearRenderizador(win, { proyecto: "uuv" }).html(`# Casco\n\n${bloque(`archivo: ${A}\ntitulo: Carcasa <img src=x onerror=alert(1)>`)}`);
  assert.doesNotMatch(html, /<(canvas|script|iframe|object|embed|img|model-viewer)\b/i, html);
  win.document.body.innerHTML = html;
  const fig = win.document.querySelector("figure.hw-modelo");
  assert.ok(fig, html);
  const enlaces = [...fig.querySelectorAll("a")];
  assert.equal(enlaces.length, 1);
  assert.equal(enlaces[0].getAttribute("href"), src(A));
  assert.equal(enlaces[0].textContent, "Descargar modelo 3D");
  assert.equal(fig.querySelector("figcaption").textContent, "Carcasa <img src=x onerror=alert(1)>");
  assert.deepEqual([...fig.children].map((c) => c.tagName), ["A", "FIGCAPTION"]);
});

test("render: sin título no hay figcaption; inválido, anidado o sin proyecto sigue siendo código", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(bloque(`archivo: ${A}`)));
  const fig = win.document.querySelector("figure.hw-modelo");
  assert.ok(fig, "figure.hw-modelo");
  assert.deepEqual([...fig.children].map((c) => c.tagName), ["A"]);
  const casos = [
    [{ proyecto: "uuv" }, bloque("archivo: https://evil.example/x.glb")],
    [{ proyecto: "uuv" }, bloque(`archivo: ${A}\nrespaldo: ${B}`)],
    [{ proyecto: "uuv" }, "> ```modelo\n> archivo: " + A + "\n> ```\n"],
    [{ proyecto: "uuv" }, "- x\n\n  ```modelo\n  archivo: " + A + "\n  ```\n"],
    [{}, bloque(`archivo: ${A}`)],
  ];
  for (const [op, texto] of casos) {
    win.document.body.replaceChildren(crearRenderizador(win, op).fragmento(texto));
    assert.equal(win.document.querySelector("figure.hw-modelo"), null, texto);
    assert.ok(win.document.querySelector("pre code"), texto);
  }
});

test("render: la clase hw-modelo solo sobrevive en la figura del bloque (no en HTML escrito a mano)", async () => {
  const { crearRenderizador } = await md();
  const win = ventana();
  const html = crearRenderizador(win, { proyecto: "uuv" }).html('<figure class="hw-modelo"><canvas></canvas></figure>\n\ntexto');
  assert.doesNotMatch(html, /<figure|<canvas/i, html);
});

test("visoresDe: incluye los ```modelo de primer nivel junto a pdf, kicad y bom, en orden", async () => {
  const { visoresDe } = await md();
  const texto = `\`\`\`pdf\narchivo: ${B}\n\`\`\`\n\n${bloque(`archivo: ${A}\ntitulo: Casco`)}\n\`\`\`kicad\narchivo: ${C}\n\`\`\`\n\n> ${bloque(`archivo: ${C}`)}`;
  const l = visoresDe(texto);
  assert.deepEqual(l.map((v) => v.tipo), ["pdf", "modelo", "kicad"]);
  assert.deepEqual(l[1].datos, { archivo: A, titulo: "Casco" });
});

test("diagramasDe no confunde un ```modelo con un diagrama", async () => {
  const { diagramasDe } = await md();
  assert.deepEqual(diagramasDe(bloque(`archivo: ${A}`)), []);
});

// ---------- 5. Editor visual (ida y vuelta) ----------

test("editor visual: vistaBloque pinta ```modelo como tarjeta figure.hw-modelo (sin lienzo ni script); inválido queda como código", async () => {
  const { vistaBloque } = await import("../src/lib/editor-visual.ts");
  const { crearRenderizador } = await md();
  const win = ventana();
  const html = crearRenderizador(win, { proyecto: "uuv" }).html;
  const salida = vistaBloque(html, "modelo", `archivo: ${A}\ntitulo: Carcasa`, { editable: true });
  assert.equal(typeof salida, "string");
  assert.match(salida, /^<figure class="hw-modelo">/);
  assert.match(salida, /Descargar modelo 3D/);
  assert.doesNotMatch(salida, /<canvas|<script|<button/i);
  assert.equal(vistaBloque(html, "modelo", "archivo: no-uuid", { editable: true }), null);
  assert.equal(vistaBloque(html, "modelo", `archivo: ${A}\ntitulo: <b>x</b>`, { editable: true }), null);
});
