// Carga una página y anota peticiones de la API y del visor, fallos de red y errores de consola (solo lectura).
export default async (pagina) => {
  const vistas = [], fallos = [], consola = [];
  const alResponder = async (r) => {
    const u = r.url();
    if (r.status() >= 400 || /\/api\/|kicanvas/.test(u)) {
      vistas.push({ estado: r.status(), url: u.replace('https://docs.vanttec.workers.dev', '').slice(0, 110), largo: r.headers()['content-length'] ?? null, tipo: r.headers()['content-type'] ?? null,
        cuerpo: r.status() >= 400 ? (await r.text().catch(() => '')).slice(0, 200) : undefined });
    }
  };
  const alFallar = (q) => fallos.push({ url: q.url().slice(0, 110), error: q.failure()?.errorText });
  const alConsola = (m) => { if (m.type() === 'error' || m.type() === 'warning') consola.push(m.text().slice(0, 240)); };
  const alError = (e) => consola.push('pageerror: ' + String(e).slice(0, 240));
  pagina.on('response', alResponder); pagina.on('requestfailed', alFallar); pagina.on('console', alConsola); pagina.on('pageerror', alError);
  await pagina.goto('https://docs.vanttec.workers.dev' + (process.env.RUTA || '/uuv/electronica/?p=arquitectura'), { waitUntil: 'load' });
  await pagina.waitForTimeout(7000);
  pagina.off('response', alResponder); pagina.off('requestfailed', alFallar); pagina.off('console', alConsola); pagina.off('pageerror', alError);
  return {
    vistas, fallos, consola,
    kicad: await pagina.evaluate(() => [...document.querySelectorAll('figure.hw-kicad')].map((f) => ({
      embed: !!f.querySelector('kicanvas-embed'), aviso: f.querySelector('[role=status]')?.textContent ?? null,
      etiqueta: f.querySelector('[role=region]')?.getAttribute('aria-label') ?? null }))),
  };
};
