// Lectura de la wiki clonada sin seguir enlaces: un repo hostil podría incluir symlinks o junctions (p. ej. a
// .git/config, que en el clon lleva el token) y el build los publicaría. Aquí solo se lee lo que vive de verdad dentro
// de la raíz del checkout. Sin efectos al importarse.
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

function dentro(realRaiz, real) {
  const rel = relative(norm(realRaiz), norm(real));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Archivos regulares bajo dir (recursivo), ignorando symlinks y junctions (de archivo o de directorio) y todo lo
// que, por realpath, quede fuera de la raíz.
export function walk(dir, raiz = dir) {
  let realRaiz;
  try {
    realRaiz = realpathSync(raiz);
  } catch {
    return [];
  }
  const out = [];
  const rec = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) rec(p);
      else if (st.isFile()) {
        try {
          if (dentro(realRaiz, realpathSync(p))) out.push(p);
        } catch {}
      }
    }
  };
  rec(dir);
  return out;
}

// Texto utf8 del archivo, o null si no existe, no es un archivo regular, es un symlink, o su ruta real se sale de la
// raíz o difiere de la ruta sin seguir enlaces (componente intermedio enlazado). Nunca lanza.
export function leerDentro(raiz, archivo) {
  try {
    const st = lstatSync(archivo);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const realRaiz = realpathSync(raiz);
    const real = realpathSync(archivo);
    if (!dentro(realRaiz, real)) return null;
    const esperada = join(realRaiz, relative(resolve(raiz), resolve(archivo)));
    if (norm(real) !== norm(esperada)) return null;
    return readFileSync(real, "utf8");
  } catch {
    return null;
  }
}
