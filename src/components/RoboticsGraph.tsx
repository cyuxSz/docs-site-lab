// Grafo interactivo con Sigma.js (WebGL) + Graphology. Se hidrata con client:visible, así que ni Sigma ni los
// datos se descargan hasta que el grafo entra en pantalla.
// - Filtros por configuración (launch en uso), por capa y por estado.
// - Al pasar o tocar un nodo se atenúa todo lo que no es su vecindario.
// - Al hacer clic se abre un panel con sus topics, tipos de mensaje y enlaces a código y documentación.
// - Las conexiones son tenues y unos puntos verdes viajan por ellas en el sentido del dato (canvas encima de Sigma);
//   con un nodo enfocado solo se animan y resaltan las suyas.
// - En pantallas táctiles hay que tocar una vez para activarlo, así no atrapa el scroll de la página.
import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import type Sigma from "sigma";
import type { GraphData, GraphNode } from "../lib/graph";
import "./RoboticsGraph.css";

interface View {
  id: string;
  label: string;
  url: string;
}

interface Props {
  projectId: string;
  views: View[];
}

const STATUS_LABEL: Record<string, string> = { en_uso: "En uso", legado: "Legado", sin_uso: "Sin uso", roto: "Roto", externo: "Externo" };
const BROKEN = "#EF4444";
const HIDDEN_BY_DEFAULT = new Set(["legado", "sin_uso"]);

const FLOW = { light: "#16a34a", dark: "#4ade80" };

const reducedMotion =() => matchMedia("(prefers-reduced-motion: reduce)").matches;
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches;

// Etiqueta del nodo resaltado con los colores del tema (la de Sigma es siempre un recuadro blanco).
function drawHover(dark: boolean) {
  return (ctx: CanvasRenderingContext2D, data: { x: number; y: number; size: number; label?: string | null }, settings: { labelSize: number; labelFont: string }) => {
    const size = settings.labelSize;
    ctx.font = `600 ${size}px ${settings.labelFont}`;
    const w = data.label ? ctx.measureText(data.label).width + 10 : 0;
    ctx.fillStyle = dark ? "#101e2e" : "#ffffff";
    ctx.strokeStyle = dark ? "#3cc3d2" : "#0b7a8a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (!data.label) return;
    const x = data.x + data.size + 4;
    const y = data.y - size / 2 - 4;
    ctx.beginPath();
    ctx.roundRect(x, y, w, size + 8, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = dark ? "#e4ecf4" : "#0f1b2a";
    ctx.fillText(data.label, x + 5, data.y + size / 3);
  };
}

function readParams() {
  const q = new URLSearchParams(location.search);
  return { view: q.get("vista"), config: q.get("config"), node: q.get("node") };
}

function writeParams(view: string, config: string, node: string | null) {
  const q = new URLSearchParams(location.search);
  view === "ros" ? q.delete("vista") : q.set("vista", view);
  config === "all" ? q.delete("config") : q.set("config", config);
  node ? q.set("node", node) : q.delete("node");
  const s = q.toString();
  history.replaceState(null, "", `${location.pathname}${s ? `?${s}` : ""}`);
}

export default function RoboticsGraph({ projectId, views }: Props) {
  const initial = useMemo(() => (typeof window === "undefined" ? { view: null, config: null, node: null } : readParams()), []);
  const [view, setView] = useState(views.find((v) => v.id === initial.view)?.id ?? views[0].id);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState(initial.config ?? "all");
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [showOld, setShowOld] = useState(false);
  const [selected, setSelected] = useState<string | null>(initial.node);
  const [hovered, setHovered] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState(0);

  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const graph = useRef<Graph | null>(null);
  const state = useRef({ selected, hovered });
  state.current = { selected, hovered };

  useEffect(() => {
    const coarse = matchMedia("(pointer: coarse)").matches;
    setTouch(coarse);
    setActive(!coarse);
  }, []);

  // Datos de la vista elegida (JSON estático generado en el build).
  useEffect(() => {
    setData(null);
    setError(null);
    fetch(views.find((v) => v.id === view)!.url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(String(e.message || e)));
  }, [view]);

  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  const groupColor = useMemo(() => new Map((data?.groups ?? []).map((g) => [g.id, g.color])), [data]);

  // Qué se ve con los filtros actuales. Un topic o servicio solo se muestra si algún nodo visible lo usa,
  // para que al ocultar el legado no queden topics sueltos.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (!data) return ids;
    const passes = (n: GraphNode) => {
      if (hiddenGroups.has(n.group)) return false;
      if (n.kind === "node" && !showOld && config === "all" && HIDDEN_BY_DEFAULT.has(n.status ?? "")) return false;
      if (config !== "all" && !n.configs.includes(config)) return false;
      return true;
    };
    const owners = new Set(["node", "hardware", "page"]);
    for (const n of data.nodes) if (owners.has(n.kind) && passes(n)) ids.add(n.id);
    for (const e of data.edges) {
      for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
        const other = nodeById.get(b);
        if (ids.has(a) && other && !owners.has(other.kind) && passes(other)) ids.add(b);
      }
    }
    return ids;
  }, [data, config, hiddenGroups, showOld]);
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const visible = (n: GraphNode | undefined) => Boolean(n && visibleRef.current.has(n.id));

  // Crea el renderer una vez por vista; los filtros solo cambian los reducers y hacen refresh().
  useEffect(() => {
    if (!data || !container.current) return;
    const g = new Graph({ multi: true, type: "directed" });
    for (const n of data.nodes) {
      g.addNode(n.id, { x: n.x, y: n.y, size: n.size, label: n.label, color: n.status === "roto" ? BROKEN : groupColor.get(n.group) ?? "#888" });
    }
    data.edges.forEach((e, i) => {
      if (g.hasNode(e.source) && g.hasNode(e.target)) g.addEdgeWithKey(`e${i}`, e.source, e.target, { size: 0.8, label: e.label ?? undefined });
    });
    graph.current = g;

    const dark = isDark();
    const faded = dark ? "#1f2d3d" : "#e3e8ee";
    // Colores sólidos ya mezclados con el fondo: Sigma pinta las líneas sin respetar bien el alfa.
    const edgeColor = dark ? "#26384a" : "#d3dbe4";
    const edgeFaded = dark ? "#152230" : "#eef2f6";
    const edgeFocus = dark ? "#3cc3d2" : "#0b7a8a";
    const el = container.current;
    const flow = overlay.current;
    let cancelled = false;
    let renderer: Sigma | null = null;
    let raf = 0;
    let onScreen = true;
    let io: IntersectionObserver | null = null;
    // Fase al azar por conexión para que los puntos no salgan todos a la vez.
    const phase = new Map<string, number>();
    g.forEachEdge((id) => phase.set(id, Math.random()));

    const tick = (now: number) => {
      raf = 0;
      const r = renderer;
      const ctx = flow?.getContext("2d");
      if (cancelled || !r || !flow || !ctx || !onScreen) return;
      const dpr = devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (flow.width !== Math.round(w * dpr) || flow.height !== Math.round(h * dpr)) {
        flow.width = Math.round(w * dpr);
        flow.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const focus = state.current.hovered ?? state.current.selected;
      const color = dark ? FLOW.dark : FLOW.light;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      const t = now / 1000;
      g.forEachEdge((id, _attrs, s, tg) => {
        if (!visible(nodeById.get(s)) || !visible(nodeById.get(tg))) return;
        const on = Boolean(focus && (s === focus || tg === focus));
        if (focus && !on) return;
        const a = r.getNodeDisplayData(s);
        const b = r.getNodeDisplayData(tg);
        if (!a || !b) return;
        const p = r.framedGraphToViewport(a);
        const q = r.framedGraphToViewport(b);
        const len = Math.hypot(q.x - p.x, q.y - p.y);
        if (len < 4) return;
        // Velocidad constante en pantalla: las conexiones largas tardan más.
        const duration = Math.max(0.9, len / (on ? 110 : 60));
        const count = on ? Math.min(4, 1 + Math.floor(len / 120)) : 1;
        ctx.globalAlpha = on ? 1 : 0.8;
        ctx.shadowBlur = on ? 10 : 4;
        for (let k = 0; k < count; k++) {
          const f = (t / duration + phase.get(id)! + k / count) % 1;
          ctx.beginPath();
          ctx.arc(p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f, on ? 3.2 : 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!raf && !reducedMotion()) raf = requestAnimationFrame(tick);
    };
    // Sigma usa WebGL al importarse: se carga solo en el navegador.
    import("sigma").then(({ default: SigmaClass }) => {
      if (cancelled) return;
      renderer = new SigmaClass(g, el, {
        defaultEdgeType: "line",
        renderEdgeLabels: false,
        labelColor: { color: dark ? "#e4ecf4" : "#0f1b2a" },
        labelFont: "system-ui, sans-serif",
        labelSize: 12,
        labelDensity: 1,
        labelRenderedSizeThreshold: 4,
        zIndex: true,
        defaultDrawNodeHover: drawHover(dark),
        minCameraRatio: 0.08,
        maxCameraRatio: 4,
        nodeReducer: (id, attrs) => {
          const n = nodeById.get(id);
          if (!visible(n)) return { ...attrs, hidden: true };
          const focus = state.current.hovered ?? state.current.selected;
          if (!focus || !g.hasNode(focus)) return attrs;
          if (id === focus) return { ...attrs, highlighted: true, zIndex: 2, forceLabel: true };
          if (g.areNeighbors(id, focus)) return { ...attrs, zIndex: 1, forceLabel: true };
          return { ...attrs, color: faded, label: "", zIndex: 0 };
        },
        edgeReducer: (id, attrs) => {
          const [s, t] = g.extremities(id);
          if (!visible(nodeById.get(s)) || !visible(nodeById.get(t))) return { ...attrs, hidden: true };
          const focus = state.current.hovered ?? state.current.selected;
          if (!focus) return { ...attrs, color: edgeColor };
          if (s === focus || t === focus) return { ...attrs, type: "arrow", color: edgeFocus, size: 2.4, zIndex: 1 };
          return { ...attrs, color: edgeFaded };
        },
      });
      // Solo se anima mientras el grafo está en pantalla.
      io = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) start();
      });
      io.observe(el);
      start();
      renderer.on("enterNode", ({ node }) => setHovered(node));
      renderer.on("leaveNode", () => setHovered(null));
      renderer.on("clickNode", ({ node }) => setSelected(node));
      renderer.on("clickStage", () => setSelected(null));
      sigma.current = renderer;
      setReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      flow?.getContext("2d")?.clearRect(0, 0, flow.width, flow.height);
      renderer?.kill();
      sigma.current = null;
    };
  }, [data]);

  // Al cambiar el filtro: posiciones del layout de ese filtro (calculado en el build) y encuadre de lo visible.
  useEffect(() => {
    const r = sigma.current;
    const g = graph.current;
    if (!r || !g || !data) return;
    const key = config !== "all" ? config : showOld ? "old" : "all";
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of data.nodes) {
      const xy = n.pos?.[key];
      if (xy) g.mergeNodeAttributes(n.id, { x: xy[0], y: xy[1] });
      if (!visibleIds.has(n.id)) continue;
      const { x, y } = g.getNodeAttributes(n.id);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (Number.isFinite(x0)) r.setCustomBBox({ x: [x0, x1], y: [y0, y1] });
    r.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    r.refresh();
  }, [visibleIds, ready]);

  useEffect(() => {
    sigma.current?.refresh({ skipIndexation: true });
  }, [selected, hovered]);

  useEffect(() => {
    if (data) writeParams(view, config, selected);
  }, [view, config, selected, data]);

  // Al elegir un nodo (también desde ?node=) la cámara lo centra.
  useEffect(() => {
    const r = sigma.current;
    if (!r || !selected || !graph.current?.hasNode(selected)) return;
    const pos = r.getNodeDisplayData(selected);
    if (pos) r.getCamera().animate({ x: pos.x, y: pos.y }, { duration: reducedMotion() ? 0 : 400 });
  }, [selected, ready]);

  const camera = (action: "in" | "out" | "reset") => {
    const c = sigma.current?.getCamera();
    if (!c) return;
    const duration = reducedMotion() ? 0 : 250;
    if (action === "in") c.animatedZoom({ duration });
    if (action === "out") c.animatedUnzoom({ duration });
    if (action === "reset") c.animatedReset({ duration });
  };

  const toggleGroup = (id: string) =>
    setHiddenGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const node = selected ? nodeById.get(selected) : undefined;
  const neighbors = useMemo(() => {
    if (!node || !data) return { out: [], in: [] };
    const out = data.edges.filter((e) => e.source === node.id).map((e) => ({ e, n: nodeById.get(e.target)! }));
    const inc = data.edges.filter((e) => e.target === node.id).map((e) => ({ e, n: nodeById.get(e.source)! }));
    return { out, in: inc };
  }, [node, data]);
  const codeUrl = (file?: string, line?: number | null) => (file && data ? `${data.repoUrl}/blob/${data.sha}/${file}${line ? `#L${line}` : ""}` : undefined);
  const verbs = node?.kind === "node" ? ["Publica / sirve", "Recibe de"] : node?.kind === "page" ? ["Enlaza a", "La enlazan"] : ["Lo usan", "Viene de"];
  const visibleCount = visibleIds.size;

  return (
    <div className="rg" data-pagefind-ignore="all">
      <div className="rg-toolbar">
        {views.length > 1 && (
          <div className="rg-tabs" role="tablist" aria-label="Vista">
            {views.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => { setSelected(null); setConfig("all"); setHiddenGroups(new Set()); setView(v.id); }}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        {data && data.configs.length > 0 && (
          <label className="rg-field">
            <span>Configuración</span>
            <select value={config} onChange={(e) => { setSelected(null); setConfig(e.target.value); }}>
              <option value="all">Todo el repo</option>
              {data.configs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
        {data?.view === "ros" && config === "all" && (
          <label className="rg-check">
            <input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Mostrar legado y sin uso
          </label>
        )}
        <span className="rg-count" aria-live="polite">{data ? `${visibleCount} de ${data.nodes.length}` : ""}</span>
      </div>

      {data && (
        <div className="rg-legend" aria-label="Capas">
          {data.groups.map((gr) => (
            <button key={gr.id} className="rg-chip" aria-pressed={!hiddenGroups.has(gr.id)} onClick={() => toggleGroup(gr.id)}>
              <span className="rg-dot" style={{ background: gr.color }} />
              {gr.label}
            </button>
          ))}
          {data.view === "ros" && <span className="rg-chip rg-static"><span className="rg-dot" style={{ background: BROKEN }} />Roto</span>}
        </div>
      )}

      <div className="rg-stage">
        <div ref={container} className="rg-canvas" style={{ pointerEvents: active ? "auto" : "none" }} role="img" aria-label={`Grafo: ${data?.title ?? ""}. La tabla de abajo tiene la misma información en texto.`} />
        <canvas ref={overlay} className="rg-flow" aria-hidden="true" />
        {!data && !error && <p className="rg-msg">Cargando el grafo…</p>}
        {error && <p className="rg-msg">No se pudo cargar el grafo ({error}).</p>}
        {touch && !active && data && (
          <button className="rg-shield" onClick={() => setActive(true)}>Tocar para explorar el grafo</button>
        )}
        <div className="rg-zoom" hidden={!active}>
          {touch && active && <button onClick={() => { setActive(false); setSelected(null); }} aria-label="Soltar el grafo y volver a desplazar la página">Listo</button>}
          <button onClick={() => camera("in")} aria-label="Acercar">+</button>
          <button onClick={() => camera("out")} aria-label="Alejar">−</button>
          <button onClick={() => camera("reset")} aria-label="Encuadrar todo">⤢</button>
        </div>

        {node && (
          <aside className="rg-drawer" aria-label={`Detalle de ${node.label}`}>
            <header>
              <div>
                <strong className="rg-title">{node.label}</strong>
                <span className="rg-sub">
                  {data?.groups.find((g) => g.id === node.group)?.label}
                  {node.status && <span className={`badge badge-${node.status}`}>{STATUS_LABEL[node.status]}</span>}
                </span>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Cerrar">×</button>
            </header>
            {node.rosName && <p className="rg-row">Nombre en ROS: <code>{node.rosName}</code></p>}
            {node.types && node.types.length > 0 && <p className="rg-row">Tipo: {node.types.map((t) => <code key={t}>{t}</code>)}</p>}
            {node.configs.length > 0 && data && (
              <p className="rg-row">Se usa en: {node.configs.map((c) => data.configs.find((x) => x.id === c)?.label ?? c).join(", ")}</p>
            )}
            {[[verbs[0], neighbors.out] as const, [verbs[1], neighbors.in] as const].map(([title, list]) =>
              list.length ? (
                <div key={title}>
                  <h4>{title}</h4>
                  <ul>
                    {list.map(({ e, n }, i) => (
                      <li key={i}>
                        <button className="rg-link" onClick={() => setSelected(n.id)}>{n.label}</button>
                        {e.label && <code className="rg-type">{e.label}</code>}
                        {e.file && <a href={codeUrl(e.file, e.line)} aria-label="Ver la línea en GitHub">↗</a>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            <div className="rg-actions">
              {node.file && node.kind !== "page" && <a className="btn" href={codeUrl(node.file, node.line)}>Ver código</a>}
              {node.doc && <a className="btn btn-primary" href={node.doc}>Ver documentación completa</a>}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
