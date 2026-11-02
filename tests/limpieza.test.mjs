// Lote 8c · página "Limpieza del repo" (src/lib/limpieza.ts): filas de sin uso y legado sacadas de ros.json, progreso
// "revisado" en localStorage por proyecto (validado) y exportación a Markdown. Todo puro; el almacén se inyecta.
import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/lib/limpieza.ts").catch(() => ({}));
const fn = (name) => (...args) => {
  assert.equal(typeof mod[name], "function", `falta src/lib/limpieza.ts → ${name}`);
  return mod[name](...args);
};
const filasLimpieza = fn("filasLimpieza");
const enlaceGithub = fn("enlaceGithub");
const claveRevisados = fn("claveRevisados");
const leerRevisados = fn("leerRevisados");
const serializarRevisados = fn("serializarRevisados");
const alternarRevisado = fn("alternarRevisado");
const progreso = fn("progreso");
const filasVisibles = fn("filasVisibles");
const limpiezaMarkdown = fn("limpiezaMarkdown");
const nombreArchivoMd = fn("nombreArchivoMd");

const REPO = "https://github.com/o/r";
const SHA = "abc123";
const n = (id, status, extra = {}) => ({ id, label: id.split("/").pop(), category: "ros2_node", package: id.split("/")[0], layer: "control", status, file: `src/${id}.cpp`, line: 10, configs: [], launches: [], ...extra });
// Forma de openwiki/.graph/ros.json: configs (una legado), launches con su config (o null) y nodos con configs/launches.
const ROS = {
  configs: [
    { id: "real", label: "Sub real", launch: "src/m/launch/real.launch.py" },
    { id: "legado", label: "Sistema anterior (gazebo_launch)", launch: "src/m/launch/gazebo_launch.py", legado: true },
  ],
  launches: [
    { path: "src/m/launch/real.launch.py", config: "real", nodes: [], broken: [] },
    { path: "src/m/launch/gazebo_launch.py", config: "legado", nodes: [], broken: [] },
    { path: "src/m/launch/viejo.launch.py", config: null, nodes: [], broken: [] },
  ],
  nodes: [
    n("ctl/asmc", "en_uso", { configs: ["real"], launches: ["src/m/launch/real.launch.py"] }),
    n("nav/los", "legado", { configs: ["legado"], launches: ["src/m/launch/gazebo_launch.py", "src/m/launch/viejo.launch.py"] }),
    n("ctl/pid", "legado", { launches: ["src/m/launch/viejo.launch.py"] }),
    n("ctl/zz_sin", "sin_uso"),
    n("ctl/control_by_size", "sin_uso", { line: null }),
    n("ext/bridge", "externo", { layer: "externo" }),
    n("vis/nodocamara", "roto", { launches: ["src/m/launch/viejo.launch.py"] }),
    { id: "topic:/x", label: "/x", category: "ros2_topic", configs: [] },
  ],
  edges: [],
};

test("filasLimpieza: separa sin uso y legado; ignora en uso, externo, roto y topics; ordena por paquete y ejecutable", () => {
  const f = filasLimpieza(ROS, REPO, SHA);
  assert.deepEqual(f.sinUso.map((x) => x.id), ["ctl/control_by_size", "ctl/zz_sin"]);
  assert.deepEqual(f.legado.map((x) => x.id), ["ctl/pid", "nav/los"]);
});

test("filasLimpieza: cada fila lleva paquete, ejecutable, archivo con enlace a GitHub y motivo", () => {
  const f = filasLimpieza(ROS, REPO, SHA);
  const s = f.sinUso.find((x) => x.id === "ctl/zz_sin");
  assert.equal(s.paquete, "ctl");
  assert.equal(s.ejecutable, "zz_sin");
  assert.equal(s.archivo, "src/ctl/zz_sin.cpp");
  assert.equal(s.url, "https://github.com/o/r/blob/abc123/src/ctl/zz_sin.cpp#L10");
  assert.equal(s.motivo, mod.MOTIVO_SIN_USO);
  assert.equal(f.sinUso.find((x) => x.id === "ctl/control_by_size").url, "https://github.com/o/r/blob/abc123/src/ctl/control_by_size.cpp", "sin línea, sin #L");
  assert.equal(typeof mod.MOTIVO_SIN_USO, "string");
  assert.ok(mod.MOTIVO_SIN_USO.length > 0);
});

test("filasLimpieza: legado dice qué hay que retirar (configs legado por su nombre y launches sueltos por su ruta)", () => {
  const f = filasLimpieza(ROS, REPO, SHA);
  const los = f.legado.find((x) => x.id === "nav/los");
  assert.deepEqual(los.configs, ["Sistema anterior (gazebo_launch)"]);
  assert.deepEqual(los.launches, ["src/m/launch/viejo.launch.py"], "el launch de la config legado no se repite");
  assert.equal(los.motivo, mod.MOTIVO_LEGADO);
  const pid = f.legado.find((x) => x.id === "ctl/pid");
  assert.deepEqual(pid.configs, []);
  assert.deepEqual(pid.launches, ["src/m/launch/viejo.launch.py"]);
  assert.notEqual(mod.MOTIVO_LEGADO, mod.MOTIVO_SIN_USO);
});

test("filasLimpieza: sin ros o sin nodos devuelve listas vacías", () => {
  assert.deepEqual(filasLimpieza(null, REPO, SHA), { sinUso: [], legado: [] });
  assert.deepEqual(filasLimpieza({ ...ROS, nodes: [] }, REPO, SHA), { sinUso: [], legado: [] });
});

test("enlaceGithub: solo https://github.com y rutas relativas sin '..'", () => {
  assert.equal(enlaceGithub(REPO, SHA, "src/a b.py", 3), "https://github.com/o/r/blob/abc123/src/a%20b.py#L3");
  assert.equal(enlaceGithub(REPO, SHA, "src/a.py", null), "https://github.com/o/r/blob/abc123/src/a.py");
  for (const [repo, file] of [["javascript:alert(1)", "a.py"], ["https://evil.com/o/r", "a.py"], ["", "a.py"], [REPO, ""], [REPO, undefined], [REPO, "../x.py"], [REPO, "/etc/passwd"]])
    assert.equal(enlaceGithub(repo, SHA, file, 1), null, `${repo} ${file}`);
});

// --- Progreso "revisado" (localStorage por proyecto) ---
test("claveRevisados: una clave por proyecto", () => {
  assert.notEqual(claveRevisados("uuv"), claveRevisados("proyecto-x"));
  assert.match(claveRevisados("uuv"), /uuv/);
});

test("leerRevisados: valida (JSON roto, no arreglo, no texto o ids que ya no existen se descartan)", () => {
  const ids = ["ctl/pid", "nav/los", "ctl/zz_sin"];
  assert.deepEqual([...leerRevisados(null, ids)], []);
  assert.deepEqual([...leerRevisados("{no json", ids)], []);
  assert.deepEqual([...leerRevisados('{"a":1}', ids)], []);
  assert.deepEqual([...leerRevisados('["ctl/pid", 3, null, "x/borrado", "nav/los", "ctl/pid"]', ids)].sort(), ["ctl/pid", "nav/los"]);
});

test("serializarRevisados / alternarRevisado: ida y vuelta sin mutar el conjunto original", () => {
  const a = new Set(["ctl/pid"]);
  const b = alternarRevisado(a, "nav/los", true);
  assert.deepEqual([...a], ["ctl/pid"], "no muta");
  assert.deepEqual([...b].sort(), ["ctl/pid", "nav/los"]);
  const c = alternarRevisado(b, "ctl/pid", false);
  assert.deepEqual([...c], ["nav/los"]);
  assert.deepEqual([...leerRevisados(serializarRevisados(b), ["ctl/pid", "nav/los"])].sort(), ["ctl/pid", "nav/los"]);
});

test("progreso: 'N de M revisados' contando solo filas existentes", () => {
  const f = filasLimpieza(ROS, REPO, SHA);
  const todas = [...f.sinUso, ...f.legado];
  const p = progreso(todas, new Set(["ctl/pid", "x/fantasma"]));
  assert.deepEqual([p.hechos, p.total], [1, 4]);
  assert.equal(p.texto, "1 de 4 revisados");
  assert.equal(progreso([], new Set()).texto, "0 de 0 revisados");
});

test("filasVisibles: 'ocultar revisados' quita las marcadas; apagado, devuelve todas", () => {
  const f = filasLimpieza(ROS, REPO, SHA).legado;
  const r = new Set(["ctl/pid"]);
  assert.deepEqual(filasVisibles(f, r, true).map((x) => x.id), ["nav/los"]);
  assert.deepEqual(filasVisibles(f, r, false).map((x) => x.id), ["ctl/pid", "nav/los"]);
});

test("limpiezaMarkdown: dos secciones, casillas [x]/[ ] según revisado, enlaces y qué retirar", () => {
  const f = filasLimpieza(ROS, REPO, SHA);
  const md = limpiezaMarkdown("UUV", f, new Set(["ctl/zz_sin"]));
  assert.match(md, /^# Limpieza del repo · UUV/m);
  assert.match(md, /^## Sin uso \(candidatos a borrar\)/m);
  assert.match(md, /^## Legado/m);
  assert.ok(md.indexOf("## Sin uso") < md.indexOf("## Legado"));
  assert.match(md, /^- \[x\] .*zz_sin/m, "revisado");
  assert.match(md, /^- \[ \] .*control_by_size/m, "no revisado");
  assert.ok(md.includes("https://github.com/o/r/blob/abc123/src/ctl/zz_sin.cpp#L10"));
  assert.ok(md.includes("`Sistema anterior (gazebo_launch)`"), "fase 0: configs como code span");
  assert.ok(md.includes("src/m/launch/viejo.launch.py"));
  assert.ok(md.includes("1 de 4 revisados"));
});

test("limpiezaMarkdown: el texto del repo no rompe el Markdown (backticks y saltos de línea neutralizados)", () => {
  const raro = { ...ROS, nodes: [n("p/a`b", "sin_uso", { label: "a`b\n# titulo falso" })] };
  const md = limpiezaMarkdown("X", filasLimpieza(raro, REPO, SHA), new Set());
  assert.doesNotMatch(md, /^# titulo falso/m);
  assert.ok(md.includes("``src/p/a`b.cpp``"), "los backticks del dato van en un code span con delimitador más largo");
});

test("nombreArchivoMd: nombre seguro por proyecto", () => {
  assert.equal(nombreArchivoMd("uuv"), "limpieza-uuv.md");
  assert.equal(nombreArchivoMd("../x y"), "limpieza-x-y.md");
});
