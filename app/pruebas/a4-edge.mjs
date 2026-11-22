// Comparación con Edge normal: abre Edge con Playwright (sin ventana), le pasa en memoria las
// cookies de sesión del WebView2 de la app (no se escriben a disco) y repite el diagnóstico de zoom.
import { createRequire } from 'node:module';
const { chromium } = createRequire('C:/Users/Ivan/dev/vanttec/verificacion-navegador/')('playwright-core');
const zoom = (await import('./a3-zoom.mjs')).default;

const app = await chromium.connectOverCDP('http://127.0.0.1:9222');
const cookies = await app.contexts()[0].cookies('https://docs.vanttec.workers.dev');
await app.close();
console.log('cookies copiadas:', cookies.map((c) => c.name).join(', '));

const edge = await chromium.launch({ channel: 'msedge', headless: process.env.VENTANA !== '1' });
try {
  const ctx = await edge.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies(cookies);
  const pagina = await ctx.newPage();
  await pagina.goto('https://docs.vanttec.workers.dev' + (process.env.RUTA || '/uuv/electronica/?p=arquitectura'), { waitUntil: 'load' });
  await pagina.waitForTimeout(8000);
  console.log('Edge', edge.version(), '| url:', pagina.url());
  console.log(await pagina.evaluate(() => JSON.stringify({
    webgl2: !!document.createElement('canvas').getContext('webgl2'),
    figuras: [...document.querySelectorAll('figure.hw-kicad')].map((f) => f.querySelector('[role=status]')?.textContent ?? (f.querySelector('kicanvas-embed') ? 'embed' : 'sin montar')),
  })));
  if (await pagina.locator('kicanvas-embed').count()) {
    const r = await zoom(pagina);
    for (const [k, v] of Object.entries(r.pasos)) console.log(k, JSON.stringify(v.zoom ?? v), JSON.stringify(v.centro ?? ''), v.escalaPagina ?? '');
  }
} finally {
  await edge.close();
}
