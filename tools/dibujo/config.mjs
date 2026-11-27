// CLI vanttec-dibujo: funciones puras (ruta del token, portal y formato del token).
import { posix, win32 } from "node:path";

export const PORTAL_POR_DEFECTO = "https://docs.vanttec.workers.dev";
const RE_TOKEN = /^vts_[A-Za-z0-9_-]{43}$/;
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function tokenValido(texto) {
  return typeof texto === "string" && RE_TOKEN.test(texto);
}

export function validarPortal(texto) {
  if (typeof texto !== "string" || !texto.trim()) throw new Error("El portal no puede estar vacío.");
  let u;
  try {
    u = new URL(texto.trim());
  } catch {
    throw new Error("El portal no es una URL válida (por ejemplo https://docs.vanttec.workers.dev).");
  }
  if (u.username || u.password) throw new Error("El portal no puede llevar usuario ni contraseña.");
  if (u.protocol === "https:") return u.origin;
  if (u.protocol === "http:" && HOSTS_LOCALES.has(u.hostname)) return u.origin;
  if (u.protocol === "http:") throw new Error("El portal debe usar https (http solo se admite con localhost, 127.0.0.1 o [::1]).");
  throw new Error("El portal debe ser una URL https.");
}

export function rutaToken({ plataforma, env = {}, home }) {
  if (plataforma === "win32") {
    const base = env.APPDATA && win32.isAbsolute(env.APPDATA) ? env.APPDATA : win32.join(home, "AppData", "Roaming");
    return win32.join(base, "vanttec-dibujo", "token.json");
  }
  if (plataforma === "darwin") return posix.join(home, "Library", "Application Support", "vanttec-dibujo", "token.json");
  const xdg = env.XDG_CONFIG_HOME && posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : posix.join(home, ".config");
  return posix.join(xdg, "vanttec-dibujo", "token.json");
}
