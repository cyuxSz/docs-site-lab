// D1 de prueba: fachada con la API del binding de Cloudflare D1 (prepare().bind().run/all/first/raw, batch, exec)
// sobre node:sqlite en memoria. Aplica las migraciones de migrations/*.sql en orden, como `wrangler d1 migrations apply`.
// Impone los límites de D1 que el adaptador debe respetar (100 KB de SQL y 100 parámetros por sentencia).
// stats cuenta batches y sentencias sueltas (fuera de batch) para comprobar que cada exec del adaptador es un solo batch.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR_MIGRACIONES = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function archivosMigracion() {
  if (!existsSync(DIR_MIGRACIONES)) return [];
  return readdirSync(DIR_MIGRACIONES).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
}

function valor(v) {
  // D1 rechaza undefined ("D1_TYPE_ERROR"); los booleanos los guarda como 1/0.
  if (v === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || typeof v === "number" || typeof v === "string" || typeof v === "bigint") return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error(`D1_TYPE_ERROR: Type '${typeof v}' not supported`);
}

const plano = (fila) => (fila ? { ...fila } : fila);
export const MAX_SQL = 100_000;
export const MAX_PARAMS = 100;

export function crearD1({ migrar = true } = {}) {
  const db = new DatabaseSync(":memory:");
  const stats = { batch: 0, sentenciasEnBatch: 0, sueltas: 0, sql: [] };
  let enBatch = false;

  function ejecutar(sql, params) {
    const st = db.prepare(sql);
    stats.sql.push(sql);
    if (enBatch) stats.sentenciasEnBatch++;
    else stats.sueltas++;
    const lector = st.columns().length > 0;
    if (lector) {
      const filas = st.all(...params).map(plano);
      return { success: true, results: filas, meta: { changes: 0, rows_read: filas.length, rows_written: 0 } };
    }
    const r = st.run(...params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), rows_read: 0, rows_written: Number(r.changes) } };
  }

  class Sentencia {
    constructor(sql, params = []) {
      // Límites de D1: 100 KB de SQL por sentencia y 100 parámetros por consulta.
      if (Buffer.byteLength(sql, "utf8") > MAX_SQL) throw new Error("D1_ERROR: statement too long");
      if (params.length > MAX_PARAMS) throw new Error("D1_ERROR: too many SQL variables");
      this.sql = sql;
      this.params = params;
      // Igual que D1: un SQL inválido falla al preparar (aquí se valida compilándolo).
      db.prepare(sql);
    }
    bind(...vals) {
      return new Sentencia(this.sql, vals.map(valor));
    }
    async all() {
      return ejecutar(this.sql, this.params);
    }
    async run() {
      return ejecutar(this.sql, this.params);
    }
    async first(col) {
      const { results } = ejecutar(this.sql, this.params);
      const f = results[0] ?? null;
      if (col === undefined || f === null) return f;
      if (!(col in f)) throw new Error(`D1_COLUMN_NOTFOUND: ${col}`);
      return f[col];
    }
    async raw({ columnNames = false } = {}) {
      const st = db.prepare(this.sql);
      const cols = st.columns().map((c) => c.name);
      const { results } = ejecutar(this.sql, this.params);
      const filas = results.map((f) => cols.map((c) => f[c]));
      return columnNames ? [cols, ...filas] : filas;
    }
  }

  const d1 = {
    stats,
    sqlite: db,
    prepare(sql) {
      return new Sentencia(sql);
    },
    // Transaccional como D1: si una sentencia falla, se deshace todo el batch.
    async batch(sentencias) {
      if (!Array.isArray(sentencias) || sentencias.some((s) => !(s instanceof Sentencia))) throw new Error("D1: batch espera sentencias preparadas");
      stats.batch++;
      enBatch = true;
      db.exec("BEGIN");
      try {
        const out = sentencias.map((s) => ejecutar(s.sql, s.params));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        enBatch = false;
      }
    },
    // D1.exec: varias sentencias separadas por ; (sin parámetros). Lo usan las migraciones y el SQL generado para M4.
    async exec(sql) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
    cerrar() {
      db.close();
    },
  };

  if (migrar) {
    const archivos = archivosMigracion();
    if (!archivos.length) throw new Error("No hay migraciones en migrations/ (se esperaba migrations/0001_*.sql)");
    for (const f of archivos) db.exec(readFileSync(join(DIR_MIGRACIONES, f), "utf8"));
    stats.sql.length = 0;
    stats.sueltas = 0;
  }
  return d1;
}
