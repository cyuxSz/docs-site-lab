// C1 importar: marcado, pegamento DOM y seguridad del contenido importado.
// - src/pages/[project]/[disciplina].astro: dos botones «Importar» junto a la creación de páginas (nunca en «Insertar»),
//   un <input type="file"> oculto y el componente src/components/HwImportar.astro con el diálogo de tres estados.
// - src/scripts/hardware-importar.ts: único módulo con DOM; hardware-editor.ts solo lo importa y lo conecta.
// El comportamiento del diálogo (foco, Escape, cuenta atrás, recarga) se comprueba en el navegador: ver «Verificación».
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const PAGINA = "src/pages/[project]/[disciplina].astro";
const COMPONENTE = "src/components/HwImportar.astro";
const PEGAMENTO = "src/scripts/hardware-importar.ts";
const NUEVOS = ["src/lib/importar-plan.ts", "src/lib/importar-zip.ts", "src/lib/importar-cola.ts", PEGAMENTO];
const existe = (rel) => existsSync(new URL(`../${rel}`, import.meta.url));
const leer = (rel) => {
  assert.ok(existe(rel), `falta ${rel}`);
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
};
// El marcado de un .astro (sin el frontmatter) se puede leer como HTML: las expresiones {…} quedan como texto.
const dom = (rel) => new JSDOM(leer(rel).replace(/^---[\s\S]*?\n---\r?\n/, "")).window.document;
const txt = (el) => el.textContent.replace(/\s+/g, " ").trim();

// ---------- página ----------

test("barra lateral: botón «Importar» en p.hw-nueva, junto a «Nueva página» y «Papelera», solo para editores", () => {
  const d = dom(PAGINA);
  const p = d.querySelector("p.hw-nueva");
  assert.ok(p.hasAttribute("data-hw-solo-editor") && p.hasAttribute("hidden"));
  assert.deepEqual([...p.querySelectorAll("button")].map(txt), ["Nueva página", "Importar", "Papelera"]);
  const b = p.querySelector("button[data-hw-importar]");
  assert.equal(txt(b), "Importar");
  assert.equal(b.getAttribute("type"), "button");
  assert.equal(b.className, "btn");
  assert.equal(b.getAttribute("aria-haspopup"), "dialog");
});

test("estado vacío: botón secundario «Importar páginas» junto a «Inicializar desde plantilla», oculto a quien no es editor", () => {
  const d = dom(PAGINA);
  const vacio = d.querySelector("section.hw-vacio");
  assert.deepEqual([...vacio.querySelectorAll("button")].map(txt), ["Inicializar desde plantilla", "Importar páginas"]);
  const b = vacio.querySelector("button[data-hw-importar]");
  assert.equal(b.getAttribute("type"), "button");
  assert.equal(b.className, "btn", "secundario: sin btn-primary");
  assert.ok(b.hasAttribute("data-hw-solo-editor"), "lo muestra el bucle de [data-hw-solo-editor] solo si editable");
  assert.ok(b.hasAttribute("hidden"), "nace oculto");
  assert.equal(d.querySelectorAll("[data-hw-importar]").length, 2);
});

test("«Importar» no está en el menú «Insertar» ni dentro del formulario del editor", () => {
  const d = dom(PAGINA);
  const menu = d.querySelector(".hw-insertar-menu");
  assert.ok(menu);
  assert.equal(menu.querySelector("[data-hw-importar]"), null);
  assert.doesNotMatch(txt(menu), /importar/i);
  assert.equal(d.querySelector("form.hw-editor [data-hw-importar]"), null);
});

test("selector de archivos oculto: .md y .zip, múltiple, fuera del orden de tabulación", () => {
  const entradas = [...dom(PAGINA).querySelectorAll("input[data-hw-importar-archivos]"), ...(existe(COMPONENTE) ? dom(COMPONENTE).querySelectorAll("input[data-hw-importar-archivos]") : [])];
  assert.equal(entradas.length, 1, "un solo input, en la página o en el componente");
  const i = entradas[0];
  assert.equal(i.getAttribute("type"), "file");
  assert.equal(i.getAttribute("accept"), ".md,.zip");
  assert.ok(i.hasAttribute("multiple"));
  assert.ok(i.classList.contains("hw-archivo"));
  assert.equal(i.getAttribute("tabindex"), "-1");
  assert.equal(i.getAttribute("aria-hidden"), "true");
  assert.equal(i.closest("form"), null, "fuera del formulario del editor");
});

test("la página incluye el componente HwImportar con una sola línea de marcado", () => {
  const src = leer(PAGINA);
  assert.match(src, /import\s+HwImportar\s+from\s+["']\.\.\/\.\.\/components\/HwImportar\.astro["']/);
  assert.equal(src.match(/<HwImportar\b[^>]*\/>/g)?.length, 1);
  assert.doesNotMatch(src, /id=["']hw-importar["']/, "el diálogo vive en el componente");
});

// ---------- diálogo ----------

test("diálogo #hw-importar: reutiliza atajos-dialog, título «Importar páginas» y tres estados con uno solo visible", () => {
  const d = dom(COMPONENTE);
  const dlg = d.querySelector("dialog#hw-importar");
  assert.ok(dlg, "dialog#hw-importar");
  assert.ok(dlg.classList.contains("atajos-dialog"));
  assert.equal(dlg.getAttribute("aria-labelledby"), "hw-importar-titulo");
  assert.equal(txt(dlg.querySelector("h2#hw-importar-titulo")), "Importar páginas");
  assert.equal(d.querySelectorAll("dialog").length, 1);
  const estados = [...dlg.querySelectorAll("[data-hw-imp]")];
  assert.deepEqual(estados.map((e) => e.getAttribute("data-hw-imp")), ["revision", "progreso", "resultado"]);
  assert.deepEqual(estados.map((e) => e.hasAttribute("hidden")), [false, true, true]);
  assert.ok(dlg.querySelector(".atajos-bar"), "barras de atajos-dialog");
  const src = leer(COMPONENTE);
  assert.doesNotMatch(src, /<style\b|\sstyle=|<script\b/i, "sin estilos ni scripts propios: el CSS va en global.css y la lógica en hardware-importar.ts");
});

test("estado de revisión: resumen, lista de páginas, avisos (ocultos si no hay) y botones «Importar» (primario) y «Cancelar»", () => {
  const e = dom(COMPONENTE).querySelector('[data-hw-imp="revision"]');
  assert.ok(e.querySelector("p[data-hw-imp-resumen]"));
  const lista = e.querySelector("ul[data-hw-imp-paginas]");
  assert.ok(lista.classList.contains("hw-importar-lista"));
  assert.equal(lista.children.length, 0, "las filas las crea el script con textContent");
  const avisos = e.querySelector("[data-hw-imp-avisos]");
  assert.ok(avisos.hasAttribute("hidden"));
  assert.match(txt(avisos), /^Avisos$/);
  assert.ok(avisos.querySelector("ul.hw-importar-lista"));
  const botones = [...e.querySelectorAll("button")];
  assert.deepEqual(botones.map(txt), ["Importar", "Cancelar"]);
  assert.ok(botones[0].hasAttribute("data-hw-imp-ok") && botones[0].classList.contains("btn-primary"));
  assert.ok(botones[1].hasAttribute("data-hw-imp-cancelar"));
  for (const b of botones) assert.equal(b.getAttribute("type"), "button");
});

test("estado de progreso: <progress class=hw-progreso>, línea aria-live=polite, cuenta atrás fuera de la región viva y botón «Detener»", () => {
  const e = dom(COMPONENTE).querySelector('[data-hw-imp="progreso"]');
  const barra = e.querySelector("progress[data-hw-imp-barra]");
  assert.ok(barra.classList.contains("hw-progreso"));
  assert.ok((barra.getAttribute("aria-label") ?? "").length > 0);
  const linea = e.querySelector("[data-hw-imp-linea]");
  assert.equal(linea.getAttribute("aria-live"), "polite");
  assert.equal(e.querySelectorAll("[aria-live]").length, 1);
  // La cuenta atrás visible cambia cada segundo: va aparte y oculta al lector de pantalla, que solo oye la línea.
  const cuenta = e.querySelector("[data-hw-imp-cuenta]");
  assert.equal(cuenta.getAttribute("aria-hidden"), "true");
  assert.equal(cuenta.closest("[aria-live]"), null);
  assert.deepEqual([...e.querySelectorAll("button")].map(txt), ["Detener"]);
  assert.ok(e.querySelector("button[data-hw-imp-detener]"));
});

test("estado de resultado: resumen, mensaje de parada, lo que quedó sin importar, avisos y botones «Reintentar lo pendiente» (oculto) y «Cerrar»", () => {
  const e = dom(COMPONENTE).querySelector('[data-hw-imp="resultado"]');
  assert.ok(e.querySelector("p[data-hw-imp-resultado]"));
  const error = e.querySelector("p.hw-error[data-hw-imp-error]");
  assert.equal(error.getAttribute("role"), "alert");
  assert.ok(error.hasAttribute("hidden"));
  assert.ok(e.querySelector("ul.hw-importar-lista[data-hw-imp-pendientes]"));
  assert.ok(e.querySelector("ul.hw-importar-lista[data-hw-imp-avisos-finales]"));
  const botones = [...e.querySelectorAll("button")];
  assert.deepEqual(botones.map(txt), ["Reintentar lo pendiente", "Cerrar"]);
  assert.ok(botones[0].hasAttribute("data-hw-imp-reintentar") && botones[0].hasAttribute("hidden"));
  assert.ok(botones[1].hasAttribute("data-hw-imp-cerrar"));
});

// ---------- pegamento DOM ----------

test("hardware-importar.ts: exporta conectarImportar y nunca interpreta como HTML lo que viene del archivo", () => {
  const src = leer(PEGAMENTO);
  assert.match(src, /export\s+(async\s+)?function\s+conectarImportar\b/);
  assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment|setHTML/);
  assert.match(src, /\.textContent\s*=/);
  for (const lib of ["importar-plan", "importar-zip", "importar-cola"]) assert.match(src, new RegExp(`from\\s+["']\\.\\./lib/${lib}(\\.ts)?["']`), lib);
});

test("hardware-importar.ts: fflate se carga perezosamente con import() de /vendor/fflate/fflate.js, sin dependencia npm ni Workers", () => {
  const src = leer(PEGAMENTO);
  assert.match(src, /["']\/vendor\/fflate\/fflate\.js["']/);
  assert.match(src, /import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*[A-Za-z_$][\w$]*\s*\)/, "import() dinámico de una variable con @vite-ignore: Vite no debe empaquetar lo que hay en public/");
  for (const rel of NUEVOS) {
    const s = leer(rel);
    assert.doesNotMatch(s, /from\s+["']fflate["']|import\(\s*["']fflate["']\s*\)/, `${rel}: sin paquete npm`);
    assert.doesNotMatch(s, /\bnew\s+Worker\b|createObjectURL/, `${rel}: sin Workers ni blob:`);
    assert.doesNotMatch(s, /["'`]https?:\/\//, `${rel}: ninguna petición ni recurso fuera del origen`);
  }
  assert.doesNotMatch(leer(PEGAMENTO), /^import\s[^;]*fflate/m, "nada de import estático");
});

test("hardware-importar.ts: diálogo modal, Escape controlado, aviso al salir, tamaño comprobado antes de leer y uuid del navegador", () => {
  const src = leer(PEGAMENTO);
  assert.match(src, /showModal\(/);
  assert.match(src, /["']cancel["']/, "Escape pasa por el evento cancel del diálogo: en progreso equivale a «Detener»");
  assert.match(src, /["']beforeunload["']/);
  assert.match(src, /MENSAJE_EDICION_ABIERTA/);
  assert.match(src, /clasificarSeleccion\(/);
  assert.match(src, /LIMITES\b/);
  assert.match(src, /\.size\b/, "el tamaño del File se mira antes de leerlo");
  assert.match(src, /crypto\.randomUUID/);
  assert.match(src, /AbortController/);
  assert.match(src, /\.focus\(/);
});

test("hardware-editor.ts: solo importa el pegamento y lo conecta; la lógica de importar no entra en él", () => {
  const src = leer("src/scripts/hardware-editor.ts");
  assert.match(src, /import\s*\{\s*conectarImportar\s*\}\s*from\s+["']\.\/hardware-importar(\.ts)?["']/);
  assert.equal(src.match(/conectarImportar\(/g)?.length, 1);
  assert.doesNotMatch(src, /fflate|importar-plan|importar-zip|importar-cola|data-hw-imp\b|hw-importar-archivos/);
});

// ---------- estilos ----------

test("global.css: solo maquetación para el diálogo; la lista tiene altura máxima y scroll propio; sin colores nuevos", () => {
  const css = leer("src/styles/global.css");
  const reglas = css.match(/[^{}]*hw-importar[^{}]*\{[^{}]*\}/g) ?? [];
  assert.ok(reglas.length >= 1, "faltan las reglas .hw-importar-*");
  assert.ok(reglas.length <= 8, `CSS mínimo: ${reglas.length} reglas`);
  const lista = reglas.find((r) => /\.hw-importar-lista\b[^{]*\{/.test(r) && /max-height/.test(r));
  assert.ok(lista, ".hw-importar-lista con max-height");
  assert.match(lista, /overflow(-y)?\s*:\s*auto/);
  for (const r of reglas) assert.doesNotMatch(r, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|font-family/, r.trim().slice(0, 60));
});

// ---------- contenido importado ----------

test("un md importado con <script>, onerror= y javascript: se guarda tal cual y el render existente lo deja limpio", async () => {
  const { analizar, reescribirMd } = await import("../src/lib/importar-plan.ts");
  const { crearRenderizador } = await import("../src/lib/hardware-md.ts");
  const ID = "3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a90";
  const malo = [
    "# <img src=x onerror=alert(1)> Título",
    "<script>alert(1)</script>",
    '<img src="x" onerror="alert(1)">',
    '<a href="javascript:alert(1)">crudo</a>',
    "[enlace](javascript:alert(1))",
    "![foto](img/foto.png)",
    "![externa](https://evil.example/pixel.png)",
    '<iframe src="https://evil.example/"></iframe>',
    '<svg onload="alert(1)"><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    "",
  ].join("\n\n");
  const plan = analizar({ entradas: [{ ruta: '"><img src=x onerror=alert(1)>.md', bytes: new TextEncoder().encode(malo) }, { ruta: "img/foto.png", bytes: new Uint8Array([1, 2, 3]) }], existentes: [] });
  const [pagina] = plan.paginas;
  assert.equal(pagina.md, malo, "la importación no limpia ni interpreta el md: eso es cosa del render");
  assert.match(pagina.slug, /^[a-z0-9-]{1,60}$/);
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(pagina.titulo) && pagina.titulo.length <= 120);
  const md = reescribirMd(pagina.md, { ruta: pagina.ruta, proyecto: "uuv", disciplina: "electronica", slugs: new Map([[pagina.ruta, pagina.slug]]), subidas: new Map([["img/foto.png", { id: ID, nombre: "foto.png" }]]) });
  assert.ok(md.includes(`![foto](/api/archivos/?proyecto=uuv&id=${ID})`));
  const win = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://docs.example/uuv/electronica/" }).window;
  win.document.body.replaceChildren(crearRenderizador(win, { proyecto: "uuv" }).fragmento(md));
  const body = win.document.body;
  assert.equal(body.querySelectorAll("script, iframe, svg, object, embed, style, link").length, 0);
  for (const el of body.querySelectorAll("*")) {
    for (const a of el.attributes) {
      assert.doesNotMatch(a.name, /^on/i, `${el.tagName} ${a.name}`);
      assert.doesNotMatch(a.value, /javascript:/i, `${el.tagName} ${a.name}`);
    }
  }
  const imagenes = [...body.querySelectorAll("img")].map((i) => i.getAttribute("src")).filter(Boolean);
  assert.deepEqual(imagenes, [`/api/archivos/?proyecto=uuv&id=${ID}`], "solo se ve la imagen subida al portal");
});
