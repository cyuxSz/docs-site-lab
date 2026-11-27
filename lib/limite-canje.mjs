// Límite de tasa propio de POST /auth/app/canje (ruta pública): 10 peticiones bien formadas por minuto y por cubo de IP.
// Va directo sobre el binding D1 (tabla `claves`: k = canje:rl:<cubo>, v = contador, exp = fin de la ventana en ms) para
// que un cliente anónimo no gaste escrituras ni almacenamiento: por encima del límite solo se lee, y cada petición
// contada purga unas pocas claves del canje ya caducadas. `limitar` (api-comun) no cambia. Sin imports de node:*.

const LIMITE = 10;
const VENTANA_MS = 60_000;
const PURGA = 50;
const CUBO_COMUN = "sin-ip";

// Función pura: IPv4 válida → la dirección completa; IPv6 válida → su /64 normalizado; cualquier otra cosa → cubo común.
// El resultado se reconstruye a partir de números ya validados: el valor de la cabecera nunca se copia tal cual.
export function cuboDeIp(valor) {
  const ip = typeof valor === "string" ? valor.trim() : "";
  if (!ip || ip.length > 45) return CUBO_COMUN;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const octetos = v4.slice(1).map(Number);
    return octetos.every((o) => o <= 255) ? octetos.join(".") : CUBO_COMUN;
  }

  if (!/^[0-9a-fA-F:]+$/.test(ip)) return CUBO_COMUN;
  const partes = ip.split("::");
  if (partes.length > 2) return CUBO_COMUN;
  const grupos = (s) => (s === "" ? [] : s.split(":"));
  const cabeza = grupos(partes[0]);
  const cola = partes.length === 2 ? grupos(partes[1]) : [];
  if (![...cabeza, ...cola].every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return CUBO_COMUN;
  let todos;
  if (partes.length === 2) {
    const faltan = 8 - cabeza.length - cola.length;
    if (faltan < 1) return CUBO_COMUN;
    todos = [...cabeza, ...Array(faltan).fill("0"), ...cola];
  } else {
    if (cabeza.length !== 8) return CUBO_COMUN;
    todos = cabeza;
  }
  // Solo los 64 bits de red; los de interfaz no se guardan.
  return `${todos.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

const espera = (exp, ahora) => Math.min(VENTANA_MS / 1000, Math.max(1, Math.ceil((Number(exp) - ahora) / 1000)));

// Devuelve { permitido: true } o { permitido: false, espera } (segundos hasta que cierre la ventana).
// Si D1 falla, la promesa se rechaza: quien llama responde 503 sin detalles.
export async function limitarCanje(db, ipCabecera) {
  const k = `canje:rl:${cuboDeIp(ipCabecera)}`;
  const ahora = Date.now();

  // Lectura previa: con el cupo agotado dentro de la ventana no se escribe nada (ni incremento, ni caducidad, ni purga).
  const fila = await db.prepare("SELECT v, exp FROM claves WHERE k = ?").bind(k).first();
  if (fila && fila.exp !== null && Number(fila.exp) > ahora && Number(fila.v) >= LIMITE) {
    return { permitido: false, espera: espera(fila.exp, ahora) };
  }

  // Un solo batch: purga acotada de claves del canje caducadas (entra por el índice claves_exp) e incremento atómico.
  // Ventana fija: la caducidad solo se pone al crear el contador o al reiniciarlo una vez caducado.
  const res = await db.batch([
    db
      .prepare("DELETE FROM claves WHERE k IN (SELECT k FROM claves WHERE exp IS NOT NULL AND exp <= ? AND k LIKE 'canje:rl:%' LIMIT ?)")
      .bind(ahora, PURGA),
    db
      .prepare(
        "INSERT INTO claves (k, tipo, v, exp) VALUES (?, 'string', '1', ?) " +
          "ON CONFLICT(k) DO UPDATE SET " +
          "v = CASE WHEN exp IS NULL OR exp <= ? THEN '1' ELSE CAST(CAST(v AS INTEGER) + 1 AS TEXT) END, " +
          "exp = CASE WHEN exp IS NULL OR exp <= ? THEN excluded.exp ELSE exp END " +
          "RETURNING v, exp",
      )
      .bind(k, ahora + VENTANA_MS, ahora, ahora),
  ]);
  const nueva = res?.[1]?.results?.[0];
  const n = Number(nueva?.v);
  if (!nueva || !Number.isFinite(n)) throw new Error("Límite no disponible");
  if (n > LIMITE) return { permitido: false, espera: espera(nueva.exp, ahora) };
  return { permitido: true };
}
