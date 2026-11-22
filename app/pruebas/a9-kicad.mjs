// Carga una página con visor de KiCad, reintentando si R2 devuelve 503, y ejecuta el diagnóstico de zoom.
// RUTA=/uuv/electronica/?p=arquitectura (esquemático) o /uuv/mecanica/?p=ensamble
import zoom from './a3-zoom.mjs';
export default async (pagina) => {
  const ruta = process.env.RUTA || '/uuv/electronica/?p=arquitectura';
  let intentos = 0;
  for (; intentos < 8; intentos++) {
    await pagina.goto('https://docs.vanttec.workers.dev' + ruta, { waitUntil: 'load' });
    try { await pagina.waitForSelector('kicanvas-embed[loaded]', { timeout: 12000 }); break; } catch { await pagina.waitForTimeout(6000); }
  }
  if (!(await pagina.locator('kicanvas-embed[loaded]').count())) return { intentos, error: 'el visor no llegó a montarse (503 de adjuntos)' };
  await pagina.waitForTimeout(2500);
  const etiqueta = await pagina.locator('figure.hw-kicad [role=region]').first().getAttribute('aria-label');
  const r = await zoom(pagina);
  await pagina.screenshot({ path: process.env.CAPTURA || 'kicad.png' }).catch(() => {});
  const resumen = {};
  for (const [k, v] of Object.entries(r.pasos)) resumen[k] = Array.isArray(v) ? v.length + ' eventos' : v.error ?? `zoom=${v.zoom} centro=${v.centro} escalaPagina=${v.escalaPagina}`;
  return { intentos, etiqueta, visor: r.pasos.inicio.visor, webgl2: r.pasos.inicio.webgl2, resumen };
};
