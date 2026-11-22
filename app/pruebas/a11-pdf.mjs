// PDF en <iframe> (página local /pdf-marco): ¿lo pinta el visor integrado de WebView2?
export default async (pagina) => {
  await pagina.goto('http://127.0.0.1:8799/pdf-marco');
  await pagina.waitForTimeout(4000);
  await pagina.screenshot({ path: process.env.CAPTURA || 'pdf.png' });
  const marco = pagina.frames().find((f) => f.url().endsWith('/pdf'));
  return {
    pdfViewerEnabled: await pagina.evaluate(() => navigator.pdfViewerEnabled),
    marcos: pagina.frames().map((f) => f.url().slice(0, 80)),
    embedEnMarco: marco ? await marco.evaluate(() => document.querySelector('embed')?.type ?? null).catch((e) => String(e).slice(0, 80)) : null,
  };
};
