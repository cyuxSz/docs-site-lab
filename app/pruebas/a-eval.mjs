// Ayuda de depuración: ejecuta en la página de la app (por CDP) el módulo que se le pase.
// Uso: node a-eval.mjs <script.mjs> [puerto]   — el script exporta default async (pagina, navegador) => resultado
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const { chromium } = createRequire('C:/Users/Ivan/dev/vanttec/verificacion-navegador/')('playwright-core');
const puerto = process.argv[3] || '9222';
const navegador = await chromium.connectOverCDP('http://127.0.0.1:' + puerto);
const pagina = navegador.contexts()[0].pages()[0];
const mod = await import(pathToFileURL(process.argv[2]).href);
try {
  console.log(JSON.stringify(await mod.default(pagina, navegador), null, 1));
} finally {
  await navegador.close();
}
