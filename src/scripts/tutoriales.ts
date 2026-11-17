// Mini tutoriales en el navegador: lista en /<id>/rutas/ (filtros, estado, reanudar) y checklist en /<id>/rutas/<slug>/.
// Los textos son los del HTML ya renderizado; aquí solo se usa textContent, nunca HTML.
import { almacenSeguro, type Almacen } from "../lib/rutas.ts";
import { enlaceReanudar, estadoTutorial, filtrarTutoriales, hechos, ocultosPorRol, marcarPaso, reiniciarTutorial, textoAccion, type Tutorial } from "../lib/tutoriales.ts";

const alm: Almacen = almacenSeguro(() => localStorage);
const parse = <T,>(s: string | undefined, vacio: T): T => {
  try {
    return JSON.parse(s ?? "") as T;
  } catch {
    return vacio;
  }
};
// Del HTML solo llegan id, rol, disciplina, route y los ids de los pasos.
const comoTutorial = (x: Partial<Tutorial>): Tutorial => ({ titulo: "", descripcion: "", page: "", rol: null, disciplina: "", route: "", id: "", ...x, pasos: x.pasos ?? [] }) as Tutorial;

// --- Lista ---
const lista = document.querySelector<HTMLElement>(".tutoriales[data-proyecto]");
if (lista) {
  const proyecto = lista.dataset.proyecto!;
  const todos = parse<Partial<Tutorial>[]>(lista.dataset.tutoriales, []).map(comoTutorial);
  const conteo = lista.querySelector<HTMLElement>("[data-conteo]");
  let rol: string | null = document.querySelector<HTMLInputElement>(".rutas input[name='rol']:checked")?.value ?? null;
  let disciplina = "todas";
  let verTodos = false;
  const otros = lista.querySelector<HTMLElement>("[data-otros-texto]");
  const btnTodos = lista.querySelector<HTMLButtonElement>("[data-ver-todos]");

  const pintar = () => {
    const visibles = new Set(filtrarTutoriales(todos, { rol: verTodos ? null : rol, disciplina }).map((t) => t.id));
    for (const t of todos) {
      const li = lista.querySelector<HTMLElement>(`[data-tutorial="${CSS.escape(t.id)}"]`);
      if (!li) continue;
      li.hidden = !visibles.has(t.id);
      const e = estadoTutorial(alm, proyecto, t);
      const est = li.querySelector<HTMLElement>("[data-estado]");
      if (est) est.textContent = e.estado === "completo" ? `Completo · ${e.texto}` : `${e.texto} pasos`;
      const acc = li.querySelector<HTMLAnchorElement>("[data-accion]");
      if (acc) {
        acc.textContent = textoAccion(e);
        acc.href = enlaceReanudar(t, e);
      }
    }
    for (const g of lista.querySelectorAll<HTMLElement>("[data-grupo]")) g.hidden = !g.querySelector("[data-tutorial]:not([hidden])");
    const n = verTodos ? 0 : ocultosPorRol(todos, { rol, disciplina });
    if (otros) otros.textContent = n ? `Hay ${n} ${n === 1 ? "tutorial" : "tutoriales"} de otros roles.` : "";
    if (btnTodos) btnTodos.hidden = !n;
    if (conteo) conteo.textContent = `${visibles.size} ${visibles.size === 1 ? "tutorial" : "tutoriales"}`;
  };

  lista.addEventListener("change", (e) => {
    const r = e.target as HTMLInputElement;
    if (r.name !== "tutorial-disciplina" || !r.checked) return;
    disciplina = r.value;
    pintar();
  });
  btnTodos?.addEventListener("click", () => {
    verTodos = true;
    pintar();
    btnTodos.hidden = true;
    lista.querySelector<HTMLElement>("input[name='tutorial-disciplina']:checked")?.focus();
  });
  // RutasRol avisa del rol elegido; los tutoriales sin rol siempre salen.
  document.addEventListener("rutas:rol", (e) => {
    rol = (e as CustomEvent<{ rol: string }>).detail?.rol ?? null;
    verTodos = false;
    pintar();
  });
  pintar();
}

// --- Página de un tutorial ---
const raiz = document.querySelector<HTMLElement>(".tutorial[data-proyecto]");
if (raiz) {
  const proyecto = raiz.dataset.proyecto!;
  const tut = comoTutorial(parse<Partial<Tutorial>>(raiz.dataset.tutorial, {}));
  const cajas = [...raiz.querySelectorAll<HTMLInputElement>("input[type='checkbox'][data-paso]")];
  const bar = raiz.querySelector<HTMLProgressElement>("progress");
  const cont = raiz.querySelector<HTMLElement>("[data-contador]");

  const pintar = () => {
    const l = hechos(alm, proyecto, tut);
    const e = estadoTutorial(alm, proyecto, tut);
    tut.pasos.forEach((p, i) => {
      const c = cajas.find((x) => x.dataset.paso === p.id);
      if (c) c.checked = l[i];
    });
    if (bar) bar.value = e.hechos;
    if (cont) cont.textContent = `${e.texto} pasos hechos`;
    return e;
  };
  const enfocar = (id: string | undefined) => {
    cajas.find((x) => x.dataset.paso === id)?.focus();
  };

  pintar();
  raiz.addEventListener("change", (ev) => {
    const c = ev.target as HTMLInputElement;
    if (c.type !== "checkbox" || !c.dataset.paso) return;
    marcarPaso(alm, proyecto, tut.id, c.dataset.paso, c.checked);
    pintar();
  });

  raiz.querySelector("[data-reanudar]")?.addEventListener("click", () => {
    const e = pintar();
    if (e.siguiente !== null) enfocar(tut.pasos[e.siguiente]?.id);
  });

  const dlg = raiz.querySelector<HTMLDialogElement>("dialog");
  const btn = raiz.querySelector<HTMLButtonElement>("[data-reiniciar]");
  dlg?.querySelector("[data-reiniciar-ok]")?.addEventListener("click", () => {
    reiniciarTutorial(alm, proyecto, tut);
    pintar();
    dlg.close();
  });
  dlg?.querySelector("[data-reiniciar-cancelar]")?.addEventListener("click", () => dlg.close());
  // Esc, Cancelar o Reiniciar: el foco vuelve al botón que abrió el diálogo.
  dlg?.addEventListener("close", () => btn?.focus());
  btn?.addEventListener("click", () => dlg?.showModal());

  // Llegar con #paso-<id> (desde "Reanudar" de la lista) enfoca ese paso.
  const alAncla = () => {
    let h = location.hash;
    try {
      h = decodeURIComponent(h);
    } catch {}
    const m = h.match(/^#paso-(.+)$/);
    if (m) enfocar(m[1]);
  };
  alAncla();
  window.addEventListener("hashchange", alAncla);
}
