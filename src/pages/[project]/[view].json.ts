// /<proyecto>/ros.json y /<proyecto>/paginas.json: datos (con layout ya calculado) para el grafo.
import type { APIRoute } from "astro";
import { builtProjects, project } from "../../lib/data";
import { pagesGraph, rosGraph } from "../../lib/graph";

export function getStaticPaths() {
  return builtProjects().flatMap((p) => {
    const views = [{ params: { project: p.id, view: "paginas" } }];
    if (p.rosNodes) views.unshift({ params: { project: p.id, view: "ros" } });
    return views;
  });
}

export const GET: APIRoute = ({ params }) => {
  const p = project(params.project!);
  const data = params.view === "ros" ? rosGraph(p) : pagesGraph(p);
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
};
