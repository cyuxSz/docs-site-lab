// QoL personal en el navegador: continuar donde te quedaste, favoritos y aviso de cambios.
// Los textos (títulos de la wiki o de localStorage) se pintan con textContent; nunca con HTML.
import { almacenSeguro } from "../lib/rutas.ts";
import {
  alternarFavorito,
  debeRestaurar,
  esFavorito,
  favoritos,
  fraccionScroll,
  guardarVisita,
  posicionScroll,
  quitarFavorito,
  revisarCambio,
  ultimaVisita,
  urlContinuar,
} from "../lib/personal.ts";

const alm = almacenSeguro(() => localStorage);
const pagina = document.querySelector<HTMLElement>("[data-pagina]");
const estrella = document.querySelector<HTMLButtonElement>("[data-favorito]");

const proyectoActual = (): string | undefined => pagina?.dataset.proyecto ?? document.querySelector<HTMLElement>("[data-continuar-visita], [data-favoritos-lista]")?.dataset.proyecto;

// --- Estrella ---
const pintarEstrella = () => {
  if (!pagina || !estrella) return;
  const fav = esFavorito(alm, pagina.dataset.proyecto!, pagina.dataset.route!);
  estrella.setAttribute("aria-pressed", String(fav));
  const etiqueta = fav ? "Quitar de favoritos" : "Guardar en favoritos";
  estrella.setAttribute("aria-label", etiqueta);
  estrella.setAttribute("title", etiqueta);
};

// --- Listas de favoritos (SideNav y portada) ---
const listas = [...document.querySelectorAll<HTMLElement>("[data-favoritos-lista]")];
const pintarListas = () => {
  for (const caja of listas) {
    const p = caja.dataset.proyecto ?? proyectoActual();
    if (!p) continue;
    const items = favoritos(alm, p);
    caja.querySelector("ul")?.remove();
    caja.hidden = items.length === 0;
    if (!items.length) continue;
    const ul = document.createElement("ul");
    for (const f of items) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = f.route;
      a.textContent = f.title;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "favorito-quitar";
      b.textContent = "Quitar";
      b.setAttribute("aria-label", `Quitar ${f.title} de favoritos`);
      b.addEventListener("click", () => {
        quitarFavorito(alm, p, f.route);
        pintarListas();
        pintarEstrella();
      });
      li.append(a, b);
      ul.append(li);
    }
    caja.append(ul);
  }
};
pintarListas();

if (pagina && estrella) {
  const p = pagina.dataset.proyecto!;
  const route = pagina.dataset.route!;
  const title = pagina.dataset.title ?? "";
  estrella.hidden = false;
  // La estrella va junto al H1 de la página: un contenedor en fila con el título y el botón.
  const h1 = document.querySelector<HTMLElement>(".prose h1");
  if (h1) {
    const fila = document.createElement("div");
    fila.className = "titulo-pagina";
    h1.before(fila);
    fila.append(h1, estrella);
  }
  pintarEstrella();
  estrella.addEventListener("click", () => {
    alternarFavorito(alm, p, { route, title });
    pintarEstrella();
    pintarListas();
  });

  // --- Aviso de cambios ---
  const aviso = pagina.querySelector<HTMLElement>(".aviso-cambio");
  if (aviso && revisarCambio(alm, p, route, pagina.dataset.firma ?? "")) aviso.hidden = false;
  pagina.querySelector("[data-descartar]")?.addEventListener("click", () => {
    if (aviso) aviso.hidden = true;
  });

  // --- Visita y scroll ---
  const medir = () => fraccionScroll(scrollY, document.documentElement.scrollHeight, innerHeight);
  const guardar = () => guardarVisita(alm, p, { route, title, scroll: medir() });
  const previa = ultimaVisita(alm, p);
  if (debeRestaurar(previa, location.pathname, location.search) && previa) {
    scrollTo(0, posicionScroll(previa.scroll, document.documentElement.scrollHeight, innerHeight));
    const url = new URL(location.href);
    url.searchParams.delete("continuar");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
  guardar();
  let espera = 0;
  addEventListener(
    "scroll",
    () => {
      if (espera) return;
      espera = window.setTimeout(() => {
        espera = 0;
        guardar();
      }, 400);
    },
    { passive: true },
  );
  addEventListener("pagehide", guardar);
}

// --- Tarjeta "Continuar" de la portada ---
const tarjeta = document.querySelector<HTMLAnchorElement>("a[data-continuar-visita]");
if (tarjeta?.dataset.proyecto) {
  const v = ultimaVisita(alm, tarjeta.dataset.proyecto);
  if (v) {
    tarjeta.href = urlContinuar(v);
    tarjeta.textContent = `Continuar: ${v.title}`;
    tarjeta.hidden = false;
  }
}
