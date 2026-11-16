#!/usr/bin/env node
// Paso 3 del build: copia los diagramas de Archify a dist/<id>/arch/ tal cual (no pasan por Astro ni Pagefind)
// y las fuentes de Excalidraw a dist/excalidraw/fonts/ (EXCALIDRAW_ASSET_PATH, así salen de este origen y no de un CDN).
import { cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, ".content", "arch");
if (existsSync(SRC)) {
  for (const id of readdirSync(SRC)) cpSync(join(SRC, id), join(ROOT, "dist", id, "arch"), { recursive: true });
}
const FUENTES = join(ROOT, "node_modules", "@excalidraw", "excalidraw", "dist", "prod", "fonts");
if (!existsSync(FUENTES)) throw new Error("Faltan las fuentes de Excalidraw: ejecuta npm install");
cpSync(FUENTES, join(ROOT, "dist", "excalidraw", "fonts"), { recursive: true });
