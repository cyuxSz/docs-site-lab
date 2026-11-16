// Código de salida de tools/fetch.mjs según el resultado de los proyectos.
// Sin token, los errores de autenticación (repos privados) solo avisan; con token, o con cualquier
// otro error, que todo falle es fatal. En modo estricto, además, cualquier error bloqueante falla.
export function codigoSalida(summary, { token, strict }) {
  const sinTokenSoloAuth = !token && summary.every((p) => p.error && p.auth);
  if (summary.length && summary.every((p) => p.error) && !sinTokenSoloAuth) return 1;
  const blocking = summary.filter((p) => p.error && !(p.auth && !token));
  return strict && blocking.length ? 1 : 0;
}
