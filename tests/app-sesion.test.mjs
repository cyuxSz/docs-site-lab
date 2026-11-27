// Lote app-sesion: comprobaciones estáticas de la sesión de la app de escritorio (carpeta app/).
// La lógica (llavero, arranque, cierre de sesión, enlace «Salir», 401) se prueba en Rust (app/nucleo/tests/sesion.rs).
// Aquí va lo que se decide en la cáscara y en la configuración: el llavero real sobre la API de credenciales de
// Windows (criterio 9), que el secreto no pasa por ningún otro sitio (8), superficie de IPC nula (9) y la
// dependencia nueva con versión exacta, sin paquetes nuevos en los locks (10).
// Son comprobaciones de texto: demuestran que las llamadas están escritas, no que funcionan.
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
const LLAVERO = "app/src-tauri/src/llavero.rs";

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
const fuente = (p) => sinComentarios(leer(p));
const cascara = () => fuentesRust("app/src-tauri/src").map(fuente).join("\n");
const nucleo = () => fuentesRust("app/nucleo/src").map(fuente).join("\n");
const veces = (texto, patron) => (texto.match(patron) ?? []).length;
// La palabra clave, no el 'unsafe-inline' de una CSP.
const USA_UNSAFE = /\bunsafe\s*(\{|fn\b|impl\b|trait\b|extern\b)/;

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

// ---------- Criterio 10: una dependencia directa nueva y ningún paquete nuevo ----------

test("c10 · la app añade solo windows-sys, con versión exacta y las dos features de credenciales", () => {
  const cargo = toml(leer(CARGO_APP));
  const deps = cargo.dependencies ?? {};
  assert.deepEqual(
    Object.keys(deps).sort(),
    ["nucleo", "open", "tauri", "tauri-plugin-single-instance", "windows-registry", "windows-sys"],
    "dependencias directas de la app (todas en [dependencies])",
  );
  assert.equal(version(deps["windows-sys"]), "=0.61.2", "la versión que ya estaba en el lock, por tauri");
  const features = [...(deps["windows-sys"].match(/features\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(features, ["Win32_Foundation", "Win32_Security_Credentials"], "solo la API de credenciales y los códigos de error");
  assert.doesNotMatch(Object.keys(cargo).join(" "), /^target\.|\starget\./, "sin tablas [target.…]");
  // Lo que no cambia.
  assert.equal(version(deps.tauri), "=2.12.7");
  assert.equal(version(deps["tauri-plugin-single-instance"]), "=2.5.5");
  assert.equal(version(deps.open), "=5.4.5");
  assert.equal(version(deps["windows-registry"]), "=0.6.1");
});

test("c10 · ningún crate de llavero ni plugin nuevo, y los locks no ganan paquetes", () => {
  const app = paquetes(leer("app/src-tauri/Cargo.lock"));
  const delNucleo = paquetes(leer("app/nucleo/Cargo.lock"));
  for (const p of [...app, ...delNucleo]) {
    assert.doesNotMatch(p, /keyring|secret-service|security-framework|keytar|credential/i, `crate de llavero que no entra: ${p}`);
    assert.doesNotMatch(p, /^tauri-plugin-(?!single-instance )/, `plugin que no entra en este lote: ${p}`);
  }
  assert.ok(app.includes("windows-sys 0.61.2"), "app/src-tauri/Cargo.lock sin windows-sys 0.61.2");
  // Medido en el lote: windows-sys 0.61.2 ya estaba en el lock, así que no se añade ni se quita nada.
  assert.equal(app.length, 498, "el lock de la app sigue con 498 paquetes");
  const deps = toml(leer(CARGO_NUCLEO)).dependencies ?? {};
  // flate2 viene de app-cascara (ureq va sin gzip y el núcleo descomprime); este lote no lo añade.
  assert.deepEqual(Object.keys(deps).sort(), ["base64", "flate2", "http", "ring", "serde_json", "ureq"], "el núcleo no añade dependencias");
});

// ---------- Criterio 9: el llavero real ----------

test("c9 · el llavero real es un módulo de la cáscara sobre la API de credenciales de Windows", () => {
  const rs = fuente(LLAVERO);
  assert.match(fuente(MAIN), /#\[cfg\(windows\)\]\s*mod\s+llavero\s*;/, "main.rs declara `#[cfg(windows)] mod llavero;`");
  assert.match(rs, /impl\s+(nucleo::)?Llavero\s+for\s+LlaveroDelSistema\b/, "implementa nucleo::Llavero");
  assert.equal(veces(cascara(), /impl\s+(nucleo::)?Llavero\s+for\b/g), 1, "una sola implementación en la cáscara");
  for (const funcion of ["CredReadW", "CredWriteW", "CredDeleteW", "CredFree"]) {
    assert.match(rs, new RegExp(`\\b${funcion}\\s*\\(`), `llama a ${funcion}`);
  }
  assert.match(rs, /windows_sys::Win32::Security::Credentials/, "con windows-sys, sin crate intermedio");
  assert.match(rs, /\bCRED_TYPE_GENERIC\b/, "credencial genérica");
  assert.match(rs, /Persist\s*:\s*CRED_PERSIST_LOCAL_MACHINE\b/, "del usuario y de este equipo");
  assert.doesNotMatch(rs, /CRED_PERSIST_(ENTERPRISE|SESSION)|CRED_TYPE_DOMAIN/, "no viaja con el perfil ni dura solo la sesión de Windows");
  assert.doesNotMatch(rs, /CredEnumerate|CredRename|CredMarshal|CredUnprotect|CredProtect|CredUI/, "solo leer, escribir y borrar su propia credencial");
  assert.match(rs, /\bERROR_NOT_FOUND\b/, "«no existe» no es un fallo: se distingue con ERROR_NOT_FOUND");
  assert.ok(rs.search(/\bCredFree\s*\(/) > rs.search(/\bCredReadW\s*\(/), "lo que entrega CredReadW se libera con CredFree");
});

test("c9 · unsafe solo en llavero.rs, y cada bloque explica por qué es correcto", () => {
  const crudo = leer(LLAVERO);
  const bloques = veces(sinComentarios(crudo), /\bunsafe\s*\{/g);
  assert.ok(bloques >= 3, "al menos leer, escribir y borrar");
  assert.ok(veces(crudo, /\/\/\s*SAFETY:/g) >= bloques, "cada bloque unsafe lleva su comentario `// SAFETY:`");
  assert.doesNotMatch(sinComentarios(crudo), /\bunsafe\s+(fn|impl|trait|extern)\b|transmute|mem::zeroed|static\s+mut/, "sin unsafe fn, transmute ni zeroed a mano");
  for (const p of fuentesRust("app/src-tauri/src")) {
    if (p !== LLAVERO) assert.doesNotMatch(fuente(p), USA_UNSAFE, `${p}: sin unsafe`);
  }
  for (const p of fuentesRust("app/nucleo/src")) assert.doesNotMatch(fuente(p), USA_UNSAFE, `${p}: el núcleo sigue sin unsafe`);
});

test("c9 · los nombres de la credencial salen del núcleo y cambian entre debug y release", () => {
  const rs = cascara();
  assert.match(rs, /nombre_de_llavero\s*\(\s*cfg!\s*\(\s*debug_assertions\s*\)\s*\)/, "nombre_de_llavero(cfg!(debug_assertions)), sin intermediarios");
  assert.equal(veces(rs, /nombre_de_llavero\s*\(/g), 1, "una sola llamada");
  assert.match(rs, /LlaveroDelSistema::nuevo\s*\(\s*nombre_de_llavero\s*\([^)]*\)\s*\)\s*,\s*(nucleo::)?LLAVERO_CUENTA\s*,?\s*\)/, "LlaveroDelSistema::nuevo(nombre_de_llavero(…), LLAVERO_CUENTA)");
  assert.equal(veces(rs, /LlaveroDelSistema::nuevo\s*\(/g), 1, "un solo llavero");
  assert.doesNotMatch(rs, /LLAVERO_SERVICIO|\(desarrollo\)|token-de-dispositivo/, "la cáscara no elige el nombre ni lo repite");
  assert.doesNotMatch(fuente(LLAVERO), /"[^"\n]*[A-Za-z]{3}[^"\n]*"/, "llavero.rs no lleva textos: ni nombres, ni mensajes");

  const n = nucleo();
  assert.match(n, /pub const LLAVERO_SERVICIO: &str = "VantTec Docs";/);
  assert.match(n, /pub const LLAVERO_SERVICIO_DEV: &str = "VantTec Docs \(desarrollo\)";/);
  assert.match(n, /pub const LLAVERO_CUENTA: &str = "token-de-dispositivo";/);
});

test("c9 · main.rs monta el login con el llavero y no cierra la sesión por su cuenta", () => {
  const rs = cascara();
  assert.equal(veces(rs, /Login::con_llavero\s*\(/g), 1, "un solo Login, con llavero");
  assert.doesNotMatch(rs, /Login::nuevo\s*\(/, "sin Login::nuevo: ese es el login sin llavero");
  assert.match(rs, /Login::con_llavero\s*\(\s*arranque\.destino\s*,[^;]*arranque\.token\s*,\s*llavero\s*,?\s*\)/, "Login::con_llavero(arranque.destino, <equipo>, arranque.token, llavero)");
  assert.equal(veces(rs, /Proxy::con_login\s*\(/g), 1);
  // Leer, guardar y borrar los decide el núcleo: la cáscara solo entrega el llavero.
  assert.doesNotMatch(fuente(MAIN), /\.(leer|guardar|borrar)\s*\(/, "main.rs no usa el llavero directamente");
  assert.doesNotMatch(rs, /\.cerrar_sesion\s*\(|\.rechazar\s*\(|RUTA_SALIR|auth\/logout|revocar/, "«Salir» lo atiende el proxy, no la cáscara");
  assert.doesNotMatch(rs, /Cierre::|Fin::|EstadoLogin::/, "los estados de la sesión no pasan por la cáscara");
  // Sin llavero en otras plataformas: la sesión vive en memoria, como en A1.
  assert.match(rs, /#\[cfg\(not\(windows\)\)\][^;]*SinLlavero/, "fuera de Windows, nucleo::SinLlavero");
});

// ---------- Criterio 9: superficie de IPC nula ----------

test("c9 · sigue sin IPC: un solo plugin, sin comandos, capacidades, eventos ni JavaScript inyectado", () => {
  const rs = cascara();
  assert.equal(veces(rs, /\.plugin\s*\(/g), 1, "un solo .plugin(…)");
  assert.doesNotMatch(rs, /tauri_plugin_(?!single_instance\b)/, "ningún plugin nuevo: el llavero no es un plugin");
  assert.doesNotMatch(rs, /invoke_handler|generate_handler|tauri::command|#\[command\]/, "sin comandos");
  assert.doesNotMatch(rs, /\.manage\s*\(|\.emit\w*\s*\(|\.listen\w*\s*\(|add_capability/, "sin estado, eventos ni capacidades");
  assert.doesNotMatch(rs, /\.eval\w*\s*\(|initialization_script|js_init_script|with_webview\s*\(/, "sin JavaScript inyectado: la página abierta no se entera del 401 por esta vía");
  assert.ok(veces(rs, /\.reload\s*\(/g) <= 1, "la única recarga sigue siendo la del login: perder la sesión no recarga la ventana");
  const dir = "app/src-tauri/capabilities";
  assert.deepEqual(existe(dir) ? readdirSync(ruta(dir)) : [], [], "app/src-tauri/capabilities/ no existe o está vacía");
  const conf = json(CONF);
  assert.deepEqual(conf.app?.security?.capabilities ?? [], []);
  assert.deepEqual(conf.plugins ?? {}, {});
  assert.notEqual(conf.app?.withGlobalTauri, true);
});

// ---------- Criterio 8: el secreto no pasa por ningún otro sitio ----------

test("c8 · el token solo sale del núcleo como bytes hacia el llavero, y nada lo escribe ni lo formatea", () => {
  const rs = cascara();
  assert.doesNotMatch(rs, /\.exponer\s*\(|Token::nuevo|\bToken\b/, "la cáscara no conoce el tipo Token: recibe y entrega bytes");
  assert.doesNotMatch(rs, /\b(println|print|dbg)!|\blog::|\btracing::/, "sin trazas");
  assert.doesNotMatch(rs, /eprintln!\s*\(\s*"[^"]*\{/, "eprintln! sin interpolar nada");
  const llavero = fuente(LLAVERO);
  assert.doesNotMatch(llavero, /eprintln!|format!|write!|to_string\s*\(|String::from_utf|std::fs|\bfs::|std::env|FormatMessage/, "llavero.rs no escribe, no formatea y no traduce el error del sistema");
  assert.doesNotMatch(llavero, /#\[derive\([^)]*\bDebug\b/, "LlaveroDelSistema no deriva Debug");

  const n = nucleo();
  assert.match(n, /pub struct FalloDeLlavero\s*;/, "FalloDeLlavero no lleva ningún dato");
  assert.match(n, /pub trait Llavero\s*:\s*Send\s*\+\s*Sync/, "falta nucleo::Llavero");
  // En el núcleo el valor del token se lee en tres sitios: la cabecera del proxy, la de la revocación y el guardado.
  assert.ok(veces(n, /\.exponer\s*\(/g) <= 3, "exponer() solo para las dos cabeceras Authorization y para guardar en el llavero");
  assert.doesNotMatch(n, /#\[derive\([^)]*\bDebug\b[^)]*\)\]\s*(pub(\([^)]*\))?\s+)?struct\s+(Login|Interior|Sesion)\b/, "Login y su interior no derivan Debug");
});

// ---------- Documentación ----------

test("el README de la app explica dónde se guarda la sesión y cómo se cierra", () => {
  const md = leer("app/README.md");
  assert.doesNotMatch(md, /Al cerrar la app, la sesión se pierde/, "la frase del lote anterior ya no es cierta");
  assert.match(md, /Administrador de credenciales/, "dice dónde se guarda el token");
  assert.match(md, /VantTec Docs \(desarrollo\)/, "nombra la credencial del binario de depuración");
  assert.match(md, /«Salir»/, "nombra el enlace que cierra la sesión");
  assert.match(md, /cmdkey/, "dice cómo verla o borrarla a mano");
});
