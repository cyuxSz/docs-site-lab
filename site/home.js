// Portada del portal: lista de proyectos desde /projects.json, que genera tools/build.mjs.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" }) : "—");

function card(p) {
  // Solo los proyectos construidos con contenido son enlace; los vacíos o con error explican por qué.
  const ok = !p.error && !p.empty;
  const el = document.createElement(ok ? "a" : "div");
  el.className = `card project-card${ok ? "" : p.error ? " is-error" : " is-empty"}`;
  if (ok) el.href = `/${p.id}/`;
  el.innerHTML = `
      <span class="card-title"></span>
      <span class="card-note"></span>
      <span class="card-desc"></span>
      <span class="card-meta"></span>
      <span class="card-status"></span>
      <span class="card-link"></span>`;
  el.querySelector(".card-title").textContent = p.name;
  el.querySelector(".card-note").textContent = p.note || "";
  el.querySelector(".card-desc").textContent = p.summary || "";
  el.querySelector(".card-meta").textContent = ok
    ? `${p.pages} páginas · ${p.claims} afirmaciones verificadas · ${p.diagrams} diagrama(s) · actualizado ${fmtDate(p.updated)}`
    : "";
  el.querySelector(".card-status").textContent = ok ? "" : p.message || "No se pudo construir.";
  el.querySelector(".card-link").textContent = ok ? "Abrir →" : p.error ? "No se pudo construir" : "Sin documentación aún";
  return el;
}

async function main() {
  const data = await (await fetch("/projects.json")).json();
  const alerts = document.getElementById("alerts");
  for (const a of data.alerts || []) {
    const p = document.createElement("p");
    p.className = `alert alert-${a.level}`;
    p.setAttribute("role", "status");
    p.textContent = a.text;
    alerts.append(p);
  }
  document.getElementById("projects").replaceChildren(...data.projects.map(card));
  document.getElementById("build-info").textContent = `Portal construido el ${new Date(data.builtAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}.`;

  try {
    const me = await (await fetch("/auth/me")).json();
    if (me.login) document.getElementById("user").textContent = `@${me.login}`;
  } catch {}
}

main();
