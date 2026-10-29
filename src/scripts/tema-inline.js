// Tema claro/oscuro: se aplica en <head>, antes de pintar, para que no parpadee. Sin preferencia guardada se queda el
// oscuro (el de vanttec.com). Va en línea; astro.config.mjs agrega su hash a la CSP. El botón de Base.astro lo cambia.
(function () {
  try {
    if (localStorage.getItem("tema") === "light") document.documentElement.dataset.theme = "light";
  } catch (e) {}
})();
