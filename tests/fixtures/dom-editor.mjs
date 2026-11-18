// Entorno jsdom mínimo para montar el editor visual (Milkdown Crepe) en Node. Milkdown usa addEventListener/dispatchEvent
// globales con CustomEvent nativo (por eso van sobre un EventTarget de Node, no sobre la ventana de jsdom), Vue mira
// SVGElement y el bloque de código usa IntersectionObserver. Se llama antes de importar nada de Milkdown.
import { JSDOM } from "jsdom";

// Con { bloquesVisibles: true } los bloques de código se montan al momento (CodeMirror y la tarjeta de renderPreview), como si
// estuvieran en pantalla; sin la opción se quedan en el marcador de posición, igual que hasta ahora.
export function prepararDom({ bloquesVisibles = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><body><div id=raiz></div></body></html>", { url: "https://docs.example/uuv/electronica/", pretendToBeVisual: true });
  const w = dom.window;
  const nombres = [
    "window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLDivElement", "HTMLImageElement", "HTMLInputElement",
    "HTMLButtonElement", "HTMLSpanElement", "HTMLTemplateElement", "HTMLTableElement", "HTMLTableCellElement", "HTMLCanvasElement",
    "SVGElement", "Text", "Range", "Selection", "DocumentFragment", "ShadowRoot", "DOMParser", "MutationObserver", "getComputedStyle",
    "getSelection", "requestAnimationFrame", "cancelAnimationFrame", "customElements", "Image", "KeyboardEvent", "MouseEvent",
    "InputEvent", "FocusEvent", "UIEvent", "CompositionEvent", "ClipboardEvent", "DragEvent",
  ];
  for (const k of nombres) {
    if (w[k] === undefined) continue;
    const valor = typeof w[k] === "function" && /^[a-z]/.test(k) ? w[k].bind(w) : w[k];
    Object.defineProperty(globalThis, k, { value: valor, configurable: true, writable: true });
  }
  const bus = new EventTarget();
  for (const k of ["addEventListener", "removeEventListener", "dispatchEvent"]) globalThis[k] = bus[k].bind(bus);
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  if (bloquesVisibles) {
    globalThis.IntersectionObserver = class {
      constructor(cb) { this.cb = cb; }
      observe(el) { queueMicrotask(() => this.cb([{ isIntersecting: true, intersectionRatio: 1, target: el }], this)); }
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    };
    globalThis.Window = w.Window; // CodeMirror lo usa al medir
    w.Range.prototype.getClientRects ??= () => [];
    w.Range.prototype.getBoundingClientRect ??= () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
  }
  w.IntersectionObserver = globalThis.IntersectionObserver;
  w.ResizeObserver = globalThis.ResizeObserver;
  const rango = w.document.createRange.bind(w.document);
  w.document.createRange = () => {
    const r = rango();
    r.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
    r.getClientRects = () => [];
    return r;
  };
  return dom;
}
