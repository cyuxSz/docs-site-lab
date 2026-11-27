// Lote app-login: comprobaciones estáticas del inicio de sesión de la app de escritorio (carpeta app/).
// La lógica (PKCE, enlace, estados, canje, ruta reservada) se prueba en Rust (app/nucleo/tests). Aquí va lo que
// se decide en la cáscara y en la configuración: superficie de IPC nula con el plugin single-instance (criterio 9),
// cómo se abre el navegador, cómo llega el enlace y dónde se registra el esquema (9), que los tipos con secretos
// no deriven Debug (8) y las dependencias nuevas con versión exacta (10).
// Son comprobaciones de texto: demuestran que las llamadas están escritas, no que funcionan.
// El lote app-sesion (tests/app-sesion.test.mjs) relajó tres comprobaciones de este archivo: la app puede depender
// también de windows-sys, el login se monta con Login::nuevo o con Login::con_llavero, y la constante
// CRED_PERSIST_LOCAL_MACHINE no cuenta como clave del registro. Están marcadas con «app-sesion».
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

function fuentesRust(dir) {
  const salida = [];
  for (const nombre of readdirSync(ruta(dir))) {
    const p = `${dir}/${nombre}`;
    if (statSync(ruta(p)).isDirectory()) salida.push(...fuentesRust(p));
    else if (p.endsWith(".rs")) salida.push(p);
  }
  return salida;
}
// Sin comentarios, para que una explicación no cuente como uso.
const sinComentarios = (rs) => rs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cascara = () => fuentesRust("app/src-tauri/src").map((p) => sinComentarios(leer(p))).join("\n");
const veces = (texto, patron) => (texto.match(patron) ?? []).length;

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
const version = (crudo) => crudo?.match(/^"([^"]+)"/)?.[1] ?? crudo?.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? null;
const paquetes = (lock) =>
  [...lock.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);

// ---------- Criterio 10: dependencias nuevas, con versión exacta ----------

test("c10 · el núcleo añade ring, base64 y serde_json con versión exacta, y nada más", () => {
  const deps = toml(leer(CARGO_NUCLEO)).dependencies ?? {};
  // flate2 viene de app-cascara (ureq va sin gzip y el núcleo descomprime); este lote no lo añade.
  assert.deepEqual(Object.keys(deps).sort(), ["base64", "flate2", "http", "ring", "serde_json", "ureq"], "dependencias directas del núcleo");
  assert.equal(version(deps.ring), "=0.17.14", "ring: SHA-256 y aleatoriedad del sistema (ya estaba en el lock, por rustls)");
  assert.equal(version(deps.base64), "=0.22.1", "base64: ya estaba en el lock, por ureq");
  assert.equal(version(deps.serde_json), "=1.0.154", "serde_json: la misma versión que ya compila la app");
  const lock = paquetes(leer("app/nucleo/Cargo.lock"));
  for (const p of ["ring 0.17.14", "base64 0.22.1", "serde_json 1.0.154"]) assert.ok(lock.includes(p), `app/nucleo/Cargo.lock sin ${p}`);
  // Sin crates de azar, de hash o de URL de más: con ring y la validación propia basta.
  assert.doesNotMatch(Object.keys(deps).join(" "), /\b(rand|getrandom|sha2|url|uuid|reqwest|tokio|tauri\S*|open|keyring)\b/);
});

test("c10 · la app añade single-instance, open y windows-registry con versión exacta, sin deep-link ni opener", () => {
  const cargo = toml(leer(CARGO_APP));
  const deps = cargo.dependencies ?? {};
  // app-sesion: se admite además windows-sys, para el llavero (su versión y sus features, en app-sesion.test.mjs).
  assert.deepEqual(
    Object.keys(deps).filter((nombre) => nombre !== "windows-sys").sort(),
    ["nucleo", "open", "tauri", "tauri-plugin-single-instance", "windows-registry"],
    "dependencias directas de la app (todas en [dependencies])",
  );
  assert.equal(version(deps["tauri-plugin-single-instance"]), "=2.5.5");
  assert.doesNotMatch(deps["tauri-plugin-single-instance"], /deep-link|semver|features\s*=\s*\[\s*"/, "single-instance sin features: la de deep-link arrastra ese plugin");
  assert.equal(version(deps.open), "=5.4.5");
  assert.match(deps.open, /features\s*=\s*\[\s*"shellexecute-on-windows"\s*\]/, "open abre con ShellExecuteExW, sin lanzar powershell ni explorer");
  assert.doesNotMatch(deps.open, /insecure/, "open sin la feature insecure (cmd /c start)");
  assert.equal(version(deps["windows-registry"]), "=0.6.1");
  assert.equal(version(deps.tauri), "=2.12.7", "tauri no cambia de versión en este lote");
  assert.doesNotMatch(Object.keys(cargo).join(" "), /^target\.|\starget\./, "sin tablas [target.…]: todo en [dependencies], para poder leerlo aquí");

  const lock = paquetes(leer("app/src-tauri/Cargo.lock"));
  for (const p of ["tauri-plugin-single-instance 2.5.5", "open 5.4.5", "windows-registry 0.6.1", "serde_json 1.0.154", "ring 0.17.14"]) {
    assert.ok(lock.includes(p), `app/src-tauri/Cargo.lock sin ${p}`);
  }
  for (const p of lock) {
    assert.doesNotMatch(p, /^tauri-plugin-(deep-link|opener|shell|http|fs|store|keyring)\b/, `plugin que no entra en este lote: ${p}`);
  }
});

// ---------- Criterio 9: superficie de IPC nula, también con un plugin ----------

test("c9 · un solo plugin (single-instance), sin capacidades ni comandos", () => {
  const rs = cascara();
  assert.equal(veces(rs, /\.plugin\s*\(/g), 1, "un solo .plugin(…)");
  assert.match(rs, /\.plugin\s*\(\s*tauri_plugin_single_instance::init\s*\(/, "el plugin es tauri_plugin_single_instance::init(…)");
  assert.doesNotMatch(rs, /tauri_plugin_(?!single_instance\b)/, "ningún otro plugin: deep-link y opener añaden comandos de IPC");
  assert.doesNotMatch(rs, /invoke_handler|generate_handler|tauri::command|#\[command\]/, "sin comandos");
  assert.doesNotMatch(rs, /\.manage\s*\(|\.emit\w*\s*\(|\.listen\w*\s*\(|add_capability/, "sin estado, eventos ni capacidades hacia el webview");
  assert.doesNotMatch(rs, /\.eval\w*\s*\(|initialization_script|js_init_script/, "sin JavaScript inyectado");

  // Sin ningún archivo de capacidades: single-instance no tiene comandos que permitir.
  const dir = "app/src-tauri/capabilities";
  assert.deepEqual(existe(dir) ? readdirSync(ruta(dir)) : [], [], "app/src-tauri/capabilities/ no existe o está vacía");
  assert.ok(!existe("app/src-tauri/permissions"), "sin permisos propios");
  const conf = json(CONF);
  assert.deepEqual(conf.app?.security?.capabilities ?? [], [], "sin capacidades en la configuración");
  assert.deepEqual(conf.plugins ?? {}, {}, "sin configuración de plugins: el esquema del enlace no se declara aquí");
  assert.notEqual(conf.app?.withGlobalTauri, true);
});

test("c9 · main.rs monta el login del núcleo y no construye el proxy por otra vía", () => {
  const rs = cascara();
  // app-sesion: el login se monta con Login::con_llavero, que añade el llavero como último argumento.
  assert.equal(veces(rs, /Login::(nuevo|con_llavero)\s*\(/g), 1, "un solo Login");
  assert.match(rs, /Login::(nuevo|con_llavero)\s*\(\s*arranque\.destino\s*,[^;]*arranque\.token\b/, "Login::nuevo(arranque.destino, <nombre del equipo>, arranque.token)");
  assert.match(rs, /env::var\s*\(\s*(nucleo::)?VAR_NOMBRE_EQUIPO\s*\)/, "el nombre del equipo sale de la variable VAR_NOMBRE_EQUIPO");
  assert.doesNotMatch(rs, /nombre_de_dispositivo/, "el nombre lo limpia Login::nuevo, no la cáscara");
  assert.equal(veces(rs, /Proxy::con_login\s*\(/g), 1, "el proxy se crea con Proxy::con_login");
  assert.doesNotMatch(rs, /Proxy::nuevo\s*\(|TokenFijo/, "sin proxy de token fijo en la app");
  assert.doesNotMatch(rs, /"vanttec-docs|"\/__app|auth\/app/, "esquema, ruta reservada y rutas del servidor viven en el núcleo");
});

test("c9 · el navegador solo se abre con open::that_detached, y solo lo llama el núcleo", () => {
  const rs = cascara();
  assert.match(rs, /impl\s+(nucleo::)?Navegador\s+for\s+\w+/, "la cáscara implementa nucleo::Navegador");
  assert.equal(veces(rs, /\bopen::/g), 1, "una sola llamada al crate open");
  assert.match(rs, /fn\s+abrir\s*\(\s*&self\s*,\s*url\s*:\s*&str\s*\)\s*->\s*bool\s*\{\s*open::that_detached\s*\(\s*url\s*\)\s*\.is_ok\s*\(\s*\)\s*\}/, "abrir(url) es open::that_detached(url).is_ok(), sin tocar la URL");
  assert.doesNotMatch(rs, /\.abrir\s*\(/, "la cáscara nunca llama a abrir: la URL la construye y la pasa el núcleo");
  assert.doesNotMatch(rs, /Inicio::|\.iniciar\s*\(/, "el botón lo atiende el proxy, no la cáscara");
  assert.doesNotMatch(rs, /Command::new|ShellExecute|tauri_plugin_(opener|shell)/, "sin otras formas de lanzar programas");
});

test("c9 · el enlace llega por single-instance, se canjea en otro hilo y la ventana main se recarga", () => {
  const rs = cascara();
  const inicio = rs.search(/tauri_plugin_single_instance::init\s*\(/);
  assert.ok(inicio >= 0, "falta tauri_plugin_single_instance::init");
  const resto = rs.slice(inicio);
  assert.equal(veces(rs, /\.recibir\s*\(/g), 1, "una sola llamada a Login::recibir");
  const recibir = resto.search(/\.recibir\s*\(/);
  assert.ok(recibir > 0, "Login::recibir se llama dentro del cierre de single-instance");
  const antes = resto.slice(0, recibir);
  assert.match(antes, /thread::spawn\s*\(/, "el canje bloquea: va en un hilo aparte, no en el hilo de la ventana");
  assert.match(antes, /\.len\s*\(\s*\)\s*[!=]=\s*2|\[\s*_\w*\s*,\s*\w+\s*\]/, "solo se mira una segunda instancia con exactamente un argumento");
  assert.match(resto, /Recibido::Ignorado/, "un enlace ignorado no recarga nada");
  assert.equal(veces(rs, /\.reload\s*\(/g), 1, "una sola recarga, tras un enlace que no se ignoró");
  assert.ok(resto.search(/\.reload\s*\(/) > recibir, "la recarga va después del canje");
  assert.equal(veces(rs, /get_webview_window\s*\(\s*"main"\s*\)/g), 2, "la ventana main se busca en on_new_window y aquí");
  assert.equal(veces(rs, /\.navigate\s*\(/g), 1, "navigate sigue siendo solo el de on_new_window");
  assert.doesNotMatch(rs, /env::args|args_os/, "la app no lee sus propios argumentos: un enlace que la abre se pierde, a propósito");
});

test("c9 · el esquema del enlace se registra solo en debug y desde nucleo::ESQUEMA_ENLACE", () => {
  const rs = cascara();
  assert.match(rs, /windows_registry::CURRENT_USER|use\s+windows_registry::\{?[^;]*CURRENT_USER/, "el registro va en HKEY_CURRENT_USER");
  // app-sesion: la constante CRED_PERSIST_LOCAL_MACHINE del llavero no es una clave del registro.
  assert.doesNotMatch(rs, /\bLOCAL_MACHINE\b|CLASSES_ROOT/, "nunca en claves de toda la máquina");
  assert.match(rs, /ESQUEMA_ENLACE/, "el nombre del esquema es nucleo::ESQUEMA_ENLACE");
  assert.match(rs, /Software\\{1,2}Classes\\{1,2}/, "bajo Software\\Classes\\<esquema>");
  assert.match(rs, /URL Protocol/, "con el valor «URL Protocol»");
  assert.match(rs, /shell\\{1,2}open\\{1,2}command/, "y la orden shell\\open\\command");
  assert.match(rs, /\\?"%1\\?"/, "el enlace va entre comillas: \"<exe>\" \"%1\"");
  assert.match(rs, /current_exe\s*\(/, "la orden apunta al propio ejecutable");
  const solo_debug = veces(rs, /#\[cfg\(all\(windows,\s*debug_assertions\)\)\]/g);
  assert.ok(solo_debug >= 2, "la función y su llamada llevan #[cfg(all(windows, debug_assertions))]: en release lo hará el instalador (A4)");
  const primera = rs.search(/#\[cfg\(all\(windows,\s*debug_assertions\)\)\]/);
  const uso = rs.search(/windows_registry|CURRENT_USER/);
  assert.ok(primera >= 0 && uso > primera, "nada del registro queda fuera de ese cfg");
  assert.doesNotMatch(rs, /\.remove\w*\s*\(|delete_/, "la app no borra claves del registro");
});

// ---------- Criterio 8: nada del login en logs ----------

test("c8 · la cáscara solo escribe textos fijos y los tipos con secretos no derivan Debug", () => {
  const rs = cascara();
  assert.doesNotMatch(rs, /eprintln!\s*\((?![^;]*?"\s*\))/, "eprintln! solo con un texto fijo, sin argumentos");
  assert.doesNotMatch(rs, /eprintln!\s*\(\s*"[^"]*\{/, "eprintln! sin interpolar nada");
  assert.doesNotMatch(rs, /\b(println|print|dbg)!|\blog::|\btracing::/, "sin trazas: el enlace trae el código");
  assert.doesNotMatch(rs, /\.exponer\s*\(|leer_enlace|EnlaceDeLogin|desafio_s256/, "el código, el verifier y el token no pasan por la cáscara");

  const nucleo = fuentesRust("app/nucleo/src").map((p) => sinComentarios(leer(p))).join("\n");
  assert.match(nucleo, /pub struct Login\b/, "falta nucleo::Login");
  assert.doesNotMatch(
    nucleo,
    /#\[derive\([^)]*\bDebug\b[^)]*\)\]\s*(pub(\([^)]*\))?\s+)?struct\s+(Login|EnlaceDeLogin|Intento|Interior)\b/,
    "Login, EnlaceDeLogin y el intento no derivan Debug: lo implementan a mano, sin valores",
  );
  assert.doesNotMatch(nucleo, /#\[derive\([^)]*\b(Serialize|Display)\b/, "nada del núcleo se serializa ni se muestra por derivación");
});

// ---------- Documentación ----------

test("el README de la app explica el inicio de sesión", () => {
  const md = leer("app/README.md");
  assert.doesNotMatch(md, /todavía no inicia sesión/, "la frase del lote anterior ya no es cierta");
  assert.match(md, /Iniciar sesión/, "nombra el botón");
  assert.match(md, /vanttec-docs:\/\//, "nombra el esquema del enlace");
  assert.match(md, /solo .*depuración|solo en debug/i, "dice que el esquema solo se registra en el binario de depuración");
});
