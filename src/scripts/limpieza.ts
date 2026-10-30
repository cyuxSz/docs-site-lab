// Página de limpieza: casillas "revisado" (localStorage validado), resumen, filtro y exportación a Markdown local.
// Todo el texto se pinta con textContent; sin red ni HTML crudo.
import { almacenSeguro } from "../lib/rutas.ts";
import { alternarRevisado, claveRevisados, filasVisibles, leerRevisados, limpiezaMarkdown, nombreArchivoMd, progreso, serializarRevisados } from "../lib/limpieza.ts";
import type { FilaLimpieza } from "../lib/limpieza.ts";

const raiz = document.querySelector<HTMLElement>("[data-limpieza]");
if (raiz) {
  const alm = almacenSeguro(() => localStorage);
  const proyecto = raiz.dataset.proyecto ?? "";
  const nombre = raiz.dataset.nombre ?? proyecto;
  const leerFila = (tr: HTMLElement): FilaLimpieza | null => {
    try {
      const d = JSON.parse(tr.dataset.fila ?? "") as Partial<FilaLimpieza>;
      if (!d || typeof d.id !== "string") return null;
      return {
        id: d.id,
        paquete: String(d.paquete ?? ""),
        ejecutable: String(d.ejecutable ?? ""),
        archivo: String(d.archivo ?? ""),
        url: typeof d.url === "string" ? d.url : null,
        configs: Array.isArray(d.configs) ? d.configs.map(String) : [],
        launches: Array.isArray(d.launches) ? d.launches.map(String) : [],
        motivo: String(d.motivo ?? ""),
      };
    } catch {
      return null;
    }
  };
  const porSeccion = (clave: string) =>
    [...raiz.querySelectorAll<HTMLElement>(`[data-seccion="${clave}"] tr[data-fila]`)].map(leerFila).filter((x): x is FilaLimpieza => x !== null);
  const grupos = { sinUso: porSeccion("sinuso"), legado: porSeccion("legado") };
  const todas = [...grupos.sinUso, ...grupos.legado];
  let revisados = leerRevisados(alm.get(claveRevisados(proyecto)), todas.map((f) => f.id));
  const resumen = raiz.querySelector<HTMLElement>("[data-resumen]");
  const barra = raiz.querySelector<HTMLElement>("[data-barra]");
  const ocultar = raiz.querySelector<HTMLInputElement>("[data-ocultar]");
  const cajas = [...raiz.querySelectorAll<HTMLInputElement>("input[data-id]")];

  const pintar = () => {
    const p = progreso(todas, revisados);
    if (resumen) resumen.textContent = p.texto;
    if (barra) barra.style.width = `${p.total ? Math.round((p.hechos / p.total) * 100) : 0}%`;
    const visibles = new Set(filasVisibles(todas, revisados, Boolean(ocultar?.checked)).map((f) => f.id));
    for (const c of cajas) {
      const id = c.dataset.id ?? "";
      const tr = c.closest("tr");
      c.checked = revisados.has(id);
      if (tr) {
        tr.classList.toggle("limpieza-revisada", c.checked);
        tr.hidden = !visibles.has(id);
      }
    }
  };

  for (const c of cajas) {
    c.addEventListener("change", () => {
      revisados = alternarRevisado(revisados, c.dataset.id ?? "", c.checked);
      alm.set(claveRevisados(proyecto), serializarRevisados(revisados));
      pintar();
    });
  }
  ocultar?.addEventListener("change", pintar);

  raiz.querySelector<HTMLButtonElement>("[data-exportar]")?.addEventListener("click", () => {
    const md = limpiezaMarkdown(nombre, grupos, revisados);
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreArchivoMd(proyecto);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  pintar();
}
