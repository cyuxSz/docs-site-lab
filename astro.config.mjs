// Sitio estático: el login lo hace middleware.js (Routing Middleware de Vercel), no Astro.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

// Astro no calcula el hash de los is:inline, así que va a mano: script en línea del tema claro/oscuro: se aplica en <head> antes de pintar, para que no parpadee.
const temaHash = `sha256-${createHash("sha256").update(readFileSync(new URL("./src/scripts/tema-inline.js", import.meta.url), "utf8")).digest("base64")}`;

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [react()],
  // Prefetch solo al pasar el cursor por enlaces marcados con data-astro-prefetch (nunca /auth/*: /auth/logout cierra la sesión).
  // Sin ClientRouter: el cambio de página entre documentos lo suaviza CSS (@view-transition en global.css).
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  markdown: {
    // Mermaid no pasa por Shiki: lo dibuja src/scripts/mermaid.ts solo en las páginas que lo usan.
    syntaxHighlight: { type: "shiki", excludeLangs: ["mermaid"] },
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" } },
  },
  security: {
    // CSP en <meta> por página: solo corren los scripts que Astro emite (por hash) y los de este origen,
    // así que un <script> o un onclick metido en el Markdown de una wiki no se ejecuta.
    // Estilos con 'unsafe-inline' porque Mermaid y Shiki los escriben en línea.
    // connect-src añade solo https://vercel.com/api/blob/ (prefijo de ruta): upload() de @vercel/blob/client sube ahí
    // los archivos de hardware directo desde el navegador (no usa Workers, así que no hace falta worker-src).
    // frame-ancestors no funciona en <meta>: va como cabecera en vercel.json.
    csp: {
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'"], hashes: [temaHash] },
      styleDirective: { resources: ["'self'", "'unsafe-inline'"] },
      directives: [
        "default-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self' https://vercel.com/api/blob/",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
