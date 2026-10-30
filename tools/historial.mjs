// Historial por página: `git log` en el build (argumentos fijos, sin shell, sin API de GitHub). El texto de git es
// contenido no confiable: se limpia aquí y la interfaz lo pinta con el escape de Astro. No se guarda el email.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { limpiarControl } from "./estado.mjs";

export const FORMATO = "%H%x1f%cI%x1f%an%x1f%s%x1e";

const corto = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export function parseLog(salida, { repoUrl, path, max = 10 } = {}) {
  const ancla = createHash("sha256").update(String(path)).digest("hex");
  const out = [];
  for (const r of String(salida ?? "").split("\x1e")) {
    if (out.length >= max) break;
    const campos = r.replace(/^\s+/, "").split("\x1f");
    if (campos.length < 4) continue;
    const [sha, fecha, autor, ...resto] = campos;
    if (!/^[0-9a-f]{40}$/.test(sha) || Number.isNaN(Date.parse(fecha))) continue;
    const url = `${repoUrl}/commit/${sha}`;
    out.push({
      sha,
      corto: sha.slice(0, 7),
      fecha,
      autor: limpiarControl(autor).trim(),
      mensaje: corto(limpiarControl(resto.join("\x1f")).trim(), 72),
      url,
      diff: `${url}#diff-${ancla}`,
    });
  }
  return out;
}

export function historial(dir, path, opts = {}) {
  const max = opts.max ?? 10;
  try {
    const salida = execFileSync("git", ["-C", dir, "log", "-n", String(max), `--format=${FORMATO}`, "--", path], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return parseLog(salida, { ...opts, path, max });
  } catch {
    return [];
  }
}
