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
  security: {
    // CSP en <meta> por página: solo corren los scripts que Astro emite (por hash) y los de este origen,
    // así que un <script> o un onclick metido en el Markdown de una wiki no se ejecuta.
    // Estilos con 'unsafe-inline' porque Mermaid y Shiki los escriben en línea.
    // frame-ancestors no funciona en <meta>: va como cabecera en vercel.json.
    csp: {
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"] },
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
