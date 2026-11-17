// Mini tutorial de juguete (openwiki/rutas/<slug>.md): frontmatter ya separado (como lo deja splitFrontmatter en
// tools/fetch.mjs) y cuerpo con pasos "## Paso: …". Incluye pasos inválidos a propósito: sin "Hecho cuando", sin
// enlace, enlace externo, javascript:, página inexistente, fuera de openwiki/, grafo con parámetro no permitido,
// hardware de una disciplina no configurada y hardware con slug inválido. No depende de ../uuv-lab.
export const META_MOTOR = {
  type: "tutorial",
  title: "Probar un motor desde la Jetson",
  description: "Del launch al motor girando, paso a paso.",
  rol: "electronica",
  disciplina: "electronica",
};

export const TUTORIAL_MOTOR = `# Probar un motor desde la Jetson

Introducción libre: no es un paso.

## Paso: Ubica el banco de pruebas
Objetivo: saber qué Arduino controla cada motor.
Enlace: [Hardware](../operations/hardware.md#probar-motores)
Hecho cuando: identificas el pin de cada uno de los 6 motores.

## Paso: Mira quién publica las fuerzas
Objetivo: entender de dónde salen las fuerzas que llegan a los motores.
Enlace: [thrust_allocator en el grafo](grafo:?node=uuv_control/thrust_allocator&config=sim)
Hecho cuando: ves en el grafo que /forces llega a thrust_allocator.

## Paso: Revisa la arquitectura eléctrica
Objetivo: conocer cómo se alimenta cada ESC.
Enlace: [Arquitectura eléctrica](hardware:electronica/arquitectura-electrica)
Hecho cuando: sabes qué batería alimenta los ESC.

## Paso: Sin comprobación
Objetivo: este paso no dice cuándo está hecho.
Enlace: [Quickstart](../quickstart.md)

## Paso: Sin enlace
Objetivo: este paso no enlaza a nada.
Hecho cuando: nunca.

## Paso: Blog externo
Objetivo: fuera del portal.
Enlace: [Blog](https://example.com/post.md)
Hecho cuando: nunca.

## Paso: Script
Objetivo: un enlace peligroso.
Enlace: [Clic](javascript:alert(1))
Hecho cuando: nunca.

## Paso: Página fantasma
Objetivo: no existe.
Enlace: [Fantasma](../packages/no_existe.md)
Hecho cuando: nunca.

## Paso: Fuera de la wiki
Objetivo: se sale de openwiki/.
Enlace: [README](../../README.md)
Hecho cuando: nunca.

## Paso: Grafo raro
Objetivo: parámetro no permitido.
Enlace: [Grafo](grafo:?evil=1)
Hecho cuando: nunca.

## Paso: Plano mecánico
Objetivo: mecánica no está configurada en este proyecto.
Enlace: [Plano](hardware:mecanica/chasis)
Hecho cuando: nunca.

## Paso: Slug malo
Objetivo: slug de hardware inválido.
Enlace: [Malo](hardware:electronica/../../x)
Hecho cuando: nunca.

## Paso: Ubica el banco de pruebas
Objetivo: título repetido a propósito.
Enlace: [Quickstart](../quickstart.md)
Hecho cuando: el id no choca con el primer paso.
`;

export const PAGES_TUT = [
  "index.md",
  "quickstart.md",
  "rutas.md",
  "rutas/motor-uno.md",
  "operations/hardware.md",
  "packages/index.md",
];

export const OPCIONES = {
  project: "uuv",
  pages: PAGES_TUT,
  from: "rutas/motor-uno.md",
  disciplinas: ["electronica"],
  roles: ["software", "electronica"],
};
