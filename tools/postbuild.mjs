#!/usr/bin/env node
// Paso 3 del build: copia los diagramas de Archify a dist/<id>/arch/ tal cual (no pasan por Astro ni Pagefind).
import { cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, ".content", "arch");
if (existsSync(SRC)) {
  for (const id of readdirSync(SRC)) cpSync(join(SRC, id), join(ROOT, "dist", id, "arch"), { recursive: true });
}
