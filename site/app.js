// Página de un proyecto: todo sale de data.json, search.json y content/*.md, que genera tools/build.mjs.
const $ = (sel) => document.querySelector(sel);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" }) : "");
const pagesByPath = new Map();
let data;

function stripFrontmatter(md) {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trimStart();
}

function render(md, { dropTitle = false } = {}) {
  let body = stripFrontmatter(md);
  if (dropTitle) body = body.replace(/^#\s.*\r?\n/, "");
  return DOMPurify.sanitize(marked.parse(body));
}

// Enlaces a otras páginas .md se abren en el lector; los de código van a GitHub en otra pestaña.
function wireLinks(container, basePath) {
  for (const a of container.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (/^https?:/.test(href)) {
      a.target = "_blank";
      a.rel = "noopener";
    } else if (/\.md(#.*)?$/.test(href)) {
      const resolved = new URL(href.replace(/#.*$/, ""), `https://x/${basePath}`).pathname.slice(1);
      a.href = `#/p/${resolved}`;
    } else if (href.endsWith("/")) {
      a.href = "wiki/";
    }
  }
}

async function loadInto(el, path, opts) {
  try {
    const res = await fetch(`content/${path}`);
    if (!res.ok) throw new Error(res.status);
    el.innerHTML = render(await res.text(), opts);
    wireLinks(el, path);
  } catch {
    el.innerHTML = `<p class="muted">No se pudo cargar <code>${path}</code>.</p>`;
  }
}

function pageMeta(p) {
  if (!p) return "";
  const bits = [];
  if (p.updated) bits.push(`Actualizada ${fmtDate(p.updated.date)} por ${p.updated.author}`);
  if (p.claims) bits.push(`${p.claims} afirmaciones verificadas`);
  if (p.owner) bits.push(`Responsable: ${p.owner}`);
  return bits.join(" · ");
}

// Rutas: #/p/<ruta.md> abre una página en el lector (se puede compartir el enlace).
async function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  const dialog = $("#reader");
  if (!m) {
    if (dialog.open) dialog.close();
    return;
  }
  const path = decodeURIComponent(m[1]);
  const p = pagesByPath.get(path);
  $("#reader-title").textContent = p?.title || path;
  $("#reader-meta").textContent = pageMeta(p);
  $("#reader-graph").href = `wiki/#p=${encodeURIComponent(path.replace(/\.md$/, ""))}`;
  $("#reader-source").href = `${data.repoUrl}/blob/${data.sha}/openwiki/${path}`;
  $("#reader-body").innerHTML = '<p class="muted">Cargando…</p>';
  if (!dialog.open) dialog.showModal();
  await loadInto($("#reader-body"), path);
  $("#reader-body").scrollTop = 0;
}

function closeReader() {
  if (location.hash.startsWith("#/p/")) history.pushState(null, "", location.pathname);
  $("#reader").close();
}

function renderDiagrams() {
  const { diagrams } = data;
  if (!diagrams.length) {
    $("#arquitectura").hidden = true;
    $('a[href="#arquitectura"]').hidden = true;
    return;
  }
  const picker = $("#diagram-picker");
  for (const d of diagrams) picker.add(new Option(d.title, d.file));
  picker.hidden = diagrams.length < 2;
  const show = (file) => {
    $("#diagram-frame").src = file;
    $("#diagram-open").href = file;
  };
  picker.addEventListener("change", () => show(picker.value));
  show(diagrams[0].file);
  // En pantallas táctiles el iframe atrapaba el scroll de la página: se activa con un toque.
  $("#diagram-shield").addEventListener("click", (e) => e.currentTarget.remove());
}

function card(p) {
  const a = document.createElement("a");
  a.className = "card";
  a.href = `#/p/${p.path}`;
  a.innerHTML = `<span class="card-title"></span><span class="card-desc"></span><span class="card-meta"></span><span class="card-link">Leer →</span>`;
  a.querySelector(".card-title").textContent = p.title;
  a.querySelector(".card-desc").textContent = p.description;
  a.querySelector(".card-meta").textContent = [p.claims ? `${p.claims} citas` : "", p.updated ? fmtDate(p.updated.date) : ""].filter(Boolean).join(" · ");
  return a;
}

function renderPages() {
  const cards = $("#package-cards");
  if (!data.packages.length) $("#paquetes").hidden = true;
  for (const p of data.packages) cards.append(card(p));

  const groups = {};
  for (const p of data.pages) {
    if (p.path.endsWith("index.md")) continue;
    const g = p.path.includes("/") ? p.path.split("/")[0] : "general";
    (groups[g] ||= []).push(p);
  }
  const list = $("#page-list");
  for (const [g, pages] of Object.entries(groups)) {
    const section = document.createElement("div");
    section.className = "page-group";
    section.innerHTML = `<h3></h3><ul></ul>`;
    section.querySelector("h3").textContent = g;
    for (const p of pages.sort((a, b) => a.title.localeCompare(b.title))) {
      const li = document.createElement("li");
      li.innerHTML = `<a></a><span class="muted"></span>`;
      li.querySelector("a").href = `#/p/${p.path}`;
      li.querySelector("a").textContent = p.title;
      li.querySelector("span").textContent = p.description ? ` — ${p.description}` : "";
      section.querySelector("ul").append(li);
    }
    list.append(section);
  }
}

function renderStats() {
  document.title = `${data.name} · Documentación`;
  $("#brand-name").textContent = data.name;
  $("#eyebrow").textContent = data.note || "Documentación del proyecto";
  $("#title").textContent = data.name;
  $("#summary").textContent = data.summary;
  $("#stat-pages").textContent = data.pages.length;
  $("#stat-claims").textContent = data.claimCount;
  $("#stat-diagrams").textContent = data.diagrams.length;
  $("#stat-commit").innerHTML = `<a href="${data.repoUrl}/commit/${data.sha}" target="_blank" rel="noopener"><code>${data.sha.slice(0, 7)}</code></a>`;
  const built = new Date(data.builtAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  $("#build-info").textContent = `Construido el ${built} desde ${data.repo}@${data.sha.slice(0, 7)}.`;
}

// Búsqueda en el navegador sobre search.json (sin servidor).
let index = null;
async function openSearch() {
  if (!index) index = await (await fetch("search.json")).json();
  $("#search").showModal();
  $("#search-input").select();
  doSearch();
}

function doSearch() {
  const q = $("#search-input").value.trim().toLowerCase();
  const ul = $("#search-results");
  ul.replaceChildren();
  if (!q) return;
  const terms = q.split(/\s+/);
  const hits = index
    .map((d) => {
      const t = d.title.toLowerCase();
      const x = d.text.toLowerCase();
      if (!terms.every((w) => t.includes(w) || x.includes(w))) return null;
      const score = terms.reduce((s, w) => s + (t.includes(w) ? 10 : 0) + (x.split(w).length - 1), 0);
      const pos = x.indexOf(terms[0]);
      const snippet = d.text.slice(Math.max(0, pos - 60), pos + 120);
      return { d, score, snippet };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  for (const h of hits) {
    const li = document.createElement("li");
    li.innerHTML = `<a><strong></strong><span></span></a>`;
    li.querySelector("a").href = `#/p/${h.d.path}`;
    li.querySelector("strong").textContent = h.d.title;
    li.querySelector("span").textContent = `…${h.snippet}…`;
    li.querySelector("a").addEventListener("click", () => $("#search").close());
    ul.append(li);
  }
  if (!hits.length) ul.innerHTML = '<li class="muted">Sin resultados.</li>';
}

async function main() {
  data = await (await fetch("data.json")).json();
  for (const p of data.pages) pagesByPath.set(p.path, p);
  renderStats();
  renderDiagrams();
  renderPages();
  const estado = data.home.includes("operations/estado.md");
  if (estado) loadInto($("#estado-body"), "operations/estado.md", { dropTitle: true });
  else $("#estado").hidden = true;
  if (data.home.includes("quickstart.md")) loadInto($("#quickstart-body"), "quickstart.md", { dropTitle: true });
  else $("#empezar").hidden = true;

  for (const btn of document.querySelectorAll("[data-page]")) btn.href = `#/p/${btn.dataset.page}`;
  $("#reader-close").addEventListener("click", closeReader);
  $("#reader").addEventListener("click", (e) => e.target === e.currentTarget && closeReader());
  $("#reader").addEventListener("cancel", (e) => {
    e.preventDefault();
    closeReader();
  });
  window.addEventListener("hashchange", route);
  route();

  $("#search-open").addEventListener("click", openSearch);
  $("#search-input").addEventListener("input", doSearch);
  $("#search").addEventListener("click", (e) => e.target === e.currentTarget && e.currentTarget.close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      openSearch();
    }
  });

  const menu = $("#menu-btn");
  menu.addEventListener("click", () => {
    const open = document.body.classList.toggle("nav-open");
    menu.setAttribute("aria-expanded", String(open));
  });
  for (const a of document.querySelectorAll("#topnav a")) a.addEventListener("click", () => document.body.classList.remove("nav-open"));
}

main();
