// Portada del portal: lista de proyectos desde /projects.json, que genera tools/build.mjs.
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("es-MX", { dateStyle: "medium" }) : "—");

async function main() {
  const data = await (await fetch("/projects.json")).json();
  const grid = document.getElementById("projects");
  grid.replaceChildren();
  for (const p of data.projects) {
    const a = document.createElement("a");
    a.className = "card project-card";
    a.href = p.error ? "#" : `/${p.id}/`;
    a.innerHTML = `
      <span class="card-title"></span>
      <span class="card-note"></span>
      <span class="card-desc"></span>
      <span class="card-meta"></span>
      <span class="card-link">${p.error ? "No se pudo construir" : "Abrir →"}</span>`;
    a.querySelector(".card-title").textContent = p.name;
    a.querySelector(".card-note").textContent = p.note || "";
    a.querySelector(".card-desc").textContent = p.summary || "";
    a.querySelector(".card-meta").textContent = p.error
      ? ""
      : `${p.pages} páginas · ${p.claims} afirmaciones verificadas · ${p.diagrams} diagrama(s) · actualizado ${fmtDate(p.updated)}`;
    grid.append(a);
  }
  document.getElementById("build-info").textContent = `Portal construido el ${new Date(data.builtAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}.`;

  try {
    const me = await (await fetch("/auth/me")).json();
    if (me.login) document.getElementById("user").textContent = `@${me.login}`;
  } catch {}
}

main();
