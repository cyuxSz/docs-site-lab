// Almacén del Worker sobre D1 (SQLite): misma interfaz que clienteRedis, { exec(comandos) → resultados }, para que los cores
// (comentarios, hardware, archivos) y api-comun.limitar no cambien. Esquema en migrations/0001_almacen.sql.
//
// - Cada exec se ejecuta como UN db.batch() (transaccional): si algo falla, no se aplica nada.
// - Los valores van siempre como parámetros (nunca interpolados). Límites de D1: 100 parámetros y 100 KB por sentencia.
// - La caducidad se aplica al inicio de cada exec borrando las claves tocadas que ya caducaron (el reloj es `ahora`).
// - Las lecturas consecutivas del mismo comando se agrupan en pocas sentencias (presupuesto de consultas por petición).
// - Los 3 scripts EVAL de los cores se reconocen por su texto exacto; cualquier otro script falla cerrado.
// Sin imports de node:* ni paquetes: corre en workerd.

const MAXP = 90; // parámetros por sentencia (límite de D1: 100)

const LIBERAR = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const FENCING =
  "for i=1,#KEYS do if redis.call('get', KEYS[i]) ~= ARGV[i] then return 'FENCED' end end " +
  "local p=#KEYS+1 local n=tonumber(ARGV[p]) p=p+1 " +
  "for c=1,n do local k=tonumber(ARGV[p]) p=p+1 local a={} for j=1,k do a[j]=ARGV[p] p=p+1 end redis.call(unpack(a)) end " +
  "return 'APLICADO'";
const INSERTAR_SI_NO_BORRADO =
  "if redis.call('sismember', KEYS[2], ARGV[1]) == 1 then return 0 end return redis.call('hsetnx', KEYS[1], ARGV[1], ARGV[2])";
const PERMITIDOS_FENCING = new Set(["HSET", "SET", "DEL", "LPUSH", "LTRIM", "HDEL"]);

const ERR_ALMACEN = "Almacén no disponible";
const ERR_CMD = "Comando de almacén no soportado";
const fallo = () => new Error(ERR_CMD);

const T = (sql, params = []) => ({ sql, params });
const marcas = (n) => Array(n).fill("?").join(",");
const SIN_GUARDIA = { sql: "1", params: [] };

function trocear(lista, n) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
}
function txt(x) {
  if (x === undefined || x === null || typeof x === "object") throw fallo();
  return String(x);
}
function ent(x) {
  const n = Number(x);
  if (x === "" || x === null || x === undefined || !Number.isInteger(n)) throw fallo();
  return n;
}
const suma = (res) => res.reduce((t, r) => t + r.results.length, 0);

// Asegura la fila de la clave con su tipo (si ya existe no la toca).
const asegurar = (k, tipo, g) => T(`INSERT INTO claves(k,tipo) SELECT ?,'${tipo}' WHERE (${g.sql}) ON CONFLICT(k) DO NOTHING`, [k, ...g.params]);
const limpiar = (k, tipo, tabla, g) =>
  T(`DELETE FROM claves WHERE k=? AND tipo='${tipo}' AND NOT EXISTS (SELECT 1 FROM ${tabla} WHERE k=?) AND (${g.sql})`, [k, k, ...g.params]);

// Ventana de una lista (índices de Redis, negativos incluidos). n = largo de la lista.
const INICIO = "(CASE WHEN ?<0 THEN MAX(0,n+?) ELSE ? END)";
const FIN = "(CASE WHEN ?<0 THEN n+? ELSE MIN(?,n-1) END)";
const numerada = "SELECT v, pos, ROW_NUMBER() OVER (ORDER BY pos) - 1 AS i, COUNT(*) OVER () AS n FROM lista WHERE k=?";
const triple = (x) => [x, x, x];

// ---------- Lecturas agrupables (consecutivas del mismo comando → pocas sentencias) ----------
function porClaves(claves, plantilla) {
  return trocear([...new Set(claves)], MAXP).map((ch) => T(plantilla(marcas(ch.length)), ch));
}
function porPares(pares, plantilla) {
  const vistos = new Map(pares.map((p) => [JSON.stringify(p), p]));
  return trocear([...vistos.values()], Math.floor(MAXP / 2)).map((ch) => T(plantilla(ch.map(() => "(?,?)").join(",")), ch.flat()));
}
const filas = (res) => res.flatMap((r) => r.results);

function grupoPorClave(items, plantilla, resolver) {
  const claves = items.map((a) => txt(a[0]));
  return { claves, stmts: porClaves(claves, plantilla), fin: (res, now) => resolver(claves, filas(res), now) };
}
function mapaDeListas(filasR, col) {
  const mapa = new Map();
  for (const f of filasR) {
    if (!mapa.has(f.k)) mapa.set(f.k, []);
    mapa.get(f.k).push(...col(f));
  }
  return mapa;
}
const cuentas = (claves, fs) => {
  const mapa = new Map(fs.map((f) => [f.k, Number(f.n)]));
  return claves.map((k) => mapa.get(k) ?? 0);
};

function grupoPares(items, tabla, col, valor, ausente) {
  const pares = items.map((a) => [txt(a[0]), txt(a[1])]);
  return {
    claves: pares.map((p) => p[0]),
    stmts: porPares(pares, (m) => `SELECT k, ${col} AS c, ${tabla === "hash" ? "v" : "NULL AS v"} FROM ${tabla} WHERE (k, ${col}) IN (VALUES ${m})`),
    fin: (res) => {
      const mapa = new Map(filas(res).map((f) => [JSON.stringify([f.k, f.c]), valor(f)]));
      return pares.map((p) => (mapa.has(JSON.stringify(p)) ? mapa.get(JSON.stringify(p)) : ausente));
    },
  };
}

const GRUPOS = {
  GET: (items) =>
    grupoPorClave(items, (m) => `SELECT k, v FROM claves WHERE tipo='string' AND k IN (${m})`, (claves, fs) => {
      const mapa = new Map(fs.map((f) => [f.k, f.v]));
      return claves.map((k) => mapa.get(k) ?? null);
    }),
  EXISTS: (items) => {
    const lista = items.map((a) => {
      if (!a.length) throw fallo();
      return a.map(txt);
    });
    const claves = lista.flat();
    return {
      claves,
      stmts: porClaves(claves, (m) => `SELECT k FROM claves WHERE k IN (${m})`),
      fin: (res) => {
        const set = new Set(filas(res).map((f) => f.k));
        return lista.map((ks) => ks.filter((k) => set.has(k)).length);
      },
    };
  },
  TTL: (items) =>
    grupoPorClave(items, (m) => `SELECT k, exp FROM claves WHERE k IN (${m})`, (claves, fs, now) => {
      const mapa = new Map(fs.map((f) => [f.k, f.exp]));
      return claves.map((k) => (!mapa.has(k) ? -2 : mapa.get(k) === null ? -1 : Math.ceil((Number(mapa.get(k)) - now) / 1000)));
    }),
  HGETALL: (items) =>
    grupoPorClave(items, (m) => `SELECT k, campo, v FROM hash WHERE k IN (${m}) ORDER BY rowid`, (claves, fs) => {
      const mapa = mapaDeListas(fs, (f) => [f.campo, f.v]);
      return claves.map((k) => mapa.get(k) ?? []);
    }),
  HLEN: (items) => grupoPorClave(items, (m) => `SELECT k, COUNT(*) AS n FROM hash WHERE k IN (${m}) GROUP BY k`, cuentas),
  SMEMBERS: (items) =>
    grupoPorClave(items, (m) => `SELECT k, m FROM conjunto WHERE k IN (${m}) ORDER BY rowid`, (claves, fs) => {
      const mapa = mapaDeListas(fs, (f) => [f.m]);
      return claves.map((k) => mapa.get(k) ?? []);
    }),
  LLEN: (items) => grupoPorClave(items, (m) => `SELECT k, COUNT(*) AS n FROM lista WHERE k IN (${m}) GROUP BY k`, cuentas),
  HGET: (items) => grupoPares(items, "hash", "campo", (f) => f.v ?? null, null),
  HEXISTS: (items) => grupoPares(items, "hash", "campo", () => 1, 0),
  SISMEMBER: (items) => grupoPares(items, "conjunto", "m", () => 1, 0),
};

// ---------- Comandos sueltos ----------
// ctx: { now, g: guardia SQL (fencing), quiet: no hace falta calcular el resultado }
function unico(nombre, a, ctx) {
  const g = ctx.g;
  switch (nombre) {
    case "SET": {
      if (a.length < 2) throw fallo();
      const k = txt(a[0]);
      const v = txt(a[1]);
      let nx = false;
      let ex = null;
      for (let i = 2; i < a.length; i++) {
        const o = String(a[i]).toUpperCase();
        if (o === "NX") nx = true;
        else if (o === "EX") {
          ex = ent(a[++i]);
          if (ex <= 0) throw fallo();
        } else throw fallo();
      }
      const exp = ex === null ? null : ctx.now + ex * 1000;
      if (nx) {
        return {
          claves: [k],
          stmts: [T(`INSERT INTO claves(k,tipo,v,exp) SELECT ?,'string',?,? WHERE (${g.sql}) ON CONFLICT(k) DO NOTHING RETURNING k`, [k, v, exp, ...g.params])],
          fin: (r) => (r[0].results.length ? "OK" : null),
        };
      }
      // REPLACE borra la fila previa (y, por la clave foránea, sus hijas si era de otro tipo) y quita la caducidad.
      return { claves: [k], stmts: [T(`INSERT OR REPLACE INTO claves(k,tipo,v,exp) SELECT ?,'string',?,? WHERE (${g.sql})`, [k, v, exp, ...g.params])], fin: () => "OK" };
    }
    case "DEL": {
      if (!a.length) throw fallo();
      const claves = [...new Set(a.map(txt))];
      const stmts = trocear(claves, MAXP - g.params.length).map((ch) => T(`DELETE FROM claves WHERE k IN (${marcas(ch.length)}) AND (${g.sql}) RETURNING k`, [...ch, ...g.params]));
      return { claves, stmts, fin: (r) => suma(r) };
    }
    case "INCR": {
      const k = txt(a[0]);
      return {
        claves: [k],
        stmts: [T(`INSERT INTO claves(k,tipo,v) SELECT ?,'string','1' WHERE (${g.sql}) ON CONFLICT(k) DO UPDATE SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT) WHERE tipo='string' RETURNING v`, [k, ...g.params])],
        fin: (r) => {
          if (!r[0].results.length) throw fallo();
          return Number(r[0].results[0].v);
        },
      };
    }
    case "EXPIRE": {
      const k = txt(a[0]);
      const s = ent(a[1]);
      const nx = a[2] !== undefined && String(a[2]).toUpperCase() === "NX";
      if (a[2] !== undefined && !nx) throw fallo();
      return { claves: [k], stmts: [T(`UPDATE claves SET exp=? WHERE k=?${nx ? " AND exp IS NULL" : ""} AND (${g.sql}) RETURNING k`, [ctx.now + s * 1000, k, ...g.params])], fin: (r) => (r[0].results.length ? 1 : 0) };
    }
    case "HSET": {
      if (a.length < 3 || a.length % 2 === 0) throw fallo();
      const k = txt(a[0]);
      const mapa = new Map();
      for (let i = 1; i < a.length; i += 2) mapa.set(txt(a[i]), txt(a[i + 1]));
      const campos = [...mapa];
      const stmts = [asegurar(k, "hash", g)];
      let nCuentas = 0;
      if (!ctx.quiet) {
        const trozos = trocear(campos, MAXP - 1);
        nCuentas = trozos.length;
        for (const ch of trozos) stmts.push(T(`SELECT COUNT(*) AS n FROM hash WHERE k=? AND campo IN (${marcas(ch.length)})`, [k, ...ch.map((c) => c[0])]));
      }
      const porSentencia = Math.floor((MAXP - 1 - g.params.length) / 2);
      if (porSentencia < 1) throw fallo();
      for (const ch of trocear(campos, porSentencia)) {
        stmts.push(T(`INSERT INTO hash(k,campo,v) SELECT ?, column1, column2 FROM (VALUES ${ch.map(() => "(?,?)").join(",")}) WHERE (${g.sql}) ON CONFLICT(k,campo) DO UPDATE SET v=excluded.v`, [k, ...ch.flat(), ...g.params]));
      }
      return { claves: [k], stmts, fin: (r) => campos.length - r.slice(1, 1 + nCuentas).reduce((t, x) => t + Number(x.results[0].n), 0) };
    }
    case "HDEL":
    case "SREM": {
      if (a.length < 2) throw fallo();
      const k = txt(a[0]);
      const [tabla, col, tipo] = nombre === "HDEL" ? ["hash", "campo", "hash"] : ["conjunto", "m", "set"];
      const miembros = [...new Set(a.slice(1).map(txt))];
      const stmts = trocear(miembros, MAXP - 1 - g.params.length).map((ch) => T(`DELETE FROM ${tabla} WHERE k=? AND ${col} IN (${marcas(ch.length)}) AND (${g.sql}) RETURNING ${col}`, [k, ...ch, ...g.params]));
      const n = stmts.length;
      stmts.push(limpiar(k, tipo, tabla, g));
      return { claves: [k], stmts, fin: (r) => suma(r.slice(0, n)) };
    }
    case "SADD": {
      if (a.length < 2) throw fallo();
      const k = txt(a[0]);
      const miembros = [...new Set(a.slice(1).map(txt))];
      const stmts = [asegurar(k, "set", g)];
      for (const ch of trocear(miembros, MAXP - 1 - g.params.length)) {
        stmts.push(T(`INSERT OR IGNORE INTO conjunto(k,m) SELECT ?, column1 FROM (VALUES ${ch.map(() => "(?)").join(",")}) WHERE (${g.sql}) RETURNING m`, [k, ...ch, ...g.params]));
      }
      return { claves: [k], stmts, fin: (r) => suma(r.slice(1)) };
    }
    case "LPUSH": {
      if (a.length < 2) throw fallo();
      const k = txt(a[0]);
      const vals = a.slice(1).map(txt);
      const stmts = [asegurar(k, "list", g)];
      // El último valor queda al frente (como Redis): posiciones decrecientes desde el mínimo actual.
      const porSentencia = Math.floor((MAXP - 2 - g.params.length) / 2);
      if (porSentencia < 1) throw fallo();
      let orden = 0;
      for (const ch of trocear(vals, porSentencia)) {
        const filasV = ch.map((v) => [++orden, v]);
        stmts.push(T(`INSERT INTO lista(k,pos,v) SELECT ?, (SELECT COALESCE(MIN(pos),1) FROM lista WHERE k=?) - column1, column2 FROM (VALUES ${filasV.map(() => "(?,?)").join(",")}) WHERE (${g.sql})`, [k, k, ...filasV.flat(), ...g.params]));
        orden = 0; // cada sentencia parte del mínimo ya actualizado
      }
      if (!ctx.quiet) stmts.push(T("SELECT COUNT(*) AS n FROM lista WHERE k=?", [k]));
      return { claves: [k], stmts, fin: (r) => Number(r[r.length - 1].results[0].n) };
    }
    case "LRANGE": {
      const k = txt(a[0]);
      const s = ent(a[1]);
      const e = ent(a[2]);
      return {
        claves: [k],
        stmts: [T(`SELECT v FROM (${numerada}) WHERE i >= ${INICIO} AND i <= ${FIN} ORDER BY i`, [k, ...triple(s), ...triple(e)])],
        fin: (r) => r[0].results.map((f) => f.v),
      };
    }
    case "LINDEX": {
      const k = txt(a[0]);
      const i = ent(a[1]);
      return {
        claves: [k],
        stmts: [T(`SELECT v FROM (${numerada}) WHERE i = (CASE WHEN ?<0 THEN n+? ELSE ? END)`, [k, ...triple(i)])],
        fin: (r) => r[0].results[0]?.v ?? null,
      };
    }
    case "LTRIM": {
      const k = txt(a[0]);
      const s = ent(a[1]);
      const e = ent(a[2]);
      return {
        claves: [k],
        stmts: [
          T(`DELETE FROM lista WHERE k=? AND pos IN (SELECT pos FROM (${numerada}) WHERE NOT (i >= ${INICIO} AND i <= ${FIN})) AND (${g.sql})`, [k, k, ...triple(s), ...triple(e), ...g.params]),
          limpiar(k, "list", "lista", g),
        ],
        fin: () => "OK",
      };
    }
    case "EVAL":
      return evaluar(a, ctx);
    default:
      throw fallo();
  }
}

// ---------- EVAL: solo los 3 scripts de los cores, por texto exacto ----------
function evaluar(a, ctx) {
  if (ctx.g !== SIN_GUARDIA) throw fallo(); // sin EVAL anidados
  const script = a[0];
  const nk = ent(a[1]);
  if (typeof script !== "string" || nk < 0) throw fallo();
  const claves = a.slice(2, 2 + nk).map(txt);
  if (claves.length !== nk) throw fallo();
  const argv = a.slice(2 + nk).map(txt);

  if (script === LIBERAR) {
    if (nk !== 1 || argv.length < 1) throw fallo();
    return { claves, stmts: [T("DELETE FROM claves WHERE k=? AND tipo='string' AND v=? RETURNING k", [claves[0], argv[0]])], fin: (r) => (r[0].results.length ? 1 : 0) };
  }
  if (script === INSERTAR_SI_NO_BORRADO) {
    if (nk !== 2 || argv.length < 2) throw fallo();
    const [kh, ks] = claves;
    const [id, meta] = argv;
    const libre = "NOT EXISTS (SELECT 1 FROM conjunto WHERE k=? AND m=?)";
    return {
      claves,
      stmts: [
        T(`INSERT INTO claves(k,tipo) SELECT ?,'hash' WHERE ${libre} ON CONFLICT(k) DO NOTHING`, [kh, ks, id]),
        T(`INSERT INTO hash(k,campo,v) SELECT ?,?,? WHERE ${libre} ON CONFLICT(k,campo) DO NOTHING RETURNING campo`, [kh, id, meta, ks, id]),
      ],
      fin: (r) => (r[1].results.length ? 1 : 0),
    };
  }
  if (script === FENCING) return fencing(nk, claves, argv, ctx);
  throw fallo();
}

function fencing(nk, candados, argv, ctx) {
  if (argv.length < nk + 1) throw fallo();
  const esperados = argv.slice(0, nk);
  const n = ent(argv[nk]);
  if (n < 0) throw fallo();
  let p = nk + 1;
  const subs = [];
  for (let c = 0; c < n; c++) {
    const k = ent(argv[p++]);
    if (k < 1 || p + k > argv.length) throw fallo();
    subs.push(argv.slice(p, p + k));
    p += k;
  }
  if (p !== argv.length) throw fallo();
  const g = {
    sql: candados.length ? candados.map(() => "EXISTS (SELECT 1 FROM claves WHERE k=? AND tipo='string' AND v=?)").join(" AND ") : "1",
    params: candados.flatMap((k, i) => [k, esperados[i]]),
  };
  if (g.params.length > 20) throw fallo();
  const propios = new Set(candados);
  const stmts = [T(`SELECT CASE WHEN (${g.sql}) THEN 1 ELSE 0 END AS ok`, g.params)];
  const claves = [...candados];
  for (const sub of subs) {
    const nombre = String(sub[0]).toUpperCase();
    if (!PERMITIDOS_FENCING.has(nombre)) throw fallo();
    const tocadas = nombre === "DEL" ? sub.slice(1) : [sub[1]];
    // Un comando interno no puede tocar los propios candados: la guardia se evalúa en cada sentencia.
    if (tocadas.some((k) => propios.has(String(k)))) throw fallo();
    const op = unico(nombre, sub.slice(1), { now: ctx.now, g, quiet: true });
    stmts.push(...op.stmts);
    claves.push(...op.claves);
  }
  return { claves, stmts, fin: (r) => (Number(r[0].results[0]?.ok) === 1 ? "APLICADO" : "FENCED") };
}

// ---------- Compilación y ejecución ----------
function compilar(comandos, now) {
  const ops = [];
  let grupo = null;
  for (const c of comandos) {
    if (!Array.isArray(c) || !c.length) throw fallo();
    const nombre = String(c[0]).toUpperCase();
    const a = c.slice(1);
    if (Object.hasOwn(GRUPOS, nombre)) {
      if (grupo && grupo.nombre === nombre) grupo.items.push(a);
      else ops.push((grupo = { nombre, items: [a] }));
      continue;
    }
    grupo = null;
    const op = unico(nombre, a, { now, g: SIN_GUARDIA, quiet: false });
    ops.push({ claves: op.claves, stmts: op.stmts, fin: (r, t) => [op.fin(r, t)] });
  }
  return ops.map((o) => {
    if (!o.items) return o;
    const g = GRUPOS[o.nombre](o.items);
    return { claves: g.claves, stmts: g.stmts, fin: g.fin };
  });
}

export function clienteD1(db, { ahora = Date.now } = {}) {
  if (!db) return null;
  return {
    async exec(comandos) {
      if (!Array.isArray(comandos)) throw fallo();
      if (!comandos.length) return [];
      const now = Number(ahora());
      const ops = compilar(comandos, now);
      const claves = [...new Set(ops.flatMap((o) => o.claves))];
      // Las claves tocadas que ya caducaron dejan de existir antes de ejecutar nada.
      const purga = trocear(claves, MAXP - 1).map((ch) => T(`DELETE FROM claves WHERE exp IS NOT NULL AND exp <= ? AND k IN (${marcas(ch.length)})`, [now, ...ch]));
      const stmts = [...purga, ...ops.flatMap((o) => o.stmts)];
      let res;
      try {
        res = await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.params)));
      } catch {
        // Mensaje fijo: nunca SQL, tablas ni el detalle de D1.
        throw new Error(ERR_ALMACEN);
      }
      if (!Array.isArray(res) || res.length !== stmts.length) throw new Error(ERR_ALMACEN);
      try {
        let i = purga.length;
        return ops.flatMap((o) => {
          const r = res.slice(i, i + o.stmts.length).map((x) => ({ results: x?.results ?? [] }));
          i += o.stmts.length;
          return o.fin(r, now);
        });
      } catch {
        throw new Error(ERR_ALMACEN);
      }
    },
  };
}
