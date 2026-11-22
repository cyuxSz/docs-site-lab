// Prueba A (solo lectura): recorre las páginas de hardware en la ventana de la app y
// lista qué visores hay en cada una. No pulsa nada que guarde.
import { createRequire } from 'node:module';
const { chromium } = createRequire('C:/Users/Ivan/dev/vanttec/verificacion-navegador/')('playwright-core');

const navegador = await chromium.connectOverCDP('http://127.0.0.1:9222');
const pagina = navegador.contexts()[0].pages()[0];
const errores = [];
pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 200)); });

const BASE = 'https://docs.vanttec.workers.dev';
const inicio = process.argv[2] || '/uuv/electronica/';
await pagina.goto(BASE + inicio, { waitUntil: 'load' });
const enlaces = await pagina.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')]
  .map((a) => new URL(a.href))
  .filter((u) => u.origin === location.origin && /^\/uuv\/(electronica|mecanica)\//.test(u.pathname))
  .map((u) => u.pathname + u.search))]);
console.log('enlaces:', enlaces.join(' '));

for (const ruta of enlaces) {
  await pagina.goto(BASE + ruta, { waitUntil: 'load' });
  await pagina.waitForTimeout(4000);
  const info = await pagina.evaluate(() => ({
    kicad: [...document.querySelectorAll('figure.hw-kicad')].map((f) => ({
      embed: !!f.querySelector('kicanvas-embed'),
      aviso: f.querySelector('[role=status]')?.textContent ?? null,
      etiqueta: f.querySelector('[role=region]')?.getAttribute('aria-label') ?? null,
    })),
    iframes: [...document.querySelectorAll('iframe')].map((i) => i.src.slice(0, 120)),
    figuras: [...new Set([...document.querySelectorAll('figure')].map((f) => f.className))],
    botones: [...document.querySelectorAll('main button, main a.btn')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 30),
    pdfViewer: navigator.pdfViewerEnabled,
  }));
  console.log(ruta, JSON.stringify(info));
}
console.log('errores de consola:', JSON.stringify(errores.slice(0, 20)));
await navegador.close();
