// Rutas por rol en el navegador: página /<id>/rutas/ (checklist) y bloque "Ruta X · paso N de M" al pie de cada paso.
// El texto de la wiki llega por atributos de datos y se pinta con textContent; nunca con HTML.
import { almacenSeguro, claveRol, leidos, marcar, pasoEnPagina, progreso, reiniciar, rolGuardado, type Ruta } from "../lib/rutas.ts";

const alm = almacenSeguro(() => localStorage);
const parse = (s: string | undefined): Ruta[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// --- Página de rutas ---
const root = document.querySelector<HTMLElement>(".rutas[data-proyecto]");
if (root) {
  const proyecto = root.dataset.proyecto!;
  const rutas = parse(root.dataset.rutas);
  const radios = [...root.querySelectorAll<HTMLInputElement>("input[name='rol']")];
  const panels = [...root.querySelectorAll<HTMLElement>(".rutas-panel")];

  const pintar = (ruta: Ruta, panel: HTMLElement) => {
    const l = leidos(alm, proyecto, ruta);
    const pr = progreso(l);
    panel.querySelectorAll<HTMLInputElement>("input[type='checkbox']").forEach((c) => (c.checked = l[Number(c.dataset.i)]));
    const bar = panel.querySelector<HTMLProgressElement>("progress");
    if (bar) bar.value = pr.hechos;
    const cont = panel.querySelector<HTMLElement>(".rutas-contador");
    if (cont) cont.textContent = `${pr.texto} pasos leídos`;
    const btn = panel.querySelector<HTMLButtonElement>("[data-continuar]");
    if (btn) {
      btn.disabled = pr.siguiente === null;
      btn.textContent = pr.siguiente === null ? "Ruta completa" : "Continuar con el siguiente paso";
    }
  };

  const mostrar = (id: string) => {
    for (const panel of panels) panel.hidden = panel.dataset.rol !== id;
    for (const r of radios) r.checked = r.value === id;
    const ruta = rutas.find((x) => x.id === id);
    const panel = panels.find((x) => x.dataset.rol === id);
    if (ruta && panel) pintar(ruta, panel);
  };

  const inicial = rolGuardado(alm, proyecto, rutas) ?? rutas[0]?.id;
  if (inicial) mostrar(inicial);

  radios.forEach((r) =>
    r.addEventListener("change", () => {
      if (!r.checked) return;
      alm.set(claveRol(proyecto), r.value);
      mostrar(r.value);
    }),
  );

  const dlg = root.querySelector<HTMLDialogElement>("dialog#rutas-reiniciar");
  const txt = dlg?.querySelector<HTMLElement>("#rutas-reiniciar-texto");
  let pendiente: (() => void) | null = null;
  let origen: HTMLElement | null = null;
  dlg?.querySelector("[data-reiniciar-ok]")?.addEventListener("click", () => {
    const f = pendiente;
    pendiente = null;
    dlg.close();
    f?.();
  });
  dlg?.querySelector("[data-reiniciar-cancelar]")?.addEventListener("click", () => dlg.close());
  // Esc y cualquier otro cierre devuelven el foco al botón que abrió el diálogo.
  dlg?.addEventListener("close", () => {
    pendiente = null;
    origen?.focus();
  });

  for (const panel of panels) {
    const ruta = rutas.find((x) => x.id === panel.dataset.rol);
    if (!ruta) continue;
    panel.addEventListener("change", (e) => {
      const c = e.target as HTMLInputElement;
      if (c.type !== "checkbox") return;
      marcar(alm, proyecto, ruta.id, Number(c.dataset.i), c.checked);
      pintar(ruta, panel);
    });
    panel.querySelector("[data-continuar]")?.addEventListener("click", () => {
      const { siguiente } = progreso(leidos(alm, proyecto, ruta));
      if (siguiente !== null) location.href = ruta.pasos[siguiente].route;
    });
    const btnReiniciar = panel.querySelector<HTMLButtonElement>("[data-reiniciar]");
    btnReiniciar?.addEventListener("click", () => {
      if (!dlg) return;
      if (txt) txt.textContent = `¿Reiniciar la ruta ${ruta.nombre}? Se borrará lo que marcaste como leído.`;
      pendiente = () => {
        reiniciar(alm, proyecto, ruta);
        pintar(ruta, panel);
      };
      origen = btnReiniciar;
      dlg.showModal();
    });
  }
}

// --- Bloque al pie de un paso ---
const pie = document.querySelector<HTMLElement>("aside.ruta-paso[data-proyecto]");
if (pie) {
  const proyecto = pie.dataset.proyecto!;
  const page = pie.dataset.page!;
  const rutas = parse(pie.dataset.rutas);
  const ruta = rutas.find((r) => r.id === rolGuardado(alm, proyecto, rutas));
  if (ruta) {
    const l = leidos(alm, proyecto, ruta);
    const i = pasoEnPagina(ruta, page, l);
    if (i >= 0) {
      const estado = document.createElement("p");
      estado.className = "ruta-paso-estado";
      estado.textContent = `Ruta ${ruta.nombre} · paso ${i + 1} de ${ruta.pasos.length}`;

      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = l[i];
      box.addEventListener("change", () => marcar(alm, proyecto, ruta.id, i, box.checked));
      label.append(box, document.createTextNode(" Marcar como leído"));

      const nav = document.createElement("a");
      const sig = ruta.pasos[i + 1];
      if (sig) {
        nav.href = sig.route;
        nav.textContent = `Siguiente: ${sig.title}`;
      } else {
        nav.href = `/${proyecto}/rutas/`;
        nav.textContent = "Volver a Rutas por rol";
      }
      pie.replaceChildren(estado, label, nav);
      pie.hidden = false;
    }
  }
}
