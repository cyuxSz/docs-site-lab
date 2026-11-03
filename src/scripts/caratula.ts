// Carátula del proyecto: redirige las anclas de la portada vieja y rellena las cifras de Electrónica y Mecánica.
import { redirigirAncla, datosTarjeta, textoCifras } from "../lib/caratula";

const id = location.pathname.split("/")[1] ?? "";

// replace: la carátula no queda en el historial y «atrás» no rebota.
const destino = redirigirAncla(id, location.hash);
if (destino) location.replace(destino);
else if (document.querySelector("[data-caratula-redirige]")) location.replace(`/${id}/software/`);

document.querySelectorAll<HTMLElement>("[data-caratula-hw]").forEach(async (tarjeta) => {
  const cifras = tarjeta.querySelector<HTMLElement>("[data-caratula-cifras]");
  if (!cifras) return;
  try {
    const q = new URLSearchParams({ proyecto: tarjeta.dataset.proyecto ?? "", disciplina: tarjeta.dataset.caratulaHw ?? "" });
    const r = await fetch(`/api/hardware/?${q}`, { credentials: "same-origin" });
    if (r.status !== 200) return;
    const d = datosTarjeta(await r.json());
    // Sin sesión, con error o con otra forma: el hueco queda vacío y la tarjeta sigue siendo un enlace.
    if (d) cifras.textContent = textoCifras(d);
  } catch {}
});
