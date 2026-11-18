// Sesión firmada (cookie docs_session) compartida por el login y las APIs.
// Formato: base64url(JSON).base64url(HMAC-SHA256). No cambiarlo: invalidaría las cookies ya emitidas.
export const COOKIE = "docs_session";
const enc = new TextEncoder();

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const fromB64url = (s) => Buffer.from(s, "base64url").toString("utf8");

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(payload, secret = process.env.SESSION_SECRET) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body, secret)}`;
}

// Devuelve el payload o null; nunca lanza por un token inválido.
export async function verify(token, secret = process.env.SESSION_SECRET) {
  try {
    if (!token || typeof token !== "string" || !token.includes(".")) return null;
    const [body, mac] = token.split(".");
    if (!safeEqual(mac, await hmac(body, secret))) return null;
    const payload = JSON.parse(fromB64url(body));
    return payload && payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

export function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    // Una cookie con un % mal formado no debe tumbar el login.
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}
