// Lote "auditoría de seguridad" (deepsec + cubic + CodeRabbit): rutas con doble codificación, symlinks en la wiki,
// code spans al estilo CommonMark, token solo en push, URL del glosario validada y Markdown exportado escapado.
// La resolución de hilos por cualquier usuario (decisión del equipo) se fija en comentarios-api.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
// Sobre el código fuente: mensajes cortos (assert.match volcaría el archivo entero en el error).
const tiene = (src, re, msg) => assert.ok(re.test(src), msg ?? `falta en el código: ${re}`);
const noTiene = (src, re, msg) => assert.ok(!re.test(src), msg ?? `sobra en el código: ${re}`);
// Import dinámico: si el módulo o la función no existen, falla cada prueba por eso y no todo el archivo.
const modulo = (p) => import(p).catch(() => ({}));
const fn = (mod, name, archivo) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta ${archivo} → ${name}`);
  return mod[name](...args);
};

// ---------- 1a. canAccess: decodificación repetida, fail-closed y ".." ----------
const acceso = () => import("../access.config.js");

test("canAccess: la doble codificación (%252e%252e) no esquiva la restricción", async () => {
  const { canAccess } = await acceso();
  for (const login of ["otro", null]) {
    assert.equal(canAccess(login, "/%252e%252e/proyecto-x/"), false, `${login} %252e%252e`);
    assert.equal(canAccess(login, "/%252fproyecto-x/"), false, `${login} %252f`);
    assert.equal(canAccess(login, "/%255cproyecto-x/"), false, `${login} %255c`);
    assert.equal(canAccess(login, "/proyecto%252dx/"), false, `${login} %252d`);
  }
});

test("canAccess: '..' en cualquier segmento (literal o codificado) se deniega a todos, también al autorizado", async () => {
  const { canAccess } = await acceso();
  for (const login of ["otro", null, "cyuxSz"]) {
    for (const path of ["/uuv/%2e%2e/proyecto-x/", "/uuv/%2E%2E/proyecto-x/", "/%252e%252e/proyecto-x/", "/a/../proyecto-x/", "/uuv/../uuv/", "/uuv/x/%2e%2e%2fproyecto-x/"]) {
      assert.equal(canAccess(login, path), false, `${login} ${path}`);
    }
  }
});

test("canAccess: un escape mal formado deniega siempre (fail-closed), en cualquier ronda de decodificación", async () => {
  const { canAccess } = await acceso();
  for (const login of ["otro", null, "cyuxSz"]) {
    for (const path of ["/%ZZ/proyecto-x/", "/uuv/%E0%A4%A/", "/uuv/%/", "/uuv/%25ZZ/"]) {
      assert.doesNotThrow(() => canAccess(login, path), path);
      assert.equal(canAccess(login, path), false, `${login} ${path}`);
    }
  }
});

test("canAccess: si la ruta no se estabiliza tras 5 decodificaciones, se deniega", async () => {
  const { canAccess } = await acceso();
  let capas = "%41"; // "A"
  for (let i = 0; i < 10; i++) capas = capas.replace(/%/g, "%25");
  assert.equal(canAccess("otro", `/uuv/${capas}/`), false, "10 capas");
  assert.equal(canAccess("otro", "/uuv/%2541/"), true, "2 capas se decodifican y la ruta es legítima");
});

test("canAccess: rutas legítimas siguen igual (acentos, %2d, mayúsculas, '.')", async () => {
  const { canAccess } = await acceso();
  for (const path of ["/uuv/gu%C3%ADa/", "/uuv/guía/", "/uuv/visi%C3%B3n/c%C3%A1mara/", "/", "/uuv/", "/proyecto-x-bis/"]) {
    assert.equal(canAccess("otro", path), true, path);
  }
  assert.equal(canAccess("otro", "/proyecto%2dx/"), false);
  assert.equal(canAccess(null, "/proyecto%2dx/"), false);
  assert.equal(canAccess("cyuxSz", "/proyecto%2dx/"), true);
  assert.equal(canAccess("cyuxSz", "/proyecto-x/visi%C3%B3n/"), true);
  assert.equal(canAccess("cyuxSz", "/./proyecto-x/"), true);
});

// ---------- 1b. rutaValida (src/lib/personal.ts) vía guardarVisita / ultimaVisita / favoritos ----------
const { almacenSeguro } = await import("../src/lib/rutas.ts");
const personal = await import("../src/lib/personal.ts");
const memoria = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const almacen = () => {
  const ls = memoria();
  return { ls, a: almacenSeguro(() => ls) };
};
const aceptada = (p, route) => {
  const { a } = almacen();
  personal.guardarVisita(a, p, { route, title: "T", scroll: 0.5 });
  return personal.ultimaVisita(a, p)?.route === route;
};

test("rutaValida: rechaza '..' codificado una o varias veces, %2f%2f y %5c tras decodificar", () => {
  for (const route of ["/uuv/%2e%2e/proyecto-x/", "/uuv/%252e%252e/proyecto-x/", "/uuv/%2E%2E/x/", "/uuv/../x/", "/uuv/%2f%2fevil.example/", "/uuv/%5cevil/", "/uuv/%255cevil/", "/uuv/a%00b/"]) {
    assert.equal(aceptada("uuv", route), false, route);
  }
});

test("rutaValida: escape mal formado o sin estabilizar en 5 rondas → rechazada", () => {
  let capas = "%41";
  for (let i = 0; i < 10; i++) capas = capas.replace(/%/g, "%25");
  for (const route of ["/uuv/%ZZ/", "/uuv/%E0%A4%A/", "/uuv/%25ZZ/", `/uuv/${capas}/`]) assert.equal(aceptada("uuv", route), false, route);
});

test("rutaValida: lo almacenado también se valida al leer (ultimaVisita y favoritos)", () => {
  const { ls, a } = almacen();
  ls.setItem(personal.claveUltima("uuv"), JSON.stringify({ route: "/uuv/%2e%2e/proyecto-x/", title: "x", scroll: 0 }));
  assert.equal(personal.ultimaVisita(a, "uuv"), null);
  ls.setItem(personal.claveFavoritos("uuv"), JSON.stringify([{ route: "/uuv/%252e%252e/x/", title: "x" }, { route: "/uuv/ok/", title: "ok" }]));
  assert.deepEqual(personal.favoritos(a, "uuv").map((f) => f.route), ["/uuv/ok/"]);
});

test("rutaValida: rutas legítimas con acentos (crudos o codificados) y %2d se aceptan", () => {
  for (const route of ["/uuv/guía/", "/uuv/gu%C3%ADa/", "/uuv/visi%C3%B3n/c%C3%A1mara/", "/uuv/proyecto%2dx/", "/uuv/a/b/"]) {
    assert.equal(aceptada("uuv", route), true, route);
  }
  assert.equal(aceptada("proyecto-x", "/proyecto-x/visi%C3%B3n/"), true);
});

// ---------- 2. tools/archivos.mjs: walk sin symlinks y lectura confinada a la raíz del checkout ----------
const archivos = await modulo("../tools/archivos.mjs");
const walk = fn(archivos, "walk", "tools/archivos.mjs");
const leerDentro = fn(archivos, "leerDentro", "tools/archivos.mjs");

function checkout() {
  const raiz = mkdtempSync(join(tmpdir(), "walk-"));
  mkdirSync(join(raiz, ".git"));
  writeFileSync(join(raiz, ".git", "config"), "url = https://x-access-token:ghp_SECRETO@github.com/o/r.git\n");
  mkdirSync(join(raiz, "openwiki", "sub"), { recursive: true });
  writeFileSync(join(raiz, "openwiki", "a.md"), "# A\n");
  writeFileSync(join(raiz, "openwiki", "sub", "b.md"), "# B\n");
  return raiz;
}
const nombres = (raiz, l) => l.map((p) => p.slice(raiz.length + 1).split(/[\\/]/).join("/")).sort();

test("walk: lista los archivos normales de la wiki (recursivo)", () => {
  const raiz = checkout();
  try {
    assert.deepEqual(nombres(raiz, walk(join(raiz, "openwiki"), raiz)), ["openwiki/a.md", "openwiki/sub/b.md"]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("walk/leerDentro: un archivo fuera de la raíz del checkout no se lista ni se lee (comprobación con realpath)", () => {
  const raiz = checkout();
  try {
    // Con la raíz en openwiki/sub, openwiki/a.md queda fuera: solo sub/b.md puede aparecer.
    assert.deepEqual(nombres(raiz, walk(join(raiz, "openwiki"), join(raiz, "openwiki", "sub"))), ["openwiki/sub/b.md"]);
    assert.equal(leerDentro(join(raiz, "openwiki"), join(raiz, ".git", "config")), null, "fuera de la raíz → null");
    assert.equal(leerDentro(raiz, join(raiz, "openwiki", "a.md")), "# A\n");
    assert.equal(leerDentro(raiz, join(raiz, "openwiki", "no-existe.md")), null);
    assert.equal(leerDentro(raiz, join(raiz, "openwiki", "sub")), null, "un directorio no se lee");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

// Crea el enlace o se salta la prueba si el sistema no lo permite (Windows sin modo desarrollador para archivos).
function enlazar(t, destino, enlace, tipo) {
  try {
    symlinkSync(destino, enlace, tipo);
    return true;
  } catch (err) {
    if (err && (err.code === "EPERM" || err.code === "EACCES")) {
      t.skip(`el sistema no deja crear symlinks de tipo ${tipo} (${err.code})`);
      return false;
    }
    throw err;
  }
}

test("walk/leerDentro: ignoran un symlink de archivo que apunta a .git/config", (t) => {
  const raiz = checkout();
  try {
    if (!enlazar(t, join(raiz, ".git", "config"), join(raiz, "openwiki", "token.md"), "file")) return;
    assert.deepEqual(nombres(raiz, walk(join(raiz, "openwiki"), raiz)), ["openwiki/a.md", "openwiki/sub/b.md"], "sin token.md");
    assert.equal(leerDentro(raiz, join(raiz, "openwiki", "token.md")), null, "un symlink no se lee aunque apunte dentro del checkout");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("walk: no entra en un directorio enlazado (symlink/junction a .git)", (t) => {
  const raiz = checkout();
  try {
    if (!enlazar(t, join(raiz, ".git"), join(raiz, "openwiki", "git"), "junction")) return;
    assert.deepEqual(nombres(raiz, walk(join(raiz, "openwiki"), raiz)), ["openwiki/a.md", "openwiki/sub/b.md"], "sin git/config");
    assert.equal(leerDentro(raiz, join(raiz, "openwiki", "git", "config")), null, "un archivo bajo un directorio enlazado no se lee");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("fetch.mjs: usa walk y leerDentro de tools/archivos.mjs; no lee el checkout con readFileSync/statSync/cpSync directos", () => {
  const src = read("tools/fetch.mjs");
  tiene(src, /import\s*\{[^}]*\bwalk\b[^}]*\}\s*from\s*"\.\/archivos\.mjs"/);
  tiene(src, /import\s*\{[^}]*\bleerDentro\b[^}]*\}\s*from\s*"\.\/archivos\.mjs"/);
  noTiene(src, /function walk\(/, "walk ya no se define en fetch.mjs");
  noTiene(src, /\bstatSync\(/);
  noTiene(src, /\bcpSync\(/, "los HTML de Archify se escriben desde lo leído con leerDentro");
  const lecturas = src.match(/readFileSync\([^\n]*/g) ?? [];
  assert.deepEqual(lecturas.filter((l) => !l.startsWith('readFileSync(join(ROOT, "projects.json")')), [], "solo projects.json del propio portal se lee directo");
});

// ---------- 3. tools/neutralizar.mjs: code spans al estilo CommonMark ----------
const neutralizar = await modulo("../tools/neutralizar.mjs");
const neutralizeHtml = fn(neutralizar, "neutralizeHtml", "tools/neutralizar.mjs");
const statusBadges = fn(neutralizar, "statusBadges", "tools/neutralizar.mjs");

test("neutralizeHtml: una apertura de dos backticks no se cierra con uno (caso de la auditoría)", () => {
  const out = neutralizeHtml('``<img src="/auth/logout/">`');
  assert.ok(out.includes('&lt;img src="/auth/logout/">'), out);
  assert.ok(!/<img/.test(out), out);
});

test("neutralizeHtml: un backtick escapado con \\ no abre code span", () => {
  const out = neutralizeHtml("\\`<img src=x>`");
  assert.ok(out.includes("&lt;img src=x>"), out);
});

test("neutralizeHtml: un code span que cruza líneas del mismo párrafo se empareja como CommonMark", () => {
  const out = neutralizeHtml("texto `x\ny` <img src=x> `z`");
  assert.ok(out.includes("&lt;img src=x>"), out);
});

test("neutralizeHtml: no empareja backticks entre bloques distintos (encabezado, párrafos, celdas de tabla)", () => {
  for (const md of ["# a`\nb` <img src=x>", "a`\n\nb` <img src=x>", "- a`\n- b` <img src=x>", "| `a | b` <img src=x> |"]) {
    const out = neutralizeHtml(md);
    assert.ok(out.includes("&lt;img src=x>"), JSON.stringify(md) + " → " + out);
  }
});

test("neutralizeHtml: el código legítimo no se toca (spans de igual longitud y bloques ```)", () => {
  for (const md of ["`vector<int>`", "``a ` <b>``", "`` `<b>` ``", "```\n<script>x</script>\n```", "~~~\n<b>\n~~~"]) {
    assert.equal(neutralizeHtml(md), md, md);
  }
  assert.equal(neutralizeHtml("<b> `x` <i>"), "&lt;b> `x` &lt;i>");
  assert.equal(neutralizeHtml("a < b y `<c>`"), "a < b y `<c>`");
});

test("statusBadges: sigue sin tocar emojis dentro de código y sí fuera", () => {
  assert.equal(statusBadges("`✅`"), "`✅`");
  assert.match(statusBadges("✅ ok"), /class="st st-en_uso"/);
  assert.match(statusBadges("``✅`"), /class="st st-en_uso"/, "sin cierre de igual longitud no es código");
});

test("fetch.mjs: importa neutralizeHtml y statusBadges de tools/neutralizar.mjs y ya no define outsideCode", () => {
  const src = read("tools/fetch.mjs");
  tiene(src, /import\s*\{[^}]*\bneutralizeHtml\b[^}]*\bstatusBadges\b[^}]*\}\s*from\s*"\.\/neutralizar\.mjs"|import\s*\{[^}]*\bstatusBadges\b[^}]*\bneutralizeHtml\b[^}]*\}\s*from\s*"\.\/neutralizar\.mjs"/);
  noTiene(src, /function outsideCode\(/);
});

// ---------- 4. CI: DOCS_GITHUB_TOKEN solo en push ----------
test("build.yml: DOCS_GITHUB_TOKEN solo se pasa en eventos push (nunca en pull_request)", () => {
  const yml = read(".github/workflows/build.yml");
  assert.match(yml, /^\s*DOCS_GITHUB_TOKEN: \$\{\{ github\.event_name == 'push' && secrets\.DOCS_GITHUB_TOKEN \|\| '' \}\}\s*$/m);
  assert.equal((yml.match(/secrets\.DOCS_GITHUB_TOKEN/g) ?? []).length, 1, "ningún otro uso del secret");
});

// ---------- 5. Glosario: URL validada antes de link.href ----------
const lectura = await modulo("../src/lib/lectura.ts");
const enlaceGlosario = fn(lectura, "enlaceGlosario", "src/lib/lectura.ts");

test("enlaceGlosario: acepta http(s) y rutas que empiezan por / (no //, no /\\)", () => {
  for (const u of ["/uuv/glosario/", "/uuv/glosario/#asmc", "https://docs.example/uuv/glosario/", "http://localhost:4321/uuv/glosario/"]) {
    assert.equal(enlaceGlosario(u), u, u);
  }
});

test("enlaceGlosario: rechaza javascript:, data:, protocolo relativo, barras invertidas, relativas sin / y basura", () => {
  for (const u of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)", "data:text/html,<script>x</script>", "vbscript:x", "//evil.example/", "/\\evil.example/", "glosario/", "", "   ", "/uuv/\nx", "https://", null, undefined, 42, {}]) {
    assert.equal(enlaceGlosario(u), null, JSON.stringify(u) ?? String(u));
  }
});

test("prose.ts: el enlace 'Ver glosario' usa enlaceGlosario(data-glosario), no el atributo crudo", () => {
  const src = read("src/scripts/prose.ts");
  tiene(src, /import\s*\{[^}]*\benlaceGlosario\b[^}]*\}\s*from\s*"\.\.\/lib\/lectura\.ts"/);
  tiene(src, /const glosarioUrl = enlaceGlosario\(\s*prose\?\.dataset\.glosario\s*\)/);
  noTiene(src, /=\s*prose\?\.dataset\.glosario\s*;/, "sin asignaciones del atributo sin validar");
});

// ---------- 6. Limpieza: el Markdown exportado escapa la sintaxis de enlaces ----------
const limpieza = await modulo("../src/lib/limpieza.ts");
const filasLimpieza = fn(limpieza, "filasLimpieza", "src/lib/limpieza.ts");
const limpiezaMarkdown = fn(limpieza, "limpiezaMarkdown", "src/lib/limpieza.ts");
const REPO = "https://github.com/o/r";
const SHA = "abc123";
const nodo = (id, extra = {}) => ({ id, label: id.split("/").pop(), category: "ros2_node", package: id.split("/")[0], layer: "control", status: "sin_uso", file: `src/${id}.cpp`, line: 10, configs: [], launches: [], ...extra });
const EVIL = "src/a](https://evil.example)";

test("limpiezaMarkdown: una ruta con '](' no crea un enlace (texto del enlace escapado)", () => {
  const md = limpiezaMarkdown("X", filasLimpieza({ nodes: [nodo("p/a", { file: EVIL })] }, REPO, SHA), new Set());
  assert.ok(md.includes("[src/a\\]\\(https://evil.example\\)]("), md);
});

test("limpiezaMarkdown: los paréntesis del destino del enlace van como %28/%29", () => {
  const md = limpiezaMarkdown("X", filasLimpieza({ nodes: [nodo("p/a", { file: EVIL })] }, REPO, SHA), new Set());
  assert.ok(md.includes("(https://github.com/o/r/blob/abc123/src/a%5D%28https%3A//evil.example%29#L10)"), md);
});

test("limpiezaMarkdown: sin URL, la ruta en texto plano también se escapa ([ ] ( ) \\ `)", () => {
  const md = limpiezaMarkdown("X", filasLimpieza({ nodes: [nodo("p/a", { file: EVIL })] }, "no-es-github", SHA), new Set());
  assert.ok(md.includes("src/a\\]\\(https://evil.example\\)"), md);
  assert.doesNotMatch(md, /(?<!\\)\]\(https:\/\/evil/);
  const md2 = limpiezaMarkdown("X", filasLimpieza({ nodes: [nodo("p/a", { file: "src/[x]\\y`z.cpp" })] }, "no-es-github", SHA), new Set());
  assert.ok(md2.includes("src/\\[x\\]\\\\y\\`z.cpp"), md2);
});

test("limpiezaMarkdown: nombre del proyecto y configs a retirar también se escapan", () => {
  const ros = {
    configs: [{ id: "c", label: "[clic](https://evil.example)", launch: "x.launch.py", legado: true }],
    launches: [],
    nodes: [nodo("p/a", { status: "legado", configs: ["c"] })],
  };
  const md = limpiezaMarkdown("uuv](https://evil.example)", filasLimpieza(ros, REPO, SHA), new Set());
  assert.match(md, /^# Limpieza del repo · uuv\\\]\\\(https:\/\/evil\.example\\\)$/m);
  assert.ok(md.includes("\\[clic\\]\\(https://evil.example\\)"), md);
  assert.doesNotMatch(md, /(?<!\\)\[clic\]/);
});

test("limpiezaMarkdown: paquete/ejecutable y launches siguen en código en línea (sin barras invertidas visibles)", () => {
  const md = limpiezaMarkdown("X", filasLimpieza({ nodes: [nodo("ctl/pid_node")] }, REPO, SHA), new Set());
  assert.ok(md.includes("`ctl/pid_node`"), md);
  assert.ok(!md.includes("`ctl/pid\\_node`"));
});

// ---------- Correcciones de revisión ----------
test("neutralizeHtml: un code span no se empareja a través de un thematic break ni de un inicio de HTML", () => {
  for (const md of ["a `x\n---\n<img src=x>`", "a `x\n***\n<img src=x>`", "a `x\n_ _ _\nw <img src=x> y`", "a `x\n- - -\n<img src=x>`","a `x\n<div>\ny` <img src=x>"]) {
    const out = neutralizeHtml(md);
    assert.ok(!/<img/.test(out), md + " => " + out);
  }
});

test("walk: un directorio inexistente da [] (repo sin openwiki/ o docs/arch/)", () => {
  const raiz = mkdtempSync(join(tmpdir(), "walk-"));
  try {
    assert.deepEqual(walk(join(raiz, "openwiki"), raiz), []);
    assert.deepEqual(walk(join(raiz, "no", "existe")), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("limpiezaMarkdown: el texto exportado escapa < y >", () => {
  const md = limpiezaMarkdown("X", filasLimpieza({ nodes: [nodo("p/a", { file: "src/<img src=x>.cpp" })] }, "", SHA), new Set());
  assert.ok(md.includes("\\<img src=x\\>"), md);
});
