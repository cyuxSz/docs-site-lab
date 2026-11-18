// Entorno jsdom mínimo para montar el editor visual (Milkdown Crepe) en Node. Milkdown usa addEventListener/dispatchEvent
// globales con CustomEvent nativo (por eso van sobre un EventTarget de Node, no sobre la ventana de jsdom), Vue mira
// SVGElement y el bloque de código usa IntersectionObserver. Se llama antes de importar nada de Milkdown.
import { JSDOM } from "jsdom";

export function prepararDom() {
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
