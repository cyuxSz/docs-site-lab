// Panel /<proyecto>/comentarios/: una petición con los hilos abiertos del proyecto; los filtros trabajan en memoria.
import { contadoresNav, enlaceHilo, fechaRelativa, filtrarPanel, mensajeError, partirMenciones, tipoInfo, urlProyecto, type RespuestaPanel } from "../lib/comentarios";
import { guardarCache, pintarBadges } from "./contador-nav";

const raiz = document.querySelector<HTMLElement>(".panel-comentarios[data-panel-comentarios][data-proyecto]");
if (raiz) void iniciar(raiz);

async function iniciar(root: HTMLElement) {
  const proyecto = root.dataset.proyecto ?? "";
  const estado = root.querySelector<HTMLElement>("[data-panel-estado]")!;
  const lista = root.querySelector<HTMLElement>("[data-panel-lista]")!;
  const filtroTipo = root.querySelector<HTMLSelectElement>("#panel-tipo")!;
  const filtroQuien = root.querySelector<HTMLSelectElement>("#panel-quien")!;
  // Título de cada página tomado del enlace de la SideNav; si no hay, la ruta.
  const titulos = new Map<string, string>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>("nav.sidenav a[href]")) {
    const ruta = new URL(a.href, location.href).pathname;
    if (!titulos.has(ruta)) titulos.set(ruta, (a.firstChild?.textContent ?? a.textContent ?? "").trim());
  }

  let datos: RespuestaPanel | null = null;
  let truncado = false;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, clase?: string, txt?: string) => {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    if (txt !== undefined) n.textContent = txt;
    return n;
  };

  function pintar() {
    if (!datos) return;
    const paginas = filtrarPanel(datos.paginas, { tipo: filtroTipo.value, quien: filtroQuien.value }, datos.yo ?? null);
    const grupos = paginas.map((p) => {
      const sec = el("section", "panel-pagina");
      const h2 = el("h2");
      h2.textContent = titulos.get(p.pagina) || p.pagina;
      const ol = el("ol", "panel-hilos");
      for (const h of p.hilos) {
        const li = el("li", "panel-hilo");
        const t = tipoInfo(h.tipo);
        const cab = el("div", "comentario-cab");
        const time = document.createElement("time");
        time.textContent = fechaRelativa(h.creado);
        time.dateTime = h.creado;
        cab.append(el("span", `chip ${t.clase}`, t.etiqueta), el("span", "comentario-autor", h.autor ?? ""), time);
        const extracto = el("p", "comentario-texto");
        for (const trozo of partirMenciones(h.extracto)) extracto.append(trozo.mencion ? el("span", "mencion", trozo.texto) : document.createTextNode(trozo.texto));
        const a = document.createElement("a");
        a.href = enlaceHilo(p.pagina, h.id);
        a.textContent = "Ver en la página";
        li.append(cab, extracto, a);
        ol.append(li);
      }
      sec.append(h2, ol);
      return sec;
    });
    lista.replaceChildren(...grupos);
    estado.textContent = grupos.length ? (truncado ? "Hay más comentarios abiertos de los que se muestran: se listan solo los primeros." : "") : "No hay comentarios abiertos";
  }

  filtroTipo.addEventListener("change", pintar);
  filtroQuien.addEventListener("change", pintar);

  let res: Response;
  try {
    res = await fetch(urlProyecto(proyecto), { cache: "no-store", credentials: "same-origin" });
  } catch {
    estado.textContent = mensajeError("red");
    return;
  }
  if (!res.ok) {
    estado.textContent = mensajeError(res.status, { retryAfter: res.headers.get("Retry-After") });
    return;
  }
  try {
    datos = await res.json();
  } catch {
    estado.textContent = mensajeError("red");
    return;
  }
  if (!datos || !Array.isArray(datos.paginas)) {
    datos = null;
    estado.textContent = mensajeError("red");
    return;
  }
  truncado = datos.truncado === true;
  pintar();
  // Los mismos datos alimentan los badges de la SideNav y su caché.
  const contadores = contadoresNav(datos);
  guardarCache(proyecto, contadores);
  pintarBadges(proyecto, contadores);
}
