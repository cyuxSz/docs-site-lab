// G4a · tools/dibujo/config.mjs: funciones puras de la CLI vanttec-dibujo (ruta del token, portal y formato del token).
import { test } from "node:test";
import assert from "node:assert/strict";
import { posix, win32 } from "node:path";

const cargar = () => import("../tools/dibujo/config.mjs");

const TOKEN = "vts_" + "A".repeat(20) + "b".repeat(20) + "_-9";

test("tokenValido: solo vts_ con 43 caracteres base64url", async () => {
  const { tokenValido } = await cargar();
  assert.equal(TOKEN.length, 47);
  assert.equal(tokenValido(TOKEN), true);
  assert.equal(tokenValido("vtd_" + TOKEN.slice(4)), false, "un token de dispositivo no vale");
  assert.equal(tokenValido("VTS_" + TOKEN.slice(4)), false);
  assert.equal(tokenValido(TOKEN.slice(0, -1)), false, "42 caracteres");
  assert.equal(tokenValido(TOKEN + "x"), false, "44 caracteres");
  assert.equal(tokenValido(TOKEN.slice(0, -1) + "="), false);
  assert.equal(tokenValido(TOKEN.slice(0, -1) + "+"), false);
  assert.equal(tokenValido(` ${TOKEN}`), false, "la CLI recorta antes; aquí no se acepta con espacios");
  assert.equal(tokenValido(""), false);
  assert.equal(tokenValido(undefined), false);
  assert.equal(tokenValido(null), false);
  assert.equal(tokenValido(123), false);
});

test("validarPortal: https en cualquier host; http solo localhost, 127.0.0.1 o [::1]; devuelve el origin", async () => {
  const { validarPortal, PORTAL_POR_DEFECTO } = await cargar();
  assert.equal(PORTAL_POR_DEFECTO, "https://docs.vanttec.workers.dev");
  assert.equal(validarPortal("https://docs.vanttec.workers.dev"), "https://docs.vanttec.workers.dev");
  assert.equal(validarPortal("https://docs.vanttec.workers.dev/"), "https://docs.vanttec.workers.dev");
  assert.equal(validarPortal("https://docs.vanttec.workers.dev/algo?x=1#h"), "https://docs.vanttec.workers.dev", "solo el origin");
  assert.equal(validarPortal("http://localhost:8799"), "http://localhost:8799");
  assert.equal(validarPortal("http://127.0.0.1:8799/"), "http://127.0.0.1:8799");
  assert.equal(validarPortal("http://[::1]:8799"), "http://[::1]:8799");
  for (const malo of [
    "http://docs.vanttec.workers.dev",
    "http://192.168.1.10:8799",
    "http://localhost.evil.com",
    "http://127.0.0.1.nip.io",
    "ftp://localhost",
    "javascript:alert(1)",
    "file:///C:/x",
    "docs.vanttec.workers.dev",
    "",
    "https://usuario:clave@docs.vanttec.workers.dev",
    "https://usuario@docs.vanttec.workers.dev",
  ]) {
    assert.throws(() => validarPortal(malo), Error, `debería rechazar ${JSON.stringify(malo)}`);
  }
  assert.throws(() => validarPortal("http://docs.vanttec.workers.dev"), /https/);
});

test("rutaToken: %APPDATA% en Windows, Application Support en macOS, XDG o ~/.config en el resto", async () => {
  const { rutaToken } = await cargar();
  assert.equal(
    rutaToken({ plataforma: "win32", env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" }, home: "C:\\Users\\u" }),
    win32.join("C:\\Users\\u\\AppData\\Roaming", "vanttec-dibujo", "token.json"),
  );
  assert.equal(
    rutaToken({ plataforma: "darwin", env: {}, home: "/Users/u" }),
    posix.join("/Users/u", "Library", "Application Support", "vanttec-dibujo", "token.json"),
  );
  assert.equal(
    rutaToken({ plataforma: "linux", env: { XDG_CONFIG_HOME: "/home/u/.cfg" }, home: "/home/u" }),
    posix.join("/home/u/.cfg", "vanttec-dibujo", "token.json"),
  );
  assert.equal(rutaToken({ plataforma: "linux", env: {}, home: "/home/u" }), posix.join("/home/u", ".config", "vanttec-dibujo", "token.json"));
  assert.equal(
    rutaToken({ plataforma: "linux", env: { XDG_CONFIG_HOME: "relativa" }, home: "/home/u" }),
    posix.join("/home/u", ".config", "vanttec-dibujo", "token.json"),
    "un XDG_CONFIG_HOME relativo se ignora",
  );
  assert.equal(rutaToken({ plataforma: "freebsd", env: {}, home: "/home/u" }), posix.join("/home/u", ".config", "vanttec-dibujo", "token.json"));
  // Sin APPDATA en Windows no se inventa una ruta relativa al directorio actual.
  const sinAppdata = rutaToken({ plataforma: "win32", env: {}, home: "C:\\Users\\u" });
  assert.ok(win32.isAbsolute(sinAppdata), sinAppdata);
  assert.ok(sinAppdata.endsWith("vanttec-dibujo\\token.json"), sinAppdata);
});
