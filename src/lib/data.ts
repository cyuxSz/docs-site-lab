// Datos que deja tools/fetch.mjs en .content/ (solo en build).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONTENT = join(process.cwd(), ".content");

export interface PageInfo {
  path: string;
  route: string;
  title: string;
  description: string;
  type: string;
  owner: string;
  claims: number;
  updated: string | null;
  author: string | null;
}

export interface RosNode {
  id: string;
  label: string;
  category: "ros2_node" | "ros2_topic" | "ros2_service" | "ros2_action" | "hardware";
  package?: string;
  layer?: string;
  status?: "en_uso" | "legado" | "sin_uso" | "roto" | "externo";
  file?: string;
  line?: number | null;
  ros_name?: string;
  types?: string[];
  configs: string[];
  launches?: string[];
}

export interface RosEdge {
  source: string;
  target: string;
  label: string | null;
  kind: string;
  file: string;
  line: number | null;
}

export interface RosGraph {
  configs: { id: string; label: string; launch: string }[];
  launches: { path: string; config: string | null; nodes: string[]; broken: { node: string; line: number }[] }[];
  nodes: RosNode[];
  edges: RosEdge[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  summary: string;
  repo: string;
  branch: string;
  note?: string;
  // Portada y colores del proyecto (como cada vehículo en vanttec.com). image: ruta en public/; sin ella se dibuja
  // una ilustración según kind.
  tagline?: string;
  kind?: "submarino" | string;
  image?: string;
  theme?: ProjectTheme;
  // Recorrido guiado del grafo (diseño A): ids de ros.json en orden, con una frase cada uno.
  tour?: { node: string; text: string }[];
  repoUrl?: string;
  sha?: string;
  pages?: number;
  claims?: number;
  diagrams?: number;
  rosNodes?: number;
  updated?: string | null;
  error?: boolean;
  empty?: boolean;
  message?: string;
}

export interface ProjectData extends ProjectSummary {
  lastUpdate: { date?: string; commit?: string } | null;
  pageList: PageInfo[];
  diagramList: { file: string; title: string; kb: number }[];
  links: { source: string; target: string }[];
  ros: RosGraph | null;
}

export interface ProjectTheme {
  accent: string;
  deep: string;
  warm: string;
}

const read = (p: string) => JSON.parse(readFileSync(join(CONTENT, p), "utf8"));

export function portal(): { builtAt: string; alerts: { level: string; text: string }[]; projects: ProjectSummary[] } {
  return read("projects.json");
}

export const builtProjects = () => portal().projects.filter((p) => !p.error && !p.empty);

export function project(id: string): ProjectData {
  return read(join("data", `${id}.json`));
}

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium", timeZone: "America/Monterrey" }) : "—";

// Secciones de la wiki por carpeta, en el orden en que conviene leerlas.
const SECTIONS: [string, string][] = [
  ["", "Empezar"],
  ["architecture", "Arquitectura"],
  ["packages", "Paquetes"],
  ["operations", "Operación"],
];

export function sections(pages: PageInfo[]) {
  const visible = pages.filter((p) => p.type !== "meta");
  const groups = new Map<string, { label: string; pages: PageInfo[] }>();
  for (const [dir, label] of SECTIONS) groups.set(dir, { label, pages: [] });
  for (const p of visible) {
    const dir = p.path.includes("/") ? p.path.split("/")[0] : "";
    if (!groups.has(dir)) groups.set(dir, { label: dir, pages: [] });
    groups.get(dir)!.pages.push(p);
  }
  for (const g of groups.values()) g.pages.sort((a, b) => Number(b.type === "index") - Number(a.type === "index") || a.title.localeCompare(b.title, "es"));
  return [...groups.values()].filter((g) => g.pages.length);
}

export const STATUS_LABEL: Record<string, string> = {
  en_uso: "En uso",
  legado: "Legado",
  sin_uso: "Sin uso",
  roto: "Roto",
  externo: "Externo",
};

// Variables CSS con los colores de un proyecto (las usan Base.astro, las tarjetas de la portada y el grafo).
export const themeStyle = (t?: ProjectTheme) => (t ? `--p-accent:${t.accent};--p-deep:${t.deep};--p-warm:${t.warm}` : undefined);

// Lo que necesitan la barra de pestañas y los colores del proyecto en Base.astro.
export function projectNav(p: ProjectData) {
  const first = p.pageList.find((x) => x.path === "quickstart.md") ?? p.pageList.find((x) => x.type !== "index" && x.type !== "meta");
  return { id: p.id, name: p.name, theme: p.theme, wiki: first?.route, diagrams: p.diagramList.length > 0, repoUrl: p.repoUrl };
}
