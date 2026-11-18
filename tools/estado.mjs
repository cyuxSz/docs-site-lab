// Estado de proyectos que no se pudieron construir: clasifica el error de git en una causa fija y arma la tarjeta.
// Lógica pura. Nada de lo que devuelve incluye el mensaje crudo de git ni tokens.

export const CAUSAS = ["sin-token", "sin-acceso", "rama", "red", "datos", "vacio", "desconocido"];

export function clasificarError(err, { token } = {}) {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : "";
  if (/Authentication failed|could not read Username|Repository not found|returned error: 40[134]/i.test(msg)) return token ? "sin-acceso" : "sin-token";
  if (/Remote branch .* not found|couldn't find remote ref|pathspec .* did not match/i.test(msg)) return "rama";
  if (/Could not resolve host|Connection (timed out|refused|reset)|Operation timed out|ETIMEDOUT|ENOTFOUND|ECONNRESET|early EOF/i.test(msg)) return "red";
  if (/SyntaxError|Unexpected token|JSON/.test(msg)) return "datos";
  return "desconocido";
}

export function limpiarControl(texto) {
  return typeof texto === "string" ? texto.replace(/[\x00-\x1f\x7f-\x9f]/g, "") : "";
}

const REDEPLOY = "Vuelve a lanzar el workflow deploy-cloudflare en GitHub Actions.";
const LOG = "Revisa el log del workflow deploy-cloudflare para ver el detalle.";

function pasos(causa, p) {
  switch (causa) {
    case "sin-token":
      return [`Configura DOCS_GITHUB_TOKEN como secret de GitHub Actions con permiso de lectura de ${p.repo}.`, REDEPLOY];
    case "sin-acceso":
      return [`Renueva el secret DOCS_GITHUB_TOKEN de GitHub Actions y confirma que tiene permiso de lectura de ${p.repo}.`, REDEPLOY];
    case "rama":
      return [`Corrige "branch" de ${p.id ?? "este proyecto"} en projects.json para que apunte a una rama que exista.`, REDEPLOY];
    case "red":
      return ["Es probable que sea un fallo temporal de red: vuelve a desplegar.", LOG];
    case "datos":
      return ["Revisa que los archivos JSON de openwiki/ (por ejemplo .claims/claims.json) sean válidos.", LOG, REDEPLOY];
    case "vacio": {
      const ramas = (Array.isArray(p.ramas) ? p.ramas : []).filter((r) => typeof r === "string" && /^[\w./-]{1,100}$/.test(r)).slice(0, 5);
      const base = ["Corre /actualizar-docs en el repo y mergea la documentación a la rama construida.", REDEPLOY];
      return ramas.length ? [...base, `Ramas de documentación sin mergear: ${ramas.join(", ")}.`] : base;
    }
    default:
      return [LOG, REDEPLOY];
  }
}

export function tarjetaEstado(p, builtAt) {
  const causa = p.empty ? "vacio" : CAUSAS.includes(p.causa) && p.causa !== "vacio" ? p.causa : "desconocido";
  const ques = {
    "sin-token": `${p.repo} es privado y el build no tenía DOCS_GITHUB_TOKEN.`,
    "sin-acceso": `DOCS_GITHUB_TOKEN no pudo leer ${p.repo}: caducó, se revocó o no incluye ese repo.`,
    rama: `No se encontró la rama ${p.branch} en ${p.repo}.`,
    red: `No se pudo conectar con GitHub para traer ${p.repo}.`,
    datos: `Algún archivo de datos de la wiki de ${p.repo} no se pudo leer.`,
    vacio: `La rama ${p.branch} de ${p.repo} todavía no tiene openwiki/ ni docs/arch/.`,
    desconocido: `El build de ${p.repo} falló por un motivo que no se pudo identificar.`,
  };
  const t = Date.parse(builtAt);
  const cuando = Number.isNaN(t)
    ? "Fecha desconocida"
    : `Último intento: ${new Date(t).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Monterrey" })}`;
  return {
    estado: causa === "vacio" ? "vacio" : "error",
    causa,
    titulo: causa === "vacio" ? "Sin documentación aún" : "No se pudo construir",
    que: ques[causa],
    cuando,
    hacer: pasos(causa, p),
  };
}
