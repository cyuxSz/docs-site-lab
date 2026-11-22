export default async (pagina) =>
  pagina.evaluate(() => ({
    url: location.href,
    nav: [...document.querySelectorAll('nav a, nav button, aside a, aside button')].map((e) => `${e.tagName}|${e.textContent.trim().slice(0, 30)}|${e.getAttribute('href') ?? ''}|${e.className}`).slice(0, 60),
    figuras: [...document.querySelectorAll('figure')].map((f) => f.outerHTML.replace(/<kicanvas-source>[\s\S]*?<\/kicanvas-source>/, '<kicanvas-source>…</kicanvas-source>').slice(0, 700)),
  }));
