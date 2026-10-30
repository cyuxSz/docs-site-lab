// Comportamiento de las páginas de la wiki en el navegador: copiar código, anclas de encabezados, índice con scrollspy,
// vista previa de citas al código, tooltips del glosario, "hace N días" y reporte de errores con el texto seleccionado.
// Todo sale del HTML que ya trae la página: no hay peticiones a GitHub ni innerHTML con texto del repo.
import { urlReportar } from "../lib/acciones.ts";
import { haceDias } from "../lib/novedades.ts";
import { decodificarAncla } from "../lib/lectura.ts";

const prose = document.querySelector<HTMLElement>(".prose");

// Aviso para lectores de pantalla (copiado, etc.).
const live = document.createElement("div");
live.className = "sr-only";
live.setAttribute("role", "status");
live.setAttribute("aria-live", "polite");
document.body.append(live);
const say = (text: string) => {
  live.textContent = text;
  setTimeout(() => (live.textContent = ""), 2500);
};

// Copia al portapapeles; si la API no existe o falla (sin HTTPS, permisos), prueba con un textarea y execCommand.
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // sigue con el respaldo
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.readOnly = true;
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

if (prose) {
  // --- Copiar código: botón en cada bloque (los de Mermaid se dibujan aparte y no llevan botón) ---
  prose.querySelectorAll<HTMLElement>("pre").forEach((pre) => {
    if (pre.querySelector("code.language-mermaid")) return;
    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    pre.replaceWith(wrap);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copiar";
    btn.setAttribute("aria-label", "Copiar el código");
    btn.addEventListener("click", async () => {
      const ok = await copy(pre.textContent ?? "");
      btn.textContent = ok ? "Copiado" : "No se pudo";
      say(ok ? "Código copiado" : "No se pudo copiar el código");
      setTimeout(() => (btn.textContent = "Copiar"), 2000);
    });
    wrap.append(pre, btn);
  });

  // --- Anclas: ícono de enlace en h2/h3 que además copia la URL ---
  prose.querySelectorAll<HTMLElement>("h2[id], h3[id]").forEach((h) => {
    const a = document.createElement("a");
    a.className = "anchor";
    a.href = `#${h.id}`;
    a.setAttribute("aria-label", `Enlace a la sección ${h.textContent}`);
    a.setAttribute("data-pagefind-ignore", "");
    a.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"></path></svg>';
    a.addEventListener("click", async () => {
      // La navegación al #id sigue su curso (queda en el historial); además se copia la URL completa.
      const ok = await copy(new URL(a.getAttribute("href")!, location.href).href);
      if (ok) {
        a.dataset.copiado = "1";
        say("Enlace copiado");
        setTimeout(() => delete a.dataset.copiado, 1800);
      }
    });
    h.append(a);
  });
}

// --- Índice "En esta página": resalta la sección visible ---
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>(".toc a[href^='#']")];
if (tocLinks.length && "IntersectionObserver" in window) {
  const heads = tocLinks.map((a) => document.getElementById(decodificarAncla(a.hash))).filter((h): h is HTMLElement => Boolean(h));
  const visible = new Set<Element>();
  const mark = (current: Element | undefined) => {
    for (const a of tocLinks) {
      if (current && a.hash === `#${current.id}`) a.setAttribute("aria-current", "true");
      else a.removeAttribute("aria-current");
    }
  };
  // Banda superior de la ventana (bajo la barra fija): el primer encabezado dentro de ella es el activo; si ninguno,
  // se queda el último que ya pasó.
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
      const first = heads.find((h) => visible.has(h));
      if (first) return mark(first);
      const passed = heads.filter((h) => h.getBoundingClientRect().top < 100);
      mark(passed[passed.length - 1]);
    },
    { rootMargin: "-90px 0px -65% 0px" },
  );
  heads.forEach((h) => io.observe(h));
}

// --- Popovers (citas y glosario): un solo elemento role="tooltip" que se mueve junto al ancla ---
const pop = document.createElement("div");
pop.id = "popover-wiki";
pop.className = "popover";
pop.setAttribute("role", "tooltip");
pop.hidden = true;
document.body.append(pop);
let anchor: HTMLElement | null = null;
let timer = 0;

function place(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const w = pop.offsetWidth;
  const left = Math.max(8, Math.min(r.left + scrollX, scrollX + innerWidth - w - 8));
  let top = r.bottom + scrollY + 8;
  // Si no cabe debajo, va encima del ancla.
  if (r.bottom + pop.offsetHeight + 16 > innerHeight && r.top > pop.offsetHeight + 16) top = r.top + scrollY - pop.offsetHeight - 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function show(el: HTMLElement, fill: (box: HTMLElement) => void) {
  clearTimeout(timer);
  if (anchor && anchor !== el) anchor.removeAttribute("aria-describedby");
  anchor = el;
  pop.replaceChildren();
  fill(pop);
  pop.hidden = false;
  el.setAttribute("aria-describedby", pop.id);
  place(el);
}

function hide(delay = 0) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    pop.hidden = true;
    anchor?.removeAttribute("aria-describedby");
    anchor = null;
  }, delay);
}

// Pasar el cursor al propio popover (p. ej. al enlace "Ver glosario") no lo cierra.
pop.addEventListener("mouseenter", () => clearTimeout(timer));
pop.addEventListener("mouseleave", () => hide(120));
document.addEventListener("keydown", (e) => e.key === "Escape" && !pop.hidden && hide());
addEventListener("scroll", () => !pop.hidden && anchor && place(anchor), { passive: true });

const hoverDevice = matchMedia("(hover: hover) and (pointer: fine)");

// --- Vista previa de citas: enlaces a github.com/<repo>/blob/<sha>/<ruta>#L.. con sus líneas incrustadas en la página ---
const templates = new Map<string, HTMLTemplateElement>();
document.querySelectorAll<HTMLTemplateElement>("template[data-cita]").forEach((t) => templates.set(t.dataset.cita!, t));

function citaKey(a: HTMLAnchorElement) {
  const m = a.hash.match(/^#L(\d+)(?:-L(\d+))?$/);
  const rest = a.pathname.split("/blob/")[1];
  if (!m || !rest || a.host !== "github.com") return null;
  let file: string;
  try {
    file = decodeURIComponent(rest.slice(rest.indexOf("/") + 1));
  } catch {
    return null;
  }
  const x = Number(m[1]);
  const y = m[2] ? Number(m[2]) : x;
  return `${file}#L${Math.min(x, y)}-L${Math.max(x, y)}`;
}

function showCita(a: HTMLAnchorElement, t: HTMLTemplateElement) {
  show(a, (box) => {
    const head = document.createElement("p");
    head.className = "popover-head";
    head.textContent = `Líneas ${t.dataset.start}–${t.dataset.end} de ${t.dataset.file}`;
    const code = t.content.querySelector("code")?.textContent ?? "";
    const pre = document.createElement("pre");
    const c = document.createElement("code");
    c.textContent = code;
    pre.append(c);
    box.append(head, pre);
    if (t.dataset.truncated) {
      const more = document.createElement("p");
      more.className = "popover-more";
      more.textContent = "…";
      box.append(more);
    }
  });
}

prose?.querySelectorAll<HTMLAnchorElement>("a[href*='/blob/']").forEach((a) => {
  const key = citaKey(a);
  const t = key ? templates.get(key) : undefined;
  if (!t) return;
  // Solo cursor fino y teclado: en táctil el toque abre el enlace como siempre.
  a.addEventListener("mouseenter", () => hoverDevice.matches && showCita(a, t));
  a.addEventListener("mouseleave", () => hide(120));
  a.addEventListener("focus", () => a.matches(":focus-visible") && showCita(a, t));
  a.addEventListener("blur", () => hide());
});

// --- Glosario: <abbr class="glosa" data-def> con la definición en un tooltip ---
const glosarioUrl = prose?.dataset.glosario;
function showGlosa(el: HTMLElement) {
  show(el, (box) => {
    const def = document.createElement("p");
    def.textContent = el.dataset.def ?? "";
    box.append(def);
    if (glosarioUrl) {
      const link = document.createElement("a");
      link.href = glosarioUrl;
      link.textContent = "Ver glosario";
      box.append(link);
    }
  });
}
prose?.querySelectorAll<HTMLElement>("abbr.glosa").forEach((el) => {
  el.addEventListener("mouseenter", () => hoverDevice.matches && showGlosa(el));
  el.addEventListener("mouseleave", () => hide(120));
  el.addEventListener("focus", () => el.matches(":focus-visible") && showGlosa(el));
  el.addEventListener("blur", () => hide(120));
  // Táctil: un toque abre o cierra la definición sin mover la página.
  el.addEventListener("click", () => {
    if (hoverDevice.matches) return;
    anchor === el && !pop.hidden ? hide() : showGlosa(el);
  });
});
// Un toque fuera cierra el popover.
document.addEventListener("click", (e) => {
  const t = e.target as Element;
  if (!pop.hidden && !pop.contains(t) && !t.closest("abbr.glosa")) hide();
});

// --- "Actualizado ... · hace N días", calculado aquí para que no quede viejo en un sitio estático ---
document.querySelectorAll<HTMLTimeElement>("time[data-hace]").forEach((t) => {
  const texto = haceDias(t.dateTime);
  if (!texto) return;
  const s = document.createElement("span");
  s.className = "muted";
  s.textContent = ` · ${texto}`;
  t.after(s);
});

// --- Reportar un error: si hay texto seleccionado dentro del artículo, se cita en el enlace al hacer clic ---
const seleccionado = () => {
  const sel = getSelection();
  const text = sel?.toString().trim() ?? "";
  return text && sel?.anchorNode && prose?.contains(sel.anchorNode) ? text : "";
};
document.querySelectorAll<HTMLAnchorElement>("a[data-reportar]").forEach((a) => {
  // Al pulsar el enlace el navegador puede soltar la selección antes del clic: se guarda al empezar el gesto.
  let guardada = "";
  a.addEventListener("pointerdown", () => (guardada = seleccionado()));
  a.addEventListener("click", () => {
    const d = a.dataset;
    a.href = urlReportar(d.repo!, { title: d.title!, route: d.route!, path: d.path! }, seleccionado() || guardada);
    guardada = "";
  });
});
