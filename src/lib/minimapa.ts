// Minimapa del grafo: transformaciones grafo <-> canvas (una sola escala, y invertida) y visibilidad por preferencia.
export interface Encuadre {
  escala: number;
  cx: number;
  cy: number;
  ancho: number;
  alto: number;
}

export const claveMinimapa = "grafo-minimapa";

export function encuadre(nodos: { x: number; y: number }[], ancho: number, alto: number, margen: number): Encuadre {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const n of nodos) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
  }
  if (!Number.isFinite(x0)) { x0 = x1 = y0 = y1 = 0; }
  const dx = x1 - x0, dy = y1 - y0;
  const ux = Math.max(1, ancho - 2 * margen), uy = Math.max(1, alto - 2 * margen);
  const candidatas = [dx > 0 ? ux / dx : Infinity, dy > 0 ? uy / dy : Infinity];
  const escala = Math.min(...candidatas);
  return { escala: Number.isFinite(escala) && escala > 0 ? escala : 1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, ancho, alto };
}

export const aMinimapa = (t: Encuadre, x: number, y: number): [number, number] => [
  t.ancho / 2 + (x - t.cx) * t.escala,
  t.alto / 2 - (y - t.cy) * t.escala,
];

export const aGrafo = (t: Encuadre, px: number, py: number): [number, number] => [
  t.cx + (px - t.ancho / 2) / t.escala,
  t.cy - (py - t.alto / 2) / t.escala,
];

export function rectVista(t: Encuadre, v: { x0: number; y0: number; x1: number; y1: number }, ancho: number, alto: number) {
  const [ax, ay] = aMinimapa(t, v.x0, v.y0);
  const [bx, by] = aMinimapa(t, v.x1, v.y1);
  const l = Math.max(0, Math.min(ax, bx)), r = Math.min(ancho, Math.max(ax, bx));
  const u = Math.max(0, Math.min(ay, by)), d = Math.min(alto, Math.max(ay, by));
  return { x: l, y: u, w: Math.max(0, r - l), h: Math.max(0, d - u) };
}

export function minimapaVisible(guardado: string | null, anchoVentana: number): boolean {
  if (guardado === "1") return true;
  if (guardado === "0") return false;
  return anchoVentana >= 640;
}
