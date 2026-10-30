// Buscador (Ctrl/Cmd+K y "/"): Pagefind UI con carga diferida, búsquedas recientes y ?q= en los resultados.
// El texto de localStorage se pinta solo con textContent; nunca con HTML.
import { agregarReciente, borrarRecientes, PARAM_RESALTADO, recientes } from "../lib/lectura.ts";
import { almacenSeguro } from "../lib/rutas.ts";

const alm = almacenSeguro(() => localStorage);
const dialog = document.getElementById("search") as HTMLDialogElement;
const extra = dialog.querySelector<HTMLElement>("[data-search-extra]");
const lista = dialog.querySelector<HTMLElement>("[data-recientes]");
const borrar = dialog.querySelector<HTMLButtonElement>("[data-borrar-recientes]");
const bloqueRecientes = lista?.closest<HTMLElement>("[data-bloque-recientes]") ?? null;
const bloqueSugerencias = dialog.querySelector<HTMLElement>("[data-bloque-sugerencias]");

interface PagefindUIInstancia {
  triggerSearch(t: string): void;
}
let ui: PagefindUIInstancia | null = null;
let loaded = false;

const campo = () => dialog.querySelector<HTMLInputElement>("input.pagefind-ui__search-input") ?? dialog.querySelector<HTMLInputElement>("input[type='text'], input:not([type])");

// Recientes: botones con textContent; el bloque (y su botón de borrar) se oculta si no hay ninguno.
function pintarRecientes() {
  if (!lista) return;
  const items = recientes(alm);
  lista.replaceChildren(
    ...items.map((t) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = t;
      b.addEventListener("click", () => {
        const input = campo();
        if (input) input.value = t;
        ui?.triggerSearch(t);
        input?.focus();
        actualizarPanel();
      });
      li.append(b);
      return li;
    }),
  );
  if (bloqueRecientes) bloqueRecientes.hidden = items.length === 0;
  if (borrar) borrar.hidden = items.length === 0;
}

// El panel solo se ve con el campo vacío.
function actualizarPanel() {
  if (!extra) return;
  const vacio = !(campo()?.value ?? "").trim();
  const hayRecientes = lista ? lista.children.length > 0 : false;
  const haySugerencias = bloqueSugerencias ? bloqueSugerencias.querySelector("a") !== null : false;
  extra.hidden = !vacio || (!hayRecientes && !haySugerencias);
  if (bloqueSugerencias) bloqueSugerencias.hidden = !haySugerencias;
}

async function openSearch() {
  pintarRecientes();
  dialog.showModal();
  actualizarPanel();
  if (!loaded) {
    loaded = true;
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/pagefind/pagefind-ui.css";
    document.head.append(css);
    try {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "/pagefind/pagefind-ui.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.append(s);
      });
      // highlightParam: la UI lo reenvía al núcleo (pagefind_options) y los resultados enlazan a …/?q=término.
      // @ts-expect-error global que define pagefind-ui.js
      ui = new window.PagefindUI({ element: "#pagefind", showSubResults: true, resetStyles: false, autofocus: true, highlightParam: PARAM_RESALTADO, openFilters: ["proyecto", "tipo", "paquete"] }) as PagefindUIInstancia;
    } catch {
      document.getElementById("pagefind")!.textContent = "La búsqueda solo existe en el sitio construido (npm run build).";
    }
  }
  campo()?.focus();
  actualizarPanel();
}

document.querySelectorAll("[data-search-open]").forEach((b) => b.addEventListener("click", openSearch));
dialog.querySelector("[data-search-close]")!.addEventListener("click", () => dialog.close());

dialog.addEventListener("input", actualizarPanel);
// El botón de limpiar de Pagefind cambia el valor sin evento "input".
dialog.addEventListener("click", (e) => {
  const el = e.target as Element | null;
  const enlace = el?.closest?.(".pagefind-ui__result-link");
  if (enlace) {
    const t = campo()?.value;
    if (t) agregarReciente(alm, t);
    return;
  }
  if (el?.closest?.(".pagefind-ui__search-clear")) setTimeout(actualizarPanel, 0);
});
borrar?.addEventListener("click", () => {
  borrarRecientes(alm);
  pintarRecientes();
  actualizarPanel();
  campo()?.focus();
});
dialog.addEventListener("close", () => {
  // Al reabrir se vuelve a pintar; aquí solo se evita mostrar datos viejos.
  pintarRecientes();
});

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable]");
  if (e.key === "/" && !typing && !dialog.open) {
    e.preventDefault();
    openSearch();
  }
  // Ctrl/Cmd+K abre la búsqueda también dentro de un campo de texto.
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key?.toLowerCase() === "k") {
    e.preventDefault();
    if (!dialog.open) openSearch();
  }
});
if (/Mac|iPhone|iPad/.test(navigator.platform)) document.querySelectorAll("[data-search-kbd]").forEach((k) => (k.textContent = "⌘K"));
