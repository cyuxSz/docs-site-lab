// Prueba A/B: ?diseno=a|b manda; si no, se reusa la de la última visita o se sortea. Va en línea en <head>, antes de
// pintar, para que el CSS de cada diseño no cause saltos. astro.config.mjs agrega su hash a la CSP.
(function () {
  var d = new URLSearchParams(location.search).get("diseno");
  var ok = function (v) { return v === "a" || v === "b"; };
  try {
    if (ok(d)) localStorage.setItem("diseno", d);
    else d = localStorage.getItem("diseno");
    if (!ok(d)) { d = Math.random() < 0.5 ? "a" : "b"; localStorage.setItem("diseno", d); }
  } catch (e) {
    if (!ok(d)) d = "a";
  }
  document.documentElement.dataset.diseno = d;
})();
