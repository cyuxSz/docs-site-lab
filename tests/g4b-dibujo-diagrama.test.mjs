// G4b · `subir <archivo.drawio> [--svg <archivo.svg>] --pagina <slug> …`: sube la pareja y aplica `accion: "diagrama"`.
// Portal falso en proceso (tests/fixtures/g4b-portal.mjs) que simula GET/POST /api/hardware y POST /api/archivos y
// registra todas las peticiones. Cada ejecución comprueba que el token no aparece en stdout ni en stderr.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { usarPortal, responder, TOKEN, UUID_MIN } from "./fixtures/g4b-portal.mjs";

const ctx = usarPortal("g4b-diagrama-");

const SLUG = "placa-control";
const F0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S0 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bloque = (fuente, svg, titulo = "Placa", editor = "drawio") =>
  "```diagrama\neditor: " + editor + "\nfuente: " + fuente + "\nsvg: " + svg + "\n" + (titulo ? `titulo: ${titulo}\n` : "") + "```\n";
const MD0 = `# Placa\n\nTexto antes.\n\n${bloque(F0, S0)}\nTexto después.\n`;
const DRAWIO = '<mxfile host="test"><diagram id="a" name="P">x</diagram></mxfile>\n';
const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>\n';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const OPC = ["--proyecto", "uuv", "--disciplina", "electronica"];
const CLAVES = ["accion", "disciplina", "fuente", "fuenteAnterior", "pagina", "proyecto", "svg", "version"];

// Portal de hardware simulado. `alPost(estado, cuerpo, n)` puede cambiar la página antes de responder (cambio concurrente)
// o devolver [status, cuerpo, cabeceras] para forzar una respuesta.
function montarHw({ md = MD0, version = 7, alPost, alGet, alSubir } = {}) {
  const e = { md, version };
  let nPost = 0;
  let nGet = 0;
  let nSubir = 0;
  const pagina = () => ({ slug: SLUG, titulo: "Placa", md: e.md, autor: "ana", actualizado: "2026-11-27T10:00:00.000Z", version: e.version });
  ctx.atender = (req, res) => {
    if (req.method === "GET" && req.path === "/api/hardware") {
      nGet++;
      const forzada = alGet?.(e, nGet);
      if (forzada) return responder(res, ...forzada);
      if (req.query.get("pagina") !== SLUG) return responder(res, 404, { error: "Página no encontrada" });
      return responder(res, 200, { yo: "ana", editable: true, pagina: pagina() });
    }
    if (req.method === "POST" && req.path === "/api/archivos") {
      nSubir++;
      const forzada = alSubir?.(nSubir, req);
      if (forzada === "cortar") return res.destroy();
      if (forzada) return responder(res, ...forzada);
      const nombre = req.query.get("nombre");
      return responder(res, 201, { id: req.query.get("id"), nombre, tipo: nombre.slice(nombre.lastIndexOf(".") + 1) });
    }
    if (req.method === "POST" && req.path === "/api/hardware") {
      nPost++;
      const forzada = alPost?.(e, req.json, nPost);
      if (forzada === "cortar") return res.destroy();
      if (forzada) return responder(res, ...forzada);
      if (req.json?.version !== e.version) return responder(res, 409, { error: "La página cambió", codigo: "version", version: e.version });
      e.version++;
      return responder(res, 200, { pagina: pagina() });
    }
    responder(res, 404, { error: "No encontrado" });
  };
  return e;
}

const de = (metodo, ruta) => ctx.peticiones.filter((p) => p.method === metodo && p.path === ruta);
const subidas = () => de("POST", "/api/archivos");
const aplicaciones = () => de("POST", "/api/hardware");
const lecturas = () => de("GET", "/api/hardware");
const idsSubidos = () => subidas().map((p) => p.query.get("id"));

function pareja(base = "placa") {
  return { drawio: ctx.archivo(`${base}.drawio`, DRAWIO), svg: ctx.archivo(`${base}.svg`, SVG) };
}

// Concurrente que mantiene el bloque: sube la versión y añade un párrafo.
const cambioQueMantiene = (e, _c, n) => {
  if (n === 1) {
    e.version = 8;
    e.md += "\nOtro párrafo de otra persona.\n";
  }
};

// ---------- 1. pareja + acción ----------
test("pareja sin --reemplazar: GET de la página, dos subidas con UUID nuevos y accion diagrama con fuenteAnterior null", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.deepEqual(
    ctx.peticiones.map((p) => `${p.method} ${p.path}`),
    ["GET /api/hardware", "POST /api/archivos", "POST /api/archivos", "POST /api/hardware"],
    "orden: leer la página, subir fuente, subir svg y aplicar",
  );
  const [g, sf, ss, a] = ctx.peticiones;
  assert.deepEqual([...g.query.keys()].sort(), ["disciplina", "pagina", "proyecto"], "GET con las 3 claves de la lista blanca");
  assert.equal(g.query.get("pagina"), SLUG);
  assert.equal(g.query.get("proyecto"), "uuv");
  assert.equal(g.query.get("disciplina"), "electronica");

  assert.equal(sf.query.get("nombre"), "placa.drawio");
  assert.equal(ss.query.get("nombre"), "placa.svg");
  assert.deepEqual(sf.body, Buffer.from(DRAWIO));
  assert.deepEqual(ss.body, Buffer.from(SVG));
  const fuente = sf.query.get("id");
  const svg = ss.query.get("id");
  assert.match(fuente, UUID_MIN, "UUID v4 en minúsculas");
  assert.match(svg, UUID_MIN, "UUID v4 en minúsculas");
  assert.notEqual(fuente, svg);

  assert.deepEqual(Object.keys(a.json).sort(), CLAVES, "exactamente las 8 claves de CLAVES_DIAGRAMA");
  assert.deepEqual(a.json, { proyecto: "uuv", disciplina: "electronica", accion: "diagrama", pagina: SLUG, version: 7, fuenteAnterior: null, fuente, svg });
  assert.match(a.headers["content-type"], /^application\/json/);
  assert.equal(a.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(a.headers.origin, undefined, "sin Origin");
  assert.equal(a.headers.cookie, undefined);
  for (const p of ctx.peticiones) assert.equal(p.headers.authorization, `Bearer ${TOKEN}`);

  assert.ok(r.stdout.includes(fuente), "muestra el id de la fuente");
  assert.ok(r.stdout.includes(svg), "muestra el id del svg");
  assert.ok(r.stdout.includes(SLUG), "muestra la página");
  assert.match(r.stdout, /versión 8/i, "muestra la versión nueva");
});

test("pareja con --reemplazar: fuenteAnterior es ese UUID y el resto del cuerpo igual", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(subidas().length, 2);
  assert.equal(aplicaciones().length, 1);
  const [fuente, svg] = idsSubidos();
  const a = aplicaciones()[0];
  assert.deepEqual(Object.keys(a.json).sort(), CLAVES);
  assert.deepEqual(a.json, { proyecto: "uuv", disciplina: "electronica", accion: "diagrama", pagina: SLUG, version: 7, fuenteAnterior: F0, fuente, svg });
  assert.ok(r.stdout.includes(fuente) && r.stdout.includes(svg));
});

// ---------- 2. svg por nombre ----------
test("sin --svg busca <base>.svg junto al .drawio (no en el directorio actual)", async () => {
  ctx.guardarArchivo();
  montarHw();
  const otroSvg = '<svg xmlns="http://www.w3.org/2000/svg" id="trabajo"/>';
  ctx.archivo("placa.svg", SVG); // señuelo en el directorio actual
  const drawio = ctx.archivo(join("trabajo", "placa.drawio"), DRAWIO);
  ctx.archivo(join("trabajo", "placa.svg"), otroSvg);
  const r = await ctx.ejecutar(["subir", drawio, "--pagina", SLUG, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(subidas().length, 2);
  assert.equal(subidas()[1].query.get("nombre"), "placa.svg");
  assert.deepEqual(subidas()[1].body, Buffer.from(otroSvg), "sube el svg de la carpeta del .drawio");
});

test("sin --svg y sin <base>.svg: error claro que menciona --svg, sin red", async () => {
  ctx.guardarArchivo();
  montarHw();
  const drawio = ctx.archivo("solo.drawio", DRAWIO);
  const r = await ctx.ejecutar(["subir", drawio, "--pagina", SLUG, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /--svg/);
  assert.match(r.stderr, /solo\.svg|svg/i);
  assert.equal(ctx.peticiones.length, 0);
});

// ---------- 3. validación local ----------
test("--pagina exige un .drawio como archivo principal y un .svg en --svg, sin red", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  const sch = ctx.archivo("placa.kicad_sch", "(kicad_sch (version 20231120))");
  const png = ctx.archivo("foto.png", PNG);
  for (const args of [
    ["subir", f.svg, "--pagina", SLUG, ...OPC],
    ["subir", sch, "--svg", f.svg, "--pagina", SLUG, ...OPC],
  ]) {
    const r = await ctx.ejecutar(args);
    assert.notEqual(r.codigo, 0, args[1]);
    assert.match(r.stderr, /\.?drawio/, `${args[1]}: dice que hace falta un .drawio`);
  }
  for (const otro of [png, f.drawio]) {
    const r = await ctx.ejecutar(["subir", f.drawio, "--svg", otro, "--pagina", SLUG, ...OPC]);
    assert.notEqual(r.codigo, 0, otro);
    assert.match(r.stderr, /svg/i);
  }
  assert.equal(ctx.peticiones.length, 0);
});

test("--reemplazar: UUID en minúsculas obligatorio y solo con --pagina; --svg solo con --pagina; slug válido; sin red", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  for (const args of [
    ["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0.toUpperCase(), ...OPC],
    ["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", "no-es-uuid", ...OPC],
    ["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0.slice(0, -1), ...OPC],
    ["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", `${F0}x`, ...OPC],
  ]) {
    const r = await ctx.ejecutar(args);
    assert.notEqual(r.codigo, 0, args[7]);
    assert.match(r.stderr, /--reemplazar/, `${args[7]}: nombra la opción`);
    assert.match(r.stderr, /UUID|uuid/);
  }
  for (const args of [
    ["subir", f.drawio, "--reemplazar", F0, ...OPC],
    ["subir", f.drawio, "--svg", f.svg, ...OPC],
  ]) {
    const r = await ctx.ejecutar(args);
    assert.notEqual(r.codigo, 0, args.join(" "));
    assert.match(r.stderr, /--pagina/, `${args.join(" ")}: dice que hace falta --pagina`);
  }
  for (const slug of ["Placa", "mi página", "a/b", "x".repeat(61)]) {
    const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", slug, ...OPC]);
    assert.notEqual(r.codigo, 0, slug);
    assert.match(r.stderr, /--pagina|página/i);
  }
  assert.equal(ctx.peticiones.length, 0);
});

test("contenido y tamaño de la pareja se validan en local (tipoPorContenido y topes de TIPOS), sin red", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  const drawioPng = ctx.archivo("falso.drawio", PNG);
  const svgDrawio = ctx.archivo("falso.svg", DRAWIO);
  const svgVacio = ctx.archivo("vacio.svg", "");
  const svgGrande = ctx.archivo("grande.svg", Buffer.concat([Buffer.from("<svg>"), Buffer.alloc(10 * 1024 * 1024, 0x20)]));
  const casos = [
    [[drawioPng, "--svg", f.svg], /contenido/i],
    [[f.drawio, "--svg", svgDrawio], /contenido/i],
    [[f.drawio, "--svg", svgVacio], /vacío/i],
    [[f.drawio, "--svg", svgGrande], /grande|tope|MB/i],
  ];
  for (const [archivos, esperado] of casos) {
    const r = await ctx.ejecutar(["subir", ...archivos, "--pagina", SLUG, ...OPC]);
    assert.notEqual(r.codigo, 0, archivos.join(" "));
    assert.match(r.stderr, esperado, archivos.join(" "));
  }
  assert.equal(ctx.peticiones.length, 0);
});

// ---------- 4. comprobaciones antes de subir ----------
test("página inexistente (404 en el GET): no sube nada y lo dice", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", "no-existe", ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /no existe|no se encontr/i);
  assert.equal(lecturas().length, 1);
  assert.equal(subidas().length, 0, "no deja adjuntos huérfanos");
  assert.equal(aplicaciones().length, 0);
});

test("--reemplazar con un bloque que no se puede cambiar: para antes de subir", async () => {
  ctx.guardarArchivo();
  const f = pareja();
  const variantes = [
    ["no está", MD0.replace(F0, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")],
    ["repetido", `${MD0}\n${bloque(F0, "dddddddd-dddd-4ddd-8ddd-dddddddddddd")}`],
    ["de excalidraw", `# P\n\n${bloque(F0, S0, "", "excalidraw")}`],
    ["dentro de una cita", `# P\n\n> ${bloque(F0, S0).trimEnd().split("\n").join("\n> ")}\n`],
    ["solo como svg", `# P\n\n${bloque("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", F0)}`],
  ];
  for (const [nombre, md] of variantes) {
    ctx.peticiones = [];
    montarHw({ md });
    const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
    assert.notEqual(r.codigo, 0, nombre);
    assert.match(r.stderr, /bloque/i, nombre);
    assert.equal(subidas().length, 0, `${nombre}: no sube nada`);
    assert.equal(aplicaciones().length, 0, nombre);
  }
});

// ---------- 5. 409 version: relectura y reintento ----------
test("409 version con --reemplazar y el bloque sigue: relee, reintenta con la versión nueva y no resube", async () => {
  ctx.guardarArchivo();
  montarHw({ alPost: cambioQueMantiene });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.deepEqual(
    ctx.peticiones.map((p) => `${p.method} ${p.path}`),
    ["GET /api/hardware", "POST /api/archivos", "POST /api/archivos", "POST /api/hardware", "GET /api/hardware", "POST /api/hardware"],
  );
  const [a1, a2] = aplicaciones();
  assert.equal(a1.json.version, 7);
  assert.equal(a2.json.version, 8, "reintenta con la versión releída");
  assert.deepEqual({ ...a2.json, version: 7 }, a1.json, "mismo cuerpo salvo la versión");
  assert.equal(a2.json.fuenteAnterior, F0);
  assert.match(r.stdout, /versión 9/i);
});

test("409 version sin --reemplazar: relee y reintenta si la página no tiene ya los UUID nuevos", async () => {
  ctx.guardarArchivo();
  montarHw({ alPost: cambioQueMantiene });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.equal(subidas().length, 2, "los adjuntos no se resuben");
  assert.equal(aplicaciones().length, 2);
  assert.equal(aplicaciones()[1].json.version, 8);
  assert.equal(aplicaciones()[1].json.fuenteAnterior, null);
});

test("409 version y el bloque ya no se puede cambiar: para sin reintentar y da los ids subidos", async () => {
  ctx.guardarArchivo();
  const f = pareja();
  const variantes = [
    ["bloque quitado", (e) => { e.md = "# Placa\n\nAlguien quitó el diagrama.\n"; }],
    ["bloque duplicado", (e) => { e.md += `\n${bloque(F0, "dddddddd-dddd-4ddd-8ddd-dddddddddddd")}`; }],
    ["bloque cambiado por otra persona", (e) => { e.md = e.md.replace(F0, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"); }],
  ];
  for (const [nombre, cambio] of variantes) {
    ctx.peticiones = [];
    montarHw({ alPost: (e, _c, n) => { if (n === 1) { e.version = 8; cambio(e); } } });
    const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
    assert.notEqual(r.codigo, 0, nombre);
    assert.equal(aplicaciones().length, 1, `${nombre}: no reintenta`);
    assert.equal(subidas().length, 2);
    assert.match(r.stderr, /cambi/i, `${nombre}: dice que la página cambió`);
    for (const id of idsSubidos()) assert.ok(r.stderr.includes(id), `${nombre}: da el id ${id}`);
  }
});

test("409 version sin --reemplazar y la página ya tiene un bloque con los UUID nuevos: no duplica", async () => {
  ctx.guardarArchivo();
  montarHw({
    alPost: (e, c, n) => {
      if (n === 1) {
        e.version = 8;
        e.md += `\n${bloque(c.fuente, c.svg, "")}`;
      }
    },
  });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.equal(aplicaciones().length, 1, "no reintenta: duplicaría el bloque");
  for (const id of idsSubidos()) assert.ok(r.stderr.includes(id));
});

test("409 version repetido: como mucho 2 reintentos (3 aplicaciones) y sin resubir", async () => {
  ctx.guardarArchivo();
  montarHw({ alPost: (e) => { e.version++; } });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.equal(aplicaciones().length, 3, "1 intento + 2 reintentos");
  assert.equal(subidas().length, 2);
  assert.match(r.stderr, /cambi/i);
  for (const id of idsSubidos()) assert.ok(r.stderr.includes(id));
});

test("si la relectura tras el 409 falla: para con los ids subidos", async () => {
  ctx.guardarArchivo();
  montarHw({ alPost: cambioQueMantiene, alGet: (_e, n) => (n === 2 ? [500, { error: "Error interno" }] : null) });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.equal(aplicaciones().length, 1);
  for (const id of idsSubidos()) assert.ok(r.stderr.includes(id));
});

// ---------- 6. otros errores de la acción ----------
test("errores de la acción diagrama: mensajes en español, sin reintento y con los ids subidos", async () => {
  ctx.guardarArchivo();
  const f = pareja();
  const casos = [
    [409, { error: "El bloque del diagrama no está o cambió", codigo: "bloque" }, {}, [/bloque/i]],
    [409, { error: "Hay otro guardado en curso; intenta de nuevo", codigo: "candado" }, {}, [/otro guardado|en curso/i]],
    [400, { error: "Adjuntos inválidos", codigo: "adjunto" }, {}, [/adjunto/i]],
    [403, { error: "Este token no permite esta operación", codigo: "alcance" }, {}, [/no permite/i]],
    [403, { error: "Solo los editores pueden escribir" }, {}, [/Solo los editores pueden escribir/]],
    [404, { error: "Página no encontrada" }, {}, [/no existe|no se encontr|Página no encontrada/i]],
    [413, { error: "Contenido demasiado grande" }, {}, [/demasiado grande/i, /página/i]],
    [429, { error: "Demasiadas escrituras" }, { "retry-after": "17" }, [/17/, /espera/i]],
  ];
  for (const [status, cuerpo, cabeceras, esperados] of casos) {
    ctx.peticiones = [];
    montarHw({ alPost: () => [status, cuerpo, cabeceras] });
    const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, "--reemplazar", F0, ...OPC]);
    const caso = `${status} ${cuerpo.codigo ?? ""}`;
    assert.notEqual(r.codigo, 0, caso);
    for (const e of esperados) assert.match(r.stderr, e, `${caso}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /id del archivo/i, `${caso}: no usa el mensaje de /api/archivos`);
    assert.doesNotMatch(r.stderr, /\n\s+at /, `${caso}: sin traza de pila`);
    assert.equal(aplicaciones().length, 1, `${caso}: sin reintentos`);
    assert.equal(subidas().length, 2, caso);
    for (const id of idsSubidos()) assert.ok(r.stderr.includes(id), `${caso}: da el id ${id}`);
  }
});

test("si falla la subida del svg: no aplica la acción y da el id de la fuente ya subida", async () => {
  ctx.guardarArchivo();
  montarHw({ alSubir: (n) => (n === 2 ? [500, { error: "Error interno" }] : null) });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.equal(subidas().length, 2);
  assert.equal(aplicaciones().length, 0);
  assert.ok(r.stderr.includes(idsSubidos()[0]), "da el id de la fuente subida");
});

test("si se corta la conexión al aplicar: no reintenta y avisa de que no se sabe si se aplicó", async () => {
  ctx.guardarArchivo();
  montarHw({ alPost: () => "cortar" });
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.drawio, "--svg", f.svg, "--pagina", SLUG, ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.equal(aplicaciones().length, 1, "no reintenta a ciegas");
  assert.match(r.stderr, /no se sabe|comprueba|revisa/i);
  for (const id of idsSubidos()) assert.ok(r.stderr.includes(id));
});

// ---------- 7. compatibilidad con G4a y ayuda ----------
test("sin --pagina sigue siendo una subida suelta (una petición, sin GET de hardware)", async () => {
  ctx.guardarArchivo();
  montarHw();
  const f = pareja();
  const r = await ctx.ejecutar(["subir", f.svg, ...OPC]);
  assert.equal(r.codigo, 0, r.stderr);
  assert.deepEqual(ctx.peticiones.map((p) => `${p.method} ${p.path}`), ["POST /api/archivos"]);
});

test("sin --pagina, el contenido también se valida en local antes de subir", async () => {
  ctx.guardarArchivo();
  montarHw();
  const r = await ctx.ejecutar(["subir", ctx.archivo("falso.drawio", PNG), ...OPC]);
  assert.notEqual(r.codigo, 0);
  assert.match(r.stderr, /contenido/i);
  assert.equal(ctx.peticiones.length, 0);
});

test("la ayuda documenta --pagina, --svg y --reemplazar", async () => {
  const r = await ctx.ejecutar(["--help"]);
  assert.equal(r.codigo, 0);
  for (const c of ["--pagina", "--svg", "--reemplazar"]) assert.ok(r.stdout.includes(c), `menciona ${c}`);
  assert.equal(ctx.peticiones.length, 0);
});
