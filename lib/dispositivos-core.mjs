// Tokens de dispositivo: credencial opaca (`vtd_…`) para clientes que no son un navegador (la app de escritorio).
// Esquema en migrations/0002_tokens.sql. El primer argumento de las funciones del almacén es el binding D1 (env.DB).
//
// - En D1 solo se guarda el SHA-256 del token y del código; el verifier de PKCE no se guarda nunca.
// - Consumir un código, revocar y anotar el último uso son cada uno UNA sentencia condicionada: una escritura tardía
//   no puede resucitar un token revocado ni un código ya usado.
// - Ningún error de este módulo lleva el token, el código, el verifier ni el mensaje de D1.
// - El reloj se lee con Date.now() en el momento de usarlo.
// Sin imports de node:* ni paquetes: corre en workerd (Buffer sí, por nodejs_compat).
import { COOKIE } from "./sesion.mjs";

const VIDA_CODIGO_MS = 60_000;
const VIDA_TOKEN_MS = 30 * 864e5;
const HORA_MS = 3_600_000;
const PURGA_CODIGOS = 50; // códigos caducados que se borran, como mucho, al crear uno
const PREFIJO = "vtd_";

export const PLATAFORMAS = ["windows", "macos", "linux", "android", "ios"];
const RE_B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const RE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const RE_TOKEN = /^vtd_[A-Za-z0-9_-]{43}$/;
// Controles C0/C1, separadores de línea y marcas de dirección: el nombre se muestra tal cual en la lista de dispositivos.
const CONTROL = /[\p{Cc}\p{Zl}\p{Zp}\p{Bidi_Control}]/u;

const enc = new TextEncoder();
const aleatorio = (bytes) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
const sha256 = async (texto) => Buffer.from(await crypto.subtle.digest("SHA-256", enc.encode(texto)));
const sha256hex = async (texto) => (await sha256(texto)).toString("hex");

// Comparación en tiempo constante de dos strings del mismo largo (los dos son base64url de 43 caracteres).
function igualConstante(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Devuelve el nombre recortado o null si no vale.
export function nombreValido(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= 60 && !CONTROL.test(t) ? t : null;
}
export const plataformaValida = (v) => typeof v === "string" && PLATAFORMAS.includes(v);
export const codigoBienFormado = (v) => typeof v === "string" && RE_B64URL_43.test(v);
export const verifierBienFormado = (v) => typeof v === "string" && RE_VERIFIER.test(v);

// Código opaco de un solo uso (256 bits), válido 60 s. Lo emitirá /auth/app/autorizar tras el consentimiento.
// En el mismo batch se purgan códigos caducados, de forma acotada (D1 no garantiza DELETE … LIMIT: va por subconsulta).
// La purga solo vive aquí (ruta con sesión): el canje público no gana ninguna escritura.
export async function crearCodigo(db, { login, challenge, nombre, plataforma } = {}) {
  if (typeof login !== "string" || !login) throw new Error("Login inválido");
  if (typeof challenge !== "string" || !RE_B64URL_43.test(challenge)) throw new Error("Challenge inválido");
  const limpio = nombreValido(nombre);
  if (limpio === null) throw new Error("Nombre inválido");
  if (!plataformaValida(plataforma)) throw new Error("Plataforma inválida");
  const codigo = aleatorio(32);
  const hash = await sha256hex(codigo);
  const ahora = Date.now();
  await db.batch([
    db.prepare("DELETE FROM codigos_app WHERE hash IN (SELECT hash FROM codigos_app WHERE expira <= ? LIMIT ?)").bind(ahora, PURGA_CODIGOS),
    db.prepare("INSERT INTO codigos_app (hash, login, challenge, nombre, plataforma, expira) VALUES (?, ?, ?, ?, ?, ?)").bind(hash, login, challenge, limpio, plataforma, ahora + VIDA_CODIGO_MS),
  ]);
  return codigo;
}

// Canjea un código por un token. Devuelve { token, expira, login } (expira en ms) o null si el código no existe,
// caducó, ya se usó o el verifier no corresponde a su challenge: quien llama responde lo mismo en todos los casos.
// Lanza solo si falla D1. `code` y `verifier` deben venir ya comprobados con codigoBienFormado / verifierBienFormado.
export async function canjear(db, { code, verifier }) {
  if (!codigoBienFormado(code) || !verifierBienFormado(verifier)) return null;
  // Los dos hashes se calculan antes de tocar D1, exista o no el código.
  const [hashCodigo, calculado] = await Promise.all([sha256hex(code), sha256(verifier).then((b) => b.toString("base64url"))]);
  // Una sola sentencia: de varios canjes simultáneos solo uno recibe la fila. Encontrarlo lo consume, acierte o no.
  const { results } = await db.prepare("DELETE FROM codigos_app WHERE hash = ? RETURNING login, challenge, nombre, plataforma, expira").bind(hashCodigo).all();
  const fila = results?.[0] ?? null;
  const ahora = Date.now();
  // Sin fila se compara igualmente (contra el propio valor calculado) para no acortar el camino.
  const coincide = igualConstante(calculado, fila ? String(fila.challenge) : calculado);
  if (!fila || !coincide || !(Number(fila.expira) > ahora)) return null;

  const token = PREFIJO + aleatorio(32);
  const expira = ahora + VIDA_TOKEN_MS;
  await db
    .prepare("INSERT INTO tokens (hash, id, login, nombre, plataforma, tipo, alcance, creado, ultimo_uso, expira) VALUES (?, ?, ?, ?, ?, 'dispositivo', 'completo', ?, NULL, ?)")
    .bind(await sha256hex(token), aleatorio(16), fila.login, fila.nombre, fila.plataforma, ahora, expira)
    .run();
  return { token, expira, login: fila.login };
}

// Dispositivos vivos de un login (sin distinguir mayúsculas). El hash no sale de aquí.
export async function listarDispositivos(db, login) {
  if (typeof login !== "string" || !login) return [];
  const { results } = await db
    .prepare("SELECT id, login, nombre, plataforma, tipo, alcance, creado, ultimo_uso, expira FROM tokens WHERE lower(login) = ? AND expira > ? ORDER BY creado DESC")
    .bind(login.toLowerCase(), Date.now())
    .all();
  return (results ?? []).map((f) => ({
    id: f.id,
    login: f.login,
    nombre: f.nombre,
    plataforma: f.plataforma,
    tipo: f.tipo,
    alcance: f.alcance,
    creado: Number(f.creado),
    ultimoUso: f.ultimo_uso === null || f.ultimo_uso === undefined ? null : Number(f.ultimo_uso),
    expira: Number(f.expira),
  }));
}

// Borra el dispositivo solo si es de ese login, en una sola sentencia. false si no existe o es de otro.
export async function revocarDispositivo(db, login, id) {
  if (typeof login !== "string" || !login || typeof id !== "string" || !id) return false;
  const r = await db.prepare("DELETE FROM tokens WHERE id = ? AND lower(login) = ?").bind(id, login.toLowerCase()).run();
  return Number(r?.meta?.changes ?? 0) > 0;
}

// Borra todos los tokens de un login (quien pierde el acceso), en una sola sentencia y por igualdad. Devuelve cuántos.
export async function revocarTodos(db, login) {
  if (typeof login !== "string" || !login) return 0;
  const r = await db.prepare("DELETE FROM tokens WHERE lower(login) = ?").bind(login.toLowerCase()).run();
  return Number(r?.meta?.changes ?? 0);
}

// ---------- Authorization: Bearer ----------

// Resultado de mirar la cabecera Authorization de una petición:
//   { estado: "ninguno" }        no hay esquema Bearer: sigue el flujo de cookie
//   { estado: "ok", login, id }  token vivo (id público del dispositivo; el hash no sale de este módulo)
//   { estado: "invalido" }       desconocido, mal formado, vacío, revocado o caducado (no se distingue)
//   { estado: "ambos" }          llegó también la cookie de sesión
//   { estado: "no-disponible" }  sin binding DB o D1 falló: falla cerrado
const memo = new WeakMap(); // Request → Promise<resultado>: Worker + core hacen una sola lectura de D1 por petición
const validadas = new WeakMap(); // Request → hash del token: solo las que se comprobaron contra D1 y estaban vivas

// La cookie de sesión cuenta con cualquier valor (también vacío o mal codificado); otras cookies no.
function traeCookieSesion(request) {
  for (const parte of (request.headers.get("cookie") || "").split(";")) {
    const i = parte.indexOf("=");
    if ((i < 0 ? parte : parte.slice(0, i)).trim() === COOKIE) return true;
  }
  return false;
}

async function resolver(request, env) {
  const m = /^bearer(?:\s+(.*))?$/is.exec((request.headers.get("authorization") || "").trim());
  if (!m) return { estado: "ninguno" };
  if (traeCookieSesion(request)) return { estado: "ambos" };
  const token = (m[1] ?? "").trim();
  // Sin forma de token no se consulta D1.
  if (!RE_TOKEN.test(token)) return { estado: "invalido" };
  const db = env?.DB;
  if (!db) return { estado: "no-disponible" };
  let hash, fila, ahora;
  try {
    hash = await sha256hex(token);
    fila = await db.prepare("SELECT id, login, expira, ultimo_uso FROM tokens WHERE hash = ?").bind(hash).first();
    ahora = Date.now();
  } catch {
    return { estado: "no-disponible" };
  }
  if (!fila || typeof fila.login !== "string" || !fila.login || !(Number(fila.expira) > ahora)) return { estado: "invalido" };
  // Último uso: como mucho una escritura por hora y por token, y solo si la fila leída lo pide. La condición va en la
  // propia sentencia, así que si el token se revocó entretanto no se toca nada. Un fallo aquí no tumba la petición.
  const corte = ahora - HORA_MS;
  if (fila.ultimo_uso === null || fila.ultimo_uso === undefined || Number(fila.ultimo_uso) <= corte) {
    try {
      await db.prepare("UPDATE tokens SET ultimo_uso = ? WHERE hash = ? AND (ultimo_uso IS NULL OR ultimo_uso <= ?)").bind(ahora, hash, corte).run();
    } catch {}
  }
  validadas.set(request, hash);
  return { estado: "ok", login: fila.login, id: typeof fila.id === "string" ? fila.id : null };
}

export function resolverBearer(request, env) {
  let p = memo.get(request);
  if (!p) memo.set(request, (p = resolver(request, env).catch(() => ({ estado: "no-disponible" }))));
  return p;
}

// true solo si ESTA petición ya pasó por resolverBearer con un token vivo. Llevar la cabecera no basta.
export const validadaConBearer = (request) => validadas.has(request);

// Revoca el token con el que se autenticó ESTA petición: una sola sentencia, por su hash. No acepta ningún id: un
// token solo puede revocarse a sí mismo. Devuelve:
//   "no-identificado"  la petición no pasó por resolverBearer con un token vivo: no se toca D1
//   "revocado"         el DELETE borró la fila
//   "ya-revocado"      la petición estaba identificada pero la fila ya no existía
// Lanza solo si falla D1 (el token sigue vivo).
export async function revocarPropio(request, env) {
  const hash = validadas.get(request);
  if (typeof hash !== "string" || !hash) return "no-identificado";
  const r = await env.DB.prepare("DELETE FROM tokens WHERE hash = ?").bind(hash).run();
  return Number(r?.meta?.changes ?? 0) > 0 ? "revocado" : "ya-revocado";
}
