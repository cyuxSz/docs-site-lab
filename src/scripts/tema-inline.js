// Tema claro/oscuro: se aplica en <head>, antes de pintar, para que no parpadee. Sin preferencia guardada se queda el
// oscuro (el de vanttec.com). Va en línea; astro.config.mjs agrega su hash a la CSP. El botón de Base.astro lo cambia.
(function () {
  // JS disponible: el CSS oculta el panel del menú de página y muestra su botón solo con este atributo.
  try {
    document.documentElement.setAttribute("data-js", "");
  } catch (e) {}
  try {
    var d = document.documentElement.dataset;
    if (localStorage.getItem("tema") === "light") d.theme = "light";
    // Letra y ancho de lectura (lote 4b-1), con lista blanca; el valor por defecto no pone atributo.
    var letra = localStorage.getItem("lectura:letra");
    if (letra === "s" || letra === "l") d.letra = letra;
    var ancho = localStorage.getItem("lectura:ancho");
    if (ancho === "estrecho" || ancho === "ancho") d.ancho = ancho;
    // Barras plegadas de la wiki (lote 8a): solo "plegada"; el modo enfoque nunca se aplica aquí.
    if (localStorage.getItem("wiki:barra-izq") === "plegada") d.barraIzq = "plegada";
    if (localStorage.getItem("wiki:barra-der") === "plegada") d.barraDer = "plegada";
  } catch (e) {}
})();
