// C1 importar: lógica pura del plan de importación (src/lib/importar-plan.ts). Sin DOM ni red.
// De una lista de entradas ya leídas ({ ruta, bytes }, del zip o de .md sueltos) sale un plan: páginas (título, slug,
// md decodificado), imágenes a subir (una vez cada una) y avisos de lo omitido. reescribirMd cambia las imágenes subidas
// por su enlace de /api/archivos y los enlaces entre .md del lote por la URL de la página.
import { test } from "node:test";
import assert from "node:assert/strict";

const SLUG = /^[a-z0-9-]{1,60}$/;
const A = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
const B = "7a1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3b";
const C = "0b1c2d3e-4f50-4a61-9b72-8c9d0e1f2a3c";
const url = (id) => `/api/archivos/?proyecto=uuv&id=${id}`;
const bytes = (s) => new TextEncoder().encode(s);
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

let lib = null;
let fallo = null;
try {
  lib = await import("../src/lib/importar-plan.ts");
} catch (e) {
  fallo = e;
}
const L = () => {
  assert.ok(lib, `no se pudo importar src/lib/importar-plan.ts: ${fallo?.message}`);
  return lib;
};
const hayAviso = (plan, ruta, re) => plan.avisos.some((a) => a.ruta === ruta && re.test(a.motivo));

// ---------- límites y selección ----------

test("LIMITES: zip 50 MB, 500 entradas, md 200 KB, imagen 10 MB, total 100 MB, 50 páginas; imágenes png/jpg/jpeg/webp/svg", () => {
  const { LIMITES, EXT_IMAGEN } = L();
  const MB = 1024 * 1024;
  assert.deepEqual({ ...LIMITES }, { zip: 50 * MB, entradas: 500, md: 200 * 1024, imagen: 10 * MB, total: 100 * MB, paginas: 50 });
  assert.deepEqual([...EXT_IMAGEN].sort(), ["jpeg", "jpg", "png", "svg", "webp"]);
});

test("clasificarSeleccion: varios .md o un solo .zip; mezclas, varios zip u otros tipos dan error con mensaje", () => {
  const { clasificarSeleccion, MENSAJE_SELECCION } = L();
  assert.equal(MENSAJE_SELECCION, "Elige uno o varios .md, o un solo .zip.");
  assert.deepEqual(clasificarSeleccion(["a.md"]), { tipo: "sueltos" });
  assert.deepEqual(clasificarSeleccion(["a.md", "B.MD"]), { tipo: "sueltos" });
  assert.deepEqual(clasificarSeleccion(["docs.zip"]), { tipo: "zip" });
  assert.deepEqual(clasificarSeleccion(["DOCS.ZIP"]), { tipo: "zip" });
  for (const mal of [[], ["a.zip", "b.zip"], ["a.md", "b.zip"], ["a.txt"], ["a.md", "foto.png"], ["zip"], ["a.md.exe"]]) {
    assert.deepEqual(clasificarSeleccion(mal), { tipo: "error", mensaje: MENSAJE_SELECCION }, JSON.stringify(mal));
  }
});

test("MENSAJE_EDICION_ABIERTA: texto fijo para cuando hay una edición con cambios sin guardar", () => {
  assert.equal(L().MENSAJE_EDICION_ABIERTA, "Guarda o cancela la edición antes de importar");
});

// ---------- rutas ----------

test("clasificarRuta: normaliza \\ a /, quita ./ y // y clasifica por extensión sin distinguir mayúsculas", () => {
  const { clasificarRuta } = L();
  assert.deepEqual(clasificarRuta("docs\\guia.md"), { tipo: "md", ruta: "docs/guia.md" });
  assert.deepEqual(clasificarRuta("./a.md"), { tipo: "md", ruta: "a.md" });
  assert.deepEqual(clasificarRuta("a//b/./c.MD"), { tipo: "md", ruta: "a/b/c.MD" });
  assert.deepEqual(clasificarRuta("IMG/Foto.PNG"), { tipo: "imagen", ruta: "IMG/Foto.PNG" });
  for (const r of ["x.jpg", "x.jpeg", "x.webp", "x.svg", "dir con espacios/ñandú.png"]) assert.equal(clasificarRuta(r).tipo, "imagen", r);
  for (const r of ["a.pdf", "x.gif", "LEEME", "a.md.txt", "a.html", "placa.kicad_sch", "md"]) assert.equal(clasificarRuta(r).tipo, "otro", r);
});

test("clasificarRuta: insegura con segmento .., ruta absoluta (/, unidad, UNC), NUL o caracteres de control", () => {
  const { clasificarRuta } = L();
  const malas = ["../a.md", "a/../../b.md", "a/../b.md", "a/..", "..", "..\\a.md", "/etc/a.md", "\\a.md", "C:\\a.md", "c:/a.md", "C:a.md", "\\\\srv\\a.md", "a\u0000.md", "a\n.md", "a\tb.png", "a\u007f.md", "a\u0085.md", "__MACOSX/../a.md", ".oculto/../a.md"];
  for (const r of malas) assert.equal(clasificarRuta(r).tipo, "insegura", JSON.stringify(r));
});

test("clasificarRuta: ignora en silencio directorios, __MACOSX/, y todo lo que tenga un segmento que empieza por punto", () => {
  const { clasificarRuta } = L();
  for (const r of ["docs/", "docs\\", "", "__MACOSX/a.md", "__MACOSX/docs/._a.md", ".oculto.md", ".DS_Store", "docs/.git/x.md", "docs/.vista.png", ".github/a.md"]) {
    assert.equal(clasificarRuta(r).tipo, "ignorar", JSON.stringify(r));
  }
});

// ---------- codificación y título ----------

test("decodificarMd: UTF-8 estricto, sin BOM y con \\r\\n pasado a \\n; lo que no es UTF-8 válido se rechaza (no se adivina)", () => {
  const { decodificarMd } = L();
  assert.deepEqual(decodificarMd(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("# Ñandú\r\ntexto\r\n")])), { ok: true, texto: "# Ñandú\ntexto\n" });
  assert.deepEqual(decodificarMd(bytes("a\nb")), { ok: true, texto: "a\nb" });
  assert.deepEqual(decodificarMd(new Uint8Array(0)), { ok: true, texto: "" });
  const malos = [
    new Uint8Array([0x23, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a]), // "# café" en latin-1
    new Uint8Array([0xc0, 0xaf]), // secuencia sobrelarga
    new Uint8Array([0xff, 0xfe, 0x23, 0x00, 0x20, 0x00]), // UTF-16 LE con BOM
    new Uint8Array([0xe2, 0x82]), // secuencia cortada
  ];
  for (const m of malos) assert.equal(decodificarMd(m).ok, false, [...m].join(","));
});

test("tituloDeMd: primer encabezado «# » fuera de bloques de código; si no hay, el nombre del archivo sin extensión", () => {
  const { tituloDeMd } = L();
  assert.equal(tituloDeMd("# Placa de potencia\n\ntexto", "x.md"), "Placa de potencia");
  assert.equal(tituloDeMd("intro\n\n## Sub\n\n#   Título real  \n\n# Otro\n", "x.md"), "Título real");
  assert.equal(tituloDeMd("```\n# no es título\n```\n\n# Sí\n", "x.md"), "Sí");
  assert.equal(tituloDeMd("~~~sh\n# comentario de shell\n~~~\ntexto\n", "docs/guia-de-uso.md"), "guia-de-uso");
  assert.equal(tituloDeMd("#sin espacio\n## Solo nivel dos\n", "docs/Guía rápida.MD"), "Guía rápida");
  assert.equal(tituloDeMd("#\n# \ntexto", "notas.md"), "notas", "un encabezado vacío no cuenta");
  assert.equal(tituloDeMd("", "a.b.md"), "a.b");
});

test("tituloDeMd: recortado a 120 caracteres y sin caracteres de control (lo acepta validarTitulo del servidor)", () => {
  const { tituloDeMd } = L();
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
  assert.equal(tituloDeMd(`# ${"a".repeat(200)}\n`, "x.md"), "a".repeat(120));
  assert.equal(tituloDeMd("# Ho\u0007la\u009f mundo\n", "x.md"), "Hola mundo");
  for (const [md, archivo] of [[`# ${"é ".repeat(100)}\n`, "x.md"], ["sin encabezado", `${"n".repeat(300)}.md`], ["# \u0007\u0008\n", "resp\u0001aldo.md"]]) {
    const t = tituloDeMd(md, archivo);
    assert.ok(t.length >= 1 && t.length <= 120 && t === t.trim() && !CONTROL.test(t), JSON.stringify(t));
  }
});

// ---------- analizar ----------

const BASICO = () => [
  { ruta: "potencia.md", bytes: bytes("# Potencia\n\n![Vista](docs/img/vista.png) ![logo](logo.svg)\n") },
  { ruta: "docs/guia.md", bytes: bytes("# Guía\r\n\r\n![Vista](img/vista.png)\r\n\r\nVer [potencia](../potencia.md#baterias) y [otra](falta.md).\r\n") },
  { ruta: "docs/img/vista.png", bytes: PNG },
  { ruta: "logo.svg", bytes: bytes("<svg xmlns='http://www.w3.org/2000/svg'/>") },
  { ruta: "suelta.png", bytes: PNG },
];

test("analizar: una página por .md (ordenadas por ruta), con título, slug único frente al índice, md decodificado e imágenes que vienen", () => {
  const { analizar } = L();
  const plan = analizar({ entradas: BASICO(), existentes: ["potencia", "pcb"] });
  assert.deepEqual(plan.paginas.map((p) => [p.ruta, p.titulo, p.slug]), [["docs/guia.md", "Guía", "guia"], ["potencia.md", "Potencia", "potencia-2"]]);
  assert.equal(plan.paginas[0].md, "# Guía\n\n![Vista](img/vista.png)\n\nVer [potencia](../potencia.md#baterias) y [otra](falta.md).\n", "el md se guarda tal cual, solo decodificado");
  assert.deepEqual(plan.paginas[0].imagenes, ["docs/img/vista.png"]);
  assert.deepEqual([...plan.paginas[1].imagenes].sort(), ["docs/img/vista.png", "logo.svg"]);
  // Cada imagen referenciada va una sola vez; la que nadie referencia (suelta.png) no se sube.
  assert.deepEqual(plan.imagenes.map((i) => i.ruta).sort(), ["docs/img/vista.png", "logo.svg"]);
  const vista = plan.imagenes.find((i) => i.ruta === "docs/img/vista.png");
  assert.equal(vista.nombre, "vista.png", "el nombre para la API sale de sanearNombre, nunca la ruta del zip");
  assert.deepEqual([...vista.bytes], [...PNG]);
  assert.deepEqual(plan.avisos, [], "un enlace a un .md que no viene no es un aviso");
});

test("analizar: orden estable por ruta normalizada (comparación por unidades de código)", () => {
  const { analizar } = L();
  const entradas = ["b.md", "a/z.md", "a.md", "2.md", "10.md", "a\\b.md"].map((ruta) => ({ ruta, bytes: bytes("texto") }));
  assert.deepEqual(analizar({ entradas, existentes: [] }).paginas.map((p) => p.ruta), ["10.md", "2.md", "a.md", "a/b.md", "a/z.md", "b.md"]);
});

test("analizar: todos los slugs se deciden antes de escribir: únicos frente al índice y entre sí, válidos para el servidor", () => {
  const { analizar } = L();
  const entradas = [
    { ruta: "a.md", bytes: bytes("# Notas\n") },
    { ruta: "b.md", bytes: bytes("# Notas\n") },
    { ruta: "c.md", bytes: bytes("# notas\n") },
    { ruta: "mi archivo.md", bytes: bytes("# ¿?\n") },
    { ruta: "¿¿.md", bytes: bytes("# ¡!\n") },
    { ruta: "¡¡.md", bytes: bytes("# ¡¡!!\n") },
    { ruta: "largo.md", bytes: bytes(`# ${"x".repeat(100)}\n`) },
    { ruta: "largo2.md", bytes: bytes(`# ${"x".repeat(100)}\n`) },
  ];
  const plan = analizar({ entradas, existentes: ["notas", "notas-3"] });
  const por = Object.fromEntries(plan.paginas.map((p) => [p.ruta, p.slug]));
  assert.equal(por["a.md"], "notas-2");
  assert.equal(por["b.md"], "notas-4");
  assert.equal(por["c.md"], "notas-5");
  assert.equal(por["mi archivo.md"], "mi-archivo", "sin slug del título, sale del nombre del archivo");
  assert.deepEqual([por["¡¡.md"], por["¿¿.md"]].sort(), ["pagina", "pagina-2"], "sin slug del título ni del nombre: «pagina»");
  const slugs = plan.paginas.map((p) => p.slug);
  assert.equal(new Set(slugs).size, entradas.length);
  for (const s of slugs) assert.match(s, SLUG);
});

test("analizar: el .md se mide en bytes UTF-8; 200 KB justos entra y un byte más se omite con aviso (no se trunca)", () => {
  const { analizar, LIMITES } = L();
  const justo = "ñ".repeat(LIMITES.md / 2); // 204 800 bytes, 102 400 caracteres
  const pasado = "ñ".repeat(LIMITES.md / 2) + "a"; // 204 801 bytes, muchos menos caracteres que el límite
  const plan = analizar({ entradas: [{ ruta: "justo.md", bytes: bytes(justo) }, { ruta: "pasado.md", bytes: bytes(pasado) }], existentes: [] });
  assert.deepEqual(plan.paginas.map((p) => p.ruta), ["justo.md"]);
  assert.equal(plan.paginas[0].md, justo);
  assert.ok(hayAviso(plan, "pasado.md", /200 KB/), JSON.stringify(plan.avisos));
});

test("analizar: como mucho 50 páginas por importación; las que sobran (en orden) se omiten con aviso", () => {
  const { analizar } = L();
  const nombre = (i) => `p${String(i).padStart(3, "0")}.md`;
  const hacer = (n) => Array.from({ length: n }, (_, i) => ({ ruta: nombre(i), bytes: bytes(`# Página ${i}\n`) }));
  const justo = analizar({ entradas: hacer(50), existentes: [] });
  assert.equal(justo.paginas.length, 50);
  assert.deepEqual(justo.avisos, []);
  const pasado = analizar({ entradas: hacer(52).reverse(), existentes: [] });
  assert.equal(pasado.paginas.length, 50);
  assert.equal(pasado.paginas.at(-1).ruta, nombre(49));
  assert.ok(hayAviso(pasado, nombre(50), /50 páginas/) && hayAviso(pasado, nombre(51), /50 páginas/), JSON.stringify(pasado.avisos));
});

test("analizar: un .md que no es UTF-8 válido se omite con el aviso «no está en UTF-8»; los demás siguen", () => {
  const { analizar } = L();
  const plan = analizar({ entradas: [{ ruta: "latin1.md", bytes: new Uint8Array([0x23, 0x20, 0x63, 0x61, 0x66, 0xe9]) }, { ruta: "bien.md", bytes: bytes("# Bien\n") }], existentes: [] });
  assert.deepEqual(plan.paginas.map((p) => p.ruta), ["bien.md"]);
  assert.ok(hayAviso(plan, "latin1.md", /no está en UTF-8/), JSON.stringify(plan.avisos));
});

test("analizar: descarta con aviso rutas inseguras, tipos no admitidos y nombres repetidos; ignora en silencio lo oculto", () => {
  const { analizar } = L();
  const md = bytes("# Uno\n");
  const plan = analizar({
    entradas: [
      { ruta: "../fuera.md", bytes: md },
      { ruta: "C:\\Windows\\x.md", bytes: md },
      { ruta: "plano.pdf", bytes: PNG },
      { ruta: "Guia.md", bytes: bytes("# Primera\n") },
      { ruta: "guia.MD", bytes: bytes("# Segunda\n") },
      { ruta: "__MACOSX/._Guia.md", bytes: md },
      { ruta: ".oculto.md", bytes: md },
      { ruta: "docs/", bytes: new Uint8Array(0) },
    ],
    existentes: [],
  });
  assert.deepEqual(plan.paginas.map((p) => [p.ruta, p.titulo]), [["Guia.md", "Primera"]], "entre nombres que solo difieren en mayúsculas gana la primera");
  assert.equal(plan.avisos.length, 4, JSON.stringify(plan.avisos));
  assert.ok(plan.avisos.some((a) => /fuera\.md/.test(a.ruta) && /ruta no permitida/.test(a.motivo)));
  assert.ok(plan.avisos.some((a) => /x\.md/.test(a.ruta) && /ruta no permitida/.test(a.motivo)));
  assert.ok(hayAviso(plan, "plano.pdf", /tipo de archivo no admitido/));
  assert.ok(hayAviso(plan, "guia.MD", /nombre repetido/));
});

test("analizar: imagen que no viene, que sale de la raíz o externa: el md no se toca y se avisa; código y <img> no cuentan", () => {
  const { analizar } = L();
  const texto = [
    "# Guía",
    "![a](falta.png)",
    "![b](../../fuera.png)",
    "![c](https://evil.example/c.png)",
    "![d](data:image/png;base64,AAAA)",
    `![e](/api/archivos/?proyecto=uuv&id=${A})`,
    "`![f](codigo-en-linea.png)`",
    "```",
    "![g](en-bloque.png)",
    "```",
    "~~~",
    "![h](en-tildes.png)",
    "~~~",
    '<img src="html.png">',
    "",
  ].join("\n");
  const plan = analizar({ entradas: [{ ruta: "docs/guia.md", bytes: bytes(texto) }, { ruta: "fuera.png", bytes: PNG }], existentes: [] });
  assert.equal(plan.paginas[0].md, texto);
  assert.deepEqual(plan.paginas[0].imagenes, []);
  assert.deepEqual(plan.imagenes, [], "../../fuera.png sale de la raíz: no se resuelve contra fuera.png");
  assert.ok(plan.avisos.some((a) => a.ruta === "docs/guia.md" && /falta\.png/.test(a.motivo) && /no venía en el archivo/.test(a.motivo)), JSON.stringify(plan.avisos));
  assert.ok(plan.avisos.some((a) => a.ruta === "docs/guia.md" && /fuera\.png/.test(a.motivo) && /no venía en el archivo/.test(a.motivo)));
  assert.equal(plan.avisos.filter((a) => /las imágenes externas no se muestran/.test(a.motivo)).length, 2, JSON.stringify(plan.avisos));
  assert.equal(plan.avisos.length, 4, `ni /api/archivos, ni el código, ni <img> generan avisos: ${JSON.stringify(plan.avisos)}`);
});

test("analizar: .md sueltos con imágenes relativas: se importan y se avisa de cada imagen que no venía", () => {
  const { analizar } = L();
  const plan = analizar({ entradas: [{ ruta: "nota.md", bytes: bytes("# Nota\n\n![x](img/x.png)\n") }], existentes: [] });
  assert.equal(plan.paginas.length, 1);
  assert.deepEqual(plan.imagenes, []);
  assert.ok(hayAviso(plan, "nota.md", /no venía en el archivo/));
});

test("analizar: conserva delante los avisos que ya traía la lectura del zip", () => {
  const { analizar } = L();
  const previo = { ruta: "gigante.png", motivo: "pasa de 10 MB" };
  const plan = analizar({ entradas: [{ ruta: "a.md", bytes: bytes("# A\n\n![x](falta.png)\n") }], existentes: [], avisos: [previo] });
  assert.deepEqual(plan.avisos[0], previo);
  assert.equal(plan.avisos.length, 2);
});

// ---------- reescritura ----------

const ctx = () => ({
  ruta: "docs/guia.md",
  proyecto: "uuv",
  disciplina: "electronica",
  slugs: new Map([["docs/guia.md", "guia"], ["potencia.md", "potencia-2"], ["docs/otra pagina.md", "otra-pagina"]]),
  subidas: new Map([["docs/img/vista.png", { id: A, nombre: "vista.png" }], ["docs/img/mi foto.png", { id: B, nombre: "mi-foto.png" }], ["logo.svg", { id: C, nombre: "logo.svg" }]]),
});

test("reescribirMd: cada imagen subida queda con el formato de enlaceArchivo; conserva el alt y descarta el título", async () => {
  const { reescribirMd } = L();
  const { enlaceArchivo } = await import("../src/lib/hardware-editor.ts");
  const casos = [
    ["![Vista general](img/vista.png)", `![Vista general](${url(A)})`],
    ["![](./img/vista.png)", enlaceArchivo({ proyecto: "uuv", id: A, nombre: "vista.png", imagen: true })],
    ['![a](img/vista.png "Título")', `![a](${url(A)})`],
    ["![a](img/vista.png 'Título')", `![a](${url(A)})`],
    ["![a](<img/mi foto.png>)", `![a](${url(B)})`],
    ["![a](img/mi%20foto.png)", `![a](${url(B)})`],
    ["![a](img/mi foto.png)", `![a](${url(B)})`],
    ["![a](IMG/Vista.PNG)", `![a](${url(A)})`],
    ["![a](../docs/img/vista.png)", `![a](${url(A)})`],
    ["antes ![a](img/vista.png) y ![b](img/vista.png) después", `antes ![a](${url(A)}) y ![b](${url(A)}) después`],
    // El svg no es «imagen» para el portal: sale como enlace normal, igual que al adjuntarlo a mano.
    ["![Logo](../logo.svg)", `[Logo](${url(C)})`],
    ["![](../logo.svg)", enlaceArchivo({ proyecto: "uuv", id: C, nombre: "logo.svg", imagen: false })],
  ];
  for (const [entra, sale] of casos) assert.equal(reescribirMd(entra, ctx()), sale, entra);
});

test("reescribirMd: no toca imágenes sin subir, externas, fuera de la raíz, HTML ni nada dentro de código", () => {
  const { reescribirMd } = L();
  const intactos = [
    "![a](img/no-subida.png)",
    "![a](https://evil.example/vista.png)",
    "![a](data:image/png;base64,AAAA)",
    "![a](../../docs/img/vista.png)",
    "![a](/docs/img/vista.png)",
    `![a](${url(A)})`,
    '<img src="img/vista.png" onerror="alert(1)">',
    "`![a](img/vista.png)`",
    "```\n![a](img/vista.png)\n[p](../potencia.md)\n```",
    "~~~md\n![a](img/vista.png)\n~~~",
    "texto sin enlaces\n\n- lista\n\n| a | b |\n|---|---|\n",
  ];
  for (const md of intactos) assert.equal(reescribirMd(md, ctx()), md, md);
  const sinSubidas = { ...ctx(), subidas: new Map() };
  assert.equal(reescribirMd("![a](img/vista.png)", sinSubidas), "![a](img/vista.png)", "imagen que falló al subir: la referencia queda como estaba");
});

test("reescribirMd: los enlaces a otros .md del lote van a la URL de su página (sin ancla); los demás no se tocan", async () => {
  const { reescribirMd } = L();
  const { urlPagina, esEnlaceDeLaDisciplina } = await import("../src/lib/hardware-editor.ts");
  const destino = urlPagina("uuv", "electronica", "potencia-2");
  assert.equal(destino, "/uuv/electronica/?p=potencia-2");
  const casos = [
    ["[potencia](../potencia.md)", `[potencia](${destino})`],
    ["[p](../potencia.md#baterias)", `[p](${destino})`],
    ["[yo](./guia.md)", "[yo](/uuv/electronica/?p=guia)"],
    ["[yo](guia.md)", "[yo](/uuv/electronica/?p=guia)"],
    ["[o](otra%20pagina.md)", "[o](/uuv/electronica/?p=otra-pagina)"],
    ["[o](<otra pagina.md>)", "[o](/uuv/electronica/?p=otra-pagina)"],
    ["ver [a](../potencia.md) y [b](guia.md).", `ver [a](${destino}) y [b](/uuv/electronica/?p=guia).`],
  ];
  for (const [entra, sale] of casos) assert.equal(reescribirMd(entra, ctx()), sale, entra);
  assert.ok(esEnlaceDeLaDisciplina(destino, "https://docs.example/uuv/electronica/?p=guia", "uuv", "electronica"), "el enlace reescrito navega dentro de la disciplina");
  const intactos = ["[x](falta.md)", "[x](potencia.md)", "[x](../../potencia.md)", "[x](https://example.com/potencia.md)", "[x](mailto:a@b.c)", "[x](#seccion)", "[x](../potencia.pdf)", "`[x](../potencia.md)`", "[x](/potencia.md)"];
  for (const md of intactos) assert.equal(reescribirMd(md, ctx()), md, md);
});

test("reescribirMd: un documento completo solo cambia en los puntos reescritos", () => {
  const { reescribirMd } = L();
  const md = "# Guía\n\nTexto con `código` y <b>HTML</b>.\n\n![Vista](img/vista.png)\n\n```sh\n# ![no](img/vista.png)\n```\n\nVer [potencia](../potencia.md).\n\n<script>alert(1)</script>\n";
  const esperado = `# Guía\n\nTexto con \`código\` y <b>HTML</b>.\n\n![Vista](${url(A)})\n\n\`\`\`sh\n# ![no](img/vista.png)\n\`\`\`\n\nVer [potencia](/uuv/electronica/?p=potencia-2).\n\n<script>alert(1)</script>\n`;
  assert.equal(reescribirMd(md, ctx()), esperado);
});

// ---------- resumen de la revisión ----------

test("minutosEstimados: 10 escrituras por minuto; las 10 primeras no esperan", () => {
  const { minutosEstimados } = L();
  assert.deepEqual([0, 1, 10, 11, 20, 21, 29, 100].map(minutosEstimados), [0, 0, 0, 1, 1, 2, 2, 9]);
});

test("textoResumen: páginas e imágenes en singular o plural; el tiempo solo si la espera pasa de 1 min", () => {
  const { textoResumen, escrituras } = L();
  const plan = (p, i) => ({ paginas: Array.from({ length: p }, () => ({})), imagenes: Array.from({ length: i }, () => ({})), avisos: [] });
  assert.equal(escrituras(plan(12, 5)), 29, "2 por página y 1 por imagen");
  assert.equal(textoResumen(plan(12, 5)), "Se crearán 12 páginas y se subirán 5 imágenes. Tardará unos 2 min por el límite de escrituras.");
  assert.equal(textoResumen(plan(1, 1)), "Se creará 1 página y se subirá 1 imagen.");
  assert.equal(textoResumen(plan(3, 0)), "Se crearán 3 páginas.");
  assert.equal(textoResumen(plan(5, 1)), "Se crearán 5 páginas y se subirá 1 imagen.", "11 escrituras: una sola espera, no se anuncia");
  assert.equal(textoResumen(plan(50, 0)), "Se crearán 50 páginas. Tardará unos 9 min por el límite de escrituras.");
  assert.equal(textoResumen(plan(0, 0)), "No hay ninguna página para importar.");
});
