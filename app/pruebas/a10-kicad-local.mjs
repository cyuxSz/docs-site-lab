// Diagnóstico de zoom de KiCanvas sobre la página local (/visor?t=sch|pcb), sin depender del portal.
// Uso: node a10-kicad-local.mjs app|edge sch|pcb [captura.png]
import { createRequire } from 'node:module';
const { chromium } = createRequire('C:/Users/Ivan/dev/vanttec/verificacion-navegador/')('playwright-core');
import zoom from './a3-zoom.mjs';

const [, , donde = 'app', tipo = 'sch', captura] = process.argv;
const enApp = donde !== 'edge';
const navegador = enApp ? await chromium.connectOverCDP('http://127.0.0.1:9222') : await chromium.launch({ channel: 'msedge', headless: true });
const ctx = enApp ? navegador.contexts()[0] : await navegador.newContext({ viewport: { width: 1280, height: 860 } });
const pagina = enApp ? ctx.pages()[0] : await ctx.newPage();
try {
  await pagina.goto('http://127.0.0.1:8799/visor?t=' + tipo);
  await pagina.waitForSelector('kicanvas-embed[loaded]', { timeout: 20000 });
  await pagina.waitForTimeout(2500);
  const r = await zoom(pagina);
  if (captura) await pagina.screenshot({ path: captura });
  const i = r.pasos.inicio;
  console.log(`${enApp ? 'APP' : 'EDGE'} ${navegador.version()} ${tipo}: visor=${i.visor} webgl2=${i.webgl2} dpr=${i.dpr}`);
  for (const [k, v] of Object.entries(r.pasos)) if (!Array.isArray(v)) console.log('  ' + k.padEnd(17), v.error ?? `zoom=${v.zoom} centro=${v.centro} escalaPagina=${v.escalaPagina}`);
  console.log('  scrollY de la página al final:', r.scrollY);
} finally {
  await navegador.close();
}
