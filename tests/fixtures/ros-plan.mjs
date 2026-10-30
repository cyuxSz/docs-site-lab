// ros-mini + capa "Plan" (aristas kind "plan", nodos plan: true) + dos configuraciones, una de ellas legado: true.
// Imita openwiki/.graph/ros.json del UUV (vectornav → /vectornav/imu → ekf_node → /odometry/filtered → asmc →
// to_arduino_from_locacion → hw:arduino) sin depender de ../uuv-wiki.
import { rosNodes, rosEdges, projectData } from "./ros-mini.mjs";

const EN_REAL = new Set(["hw:zed", "nav/camera_opener", "mis/instruction_handler", "ctl/asmc", "ctl/thrust_allocator"]);
const EN_LEGADO = new Set(["mis/instruction_handler", "ctl/asmc", "ctl/viejo"]);
const conConfigs = (n) => ({
  ...n,
  configs: [...(EN_REAL.has(n.id) ? ["real"] : []), ...(EN_LEGADO.has(n.id) ? ["legado"] : [])],
});
const plan = (source, target, label) => ({ source, target, kind: "plan", label, file: "src/plan.py", line: 7 });

export const planNodes = [
  // Solo existen en el plan (todas sus aristas son kind "plan").
  { id: "ext/imu_drv", label: "imu_drv", category: "ros2_node", package: "ext", layer: "externo", status: "externo", configs: [], plan: true },
  { id: "ext/ekf", label: "ekf", category: "ros2_node", package: "ext", layer: "externo", status: "externo", configs: [], plan: true },
  { id: "topic:/imu", label: "/imu", category: "ros2_topic", configs: [], plan: true },
  { id: "topic:/odom_f", label: "/odom_f", category: "ros2_topic", configs: [], plan: true },
  // Existe hoy (tiene aristas reales) y además está en el plan.
  { id: "hw:ard", label: "Arduino", category: "hardware", layer: "hardware", configs: [], plan: true },
];

export const planEdges = [
  plan("ext/imu_drv", "topic:/imu", "IMU"),
  plan("topic:/imu", "ext/ekf", "IMU"),
  plan("ext/ekf", "topic:/odom_f", "EKF"),
  plan("topic:/odom_f", "ctl/asmc", "odometría filtrada"),
  plan("ctl/asmc", "ctl/viejo", "/forces"),
  plan("ctl/viejo", "hw:ard", "PWM"),
];

export const planRosNodes = [
  ...rosNodes.map((n) => (n.id === "ctl/viejo" ? { ...conConfigs(n), plan: true } : conConfigs(n))),
  ...planNodes,
];
export const planRosEdges = [...rosEdges, { source: "ctl/viejo", target: "hw:ard", kind: "hw", label: "serial", file: "src/x.py", line: 2 }, ...planEdges];

export const CONFIGS = [
  { id: "real", label: "Sub real", launch: "real.launch.py" },
  { id: "legado", label: "Sistema anterior (gazebo_launch)", launch: "gazebo_launch.py", legado: true },
];

export function planProjectData(extra = {}) {
  const base = projectData();
  return {
    ...base,
    ros: { configs: CONFIGS, launches: [], nodes: planRosNodes, edges: planRosEdges },
    ...extra,
  };
}
