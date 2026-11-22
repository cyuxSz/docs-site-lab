// Diagnóstico del 503 de adjuntos (solo GET): la lista usa solo D1; la descarga usa D1 + R2.
export default async (pagina) =>
  pagina.evaluate(async () => {
    const ver = async (url) => {
      const r = await fetch(url, { cache: 'no-store' });
      const cuerpo = await r.text();
      return { url, estado: r.status, tipo: r.headers.get('content-type'), bytes: cuerpo.length, inicio: r.ok ? undefined : cuerpo.slice(0, 200) };
    };
    const lista = await fetch('/api/archivos/?proyecto=uuv&lista=1', { cache: 'no-store' });
    const datos = lista.ok ? await lista.json() : { error: await lista.text() };
    const archivos = datos.archivos ?? [];
    const res = { lista: { estado: lista.status, total: archivos.length, error: datos.error }, capacidades: await ver('/api/archivos/?capacidades=1'), descargas: [] };
    // Uno de cada tipo, como mucho 5 descargas.
    const vistos = new Set();
    for (const a of archivos) {
      if (vistos.has(a.tipo) || vistos.size >= 5) continue;
      vistos.add(a.tipo);
      res.descargas.push({ tipo: a.tipo, tamano: a.tamano, fecha: a.fecha, ...(await ver(`/api/archivos/?proyecto=uuv&id=${a.id}`)) });
    }
    return res;
  });
