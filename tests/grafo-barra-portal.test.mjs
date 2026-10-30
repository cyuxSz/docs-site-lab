// Lote 8b · cableado de la barra del grafo en RoboticsGraph: menús "Vista ▾" y "Más ▾", leyenda plegable, vistas
// guardadas, buscador combobox, chip "Roto" y Esc del Panorama. Lectura de fuente: lo visual (una fila en escritorio,
// 375 px sin desborde, temas, foco) va a la verificación en navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const TSX = read("src/components/RoboticsGraph.tsx");
const CSS = read("src/components/RoboticsGraph.css");
const reglas = (sel) => CSS.split("}").filter((r) => r.split("{")[0].includes(sel)).join("}\n");

test("menús: botones 'Vista' y 'Más' con aria-haspopup=menu y aria-expanded, y role=menu", () => {
  assert.match(TSX, />\s*Mostrar\s*▾\s*</, "botón Mostrar");
  assert.match(TSX, />\s*Guardadas\s*▾\s*</, "botón Guardadas");
  assert.doesNotMatch(TSX, />\s*Vistas?\s*▾\s*</, "sin los nombres viejos Vista/Vistas");
  assert.match(TSX, />\s*Más\s*▾?\s*</, "botón Más");
  assert.ok((TSX.match(/aria-haspopup="menu"/g) ?? []).length >= 2, "al menos dos botones con aria-haspopup=menu");
  assert.match(TSX, /aria-expanded=\{/);
  assert.match(TSX, /role="menu"/);
  assert.match(TSX, /from "\.\.\/lib\/menu(\.ts)?"/);
  assert.match(TSX, /navegarLista\(/);
  assert.match(TSX, /accionMenu\(/);
});

test("menú Vista: legado, plan y minimapa como menuitemcheckbox con aria-checked (ya no checkboxes sueltos)", () => {
  assert.ok((TSX.match(/role="menuitemcheckbox"/g) ?? []).length >= 1, "usa menuitemcheckbox");
  assert.match(TSX, /aria-checked=\{filtros\.legado\}/, "lote 8c: legado y sin uso son dos toggles");
  assert.match(TSX, /aria-checked=\{showPlan\}/);
  assert.match(TSX, /aria-checked=\{miniOn\}/);
  assert.doesNotMatch(TSX, /type="checkbox"/, "los toggles viven en el menú, no como <input type=checkbox> en la barra");
});

test("menú Más: presentación, pantalla completa, exportar PNG y copiar enlace como menuitem", () => {
  assert.match(TSX, /role="menuitem"/);
  assert.match(TSX, /Modo presentación/);
  assert.match(TSX, /Pantalla completa/);
  assert.match(TSX, /Exportar PNG/);
  assert.match(TSX, /Copiar enlace/);
  // Copiar enlace desde el menú no depende de tener un nodo abierto.
  assert.ok((TSX.match(/onClick=\{copyLink\}|copyLink\(\)/g) ?? []).length >= 2, "copiar enlace en el panel y en el menú Más");
});

test("menús: Esc para la propagación y devuelve el foco al botón; clic fuera cierra con listener que se limpia", () => {
  assert.match(TSX, /stopPropagation\(\)/);
  assert.ok((TSX.match(/stopPropagation\(\)/g) ?? []).length >= 2, "Esc del menú y del Panorama/buscador no llega al listener global");
  assert.match(TSX, /addEventListener\("pointerdown"|addEventListener\("mousedown"|addEventListener\("click"/);
  assert.match(TSX, /removeEventListener\("pointerdown"|removeEventListener\("mousedown"|removeEventListener\("click"/);
});

test("leyenda plegable: botón 'Leyenda' con aria-expanded y aria-controls hacia la leyenda", () => {
  assert.match(TSX, />\s*Leyenda\s*</);
  assert.match(TSX, /aria-controls=\{?["`'][^"`']*leyenda/i);
  assert.match(TSX, /className="rg-legend"[^>]*id=|id=[^>]*className="rg-legend"/);
});

test("leyenda plegada por defecto en todas las pantallas (sin depender del ancho)", () => {
  assert.match(TSX, /const \[leyendaOn, setLeyendaOn\] = useState\(false\)/);
  assert.doesNotMatch(TSX, /setLeyendaOn\(\s*innerWidth/);
  assert.match(TSX, /aria-expanded=\{leyendaOn\}/);
  assert.match(TSX, /hidden=\{!leyendaOn \|\| Boolean\(comparar\)\}/);
});

test("chip Roto: misma estructura que los demás y sin solaparse (nowrap, sin posición absoluta en la leyenda)", () => {
  assert.match(TSX, /rg-chip rg-static[^<]*<span className="rg-dot"[^>]*aria-hidden="true"[^>]*\/>\s*Roto/);
  assert.match(reglas(".rg-chip"), /white-space:\s*nowrap/);
  assert.doesNotMatch(reglas(".rg-legend"), /position:\s*absolute/);
  assert.doesNotMatch(reglas(".rg-chip"), /margin[^;]*-\d/, "sin márgenes negativos en los chips");
});

test("Panorama: al abrir, el foco pasa a la primera caja; cajas con aria-label 'Título: texto'; oculto en presentación", () => {
  assert.match(TSX, /aria-label=\{`\$\{c\.titulo\}: \$\{c\.texto\}`\}/);
  assert.match(TSX, /rg-panorama-caja[^;]*\.focus\(\)|querySelector<HTMLElement>\("\.rg-panorama-caja"\)\?\.focus\(\)/);
  assert.match(CSS, /\.rg-presenting[^{]*\.rg-panorama[\s,{]/);
});

test("vistas guardadas: usa src/lib/vistas con almacenSeguro y clave por proyecto; aplicar/renombrar/borrar", () => {
  assert.match(TSX, /from "\.\.\/lib\/vistas(\.ts)?"/);
  for (const f of ["claveVistas(", "leerVistas(", "serializarVistas(", "agregarVista(", "renombrarVista(", "borrarVista(", "vistaAplicable("]) {
    assert.ok(TSX.includes(f), `usa ${f}`);
  }
  assert.match(TSX, /claveVistas\(projectId\)/);
  assert.match(TSX, /Guardar vista/);
  assert.doesNotMatch(TSX, /localStorage\.(get|set|remove)Item/, "localStorage solo vía almacenSeguro (try/catch)");
  assert.doesNotMatch(TSX, /window\.prompt|\bprompt\(/, "sin prompt(): el nombre se escribe en un campo propio");
});

test("buscador: combobox ARIA con listbox; sin datalist; usa src/lib/busqueda", () => {
  assert.match(TSX, /from "\.\.\/lib\/busqueda(\.ts)?"/);
  assert.match(TSX, /candidatosBusqueda\(/);
  assert.match(TSX, /filtrarBusqueda\(/);
  assert.match(TSX, /destinoBusqueda\(/);
  assert.match(TSX, /role="combobox"/);
  assert.match(TSX, /aria-autocomplete="list"/);
  assert.match(TSX, /aria-activedescendant=/);
  assert.match(TSX, /role="listbox"/);
  assert.match(TSX, /role="option"/);
  assert.match(TSX, /aria-selected=/);
  assert.doesNotMatch(TSX, /<datalist/);
  // El resultado muestra tipo y paquete.
  assert.match(TSX, /\.tipo\b/);
  assert.match(TSX, /\.paquete\b/);
});

test("barra: una fila que no desborda en 375 px (wrap o scroll horizontal controlado) y nada de colores fijos nuevos", () => {
  const barra = reglas(".rg-toolbar");
  assert.match(barra, /flex-wrap:\s*(no)?wrap|overflow-x:\s*auto/);
  for (const sel of [".rg-menu", ".rg-combo"]) {
    const r = reglas(sel);
    assert.ok(r.length > 0, `faltan estilos de ${sel}`);
    assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(/i, `color fijo en ${sel}`);
  }
});

test("CSP: sin scripts inline ni HTML crudo en el componente", () => {
  assert.doesNotMatch(TSX, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(TSX, /\beval\(|new Function\(/);
});
