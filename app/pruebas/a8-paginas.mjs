// Recorre las páginas de electrónica (solo lectura) y anota los visores de cada una.
export default async (pagina) => {
  const slugs = (process.env.SLUGS || 'arquitectura,potencia,esquematicos,pcb,cableado,pinout,sensores-actuadores,bom,pruebas,problemas').split(',');
  const res = {};
  for (const s of slugs) {
    await pagina.goto(`https://docs.vanttec.workers.dev/uuv/${process.env.DISC || 'electronica'}/?p=${s}`, { waitUntil: 'load' });
    await pagina.waitForTimeout(5000);
    res[s] = await pagina.evaluate(() => {
      const lectura = document.querySelector('[data-hw-lectura], .hw-lectura, main') ?? document;
      return {
        kicad: [...lectura.querySelectorAll('figure.hw-kicad')].map((f) => f.querySelector('[role=region]')?.getAttribute('aria-label') ?? f.querySelector('[role=status]')?.textContent?.slice(0, 30) ?? 'sin montar'),
        figuras: [...lectura.querySelectorAll('figure')].map((f) => f.className || '(sin clase)'),
        iframes: [...document.querySelectorAll('iframe')].map((i) => (i.getAttribute('src') ?? '').slice(0, 80)),
        imagenes: lectura.querySelectorAll('.prose img, figure img').length,
        editarDiagrama: [...document.querySelectorAll('button[data-fuente]')].map((b) => b.dataset.editor),
        texto: (document.querySelector('.prose')?.textContent ?? '').trim().length,
      };
    });
  }
  return res;
};
