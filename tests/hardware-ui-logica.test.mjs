// Lote 1b: lógica pura de la interfaz de hardware (src/lib/hardware-editor.ts) y módulo compartido sin dependencias
// lib/archivos-nombre.mjs (sanearNombre y TIPOS, usado por el servidor y por el navegador). También enlaceHilo de
// src/lib/comentarios.ts para hilos de páginas de hardware.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const leer = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const SLUG = /^[a-z0-9-]{1,60}$/;
const UUID = "0b7c8f2e-4d1a-4c3b-9e8f-1a2b3c4d5e6f";

// Import dinámico: si el módulo no existe, cada test falla por su cuenta con un mensaje claro.
let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/hardware-editor.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `no se pudo importar src/lib/hardware-editor.ts: ${fallo?.message}`);
  return lib;
};
const compartido = async () => {
  assert.ok(existsSync(new URL("../lib/archivos-nombre.mjs", import.meta.url)), "falta lib/archivos-nombre.mjs");
  return import("../lib/archivos-nombre.mjs");
};

// ---------- módulo compartido ----------
test("lib/archivos-nombre.mjs: sin imports, exporta sanearNombre y TIPOS; archivos-core los reexporta (misma función)", async () => {
  const m = await compartido();
  assert.doesNotMatch(leer("lib/archivos-nombre.mjs"), /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m, "debe ser puro, sin dependencias");
  assert.equal(typeof m.sanearNombre, "function");
  assert.equal(typeof m.TIPOS, "object");
  assert.equal(m.TIPOS.png.max, 10 * 1024 * 1024);
  assert.equal(m.TIPOS.step.max, 50 * 1024 * 1024);
  const core = await import("../lib/archivos-core.mjs");
  assert.equal(core.sanearNombre, m.sanearNombre, "archivos-core reexporta la misma sanearNombre");
  assert.equal(core.TIPOS, m.TIPOS, "archivos-core reexporta los mismos TIPOS");
  assert.doesNotMatch(leer("lib/archivos-core.mjs"), /function\s+sanearNombre\b/, "no se duplica la función");
  assert.doesNotMatch(leer("src/lib/hardware-editor.ts"), /function\s+sanearNombre\b|const\s+sanearNombre\s*=/, "el cliente reusa, no duplica");
  assert.match(leer("src/lib/hardware-editor.ts"), /from\s+["']\.\.\/\.\.\/lib\/archivos-nombre\.mjs["']/);
});

// ---------- slugs ----------
test("slugDeTitulo: minúsculas, sin acentos, guiones, recortado a 60 y válido para la API", () => {
  const { slugDeTitulo } = L();
  assert.equal(slugDeTitulo("Placa de potencia v2"), "placa-de-potencia-v2");
  assert.equal(slugDeTitulo("  Electrónica / Ñandú  "), "electronica-nandu");
  assert.equal(slugDeTitulo("--Hola__mundo!!--"), "hola-mundo");
  assert.equal(slugDeTitulo("¿?¡!"), "");
  const largo = slugDeTitulo("a".repeat(50) + " " + "b".repeat(50));
  assert.ok(largo.length <= 60 && SLUG.test(largo) && !largo.endsWith("-"), largo);
});

test("slugUnico: añade -2, -3… si ya existe, sin pasar de 60", () => {
  const { slugUnico } = L();
  assert.equal(slugUnico("pcb", []), "pcb");
  assert.equal(slugUnico("pcb", ["pcb"]), "pcb-2");
  assert.equal(slugUnico("pcb", ["pcb", "pcb-2"]), "pcb-3");
  const s = slugUnico("x".repeat(60), ["x".repeat(60)]);
  assert.ok(s.length <= 60 && SLUG.test(s) && s.endsWith("-2"), s);
});

// ---------- página actual y URLs ----------
test("paginaActual: ?p válido y presente en el índice; sin ?p, la primera; desconocida o inválida → null", () => {
  const { paginaActual } = L();
  const indice = [{ slug: "arquitectura", titulo: "Arquitectura" }, { slug: "pcb", titulo: "PCB" }];
  assert.equal(paginaActual("?p=pcb", indice), "pcb");
  assert.equal(paginaActual("", indice), "arquitectura");
  assert.equal(paginaActual("?p=", indice), "arquitectura");
  assert.equal(paginaActual("?p=no-existe", indice), null);
  assert.equal(paginaActual("?p=..%2Fx", indice), null);
  assert.equal(paginaActual("?p=pcb", []), null);
  assert.equal(paginaActual("", []), null);
});

test("urlPagina y clavePagina: enlace con ?p y clave de comentarios que pasa validarPagina", () => {
  const { urlPagina, clavePagina } = L();
  assert.equal(urlPagina("uuv", "electronica", "pcb"), "/uuv/electronica/?p=pcb");
  assert.equal(clavePagina("uuv", "electronica", "pcb"), "/uuv/electronica/pcb/");
  // Mismo patrón que validarPagina en lib/comentarios-core.mjs.
  assert.match(clavePagina("uuv", "mecanica", "piezas-planos"), /^\/uuv(\/[A-Za-z0-9_-]+)+\/$/);
});

test("enlaceHilo: hilos de páginas de hardware van a /<p>/<disc>/?p=<slug>; los de la wiki quedan igual", async () => {
  const { enlaceHilo } = await import("../src/lib/comentarios.ts");
  assert.equal(enlaceHilo("/uuv/electronica/pcb/", UUID, ["electronica", "mecanica"]), `/uuv/electronica/?p=pcb#comentario-${UUID}`);
  assert.equal(enlaceHilo("/uuv/packages/control/", UUID, ["electronica", "mecanica"]), `/uuv/packages/control/#comentario-${UUID}`);
  assert.equal(enlaceHilo("/uuv/electronica/pcb/", UUID), `/uuv/electronica/pcb/#comentario-${UUID}`, "sin lista: comportamiento anterior");
  assert.equal(enlaceHilo("/uuv/electronica/", UUID, ["electronica"]), `/uuv/electronica/#comentario-${UUID}`);
});

// ---------- título en el índice ----------
test("actualizarTituloIndice: cambia solo el título de esa página sin mutar", () => {
  const { actualizarTituloIndice } = L();
  const indice = [
    { slug: "a", titulo: "A" },
    { slug: "b", titulo: "Viejo" },
  ];
  assert.deepEqual(actualizarTituloIndice(indice, { slug: "b", titulo: "Nuevo" }), [
    { slug: "a", titulo: "A" },
    { slug: "b", titulo: "Nuevo" },
  ]);
  assert.deepEqual(actualizarTituloIndice(indice, { slug: "z", titulo: "X" }), indice);
  assert.equal(indice[1].titulo, "Viejo", "no muta la entrada");
});

// ---------- reordenar ----------
test("moverEnOrden: sube o baja un slug sin mutar; en los extremos no cambia", () => {
  const { moverEnOrden } = L();
  const orden = ["a", "b", "c"];
  assert.deepEqual(moverEnOrden(orden, "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moverEnOrden(orden, "b", 1), ["a", "c", "b"]);
  assert.deepEqual(moverEnOrden(orden, "a", -1), ["a", "b", "c"]);
  assert.deepEqual(moverEnOrden(orden, "c", 1), ["a", "b", "c"]);
  assert.deepEqual(moverEnOrden(orden, "z", 1), ["a", "b", "c"]);
  assert.deepEqual(orden, ["a", "b", "c"], "no muta la entrada");
});

// ---------- archivos ----------
test("rutaBlob: pathname canónico hw/<proyecto>/<disciplina>/<uuid>-<nombre saneado>", () => {
  const { rutaBlob } = L();
  assert.equal(rutaBlob("uuv", "electronica", UUID, "../mi foto.png"), `hw/uuv/electronica/${UUID}-mi-foto.png`);
  assert.equal(rutaBlob("uuv", "mecanica", UUID, "C:\\x\\Casco.STEP"), `hw/uuv/mecanica/${UUID}-Casco.STEP`);
});

test("validarArchivo: tipo de la lista blanca y tamaño máximo, con mensajes en español", () => {
  const { validarArchivo } = L();
  assert.deepEqual(validarArchivo({ name: "foto.PNG", size: 1000 }), { ok: true, tipo: "png", imagen: true });
  assert.deepEqual(validarArchivo({ name: "placa.kicad_pcb", size: 1000 }), { ok: true, tipo: "kicad_pcb", imagen: false });
  const svg = validarArchivo({ name: "logo.svg", size: 10 });
  assert.equal(svg.ok, true);
  assert.equal(svg.imagen, false, "svg se descarga (attachment), no se incrusta como imagen");
  const exe = validarArchivo({ name: "virus.exe", size: 10 });
  assert.equal(exe.ok, false);
  assert.match(exe.error, /tipo/i);
  const grande = validarArchivo({ name: "foto.jpg", size: 10 * 1024 * 1024 + 1 });
  assert.equal(grande.ok, false);
  assert.match(grande.error, /10 MB/);
  const vacio = validarArchivo({ name: "a.pdf", size: 0 });
  assert.equal(vacio.ok, false);
  assert.equal(validarArchivo({ name: "a.pdf", size: 50 * 1024 * 1024 }).ok, true);
  assert.match(validarArchivo({ name: "a.pdf", size: 50 * 1024 * 1024 + 1 }).error, /50 MB/);
});

test("enlaceArchivo: imagen → ![nombre](proxy), resto → [nombre](proxy); el proxy lleva proyecto e id", () => {
  const { enlaceArchivo } = L();
  assert.equal(enlaceArchivo({ proyecto: "uuv", id: UUID, nombre: "foto 1.png", imagen: true }), `![foto-1.png](/api/archivos/?proyecto=uuv&id=${UUID})`);
  assert.equal(enlaceArchivo({ proyecto: "uuv", id: UUID, nombre: "casco.step", imagen: false }), `[casco.step](/api/archivos/?proyecto=uuv&id=${UUID})`);
  assert.doesNotMatch(enlaceArchivo({ proyecto: "uuv", id: UUID, nombre: "a](javascript:x).png", imagen: true }), /\]\(javascript/);
});

test("insertarEnTexto: reemplaza la selección y deja el cursor tras lo insertado", () => {
  const { insertarEnTexto } = L();
  assert.deepEqual(insertarEnTexto("hola mundo", 5, 10, "X"), { texto: "hola X", cursor: 6 });
  assert.deepEqual(insertarEnTexto("ab", 1, 1, "--"), { texto: "a--b", cursor: 3 });
  assert.deepEqual(insertarEnTexto("", 0, 0, "![a](b)"), { texto: "![a](b)", cursor: 7 });
});

test("porcentaje: entero 0–100 para la barra de progreso", () => {
  const { porcentaje } = L();
  assert.equal(porcentaje(0, 100), 0);
  assert.equal(porcentaje(50, 200), 25);
  assert.equal(porcentaje(300, 200), 100);
  assert.equal(porcentaje(10, 0), 0);
});

// ---------- mensajes ----------
test("mensajeError: 409 pide recargar sin perder el texto; 401/403/413/429/503 con mensajes propios", () => {
  const { mensajeError } = L();
  const m409 = mensajeError(409);
  assert.match(m409, /cambi/i);
  assert.match(m409, /recarga/i);
  assert.match(mensajeError(401), /sesi[oó]n/i);
  assert.match(mensajeError(403), /editor/i);
  assert.match(mensajeError(413), /grande/i);
  assert.match(mensajeError(429), /espera|demasiad/i);
  assert.match(mensajeError(503), /disponible/i);
  assert.ok(mensajeError(500).length > 0);
  assert.ok(mensajeError("red").length > 0, "fallo de red");
});

test("editor: mientras guarda se deshabilitan textarea y selector de archivos y se ignoran inserciones y subidas", () => {
  const src = leer("src/scripts/hardware-editor.ts");
  const cuerpo = (firma) => {
    const i = src.indexOf(firma);
    assert.ok(i >= 0, `no encontré ${firma}`);
    return src.slice(i, i + 400);
  };
  assert.match(cuerpo("function actualizarGuardar("), /textarea\.disabled = guardando/);
  assert.match(cuerpo("function actualizarGuardar("), /inputArchivo\.disabled = guardando/);
  assert.match(cuerpo("function insertar("), /if \(guardando\) return/);
  assert.match(cuerpo("async function subirVarios("), /if \(guardando\) return/);
});
