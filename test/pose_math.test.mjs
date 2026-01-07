import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  avatarQuatFacingCamera,
  avatarQuatWithLocalFlip,
  avatarQuatWithYawOffset,
  cameraForwardFromYawPitch,
  clampPitchRad,
  forwardFromQuat,
  forwardFromYawPitch,
  normalizeAngleRad,
  quatFromYawPitch,
  yawPitchFromCameraForward
} from '../public/pose_math.mjs';

const EPS = 1e-6;

function approxEqual(actual, expected, eps = EPS) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} ~= ${expected}`
  );
}

function approxVec(actual, expected, eps = EPS) {
  approxEqual(actual.x, expected.x, eps);
  approxEqual(actual.y, expected.y, eps);
  approxEqual(actual.z, expected.z, eps);
}

test('normalizeAngleRad clamps to [-pi, pi]', () => {
  approxEqual(normalizeAngleRad(3 * Math.PI), Math.PI);
  approxEqual(normalizeAngleRad(-3 * Math.PI), -Math.PI);
  approxEqual(normalizeAngleRad(2 * Math.PI), 0);
});

test('clampPitchRad clamps to default limits', () => {
  const limit = Math.PI / 2 - 0.01;
  approxEqual(clampPitchRad(2), limit);
  approxEqual(clampPitchRad(-2), -limit);
  approxEqual(clampPitchRad(0.1), 0.1);
});

test('quatFromYawPitch matches forward vector formula', () => {
  const samples = [
    { yaw: 0, pitch: 0 },
    { yaw: Math.PI / 2, pitch: 0 },
    { yaw: -Math.PI / 2, pitch: 0.3 },
    { yaw: Math.PI, pitch: -0.4 },
    { yaw: 1.2, pitch: 0.5 }
  ];

  samples.forEach(({ yaw, pitch }) => {
    const expected = forwardFromYawPitch(yaw, pitch);
    const quat = quatFromYawPitch(yaw, pitch);
    const actual = forwardFromQuat(quat);
    approxVec(actual, expected);
  });
});

test('yaw offset flip preserves pitch and flips X/Z', () => {
  const samples = [
    { yaw: 0, pitch: 0.2 },
    { yaw: Math.PI / 3, pitch: -0.4 },
    { yaw: -Math.PI / 2, pitch: 0.1 }
  ];

  samples.forEach(({ yaw, pitch }) => {
    const cameraForward = forwardFromYawPitch(yaw, pitch);
    const avatarForward = forwardFromQuat(avatarQuatWithYawOffset(yaw, pitch));
    approxEqual(avatarForward.y, cameraForward.y);
    approxEqual(avatarForward.x, -cameraForward.x);
    approxEqual(avatarForward.z, -cameraForward.z);
  });
});

test('avatar facing camera matches camera forward vector', () => {
  const samples = [
    { yaw: 0, pitch: 0.2 },
    { yaw: Math.PI / 3, pitch: -0.4 },
    { yaw: -Math.PI / 2, pitch: 0.1 },
    { yaw: Math.PI, pitch: 0.35 }
  ];

  samples.forEach(({ yaw, pitch }) => {
    const cameraForward = cameraForwardFromYawPitch(yaw, pitch);
    const avatarForward = forwardFromQuat(avatarQuatFacingCamera(yaw, pitch));
    approxVec(avatarForward, cameraForward);
  });
});

test('yawPitchFromCameraForward inverts camera forward', () => {
  const samples = [
    { yaw: 0, pitch: 0 },
    { yaw: Math.PI / 4, pitch: 0.2 },
    { yaw: -Math.PI / 2, pitch: -0.3 },
    { yaw: Math.PI, pitch: 0.1 }
  ];

  samples.forEach(({ yaw, pitch }) => {
    const forward = cameraForwardFromYawPitch(yaw, pitch);
    const out = yawPitchFromCameraForward(forward);
    approxEqual(out.yaw, normalizeAngleRad(yaw));
    approxEqual(out.pitch, clampPitchRad(pitch));
  });
});

test('local flip negates full forward vector', () => {
  const samples = [
    { yaw: 0.4, pitch: -0.2 },
    { yaw: -1.1, pitch: 0.3 }
  ];

  samples.forEach(({ yaw, pitch }) => {
    const cameraForward = forwardFromYawPitch(yaw, pitch);
    const avatarForward = forwardFromQuat(avatarQuatWithLocalFlip(yaw, pitch));
    approxEqual(avatarForward.x, -cameraForward.x);
    approxEqual(avatarForward.y, -cameraForward.y);
    approxEqual(avatarForward.z, -cameraForward.z);
  });
});
