// Prueba A: búsqueda Pagefind, editor Milkdown, Excalidraw y diagrams.net en la ventana de la app.
// Solo lectura: toda petición que no sea GET al portal se aborta y se anota; no se pulsa «Guardar».
export default async (pagina) => {
  const BASE = 'https://docs.vanttec.workers.dev';
  const r = { escriturasAbortadas: [], consola: [] };
  await pagina.route(BASE + '/**', (ruta) => {
    const q = ruta.request();
    if (q.method() === 'GET') return ruta.continue();
    r.escriturasAbortadas.push(q.method() + ' ' + q.url().replace(BASE, ''));
    return ruta.abort();
  });
  const alConsola = (m) => { if (m.type() === 'error') r.consola.push(m.text().slice(0, 200)); };
  const alDialogo = (d) => d.accept().catch(() => {});
  pagina.on('console', alConsola); pagina.on('dialog', alDialogo);
  const paso = async (nombre, f) => { try { r[nombre] = await f(); } catch (e) { r[nombre] = { error: String(e).split('\n')[0].slice(0, 220) }; } };

  await paso('pagefind', async () => {
    await pagina.goto(BASE + '/uuv/', { waitUntil: 'load' });
    await pagina.locator('.search-btn').first().click();
    const campo = pagina.locator('input.pagefind-ui__search-input');
    await campo.waitFor({ timeout: 15000 });
    await campo.fill('control');
    await pagina.locator('.pagefind-ui__result').first().waitFor({ timeout: 15000 });
    const res = { resultados: await pagina.locator('.pagefind-ui__result').count(), primero: (await pagina.locator('.pagefind-ui__result-link').first().innerText()).slice(0, 80) };
    await pagina.keyboard.press('Escape');
    return res;
  });

  await paso('editorMilkdown', async () => {
    await pagina.goto(BASE + '/uuv/electronica/?p=potencia', { waitUntil: 'load' });
    await pagina.getByRole('button', { name: 'Editar', exact: true }).click({ timeout: 15000 });
    await pagina.locator('.ProseMirror, textarea#hw-md').first().waitFor({ state: 'visible', timeout: 30000 });
    await pagina.waitForTimeout(2500);
    return pagina.evaluate(() => {
      const pm = document.querySelector('.ProseMirror');
      const visible = (e) => !!e && e.getClientRects().length > 0;
      return { proseMirrorVisible: visible(pm), editable: pm?.isContentEditable ?? null, milkdown: !!document.querySelector('.milkdown'),
        textareaVisible: visible(document.querySelector('textarea#hw-md')), caracteres: pm?.textContent.length ?? null };
    });
  });

  for (const editor of ['excalidraw', 'drawio']) {
    await paso(editor, async () => {
      await pagina.getByRole('button', { name: 'Insertar', exact: true }).click({ timeout: 10000 });
      await pagina.getByRole('menuitem', { name: /Diagrama/ }).click({ timeout: 10000 });
      const dlg = pagina.locator('#hw-diagrama-nuevo');
      await dlg.locator(`input[name=editor][value=${editor}]`).check();
      await dlg.locator('input[name=titulo]').fill('prueba lote 0 (no se guarda)');
      await dlg.locator('button[type=submit], button:not([type]):not([data-hw-no])').first().click();
      const lienzo = pagina.locator('#hw-diagrama');
      await lienzo.waitFor({ state: 'visible', timeout: 15000 });
      let res;
      if (editor === 'excalidraw') {
        await lienzo.locator('.excalidraw canvas').first().waitFor({ timeout: 40000 });
        await pagina.waitForTimeout(1500);
        res = await lienzo.evaluate((d) => ({ lienzos: d.querySelectorAll('.excalidraw canvas').length, herramientas: d.querySelectorAll('.excalidraw .ToolIcon').length }));
      } else {
        const marco = lienzo.locator('iframe');
        await marco.waitFor({ timeout: 15000 });
        const src = await marco.getAttribute('src');
        const dentro = pagina.frameLocator('#hw-diagrama iframe');
        await dentro.locator('.geMenubarContainer, .geDiagramContainer, .geToolbarContainer').first().waitFor({ timeout: 60000 });
        res = { src: src.slice(0, 120), interfazCargada: true, contenedores: await dentro.locator('.geDiagramContainer').count() };
      }
      // Cerrar sin guardar.
      await pagina.keyboard.press('Escape');
      await pagina.waitForTimeout(800);
      if (await lienzo.isVisible()) {
        const cerrar = lienzo.getByRole('button', { name: /Cancelar|Cerrar|Descartar|Salir/ }).first();
        if (await cerrar.count()) await cerrar.click().catch(() => {});
        await pagina.waitForTimeout(800);
      }
      const descartar = pagina.locator('#hw-descartar');
      if (await descartar.isVisible().catch(() => false)) await descartar.getByRole('button', { name: /Descartar|Sí|Salir/ }).first().click().catch(() => {});
      await pagina.waitForTimeout(500);
      res.cerrado = !(await lienzo.isVisible());
      return res;
    });
  }

  // Salir descartando todo: recargar sin guardar.
  await pagina.goto(BASE + '/uuv/', { waitUntil: 'load' }).catch(() => {});
  pagina.off('console', alConsola); pagina.off('dialog', alDialogo);
  await pagina.unroute(BASE + '/**');
  return r;
};
