// Diagnóstico del zoom de KiCanvas: manda entrada real por CDP (rueda, Ctrl+rueda, pellizco)
// sobre el primer visor de la página actual y mira si cambia el zoom de la cámara.
export default async (pagina) => {
  const leer = () => pagina.evaluate(() => {
    const buscar = (raiz, p = 0) => {
      if (!raiz || p > 8) return null;
      for (const el of raiz.querySelectorAll('*')) if (/^kc-(schematic|board)-viewer$/i.test(el.tagName)) return el;
      for (const el of raiz.querySelectorAll('*')) if (el.shadowRoot) { const v = buscar(el.shadowRoot, p + 1); if (v) return v; }
      return null;
    };
    const embed = document.querySelector('kicanvas-embed');
    const visor = buscar(embed?.shadowRoot);
    const cam = visor?.viewer?.viewport?.camera;
    const r = embed?.getBoundingClientRect();
    return {
      visor: visor?.tagName ?? null, cargado: visor?.loaded ?? null,
      zoom: cam ? Number(cam.zoom.toFixed(4)) : null, centro: cam ? [Math.round(cam.center.x), Math.round(cam.center.y)] : null,
      caja: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
      escalaPagina: visualViewport.scale, dpr: devicePixelRatio, prefs: localStorage.getItem('kc:prefs'),
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
    };
  });
  await pagina.evaluate(() => document.querySelector('kicanvas-embed')?.scrollIntoView({ block: 'center' }));
  await pagina.waitForTimeout(500);
  const pasos = { inicio: await leer() };
  const [x, y, w, h] = pasos.inicio.caja;
  const cx = x + w / 2, cy = y + h / 2;
  await pagina.evaluate(() => {
    window.__ruedas = [];
    addEventListener('wheel', (e) => window.__ruedas.push({ dY: e.deltaY, ctrl: e.ctrlKey, prevenido: e.defaultPrevented, destino: e.composedPath()[0]?.tagName }), { capture: false, passive: true });
  });
  await pagina.mouse.move(cx, cy);

  await pagina.mouse.wheel(0, -300);
  await pagina.waitForTimeout(400);
  pasos.ruedaSinClic = await leer();

  await pagina.mouse.click(cx, cy);
  await pagina.mouse.wheel(0, -300);
  await pagina.waitForTimeout(400);
  pasos.ruedaTrasClic = await leer();

  await pagina.keyboard.down('Control');
  await pagina.mouse.wheel(0, -300);
  await pagina.keyboard.up('Control');
  await pagina.waitForTimeout(400);
  pasos.ctrlRueda = await leer();

  const cdp = await pagina.context().newCDPSession(pagina);
  try {
    await cdp.send('Input.synthesizePinchGesture', { x: cx, y: cy, scaleFactor: 2, gestureSourceType: 'touch' });
    await pagina.waitForTimeout(400);
    pasos.pellizcoTactil = await leer();
  } catch (e) { pasos.pellizcoTactil = { error: String(e).slice(0, 200) }; }
  try {
    await cdp.send('Input.synthesizePinchGesture', { x: cx, y: cy, scaleFactor: 2, gestureSourceType: 'mouse' });
    await pagina.waitForTimeout(400);
    pasos.pellizcoTouchpad = await leer();
  } catch (e) { pasos.pellizcoTouchpad = { error: String(e).slice(0, 200) }; }

  pasos.ruedasVistasPorLaPagina = await pagina.evaluate(() => window.__ruedas);
  const scrollY = await pagina.evaluate(() => scrollY);
  return { url: pagina.url(), scrollY, pasos };
};
