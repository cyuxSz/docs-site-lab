// Punto 6: ¿puede Playwright conectarse por CDP al WebView2 de la app?
// Arrancar la app con WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
// Uso: node cdp.mjs [ruta a node_modules con playwright-core]
import { createRequire } from 'node:module';

const base = process.argv[2] || 'C:/Users/Ivan/dev/vanttec/verificacion-navegador/';
const { chromium } = createRequire(base)('playwright-core');

const version = await (await fetch('http://127.0.0.1:9222/json/version')).json();
console.log('json/version:', JSON.stringify(version));

const navegador = await chromium.connectOverCDP('http://127.0.0.1:9222');
console.log('conectado; version =', navegador.version());
for (const ctx of navegador.contexts()) {
  for (const pagina of ctx.pages()) {
    console.log('pagina:', pagina.url(), '| titulo:', await pagina.title());
    console.log('  origen:', await pagina.evaluate(() => location.origin));
    console.log('  texto:', (await pagina.locator('body').innerText()).slice(0, 200).replace(/\s+/g, ' '));
  }
}
await navegador.close(); // con connectOverCDP solo desconecta; no cierra la app
