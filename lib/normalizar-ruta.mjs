// Única normalización de la barra final de una ruta. La comparten la puerta de alcance del token de subida
// (manejarLogin) y el despacho del Worker (atenderApi). Solo quita las barras del final: dobles barras internas,
// %2F y mayúsculas no se tocan.
export function sinBarraFinal(pathname) {
  return pathname.replace(/\/+$/, "") || "/";
}
