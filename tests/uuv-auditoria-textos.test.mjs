// Auditoría del UUV (NAV-01, VIS-01, SIM-01): los textos de projects.json no deben afirmar lo que hoy no funciona.
// - La única fuente de pose es la ZED 2i (camera_opener → /pose); IMU y EKF no están integrados.
// - picture nunca publica /camera/low_res (coma faltante en picture.py:49); /take_picture sí funciona.
// - En sim, giros con yaw > ~90° desestabilizan el ASMC (satura a ±70 N).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const crudo = readFileSync(fileURLToPath(new URL("../projects.json", import.meta.url)), "utf8");
const proyectos = () => JSON.parse(crudo);
const uuv = () => proyectos().find((p) => p.id === "uuv");

// Todas las cadenas de texto del proyecto uuv (recorre el objeto entero).
const textos = (o, out = []) => {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => textos(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => textos(x, out));
  return out;
};

test("projects.json sigue siendo JSON válido con uuv y proyecto-x", () => {
  const ps = proyectos();
  assert.ok(Array.isArray(ps));
  assert.deepEqual(ps.map((p) => p.id), ["uuv", "proyecto-x"]);
});

test("uuv: ningún texto dice «localización EKF» ni presenta el EKF como funcional", () => {
  for (const t of textos(uuv())) {
    assert.doesNotMatch(t, /localizaci[oó]n EKF/i, t);
    if (/EKF/.test(t)) assert.match(t, /planead|no (est[aá] )?integrad|pendiente|sin integrar/i, `EKF sin aclarar que no corre: ${t}`);
  }
});

test("uuv: resumenInicio y descripcionCaratula dicen que la pose viene de la ZED", () => {
  const p = uuv();
  for (const campo of ["resumenInicio", "descripcionCaratula"]) {
    assert.match(p[campo], /pose/i, `${campo} no habla de la pose`);
    assert.match(p[campo], /ZED/, `${campo} no nombra la ZED`);
  }
  assert.match(p.descripcionCaratula, /para RoboSub: chasis tipo costillar/, "se conserva el inicio de la carátula");
});

const pasoVision = (node) => {
  const paso = uuv().secciones?.vision?.tour?.find((s) => s.node === node);
  assert.ok(paso, `falta el paso ${node} en secciones.vision.tour`);
  return paso.text;
};

test("tour de visión, picture: /camera/low_res aparece como roto (no publica) y explica por qué", () => {
  const t = pasoVision("uuv_vision/picture");
  assert.ok(t.includes("/camera/low_res"), "debe seguir nombrando /camera/low_res");
  assert.doesNotMatch(t, /(?<!\b(no|nunca|jam[aá]s) )publica \/camera\/low_res/, "no debe afirmar que publica /camera/low_res");
  assert.match(t, /roto|no (se )?publica|nunca publica|no llega/i, "debe decir que el tópico no se publica");
  assert.match(t, /coma|picture\.py|not callable/i, "debe decir por qué (coma faltante en picture.py)");
  assert.ok(t.includes("/take_picture"), "el servicio /take_picture sigue descrito");
});

test("tour de visión, instruction_handler: menciona el límite de giros de ~90° y el ASMC", () => {
  const t = pasoVision("uuv_mission/instruction_handler");
  assert.match(t, /90\s*°/, "falta el límite de ~90°");
  assert.match(t, /giro/i);
  assert.match(t, /ASMC|asmc/);
  assert.match(t, /traslacion|traslación/i, "debe decir que las traslaciones sí funcionan");
});

test("tour principal, instruction_handler: también avisa del límite de giros de ~90°", () => {
  const paso = uuv().tour.find((s) => s.node === "uuv_mission/instruction_handler");
  assert.ok(paso, "falta el paso instruction_handler en el tour principal");
  assert.match(paso.text, /90\s*°/);
  assert.match(paso.text, /giro/i);
});

test("proyecto-x no cambia respecto a main", (t) => {
  const existe = (ref) => {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: RAIZ, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  };
  // En push a main la comparación es contra sí mismo y pasa; es esperado.
  let spec;
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    // CI de PR (checkout superficial): solo existe refs/pull/N/merge, hay que traer la base.
    assert.match(baseRef, /^[A-Za-z0-9._/-]+$/, `GITHUB_BASE_REF con caracteres no válidos: ${baseRef}`);
    assert.ok(!baseRef.startsWith("-"), "GITHUB_BASE_REF no puede empezar con «-»");
    try {
      execFileSync("git", ["fetch", "--quiet", "--depth=1", "origin", baseRef], { cwd: RAIZ, stdio: "pipe" });
    } catch (e) {
      assert.fail(`no se pudo hacer fetch de la base «${baseRef}» para comparar proyecto-x: ${e.message}`);
    }
    spec = "FETCH_HEAD:projects.json";
  } else {
    const ref = ["origin/main", "main"].find(existe);
    if (!ref) return t.skip("sin ref de main ni GITHUB_BASE_REF en este checkout");
    spec = `${ref}:projects.json`;
  }
  const base = execFileSync("git", ["show", spec], { cwd: RAIZ, encoding: "utf8" });
  const antes = JSON.parse(base).find((p) => p.id === "proyecto-x");
  const ahora = proyectos().find((p) => p.id === "proyecto-x");
  assert.deepEqual(ahora, antes);
});
