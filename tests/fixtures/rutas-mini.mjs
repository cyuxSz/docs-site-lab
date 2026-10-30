// openwiki/rutas.md de juguete (cuerpo sin frontmatter, como lo deja splitFrontmatter en tools/fetch.mjs) y las
// páginas que existen en la wiki. Incluye pasos inválidos a propósito: enlace externo, página inexistente, ruta que se
// sale de la wiki, elemento sin enlace y un rol cuyos pasos son todos inválidos. No depende de ../uuv-wiki.
export const RUTAS_MD = `# Rutas por rol

Introducción. Esta lista numerada no es de ningún rol y se ignora:
1. [Quickstart](quickstart.md): no cuenta.

## Software
1. [Quickstart](quickstart.md): qué configuraciones existen.
2. [Visión general](architecture/overview.md): el lazo misión → control → motores.
3. [Discrepancias](discrepancias/index.md): dónde no coinciden.
4. [Blog externo](https://example.com/post.md): fuera de la wiki.

## Visión
1. [Quickstart](quickstart.md): las configuraciones.
2. [Topics y servicios](architecture/topics.md#cámara-y-visión): cómo la misión le pide datos a la visión.
3. [Página fantasma](packages/no_existe.md): no existe.
4. [Hardware](operations/hardware.md#cámara-zed-2i): la ZED 2i y su SDK.

## Electrónica
1. [Hardware](operations/hardware.md): Arduino y motores.
2. [Hardware](operations/hardware.md#probar-motores): cómo probar los motores uno por uno.
3. Un paso sin enlace: se ignora.
4. [Fuera](../README.md): se sale de openwiki/.
5. [Paquetes](packages/): carpeta, va a su índice.

## Vacío
1. [Nada](nada.md): ninguna página válida.
`;

export const PAGES = [
  "index.md",
  "quickstart.md",
  "rutas.md",
  "architecture/overview.md",
  "architecture/topics.md",
  "operations/hardware.md",
  "packages/index.md",
  "discrepancias/index.md",
];
