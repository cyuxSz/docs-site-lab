// ¿Qué eventos recibe una página cualquiera con rueda, Ctrl+rueda y pellizco (táctil y de touchpad)?
// La página imita a KiCanvas: listener de `wheel` no pasivo con preventDefault.
// Uso: node a6-pellizco.mjs app   (WebView2 de la app, por CDP en 9222)
//      node a6-pellizco.mjs edge  (Edge sin ventana)
import { createRequire } from 'node:module';
const { chromium } = createRequire('C:/Users/Ivan/dev/vanttec/verificacion-navegador/')('playwright-core');

const enApp = process.argv[2] !== 'edge';
const navegador = enApp ? await chromium.connectOverCDP('http://127.0.0.1:9222') : await chromium.launch({ channel: 'msedge', headless: true });
const ctx = enApp ? navegador.contexts()[0] : await navegador.newContext({ viewport: { width: 1280, height: 860 } });
const pagina = enApp ? ctx.pages()[0] : await ctx.newPage();
const anterior = pagina.url();
await pagina.goto('http://127.0.0.1:8799/pellizco');
await pagina.evaluate(() => {
  document.body.style.height = '3000px';
  window.__ev = [];
  addEventListener('wheel', (e) => { e.preventDefault(); window.__ev.push(`wheel dY=${Math.round(e.deltaY)} ctrl=${e.ctrlKey}`); }, { passive: false });
  for (const t of ['touchstart', 'gesturestart', 'pointerdown']) addEventListener(t, (e) => window.__ev.push(`${t} ${e.pointerType ?? ''}`));
});
const cdp = await ctx.newCDPSession(pagina);
const paso = async (nombre, f) => {
  await pagina.evaluate(() => { window.__ev = []; });
  let error = null;
  try { await f(); } catch (e) { error = String(e).slice(0, 120); }
  await pagina.waitForTimeout(500);
  const r = await pagina.evaluate(() => ({ n: window.__ev.length, primeros: [...new Set(window.__ev)].slice(0, 4), escala: visualViewport.scale, dpr: devicePixelRatio }));
  console.log(nombre.padEnd(18), JSON.stringify({ ...r, error: error ?? undefined }));
};
console.log(enApp ? 'APP WebView2' : 'EDGE', navegador.version());
await pagina.mouse.move(600, 400);
await paso('rueda', () => pagina.mouse.wheel(0, -300));
await paso('ctrl+rueda', async () => { await pagina.keyboard.down('Control'); await pagina.mouse.wheel(0, -300); await pagina.keyboard.up('Control'); });
await paso('pellizco touchpad', () => cdp.send('Input.synthesizePinchGesture', { x: 600, y: 400, scaleFactor: 2, gestureSourceType: 'mouse' }));
await paso('pellizco tactil', () => cdp.send('Input.synthesizePinchGesture', { x: 600, y: 400, scaleFactor: 2, gestureSourceType: 'touch' }));
if (enApp && anterior.startsWith('http')) await pagina.goto(anterior).catch(() => {});
await navegador.close();
