// Mide la CPU de renderizarMd (satteri nativo en Node). Uso: node tools/medir-render.mjs [--iteraciones N]
// Aviso: en Node satteri es nativo; es una cota inferior y no vale tal cual para el Worker (ahí no corre, ver M2b).
import { renderizarMd } from "../lib/hardware-core.mjs";

const i = process.argv.indexOf("--iteraciones");
const N = i >= 0 ? Math.max(1, Number.parseInt(process.argv[i + 1], 10) || 20) : 20;

function pagina(bytes) {
  const bloque = [
    "## Sección de ejemplo",
    "",
    "Texto con **negritas**, _cursivas_, `código en línea` y un [enlace](https://ejemplo.org/docs?x=1).",
    "",
    "| Pin | Señal | Nota |",
    "| --- | ----- | ---- |",
    "| 1 | VCC | 5 V |",
    "| 2 | GND | masa |",
    "",
    "- elemento uno",
    "- elemento dos con [otro enlace](/uuv/electronica/)",
    "  - anidado",
    "",
    "```c",
    "int main(void) { return 0; }",
    "```",
    "",
  ].join("\n");
  let md = "# Página de ejemplo\n\n";
  for (let k = 0; Buffer.byteLength(md) < bytes; k++) md += bloque.replace("Sección de ejemplo", `Sección ${k}`) + "\n";
  return md.slice(0, bytes);
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function medir(nombre, md) {
  for (let k = 0; k < 3; k++) await renderizarMd(md);
  const reloj = [];
  const cpu = [];
  for (let k = 0; k < N; k++) {
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    await renderizarMd(md);
    reloj.push(performance.now() - t0);
    const c = process.cpuUsage(c0);
    cpu.push((c.user + c.system) / 1000);
  }
  reloj.sort((a, b) => a - b);
  cpu.sort((a, b) => a - b);
  const kb = (Buffer.byteLength(md) / 1024).toFixed(0);
  console.log(`${nombre}: ${kb} KB | reloj p50 ${pct(reloj, 50).toFixed(1)} ms, p95 ${pct(reloj, 95).toFixed(1)} ms | CPU p50 ${pct(cpu, 50).toFixed(1)} ms, p95 ${pct(cpu, 95).toFixed(1)} ms (${N} iteraciones)`);
}

console.log("Aviso: satteri nativo en Node. Es una cota inferior y no sirve tal cual para el Worker (ahí no corre).");
await medir("mediana", pagina(20 * 1024));
await medir("grande", pagina(200 * 1024));
console.log("Umbral: Workers Free: 10 ms de CPU por petición");
