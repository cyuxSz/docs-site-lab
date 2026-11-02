// Redis en memoria con la forma del cliente real (exec(comandos) → resultados crudos de /pipeline de Upstash).
// Lo usan los tests de hardware y archivos. Strings, hashes (Map), sets (Set) y listas (Array).
export function fakeRedis() {
  const data = new Map();
  const ttl = new Map();
  const hash = (k) => {
    if (!(data.get(k) instanceof Map)) data.set(k, new Map());
    return data.get(k);
  };
  const lista = (k) => {
    if (!Array.isArray(data.get(k))) data.set(k, []);
    return data.get(k);
  };
  const rango = (arr, a, b) => {
    const n = arr.length;
    let i = Number(a);
    let j = Number(b);
    if (i < 0) i = Math.max(0, n + i);
    if (j < 0) j = n + j;
    return arr.slice(i, Math.min(j, n - 1) + 1);
  };
  const run = ([cmd, ...a]) => {
    switch (String(cmd).toUpperCase()) {
      case "GET": return typeof data.get(a[0]) === "string" ? data.get(a[0]) : null;
      case "SET": {
        const opts = a.slice(2).map((x) => String(x).toUpperCase());
        if (opts.includes("NX") && data.has(a[0])) return null;
        if (opts.includes("XX") && !data.has(a[0])) return null;
        data.set(a[0], String(a[1]));
        const ex = opts.indexOf("EX");
        if (ex >= 0) ttl.set(a[0], Number(a[2 + ex + 1]));
        else ttl.delete(a[0]);
        return "OK";
      }
      case "DEL": { let n = 0; for (const k of a) if (data.delete(k)) { ttl.delete(k); n++; } return n; }
      case "EXISTS": return a.filter((k) => data.has(k)).length;
      case "HGETALL": return data.get(a[0]) instanceof Map ? [...data.get(a[0])].flat() : [];
      case "HGET": return data.get(a[0]) instanceof Map ? data.get(a[0]).get(a[1]) ?? null : null;
      case "HMGET": return a.slice(1).map((f) => (data.get(a[0]) instanceof Map ? data.get(a[0]).get(f) ?? null : null));
      case "HEXISTS": return data.get(a[0]) instanceof Map && data.get(a[0]).has(a[1]) ? 1 : 0;
      case "HLEN": return data.get(a[0]) instanceof Map ? data.get(a[0]).size : 0;
      case "HKEYS": return data.get(a[0]) instanceof Map ? [...data.get(a[0]).keys()] : [];
      case "HVALS": return data.get(a[0]) instanceof Map ? [...data.get(a[0]).values()] : [];
      case "HSET": { const h = hash(a[0]); let n = 0; for (let i = 1; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return n; }
      case "HSETNX": { const h = hash(a[0]); if (h.has(a[1])) return 0; h.set(a[1], String(a[2])); return 1; }
      case "HINCRBY": { const h = hash(a[0]); const v = Number(h.get(a[1]) ?? 0) + Number(a[2]); h.set(a[1], String(v)); return v; }
      case "HDEL": { const h = data.get(a[0]); let n = 0; for (const f of a.slice(1)) if (h instanceof Map && h.delete(f)) n++; if (h instanceof Map && h.size === 0) data.delete(a[0]); return n; }
      case "SADD": { if (!(data.get(a[0]) instanceof Set)) data.set(a[0], new Set()); let n = 0; for (const m of a.slice(1)) if (!data.get(a[0]).has(String(m))) { data.get(a[0]).add(String(m)); n++; } return n; }
      case "SREM": { const s = data.get(a[0]); let n = 0; for (const m of a.slice(1)) if (s instanceof Set && s.delete(String(m))) n++; if (s instanceof Set && s.size === 0) data.delete(a[0]); return n; }
      case "SISMEMBER": return data.get(a[0]) instanceof Set && data.get(a[0]).has(String(a[1])) ? 1 : 0;
      case "SMEMBERS": return data.get(a[0]) instanceof Set ? [...data.get(a[0])] : [];
      case "LPUSH": { const l = lista(a[0]); for (const v of a.slice(1)) l.unshift(String(v)); return l.length; }
      case "RPUSH": { const l = lista(a[0]); for (const v of a.slice(1)) l.push(String(v)); return l.length; }
      case "LRANGE": return Array.isArray(data.get(a[0])) ? rango(data.get(a[0]), a[1], a[2]) : [];
      case "LINDEX": { const l = data.get(a[0]); if (!Array.isArray(l)) return null; let i = Number(a[1]); if (i < 0) i += l.length; return l[i] ?? null; }
      case "LLEN": return Array.isArray(data.get(a[0])) ? data.get(a[0]).length : 0;
      case "LTRIM": { const l = data.get(a[0]); if (!Array.isArray(l)) return "OK"; const r = rango(l, a[1], a[2]); if (r.length) data.set(a[0], r); else data.delete(a[0]); return "OK"; }
      case "INCR": { const v = Number(data.get(a[0]) ?? 0) + 1; data.set(a[0], String(v)); return v; }
      case "EXPIRE": if (!data.has(a[0])) return 0; if (String(a[2] ?? "").toUpperCase() === "NX" && ttl.has(a[0])) return 0; ttl.set(a[0], Number(a[1])); return 1;
      case "TTL": return data.has(a[0]) ? (ttl.get(a[0]) ?? -1) : -2;
      default: throw new Error(`fake: comando no soportado ${cmd}`);
    }
  };
  return { data, ttl, comandos: [], async exec(cmds) { this.comandos.push(...cmds); return cmds.map(run); } };
}
