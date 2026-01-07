const TWO_PI = Math.PI * 2;
const DEFAULT_PITCH_LIMIT = Math.PI / 2 - 0.01;
const AXIS_X = { x: 1, y: 0, z: 0 };
const AXIS_Y = { x: 0, y: 1, z: 0 };

export function makeQuat() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function normalizeAngleRad(angle) {
  let out = angle;
  while (out > Math.PI) out -= TWO_PI;
  while (out < -Math.PI) out += TWO_PI;
  return out;
}

export function clampPitchRad(pitch, limit = DEFAULT_PITCH_LIMIT) {
  return Math.max(-limit, Math.min(limit, pitch));
}

export function quatFromAxisAngle(axis, angle, out = makeQuat()) {
  const half = angle * 0.5;
  const s = Math.sin(half);
  out.x = axis.x * s;
  out.y = axis.y * s;
  out.z = axis.z * s;
  out.w = Math.cos(half);
  return out;
}

export function quatMultiply(a, b, out = makeQuat()) {
  const ax = a.x;
  const ay = a.y;
  const az = a.z;
  const aw = a.w;
  const bx = b.x;
  const by = b.y;
  const bz = b.z;
  const bw = b.w;

  out.x = aw * bx + ax * bw + ay * bz - az * by;
  out.y = aw * by - ax * bz + ay * bw + az * bx;
  out.z = aw * bz + ax * by - ay * bx + az * bw;
  out.w = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function quatNormalize(q, out = q) {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    out.w = 1;
    return out;
  }
  const inv = 1 / len;
  out.x = q.x * inv;
  out.y = q.y * inv;
  out.z = q.z * inv;
  out.w = q.w * inv;
  return out;
}

export function quatFromYawPitch(yaw, pitch, out = makeQuat(), scratchYaw, scratchPitch) {
  const qYaw = scratchYaw || makeQuat();
  const qPitch = scratchPitch || makeQuat();
  quatFromAxisAngle(AXIS_Y, yaw, qYaw);
  quatFromAxisAngle(AXIS_X, pitch, qPitch);
  quatMultiply(qYaw, qPitch, out);
  return quatNormalize(out, out);
}

export function avatarQuatWithYawOffset(
  yaw,
  pitch,
  out = makeQuat(),
  scratchYaw,
  scratchPitch
) {
  return quatFromYawPitch(yaw + Math.PI, pitch, out, scratchYaw, scratchPitch);
}

export function avatarQuatFacingCamera(
  yaw,
  pitch,
  out = makeQuat(),
  scratchYaw,
  scratchPitch
) {
  return quatFromYawPitch(yaw + Math.PI, -pitch, out, scratchYaw, scratchPitch);
}

export function avatarQuatWithLocalFlip(yaw, pitch, out = makeQuat()) {
  const base = quatFromYawPitch(yaw, pitch);
  const flip = quatFromAxisAngle(AXIS_Y, Math.PI);
  quatMultiply(base, flip, out);
  return quatNormalize(out, out);
}

export function forwardFromYawPitch(yaw, pitch, out = { x: 0, y: 0, z: 0 }) {
  const cosPitch = Math.cos(pitch);
  out.x = Math.sin(yaw) * cosPitch;
  out.y = -Math.sin(pitch);
  out.z = Math.cos(yaw) * cosPitch;
  return out;
}

export function cameraForwardFromYawPitch(
  yaw,
  pitch,
  out = { x: 0, y: 0, z: 0 }
) {
  const cosPitch = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cosPitch;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cosPitch;
  return out;
}

export function yawPitchFromCameraForward(forward, out = { yaw: 0, pitch: 0 }) {
  const fy = Math.max(-1, Math.min(1, forward.y));
  const pitch = Math.asin(fy);
  const yaw = Math.atan2(-forward.x, -forward.z);
  out.yaw = normalizeAngleRad(yaw);
  out.pitch = clampPitchRad(pitch);
  return out;
}

export function rotateVectorByQuat(vector, quat, out = { x: 0, y: 0, z: 0 }) {
  const vx = vector.x;
  const vy = vector.y;
  const vz = vector.z;
  const qx = quat.x;
  const qy = quat.y;
  const qz = quat.z;
  const qw = quat.w;

  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  out.x = vx + qw * tx + (qy * tz - qz * ty);
  out.y = vy + qw * ty + (qz * tx - qx * tz);
  out.z = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

export function forwardFromQuat(quat, out = { x: 0, y: 0, z: 0 }) {
  return rotateVectorByQuat({ x: 0, y: 0, z: 1 }, quat, out);
}
