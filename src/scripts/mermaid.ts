// Mermaid pesa ~950 KB: solo se descarga en páginas con diagramas y cuando el diagrama entra en pantalla.
export function renderMermaid() {
  // Con excludeLangs, Astro deja estos bloques como <pre><code class="language-mermaid">.
  const blocks = [...document.querySelectorAll<HTMLElement>("pre:has(> code.language-mermaid)")];
  if (!blocks.length) return;
  const observer = new IntersectionObserver(
    async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      const { default: mermaid } = await import("mermaid");
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      mermaid.initialize({ startOnLoad: false, theme: dark ? "dark" : "default", securityLevel: "strict", fontFamily: "inherit" });
      const nodes = blocks.map((pre) => {
        const div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = pre.textContent;
        pre.replaceWith(div);
        return div;
      });
      await mermaid.run({ nodes, suppressErrors: true });
    },
    { rootMargin: "200px" },
  );
  blocks.forEach((b) => observer.observe(b));
}
