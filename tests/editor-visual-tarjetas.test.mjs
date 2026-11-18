// Tarjetas de los bloques del portal dentro del editor visual (Crepe en jsdom con los bloques montados): se pintan con el
// renderizador saneado de la lectura y no dejan atributos de evento, scripts ni URLs javascript:, aunque el título o las celdas
// del BOM los intenten colar. El DOM se prepara antes de importar Milkdown (su DOMPurify se ata a la ventana al cargarse).
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepararDom } from "./fixtures/dom-editor.mjs";

const dom = prepararDom({ bloquesVisibles: true });
const doc = dom.window.document;
const { montarCrepe } = await import("../src/lib/editor-visual-crepe.ts");
const { vistaBloque } = await import("../src/lib/editor-visual.ts");
const { crearRenderizador } = await import("../src/lib/hardware-md.ts");
const { html } = crearRenderizador(dom.window, { proyecto: "uuv" });

test("dentro del editor visual las tarjetas se pintan y no dejan vectores (título, celdas del BOM, javascript:)", async () => {
  const PDF = "2f4b20ae-ad0a-48f2-9047-98aa57be8f55";
  const md = [
    "Texto.",
    "",
    "```pdf",
    `archivo: ${PDF}`,
    'titulo: x" onerror="alert(1)',
    "```",
    "",
    "```bom",
    "referencia,descripcion,cantidad,costo_unitario,proveedor",
    "R1,<img src=x onerror=alert(1)>,1,0.5,javascript:alert(1)",
    'R2,"<a href=javascript:alert(2)>x</a>",1,1,<script>alert(3)</script>',
    "```",
    "",
  ].join("\n");
  const raiz = doc.createElement("div");
  doc.body.append(raiz);
  const ed = await montarCrepe(raiz, md, { renderizarBloque: (l, c) => vistaBloque(html, l, c, { editable: true }) });
  await new Promise((r) => setTimeout(r, 200));
  try {
    assert.ok(raiz.querySelector("figure.hw-pdf"), "la tarjeta del PDF se pinta en el editor");
    assert.ok(raiz.querySelector("figure.hw-bom table"), "la tabla del BOM se pinta en el editor");
    assert.match(raiz.querySelector("figure.hw-pdf figcaption")?.textContent ?? "", /onerror="alert\(1\)/, "el título se ve como texto");
    for (const fig of raiz.querySelectorAll("figure")) {
      assert.equal(fig.querySelector("script, iframe, object, embed"), null);
      for (const el of [fig, ...fig.querySelectorAll("*")]) {
        for (const a of el.attributes) {
          assert.doesNotMatch(a.name, /^on/i, `atributo ${a.name} en <${el.localName}>`);
          assert.doesNotMatch(a.value.replace(/\s/g, ""), /^javascript:/i, `${a.name}=javascript: en <${el.localName}>`);
        }
      }
    }
    assert.equal(raiz.querySelector("figure.hw-bom tbody img, figure.hw-bom tbody a"), null, "las celdas no crean elementos");
  } finally {
    await ed.destruir();
  }
});
