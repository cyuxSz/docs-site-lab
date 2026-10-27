// Sitio estático: el login lo hace middleware.js (Routing Middleware de Vercel), no Astro.
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [react()],
  markdown: {
    // Mermaid no pasa por Shiki: lo dibuja src/scripts/mermaid.ts solo en las páginas que lo usan.
    syntaxHighlight: { type: "shiki", excludeLangs: ["mermaid"] },
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" } },
  },
});
