// Upstash REST simulado para `wrangler dev` (sin dependencias), sobre el Redis en memoria de los tests.
// Uso: node tools/upstash-local.mjs --token <t> [--puerto 8079]   (--puerto 0 = puerto libre)
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fakeRedis } from "../tests/fixtures/redis-memoria.mjs";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const token = arg("token");
if (!token) {
  console.error("Falta --token. Uso: node tools/upstash-local.mjs --token <t> [--puerto 8079]");
  process.exit(1);
}
const puerto = arg("puerto") === undefined ? 8079 : Number(arg("puerto"));
if (!Number.isInteger(puerto) || puerto < 0 || puerto > 65535) {
  console.error("--puerto inválido");
  process.exit(1);
}

const esperado = Buffer.from(`Bearer ${token}`);
const autorizado = (h) => {
  const dado = Buffer.from(String(h ?? ""));
  return dado.length === esperado.length && timingSafeEqual(dado, esperado);
};
const redis = fakeRedis();
const MAX = 4 * 1024 * 1024;

function responder(res, status, cuerpo) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

const servidor = createServer(async (req, res) => {
  try {
    if (new URL(req.url, "http://x").pathname !== "/pipeline" || req.method !== "POST") return responder(res, 404, { error: "No encontrado" });
    if (!autorizado(req.headers.authorization)) return responder(res, 401, { error: "No autorizado" });
    const trozos = [];
    let total = 0;
    for await (const t of req) {
      total += t.length;
      if (total > MAX) return responder(res, 413, { error: "Demasiado grande" });
      trozos.push(t);
    }
    const cmds = JSON.parse(Buffer.concat(trozos).toString("utf8"));
    if (!Array.isArray(cmds)) return responder(res, 400, { error: "Se esperaba un arreglo de comandos" });
    const salida = [];
    for (const c of cmds) {
      try {
        const [r] = await redis.exec([c]);
        salida.push({ result: r });
      } catch (e) {
        salida.push({ error: String(e?.message ?? e) });
      }
    }
    responder(res, 200, salida);
  } catch (e) {
    if (!res.headersSent) responder(res, 500, { error: String(e?.message ?? e) });
  }
});
servidor.listen(puerto, "127.0.0.1", () => console.log(`http://127.0.0.1:${servidor.address().port}`));
