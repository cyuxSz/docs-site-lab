// Mermaid pesa ~950 KB: solo se descarga en páginas con diagramas y cuando el diagrama entra en pantalla.
// Cada diagrama lleva un botón "Ampliar" que lo abre a pantalla completa con zoom (en teléfono se ven diminutos).
export function renderMermaid() {
  // Con excludeLangs, Astro deja estos bloques como <pre><code class="language-mermaid">.
  const blocks = [...document.querySelectorAll<HTMLElement>("pre:has(> code.language-mermaid)")];
  if (!blocks.length) return;
  const observer = new IntersectionObserver(
    async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const { default: mermaid } = await import("mermaid");
      const nodes = blocks.map((pre) => {
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = pre.textContent;
        fuentes.set(div, pre.textContent ?? "");
        pre.replaceWith(div);
        return div;
      });
      await dibuja(mermaid, nodes);
      // Con el botón de tema (data-theme en <html>) los diagramas se vuelven a dibujar con los colores nuevos.
      new MutationObserver(() => void dibuja(mermaid, nodes)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    },
    { rootMargin: "200px" },
  );
  blocks.forEach((b) => observer.observe(b));
}

// Código fuente de cada diagrama, para poder dibujarlo otra vez al cambiar de tema.
const fuentes = new WeakMap<HTMLElement, string>();

async function dibuja(mermaid: (typeof import("mermaid"))["default"], nodes: HTMLElement[]) {
  // Colores del portal (tokens de global.css) en lugar del gris del tema por defecto.
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  const dark = document.documentElement.dataset.theme !== "light";
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    fontFamily: "inherit",
    themeVariables: {
      darkMode: dark,
      background: token("--surface"),
      primaryColor: token("--accent-soft"),
      primaryBorderColor: token("--accent"),
      primaryTextColor: token("--text"),
      secondaryColor: token("--surface"),
      tertiaryColor: token("--bg"),
      lineColor: token("--muted"),
      textColor: token("--text"),
      edgeLabelBackground: token("--surface"),
      clusterBkg: token("--bg"),
      clusterBorder: token("--line"),
    },
  });
  for (const n of nodes) {
    n.textContent = fuentes.get(n) ?? "";
    n.removeAttribute("data-processed");
  }
  await mermaid.run({ nodes, suppressErrors: true });
  nodes.forEach(addZoom);
}

let dialog: HTMLDialogElement | null = null;
let scale = 1;
// Un diagrama ancho en un teléfono vertical se gira 90°: así usa el alto de la pantalla en lugar de verse diminuto.
let rotated = false;

function addZoom(box: HTMLElement) {
  const svg = box.querySelector("svg");
  if (!svg) return;
  if (!box.querySelector(".zoom-open")) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zoom-open";
    button.textContent = "⤢ Ampliar";
    button.setAttribute("aria-label", "Ver el diagrama a pantalla completa");
    box.append(button);
  }
  // Todo el recuadro abre el visor: en teléfono el botón es un blanco chico. El oyente se pone una sola vez y toma
  // el SVG vigente (al cambiar de tema se dibuja uno nuevo).
  if (box.dataset.zoom) return;
  box.dataset.zoom = "1";
  box.addEventListener("click", () => {
    const actual = box.querySelector("svg");
    if (actual) openZoom(actual);
  });
}

function openZoom(svg: SVGSVGElement) {
  dialog ??= createDialog();
  const body = dialog.querySelector<HTMLElement>(".zoom-body")!;
  const copy = svg.cloneNode(true) as SVGSVGElement;
  // Tamaño natural del diagrama (Mermaid lo encoge con max-width).
  const { width, height } = svg.viewBox.baseVal;
  copy.removeAttribute("style");
  copy.setAttribute("width", String(width));
  copy.setAttribute("height", String(height));
  const stage = document.createElement("div");
  stage.className = "zoom-stage";
  stage.append(copy);
  body.replaceChildren(stage);
  dialog.showModal();
  rotated = width / height > 1.6 && body.clientHeight > body.clientWidth * 1.2;
  fit();
}

// El contenedor mide lo que ocupa el dibujo (girado o no) para que el scroll llegue a todas las orillas.
function apply() {
  const stage = dialog?.querySelector<HTMLElement>(".zoom-stage");
  const svg = stage?.querySelector("svg");
  if (!stage || !svg) return;
  const { width, height } = svg.viewBox.baseVal;
  const w = width * scale;
  const h = height * scale;
  svg.style.width = `${w}px`;
  svg.style.height = `${h}px`;
  stage.style.width = `${rotated ? h : w}px`;
  stage.style.height = `${rotated ? w : h}px`;
  svg.style.transform = rotated ? `translateX(${h}px) rotate(90deg)` : "";
  dialog!.querySelector<HTMLElement>("[data-z=rotate]")!.setAttribute("aria-pressed", String(rotated));
}

// Encaja el diagrama en la pantalla, sin pasar de su tamaño natural ×1.5.
function fit() {
  const body = dialog!.querySelector<HTMLElement>(".zoom-body")!;
  const svg = body.querySelector("svg")!;
  const { width, height } = svg.viewBox.baseVal;
  const [w, h] = rotated ? [height, width] : [width, height];
  const pad = 32;
  // Girado se ajusta solo al ancho y se recorre de arriba abajo: encajarlo completo lo dejaría ilegible.
  scale = Math.min(1.5, (body.clientWidth - pad) / w, rotated ? Infinity : (body.clientHeight - pad) / h);
  apply();
}

function createDialog() {
  const d = document.createElement("dialog");
  d.className = "zoom-dialog";
  d.setAttribute("aria-label", "Diagrama a pantalla completa");
  d.innerHTML = `<div class="zoom-bar"><strong>Diagrama</strong>
    <button type="button" data-z="rotate" aria-label="Girar 90 grados">⟳</button>
    <button type="button" data-z="out" aria-label="Alejar">−</button>
    <button type="button" data-z="in" aria-label="Acercar">+</button>
    <button type="button" data-z="fit" aria-label="Encajar en la pantalla">⤢</button>
    <button type="button" data-z="close" aria-label="Cerrar">×</button></div><div class="zoom-body"></div>`;
  d.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-z]")?.dataset.z;
    if (action === "in") scale = Math.min(6, scale * 1.4);
    if (action === "out") scale = Math.max(0.2, scale / 1.4);
    if (action === "in" || action === "out") apply();
    if (action === "rotate") rotated = !rotated;
    if (action === "fit" || action === "rotate") fit();
    if (action === "close") d.close();
  });
  document.body.append(d);
  return d;
}
