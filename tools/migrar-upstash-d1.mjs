// Copia los datos del portal de Upstash Redis a D1 (M4). Solo LEE de Upstash y genera un .sql para
// `npx wrangler d1 execute docs-site --remote --file=datos.sql` (esquema: migrations/0001_almacen.sql).
//
//   node tools/migrar-upstash-d1.mjs --salida datos.sql
//
// Credenciales: KV_REST_API_URL/KV_REST_API_TOKEN o UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN. Nunca se imprimen.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { clienteRedis } from "../lib/api-comun.mjs";

const LOTE = 100;
const TROZO_CARACTERES = 10_000; // ≤ 40 KB de UTF-8 → ≤ 80 KB en hex: cada sentencia queda bajo los 100 KB de D1

const esEfimera = (k) => k.includes(":rl:") || k.startsWith("hw:lock:");
const esDelPortal = (k) => k.startsWith("com:") || k.startsWith("hw:");

// Literal SQL de texto sin saltos de línea crudos: ASCII seguro tal cual; el resto como hex.
function lit(s) {
  s = String(s);
  if (/^[A-Za-z0-9:_\-./ ]*$/.test(s)) return `'${s}'`;
  return `CAST(X'${Buffer.from(s, "utf8").toString("hex")}' AS TEXT)`;
}
const num = (n) => String(Math.trunc(Number(n)));

function trozos(s) {
  const cps = Array.from(String(s));
  const out = [];
  for (let i = 0; i < cps.length; i += TROZO_CARACTERES) out.push(cps.slice(i, i + TROZO_CARACTERES).join(""));
  return out.length ? out : [""];
}

function lotes(lista, n) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}

// INSERT con el primer trozo y UPDATE ... || para el resto. `columnas`/`valores` llevan el texto grande al final.
function insertarGrande(tabla, columnas, fijos, grande, where) {
  const [primero, ...resto] = trozos(grande);
  const sentencias = [`INSERT INTO ${tabla}(${columnas}) VALUES (${[...fijos, lit(primero)].join(",")});`];
  for (const t of resto) sentencias.push(`UPDATE ${tabla} SET v = v || ${lit(t)} WHERE ${where};`);
  return sentencias;
}

export async function generarSQL(origen, { ahora = Date.now } = {}) {
  // 1. SCAN con cursor y MATCH (nunca KEYS).
  const claves = new Set();
  let omitidas = 0;
  for (const patron of ["com:*", "hw:*"]) {
    let cursor = "0";
    do {
      const [[siguiente, lote]] = await origen.exec([["SCAN", cursor, "MATCH", patron, "COUNT", 500]]);
      cursor = String(siguiente);
      for (const k of lote ?? []) claves.add(String(k));
    } while (cursor !== "0");
  }
  const copiar = [];
  for (const k of [...claves].sort()) {
    if (!esDelPortal(k)) omitidas++;
    else if (esEfimera(k)) omitidas++;
    else copiar.push(k);
  }

  // 2. Tipo y caducidad restante.
  const meta = [];
  for (const ch of lotes(copiar, LOTE)) {
    const r = await origen.exec(ch.flatMap((k) => [["TYPE", k], ["PTTL", k]]));
    ch.forEach((k, i) => meta.push({ k, tipo: String(r[2 * i]), pttl: Number(r[2 * i + 1]) }));
  }
  const vivas = meta.filter((m) => ["string", "hash", "set", "list"].includes(m.tipo) && m.pttl !== -2);

  // 3. Contenido.
  const LEER = { string: (k) => ["GET", k], hash: (k) => ["HGETALL", k], set: (k) => ["SMEMBERS", k], list: (k) => ["LRANGE", k, 0, -1] };
  const t0 = Number(ahora());
  const sql = [];
  let copiadas = 0;
  for (const ch of lotes(vivas, LOTE)) {
    const datos = await origen.exec(ch.map((m) => LEER[m.tipo](m.k)));
    ch.forEach((m, i) => {
      const dato = datos[i];
      if (m.tipo === "string" && dato === null) return; // desapareció entre el SCAN y la lectura
      const k = lit(m.k);
      const exp = m.pttl >= 0 ? num(t0 + m.pttl) : "NULL";
      sql.push(`DELETE FROM claves WHERE k = ${k};`); // idempotente (las filas hijas se borran en cascada)
      if (m.tipo === "string") {
        const [primero, ...resto] = trozos(dato);
        sql.push(`INSERT INTO claves(k,tipo,v,exp) VALUES (${k},'string',${lit(primero)},${exp});`);
        for (const t of resto) sql.push(`UPDATE claves SET v = v || ${lit(t)} WHERE k = ${k};`);
      } else {
        const items = Array.isArray(dato) ? dato : [];
        if (!items.length) return; // Redis no guarda colecciones vacías
        sql.push(`INSERT INTO claves(k,tipo,v,exp) VALUES (${k},'${m.tipo}',NULL,${exp});`);
        if (m.tipo === "hash") {
          for (let j = 0; j + 1 < items.length; j += 2) sql.push(...insertarGrande("hash", "k,campo,v", [k, lit(items[j])], items[j + 1], `k = ${k} AND campo = ${lit(items[j])}`));
        } else if (m.tipo === "set") {
          for (const mi of items) sql.push(`INSERT INTO conjunto(k,m) VALUES (${k},${lit(mi)});`);
        } else {
          items.forEach((v, pos) => sql.push(...insertarGrande("lista", "k,pos,v", [k, String(pos)], v, `k = ${k} AND pos = ${pos}`)));
        }
      }
      copiadas++;
    });
  }
  return { sql: sql.length ? sql.join("\n") + "\n" : "", resumen: { claves: copiadas, omitidas } };
}

// ---------- CLI ----------
async function main(argv, env) {
  const i = argv.indexOf("--salida");
  const salida = i >= 0 ? argv[i + 1] : undefined;
  if (!salida || salida.startsWith("--")) {
    console.error("Uso: node tools/migrar-upstash-d1.mjs --salida datos.sql");
    return 1;
  }
  const origen = clienteRedis(env);
  if (!origen) {
    console.error("Faltan las credenciales de Upstash (KV_REST_API_URL y KV_REST_API_TOKEN, o UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN).");
    return 1;
  }
  let res;
  try {
    res = await generarSQL(origen);
  } catch (e) {
    // clienteRedis ya lanza mensajes fijos; no se imprime nada más.
    console.error(`No se pudo leer Upstash: ${e?.message ?? "error"}`);
    return 1;
  }
  writeFileSync(salida, res.sql);
  console.log(`Claves copiadas: ${res.resumen.claves}; omitidas (efímeras o ajenas): ${res.resumen.omitidas}.`);
  console.log(`Siguiente paso: npx wrangler d1 execute docs-site --remote --file=${salida}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
