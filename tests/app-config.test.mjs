// Lote app-cascara: comprobaciones estáticas de la app de escritorio (carpeta app/).
// Lo que hace el proxy se prueba en Rust (app/nucleo/tests). Aquí va lo que se decide en la
// configuración: superficie de IPC nula (criterio 7), la parte fija de la ventana (6), el
// arranque sin variables en release (1), nada de disco ni consola en el núcleo (5), los restos
// del prototipo y el workflow de CI (8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const ruta = (p) => join(RAIZ, p);
const existe = (p) => existsSync(ruta(p));
const leer = (p) => {
  assert.ok(existe(p), `falta ${p}`);
  return readFileSync(ruta(p), "utf8");
};
const json = (p) => JSON.parse(leer(p));

const CONF = "app/src-tauri/tauri.conf.json";
const CARGO_APP = "app/src-tauri/Cargo.toml";
const CARGO_NUCLEO = "app/nucleo/Cargo.toml";
const MAIN = "app/src-tauri/src/main.rs";
const WORKFLOW = ".github/workflows/app.yml";

// Archivos de app/ escritos a mano: sin dependencias, sin salidas de build y sin binarios.
const IGNORADAS = new Set(["node_modules", "target", "gen", "icons"]);
function archivosDeApp(dir = "app") {
  const salida = [];
  for (const nombre of readdirSync(ruta(dir))) {
    if (IGNORADAS.has(nombre)) continue;
    const p = `${dir}/${nombre}`;
    if (statSync(ruta(p)).isDirectory()) salida.push(...archivosDeApp(p));
    else if (!/(^|\/)(Cargo\.lock|package-lock\.json)$/.test(p)) salida.push(p);
  }
  return salida;
}
const fuentesRust = (dir) => (existe(dir) ? archivosDeApp(dir).filter((p) => p.endsWith(".rs")) : []);
// Sin comentarios, para que una explicación no cuente como uso.
const sinComentarios = (rs) => rs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// Tablas `[seccion]` de un Cargo.toml sencillo → { seccion: { clave: "valor en crudo" } }.
function toml(texto) {
  const tablas = {};
  let actual = (tablas[""] = {});
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith("#")) continue;
    const seccion = linea.match(/^\[([^\]]+)\]$/);
    if (seccion) {
      actual = tablas[seccion[1].trim()] ??= {};
      continue;
    }
    const par = linea.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (par) actual[par[1]] = par[2];
  }
  return tablas;
}
const version = (crudo) => crudo.match(/^"([^"]+)"/)?.[1] ?? crudo.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? null;
const paquetes = (lock) =>
  [...lock.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);

// ---------- Criterio 7: superficie de IPC nula ----------

test("c7 · tauri.conf.json: identidad de la app, sin __TAURI__ global y con CSP", () => {
  const conf = json(CONF);
  assert.equal(conf.productName, "VantTec Docs");
  assert.equal(conf.identifier, "dev.vanttec.docs");
  assert.notEqual(conf.app?.withGlobalTauri, true, "withGlobalTauri debe ser falso");
  const csp = conf.app?.security?.csp;
  assert.equal(typeof csp, "string", "app.security.csp no puede ser null ni faltar");
  assert.match(csp, /default-src 'none'/, "la CSP de los assets de tauri:// no carga nada");
  assert.doesNotMatch(csp, /unsafe-eval|\*/, "la CSP no abre eval ni comodines");
  assert.notEqual(conf.app?.security?.dangerousDisableAssetCspModification, true);
  assert.notEqual(conf.app?.security?.assetProtocol?.enable, true, "sin protocolo asset://");
  assert.deepEqual(conf.app?.security?.capabilities ?? [], [], "sin capacidades en la configuración");
  assert.deepEqual(conf.plugins ?? {}, {}, "sin plugins configurados");
  assert.doesNotMatch(JSON.stringify(conf), /deep-link|vanttec-docs:|prototipo/i);
});

test("c7 · sin permisos en capabilities/ ni en ningún otro archivo de permisos", () => {
  leer(CONF); // La comprobación solo vale si la app existe.
  const dir = "app/src-tauri/capabilities";
  const archivos = existe(dir) ? readdirSync(ruta(dir)) : [];
  for (const nombre of archivos) {
    assert.match(nombre, /\.json$/, `${dir}/${nombre}: solo se admite JSON, para poder comprobarlo`);
    const capacidad = json(`${dir}/${nombre}`);
    assert.deepEqual(capacidad.permissions ?? [], [], `${dir}/${nombre} concede permisos`);
    assert.equal(capacidad.remote, undefined, `${dir}/${nombre} abre el IPC a un origen remoto`);
  }
  assert.ok(!existe("app/src-tauri/permissions"), "sin permisos propios en app/src-tauri/permissions");
});

test("c7 · Cargo.toml de la app: sin devtools, sin plugins y con versiones fijadas", () => {
  const cargo = toml(leer(CARGO_APP));
  assert.match(cargo.package?.name ?? "", /^"vanttec-docs"$/, "el paquete se llama vanttec-docs");
  const deps = cargo.dependencies ?? {};
  assert.ok(deps.tauri, "depende de tauri");
  assert.doesNotMatch(deps.tauri, /devtools/, "tauri sin la feature devtools");
  const features = deps.tauri.match(/features\s*=\s*\[([^\]]*)\]/)?.[1].trim() ?? "";
  assert.equal(features, "", `tauri sin features opcionales (tiene: ${features})`);
  assert.match(deps.nucleo ?? "", /path\s*=\s*"\.\.\/nucleo"/, "usa el crate nucleo por ruta");
  for (const tabla of ["dependencies", "build-dependencies"]) {
    for (const [nombre, crudo] of Object.entries(cargo[tabla] ?? {})) {
      assert.doesNotMatch(nombre, /^tauri-plugin-/, `sin plugins de Tauri en este lote (${nombre})`);
      assert.notEqual(nombre, "sha2", "sha2 era del prototipo");
      if (/path\s*=/.test(crudo)) continue;
      assert.match(version(crudo) ?? "", /^=\d+\.\d+\.\d+$/, `${tabla}.${nombre} debe fijar la versión exacta (=x.y.z)`);
    }
  }
  assert.equal(cargo.features, undefined, "sin features propias que puedan cambiar el destino o abrir devtools");
});

test("c7 · main.rs no registra comandos ni plugins", () => {
  const rs = fuentesRust("app/src-tauri/src").map((p) => sinComentarios(leer(p))).join("\n");
  leer(MAIN);
  for (const [patron, por] of [
    [/invoke_handler/, "sin invoke_handler"],
    [/generate_handler/, "sin generate_handler"],
    [/tauri::command|#\[command\]/, "sin comandos"],
    [/\.plugin\s*\(/, "sin plugins"],
    [/\.manage\s*\(/, "sin estado gestionado expuesto a comandos"],
    [/add_capability|\.permission\s*\(/, "sin capacidades añadidas en tiempo de ejecución"],
    [/\.eval\s*\(|initialization_script/, "sin JavaScript inyectado en el portal"],
    [/open_devtools/, "sin devtools"],
  ]) {
    assert.doesNotMatch(rs, patron, por);
  }
});

// ---------- Criterio 6: la ventana (lo que se puede leer sin abrirla) ----------

test("c6 · main.rs crea la ventana `main` sobre el protocolo propio, con zoom y navegación limitada", () => {
  const rs = sinComentarios(leer(MAIN));
  assert.deepEqual(json(CONF).app?.windows ?? [], [], "la ventana se crea en Rust (on_navigation no existe en la configuración)");
  assert.match(rs, /register_asynchronous_uri_scheme_protocol\s*\(\s*(nucleo::)?ESQUEMA\b/, "el protocolo se registra con nucleo::ESQUEMA");
  assert.match(rs, /WebviewWindowBuilder::new\s*\([^;]*?"main"/, "la ventana tiene la etiqueta main");
  assert.match(rs, /WebviewUrl::CustomProtocol/, "la ventana carga el protocolo propio");
  assert.doesNotMatch(rs, /WebviewUrl::(External|App)/, "nunca carga el sitio remoto ni assets de tauri://");
  assert.match(rs, /\.use_https_scheme\s*\(\s*true\s*\)/, "useHttpsScheme: true");
  assert.match(rs, /\.zoom_hotkeys_enabled\s*\(\s*true\s*\)/, "zoom_hotkeys_enabled(true): pellizco del touchpad");
  assert.match(rs, /\.on_navigation\s*\(/, "falta on_navigation");
  assert.match(rs, /navegacion_permitida\s*\(/, "on_navigation decide con nucleo::navegacion_permitida");
  assert.equal((rs.match(/WebviewWindowBuilder::new/g) ?? []).length, 1, "una sola ventana");
  assert.doesNotMatch(rs, /WebviewBuilder::new|add_child/, "sin ventanas ni webviews extra");
});

// Guarda estática: demuestra que la llamada está escrita, no que WebView2 la respete. Que
// `window.open` y `target=_blank` no abren nada se comprueba con la ventana abierta.
test("c6 · main.rs deniega toda ventana nueva con on_new_window", () => {
  const rs = sinComentarios(leer(MAIN));
  assert.equal((rs.match(/\.on_new_window\s*\(/g) ?? []).length, 1, "falta on_new_window en la ventana main");
  assert.match(rs, /NewWindowResponse::Deny\b/, "on_new_window responde NewWindowResponse::Deny");
  const todo = fuentesRust("app/src-tauri/src").map((p) => sinComentarios(leer(p))).join("\n");
  assert.doesNotMatch(todo, /NewWindowResponse::(Allow|Create)\b/, "ninguna ventana nueva se permite ni se crea");
  assert.doesNotMatch(todo, /NewWindowResponse::(\*|\{)/, "las variantes se escriben completas, para poder leerlas aquí");
});

// Guarda estática de la tercera vuelta. La decisión (navegar la ventana principal o negar) es
// una función pura de `nucleo`, probada en app/nucleo/tests/firmas.rs; aquí solo se comprueba
// que main.rs la usa y que lo único que hace con ella es navegar la ventana `main`.
test("c6 · main.rs decide las ventanas nuevas con nucleo::decidir_ventana_nueva y solo navega la ventana main", () => {
  const rs = sinComentarios(leer(MAIN));
  const todo = fuentesRust("app/src-tauri/src").map((p) => sinComentarios(leer(p))).join("\n");
  const inicio = rs.search(/\.on_new_window\s*\(/);
  assert.ok(inicio >= 0, "falta on_new_window");
  const fin = rs.indexOf(".build()", inicio);
  assert.ok(fin > inicio, "on_new_window va en el WebviewWindowBuilder, antes de .build()");
  const cierre = rs.slice(inicio, fin);
  assert.match(cierre, /decidir_ventana_nueva\s*\(\s*\w+\.as_str\s*\(\s*\)\s*\)/, "on_new_window decide con nucleo::decidir_ventana_nueva(url.as_str())");
  assert.match(cierre, /VentanaNueva::NavegarPrincipal\b/, "solo se navega cuando la decisión es NavegarPrincipal");
  assert.match(cierre, /get_webview_window\s*\(\s*"main"\s*\)/, "la ventana que navega es la principal");
  assert.match(cierre, /\.navigate\s*\(/, "navega con WebviewWindow::navigate");
  assert.doesNotMatch(cierre, /navegacion_permitida/, "la regla vive en el núcleo, no se repite en el cierre");
  assert.equal((todo.match(/decidir_ventana_nueva\s*\(/g) ?? []).length, 1, "una sola llamada a decidir_ventana_nueva");
  assert.equal((todo.match(/\.navigate\s*\(/g) ?? []).length, 1, "la cáscara no navega en ningún otro sitio");
  assert.equal((todo.match(/get_webview_window\s*\(/g) ?? []).length, 1, "la cáscara no busca ventanas en ningún otro sitio");
  assert.doesNotMatch(todo, /\.load_url\s*\(|\.reload\s*\(|with_webview\s*\(|\.eval\w*\s*\(/, "sin otras formas de mover o tocar el webview");
  assert.doesNotMatch(todo, /tauri_plugin_|\bopen::that|Command::new|ShellExecute/, "abrir en el navegador del sistema es del lote A3");
  assert.match(rs, /NewWindowResponse::Deny\b/, "la respuesta a WebView2 sigue siendo Deny");
});

test("c6 · frontendDist es mínimo: existe, está dentro de app/ y no lleva JavaScript", () => {
  const conf = json(CONF);
  const dist = conf.build?.frontendDist;
  assert.equal(typeof dist, "string", "build.frontendDist es una ruta");
  assert.equal(conf.build?.devUrl, undefined, "sin devUrl");
  const abs = resolve(dirname(ruta(CONF)), dist);
  const rel = relative(ruta("app"), abs).replaceAll("\\", "/");
  assert.ok(rel && !rel.startsWith(".."), `frontendDist (${dist}) debe quedar dentro de app/`);
  assert.ok(existsSync(abs), `no existe ${dist}`);
  const archivos = readdirSync(abs, { recursive: true }).filter((n) => statSync(join(abs, n)).isFile());
  assert.ok(archivos.length <= 1, `frontendDist tiene ${archivos.length} archivos: ${archivos.join(", ")}`);
  for (const nombre of archivos) {
    assert.doesNotMatch(String(nombre), /\.(m?js|ts)$/, `${nombre}: sin JavaScript`);
    assert.doesNotMatch(readFileSync(join(abs, nombre), "utf8"), /<script|__TAURI|fetch\(/i, `${nombre}: sin scripts`);
  }
});

// ---------- Criterio 1: en release no hay variable que cambie el destino ----------

test("c1 · main.rs decide el arranque con nucleo::config_de_arranque(cfg!(debug_assertions), …)", () => {
  const fuentes = fuentesRust("app/src-tauri/src");
  const rs = sinComentarios(leer(MAIN));
  const todo = fuentes.map((p) => sinComentarios(leer(p))).join("\n");
  assert.match(rs, /config_de_arranque\s*\(\s*cfg!\s*\(\s*debug_assertions\s*\)\s*,/, "el primer argumento es cfg!(debug_assertions), sin intermediarios");
  assert.equal((todo.match(/config_de_arranque\s*\(/g) ?? []).length, 1, "una sola llamada a config_de_arranque");
  assert.doesNotMatch(todo, /Destino::(nuevo|produccion)|TokenFijo\s*\(\s*Some|Token::nuevo/, "el destino y el token salen solo de config_de_arranque");
  const variables = [...todo.matchAll(/\benv::var(?:_os)?\s*\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
  for (const v of variables) {
    assert.match(v, /^(nucleo::)?VAR_(DESTINO|TOKEN)_DEV$/, `variable de entorno no prevista: ${v}`);
  }
  assert.doesNotMatch(todo, /env::vars|option_env!|\benv!\s*\(/, "sin más lecturas del entorno");
  assert.doesNotMatch(todo, /std::env::args|env::args/, "sin argumentos de línea de comandos");
});

// ---------- Criterio 5: ni disco ni consola en el camino del token ----------

test("c5 · el núcleo no escribe en disco ni en la consola, y no pasa por proxies intermedios", () => {
  const nucleo = fuentesRust("app/nucleo/src");
  assert.ok(nucleo.length > 0, "falta app/nucleo/src");
  for (const p of nucleo) {
    const rs = sinComentarios(leer(p));
    assert.doesNotMatch(rs, /std::fs|\bfs::|OpenOptions|File::(create|open)/, `${p}: el núcleo no toca el disco`);
    assert.doesNotMatch(rs, /\b(e?println|e?print|dbg)!|\blog::|\btracing::/, `${p}: el núcleo no escribe en consola ni en logs`);
    assert.doesNotMatch(rs, /try_proxy_from_env\s*\(\s*true|\.proxy\s*\(/, `${p}: sin proxy HTTP intermedio`);
    assert.doesNotMatch(rs, /std::env|\benv::var/, `${p}: el núcleo no lee el entorno (lo recibe por argumento)`);
    assert.doesNotMatch(rs, /\bunsafe\s*(\{|fn\b|impl\b|trait\b|extern\b)/, `${p}: sin unsafe`);
  }
  const cargo = toml(leer(CARGO_NUCLEO));
  const ureq = cargo.dependencies?.ureq ?? "";
  assert.match(ureq, /default-features\s*=\s*false/, "ureq sin features por defecto");
  assert.doesNotMatch(ureq, /proxy-from-env|socks-proxy|cookies|native-tls|native-certs/, "ureq sin proxy del entorno, cookies ni TLS nativo");
  assert.doesNotMatch(Object.keys(cargo.dependencies ?? {}).join(" "), /\btauri|\bwry\b|\btao\b/, "el núcleo no depende de la ventana");
  for (const [nombre, crudo] of Object.entries(cargo.dependencies ?? {})) {
    assert.match(version(crudo) ?? "", /^=\d+\.\d+\.\d+$/, `nucleo: ${nombre} debe fijar la versión exacta`);
  }
});

test("c5 · la cáscara (src-tauri) tampoco escribe peticiones ni el token en disco o consola", () => {
  leer(MAIN);
  for (const p of fuentesRust("app/src-tauri/src")) {
    const rs = sinComentarios(leer(p));
    assert.doesNotMatch(rs, /std::fs|\bfs::|OpenOptions|File::(create|open)/, `${p}: sin escrituras a disco en este lote`);
    assert.doesNotMatch(rs, /\b(println|print|dbg)!|\blog::|\btracing::/, `${p}: sin trazas`);
    assert.doesNotMatch(rs, /\.exponer\s*\(/, `${p}: solo el núcleo lee el valor del token`);
  }
});

// ---------- Restos del prototipo ----------

test("no queda nada del prototipo en app/", () => {
  leer(MAIN);
  for (const resto of ["app/pruebas", "app/resultados", "app/src/index.html"]) {
    assert.ok(!existe(resto), `${resto} era del prototipo y no entra`);
  }
  const prohibidos = [
    /token-de-prueba/,
    /PROTO_[A-Z]+/,
    /\/api\/(eco|lento|informe)\b/,
    /sw\.js/,
    /x-desde-rust|x-reenviado-a/i,
  ];
  for (const p of archivosDeApp()) {
    const texto = leer(p);
    for (const patron of prohibidos) assert.doesNotMatch(texto, patron, `${p} conserva restos del prototipo`);
    if (!p.endsWith(".md")) assert.doesNotMatch(texto, /prototipo/i, `${p} menciona el prototipo`);
  }
  assert.doesNotMatch(leer("app/package.json"), /prototipo/i);
});

// ---------- Criterio 8: CI y builds reproducibles ----------

test("c8 · app.yml: solo corre con cambios en app/, sin secrets ni artefactos y con acciones fijadas", () => {
  const y = leer(WORKFLOW);
  const sinComentariosYaml = y.replace(/^\s*#.*$/gm, "");
  assert.doesNotMatch(y, /pull_request_target|workflow_run|secrets\.|upload-artifact|id-token|GITHUB_TOKEN/, "sin secrets, artefactos ni disparadores con privilegios");
  assert.match(sinComentariosYaml, /^permissions:\r?\n\s+contents: read\s*$/m, "permissions: contents: read");
  assert.equal((sinComentariosYaml.match(/^\s*[a-z-]+: (write|read-all|write-all)\s*$/gm) ?? []).length, 0, "ningún permiso de escritura");
  assert.match(sinComentariosYaml, /pull_request:\s*\r?\n\s+paths:/, "pull_request con filtro paths");
  assert.match(sinComentariosYaml, /push:\s*\r?\n\s+branches: \[main\]\s*\r?\n\s+paths:/, "push a main con filtro paths");
  const rutas = [...sinComentariosYaml.matchAll(/^\s+- ["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  assert.equal(rutas.filter((r) => r === "app/**").length, 2, "app/** en los dos disparadores");
  assert.equal(rutas.filter((r) => r === ".github/workflows/app.yml").length, 2, "el propio workflow en los dos disparadores");
  const usos = [...sinComentariosYaml.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(usos.length > 0, "usa al menos actions/checkout");
  for (const uso of usos) assert.match(uso, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `acción sin fijar por SHA: ${uso}`);
});

test("c8 · app.yml: tests del núcleo en Ubuntu y compilación de la app en Windows", () => {
  const y = leer(WORKFLOW).replace(/^\s*#.*$/gm, "");
  assert.match(y, /runs-on: ubuntu-latest/);
  assert.match(y, /runs-on: windows-latest/);
  assert.match(y, /cargo test --manifest-path app\/nucleo\/Cargo\.toml --locked/, "mismo comando que la factory");
  assert.match(y, /npm ci\b/, "npm ci en app/");
  assert.match(y, /tauri build\b.*--no-bundle|cargo build\b.*--locked/, "compila la app sin instalador");
  assert.doesNotMatch(y, /cargo install|curl |wget |rustup-init|npm install\b|npx (?!tauri\b)/, "sin instalar herramientas sin fijar");
  assert.doesNotMatch(y, /continue-on-error:\s*true/, "un fallo no se puede ignorar");
});

test("c8 · build.yml no cambia de responsabilidad: no sabe nada de la app", () => {
  const y = leer(".github/workflows/build.yml");
  assert.doesNotMatch(y, /cargo|tauri|app\//);
  assert.match(leer("package.json"), /"test": "node --test \\"tests\/\*\.test\.mjs\\""/, "npm test sigue igual");
});

test("c8 · la app fija sus dependencias: locks versionados y los mismos crates que se probaron", () => {
  const ignorados = leer("app/.gitignore");
  assert.match(ignorados, /^target\/?$|^\*\*\/target\/?$/m, "target/ ignorado en todo app/");
  assert.match(ignorados, /^node_modules\/?$/m);
  assert.doesNotMatch(ignorados, /\.lock|package-lock/, "los locks se versionan");

  const pkg = json("app/package.json");
  assert.equal(pkg.private, true);
  for (const [nombre, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `app/package.json: ${nombre} debe fijar la versión exacta (tiene ${v})`);
  }
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], "la app no tiene dependencias de JavaScript en tiempo de ejecución");
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}), ["@tauri-apps/cli"], "solo el CLI de Tauri");
  leer("app/package-lock.json");

  const nucleo = paquetes(leer("app/nucleo/Cargo.lock")).filter((p) => !p.startsWith("nucleo "));
  assert.ok(nucleo.some((p) => p.startsWith("ureq ")), "el lock del núcleo incluye ureq");
  const app = new Set(paquetes(leer("app/src-tauri/Cargo.lock")));
  const distintos = nucleo.filter((p) => !app.has(p));
  assert.deepEqual(distintos, [], "la app debe compilar el núcleo con las mismas versiones con las que se prueba");
});
