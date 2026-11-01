// Página "Limpieza del repo": candidatos a borrar (sin uso y legado) desde ros.json, progreso "revisado" y Markdown.
import type { RosGraph } from "./data";

export const MOTIVO_SIN_USO = "Ningún launch file lo lanza.";
export const MOTIVO_LEGADO = "Solo lo lanzan configuraciones o launch files del sistema anterior.";

export interface FilaLimpieza {
  id: string;
  paquete: string;
  ejecutable: string;
  archivo: string;
  url: string | null;
  configs: string[];
  launches: string[];
  motivo: string;
}

export function enlaceGithub(repoUrl: unknown, sha: unknown, file: unknown, line?: number | null): string | null {
  if (typeof repoUrl !== "string" || !/^https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/?$/.test(repoUrl)) return null;
  if (typeof file !== "string" || !file || file.startsWith("/") || file.includes("\\") || file.split("/").includes("..")) return null;
  const ref = typeof sha === "string" && sha ? sha : "HEAD";
  const ruta = file.split("/").map(encodeURIComponent).join("/");
  const base = `${repoUrl.replace(/\/$/, "")}/blob/${encodeURIComponent(ref)}/${ruta}`;
  return typeof line === "number" && Number.isInteger(line) && line > 0 ? `${base}#L${line}` : base;
}

const cmp = (a: FilaLimpieza, b: FilaLimpieza) =>
  a.paquete.localeCompare(b.paquete) || a.ejecutable.localeCompare(b.ejecutable) || a.id.localeCompare(b.id);

export function filasLimpieza(ros: RosGraph | null | undefined, repoUrl?: string, sha?: string): { sinUso: FilaLimpieza[]; legado: FilaLimpieza[] } {
  const out = { sinUso: [] as FilaLimpieza[], legado: [] as FilaLimpieza[] };
  if (!ros || !Array.isArray(ros.nodes)) return out;
  const cfgs = new Map((ros.configs ?? []).map((c) => [c.id, c]));
  const sueltos = new Set((ros.launches ?? []).filter((l) => l.config === null).map((l) => l.path));
  for (const n of ros.nodes) {
    if (n.category !== "ros2_node" || (n.status !== "sin_uso" && n.status !== "legado")) continue;
    const fila: FilaLimpieza = {
      id: n.id,
      paquete: n.package ?? n.id.split("/")[0],
      ejecutable: n.label,
      archivo: n.file ?? "",
      url: enlaceGithub(repoUrl, sha, n.file, n.line),
      configs: [],
      launches: [],
      motivo: n.status === "legado" ? MOTIVO_LEGADO : MOTIVO_SIN_USO,
    };
    if (n.status === "legado") {
      fila.configs = (n.configs ?? []).map((id) => cfgs.get(id)).filter((c) => c?.legado).map((c) => c!.label);
      fila.launches = (n.launches ?? []).filter((p) => sueltos.has(p));
      out.legado.push(fila);
    } else out.sinUso.push(fila);
  }
  out.sinUso.sort(cmp);
  out.legado.sort(cmp);
  return out;
}

export const claveRevisados = (projectId: string) => `limpieza-revisados-${projectId}`;

export function leerRevisados(raw: string | null, ids: string[]): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!Array.isArray(d)) return out;
  const validos = new Set(ids);
  for (const x of d) if (typeof x === "string" && validos.has(x)) out.add(x);
  return out;
}

export const serializarRevisados = (s: Set<string>): string => JSON.stringify([...s]);

export function alternarRevisado(s: Set<string>, id: string, on: boolean): Set<string> {
  const c = new Set(s);
  if (on) c.add(id);
  else c.delete(id);
  return c;
}

export function progreso(filas: FilaLimpieza[], revisados: Set<string>) {
  const total = filas.length;
  const hechos = filas.filter((f) => revisados.has(f.id)).length;
  return { hechos, total, texto: `${hechos} de ${total} revisados` };
}

export const filasVisibles = (filas: FilaLimpieza[], revisados: Set<string>, ocultar: boolean) =>
  ocultar ? filas.filter((f) => !revisados.has(f.id)) : filas;

const linea = (s: string) => String(s).replace(/[\r\n]+/g, " ").replace(/`/g, "'").trim();

// Texto fuera de código en línea: escapa con "\" la sintaxis de enlaces y de código (y aplana saltos de línea).
const texto = (s: string) => String(s).replace(/[\r\n]+/g, " ").trim().replace(/[\\`\[\]()<>]/g, "\\$&");
// Destino de enlace: los paréntesis cerrarían el destino; solo en el Markdown exportado.
const destino = (u: string) => u.replace(/\(/g, "%28").replace(/\)/g, "%29");

function itemMd(f: FilaLimpieza, rev: Set<string>): string {
  const partes = [`- [${rev.has(f.id) ? "x" : " "}] \`${linea(f.paquete)}/${linea(f.ejecutable)}\``];
  if (f.archivo) partes.push(f.url ? `[${texto(f.archivo)}](${destino(f.url)})` : texto(f.archivo));
  let s = partes.join(" · ") + ` — ${texto(f.motivo)}`;
  if (f.configs.length) s += `\n  - Configs a retirar: ${f.configs.map(texto).join(", ")}`;
  if (f.launches.length) s += `\n  - Launches a retirar: ${f.launches.map((l) => `\`${linea(l)}\``).join(", ")}`;
  return s;
}

export function limpiezaMarkdown(nombre: string, f: { sinUso: FilaLimpieza[]; legado: FilaLimpieza[] }, rev: Set<string>): string {
  const p = progreso([...f.sinUso, ...f.legado], rev);
  const seccion = (t: string, fs: FilaLimpieza[]) => `## ${t}\n\n${fs.length ? fs.map((x) => itemMd(x, rev)).join("\n") : "_Nada por revisar._"}\n`;
  return [
    `# Limpieza del repo · ${texto(nombre)}`,
    "",
    p.texto,
    "",
    seccion("Sin uso (candidatos a borrar)", f.sinUso),
    seccion("Legado (se puede borrar cuando se retire lo indicado)", f.legado),
  ].join("\n");
}

export const nombreArchivoMd = (p: string) =>
  `limpieza-${String(p).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "proyecto"}.md`;
