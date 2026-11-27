// E2: biblioteca de integrados en el editor diagrams.net embebido. La biblioteca (<mxlibrary>, generada por
// tools/integrados.py) se sube como adjunto .xml de la disciplina; al abrir diagrams.net el portal la descarga de
// /api/archivos, la sanea en el cliente y la entrega por la vía `configure` (configure=1 en la URL solo si hay
// alguna biblioteca y {action:"configure", config:{libraries:[…]}} en respuesta al evento). Nada de la biblioteca viaja en la URL.
// Solo funciones puras y lectura de fuentes: nada contra diagrams.net en CI (headless recibe 403 en embed.diagrams.net).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const leer = (rel) => readFileSync(resolve(raiz, rel), "utf8");
const fixture = (n) => leer(`tests/fixtures/e2-biblioteca/${n}`);
const diag = () => import("../src/lib/diagramas.ts");

const URL_HOY = "https://embed.diagrams.net/?embed=1&proto=json&spin=1&lang=es&saveAndExit=0&noExitBtn=0&libraries=1&libs=general;electrical";
const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals";
const MB = 1024 * 1024;

// Biblioteca codificada como la escribe tools/integrados.py.
const codificar = (entradas) =>
  `<mxlibrary>${JSON.stringify(entradas).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</mxlibrary>\n`;
const forma = (i) => ({
  xml: `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="c${i}" value="U${i}" style="rounded=0" vertex="1" parent="1"><mxGeometry width="40" height="40" as="geometry"/></mxCell></root></mxGraphModel>`,
  w: 40,
  h: 40,
  aspect: "fixed",
  title: `U${i}`,
});

// ---------- 1. Lectura de <mxlibrary> ----------

test("1. formasDeBiblioteca/leerBiblioteca: NE555 de tools/integrados.py y argos (11 símbolos) se leen enteros", async () => {
  const { formasDeBiblioteca, leerBiblioteca } = await diag();
  const ne = formasDeBiblioteca(fixture("ne555.xml"));
  assert.ok(Array.isArray(ne));
  assert.equal(ne.length, 1);
  assert.deepEqual(Object.keys(ne[0]).sort(), ["aspect", "h", "title", "w", "xml"]);
  assert.equal(ne[0].title, "NE555");
  assert.equal(ne[0].w, 160);
  assert.equal(ne[0].h, 200);
  assert.equal(ne[0].aspect, "fixed");
  assert.ok(ne[0].xml.startsWith("<mxGraphModel>"), "el xml llega decodificado (sin &lt;)");
  assert.match(ne[0].xml, /value="NE555"/);

  const argos = leerBiblioteca(fixture("argos.xml"));
  assert.equal(argos.formas.length, 11);
  assert.equal(argos.descartadas, 0, "las bibliotecas reales no pierden ninguna forma con el saneado");
  assert.deepEqual(argos.formas.slice(0, 2).map((f) => f.title), ["NodeMCU_v1.0_ESP-12E", "OLED_2.42_SSD1309_I2C"]);
  assert.deepEqual(leerBiblioteca(fixture("ne555.xml")), { formas: ne, descartadas: 0 });
});

test("1. formasDeBiblioteca: null ante lo que no sea <mxlibrary> con una lista JSON", async () => {
  const { formasDeBiblioteca, leerBiblioteca } = await diag();
  for (const t of [
    "",
    "<mxfile><diagram/></mxfile>",
    "<mxlibrary>{}</mxlibrary>",
    '<mxlibrary>"texto"</mxlibrary>',
    "<mxlibrary>[{</mxlibrary>",
    "<mxlibrary>[]</mxlibrary><otro/>",
    "basura <mxlibrary>[]</mxlibrary>",
    null,
    undefined,
    42,
  ]) {
    assert.equal(formasDeBiblioteca(t), null, String(t));
    assert.equal(leerBiblioteca(t), null, String(t));
  }
  assert.deepEqual(formasDeBiblioteca("  <mxlibrary>[]</mxlibrary>\n"), [], "lista vacía: biblioteca válida sin formas");
});

// ---------- 2. Lista blanca y saneado en la carga (D3) ----------

test("2. hostil.xml: solo pasan las formas seguras y solo con los campos xml, w, h, aspect, title", async () => {
  const { leerBiblioteca, limpiarTitulo, MAX_TITULO } = await diag();
  const r = leerBiblioteca(fixture("hostil.xml"));
  assert.ok(r);
  const titulos = r.formas.map((f) => f.title);
  const largo = limpiarTitulo('<img src=x onerror="alert(1)">\u0007Hostil\u2028' + "x".repeat(200));
  assert.deepEqual(titulos, ["Bueno", "ClavesExtra", "HtmlPlano", "MenorQue", largo, "MedidasRaras"]);
  assert.equal(r.descartadas, 9);
  for (const f of r.formas) {
    const claves = Object.keys(f).sort();
    assert.ok(claves.every((k) => ["aspect", "h", "title", "w", "xml"].includes(k)), claves.join());
    assert.ok(f.xml.startsWith("<mxGraphModel"));
    assert.ok(f.title.length <= MAX_TITULO);
    assert.doesNotMatch(f.title, /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/, "título sin caracteres de control");
    assert.equal(typeof f.w, "number");
    assert.equal(typeof f.h, "number");
  }
  const extra = r.formas.find((f) => f.title === "ClavesExtra");
  assert.deepEqual(Object.keys(extra).sort(), ["aspect", "h", "title", "w", "xml"], "data/style/css/tooltip del adjunto no pasan");
  const raras = r.formas.find((f) => f.title === "MedidasRaras");
  assert.equal(raras.w, 40, "w no numérico → 40");
  assert.equal(raras.h, 40, "h no positivo → 40");
  assert.equal(Object.hasOwn(raras, "aspect"), false, "aspect solo puede ser \"fixed\"");
});

test("2. formaSegura: descarta image=, link=, UserObject, object, href/src, javascript: y HTML en value", async () => {
  const { formaSegura } = await diag();
  const m = (c) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${c}</root></mxGraphModel>`;
  const c = (value, style = "rounded=0", extra = "") =>
    m(`<mxCell id="c" value="${value}" style="${style}" vertex="1" parent="1"${extra}><mxGeometry width="80" height="40" as="geometry"/></mxCell>`);
  const seguras = [
    c("NE555"),
    c("VCC", "html=1;rounded=0"),
    c("A &lt; 5V"),
    c("A&amp;B"),
    c("~{RESET}"),
    c("SRC"),
    c("ONERROR"),
    c("x", "rounded=0;points=[[0,0.5,0]];fontStyle=1"),
  ];
  for (const x of seguras) assert.equal(formaSegura(x), true, x);
  const peligrosas = [
    c("U", "shape=image;image=https://evil.example/x.png"),
    c("U", "image=data:image/png;base64,AAAA"),
    c("U", "rounded=0;link=https://evil.example/"),
    c("U", "rounded=0;LINK=javascript:alert(1)"),
    m('<UserObject label="U" id="u"><mxCell vertex="1" parent="1"/></UserObject>'),
    m('<object label="U" id="o"><mxCell vertex="1" parent="1"/></object>'),
    c("U", "rounded=0", ' href="https://evil.example/"'),
    c("U", "rounded=0", ' src="https://evil.example/"'),
    c("U", "rounded=0", ' tooltip="javascript:alert(1)"'),
    c("U", "rounded=0", ' tooltip="JaVaScRiPt :alert(1)"'),
    c("U", "rounded=0", ' tooltip="jav&#x61;script:alert(1)"'),
    c("U", "rounded=0", ' tooltip="jav&#97;script:alert(1)"'),
    c("&lt;img src=x onerror=alert(1)&gt;"),
    c("&lt;script&gt;alert(1)&lt;/script&gt;"),
    c("&lt;b&gt;VCC&lt;/b&gt;", "html=1;rounded=0"),
    c("A &lt; 5V", "html=1;rounded=0"),
    c("&amp;lt;img src=x&amp;gt;", "html=1"),
  ];
  for (const x of peligrosas) assert.equal(formaSegura(x), false, x);
});

test("2. las bibliotecas reales de tools/integrados.py no usan html=1 ni nada que el saneado descarte", async () => {
  const { formaSegura } = await diag();
  for (const n of ["ne555.xml", "argos.xml"]) {
    const t = fixture(n);
    assert.doesNotMatch(t, /html=1/, `${n}: el generador no emite html=1`);
    const crudo = JSON.parse(/<mxlibrary>([\s\S]*)<\/mxlibrary>/.exec(t)[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
    for (const f of crudo) assert.equal(formaSegura(f.xml), true, `${n}: ${f.title}`);
  }
  assert.doesNotMatch(leer("tools/integrados.py"), /html=1/, "si el generador empieza a emitir html=1, revisar D3");
});

// ---------- 3. config de configure ----------

test("3. configDrawio: solo la clave libraries, con la sección «Integrados» y una paleta por biblioteca", async () => {
  const { configDrawio, formasDeBiblioteca, ID_BIBLIOTECAS } = await diag();
  assert.equal(ID_BIBLIOTECAS, "integrados");
  assert.deepEqual(configDrawio([]), {});
  const ne = formasDeBiblioteca(fixture("ne555.xml"));
  const argos = formasDeBiblioteca(fixture("argos.xml"));
  const cfg = configDrawio([
    { titulo: "ne555", formas: ne },
    { titulo: "argos", formas: argos },
  ]);
  assert.deepEqual(Object.keys(cfg), ["libraries"]);
  assert.deepEqual(cfg, {
    libraries: [
      {
        title: { main: "Proyecto" },
        entries: [
          {
            id: "integrados",
            title: { main: "Integrados" },
            libs: [
              { title: { main: "ne555" }, data: ne, expand: true },
              { title: { main: "argos" }, data: argos, expand: true },
            ],
          },
        ],
      },
    ],
  });
});

test("3. configDrawio: claves de más en la entrada no llegan al config (ni css, ni bibliotecas por URL)", async () => {
  const { configDrawio } = await diag();
  const cfg = configDrawio([
    { titulo: "x", formas: [{ xml: "<mxGraphModel/>", w: 1, h: 1, title: "x" }], css: "body{}", url: "https://evil.example/", defaultLibraries: "x" },
  ]);
  assert.deepEqual(Object.keys(cfg), ["libraries"]);
  assert.deepEqual(Object.keys(cfg.libraries[0].entries[0].libs[0]).sort(), ["data", "expand", "title"]);
  assert.doesNotMatch(JSON.stringify(cfg), /evil\.example|body\{\}|defaultLibraries/);
});

test("3. respuestaConfigure: siempre una acción configure; sin bibliotecas (o null) el config va vacío", async () => {
  const { respuestaConfigure, configDrawio, formasDeBiblioteca } = await diag();
  assert.deepEqual(respuestaConfigure([]), { action: "configure", config: {} });
  assert.deepEqual(respuestaConfigure(null), { action: "configure", config: {} });
  assert.deepEqual(respuestaConfigure(undefined), { action: "configure", config: {} });
  const b = [{ titulo: "ne555", formas: formasDeBiblioteca(fixture("ne555.xml")) }];
  assert.deepEqual(respuestaConfigure(b), { action: "configure", config: configDrawio(b) });
});

// ---------- 4. URL ----------

test("4. urlDrawio(): idéntica a la de hoy; urlDrawio(true): añade la sección y configure=1, sin datos de bibliotecas", async () => {
  const { urlDrawio, ORIGEN_DRAWIO } = await diag();
  assert.equal(ORIGEN_DRAWIO, "https://embed.diagrams.net", "D1: el origen no cambia");
  assert.equal(urlDrawio(), URL_HOY);
  assert.equal(urlDrawio(false), URL_HOY);
  assert.equal(urlDrawio(true), `${URL_HOY};integrados&configure=1`, "diagrams.net no decodifica: sin URLSearchParams");
  const u = new URL(urlDrawio(true));
  assert.equal(u.searchParams.get("configure"), "1");
  assert.deepEqual(u.searchParams.get("libs").split(";"), ["general", "electrical", "integrados"]);
  assert.doesNotMatch(urlDrawio(true), /clibs|NE555|mxlibrary|mxGraphModel|data:/i);
});

// ---------- 5. Carga desde los adjuntos y límites (D2, D4) ----------

const adj = (nombre, extra = {}) => ({ id: `id-${nombre}`, nombre, tipo: nombre.split(".").pop(), tamano: 5515, disciplina: "elec", ...extra });

test("5. cargarBibliotecas: solo .xml de la disciplina actual que sean <mxlibrary>; título = nombre sin extensión", async () => {
  const { cargarBibliotecas, formasDeBiblioteca } = await diag();
  const contenidos = {
    "id-ne555.xml": fixture("ne555.xml"),
    "id-argos.xml": fixture("argos.xml"),
    "id-otro.xml": "<config><a/></config>",
    "id-mec.xml": fixture("ne555.xml"),
  };
  const pedidos = [];
  const r = await cargarBibliotecas({
    disciplina: "elec",
    listar: async () => [adj("ne555.xml"), adj("plano.pdf"), adj("dibujo.drawio"), adj("otro.xml"), adj("mec.xml", { disciplina: "mecanica" }), adj("argos.xml")],
    descargar: async (id) => {
      pedidos.push(id);
      return contenidos[id];
    },
  });
  assert.deepEqual(pedidos.sort(), ["id-argos.xml", "id-ne555.xml", "id-otro.xml"], "no descarga otros tipos ni otras disciplinas");
  assert.deepEqual(r.bibliotecas.map((b) => b.titulo), ["ne555", "argos"], "conserva el orden del listado");
  assert.deepEqual(r.bibliotecas[0].formas, formasDeBiblioteca(fixture("ne555.xml")));
  assert.equal(r.bibliotecas[1].formas.length, 11);
  assert.deepEqual(r.avisos, [], "un .xml que no es biblioteca se ignora sin aviso");
});

test("5. cargarBibliotecas: límites de 1 MB por biblioteca, 10 por disciplina y 1000 formas, con aviso", async () => {
  const { cargarBibliotecas, LIMITES_BIBLIOTECA } = await diag();
  assert.deepEqual(LIMITES_BIBLIOTECA, { bytes: MB, porDisciplina: 10, formas: 1000 });
  const ne = fixture("ne555.xml");
  const muchas = codificar(Array.from({ length: 1001 }, (_, i) => forma(i)));
  const enorme = ne.padEnd(MB + 10, " "); // <mxlibrary> válida (admite espacios finales) pero de más de 1 MB
  const lista = [
    adj("grande.xml", { tamano: MB + 1 }),
    adj("miente.xml"),
    adj("muchas.xml"),
    ...Array.from({ length: 10 }, (_, i) => adj(`b${i}.xml`)),
  ];
  const pedidos = [];
  const r = await cargarBibliotecas({
    disciplina: "elec",
    listar: async () => lista,
    descargar: async (id) => {
      pedidos.push(id);
      return id === "id-miente.xml" ? enorme : id === "id-muchas.xml" ? muchas : ne;
    },
  });
  assert.ok(!pedidos.includes("id-grande.xml"), "lo que el listado declara > 1 MB ni se descarga");
  assert.equal(pedidos.length, 10, "como mucho 10 descargas por disciplina");
  assert.ok(!pedidos.includes("id-b8.xml") && !pedidos.includes("id-b9.xml"));
  const titulos = r.bibliotecas.map((b) => b.titulo);
  assert.ok(!titulos.includes("grande") && !titulos.includes("miente"), "contenido real > 1 MB se omite aunque el listado diga otra cosa");
  assert.equal(r.bibliotecas.find((b) => b.titulo === "muchas").formas.length, 1000, "se recorta a 1000 formas");
  assert.equal(r.bibliotecas.length, 9);
  for (const n of ["grande", "miente", "muchas"]) assert.ok(r.avisos.some((a) => a.includes(n)), `aviso que nombra ${n}`);
  assert.ok(r.avisos.some((a) => /10/.test(a)), "aviso de bibliotecas de más");
});

test("5. cargarBibliotecas: nunca lanza; si falla el listado o una descarga, sigue con lo demás y avisa", async () => {
  const { cargarBibliotecas, respuestaConfigure } = await diag();
  for (const listar of [async () => Promise.reject(new Error("red")), async () => ({ error: "x" }), async () => null, () => { throw new Error("sin red"); }]) {
    const r = await cargarBibliotecas({ disciplina: "elec", listar, descargar: async () => fixture("ne555.xml") });
    assert.deepEqual(r.bibliotecas, []);
    assert.ok(r.avisos.length >= 1, "aviso al usuario");
    assert.deepEqual(respuestaConfigure(r.bibliotecas), { action: "configure", config: {} }, "el editor abre sin bibliotecas");
  }
  const r = await cargarBibliotecas({
    disciplina: "elec",
    listar: async () => [adj("rota.xml"), adj("ne555.xml"), "basura", null, { nombre: 5 }],
    descargar: async (id) => (id === "id-rota.xml" ? Promise.reject(new Error("500")) : fixture("ne555.xml")),
  });
  assert.deepEqual(r.bibliotecas.map((b) => b.titulo), ["ne555"]);
  assert.ok(r.avisos.some((a) => a.includes("rota")));
});

test("5. cargarBibliotecas: avisa cuando el saneado descarta formas, y omite una biblioteca que se queda vacía", async () => {
  const { cargarBibliotecas } = await diag();
  const soloMalas = codificar([{ ...forma(1), xml: forma(1).xml.replace('style="rounded=0"', 'style="image=https://evil.example/x"') }]);
  const r = await cargarBibliotecas({
    disciplina: "elec",
    listar: async () => [adj("hostil.xml"), adj("malas.xml")],
    descargar: async (id) => (id === "id-hostil.xml" ? fixture("hostil.xml") : soloMalas),
  });
  assert.deepEqual(r.bibliotecas.map((b) => b.titulo), ["hostil"]);
  assert.equal(r.bibliotecas[0].formas.length, 6);
  assert.ok(r.avisos.some((a) => a.includes("hostil") && a.includes("9")), "cuántas formas se descartaron");
  assert.ok(r.avisos.some((a) => a.includes("malas")));
});

// ---------- 6. Integración en el editor (src/scripts/diagramas.ts, hardware-editor.ts) ----------

test("6. cargarBibliotecasConTope: devuelve lo cargado o, pasado el tope, ninguna biblioteca con aviso; nunca cuelga", async () => {
  const { cargarBibliotecasConTope, cargarBibliotecas, ESPERA_BIBLIOTECAS_MS } = await diag();
  assert.equal(ESPERA_BIBLIOTECAS_MS, 5000, "tope de la carga antes de abrir el iframe sin bibliotecas");
  const listar = async () => [adj("ne555.xml")];
  const descargar = async () => fixture("ne555.xml");
  const normal = await cargarBibliotecasConTope({ disciplina: "elec", listar, descargar }, 1000);
  assert.deepEqual(normal, await cargarBibliotecas({ disciplina: "elec", listar, descargar }));
  assert.equal(normal.bibliotecas.length, 1);
  const nunca = () => new Promise(() => {});
  for (const o of [{ listar: nunca, descargar }, { listar, descargar: nunca }]) {
    const t0 = Date.now();
    const r = await cargarBibliotecasConTope({ disciplina: "elec", ...o }, 30);
    assert.ok(Date.now() - t0 < 1000, "resuelve al llegar el tope");
    assert.deepEqual(r.bibliotecas, []);
    assert.ok(r.avisos.length >= 1, "aviso de que las bibliotecas tardaron");
  }
  const roto = await cargarBibliotecasConTope({ disciplina: "elec", listar: () => { throw new Error("x"); }, descargar }, 30);
  assert.deepEqual(roto.bibliotecas, []);
  assert.ok(roto.avisos.length >= 1);
});

test("6. el editor carga las bibliotecas antes del iframe y solo pide configure=1 si hay alguna", async () => {
  const dg = leer("src/scripts/diagramas.ts");
  const iCarga = dg.indexOf("cargarBibliotecasConTope(");
  const iSrc = dg.indexOf("marco.src = urlDrawio(");
  assert.ok(iCarga >= 0, "usa cargarBibliotecasConTope");
  assert.ok(iSrc > iCarga, "el iframe se crea después de cargar las bibliotecas");
  assert.match(dg, /await cargarBibliotecasConTope\(/);
  assert.match(dg, /const conBibliotecas = bibliotecas\.length > 0;/);
  assert.match(dg, /marco\.src = urlDrawio\(conBibliotecas\);/, "sin bibliotecas, la URL de hoy (sin configure=1)");
  assert.doesNotMatch(dg, /urlDrawio\(true\)/);
  const caso = /case "configure":([\s\S]*?)(?:case "|\n\s*\}\n)/.exec(dg);
  assert.ok(caso, "el switch atiende el evento configure (defensa si llega sin pedirlo)");
  assert.match(
    caso[1],
    /enviarDrawio\(marco\.contentWindow,\s*respuestaConfigure\(conBibliotecas \? bibliotecas : null\)\)/,
    "lo cargado si se pidió, config vacío si no; targetOrigin exacto vía enviarDrawio",
  );
  assert.match(dg, /\.avisos|\bavisos\b/, "los avisos se muestran al usuario");
  assert.match(dg, /\/api\/archivos\//);
  assert.match(dg, /lista:\s*"1"/, "listado de adjuntos con lista=1");
  assert.match(dg, /credentials:\s*"same-origin"/);
  assert.match(dg, /proyecto:\s*string;/, "OpcionesEditor recibe el proyecto");
  assert.match(dg, /disciplina:\s*string;/, "OpcionesEditor recibe la disciplina");
  const ed = leer("src/scripts/hardware-editor.ts");
  const llamada = /abrirEditorDiagrama\(\{([\s\S]*?)\}\);/.exec(ed);
  assert.ok(llamada);
  assert.match(llamada[1], /\bproyecto\b/);
  assert.match(llamada[1], /\bdisciplina\b/);
});

// ---------- 7. Tipo de adjunto, CSP y sandbox ----------

test("7. TIPOS.xml: adjunto octet-stream, nunca en línea, máximo 1 MB", async () => {
  const { TIPOS } = await import("../lib/archivos-nombre.mjs");
  assert.deepEqual(TIPOS.xml, { mime: "application/octet-stream", max: MB, inline: false });
  const { validarArchivo } = await import("../src/lib/hardware-editor.ts");
  assert.equal(validarArchivo(new File(["<mxlibrary>[]</mxlibrary>"], "ne555.xml")).ok, true);
  assert.equal(validarArchivo(new File([new Uint8Array(MB + 1)], "grande.xml")).ok, false);
});

test("7. CSP y sandbox del iframe no cambian", async () => {
  const config = (await import("../astro.config.mjs")).default;
  assert.ok(config.security.csp.directives.includes("frame-src 'self' https://embed.diagrams.net"));
  assert.doesNotMatch(JSON.stringify(config.security.csp), /app\.diagrams\.net/);
  assert.ok(config.security.csp.directives.includes("connect-src 'self'"));
  const dg = leer("src/scripts/diagramas.ts");
  const sb = [...dg.matchAll(/setAttribute\("sandbox",\s*"([^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(sb, [SANDBOX]);
});

// ---------- 8. Sin otras vías ----------

test("8. sin clibs, defaultCustomLibraries ni remoteInvoke; EVENTOS_DRAWIO no crece", () => {
  const lib = leer("src/lib/diagramas.ts");
  const dg = leer("src/scripts/diagramas.ts");
  assert.doesNotMatch(lib + dg, /clibs|defaultCustomLibraries|remoteInvoke/);
  const m = /const EVENTOS_DRAWIO = new Set\(\[([^\]]*)\]\)/.exec(lib);
  assert.ok(m);
  assert.deepEqual(JSON.parse(`[${m[1]}]`), ["init", "load", "save", "export", "exit", "autosave", "configure"]);
});
