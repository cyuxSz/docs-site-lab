// Grafo interactivo con Sigma.js (WebGL) + Graphology. Se hidrata con client:visible, así que ni Sigma ni los
// datos se descargan hasta que el grafo entra en pantalla.
// - Filtros por configuración (launch en uso), por capa y por estado.
// - Al pasar o tocar un nodo se atenúa todo lo que no es su vecindario.
// - Al hacer clic se abre un panel con sus topics, tipos de mensaje y enlaces a código y documentación.
// - Las conexiones son tenues y unos puntos verdes viajan por ellas en el sentido del dato (canvas encima de Sigma);
//   con un nodo enfocado solo se animan y resaltan las suyas.
// - En pantallas táctiles hay que tocar una vez para activarlo, así no atrapa el scroll de la página.
// - Secciones (?seccion=<capa>): el grafo se reduce a los nodos de una capa, sus topics/servicios y, atenuado, el otro
//   lado de cada conexión. Tiene su propio layout (calculado en el build) y su recorrido.
// - Pantalla completa, exportar PNG y copiar el enlace a un nodo.
// - Vista ROS por capas: columnas en el sentido del dato (de arriba abajo en teléfono), topics como etiqueta de la flecha,
//   abre en la configuración del recorrido guiado y lo muestra la primera vez.
import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import type Sigma from "sigma";
import type { GraphData, GraphNode } from "../lib/graph";
import { almacenSeguro } from "../lib/rutas";
import { encuadre, aMinimapa, aGrafo, rectVista, minimapaVisible, claveMinimapa, type Encuadre } from "../lib/minimapa";
import { claveRecorrido, guardarPaso, pasoGuardado, borrarPaso, textoRetomar, accionTecla } from "../lib/recorrido";
import { idsConPlan, planDisponible, claveLayout, etiquetaPlan, notaPlan, LEYENDA_PLAN } from "../lib/plan";
import { AVISO_LEGADO, configDelRecorrido, configInicial, recorridoActivo } from "../lib/legado";
import { navegarLista, accionMenu } from "../lib/menu";
import { candidatosBusqueda, filtrarBusqueda, destinoBusqueda, type ItemBusqueda } from "../lib/busqueda";
import { MAX_VISTAS, claveVistas, leerVistas, serializarVistas, agregarVista, renombrarVista, borrarVista, vistaAplicable, type EstadoVista, type VistaGuardada } from "../lib/vistas";
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
const OWNERS = new Set(["node", "hardware", "page"]);
const TOUR_SEEN = "recorrido-visto";

const FLOW = { light: "#16a34a", dark: "#4ade80" };
// Nodos de contexto de una sección: más chicos y en gris, para que el núcleo destaque.
const CONTEXT = { light: "#a3aebf", dark: "#5b6b9a" };

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// Oscuro por defecto (como vanttec.com); <html data-theme="light"> pide el claro.
const isDark = () => document.documentElement.dataset.theme !== "light";
const isNarrow = (el: HTMLElement) => el.clientWidth < 600;
// Colores del proyecto (Base.astro los pone en <body> como --accent y --p-warm); sin ellos, los del portal.
const cssVar = (name: string, fallback: string) => getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;

const storage = almacenSeguro(() => localStorage);
const MINI_W = 160;
const MINI_H = 110;
type MenuId = "vista" | "mas" | "vistas";
const nuevoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36));

// Etiqueta del nodo resaltado con los colores del tema (la de Sigma es siempre un recuadro blanco).
function drawHover(dark: boolean, accent: string) {
  return (ctx: CanvasRenderingContext2D, data: { x: number; y: number; size: number; label?: string | null }, settings: { labelSize: number; labelFont: string }) => {
    const size = settings.labelSize;
    ctx.font = `600 ${size}px ${settings.labelFont}`;
    const w = data.label ? ctx.measureText(data.label).width + 10 : 0;
    ctx.fillStyle = dark ? "#0a1646" : "#ffffff";
    ctx.strokeStyle = accent;
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
    ctx.fillStyle = dark ? "#eef3fb" : "#0f1b2a";
    ctx.fillText(data.label, x + 5, data.y + size / 3);
  };
}

function readParams() {
  const q = new URLSearchParams(location.search);
  return { view: q.get("vista"), config: q.get("config"), node: q.get("node"), seccion: q.get("seccion") };
}

function writeParams(view: string, config: string, node: string | null, seccion: string | null) {
  const q = new URLSearchParams(location.search);
  view === "ros" ? q.delete("vista") : q.set("vista", view);
  config === "all" ? q.delete("config") : q.set("config", config);
  node ? q.set("node", node) : q.delete("node");
  seccion ? q.set("seccion", seccion) : q.delete("seccion");
  const s = q.toString();
  history.replaceState(null, "", `${location.pathname}${s ? `?${s}` : ""}`);
}

export default function RoboticsGraph({ projectId, views }: Props) {
  const initial = useMemo(() => (typeof window === "undefined" ? { view: null, config: null, node: null, seccion: null } : readParams()), []);
  const [view, setView] = useState(views.find((v) => v.id === initial.view)?.id ?? views[0].id);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState(initial.config ?? "all");
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [showOld, setShowOld] = useState(false);
  const [selected, setSelected] = useState<string | null>(initial.node);
  const [hovered, setHovered] = useState<string | null>(null);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [touch, setTouch] = useState(false);
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState(0);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [seccionId, setSeccionId] = useState<string | null>(initial.seccion);
  const [secStep, setSecStep] = useState<number | null>(null);
  const [tema, setTema] = useState(0);
  const [fsOk, setFsOk] = useState(false);
  const [fs, setFs] = useState(false);
  const [aviso, setAviso] = useState("");
  const [present, setPresent] = useState(false);
  const [miniOn, setMiniOn] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const [panoramaOn, setPanoramaOn] = useState(false);
  const [menu, setMenu] = useState<MenuId | null>(null);
  const [menuItem, setMenuItem] = useState("");
  const [leyendaOn, setLeyendaOn] = useState(true);
  const [vistas, setVistas] = useState<VistaGuardada[]>([]);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [renombrando, setRenombrando] = useState<{ id: string; texto: string } | null>(null);
  const [avisoVistas, setAvisoVistas] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboIdx, setComboIdx] = useState(0);
  const [camTick, setCamTick] = useState(0);
  const menuBtns = useRef<Record<MenuId, HTMLButtonElement | null>>({ vista: null, mas: null, vistas: null });
  const menuFoco = useRef<"primero" | "ultimo" | null>(null);
  const camaraPend = useRef<EstadoVista["camara"]>(undefined);
  const saltarCentro = useRef(false);
  const vistaPend = useRef<EstadoVista | null>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const miniT = useRef<Encuadre | null>(null);
  const miniDrag = useRef(false);
  const presBtn = useRef<HTMLButtonElement>(null);
  const panoramaBtn = useRef<HTMLButtonElement>(null);
  const presFs = useRef(false);
  const wasPresent = useRef(false);
  const togglePresentRef = useRef<() => void>(() => {});
  const exitPresentRef = useRef<() => void>(() => {});

  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const sigma = useRef<Sigma | null>(null);
  const graph = useRef<Graph | null>(null);
  // Sección elegida (una ?seccion inválida se ignora) y recorrido que está activo: el de la sección o el global.
  const sec = data?.view === "ros" ? data.sections?.find((s) => s.id === seccionId) : undefined;
  const secVariant = sec ? (showOld ? sec.old : sec) : undefined;
  const tour = data?.tour ?? [];
  const configObj = data?.configs.find((c) => c.id === config);
  // Recorrido activo: sección > configuración con recorrido propio > global.
  const activo = recorridoActivo({ global: tour, config: configObj, seccion: sec ?? null, enSeccion: secStep !== null });
  const steps = activo.pasos;
  const planFlow = data?.planFlowEdges ?? [];
  const planOn = showPlan && planDisponible({ planFlow: planFlow.length, seccion: sec?.id ?? null, config: configObj });
  const planRef = useRef(planOn);
  planRef.current = planOn;
  // Guard: nunca un índice fuera del recorrido activo (p. ej. al cambiar de configuración, sección o vista).
  const rawIdx = secStep !== null ? secStep : tourStep;
  const stepIdx = rawIdx !== null && steps.length ? Math.min(Math.max(rawIdx, 0), steps.length - 1) : null;
  const setStepIdx = secStep !== null ? setSecStep : setTourStep;
  const tourNode = stepIdx !== null ? steps[stepIdx]?.node ?? null : null;
  useEffect(() => {
    if (rawIdx !== null && !steps.length) { setTourStep(null); setSecStep(null); }
  }, [rawIdx, steps.length]);
  const state = useRef({ selected, hovered, tourNode });
  state.current = { selected, hovered, tourNode };
  const recKey = claveRecorrido(projectId, view, activo.claveSeccion);
  const nav = useRef({ present, stepIdx, total: steps.length, setStepIdx });
  nav.current = { present, stepIdx, total: steps.length, setStepIdx };

  useEffect(() => {
    const coarse = matchMedia("(pointer: coarse)").matches;
    setTouch(coarse);
    setActive(!coarse);
    setFsOk(Boolean(document.fullscreenEnabled));
    // El botón de tema de Base.astro cambia data-theme: el grafo se vuelve a pintar con los colores del tema.
    const watcher = new MutationObserver(() => setTema((n) => n + 1));
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const onFs = () => {
      const on = document.fullscreenElement === root.current;
      setFs(on);
      // Salir de la pantalla completa nativa (p. ej. con Esc del navegador) también quita el modo presentación.
      if (!on && presFs.current) {
        presFs.current = false;
        setPresent(false);
      }
    };
    document.addEventListener("fullscreenchange", onFs);
    setMiniOn(minimapaVisible(storage.get(claveMinimapa), innerWidth));
    // Leyenda plegada por defecto en pantallas angostas (sin persistir) y vistas guardadas validadas.
    setLeyendaOn(innerWidth >= 760);
    setVistas(leerVistas(storage.get(claveVistas(projectId))));
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const escribiendo = Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
      const a = accionTecla({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, escribiendo }, nav.current.present);
      if (!a) return;
      // Con el foco en un botón o enlace, espacio conserva su función normal.
      if (e.key === " " && t && /^(BUTTON|A)$/.test(t.tagName)) return;
      e.preventDefault();
      const n = nav.current;
      if (a === "alternar") togglePresentRef.current();
      else if (a === "salir") exitPresentRef.current();
      else if (n.stepIdx !== null) {
        if (a === "siguiente" && n.stepIdx < n.total - 1) n.setStepIdx(n.stepIdx + 1);
        if (a === "anterior" && n.stepIdx > 0) n.setStepIdx(n.stepIdx - 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      watcher.disconnect();
      document.removeEventListener("fullscreenchange", onFs);
    };
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

  // Vista ROS: flechas nodo → nodo y columnas.
  const capas = data?.view === "ros" && Boolean(data.flowEdges);
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  // El hardware toma el color cálido del vehículo (naranja en el UUV), como en su página de vanttec.com.
  const groupColor = useMemo(
    () => new Map((data?.groups ?? []).map((g) => [g.id, g.id === "hardware" ? cssVar("--p-warm", g.color) : g.color])),
    [data],
  );
  // Configuración donde se ven todos los nodos del recorrido (p. ej. el sub real).
  const tourConfig = useMemo(() => (data ? configDelRecorrido(data.configs, tour, data.nodes) : null), [data]);

  // Abre en la configuración del recorrido y lo muestra la primera vez.
  useEffect(() => {
    if (!capas || !data || initial.seccion) return;
    if (!initial.config && config === "all") setConfig(configInicial(data.configs, tour, data.nodes));
    const propio = data.configs.find((c) => c.id === initial.config)?.tour?.length;
    if (tour.length && tourConfig && !propio && !initial.node && !storage.get(TOUR_SEEN)) setTourStep(0);
  }, [capas, data]);

  // Qué se ve con los filtros actuales. Un topic o servicio solo se muestra si algún nodo visible lo usa,
  // para que al ocultar el legado no queden topics sueltos. En el diseño A los topics no son nodos.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (!data) return ids;
    // Con sección: solo su núcleo, canales y contexto (la variante con legado si "mostrar legado" está activo).
    if (secVariant) {
      const inSec = new Set([...secVariant.core, ...secVariant.channels, ...secVariant.context]);
      for (const n of data.nodes) if (inSec.has(n.id) && !hiddenGroups.has(n.group) && (!capas || OWNERS.has(n.kind))) ids.add(n.id);
      return ids;
    }
    const passes = (n: GraphNode) => {
      if (hiddenGroups.has(n.group) || n.soloPlan) return false;
      if (n.kind === "node" && !showOld && config === "all" && HIDDEN_BY_DEFAULT.has(n.status ?? "")) return false;
      if (config !== "all" && !n.configs.includes(config)) return false;
      return true;
    };
    for (const n of data.nodes) if (OWNERS.has(n.kind) && passes(n)) ids.add(n.id);
    if (capas) return planOn ? new Set([...idsConPlan(ids, planFlow, true)].filter((id) => !hiddenGroups.has(nodeById.get(id)?.group ?? ""))) : ids;
    for (const e of data.edges) {
      for (const [a, b] of [[e.source, e.target], [e.target, e.source]]) {
        const other = nodeById.get(b);
        if (ids.has(a) && other && !OWNERS.has(other.kind) && passes(other)) ids.add(b);
      }
    }
    return ids;
  }, [data, config, hiddenGroups, showOld, capas, sec, planOn]);
  const visibleRef = useRef(visibleIds);
  visibleRef.current = visibleIds;
  const contextRef = useRef(new Set<string>());
  contextRef.current = new Set(secVariant?.context ?? []);
  const visible = (n: GraphNode | undefined) => Boolean(n && visibleRef.current.has(n.id));

  // Crea el renderer una vez por vista; los filtros solo cambian los reducers y hacen refresh().
  useEffect(() => {
    if (!data || !container.current) return;
    const g = new Graph({ multi: true, type: "directed" });
    for (const n of data.nodes) {
      g.addNode(n.id, { x: n.x, y: n.y, size: n.size, label: n.label, color: n.status === "roto" ? BROKEN : groupColor.get(n.group) ?? "#888" });
    }
    const edgeList = capas ? data.flowEdges! : data.edges;
    edgeList.forEach((e, i) => {
      if (g.hasNode(e.source) && g.hasNode(e.target)) g.addEdgeWithKey(`e${i}`, e.source, e.target, { size: capas ? 1 : 0.8, label: e.label ?? undefined });
    });
    // Aristas de la capa plan: están en el grafo, pero el reducer las oculta mientras el plan no esté activo.
    if (capas) {
      (data.planFlowEdges ?? []).forEach((e, i) => {
        if (g.hasNode(e.source) && g.hasNode(e.target)) g.addEdgeWithKey(`p${i}`, e.source, e.target, { size: 1.6, label: e.label ?? undefined, plan: true });
      });
    }
    graph.current = g;

    const dark = isDark();
    const el = container.current;
    const narrow = isNarrow(el);
    const faded = dark ? "#1b2a63" : "#e3e8ee";
    // Colores sólidos ya mezclados con el fondo: Sigma pinta las líneas sin respetar bien el alfa.
    const edgeColor = capas ? (dark ? "#344a86" : "#c3ccd7") : dark ? "#26397a" : "#d3dbe4";
    const edgeFaded = dark ? "#121d55" : "#eef2f6";
    const accent = cssVar("--accent", dark ? "#49c1d2" : "#0b7a8a");
    const edgeFocus = accent;
    const planColor = cssVar("--plan", dark ? "#b69cf0" : "#6d3fc0");
    const flow = overlay.current;
    let cancelled = false;
    let renderer: Sigma | null = null;
    let raf = 0;
    let onScreen = true;
    let io: IntersectionObserver | null = null;
    // Fase al azar por conexión para que los puntos no salgan todos a la vez.
    const phase = new Map<string, number>();
    g.forEachEdge((id) => phase.set(id, Math.random()));
    const focusOf = () => state.current.hovered ?? state.current.selected ?? state.current.tourNode;

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
      const focus = focusOf();
      const color = dark ? FLOW.dark : FLOW.light;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      const t = now / 1000;
      g.forEachEdge((id, attrs, s, tg) => {
        if (attrs.plan) return;
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
    import("sigma").then(({ default: Sigma }) => {
      if (cancelled) return;
      renderer = new Sigma(g, el, {
        defaultEdgeType: capas ? "arrow" : "line",
        renderEdgeLabels: capas,
        edgeLabelColor: { color: dark ? "#a8b6d3" : "#5a6878" },
        edgeLabelSize: 11,
        edgeLabelFont: "ui-monospace, monospace",
        labelColor: { color: dark ? "#eef3fb" : "#0f1b2a" },
        labelFont: "system-ui, sans-serif",
        labelSize: 12,
        // A tiene pocos nodos: todas las etiquetas. B en teléfono: solo las de los nodos grandes.
        labelDensity: capas ? 1 : narrow ? 0.5 : 1,
        labelGridCellSize: capas ? 60 : 100,
        labelRenderedSizeThreshold: capas ? 0 : narrow ? 9 : 4,
        zIndex: true,
        // Margen para que la etiqueta del último nodo (a su derecha) no se corte en el borde.
        stagePadding: capas ? 70 : 30,
        defaultDrawNodeHover: drawHover(dark, accent),
        minCameraRatio: 0.08,
        maxCameraRatio: 4,
        nodeReducer: (id, raw) => {
          const n = nodeById.get(id);
          if (!visible(n)) return { ...raw, hidden: true };
          // Nodo que solo existe en el plan: color de aviso y "(plan)" en la etiqueta, para no depender del color.
          const attrs = n?.soloPlan ? { ...raw, color: planColor, label: `${raw.label} (plan)`, forceLabel: true } : raw;
          // Contexto de la sección: chico, gris y sin etiqueta salvo que esté enfocado o junto al nodo enfocado.
          const ctx = contextRef.current.has(id);
          const base = ctx ? { ...attrs, size: attrs.size * 0.7, color: dark ? CONTEXT.dark : CONTEXT.light, label: "" } : attrs;
          const focus = focusOf();
          if (!focus || !g.hasNode(focus)) return base;
          if (id === focus) return { ...base, label: attrs.label, highlighted: true, zIndex: 2, forceLabel: true };
          if (g.areNeighbors(id, focus)) return { ...base, label: attrs.label, zIndex: 1, forceLabel: true };
          return { ...base, color: faded, label: capas ? base.label : "", zIndex: 0 };
        },
        edgeReducer: (id, attrs) => {
          const [s, t] = g.extremities(id);
          if (!visible(nodeById.get(s)) || !visible(nodeById.get(t))) return { ...attrs, hidden: true };
          if (attrs.plan) {
            if (!planRef.current) return { ...attrs, hidden: true };
            // Etiqueta solo al enfocar (como el resto de aristas); el "plan · " distingue por texto, no solo por color.
            const f = focusOf();
            const enfocada = Boolean(f && (s === f || t === f));
            return { ...attrs, type: "arrow", color: planColor, size: 1.6, label: enfocada ? etiquetaPlan(attrs.label) : undefined, zIndex: 1 };
          }
          const focus = focusOf();
          // El nombre del topic solo aparece en las flechas del nodo enfocado, para no llenar el dibujo de texto.
          if (!focus) return { ...attrs, color: edgeColor, label: undefined };
          if (s === focus || t === focus) return { ...attrs, type: "arrow", color: edgeFocus, size: 2.4, zIndex: 1 };
          return { ...attrs, color: edgeFaded, label: undefined };
        },
      });
      renderer.on("enterNode", ({ node }) => setHovered(node));
      renderer.on("leaveNode", () => setHovered(null));
      renderer.on("clickNode", ({ node }) => {
        setTourStep(null);
        setSecStep(null);
        setSelected(node);
      });
      renderer.on("clickStage", () => setSelected(null));
      sigma.current = renderer;
      // Solo se anima mientras el grafo está en pantalla.
      io = new IntersectionObserver(([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen) start();
      });
      io.observe(el);
      start();
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
  }, [data, capas, tema]);

  // Al cambiar el filtro: posiciones del layout de ese filtro (calculado en el build) y encuadre de lo visible.
  // En teléfono, el diseño A gira las columnas para que el dato baje de arriba abajo, y el alto del lienzo se ajusta
  // a la forma del dibujo para no dejar huecos.
  useEffect(() => {
    const r = sigma.current;
    const g = graph.current;
    const el = container.current;
    if (!r || !g || !data || !el) return;
    const key = claveLayout({ seccion: sec?.id ?? null, showOld, config, plan: planOn });
    const narrow = isNarrow(el);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of data.nodes) {
      let xy = (capas && n.pos?.[`capas:${key}`]) || n.pos?.[key];
      // Girado, las filas pasan a ser horizontales: se separan más porque el teléfono es angosto y las etiquetas
      // van a la derecha de cada nodo.
      if (xy && capas && narrow) xy = [xy[1] * 4, -xy[0]];
      if (xy) g.mergeNodeAttributes(n.id, { x: xy[0], y: xy[1] });
      if (!visibleIds.has(n.id)) continue;
      const { x, y } = g.getNodeAttributes(n.id);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (Number.isFinite(x0)) {
      // Con el plan se abre el encuadre (más a la derecha, donde van las etiquetas, y arriba/abajo por la banda plan).
      const mx = planOn ? (x1 - x0 || 1) * 0.02 : 0;
      const my = planOn ? (y1 - y0 || 1) * 0.12 : 0;
      r.setCustomBBox({ x: [x0 - mx * 0.5, x1 + mx * 1.5], y: [y0 - my, y1 + my] });
      if (narrow) {
        const aspect = (y1 - y0 || 1) / (x1 - x0 || 1);
        // Tope de 62 % del alto: deja lugar a la tarjeta del recorrido y a la barra del navegador.
        setStageHeight(Math.round(Math.min(innerHeight * 0.62, Math.max(340, el.clientWidth * aspect * 1.1 + 60))));
      } else setStageHeight(null);
    }
    r.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    // Vista guardada con cámara: se aplica después del reset y el centrado del nodo no la pisa.
    if (camaraPend.current) {
      r.getCamera().setState({ ...camaraPend.current, angle: 0 });
      saltarCentro.current = true;
      setTimeout(() => { camaraPend.current = undefined; }, 400);
    }
    r.refresh();
    // Si el primer dibujo cae justo cuando Sigma termina de montarse se pierde: se repite en el siguiente cuadro.
    const frame = requestAnimationFrame(() => r.refresh());
    return () => cancelAnimationFrame(frame);
  }, [visibleIds, ready, planOn, camTick]);

  // Sigma no se entera solo de que cambió el alto del contenedor.
  useEffect(() => {
    const r = sigma.current;
    if (!r) return;
    r.resize();
    r.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    if (camaraPend.current) r.getCamera().setState({ ...camaraPend.current, angle: 0 });
    r.refresh();
  }, [stageHeight, fs, present]);

  useEffect(() => {
    sigma.current?.refresh({ skipIndexation: true });
  }, [selected, hovered, tourStep, secStep, planOn]);

  useEffect(() => {
    if (data) writeParams(view, config, selected, sec?.id ?? null);
  }, [view, config, selected, data, sec]);

  // Al elegir un nodo (también desde ?node=) la cámara lo centra. En el recorrido no se mueve: se ve todo el camino
  // y solo cambia lo resaltado.
  useEffect(() => {
    const r = sigma.current;
    if (!r || !selected || !graph.current?.hasNode(selected) || saltarCentro.current) return;
    const pos = r.getNodeDisplayData(selected);
    if (pos) r.getCamera().animate({ x: pos.x, y: pos.y }, { duration: reducedMotion() ? 0 : 400 });
  }, [selected, ready]);
  // Después de los demás efectos de cada commit: el salto del centrado solo vale para ese commit.
  useEffect(() => {
    saltarCentro.current = false;
  });

  // Guarda el paso en cada cambio; así se puede retomar tras recargar.
  useEffect(() => {
    if (stepIdx !== null && steps.length) guardarPaso(storage, recKey, stepIdx, steps.length);
  }, [stepIdx, steps.length, recKey]);

  // Paso a retomar del recorrido que ofrece la barra (global o de la sección); se lee tras hidratar.
  useEffect(() => {
    const total = activo.pasos.length;
    setSaved(total ? pasoGuardado(storage, claveRecorrido(projectId, view, activo.claveSeccion), total) : null);
  }, [data, view, sec, config, tourStep, secStep]);

  // Minimapa: canvas propio con las posiciones ya calculadas; un solo rAF pendiente.
  useEffect(() => {
    const r = sigma.current;
    const g = graph.current;
    const cv = mini.current;
    const el = container.current;
    if (!r || !g || !cv || !el || !miniOn) return;
    const pts: { x: number; y: number; color: string }[] = [];
    g.forEachNode((id, a) => {
      if (visibleIds.has(id)) pts.push({ x: a.x, y: a.y, color: a.color });
    });
    const t = encuadre(pts, MINI_W, MINI_H, 8);
    miniT.current = t;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = MINI_W * dpr;
    cv.height = MINI_H * dpr;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MINI_W, MINI_H);
      for (const p of pts) {
        const [px, py] = aMinimapa(t, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      const a = r.viewportToGraph({ x: 0, y: 0 });
      const b = r.viewportToGraph({ x: el.clientWidth, y: el.clientHeight });
      const v = rectVista(t, { x0: a.x, y0: a.y, x1: b.x, y1: b.y }, MINI_W, MINI_H);
      ctx.strokeStyle = cssVar("--accent", "#49c1d2");
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fillRect(v.x, v.y, v.w, v.h);
      ctx.globalAlpha = 1;
      ctx.strokeRect(v.x + 0.75, v.y + 0.75, Math.max(0, v.w - 1.5), Math.max(0, v.h - 1.5));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    r.getCamera().on("updated", schedule);
    schedule();
    return () => {
      r.getCamera().off("updated", schedule);
      cancelAnimationFrame(frame);
    };
  }, [ready, miniOn, tema, visibleIds, present]);

  const miniGo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = sigma.current;
    const t = miniT.current;
    if (!r || !t) return;
    const box = e.currentTarget.getBoundingClientRect();
    const [gx, gy] = aGrafo(t, ((e.clientX - box.left) * MINI_W) / (box.width || MINI_W), ((e.clientY - box.top) * MINI_H) / (box.height || MINI_H));
    const f = r.viewportToFramedGraph(r.graphToViewport({ x: gx, y: gy }));
    r.getCamera().setState({ x: f.x, y: f.y });
  };
  const toggleMini = () => {
    storage.set(claveMinimapa, miniOn ? "0" : "1");
    setMiniOn(!miniOn);
  };

  const enterPresent = () => {
    setPresent(true);
    setSelected(null);
    if (fsOk && root.current?.requestFullscreen) {
      presFs.current = true;
      void root.current.requestFullscreen().catch(() => { presFs.current = false; });
    }
    if (stepIdx === null) {
      if (sec && sec.tour.length) startSecTour(saved ?? 0);
      else if (capas && activo.pasos.length) startTour(saved ?? 0);
    }
  };
  const exitPresent = () => {
    presFs.current = false;
    setPresent(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  };
  togglePresentRef.current = () => (nav.current.present ? exitPresent() : enterPresent());
  exitPresentRef.current = exitPresent;
  useEffect(() => {
    // El foco vuelve al botón al salir y pasa a "Salir" al entrar.
    if (wasPresent.current && !present) menuBtns.current.mas?.focus();
    if (present) root.current?.querySelector<HTMLElement>(".rg-exit")?.focus();
    wasPresent.current = present;
  }, [present]);

  // Sin scroll de la página de fondo mientras se presenta; también se limpia al desmontar.
  useEffect(() => {
    if (!present) return;
    document.documentElement.classList.add("rg-no-scroll");
    return () => document.documentElement.classList.remove("rg-no-scroll");
  }, [present]);

  // Etiquetas más grandes en presentación.
  useEffect(() => {
    const r = sigma.current;
    if (!r) return;
    r.setSetting("labelSize", present ? 18 : 12);
    r.refresh();
  }, [present, ready]);

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

  const startTour = (from = 0) => {
    setSelected(null);
    setSecStep(null);
    // El recorrido de una configuración no cambia la configuración; el global va a la que muestra todos sus nodos.
    if (activo.tipo === "global" && tourConfig && config !== tourConfig) setConfig(tourConfig);
    setTourStep(from);
  };
  const endTour = () => {
    // Solo el recorrido global se marca como visto; el de una sección se puede repetir sin efectos.
    if (activo.tipo === "global") storage.set(TOUR_SEEN, "1");
    borrarPaso(storage, recKey);
    setTourStep(null);
    setSecStep(null);
    camera("reset");
  };
  // Elegir una sección vuelve a "todas" las configuraciones; elegir una configuración quita la sección.
  const pickSection = (id: string) => {
    setSelected(null);
    setTourStep(null);
    setSecStep(null);
    setSeccionId(id || null);
    if (id) setConfig("all");
  };
  const startSecTour = (from = 0) => {
    setSelected(null);
    setTourStep(null);
    setSecStep(from);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen?.().catch(() => {});
  };

  // PNG: se redibuja y, en el mismo turno (antes de que el navegador limpie el búfer de WebGL), se combinan las capas
  // de Sigma sobre el fondo del tema. Se descarga con un blob: local, sin red.
  const exportPng = () => {
    const r = sigma.current;
    if (!r) return;
    r.refresh({ skipIndexation: true });
    const layers = Object.entries(r.getCanvases()).filter(([name]) => name !== "mouse");
    const first = layers[0]?.[1];
    if (!first) return;
    const out = document.createElement("canvas");
    out.width = first.width;
    out.height = first.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = cssVar("--surface", isDark() ? "#0a1646" : "#ffffff");
    ctx.fillRect(0, 0, out.width, out.height);
    for (const [, canvas] of layers) ctx.drawImage(canvas, 0, 0, out.width, out.height);
    out.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectId}-grafo${sec ? `-${sec.id}` : ""}.png`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  };

  // Copia el enlace al nodo abierto (la URL ya lleva ?node= y, si hay, ?seccion=; la actualiza el efecto de writeParams).
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setAviso("Enlace copiado");
    } catch {
      setAviso("No se pudo copiar el enlace");
    }
    setTimeout(() => setAviso(""), 2500);
  };

  // Buscador (combobox): nodos visibles y los topics/servicios que los tocan, con tipo y paquete.
  const resultados = useMemo(
    () => (data ? filtrarBusqueda(candidatosBusqueda(data.nodes, data.edges, visibleIds), query) : []),
    [data, visibleIds, query],
  );
  const listaAbierta = comboOpen && query.trim() !== "";
  const comboListId = `rg-combo-lista-${projectId}`;
  const elegirResultado = (it: ItemBusqueda) => {
    if (!data) return;
    const dest = destinoBusqueda(it.id, data.edges, visibleIds);
    if (!dest) return;
    setTourStep(null);
    setSecStep(null);
    setSelected(dest);
    setQuery("");
    setComboOpen(false);
    setComboIdx(0);
  };
  const teclaCombo = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // Con la lista abierta solo la cierra; con texto y lista cerrada lo borra; si no, deja pasar el Esc.
      if (listaAbierta) { e.preventDefault(); e.stopPropagation(); setComboOpen(false); }
      else if (query) { e.preventDefault(); e.stopPropagation(); setQuery(""); }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!query.trim()) return;
      e.preventDefault();
      if (!listaAbierta) { setComboOpen(true); return; }
      const n = navegarLista(e.key, comboIdx, resultados.length);
      if (n !== null && n >= 0) setComboIdx(n);
      return;
    }
    if (e.key === "Enter" && listaAbierta && resultados[comboIdx]) {
      e.preventDefault();
      elegirResultado(resultados[comboIdx]);
    }
  };

  // Menús desplegables de la barra ("Vista", "Vistas", "Más"): uno abierto a la vez, foco en los ítems.
  const menuPanelId = (id: MenuId) => `rg-menu-${id}-${projectId}`;
  const menuBtnId = (id: MenuId) => `rg-menubtn-${id}-${projectId}`;
  const itemsMenu = (id: MenuId) => Array.from(root.current?.querySelectorAll<HTMLElement>(`[data-menu="${id}"] [role^="menuitem"]`) ?? []);
  const rv = (k: string) => ({ tabIndex: menuItem === k ? 0 : -1, onFocus: () => setMenuItem(k) });
  const abrirMenu = (id: MenuId, donde: "primero" | "ultimo") => {
    menuFoco.current = donde;
    setMenuItem("");
    setMenu(id);
  };
  const cerrarMenu = (devolverFoco: boolean) => {
    const m = menu;
    setMenu(null);
    setGuardando(null);
    setRenombrando(null);
    setAvisoVistas("");
    if (devolverFoco && m) menuBtns.current[m]?.focus();
  };
  const alternarMenu = (id: MenuId) => (menu === id ? cerrarMenu(false) : abrirMenu(id, "primero"));
  // Ítem de acción: ejecuta y cierra el menú devolviendo el foco a su botón.
  const accion = (fn: () => void) => () => { cerrarMenu(true); fn(); };
  const teclaMenu = (id: MenuId) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (menu !== id) {
      if (t === menuBtns.current[id] && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        abrirMenu(id, e.key === "ArrowUp" ? "ultimo" : "primero");
      }
      return;
    }
    const a = accionMenu(e.key);
    if (a === "cerrar") {
      // Esc cierra solo el menú: no sale de la presentación ni cierra el Panorama ni el panel.
      e.preventDefault();
      e.stopPropagation();
      cerrarMenu(true);
      return;
    }
    // Tab cierra sin quitar el foco al siguiente control (el cambio de foco ocurre antes de ocultar el menú).
    if (a === "salir") { setTimeout(() => setMenu(null), 0); return; }
    if (t.tagName === "INPUT") return;
    // Enter y espacio activan el botón enfocado de forma nativa.
    const items = itemsMenu(id);
    const n = navegarLista(e.key, items.indexOf(t), items.length);
    if (n !== null) { e.preventDefault(); items[n]?.focus(); }
  };
  useEffect(() => {
    if (!menu || !menuFoco.current) return;
    const items = itemsMenu(menu);
    (menuFoco.current === "ultimo" ? items[items.length - 1] : items[0])?.focus();
    menuFoco.current = null;
  }, [menu]);
  // Clic o toque fuera del menú lo cierra; el listener solo existe mientras hay un menú abierto.
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".rg-menu")) {
        setMenu(null);
        setGuardando(null);
        setRenombrando(null);
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [menu]);

  // Panorama: al abrirlo el foco pasa a la primera caja (Esc lo cierra y devuelve el foco a su botón).
  useEffect(() => {
    if (panoramaOn) root.current?.querySelector<HTMLElement>(".rg-panorama-caja")?.focus();
  }, [panoramaOn]);

  // Vistas guardadas (localStorage vía almacenSeguro; lo leído ya viene validado).
  const persistirVistas = (lista: VistaGuardada[]) => {
    setVistas(lista);
    storage.set(claveVistas(projectId), serializarVistas(lista));
  };
  const guardarVista = () => {
    if (guardando === null) return;
    const cam = sigma.current?.getCamera().getState();
    const estado: EstadoVista = {
      vista: view,
      config,
      seccion: sec?.id ?? null,
      legado: showOld,
      plan: showPlan,
      ocultos: [...hiddenGroups],
      nodo: selected,
      ...(cam ? { camara: { x: cam.x, y: cam.y, ratio: cam.ratio } } : {}),
    };
    const r = agregarVista(vistas, guardando, estado, nuevoId(), Date.now());
    if (!r.ok) {
      setAvisoVistas(r.motivo === "lleno" ? `Máximo ${MAX_VISTAS} vistas: borra una para guardar otra` : "Escribe un nombre para la vista");
      return;
    }
    persistirVistas(r.lista);
    setGuardando(null);
    setAvisoVistas("Vista guardada");
    requestAnimationFrame(() => itemsMenu("vistas")[0]?.focus());
  };
  const aplicarEstado = (e: EstadoVista) => {
    if (!data) return;
    const a = vistaAplicable(e, {
      configs: data.configs.map((c) => c.id),
      secciones: (data.sections ?? []).map((x) => x.id),
      nodos: new Set(data.nodes.map((n) => n.id)),
      grupos: data.groups.map((g) => g.id),
    });
    setTourStep(null);
    setSecStep(null);
    setSeccionId(a.seccion);
    setConfig(a.config);
    setShowOld(a.legado);
    setShowPlan(a.plan);
    setHiddenGroups(new Set(a.ocultos));
    setSelected(a.nodo);
    if (a.camara) {
      camaraPend.current = a.camara;
      setCamTick((n) => n + 1);
    }
  };
  const aplicarVista = (v: VistaGuardada) => {
    if (v.estado.vista !== view && views.some((x) => x.id === v.estado.vista)) {
      // Otra vista: se cambia primero y el estado se aplica cuando lleguen sus datos.
      vistaPend.current = v.estado;
      setSelected(null);
      setView(v.estado.vista);
    } else aplicarEstado(v.estado);
  };
  // Declarado después del efecto de apertura inicial para que lo aplicado gane sobre la configuración por defecto.
  useEffect(() => {
    const e = vistaPend.current;
    if (!e || !data || e.vista !== view) return;
    vistaPend.current = null;
    aplicarEstado(e);
  }, [data]);

  const node = selected ? nodeById.get(selected) : undefined;
  const neighbors = useMemo(() => {
    if (!node || !data) return { out: [], in: [] };
    // Con el plan activo se suman las aristas plan, marcadas como tales.
    const todas = [
      ...data.edges.map((e) => ({ e, plan: false })),
      ...(planOn ? (data.planEdges ?? []).map((e) => ({ e: { ...e, label: etiquetaPlan(e.label) }, plan: true })) : []),
    ];
    const out = todas.filter(({ e }) => e.source === node.id && nodeById.get(e.target)).map(({ e, plan }) => ({ e, plan, n: nodeById.get(e.target)! }));
    const inc = todas.filter(({ e }) => e.target === node.id && nodeById.get(e.source)).map(({ e, plan }) => ({ e, plan, n: nodeById.get(e.source)! }));
    return { out, in: inc };
  }, [node, data, planOn]);
  const codeUrl = (file?: string, line?: number | null) => (file && data ? `${data.repoUrl}/blob/${data.sha}/${file}${line ? `#L${line}` : ""}` : undefined);
  const verbs = node?.kind === "node" ? ["Publica / sirve", "Recibe de"] : node?.kind === "page" ? ["Enlaza a", "La enlazan"] : ["Lo usan", "Viene de"];
  const visibleCount = visibleIds.size;
  const step = stepIdx !== null ? steps[stepIdx] : null;
  const sinNucleo = Boolean(sec && !showOld && sec.core.length === 0);

  return (
    <div className={present ? "rg rg-presenting" : "rg"} ref={root} data-pagefind-ignore="all">
      <div className="rg-toolbar">
        {views.length > 1 && (
          <div className="rg-tabs" role="tablist" aria-label="Vista">
            {views.map((v) => (
              <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => { setSelected(null); setTourStep(null); setSecStep(null); setSeccionId(null); setConfig("all"); setHiddenGroups(new Set()); setView(v.id); }}>
                {v.label}
              </button>
            ))}
          </div>
        )}
        {data && data.configs.length > 0 && (
          <label className="rg-field">
            <span>Configuración</span>
            <select value={config} onChange={(e) => { setSelected(null); setTourStep(null); setSecStep(null); setSeccionId(null); setConfig(e.target.value); }}>
              <option value="all">Todo el repo</option>
              {data.configs.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
        )}
        {data?.view === "ros" && data.sections && data.sections.length > 0 && (
          <label className="rg-field">
            <span>Sección</span>
            <select value={sec?.id ?? ""} onChange={(e) => pickSection(e.target.value)}>
              <option value="">Todo el sistema</option>
              {data.sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
        )}
        {data?.view === "ros" && data.panorama?.length ? (
          <button ref={panoramaBtn} type="button" className="rg-tour-btn" aria-pressed={panoramaOn} onClick={() => setPanoramaOn((v) => !v)}>Panorama</button>
        ) : null}
        {data && (
          <div className="rg-combo rg-search">
            <label className="sr-only" htmlFor={`rg-combo-${projectId}`}>Ir a un nodo o topic</label>
            <input
              id={`rg-combo-${projectId}`}
              type="text"
              role="combobox"
              autoComplete="off"
              placeholder="Ir a nodo o topic…"
              aria-expanded={listaAbierta}
              aria-controls={comboListId}
              aria-autocomplete="list"
              aria-activedescendant={listaAbierta && resultados[comboIdx] ? `${comboListId}-${comboIdx}` : undefined}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setComboOpen(true); setComboIdx(0); }}
              onKeyDown={teclaCombo}
              onBlur={() => setComboOpen(false)}
            />
            <ul className="rg-combo-lista" id={comboListId} role="listbox" aria-label="Resultados" hidden={!listaAbierta || resultados.length === 0}>
              {resultados.map((it, i) => (
                <li
                  key={it.id}
                  id={`${comboListId}-${i}`}
                  role="option"
                  aria-selected={i === comboIdx}
                  className="rg-combo-op"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegirResultado(it)}
                >
                  <span className="rg-combo-nombre">{it.label}</span>
                  <span className="rg-combo-meta">{it.tipo}{it.paquete ? ` · ${it.paquete}` : ""}</span>
                </li>
              ))}
            </ul>
            {listaAbierta && resultados.length === 0 && <p className="rg-combo-lista rg-combo-vacio">Sin resultados</p>}
          </div>
        )}
        {capas && !sec && activo.pasos.length > 0 && tourStep === null && (
          <>
            <button className="rg-tour-btn" onClick={() => startTour(0)}>{activo.tipo === "config" ? (configObj?.legado ? "▶ Recorrido del sistema anterior" : "▶ Recorrido de la configuración") : "▶ Recorrido"}</button>
            {saved !== null && (
              <>
                <button className="rg-tour-btn" onClick={() => startTour(saved)}>{textoRetomar(saved, activo.pasos.length)}</button>
                <button className="rg-tool" type="button" onClick={() => { borrarPaso(storage, recKey); startTour(0); }}>Empezar de nuevo</button>
              </>
            )}
          </>
        )}
        {sec && sec.tour.length > 0 && secStep === null && (
          <>
            <button className="rg-tour-btn" onClick={() => startSecTour(0)}>▶ Recorrido de la sección</button>
            {saved !== null && (
              <>
                <button className="rg-tour-btn" onClick={() => startSecTour(saved)}>{textoRetomar(saved, sec.tour.length)}</button>
                <button className="rg-tool" type="button" onClick={() => startSecTour(0)}>Empezar de nuevo</button>
              </>
            )}
          </>
        )}
        {data && (
          <div className="rg-menu" onKeyDown={teclaMenu("vista")}>
            <button ref={(el) => { menuBtns.current.vista = el; }} id={menuBtnId("vista")} type="button" className="rg-tool" aria-haspopup="menu" aria-expanded={menu === "vista"} aria-controls={menuPanelId("vista")} onClick={() => alternarMenu("vista")}>Vista ▾</button>
            <div className="rg-menu-panel" role="menu" id={menuPanelId("vista")} aria-labelledby={menuBtnId("vista")} data-menu="vista" hidden={menu !== "vista"}>
              {data.view === "ros" && config === "all" && (
                <button type="button" role="menuitemcheckbox" aria-checked={showOld} className="rg-menu-item" {...rv("legado")} onClick={() => setShowOld((v) => !v)}>Mostrar legado y sin uso</button>
              )}
              {data.view === "ros" && planDisponible({ planFlow: planFlow.length, seccion: sec?.id ?? null, config: configObj }) && (
                <button type="button" role="menuitemcheckbox" aria-checked={showPlan} className="rg-menu-item" {...rv("plan")} onClick={() => setShowPlan((v) => !v)}>Mostrar plan (arquitectura objetivo)</button>
              )}
              <button type="button" role="menuitemcheckbox" aria-checked={miniOn} className="rg-menu-item" {...rv("mini")} onClick={toggleMini}>Mostrar minimapa</button>
            </div>
          </div>
        )}
        {data && (
          <div className="rg-menu rg-vistas" onKeyDown={teclaMenu("vistas")}>
            <button ref={(el) => { menuBtns.current.vistas = el; }} id={menuBtnId("vistas")} type="button" className="rg-tool" aria-haspopup="menu" aria-expanded={menu === "vistas"} aria-controls={menuPanelId("vistas")} onClick={() => alternarMenu("vistas")}>Vistas ▾</button>
            <div className="rg-menu-panel" role="menu" id={menuPanelId("vistas")} aria-labelledby={menuBtnId("vistas")} data-menu="vistas" hidden={menu !== "vistas"}>
              <button type="button" role="menuitem" className="rg-menu-item" {...rv("guardar")} onClick={() => { setGuardando(""); setAvisoVistas(vistas.length >= MAX_VISTAS ? `Máximo ${MAX_VISTAS} vistas: borra una para guardar otra` : ""); }}>Guardar vista…</button>
              {guardando !== null && (
                <form className="rg-vistas-form" onSubmit={(e) => { e.preventDefault(); guardarVista(); }}>
                  <input
                    type="text"
                    maxLength={60}
                    autoFocus
                    aria-label="Nombre de la vista"
                    placeholder="Nombre de la vista"
                    value={guardando}
                    onChange={(e) => setGuardando(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Escape") return;
                      e.preventDefault();
                      e.stopPropagation();
                      setGuardando(null);
                      setAvisoVistas("");
                      itemsMenu("vistas")[0]?.focus();
                    }}
                  />
                  <button type="submit" className="rg-tool">Guardar</button>
                </form>
              )}
              <p className="rg-vistas-aviso" role="status">{avisoVistas}</p>
              {vistas.length === 0 && <p className="rg-vistas-vacio">Aún no hay vistas guardadas.</p>}
              <ul className="rg-vistas-lista" role="none">
                {vistas.map((v) => (
                  <li key={v.id} role="none">
                    {renombrando?.id === v.id ? (
                      <input
                        type="text"
                        maxLength={60}
                        autoFocus
                        aria-label={`Nuevo nombre de ${v.nombre}`}
                        value={renombrando.texto}
                        onChange={(e) => setRenombrando({ id: v.id, texto: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            persistirVistas(renombrarVista(vistas, v.id, renombrando.texto));
                            setRenombrando(null);
                            requestAnimationFrame(() => itemsMenu("vistas")[0]?.focus());
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            setRenombrando(null);
                            requestAnimationFrame(() => itemsMenu("vistas")[0]?.focus());
                          }
                        }}
                      />
                    ) : (
                      <>
                        <button type="button" role="menuitem" className="rg-menu-item rg-vistas-nombre" {...rv(`aplicar-${v.id}`)} onClick={accion(() => aplicarVista(v))}>{v.nombre}</button>
                        <button type="button" role="menuitem" className="rg-menu-item rg-vistas-op" aria-label={`Renombrar ${v.nombre}`} {...rv(`ren-${v.id}`)} onClick={() => setRenombrando({ id: v.id, texto: v.nombre })}>Renombrar</button>
                        <button type="button" role="menuitem" className="rg-menu-item rg-vistas-op" aria-label={`Borrar ${v.nombre}`} {...rv(`del-${v.id}`)} onClick={() => { persistirVistas(borrarVista(vistas, v.id)); setAvisoVistas("Vista borrada"); requestAnimationFrame(() => itemsMenu("vistas")[0]?.focus()); }}>Borrar</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {data && (
          <div className="rg-menu" onKeyDown={teclaMenu("mas")}>
            <button ref={(el) => { menuBtns.current.mas = el; }} id={menuBtnId("mas")} type="button" className="rg-tool" aria-haspopup="menu" aria-expanded={menu === "mas"} aria-controls={menuPanelId("mas")} onClick={() => alternarMenu("mas")}>Más ▾</button>
            <div className="rg-menu-panel" role="menu" id={menuPanelId("mas")} aria-labelledby={menuBtnId("mas")} data-menu="mas" hidden={menu !== "mas"}>
              <button ref={presBtn} type="button" role="menuitem" className="rg-menu-item" aria-pressed={present} aria-keyshortcuts="P" {...rv("pres")} onClick={accion(() => (present ? exitPresent() : enterPresent()))}>Modo presentación</button>
              {fsOk && <button type="button" role="menuitem" className="rg-menu-item" {...rv("fs")} onClick={accion(toggleFullscreen)}>{fs ? "Salir de pantalla completa" : "Pantalla completa"}</button>}
              <button type="button" role="menuitem" className="rg-menu-item" aria-disabled={ready === 0} {...rv("png")} onClick={accion(() => { if (ready !== 0) exportPng(); })}>Exportar PNG</button>
              <button type="button" role="menuitem" className="rg-menu-item" {...rv("enlace")} onClick={accion(() => { void copyLink(); })}>Copiar enlace</button>
            </div>
          </div>
        )}
        {data && (
          <button type="button" className="rg-tool rg-leyenda-btn" aria-expanded={leyendaOn} aria-controls={`rg-leyenda-${projectId}`} onClick={() => setLeyendaOn((v) => !v)}>Leyenda</button>
        )}
        <span className="rg-count" aria-live="polite">{data ? `${visibleCount} de ${data.nodes.filter((n) => !capas || OWNERS.has(n.kind)).length}` : ""}</span>
      </div>

      <p className="rg-copied rg-aviso" role="status" aria-live="polite">{aviso}</p>

      {data && (
        <div className="rg-legend" id={`rg-leyenda-${projectId}`} aria-label="Capas" hidden={!leyendaOn}>
          {data.groups.filter((gr) => !capas || !["topic", "service"].includes(gr.id)).map((gr) => (
            <button key={gr.id} className="rg-chip" aria-pressed={!hiddenGroups.has(gr.id)} title={gr.hint} onClick={() => toggleGroup(gr.id)}>
              <span className="rg-dot" style={{ background: groupColor.get(gr.id) }} />
              {gr.label}
            </button>
          ))}
          {data.view === "ros" && <span className="rg-chip rg-static"><span className="rg-dot" style={{ background: BROKEN }} aria-hidden="true" />Roto</span>}
          {planOn && <span className="rg-chip rg-static"><span className="rg-dot rg-dot-plan" />{LEYENDA_PLAN}</span>}
          {sec && contextRef.current.size > 0 && <span className="rg-chip rg-static"><span className="rg-dot" style={{ background: isDark() ? CONTEXT.dark : CONTEXT.light }} />En gris: lo que conecta con la sección</span>}
        </div>
      )}
      {configObj?.legado && (
        <p className="rg-legado" role="note">
          {AVISO_LEGADO}
          {configObj.enlace && <a href={configObj.enlace}>Ver discrepancias</a>}
        </p>
      )}
      {sinNucleo && <p className="rg-note" role="status">En esta sección solo hay nodos de legado o sin uso. Activa «Mostrar legado y sin uso» para verlos.</p>}

      {panoramaOn && data?.view === "ros" && data.panorama?.length ? (
        <nav className="rg-panorama" aria-label="Panorama del sistema" onKeyDown={(e) => {
          // Esc cierra solo el Panorama (no la presentación) y devuelve el foco a su botón.
          if (e.key !== "Escape") return;
          e.stopPropagation();
          setPanoramaOn(false);
          panoramaBtn.current?.focus();
        }}>
          <ol>
            {data.panorama.map((c, i) => (
              <li key={c.seccion}>
                {i > 0 && <span className="rg-panorama-flecha" aria-hidden="true">→</span>}
                <button type="button" className="rg-panorama-caja" aria-label={`${c.titulo}: ${c.texto}`} onClick={() => { pickSection(c.seccion); setPanoramaOn(false); }}>
                  <strong>{c.titulo}</strong>
                  <span>{c.texto}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="rg-stage" style={stageHeight ? { height: stageHeight } : undefined}>
        <div ref={container} className="rg-canvas" style={{ pointerEvents: active ? "auto" : "none" }} role="img" aria-label={`Grafo: ${data?.title ?? ""}. La tabla de abajo tiene la misma información en texto.`} />
        <canvas ref={overlay} className="rg-flow" aria-hidden="true" />
        {!data && !error && <p className="rg-msg">Cargando el grafo…</p>}
        {error && <p className="rg-msg">No se pudo cargar el grafo ({error}).</p>}
        {touch && !active && data && !step && (
          <button className="rg-shield" onClick={() => setActive(true)}>Tocar para explorar el grafo</button>
        )}
        {miniOn && data && (
          <canvas
            ref={mini}
            className="rg-minimap"
            aria-hidden="true"
            onPointerDown={(e) => { miniDrag.current = true; e.currentTarget.setPointerCapture(e.pointerId); miniGo(e); }}
            onPointerMove={(e) => { if (miniDrag.current) miniGo(e); }}
            onPointerUp={(e) => { miniDrag.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId); }}
            onPointerCancel={() => { miniDrag.current = false; }}
          />
        )}
        {present && <button className="rg-exit" type="button" onClick={exitPresent}>Salir (Esc)</button>}
        <div className="rg-zoom" hidden={!active || Boolean(step)}>
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
            {notaPlan(node) && <p className="rg-row rg-plan-nota">{notaPlan(node)}</p>}
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
                    {list.map(({ e, n, plan }, i) => (
                      <li key={i}>
                        <button className="rg-link" onClick={() => setSelected(n.id)}>{n.label}</button>
                        {e.label && <code className="rg-type">{e.label}</code>}
                        {e.file && <a href={codeUrl(e.file, e.line)} target="_blank" rel="noopener noreferrer" aria-label="Ver la línea en GitHub (se abre en otra pestaña)">↗</a>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
            <div className="rg-actions">
              {node.file && node.kind !== "page" && <a className="btn" href={codeUrl(node.file, node.line)} target="_blank" rel="noopener noreferrer">Ver código ↗</a>}
              {node.doc && <a className="btn btn-primary" href={node.doc}>Ver documentación completa</a>}
              <button className="btn" type="button" onClick={copyLink}>Copiar enlace a este nodo</button>
            </div>
            <p className="rg-copied" aria-hidden="true">{aviso}</p>
          </aside>
        )}
      </div>

      {step && stepIdx !== null && (
        <div className="rg-tour" role="dialog" aria-label={secStep !== null ? "Recorrido de la sección" : activo.tipo === "config" ? (configObj?.legado ? "Recorrido del sistema anterior" : "Recorrido de la configuración") : "Recorrido guiado"} aria-live="polite">
          <p className="rg-tour-step">{secStep !== null && sec ? `${sec.label} · ` : ""}Paso {stepIdx + 1} de {steps.length}</p>
          <p>{step.text}</p>
          {activo.tipo === "config" && configObj?.legado && configObj.enlace && <p><a className="rg-tour-link" href={configObj.enlace}>Ver discrepancias</a></p>}
          <div className="rg-tour-actions">
            <button onClick={endTour}>{secStep !== null ? "Cerrar" : "Saltar"}</button>
            {present && stepIdx > 0 && <button onClick={() => setStepIdx(0)}>Desde el inicio</button>}
            {present ? <small className="rg-keys">← → para avanzar</small> : null}
            <span />
            {stepIdx > 0 && <button onClick={() => setStepIdx(stepIdx - 1)}>Anterior</button>}
            {stepIdx < steps.length - 1
              ? <button className="rg-primary" onClick={() => setStepIdx(stepIdx + 1)}>Siguiente</button>
              : <button className="rg-primary" onClick={endTour}>Terminar</button>}
          </div>
        </div>
      )}
    </div>
  );
}
