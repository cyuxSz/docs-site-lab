// Ayudantes de los tests del lote G3 (tipo por contenido en la subida con token y acción `diagrama` de /api/hardware).
// Amplían los de G1 sin tocarlos. Las peticiones con Bearer NO llevan `Origin`: un cliente que no es un navegador no lo envía.
import assert from "node:assert/strict";
import { ORIGIN, EDITOR, pedir, sesion, cargarWorker } from "./subida.mjs";

export * from "./subida.mjs";

export const JSON_CT = { "content-type": "application/json" };
export const enc = (s) => new TextEncoder().encode(s);
export const uuid = (n) => `3f2b8c1e-9a4d-4e7f-8b21-${String(n).padStart(12, "0")}`;
const qs = (o) => new URLSearchParams(o).toString();

// Contenidos mínimos válidos de los cuatro tipos que admite el token de subida.
export const DRAWIO = '<mxfile host="Electron" version="24.7.17"><diagram id="a" name="P1"><mxGraphModel/></diagram></mxfile>\n';
export const SVG =
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>\n';
export const SCH = '(kicad_sch\n\t(version 20231120)\n\t(generator "eeschema")\n)\n';
export const PCB = "(kicad_pcb (version 20221018) (generator pcbnew))\n";
export const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

// POST /api/archivos con token (`bearer`) o con cookie (`cookie`, añade Origin propio). `contenido` texto o bytes.
export function subirArchivo(env, { bearer, cookie, proyecto = "uuv", disciplina = "electronica", id, nombre, contenido }) {
  const bytes = typeof contenido === "string" ? enc(contenido) : contenido;
  const headers = { "content-type": "application/octet-stream", "content-length": String(bytes.length), ...(cookie ? { origin: ORIGIN } : {}) };
  return pedir(`/api/archivos/?${qs({ proyecto, disciplina, id, nombre })}`, { env, bearer, cookie, method: "POST", headers, body: bytes });
}

// Igual, pero el cuerpo llega en trozos de `tam` bytes (stream real, no un único trozo).
export async function subirEnTrozos(env, { bearer, proyecto = "uuv", disciplina = "electronica", id, nombre, contenido, tam = 3 }) {
  const bytes = typeof contenido === "string" ? enc(contenido) : contenido;
  let i = 0;
  const body = new ReadableStream({
    pull(ctl) {
      if (i >= bytes.length) return ctl.close();
      ctl.enqueue(bytes.slice(i, i + tam));
      i += tam;
    },
  });
  const req = new Request(`${ORIGIN}/api/archivos/?${qs({ proyecto, disciplina, id, nombre })}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "content-length": String(bytes.length), authorization: `Bearer ${bearer}` },
    body,
    duplex: "half",
  });
  const worker = await cargarWorker();
  return worker.fetch(req, env, { waitUntil() {}, passThroughOnException() {} });
}

// Lista de adjuntos de la disciplina vista con la cookie del editor.
export async function adjuntos(env, disciplina = "electronica") {
  const res = await pedir(`/api/archivos/?lista=1&proyecto=uuv&disciplina=${disciplina}`, { env, cookie: sesion(EDITOR) });
  assert.equal(res.status, 200);
  return (await res.json()).archivos;
}

// Bytes guardados en R2 para un id (por la descarga con cookie), o null si no hay archivo.
export async function bajar(env, id) {
  const res = await pedir(`/api/archivos/?proyecto=uuv&id=${id}`, { env, cookie: sesion(EDITOR) });
  return res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : null;
}

// ----- hardware -----

export const HW = "/api/hardware/";

export async function inicializar(env, disciplina = "electronica") {
  const res = await pedir(HW, { env, cookie: sesion(EDITOR), method: "POST", headers: { ...JSON_CT, origin: ORIGIN }, body: JSON.stringify({ proyecto: "uuv", disciplina, accion: "inicializar" }) });
  assert.equal(res.status, 201, "preparación: inicializar la disciplina con cookie");
}

export async function leerPagina(env, slug, disciplina = "electronica") {
  const res = await pedir(`${HW}?proyecto=uuv&disciplina=${disciplina}&pagina=${slug}`, { env, cookie: sesion(EDITOR) });
  assert.equal(res.status, 200, `preparación: leer ${slug}`);
  return (await res.json()).pagina;
}

// Guarda `md` en la página con la cookie del editor (PUT normal) y devuelve la página nueva.
export async function ponerMd(env, slug, md, disciplina = "electronica") {
  const { version } = await leerPagina(env, slug, disciplina);
  const res = await pedir(HW, { env, cookie: sesion(EDITOR), method: "PUT", headers: { ...JSON_CT, origin: ORIGIN }, body: JSON.stringify({ proyecto: "uuv", disciplina, pagina: slug, md, version }) });
  assert.equal(res.status, 200, "preparación: PUT de la página");
  return (await res.json()).pagina;
}

// POST /api/hardware { accion: "diagrama", … }. Con `bearer` sin Origin; con `cookie`, con Origin propio.
// `cuerpo` se mezcla sobre el cuerpo completo por omisión; `quitar` elimina claves para probar el conjunto exacto.
export function diagrama(env, { bearer, cookie, cuerpo = {}, quitar = [], path = HW }) {
  const base = { proyecto: "uuv", disciplina: "electronica", accion: "diagrama", pagina: "esquematicos", version: 1, fuenteAnterior: null, fuente: uuid(1), svg: uuid(2) };
  const b = { ...base, ...cuerpo };
  for (const k of quitar) delete b[k];
  const headers = { ...JSON_CT, ...(cookie ? { origin: ORIGIN } : {}) };
  return pedir(path, { env, bearer, cookie, method: "POST", headers, body: JSON.stringify(b) });
}

// Bloque canónico (mismo formato que bloqueDiagrama de src/lib/diagramas.ts), sin el salto final.
export const bloque = ({ editor = "drawio", fuente, svg, titulo = "" }) => `\`\`\`diagrama\neditor: ${editor}\nfuente: ${fuente}\nsvg: ${svg}\n${titulo ? `titulo: ${titulo}\n` : ""}\`\`\``;
