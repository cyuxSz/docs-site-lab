// Lote G3 «acción diagrama»: POST /api/hardware { accion: "diagrama", … } cambia los UUID de UN bloque ```diagrama
// existente (o añade uno al final) y nada más del Markdown. Se permite con token de subida (conjunto exacto de claves)
// y con cookie de editor; el resto de acciones sigue cerrado al token. Ver .factory/spec.md, criterios 5 a 12.
import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  T0, ORIGIN, EDITOR, sesion, crearEnv, pedir, insertarToken, emitir, esDenegada, esDenegadaPorPermiso,
  JSON_CT, uuid, DRAWIO, SVG, SCH, subirArchivo, inicializar, leerPagina, ponerMd, diagrama, bloque, HW,
} from "./fixtures/g3-diagrama.mjs";

const realFetch = globalThis.fetch;
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: T0 });
  globalThis.fetch = async (input) => {
    throw new Error(`fetch inesperado: ${typeof input === "string" ? input : input.url}`);
  };
});
afterEach(() => {
  mock.timers.reset();
  globalThis.fetch = realFetch;
});

const respirar = () => mock.timers.tick(61_000); // vacía la ventana del límite `hw` (10 escrituras por minuto)
const SLUG = "esquematicos";
// UUID de los bloques que ya están en la página (no hace falta que existan como adjuntos).
const F_VIEJA = uuid(101);
const S_VIEJO = uuid(102);
const F_EXC = uuid(103);
const S_EXC = uuid(104);
// UUID nuevos: se suben como adjuntos en cada test.
const F = uuid(1);
const S = uuid(2);

const MD =
  "# Esquemáticos\n\nIntro con `fuente: " + F_VIEJA + "` citado en línea.\n\n" +
  bloque({ fuente: F_VIEJA, svg: S_VIEJO, titulo: "Placa principal" }) +
  "\n\nEntre bloques.\r\n\n" +
  bloque({ editor: "excalidraw", fuente: F_EXC, svg: S_EXC }) +
  "\n\nTexto final sin salto";

// Disciplina inicializada, página con MD y los dos adjuntos nuevos (drawio + svg) subidos con el token. 4 escrituras.
async function preparar({ login = EDITOR, md = MD } = {}) {
  const { env, llamadas } = crearEnv();
  await inicializar(env);
  const pagina = await ponerMd(env, SLUG, md);
  const editor = insertarToken(env, { login: EDITOR });
  assert.equal((await subirArchivo(env, { bearer: editor.token, id: F, nombre: "placa.drawio", contenido: DRAWIO })).status, 201);
  assert.equal((await subirArchivo(env, { bearer: editor.token, id: S, nombre: "placa.svg", contenido: SVG })).status, 201);
  const token = login === EDITOR ? editor.token : insertarToken(env, { login }).token;
  respirar();
  return { env, llamadas, token, version: pagina.version, md };
}

async function sinCambios(env, version, md, que) {
  const p = await leerPagina(env, SLUG);
  assert.equal(p.version, version, `${que}: la versión no cambia`);
  assert.equal(p.md, md, `${que}: el Markdown no cambia`);
}

// ---------- Criterio 5: cambiar los UUID de un bloque existente ----------

test("diagrama con token: cambia solo fuente y svg del bloque cuya fuente es fuenteAnterior; el resto byte a byte", async () => {
  const { env, token, version } = await preparar();
  const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } });
  assert.equal(res.status, 200);
  const { pagina } = await res.json();
  const esperado = MD.replace(bloque({ fuente: F_VIEJA, svg: S_VIEJO, titulo: "Placa principal" }), bloque({ fuente: F, svg: S, titulo: "Placa principal" }));
  assert.notEqual(esperado, MD);
  assert.equal(pagina.md, esperado, "conserva editor y título; el texto en línea con la misma UUID no se toca; CRLF y final sin salto intactos");
  assert.equal(pagina.version, version + 1);
  assert.equal(pagina.autor, EDITOR, "el autor es el login del token");
  assert.equal(pagina.slug, SLUG);
  assert.equal(pagina.titulo, "Esquemáticos");
  const guardada = await leerPagina(env, SLUG);
  assert.equal(guardada.md, esperado);
  assert.equal(guardada.version, version + 1);
});

test("diagrama con token: fuenteAnterior null añade un bloque drawio sin título al final (mismas reglas de separación que insertarBloque)", async () => {
  const casos = [
    ["# A\n\nTexto", "# A\n\nTexto\n\n"],
    ["# A\n\nTexto\n", "# A\n\nTexto\n\n"],
    ["# A\n\nTexto\n\n", "# A\n\nTexto\n\n"],
    ["", ""],
  ];
  for (const [md, prefijo] of casos) {
    const { env, token, version } = await preparar({ md: md || "# A\n" });
    let v = version;
    if (!md) {
      // Página vacía: se deja así con la cookie (PUT admite md vacío).
      v = (await ponerMd(env, SLUG, "")).version;
    }
    const res = await diagrama(env, { bearer: token, cuerpo: { version: v, fuenteAnterior: null, fuente: F, svg: S } });
    assert.equal(res.status, 200, JSON.stringify(md));
    assert.equal((await res.json()).pagina.md, `${prefijo}${bloque({ fuente: F, svg: S })}\n`, JSON.stringify(md));
  }
});

test("diagrama con cookie de editor: misma acción, con Origin propio; queda en el historial y se puede restaurar", async () => {
  const { env, version } = await preparar();
  const res = await diagrama(env, { cookie: sesion(EDITOR), cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } });
  assert.equal(res.status, 200);
  const nueva = (await res.json()).pagina;
  assert.equal(nueva.version, version + 1);

  const rev = await pedir(`${HW}?proyecto=uuv&disciplina=electronica&pagina=${SLUG}&revisiones=1`, { env, cookie: sesion(EDITOR) });
  assert.equal(rev.status, 200);
  const { revisiones } = await rev.json();
  assert.equal(revisiones[0].version, version, "la revisión 0 es el estado anterior al cambio");
  assert.equal(revisiones[0].titulo, "Esquemáticos");

  const restaurar = await pedir(HW, { env, cookie: sesion(EDITOR), method: "POST", headers: { ...JSON_CT, origin: ORIGIN }, body: JSON.stringify({ proyecto: "uuv", disciplina: "electronica", accion: "restaurar", pagina: SLUG, revision: 0, version: version + 1 }) });
  assert.equal(restaurar.status, 200);
  assert.equal((await restaurar.json()).pagina.md, MD, "restaurar la revisión devuelve el Markdown de antes");

  const sinOrigen = await pedir(HW, { env, cookie: sesion(EDITOR), method: "POST", headers: JSON_CT, body: JSON.stringify({ proyecto: "uuv", disciplina: "electronica", accion: "diagrama", pagina: SLUG, version: version + 2, fuenteAnterior: null, fuente: F, svg: S }) });
  assert.equal(sinOrigen.status, 403, "con cookie, Origin sigue siendo obligatorio");
});

test("diagrama con token de dispositivo: se permite como cualquier escritura del login", async () => {
  const { env, version } = await preparar();
  const { token } = await emitir(env, { login: EDITOR });
  const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } });
  assert.equal(res.status, 200);
});

// ---------- Criterio 6: el bloque ----------

test("diagrama: fuenteAnterior que no está, repetida, en un bloque que no es de primer nivel o de excalidraw → 409 `bloque` sin cambios", async () => {
  const repetida = `# R\n\n${bloque({ fuente: F_VIEJA, svg: S_VIEJO })}\n\n${bloque({ fuente: F_VIEJA, svg: uuid(105) })}\n`;
  const citada = `# C\n\n> ${bloque({ fuente: F_VIEJA, svg: S_VIEJO }).split("\n").join("\n> ")}\n`;
  const indentada = `# I\n\n    ${bloque({ fuente: F_VIEJA, svg: S_VIEJO }).split("\n").join("\n    ")}\n`;
  const casos = [
    [MD, uuid(999), "no está"],
    [MD, S_VIEJO, "es el svg, no la fuente"],
    [MD, F_EXC, "bloque de excalidraw"],
    [repetida, F_VIEJA, "repetida"],
    [citada, F_VIEJA, "dentro de una cita"],
    [indentada, F_VIEJA, "código indentado"],
  ];
  for (const [md, fuenteAnterior, que] of casos) {
    const { env, token, version } = await preparar({ md });
    const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior, fuente: F, svg: S } });
    assert.equal(res.status, 409, que);
    const json = await res.json();
    assert.equal(json.codigo, "bloque", que);
    await sinCambios(env, version, md, que);
  }
});

test("diagrama: 409 `version` si la página cambió (con la versión actual en la respuesta) y no toca nada", async () => {
  const { env, token, version } = await preparar();
  const res = await diagrama(env, { bearer: token, cuerpo: { version: version - 1 < 1 ? version + 5 : version - 1, fuenteAnterior: F_VIEJA, fuente: F, svg: S } });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { error: "La página cambió", codigo: "version", version });
  await sinCambios(env, version, MD, "409");
});

test("diagrama: página inexistente → 404", async () => {
  const { env, token } = await preparar();
  const res = await diagrama(env, { bearer: token, cuerpo: { pagina: "no-existe", version: 1, fuenteAnterior: null, fuente: F, svg: S } });
  assert.equal(res.status, 404);
});

test("diagrama: el resultado no puede pasar del tope de Markdown (200 KB) → 413 sin cambios", async () => {
  const relleno = `# G\n\n${"x".repeat(200 * 1024 - 10)}\n`;
  const { env, token, version } = await preparar({ md: relleno });
  const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: null, fuente: F, svg: S } });
  assert.equal(res.status, 413);
  await sinCambios(env, version, relleno, "413");
});

// ---------- Criterio 7: los adjuntos ----------

test("diagrama: fuente y svg tienen que ser adjuntos de esa disciplina con tipo drawio y svg → si no, 400 `adjunto` sin cambios", async () => {
  const { env, token, version } = await preparar();
  // Adjuntos de apoyo: un drawio en mecánica, un kicad_sch y un excalidraw en electrónica (con cookie) y uno borrado.
  assert.equal((await subirArchivo(env, { bearer: token, disciplina: "mecanica", id: uuid(10), nombre: "otra.drawio", contenido: DRAWIO })).status, 201);
  assert.equal((await subirArchivo(env, { bearer: token, disciplina: "mecanica", id: uuid(11), nombre: "otra.svg", contenido: SVG })).status, 201);
  assert.equal((await subirArchivo(env, { bearer: token, id: uuid(12), nombre: "e.kicad_sch", contenido: SCH })).status, 201);
  assert.equal((await subirArchivo(env, { cookie: sesion(EDITOR), id: uuid(13), nombre: "d.excalidraw", contenido: '{"type":"excalidraw"}' })).status, 201);
  assert.equal((await subirArchivo(env, { bearer: token, id: uuid(14), nombre: "borrado.drawio", contenido: DRAWIO })).status, 201);
  const borrar = await pedir("/api/archivos/", { env, cookie: sesion(EDITOR), method: "DELETE", headers: { ...JSON_CT, origin: ORIGIN }, body: JSON.stringify({ proyecto: "uuv", id: uuid(14) }) });
  assert.equal(borrar.status, 200);
  respirar();

  const casos = [
    [{ fuente: uuid(500) }, "fuente que no existe"],
    [{ svg: uuid(501) }, "svg que no existe"],
    [{ fuente: uuid(10) }, "fuente de otra disciplina"],
    [{ svg: uuid(11) }, "svg de otra disciplina"],
    [{ fuente: S, svg: F }, "tipos cruzados"],
    [{ fuente: uuid(12) }, "fuente de tipo kicad_sch"],
    [{ fuente: uuid(13) }, "fuente de excalidraw"],
    [{ svg: uuid(12) }, "svg de tipo kicad_sch"],
    [{ fuente: uuid(14) }, "fuente borrada"],
  ];
  for (const [i, [cambio, que]] of casos.entries()) {
    if (i === 5) respirar();
    const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S, ...cambio } });
    assert.equal(res.status, 400, que);
    assert.equal((await res.json()).codigo, "adjunto", que);
  }
  await sinCambios(env, version, MD, "adjuntos");
});

test("diagrama: campos mal formados → 400 sin cambios (UUID en minúsculas, fuente ≠ svg, versión entera ≥ 1, slug válido)", async () => {
  const { env, token, version } = await preparar();
  const casos = [
    { fuente: F.toUpperCase() },
    { svg: "no-es-uuid" },
    { fuente: F, svg: F },
    { fuenteAnterior: "x" },
    { fuenteAnterior: F_VIEJA.toUpperCase() },
    { fuenteAnterior: 7 },
    { fuente: null },
    { version: 0 },
    { version: "1" },
    { version: 1.5 },
    { pagina: "Mal Slug" },
    { pagina: null },
  ];
  for (const cambio of casos) {
    const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S, ...cambio } });
    assert.equal(res.status, 400, JSON.stringify(cambio));
  }
  await sinCambios(env, version, MD, "campos");
  // Ninguno de los 12 gastó el límite: la validación de campos va antes de `limitar`.
  assert.equal((await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } })).status, 200);
});

// ---------- Criterio 8: permisos del login en cada petición ----------

test("diagrama con token de quien no es editor, o sin acceso al proyecto → 403 de permiso (no de la puerta)", async () => {
  const { env, token, version } = await preparar({ login: "ana" });
  const res = await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } });
  const { error } = await esDenegadaPorPermiso(res, "token de ana en uuv/electronica");
  assert.equal(error, "Solo los editores pueden escribir");
  // ana es editora de restringido-demo en el fixture, pero su login no tiene acceso al proyecto.
  const ajeno = await diagrama(env, { bearer: token, cuerpo: { proyecto: "restringido-demo", version: 1, fuenteAnterior: null, fuente: F, svg: S } });
  await esDenegadaPorPermiso(ajeno, "token de ana en restringido-demo");
  await sinCambios(env, version, MD, "403");
});

test("diagrama: comparte el límite `hw` con el resto de escrituras del login (429 con Retry-After)", async () => {
  const { env, token, version } = await preparar({ md: "# L\n" });
  let v = version;
  for (let i = 0; i < 10; i++) {
    const res = await diagrama(env, { bearer: token, cuerpo: { version: v, fuenteAnterior: null, fuente: F, svg: S } });
    assert.equal(res.status, 200, `escritura ${i + 1}`);
    v++;
  }
  const once = await diagrama(env, { bearer: token, cuerpo: { version: v, fuenteAnterior: null, fuente: F, svg: S } });
  assert.equal(once.status, 429);
  assert.ok(Number(once.headers.get("retry-after")) > 0);
  const conCookie = await diagrama(env, { cookie: sesion(EDITOR), cuerpo: { version: v, fuenteAnterior: null, fuente: F, svg: S } });
  assert.equal(conCookie.status, 429, "la cookie del mismo login también");
});

// ---------- Criterios 9 y 10: la puerta y el conjunto exacto de claves ----------

test("puerta: lista blanca con POST /api/hardware sin query y cuerpo exacto de la acción diagrama (funciones puras)", async () => {
  const { permitidaConSubida, cuerpoPermitidoConSubida, CLAVES_DIAGRAMA } = await import("../lib/alcance-subida.mjs");
  assert.deepEqual([...CLAVES_DIAGRAMA].sort(), ["accion", "disciplina", "fuente", "fuenteAnterior", "pagina", "proyecto", "svg", "version"]);
  assert.ok(Object.isFrozen(CLAVES_DIAGRAMA));
  assert.equal(permitidaConSubida("POST", "/api/hardware", new URLSearchParams("")), true);
  for (const q of ["proyecto=uuv&disciplina=electronica", "accion=diagrama", "x=1"]) assert.equal(permitidaConSubida("POST", "/api/hardware", new URLSearchParams(q)), false, q);
  for (const m of ["PUT", "DELETE", "PATCH"]) assert.equal(permitidaConSubida(m, "/api/hardware", new URLSearchParams("")), false, m);

  const bueno = { proyecto: "uuv", disciplina: "electronica", accion: "diagrama", pagina: "a", version: 1, fuenteAnterior: null, fuente: F, svg: S };
  assert.equal(cuerpoPermitidoConSubida("POST", "/api/hardware", bueno), true);
  // Solo mira la forma (acción y claves); los valores los valida la ruta.
  assert.equal(cuerpoPermitidoConSubida("POST", "/api/hardware", { ...bueno, version: "x", fuente: 3 }), true);
  const malos = [
    { ...bueno, accion: "crear" },
    { ...bueno, accion: "Diagrama" },
    { ...bueno, titulo: "x" },
    { ...bueno, md: "# X" },
    (({ fuenteAnterior, ...r }) => r)(bueno),
    (({ proyecto, ...r }) => r)(bueno),
    { proyecto: "uuv", disciplina: "electronica", accion: "inicializar" },
    null,
    [],
    "diagrama",
  ];
  for (const b of malos) assert.equal(cuerpoPermitidoConSubida("POST", "/api/hardware", b), false, JSON.stringify(b));
  assert.equal(cuerpoPermitidoConSubida("PUT", "/api/hardware", bueno), false);
  assert.equal(cuerpoPermitidoConSubida("POST", "/api/archivos", bueno), false, "las rutas que no leen cuerpo no tienen conjunto");
  assert.equal(cuerpoPermitidoConSubida("POST", "/api/hardware/", bueno), false, "ruta ya normalizada: igualdad exacta");
});

test("puerta: con token, cualquier otra acción o claves de más o de menos → 403 `alcance` sin tocar el almacén ni el límite", async () => {
  const { env, llamadas, token, version } = await preparar();
  assert.equal((await pedir("/auth/me", { env, bearer: token })).status, 200); // ultimo_uso ya anotado: 1 lectura por petición
  const antes = env.DB.stats.sql.length;
  const base = { proyecto: "uuv", disciplina: "electronica" };
  const cuerpos = [
    { ...base, accion: "inicializar" },
    { ...base, accion: "crear", pagina: "nueva", titulo: "Nueva" },
    { ...base, accion: "reordenar", orden: [SLUG] },
    { ...base, accion: "restaurar", pagina: SLUG, revision: 0, version },
    { ...base, accion: "restaurar-papelera", id: `${SLUG}:1` },
    { ...base, accion: "previsualizar", md: "# x" },
    { ...base, accion: "diagrama", pagina: SLUG, version, fuenteAnterior: F_VIEJA, fuente: F, svg: S, titulo: "x" },
    { ...base, accion: "diagrama", pagina: SLUG, version, fuente: F, svg: S },
    { ...base, accion: "diagrama", slug: SLUG, version, fuenteAnterior: F_VIEJA, fuente: F, svg: S },
    { ...base, accion: "diagrama", pagina: SLUG, version, fuenteAnterior: F_VIEJA, fuente: F, svg: S, md: "# pisado" },
    { ...base, pagina: SLUG, version, fuenteAnterior: F_VIEJA, fuente: F, svg: S },
  ];
  for (const c of cuerpos) {
    await esDenegada(await pedir(HW, { env, bearer: token, method: "POST", headers: JSON_CT, body: JSON.stringify(c) }), `POST ${JSON.stringify(c).slice(0, 90)}`);
  }
  // Con query, la puerta corta antes de leer el cuerpo, aunque el cuerpo sea un diagrama válido.
  for (const q of ["?proyecto=uuv&disciplina=electronica", "?accion=diagrama"]) {
    await esDenegada(await diagrama(env, { bearer: token, path: `${HW}${q}`, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } }), `POST ${HW}${q}`);
  }
  // PUT y DELETE siguen cerrados.
  await esDenegada(await pedir(HW, { env, bearer: token, method: "PUT", headers: JSON_CT, body: JSON.stringify({ ...base, pagina: SLUG, md: "# x", version }) }), "PUT");
  await esDenegada(await pedir(HW, { env, bearer: token, method: "DELETE", headers: JSON_CT, body: JSON.stringify({ ...base, pagina: SLUG, version }) }), "DELETE");

  const nuevas = env.DB.stats.sql.slice(antes);
  assert.ok(nuevas.every((s) => /^\s*SELECT\b/i.test(s)), `nada escribe en D1: ${nuevas.filter((s) => !/^\s*SELECT\b/i.test(s)).join(" ; ")}`);
  assert.equal(nuevas.length, cuerpos.length + 4, "una lectura del token por petición y nada más (ni candado, ni límite, ni página)");
  assert.equal(llamadas.length, 0);
  await sinCambios(env, version, MD, "denegadas");
  // Y el diagrama con el cuerpo exacto sí pasa.
  assert.equal((await diagrama(env, { bearer: token, cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S } })).status, 200);
});

test("puerta: con cookie la acción diagrama no exige el conjunto exacto (claves de más se ignoran, como en las demás acciones)", async () => {
  const { env, version } = await preparar();
  const res = await diagrama(env, { cookie: sesion(EDITOR), cuerpo: { version, fuenteAnterior: F_VIEJA, fuente: F, svg: S, titulo: "ignorado", md: "# ignorado" } });
  assert.equal(res.status, 200);
  const { pagina } = await res.json();
  assert.ok(pagina.md.startsWith("# Esquemáticos\n"), "el md del cuerpo no se usa");
  assert.ok(pagina.md.includes(bloque({ fuente: F, svg: S, titulo: "Placa principal" })), "el título del cuerpo no se usa");
});
