// Tooltips de glosario: parser de openwiki/glosario.md y marcado de la primera aparición (tools/glosario.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGlosario, marcarGlosario } from "../tools/glosario.mjs";

const GLOSARIO = `---
type: reference
title: Glosario
---

# Glosario

| Término | Significado en este repo |
|---|---|
| **ASMC** | *Adaptive Sliding Mode Control*: el controlador principal, en \`uuv_control/src/asmc.cpp\`. |
| **Fuerzas / wrench** | Vector de 6 valores que publica el ASMC en \`/forces\`. |
| **Analizador (\`*_analizer\`)** | Nodo de visión que mira una foto. |
| **ESC** | Controlador "electrónico" de velocidad de cada motor. |
| **topic** | Canal de mensajes de ROS. |

Texto suelto que no es parte de la tabla.
`;

test("parseGlosario: lee la tabla, separa alias con ' / ', quita el paréntesis y deja la definición en texto plano", () => {
  assert.deepEqual(parseGlosario(GLOSARIO), [
    { term: "ASMC", aliases: ["ASMC"], def: "Adaptive Sliding Mode Control: el controlador principal, en uuv_control/src/asmc.cpp." },
    { term: "Fuerzas / wrench", aliases: ["Fuerzas", "wrench"], def: "Vector de 6 valores que publica el ASMC en /forces." },
    { term: "Analizador", aliases: ["Analizador"], def: "Nodo de visión que mira una foto." },
    { term: "ESC", aliases: ["ESC"], def: 'Controlador "electrónico" de velocidad de cada motor.' },
    { term: "topic", aliases: ["topic"], def: "Canal de mensajes de ROS." },
  ]);
});

test("parseGlosario: sin tabla devuelve []", () => {
  assert.deepEqual(parseGlosario("# Glosario\n\nNada aquí."), []);
});

const TERMS = parseGlosario(GLOSARIO);
const GLOSA = /<abbr class="glosa" tabindex="0" data-def="([^"]*)">([^<]*)<\/abbr>/g;
const marks = (out) => [...out.matchAll(GLOSA)].map((m) => m[2]);

test("marcarGlosario: solo la primera aparición, fuera de encabezados, código y enlaces", () => {
  const body = [
    "# ASMC",
    "",
    "El `ASMC` en código. Ver [el ASMC](/uuv/packages/uuv_control/) o https://x.org/ASMC (URL suelta).",
    "",
    "```cpp",
    "ASMC asmc;",
    "```",
    "",
    "El ASMC calcula. Otra vez ASMC.",
  ].join("\n");
  const out = marcarGlosario(body, TERMS);
  assert.deepEqual(marks(out), ["ASMC"]);
  assert.ok(out.includes("# ASMC\n"), "encabezado intacto");
  assert.ok(out.includes("El `ASMC` en código"), "código en línea intacto");
  assert.ok(out.includes("[el ASMC](/uuv/packages/uuv_control/)"), "enlace intacto");
  assert.ok(out.includes("```cpp\nASMC asmc;\n```"), "bloque de código intacto");
  assert.ok(out.includes('El <abbr class="glosa"'), "marca la del texto corrido");
  assert.ok(out.endsWith("Otra vez ASMC."), "la segunda aparición queda sin marcar");
});

test("marcarGlosario: respeta límites de palabra y mayúsculas de siglas", () => {
  const out = marcarGlosario("ESCALA y esc no cuentan; el ESC sí.", TERMS);
  assert.deepEqual(marks(out), ["ESC"]);
  assert.ok(out.startsWith("ESCALA y esc no cuentan; el <abbr"));
});

test("marcarGlosario: términos en minúscula sin distinguir mayúsculas, conservando el texto original", () => {
  assert.deepEqual(marks(marcarGlosario("Un Topic es un canal; otro topic.", TERMS)), ["Topic"]);
});

test("marcarGlosario: los alias cuentan como el mismo término", () => {
  assert.deepEqual(marks(marcarGlosario("El wrench son las Fuerzas.", TERMS)), ["wrench"]);
});

test("marcarGlosario: no toca atributos de HTML del portal y escapa la definición", () => {
  const out = marcarGlosario('<span class="st" title="ESC"></span> El ESC.', TERMS);
  assert.ok(out.startsWith('<span class="st" title="ESC"></span> El <abbr'));
  const [m] = [...out.matchAll(GLOSA)];
  assert.equal(m[1], "Controlador &quot;electrónico&quot; de velocidad de cada motor.");
});

test("marcarGlosario: sin términos devuelve el texto igual", () => {
  assert.equal(marcarGlosario("El ASMC.", []), "El ASMC.");
});
