// Lectura en la página de la wiki: resalta el término de ?q= (lo pone Pagefind) y ajusta letra y ancho.
// Todo el texto (de la wiki y de la URL) se pinta con nodos DOM y textContent; nunca con HTML.
import { CLAVE_ANCHO, CLAVE_LETRA, coincidencias, normalizarAncho, normalizarLetra, PARAM_RESALTADO, terminosResaltado } from "../lib/lectura.ts";
import { almacenSeguro } from "../lib/rutas.ts";

const alm = almacenSeguro(() => localStorage);
const MAX_MARCAS = 200;

// --- Letra y ancho ---
const ajustes = document.querySelector<HTMLElement>("[data-lectura-ajustes]");
if (ajustes) {
  const html = document.documentElement;
  const marcar = (name: string, valor: string) => ajustes.querySelectorAll<HTMLInputElement>(`input[name='${name}']`).forEach((r) => (r.checked = r.value === valor));
  marcar("letra", normalizarLetra(html.dataset.letra));
  marcar("ancho", normalizarAncho(html.dataset.ancho));
  const poner = (clave: string, attr: "letra" | "ancho", valor: string, defecto: string) => {
    alm.set(clave, valor);
    if (valor === defecto) delete html.dataset[attr];
    else html.dataset[attr] = valor;
  };
  ajustes.addEventListener("change", (e) => {
    const r = e.target as HTMLInputElement;
    if (r.name === "letra") poner(CLAVE_LETRA, "letra", normalizarLetra(r.value), "m");
    else if (r.name === "ancho") poner(CLAVE_ANCHO, "ancho", normalizarAncho(r.value), "normal");
  });
}

// --- Resaltado del término buscado ---
const barra = document.querySelector<HTMLElement>("[data-resaltado]");
const prose = document.querySelector<HTMLElement>(".prose");
const params = new URLSearchParams(location.search);
// Pagefind agrega un ?q= por cada palabra buscada.
const q = params.getAll(PARAM_RESALTADO).join(" ");
const terminos = terminosResaltado(q);

if (barra && prose && terminos.length) {
  const saltar = "pre, svg, .mermaid, .anchor, button, mark, script, style, .lectura-meta";
  const nodos: Text[] = [];
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(saltar) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodos.push(n as Text);

  const marcas: HTMLElement[] = [];
  for (const nodo of nodos) {
    if (marcas.length >= MAX_MARCAS) break;
    const ms = coincidencias(nodo.data, terminos).slice(0, MAX_MARCAS - marcas.length);
    // De atrás hacia adelante para que los índices del texto original sigan valiendo.
    const delNodo: HTMLElement[] = [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const [ini, fin] = ms[i];
      const resto = nodo.splitText(ini);
      resto.splitText(fin - ini);
      const mark = document.createElement("mark");
      mark.className = "resaltado";
      resto.parentNode!.replaceChild(mark, resto);
      mark.append(resto);
      delNodo.unshift(mark);
    }
    marcas.push(...delNodo);
  }

  const texto = barra.querySelector<HTMLElement>("[data-resaltado-texto]") ?? barra.firstElementChild;
  const termino = q.trim().replace(/\s+/g, " ").slice(0, 80);
  if (texto) texto.textContent = marcas.length ? `${marcas.length}${marcas.length >= MAX_MARCAS ? "+" : ""} ${marcas.length === 1 ? "coincidencia" : "coincidencias"} de «${termino}»` : `No se encontró «${termino}» en esta página`;
  barra.hidden = false;

  if (marcas.length) {
    const reducido = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let destino = marcas[0];
    const ancla = location.hash.length > 1 ? decodeURIComponent(location.hash.slice(1)) : "";
    const el = ancla ? document.getElementById(ancla) : null;
    if (el) destino = marcas.find((m) => el.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) ?? marcas[0];
    destino.scrollIntoView({ block: "center", behavior: reducido ? "auto" : "smooth" });
  }

  barra.querySelector("[data-quitar-resaltado]")?.addEventListener("click", () => {
    for (const m of prose.querySelectorAll("mark.resaltado")) {
      const padre = m.parentNode;
      if (!padre) continue;
      m.replaceWith(document.createTextNode(m.textContent ?? ""));
      padre.normalize();
    }
    barra.hidden = true;
    const url = new URL(location.href);
    url.searchParams.delete(PARAM_RESALTADO);
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  });
}
