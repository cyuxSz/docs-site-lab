// Atajos globales: [ ] f mandan wiki:barras a las barras de la wiki; g w / g g / g n navegan dentro del proyecto y ? abre la ayuda. Ctrl K y / siguen en Base.astro.
import { atajo, destino } from "../lib/atajos.ts";

const dialogo = document.getElementById("atajos") as HTMLDialogElement | null;
if (dialogo) {
  let pendiente: number | null = null;
  dialogo.querySelector("[data-atajos-cerrar]")?.addEventListener("click", () => dialogo.close());
  document.addEventListener("keydown", (e) => {
    const r = atajo(pendiente, {
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      altGraph: e.getModifierState("AltGraph"),
      escribiendo: Boolean((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")),
      dialogoAbierto: document.querySelector("dialog[open]") !== null,
      t: e.timeStamp,
    });
    pendiente = r.pendiente;
    if (!r.accion) return;
    e.preventDefault();
    if (r.accion === "izquierda" || r.accion === "derecha" || r.accion === "enfoque") {
      document.dispatchEvent(new CustomEvent("wiki:barras", { detail: r.accion }));
      return;
    }
    if (r.accion === "ayuda") {
      dialogo.showModal();
      return;
    }
    const ruta = destino(r.accion, { wiki: dialogo.dataset.wiki, grafo: dialogo.dataset.grafo, novedades: dialogo.dataset.novedades });
    // Solo rutas internas del sitio.
    if (ruta && ruta.startsWith("/") && !ruta.startsWith("//") && !/[\\\u0000-\u001f]/u.test(ruta)) location.href = ruta;
  });
}
