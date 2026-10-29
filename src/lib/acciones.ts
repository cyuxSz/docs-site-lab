// Enlaces de "Editar en GitHub" y "Reportar un error": URLs prellenadas, sin usuario, correo ni origen del sitio.
export const urlEditar = (repo: string, branch: string, path: string) => `https://github.com/${repo}/edit/${branch}/openwiki/${path}`;

export function urlReportar(repo: string, page: { title: string; route: string; path: string }, seleccion?: string): string {
  const texto = (seleccion ?? "").trim();
  const recorte = texto.length > 500 ? `${texto.slice(0, 500)}…` : texto;
  const cita = recorte ? `\n\nTexto seleccionado:\n${recorte.split(/\r?\n/).map((l) => `> ${l}`).join("\n")}` : "";
  const body = `Página: ${page.route}\nArchivo: openwiki/${page.path}${cita}\n\n¿Qué está mal?\n`;
  const q = new URLSearchParams({ title: `Error en la wiki: ${page.title}`, body });
  return `https://github.com/${repo}/issues/new?${q}`;
}
