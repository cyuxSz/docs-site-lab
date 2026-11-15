import { Marked } from "marked";
import createDOMPurify from "dompurify";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cp = (n: number) => (n >= 0xd800 && n <= 0xdfff ? "" : String.fromCodePoint(Math.min(n, 0x10ffff)));
function normal(v: string) {
  return v.replace(/&#x([0-9a-f]+);?/gi, (_, h) => cp(parseInt(h, 16))).replace(/&#(\d+);?/g, (_, d) => cp(Number(d)))
    .replace(/&(colon|tab|newline);?/gi, (_, n) => ({ colon: ":", tab: "\t", newline: "\n" } as any)[n.toLowerCase()])
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}
export function urlSegura(valor: string, tipo: "href" | "src"): string | null {
  const v = String(valor ?? "").trim();
  const n = normal(v);
  if (!n) return null;
  if (tipo === "src") return /^\/api\/archivos\/?\?/.test(n) && n === v ? v : null;
  if (["//", "\\\\", "/\\", "\\/"].some((p) => n.startsWith(p))) return null;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(n);
  if (m) return /^(https?|mailto)$/i.test(m[1]) ? v : null;
  if (/&colon;|&#/i.test(v)) return null;
  return v;
}
const TAGS = ["a","p","br","hr","h1","h2","h3","h4","h5","h6","strong","em","del","s","code","pre","blockquote","ul","ol","li","table","thead","tbody","tr","th","td","img","input"];
const ATTR = ["href","src","alt","title","align","start","type","checked","disabled","class"];
export function crearRenderizador(win: any) {
  const marked = new Marked({ gfm: true, renderer: { html({ text }: any) { return esc(text); } } });
  const P = createDOMPurify(win);
  P.addHook("afterSanitizeAttributes", (el: any) => {
    for (const a of ["href", "src"]) if (el.hasAttribute(a)) { const s = urlSegura(el.getAttribute(a), a as any); if (s === null) el.removeAttribute(a); }
    if (el.tagName === "A" && /^https?:/i.test(el.getAttribute("href") ?? "")) el.setAttribute("rel", "noopener noreferrer");
    if (el.tagName === "INPUT") { if (el.getAttribute("type") !== "checkbox") el.remove(); else el.setAttribute("disabled", ""); }
    if (el.hasAttribute("class") && !(el.tagName === "CODE" && /^language-[\w+#-]+$/.test(el.getAttribute("class")))) el.removeAttribute("class");
  });
  const conf = { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false };
  return {
    html: (md: string) => P.sanitize(marked.parse(String(md), { async: false }) as string, conf) as string,
    fragmento: (md: string) => P.sanitize(marked.parse(String(md), { async: false }) as string, { ...conf, RETURN_DOM_FRAGMENT: true }) as DocumentFragment,
  };
}
