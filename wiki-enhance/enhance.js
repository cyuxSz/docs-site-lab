// Capa sobre el visor exportado de OpenWiki (no modifica su código):
//  - Enlaces directos: #p=<id de página> abre esa página, y la URL se actualiza al navegar.
//  - Celular: pestañas Páginas / Grafo / Leer, un panel a la vez.
//  - Dentro de un iframe, evita que el visor arrastre el scroll de la página que lo contiene.
(function () {
  const mobile = window.matchMedia("(max-width: 760px)");
  const body = document.body;

  // Tabs
  const tabs = document.createElement("nav");
  tabs.className = "m-tabs";
  tabs.setAttribute("role", "tablist");
  const labels = { pages: "Páginas", graph: "Grafo", read: "Leer" };
  for (const [key, text] of Object.entries(labels)) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.tab = key;
    b.setAttribute("role", "tab");
    b.textContent = text;
    b.addEventListener("click", () => setTab(key));
    tabs.append(b);
  }
  body.append(tabs);

  const fitGraph = () => {
    const g = window.__openwikiGraph;
    if (!g || !mobile.matches) return;
    g.zoomToFit(400, 48);
    // Si la simulación aún se movía, un segundo encuadre corrige lo que quedó fuera.
    setTimeout(() => g.zoomToFit(300, 48), 700);
  };

  function setTab(key) {
    body.dataset.mtab = key;
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.tab === key));
    if (key === "graph") fitGraph();
  }
  setTab("pages");
  // El layout tarda en asentarse; se encuadra una vez cuando termina.
  setTimeout(fitGraph, 2000);

  // Al abrir una página (desde la lista, el grafo o un enlace), en celular se pasa a "Leer".
  // La primera página que el visor abre solo al cargar no cuenta como elección del usuario.
  let lastActive = null;
  let userActed = false;
  for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, () => (userActed = true), true);
  const sidebar = document.getElementById("sidebar");
  const onSelection = () => {
    const active = sidebar.querySelector(".nav-item.active");
    const id = active && active.dataset.id;
    if (!id || id === lastActive) return;
    lastActive = id;
    history.replaceState(null, "", "#p=" + encodeURIComponent(id));
    if (mobile.matches && userActed) setTab("read");
  };
  new MutationObserver(onSelection).observe(sidebar, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });

  // Enlace directo inicial
  function openFromHash() {
    const m = location.hash.match(/^#p=(.+)$/);
    if (!m) return false;
    const id = decodeURIComponent(m[1]);
    const btn = [...sidebar.querySelectorAll(".nav-item")].find((b) => b.dataset.id === id);
    if (!btn) return false;
    btn.click();
    if (mobile.matches) setTab("read");
    return true;
  }
  if (location.hash) {
    const wait = new MutationObserver(() => {
      if (openFromHash()) wait.disconnect();
    });
    wait.observe(sidebar, { childList: true, subtree: true });
    openFromHash();
  }
  window.addEventListener("hashchange", openFromHash);

  // En un iframe, scrollIntoView del índice movería también la página padre.
  if (window.self !== window.top) {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg) {
      if (this.closest && this.closest("#sidebar")) {
        const box = this.closest("#sidebar");
        const top = this.offsetTop - box.clientHeight / 2;
        box.scrollTo({ top: Math.max(0, top) });
        return;
      }
      return original.call(this, arg);
    };
  }
})();
