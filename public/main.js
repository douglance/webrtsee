import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { PoseMessage } from './proto/pose.js';
import { createFaceZoomProcessor } from './face_zoom.mjs';
import {
  avatarQuatFacingCamera,
  cameraForwardFromYawPitch,
  clampPitchRad,
  forwardFromQuat,
  normalizeAngleRad,
  yawPitchFromCameraForward
} from './pose_math.mjs';

const overlay = document.getElementById('overlay');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const nameHudInput = document.getElementById('nameHudInput');
const statusEl = document.getElementById('status');
const controlsHint = document.getElementById('controlsHint');
const localVideo = document.getElementById('localVideo');
const shareBtn = document.getElementById('shareBtn');
const moveShareBtn = document.getElementById('moveShareBtn');
const faceZoomBtn = document.getElementById('faceZoomBtn');
const shareLinkInput = document.getElementById('shareLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const muteBtn = document.getElementById('muteBtn');
const masterVolume = document.getElementById('masterVolume');
const volumePopup = document.getElementById('volumePopup');
const popupPeerName = document.getElementById('popupPeerName');
const peerVolume = document.getElementById('peerVolume');
const mutePeerBtn = document.getElementById('mutePeerBtn');
const mobileControlsEl = document.getElementById('mobileControls');
const moveStick = document.getElementById('moveStick');
const lookStick = document.getElementById('lookStick');
const jumpBtn = document.getElementById('jumpBtn');
const crouchBtn = document.getElementById('crouchBtn');

const MAX_PIXEL_RATIO = 1;
const ROOM_CODE_LENGTH = 6;
const ROOM_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const AUDIO_CONFIG = {
  panningModel: 'equalpower',
  distanceModel: 'inverse',
  refDistance: 1.0,
  maxDistance: 50.0,
  rolloffFactor: 1.5
};
const DEBUG_VIEW_DEFAULT = false;
const DEBUG_PLANE_SIZE = 24;
const DEBUG_GRID_DIVS = 24;
const DEBUG_ARROW_LEN = 1.6;
const DEBUG_ARROW_OFFSET = 0.25;
const NAME_MAX_LENGTH = 24;
const NAME_STORAGE_KEY = 'webrtsee-name';
const NAME_TAG_WIDTH = 0.8;
const NAME_TAG_HEIGHT = 0.16;
const NAME_TAG_OFFSET_Y = 0.6;
const MOBILE_MOVE_DEADZONE = 0.16;
const MOBILE_LOOK_DEADZONE = 0.12;
const MOBILE_LOOK_SPEED = 2.2;
const MOBILE_LOOK_SPEED_PITCH = 1.4;

function lerpAngle(a, b, t) {
  let delta = b - a;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
}

let scene;
let camera;
let renderer;
let controls;
let clock;

let socket;
let localStream;
let localMediaStream;
let localAudioStream;
let myId;
let joined = false;
let hasJoinedRoom = false;
let pendingShareStart = false;
let isMuted = false;
let localDisplayName = '';
let pendingNameTimer = null;
let faceZoom = null;
let faceZoomEnabled = false;

const peerConnections = new Map();
const poseChannels = new Map();
const poseInterpolators = new Map();
const remoteAvatars = new Map();
const remoteVideos = new Map();
const remoteSharePanels = new Map();
const remoteShareVideos = new Map();
const remoteShareMeta = new Map();
const remoteTrackStreams = new Map();
const remoteAvatarTrackIds = new Map();
const remoteAudioNodes = new Map();
const peerNames = new Map();

let audioContext = null;
let masterGain = null;
let localMicGain = null;
let localMicSource = null;
let localMicDestination = null;
let selectedPeerId = null;

let screenStream;
let screenTrackId;
let localSharePanel = null;
let moveShareMode = false;
let draggingShare = false;
let wasLockedBeforeMove = false;
let lastShareSent = 0;
const lastSharePosition = new THREE.Vector3();
const shareDragOffset = new THREE.Vector3();
const shareDragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.2);
const shareDragPoint = new THREE.Vector3();
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const shareFacingTarget = new THREE.Vector3();

const moveState = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  crouch: false,
  jumping: false
};
const mobileControls = {
  supported: false,
  active: false,
  el: mobileControlsEl,
  moveZone: moveStick,
  lookZone: lookStick,
  jumpBtn,
  crouchBtn,
  move: new THREE.Vector2(),
  look: new THREE.Vector2(),
  left: null,
  right: null
};
const STANDING_HEIGHT = 1.6;
const CROUCH_HEIGHT = 0.9;
const CROUCH_DURATION = 0.35;
const JUMP_HEIGHT = 0.8;
const JUMP_TICK = 1 / 20;
const JUMP_VELOCITY = 0.42;
const JUMP_GRAVITY = 0.08;
const JUMP_DRAG = 0.98;
const MC_JUMP_PEAK = 1.2522;
const JUMP_SCALE = JUMP_HEIGHT / MC_JUMP_PEAK;

let jumpVelocity = 0;
let jumpOffset = 0;
let jumpAccumulator = 0;

// Platform collision system
const platforms = [];
let currentPlatformHeight = 0;
let crouchStartTime = 0;
let currentBaseHeight = STANDING_HEIGHT;
let crouchFromHeight = STANDING_HEIGHT;
let crouchTargetHeight = STANDING_HEIGHT;
let crouchTransitionActive = false;
let currentHeight = STANDING_HEIGHT;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const cameraYawPitch = { yaw: 0, pitch: 0 };
const avatarQuatOut = { x: 0, y: 0, z: 0, w: 1 };
const avatarYawQuat = { x: 0, y: 0, z: 0, w: 1 };
const avatarPitchQuat = { x: 0, y: 0, z: 0, w: 1 };
const mobileLookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const debugRemoteState = new Map();
const debugCameraQuat = new THREE.Quaternion();
const debugCameraForward = new THREE.Vector3();
const debugAvatarForwardVec = new THREE.Vector3();
const debugExpectedForwardVec = new THREE.Vector3();
const nameTagWorldPos = new THREE.Vector3();
const debugLocalExpected = { x: 0, y: 0, z: 0 };
const debugRemoteExpected = { x: 0, y: 0, z: 0 };
const debugRemoteActual = { x: 0, y: 0, z: 0 };
const debugLocalState = {
  rawYaw: 0,
  rawPitch: 0,
  yaw: 0,
  pitch: 0,
  yawNorm: 0,
  pitchClamp: 0
};
const debugView = {
  overlay: null,
  group: null,
  localArrow: null,
  remoteArrow: null,
  remoteExpectedArrow: null,
  localAxes: null,
  remoteAxes: null
};
let debugEnabled = DEBUG_VIEW_DEFAULT;

const lastPose = {
  position: new THREE.Vector3(),
  yaw: 0,
  pitch: 0
};
let lastPoseSent = 0;

setupLobby();
setupDisplayName();
initScene();
animate();

joinBtn.addEventListener('click', () => {
  if (joined) {
    return;
  }
  joinExperience();
});

[nameInput, nameHudInput].forEach((input) => {
  if (!input) {
    return;
  }
  input.addEventListener('input', (event) => {
    setLocalDisplayName(event.target.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      input.blur();
    }
  });
});

roomInput.addEventListener('input', () => {
  const sanitized = sanitizeRoomCode(roomInput.value);
  if (roomInput.value !== sanitized) {
    roomInput.value = sanitized;
  }
  if (sanitized) {
    setRoomCode(sanitized, false);
  }
});

roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !joined) {
    joinExperience();
  }
});

roomInput.addEventListener('blur', () => {
  if (!roomInput.value.trim()) {
    setRoomCode(generateLobbyCode(), true);
  }
});

copyLinkBtn.addEventListener('click', () => {
  copyToClipboard(shareLinkInput.value, copyLinkBtn);
});

copyCodeBtn.addEventListener('click', () => {
  copyToClipboard(sanitizeRoomCode(roomInput.value), copyCodeBtn);
});

muteBtn.addEventListener('click', () => {
  toggleLocalMute();
});

masterVolume.addEventListener('input', () => {
  setMasterVolume(Number(masterVolume.value));
});

mutePeerBtn.addEventListener('click', () => {
  if (!selectedPeerId) {
    return;
  }
  togglePeerMute(selectedPeerId);
  syncPeerVolumeUI(selectedPeerId);
});

peerVolume.addEventListener('input', () => {
  if (!selectedPeerId) {
    return;
  }
  setPeerVolume(selectedPeerId, Number(peerVolume.value));
  syncPeerVolumeUI(selectedPeerId);
});

volumePopup.addEventListener('pointerdown', (event) => {
  event.stopPropagation();
});

shareBtn.addEventListener('click', () => {
  if (!joined) {
    return;
  }
  if (screenStream) {
    stopScreenShare();
  } else {
    startScreenShare();
  }
});

moveShareBtn.addEventListener('click', () => {
  if (!localSharePanel) {
    return;
  }
  toggleMoveShare();
});

faceZoomBtn.addEventListener('click', () => {
  if (!faceZoom) {
    return;
  }
  setFaceZoomEnabled(!faceZoomEnabled);
});

function setupDebugView() {
  if (debugView.group || debugView.overlay) {
    return;
  }

  const overlayEl = document.createElement('pre');
  overlayEl.id = 'debugOverlay';
  overlayEl.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:1000;' +
    'background:rgba(0,0,0,0.65);color:#8effc1;' +
    'font:12px/1.4 monospace;padding:8px 10px;' +
    'pointer-events:none;white-space:pre;max-width:45vw;';
  document.body.appendChild(overlayEl);
  debugView.overlay = overlayEl;

  const group = new THREE.Group();
  group.name = 'debug-helpers';

  const axes = new THREE.AxesHelper(4);
  group.add(axes);

  const gridXZ = new THREE.GridHelper(DEBUG_PLANE_SIZE, DEBUG_GRID_DIVS, 0x3a3a3a, 0x1f1f1f);
  group.add(gridXZ);

  const gridXY = new THREE.GridHelper(DEBUG_PLANE_SIZE, DEBUG_GRID_DIVS, 0x3a3a3a, 0x1f1f1f);
  gridXY.rotation.x = Math.PI / 2;
  group.add(gridXY);

  const gridYZ = new THREE.GridHelper(DEBUG_PLANE_SIZE, DEBUG_GRID_DIVS, 0x3a3a3a, 0x1f1f1f);
  gridYZ.rotation.z = Math.PI / 2;
  group.add(gridYZ);

  const planeMaterial = (color) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      depthWrite: false
    });

  const planeXY = new THREE.Mesh(
    new THREE.PlaneGeometry(DEBUG_PLANE_SIZE, DEBUG_PLANE_SIZE),
    planeMaterial(0xff4444)
  );
  group.add(planeXY);

  const planeXZ = new THREE.Mesh(
    new THREE.PlaneGeometry(DEBUG_PLANE_SIZE, DEBUG_PLANE_SIZE),
    planeMaterial(0x4444ff)
  );
  planeXZ.rotation.x = -Math.PI / 2;
  group.add(planeXZ);

  const planeYZ = new THREE.Mesh(
    new THREE.PlaneGeometry(DEBUG_PLANE_SIZE, DEBUG_PLANE_SIZE),
    planeMaterial(0x44ff44)
  );
  planeYZ.rotation.y = Math.PI / 2;
  group.add(planeYZ);

  debugView.localArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(),
    DEBUG_ARROW_LEN,
    0xffd400
  );
  group.add(debugView.localArrow);

  debugView.remoteArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(),
    DEBUG_ARROW_LEN,
    0xff00ff
  );
  group.add(debugView.remoteArrow);

  debugView.remoteExpectedArrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(),
    DEBUG_ARROW_LEN,
    0x00ffff
  );
  group.add(debugView.remoteExpectedArrow);

  debugView.localAxes = new THREE.AxesHelper(0.6);
  group.add(debugView.localAxes);

  debugView.remoteAxes = new THREE.AxesHelper(0.6);
  group.add(debugView.remoteAxes);

  debugView.group = group;
  scene.add(group);
}

function setDebugEnabled(next) {
  debugEnabled = next;
  if (debugEnabled) {
    if (!debugView.group) {
      setupDebugView();
    }
    if (debugView.group) {
      debugView.group.visible = true;
    }
    if (debugView.overlay) {
      debugView.overlay.style.display = 'block';
    }
    updateDebugView();
  } else {
    if (debugView.group) {
      debugView.group.visible = false;
    }
    if (debugView.overlay) {
      debugView.overlay.style.display = 'none';
    }
  }
}

function toggleDebugView() {
  setDebugEnabled(!debugEnabled);
}

function formatVec3(vec, digits = 3) {
  return `${vec.x.toFixed(digits)}, ${vec.y.toFixed(digits)}, ${vec.z.toFixed(digits)}`;
}

function formatQuat(quat, digits = 3) {
  return `${quat.x.toFixed(digits)}, ${quat.y.toFixed(digits)}, ${quat.z.toFixed(digits)}, ${quat.w.toFixed(digits)}`;
}

function findDebugPeerId() {
  if (selectedPeerId && remoteAvatars.has(selectedPeerId)) {
    return selectedPeerId;
  }
  for (const peerId of remoteAvatars.keys()) {
    return peerId;
  }
  return null;
}

function updateDebugView() {
  if (!debugEnabled || !debugView.overlay) {
    return;
  }

  const pos = controls.getObject().position;
  debugLocalState.rawYaw = controls.getObject().rotation.y;
  debugLocalState.rawPitch = camera.rotation.x;

  camera.getWorldQuaternion(debugCameraQuat);
  camera.getWorldDirection(debugCameraForward);
  yawPitchFromCameraForward(debugCameraForward, cameraYawPitch);
  debugLocalState.yaw = cameraYawPitch.yaw;
  debugLocalState.pitch = cameraYawPitch.pitch;
  debugLocalState.yawNorm = normalizeAngleRad(debugLocalState.yaw);
  debugLocalState.pitchClamp = clampPitchRad(debugLocalState.pitch);

  cameraForwardFromYawPitch(
    debugLocalState.yawNorm,
    debugLocalState.pitchClamp,
    debugLocalExpected
  );

  debugView.localArrow.position.copy(pos);
  debugView.localArrow.setDirection(debugCameraForward);
  debugView.localAxes.position.copy(pos);

  const peerId = findDebugPeerId();
  const remoteState = peerId ? debugRemoteState.get(peerId) : null;
  let remoteDot = null;
  let remoteAngle = null;

  if (peerId && remoteState) {
    const avatar = remoteAvatars.get(peerId);
    if (avatar) {
      debugAvatarForwardVec.set(0, 0, 1).applyQuaternion(avatar.group.quaternion).normalize();
      cameraForwardFromYawPitch(remoteState.yaw, remoteState.pitch, debugRemoteExpected);
      debugExpectedForwardVec.set(
        debugRemoteExpected.x,
        debugRemoteExpected.y,
        debugRemoteExpected.z
      ).normalize();

      remoteDot = debugAvatarForwardVec.dot(debugExpectedForwardVec);
      remoteAngle = Math.acos(Math.max(-1, Math.min(1, remoteDot))) * (180 / Math.PI);

      debugView.remoteArrow.visible = true;
      debugView.remoteExpectedArrow.visible = true;
      debugView.remoteAxes.visible = true;

      debugView.remoteArrow.position.copy(avatar.group.position);
      debugView.remoteArrow.setDirection(debugAvatarForwardVec);
      debugView.remoteAxes.position.copy(avatar.group.position);

      debugView.remoteExpectedArrow.position
        .copy(avatar.group.position)
        .addScaledVector(debugExpectedForwardVec, DEBUG_ARROW_OFFSET);
      debugView.remoteExpectedArrow.setDirection(debugExpectedForwardVec);
    }
  } else {
    debugView.remoteArrow.visible = false;
    debugView.remoteExpectedArrow.visible = false;
    debugView.remoteAxes.visible = false;
  }

  const rawYawDeg = THREE.MathUtils.radToDeg(debugLocalState.rawYaw);
  const rawPitchDeg = THREE.MathUtils.radToDeg(debugLocalState.rawPitch);
  const yawDeg = THREE.MathUtils.radToDeg(debugLocalState.yawNorm);
  const pitchDeg = THREE.MathUtils.radToDeg(debugLocalState.pitchClamp);
  const cameraForward = formatVec3(debugCameraForward);
  const expectedLocalForward = `${debugLocalExpected.x.toFixed(3)}, ${debugLocalExpected.y.toFixed(3)}, ${debugLocalExpected.z.toFixed(3)}`;

  const lines = [
    'DEBUG VIEW',
    `local pos: ${formatVec3(pos)}`,
    `raw yaw: ${debugLocalState.rawYaw.toFixed(3)} rad (${rawYawDeg.toFixed(1)} deg)`,
    `raw pitch: ${debugLocalState.rawPitch.toFixed(3)} rad (${rawPitchDeg.toFixed(1)} deg)`,
    `derived yaw: ${debugLocalState.yawNorm.toFixed(3)} rad (${yawDeg.toFixed(1)} deg)`,
    `derived pitch: ${debugLocalState.pitchClamp.toFixed(3)} rad (${pitchDeg.toFixed(1)} deg)`,
    `camera quat: ${formatQuat(debugCameraQuat)}`,
    `camera forward: ${cameraForward}`,
    `expected forward: ${expectedLocalForward}`
  ];

  if (peerId && remoteState) {
    lines.push('');
    lines.push(`remote peer: ${peerId.slice(0, 6)}`);
    lines.push(`remote pos: ${formatVec3(remoteState.position)}`);
    lines.push(
      `remote yaw/pitch: ${remoteState.yaw.toFixed(3)}, ${remoteState.pitch.toFixed(3)}`
    );
    lines.push(`remote quat: ${formatQuat(remoteState.quaternion)}`);
    forwardFromQuat(remoteState.quaternion, debugRemoteActual);
    lines.push(
      `remote fwd: ${debugRemoteActual.x.toFixed(3)}, ${debugRemoteActual.y.toFixed(3)}, ${debugRemoteActual.z.toFixed(3)}`
    );
    lines.push(
      `expect fwd: ${debugRemoteExpected.x.toFixed(3)}, ${debugRemoteExpected.y.toFixed(3)}, ${debugRemoteExpected.z.toFixed(3)}`
    );
    if (remoteDot !== null) {
      lines.push(`fwd dot: ${remoteDot.toFixed(3)} angle: ${remoteAngle.toFixed(1)} deg`);
    }
  } else {
    lines.push('');
    lines.push('remote peer: none');
  }

  debugView.overlay.textContent = lines.join('\n');
}

function storeDebugRemoteState(peerId, avatar, yaw, pitch) {
  if (!debugEnabled) {
    return;
  }
  const q = avatar.group.quaternion;
  debugRemoteState.set(peerId, {
    yaw,
    pitch,
    position: {
      x: avatar.group.position.x,
      y: avatar.group.position.y,
      z: avatar.group.position.z
    },
    quaternion: { x: q.x, y: q.y, z: q.z, w: q.w }
  });
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function easeInOutSine(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function startCrouchTransition(targetHeight) {
  if (crouchTargetHeight === targetHeight && !crouchTransitionActive) {
    currentBaseHeight = targetHeight;
    return;
  }

  const now = performance.now();
  if (crouchTransitionActive) {
    const elapsed = (now - crouchStartTime) / 1000;
    const t = clamp01(elapsed / CROUCH_DURATION);
    const eased = easeInOutSine(t);
    currentBaseHeight = THREE.MathUtils.lerp(
      crouchFromHeight,
      crouchTargetHeight,
      eased
    );
  }

  crouchFromHeight = currentBaseHeight;
  crouchTargetHeight = targetHeight;
  crouchStartTime = now;
  crouchTransitionActive = true;
}

function updateCrouchHeight() {
  if (!crouchTransitionActive) {
    currentBaseHeight = crouchTargetHeight;
    return currentBaseHeight;
  }

  const elapsed = (performance.now() - crouchStartTime) / 1000;
  const t = clamp01(elapsed / CROUCH_DURATION);
  const eased = easeInOutSine(t);
  currentBaseHeight = THREE.MathUtils.lerp(
    crouchFromHeight,
    crouchTargetHeight,
    eased
  );

  if (t >= 1) {
    crouchTransitionActive = false;
  }

  return currentBaseHeight;
}

function applyJumpTick() {
  jumpOffset += jumpVelocity;
  jumpVelocity = (jumpVelocity - JUMP_GRAVITY) * JUMP_DRAG;
}

function startJump() {
  moveState.jumping = true;
  jumpVelocity = JUMP_VELOCITY;
  jumpOffset = 0;
  jumpAccumulator = 0;
  applyJumpTick();
}

function updateJumpOffset(delta) {
  if (!moveState.jumping) {
    jumpOffset = 0;
    jumpVelocity = 0;
    jumpAccumulator = 0;
    return 0;
  }

  jumpAccumulator += delta;
  while (jumpAccumulator >= JUMP_TICK) {
    applyJumpTick();
    jumpAccumulator -= JUMP_TICK;

    if (jumpOffset <= 0 && jumpVelocity < 0) {
      moveState.jumping = false;
      jumpOffset = 0;
      jumpVelocity = 0;
      jumpAccumulator = 0;
      break;
    }
  }

  return jumpOffset * JUMP_SCALE;
}

function checkPlatformCollision(x, z, currentY) {
  let highestPlatform = 0;
  for (const platform of platforms) {
    if (
      x >= platform.minX &&
      x <= platform.maxX &&
      z >= platform.minZ &&
      z <= platform.maxZ
    ) {
      if (currentY >= platform.y - 0.5 && platform.y > highestPlatform) {
        highestPlatform = platform.y;
      }
    }
  }
  return highestPlatform;
}

function registerPlatform(mesh, offsetY = 0) {
  const box = new THREE.Box3().setFromObject(mesh);
  platforms.push({
    minX: box.min.x,
    maxX: box.max.x,
    minZ: box.min.z,
    maxZ: box.max.z,
    y: box.max.y + offsetY
  });
}

function setupDisplayName() {
  const savedName = loadStoredName();
  setLocalDisplayName(savedName || '', { sendUpdate: false });
}

function loadStoredName() {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function sanitizeDisplayName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  return trimmed.slice(0, NAME_MAX_LENGTH);
}

function syncNameInputValue(input, value) {
  if (!input) {
    return;
  }
  if (input.value !== value) {
    input.value = value;
  }
}

function setLocalDisplayName(value, options = {}) {
  const { sendUpdate = true, syncInputs = true } = options;
  const sanitized = sanitizeDisplayName(value);
  localDisplayName = sanitized;
  if (syncInputs) {
    syncNameInputValue(nameInput, sanitized);
    syncNameInputValue(nameHudInput, sanitized);
  }
  try {
    if (sanitized) {
      localStorage.setItem(NAME_STORAGE_KEY, sanitized);
    } else {
      localStorage.removeItem(NAME_STORAGE_KEY);
    }
  } catch (err) {
    // Ignore storage errors.
  }
  if (sendUpdate) {
    scheduleNameUpdate();
  }
}

function scheduleNameUpdate() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !hasJoinedRoom) {
    return;
  }
  if (pendingNameTimer) {
    window.clearTimeout(pendingNameTimer);
  }
  pendingNameTimer = window.setTimeout(() => {
    pendingNameTimer = null;
    sendNameUpdate();
  }, 300);
}

function sendNameUpdate() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !hasJoinedRoom) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: 'name-update',
      name: localDisplayName
    })
  );
}

function setPeerName(peerId, name) {
  if (!peerId) {
    return;
  }
  const sanitized = sanitizeDisplayName(name);
  if (sanitized) {
    peerNames.set(peerId, sanitized);
  } else {
    peerNames.delete(peerId);
  }
  const avatar = remoteAvatars.get(peerId);
  if (avatar) {
    updateAvatarNameTag(avatar, sanitized);
  }
  if (selectedPeerId === peerId) {
    updatePopupPeerName(peerId);
  }
}

function updatePopupPeerName(peerId) {
  const name = peerNames.get(peerId);
  popupPeerName.textContent = name || `Peer ${peerId.slice(0, 6)}`;
}

function setupLobby() {
  const params = new URLSearchParams(window.location.search);
  const initialRoom = sanitizeRoomCode(params.get('room') || '');
  setRoomCode(initialRoom || generateLobbyCode(), true);
}

function sanitizeRoomCode(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function generateLobbyCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * ROOM_CHARSET.length);
    code += ROOM_CHARSET[index];
  }
  return code;
}

function setRoomCode(code, updateUrl) {
  const sanitized = sanitizeRoomCode(code);
  if (!sanitized) {
    return;
  }
  roomInput.value = sanitized;
  updateInviteLink(sanitized);
  if (updateUrl) {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('room', sanitized);
    window.history.replaceState({}, '', url);
  }
}

function updateInviteLink(code) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('room', code);
  shareLinkInput.value = url.toString();
}

async function copyToClipboard(text, button) {
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setCopyState(button, 'Copied', true);
  } catch (err) {
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'absolute';
    fallback.style.left = '-9999px';
    document.body.appendChild(fallback);
    fallback.select();
    try {
      document.execCommand('copy');
      setCopyState(button, 'Copied', true);
    } catch (copyErr) {
      setCopyState(button, 'Failed', false);
    }
    document.body.removeChild(fallback);
  }
}

function setCopyState(button, label, isSuccess) {
  if (!button) {
    return;
  }
  const original = button.textContent;
  button.textContent = label;
  if (isSuccess) {
    button.classList.add('copied');
  } else {
    button.classList.remove('copied');
  }
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove('copied');
  }, 1400);
}

function initAudioContext() {
  if (audioContext) {
    return;
  }
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) {
    return;
  }
  audioContext = new Context();
  masterGain = audioContext.createGain();
  masterGain.gain.value = Number(masterVolume.value || 1);
  masterGain.connect(audioContext.destination);
}

async function resumeAudioContext() {
  if (!audioContext || audioContext.state !== 'suspended') {
    return;
  }
  try {
    await audioContext.resume();
  } catch (err) {
    // Ignore resume errors.
  }
}

function createLocalAudioStream(stream) {
  if (!audioContext || !stream) {
    return null;
  }
  localMicSource = audioContext.createMediaStreamSource(stream);
  localMicGain = audioContext.createGain();
  localMicGain.gain.value = isMuted ? 0 : 1;
  localMicDestination = audioContext.createMediaStreamDestination();
  localMicSource.connect(localMicGain).connect(localMicDestination);
  localAudioStream = localMicDestination.stream;
  updateMuteButton();
  return localAudioStream;
}

function updateAudioListenerPosition() {
  if (!audioContext) {
    return;
  }
  const listener = audioContext.listener;
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  camera.getWorldPosition(position);
  camera.getWorldQuaternion(quaternion);

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);

  const time = audioContext.currentTime;
  if (listener.positionX) {
    listener.positionX.setValueAtTime(position.x, time);
    listener.positionY.setValueAtTime(position.y, time);
    listener.positionZ.setValueAtTime(position.z, time);
    listener.forwardX.setValueAtTime(forward.x, time);
    listener.forwardY.setValueAtTime(forward.y, time);
    listener.forwardZ.setValueAtTime(forward.z, time);
    listener.upX.setValueAtTime(up.x, time);
    listener.upY.setValueAtTime(up.y, time);
    listener.upZ.setValueAtTime(up.z, time);
  } else if (listener.setPosition) {
    listener.setPosition(position.x, position.y, position.z);
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

function setupRemoteAudio(peerId, stream, trackId) {
  if (!audioContext || !stream) {
    return;
  }
  const existing = remoteAudioNodes.get(peerId);
  if (existing && existing.trackId === trackId) {
    return;
  }
  if (existing) {
    cleanupPeerAudio(peerId);
  }

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;

  const panner = audioContext.createPanner();
  panner.panningModel = AUDIO_CONFIG.panningModel;
  panner.distanceModel = AUDIO_CONFIG.distanceModel;
  panner.refDistance = AUDIO_CONFIG.refDistance;
  panner.maxDistance = AUDIO_CONFIG.maxDistance;
  panner.rolloffFactor = AUDIO_CONFIG.rolloffFactor;

  const gain = audioContext.createGain();
  gain.gain.value = 1;

  source.connect(analyser).connect(panner).connect(gain).connect(masterGain);

  const nodeState = {
    source,
    analyser,
    panner,
    gain,
    trackId,
    level: 0,
    data: new Uint8Array(analyser.frequencyBinCount),
    volume: 1,
    muted: false,
    prevVolume: 1
  };

  remoteAudioNodes.set(peerId, nodeState);
  syncPeerVolumeUI(peerId);
}

function cleanupPeerAudio(peerId) {
  const node = remoteAudioNodes.get(peerId);
  if (!node) {
    return;
  }
  node.source.disconnect();
  node.analyser.disconnect();
  node.panner.disconnect();
  node.gain.disconnect();
  remoteAudioNodes.delete(peerId);
}

function getAudioLevel(peerId) {
  const node = remoteAudioNodes.get(peerId);
  if (!node) {
    return 0;
  }
  node.analyser.getByteFrequencyData(node.data);
  let sum = 0;
  for (let i = 0; i < node.data.length; i += 1) {
    sum += node.data[i];
  }
  const avg = sum / node.data.length / 255;
  node.level = node.level * 0.85 + avg * 0.15;
  return node.level;
}

function updateSpeakingIndicators() {
  remoteAvatars.forEach((avatar, peerId) => {
    const level = getAudioLevel(peerId);
    if (avatar.boardMaterial) {
      avatar.boardMaterial.emissiveIntensity = Math.min(level * 3.5, 1.6);
    }
    if (avatar.meter) {
      avatar.meter.visible = level > 0.02;
      avatar.meter.scale.x = Math.max(0.08, level * 1.4);
      avatar.meter.material.opacity = 0.3 + level * 0.7;
    }
  });
}

function updatePeerAudioPosition(peerId, position) {
  const node = remoteAudioNodes.get(peerId);
  if (!node || !audioContext) {
    return;
  }
  const time = audioContext.currentTime;
  if (node.panner.positionX) {
    node.panner.positionX.setValueAtTime(position.x, time);
    node.panner.positionY.setValueAtTime(position.y, time);
    node.panner.positionZ.setValueAtTime(position.z, time);
  } else if (node.panner.setPosition) {
    node.panner.setPosition(position.x, position.y, position.z);
  }
}

function setMasterVolume(value) {
  if (masterGain) {
    masterGain.gain.value = value;
  }
}

function toggleLocalMute() {
  if (!localMicGain) {
    return;
  }
  isMuted = !isMuted;
  localMicGain.gain.value = isMuted ? 0 : 1;
  updateMuteButton();
}

function updateMuteButton() {
  if (!muteBtn) {
    return;
  }
  muteBtn.textContent = isMuted ? 'Unmute Mic' : 'Mute Mic';
  muteBtn.classList.toggle('muted', isMuted);
}

function setFaceZoomEnabled(enabled) {
  faceZoomEnabled = Boolean(enabled);
  if (faceZoom) {
    faceZoom.setEnabled(faceZoomEnabled);
  }
  updateFaceZoomButton();
}

function updateFaceZoomButton() {
  if (!faceZoomBtn) {
    return;
  }
  if (!faceZoom) {
    faceZoomBtn.disabled = true;
    faceZoomBtn.classList.remove('active');
    faceZoomBtn.textContent = 'Face Zoom';
    return;
  }
  faceZoomBtn.disabled = false;
  faceZoomBtn.textContent = faceZoomEnabled ? 'Face Zoom On' : 'Face Zoom Off';
  faceZoomBtn.classList.toggle('active', faceZoomEnabled);
}

function setPeerVolume(peerId, value) {
  const node = remoteAudioNodes.get(peerId);
  if (!node) {
    return;
  }
  node.gain.gain.value = value;
  node.volume = value;
  if (value > 0) {
    node.prevVolume = value;
    node.muted = false;
  } else {
    node.muted = true;
  }
}

function togglePeerMute(peerId) {
  const node = remoteAudioNodes.get(peerId);
  if (!node) {
    return;
  }
  if (node.muted) {
    const restore = node.prevVolume || 1;
    setPeerVolume(peerId, restore);
    node.muted = false;
  } else {
    node.prevVolume = node.volume || 1;
    setPeerVolume(peerId, 0);
    node.muted = true;
  }
}

function syncPeerVolumeUI(peerId) {
  if (!selectedPeerId || selectedPeerId !== peerId) {
    return;
  }
  const node = remoteAudioNodes.get(peerId);
  if (!node) {
    return;
  }
  peerVolume.value = node.gain.gain.value.toFixed(2);
  mutePeerBtn.textContent = node.muted ? 'Unmute' : 'Mute';
}

function openVolumePopup(peerId) {
  const avatar = remoteAvatars.get(peerId);
  const node = remoteAudioNodes.get(peerId);
  if (!avatar || !node) {
    hideVolumePopup();
    return;
  }
  selectedPeerId = peerId;
  updatePopupPeerName(peerId);
  peerVolume.value = node.gain.gain.value.toFixed(2);
  mutePeerBtn.textContent = node.muted ? 'Unmute' : 'Mute';
  volumePopup.classList.remove('hidden');
  updateVolumePopupPosition();
}

function hideVolumePopup() {
  selectedPeerId = null;
  volumePopup.classList.add('hidden');
}

function updateVolumePopupPosition() {
  if (!selectedPeerId || volumePopup.classList.contains('hidden')) {
    return;
  }
  const avatar = remoteAvatars.get(selectedPeerId);
  if (!avatar) {
    hideVolumePopup();
    return;
  }
  const worldPos = avatar.group.position.clone();
  worldPos.y += 0.9;
  const projected = worldPos.project(camera);
  const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
  volumePopup.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.Fog(0x1a1a2e, 40, 80);

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    260
  );
  camera.rotation.order = 'YXZ';

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, renderer.domElement);
  controls.getObject().position.set(0, STANDING_HEIGHT, 12);
  scene.add(controls.getObject());

  clock = new THREE.Clock();

  const hemiLight = new THREE.HemisphereLight(0xd7f1ff, 0x4d6b3d, 0.9);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
  sunLight.position.set(30, 40, 20);
  scene.add(sunLight);

  createGrassland();
  createOfficeInterior();
  createJumpingPuzzles();
  createSecrets();
  createOutdoorAccents();
  if (DEBUG_VIEW_DEFAULT) {
    setDebugEnabled(true);
  }

  renderer.domElement.addEventListener('click', () => {
    if (joined && !moveShareMode && !mobileControls.active) {
      controls.lock();
    }
  });

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointerleave', onPointerUp);

  setupMobileControls();

  controls.addEventListener('lock', () => {
    updateControlsHint();
    hideVolumePopup();
  });

  controls.addEventListener('unlock', () => {
    updateControlsHint();
  });

  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

async function joinExperience() {
  setLocalDisplayName(nameInput?.value || nameHudInput?.value || '', {
    sendUpdate: false
  });
  joinBtn.disabled = true;
  statusEl.textContent = 'Requesting camera + mic...';
  initAudioContext();
  await resumeAudioContext();

  try {
    localMediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 320, max: 640 },
        height: { ideal: 240, max: 480 },
        frameRate: { ideal: 24, max: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (err) {
    statusEl.textContent = 'Camera/mic access denied';
    joinBtn.disabled = false;
    return;
  }

  faceZoom = createFaceZoomProcessor(localMediaStream, {
    detectIntervalMs: 80,
    padding: 0.4,
    smoothing: 0.2,
    targetFps: 30
  });
  if (faceZoom && faceZoom.stream) {
    faceZoom.setEnabled(faceZoomEnabled);
    localStream = faceZoom.stream;
    localVideo.srcObject = faceZoom.stream;
  } else {
    faceZoom = null;
    localStream = new MediaStream(localMediaStream.getVideoTracks());
    localVideo.srcObject = localMediaStream;
  }
  playVideoElement(localVideo);
  createLocalAudioStream(localMediaStream);
  overlay.classList.add('hidden');
  joined = true;
  shareBtn.disabled = false;
  muteBtn.disabled = false;
  masterVolume.disabled = false;
  updateFaceZoomButton();
  setMobileControlsActive(mobileControls.supported && !moveShareMode);
  connectSocket();
}

function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const room = sanitizeRoomCode(roomInput.value) || generateLobbyCode();
  setRoomCode(room, true);
  const wsUrl = new URL(`${protocol}://${window.location.host}/ws`);
  wsUrl.searchParams.set('room', room);
  socket = new WebSocket(wsUrl.toString());

  socket.addEventListener('open', () => {
    statusEl.textContent = `Connected to ${room}`;
    socket.send(JSON.stringify({ type: 'join', room, name: localDisplayName }));
    hasJoinedRoom = true;
    if (screenStream && pendingShareStart) {
      sendShareStart();
      pendingShareStart = false;
    }
  });

  socket.addEventListener('message', async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    if (msg.type === 'welcome') {
      myId = msg.id;
      return;
    }

    if (msg.type === 'peers') {
      const names =
        msg.names && typeof msg.names === 'object' ? msg.names : null;
      msg.peers.forEach((peerId) => {
        if (peerId === myId) {
          return;
        }
        ensureRemoteAvatar(peerId);
        if (names && names[peerId]) {
          setPeerName(peerId, names[peerId]);
        }
        createOffer(peerId);
      });
      if (Array.isArray(msg.shares)) {
        msg.shares.forEach((share) => {
          if (share.id && share.id !== myId) {
            handleShareStart(share);
          }
        });
      }
      return;
    }

    if (msg.type === 'peer-joined') {
      if (msg.id && msg.id !== myId) {
        const peerId = msg.id;
        ensureRemoteAvatar(peerId);
        if (msg.name) {
          setPeerName(peerId, msg.name);
        }
        if (localSharePanel && screenStream) {
          const pos = localSharePanel.group.position;
          const poseMsg = PoseMessage.create({
            type: 1,
            x: pos.x,
            y: pos.y,
            z: pos.z,
            timestamp: performance.now() & 0xffffffff
          });
          const buffer = PoseMessage.encode(poseMsg).finish();
          const checkAndSend = () => {
            if (!localSharePanel || !screenStream) {
              return;
            }
            const channel = poseChannels.get(peerId);
            if (channel?.readyState === 'open') {
              channel.send(buffer);
              return;
            }
            setTimeout(checkAndSend, 100);
          };
          setTimeout(checkAndSend, 500);
        }
      }
      return;
    }

    if (msg.type === 'peer-left') {
      cleanupPeer(msg.id);
      return;
    }

    if (msg.type === 'name-update') {
      if (msg.id && msg.id !== myId) {
        setPeerName(msg.id, msg.name || '');
      }
      return;
    }

    if (msg.type === 'share-start') {
      if (msg.id && msg.id !== myId) {
        handleShareStart(msg);
      }
      return;
    }

    if (msg.type === 'share-stop') {
      if (msg.id && msg.id !== myId) {
        handleShareStop(msg.id);
      }
      return;
    }

    if (msg.type === 'offer') {
      await handleOffer(msg.from, msg.sdp);
      return;
    }

    if (msg.type === 'answer') {
      await handleAnswer(msg.from, msg.sdp);
      return;
    }

    if (msg.type === 'ice') {
      await handleIceCandidate(msg.from, msg.candidate);
      return;
    }

  });

  socket.addEventListener('close', () => {
    statusEl.textContent = 'Disconnected';
    hasJoinedRoom = false;
    pendingShareStart = false;
  });
}

function registerPoseChannel(peerId, channel) {
  if (!channel) {
    return;
  }
  channel.binaryType = 'arraybuffer';
  channel.onopen = () => console.log(`Pose channel open: ${peerId}`);
  channel.onmessage = (event) => handlePoseMessage(peerId, event.data);
  channel.onclose = () => {
    if (poseChannels.get(peerId) === channel) {
      poseChannels.delete(peerId);
    }
  };
  poseChannels.set(peerId, channel);
}

function createPeerConnection(peerId, isInitiator = false) {
  if (peerConnections.has(peerId)) {
    return peerConnections.get(peerId);
  }

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  });

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      pc.addTrack(track, localStream);
    });
  }

  if (localAudioStream) {
    localAudioStream.getAudioTracks().forEach((track) => {
      pc.addTrack(track, localAudioStream);
    });
  }

  if (screenStream) {
    screenStream.getVideoTracks().forEach((track) => {
      pc.addTrack(track, screenStream);
    });
  }

  if (isInitiator) {
    const channel = pc.createDataChannel('pose', {
      ordered: false,
      maxRetransmits: 0
    });
    registerPoseChannel(peerId, channel);
  }

  pc.ondatachannel = (event) => {
    if (event.channel.label === 'pose') {
      registerPoseChannel(peerId, event.channel);
    }
  };

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    const track = event.track;
    if (!track) {
      return;
    }

    if (track.kind === 'audio') {
      const audioStream = new MediaStream([track]);
      setupRemoteAudio(peerId, audioStream, track.id);
      return;
    }

    if (!stream || track.kind !== 'video') {
      return;
    }

    let trackMap = remoteTrackStreams.get(peerId);
    if (!trackMap) {
      trackMap = new Map();
      remoteTrackStreams.set(peerId, trackMap);
    }
    trackMap.set(track.id, stream);
    attachRemoteTrack(peerId, track.id, stream);
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({
        type: 'ice',
        to: peerId,
        candidate: event.candidate
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === 'failed' ||
      pc.connectionState === 'disconnected' ||
      pc.connectionState === 'closed'
    ) {
      cleanupPeer(peerId);
    }
  };

  peerConnections.set(peerId, pc);
  return pc;
}

async function createOffer(peerId) {
  const pc = createPeerConnection(peerId, true);
  if (pc.signalingState !== 'stable') {
    return;
  }
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({
    type: 'offer',
    to: peerId,
    sdp: pc.localDescription
  });
}

async function handleOffer(peerId, sdp) {
  if (!peerId || !sdp) {
    return;
  }
  const pc = createPeerConnection(peerId, false);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal({
    type: 'answer',
    to: peerId,
    sdp: pc.localDescription
  });
}

async function handleAnswer(peerId, sdp) {
  const pc = peerConnections.get(peerId);
  if (!pc || !sdp) {
    return;
  }
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleIceCandidate(peerId, candidate) {
  const pc = peerConnections.get(peerId);
  if (!pc || !candidate) {
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn('Failed to add ICE candidate', err);
  }
}

function sendSignal(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function playVideoElement(video) {
  if (!video) {
    return;
  }
  video.onloadedmetadata = () => {
    const playPromise = video.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }
  };
  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}

function createVideoTexture(video) {
  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

function createNameTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(NAME_TAG_WIDTH, NAME_TAG_HEIGHT),
    material
  );
  mesh.position.set(0, NAME_TAG_OFFSET_Y, 0);
  mesh.renderOrder = 999;
  mesh.visible = false;
  return { canvas, ctx, texture, material, mesh };
}

function drawNameTag(tag, name) {
  if (!tag || !tag.ctx) {
    return;
  }
  const { canvas, ctx, texture, mesh } = tag;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!name) {
    mesh.visible = false;
    texture.needsUpdate = true;
    return;
  }

  mesh.visible = true;

  let fontSize = 56;
  ctx.font = `bold ${fontSize}px "Minecraft", "Press Start 2P", monospace, sans-serif`;
  let textWidth = ctx.measureText(name).width;
  while (textWidth > canvas.width - 40 && fontSize > 24) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "Minecraft", "Press Start 2P", monospace, sans-serif`;
    textWidth = ctx.measureText(name).width;
  }

  const padding = 16;
  const bgWidth = textWidth + padding * 2;
  const bgHeight = fontSize + padding;
  const bgX = (canvas.width - bgWidth) / 2;
  const bgY = (canvas.height - bgHeight) / 2;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = 0;
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);
  ctx.shadowColor = 'transparent';

  texture.needsUpdate = true;
}

function updateAvatarNameTag(avatar, name) {
  if (!avatar) {
    return;
  }
  if (!avatar.nameTag) {
    avatar.nameTag = createNameTag();
    avatar.group.add(avatar.nameTag.mesh);
  }
  drawNameTag(avatar.nameTag, name);
}

function updateNameTagBillboards() {
  remoteAvatars.forEach((avatar) => {
    if (avatar.nameTag && avatar.nameTag.mesh.visible) {
      const mesh = avatar.nameTag.mesh;
      mesh.getWorldPosition(nameTagWorldPos);
      mesh.lookAt(camera.position);
    }
  });
}

function attachRemoteTrack(peerId, trackId, stream) {
  const shareMeta = remoteShareMeta.get(peerId);
  if (shareMeta && shareMeta.trackId === trackId) {
    attachRemoteShareStream(peerId, stream);
    return;
  }
  attachRemoteStream(peerId, stream, trackId);
}

function attachRemoteStream(peerId, stream, trackId) {
  const avatar = ensureRemoteAvatar(peerId);
  let video = remoteVideos.get(peerId);

  if (!video) {
    video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    remoteVideos.set(peerId, video);
  }

  video.srcObject = stream;
  playVideoElement(video);
  if (trackId) {
    remoteAvatarTrackIds.set(peerId, trackId);
  }

  if (!avatar.texture) {
    const texture = createVideoTexture(video);
    avatar.texture = texture;
    avatar.screen.material.map = texture;
    avatar.screen.material.color.set(0xffffff);
    avatar.screen.material.needsUpdate = true;
  }
}

function ensureRemoteAvatar(peerId) {
  if (remoteAvatars.has(peerId)) {
    return remoteAvatars.get(peerId);
  }

  const group = new THREE.Group();
  group.rotation.order = 'YXZ';

  const boardMat = new THREE.MeshStandardMaterial({
    color: 0x2f3740,
    roughness: 0.6,
    metalness: 0.1,
    emissive: new THREE.Color(0x36c6b4),
    emissiveIntensity: 0
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.08), boardMat);
  group.add(board);

  const screenMat = new THREE.MeshBasicMaterial({
    color: 0x111111
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), screenMat);
  screen.position.z = 0.041;
  group.add(screen);

  const meterMat = new THREE.MeshBasicMaterial({
    color: 0x36c6b4,
    transparent: true,
    opacity: 0.0
  });
  const meter = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.02), meterMat);
  meter.position.set(0, 0.55, 0.05);
  meter.scale.x = 0.01;
  meter.visible = false;
  group.add(meter);

  scene.add(group);

  const avatar = {
    group,
    screen,
    texture: null,
    boardMaterial: boardMat,
    meter,
    hitbox: board,
    nameTag: null
  };

  board.userData.peerId = peerId;

  remoteAvatars.set(peerId, avatar);
  const knownName = peerNames.get(peerId);
  if (knownName) {
    updateAvatarNameTag(avatar, knownName);
  }
  return avatar;
}

function updateRemotePose(peerId, position, rotation) {
  const avatar = ensureRemoteAvatar(peerId);
  avatar.group.position.set(position.x, position.y, position.z);
  avatar.group.rotation.set(rotation.x || 0, (rotation.y || 0) + Math.PI, 0);
  updatePeerAudioPosition(peerId, avatar.group.position);
}

function cleanupPeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) {
    pc.close();
    peerConnections.delete(peerId);
  }

  const avatar = remoteAvatars.get(peerId);
  if (avatar) {
    if (avatar.texture) {
      avatar.texture.dispose();
    }
    if (avatar.nameTag) {
      avatar.nameTag.texture.dispose();
      avatar.nameTag.material.dispose();
      avatar.nameTag.mesh.geometry.dispose();
    }
    scene.remove(avatar.group);
    remoteAvatars.delete(peerId);
  }

  cleanupPeerAudio(peerId);

  const video = remoteVideos.get(peerId);
  if (video) {
    video.srcObject = null;
    remoteVideos.delete(peerId);
  }

  const sharePanel = remoteSharePanels.get(peerId);
  if (sharePanel) {
    if (sharePanel.texture) {
      sharePanel.texture.dispose();
    }
    scene.remove(sharePanel.group);
    remoteSharePanels.delete(peerId);
  }

  const shareVideo = remoteShareVideos.get(peerId);
  if (shareVideo) {
    shareVideo.srcObject = null;
    remoteShareVideos.delete(peerId);
  }

  remoteShareMeta.delete(peerId);
  remoteTrackStreams.delete(peerId);
  remoteAvatarTrackIds.delete(peerId);
  peerNames.delete(peerId);
  const channel = poseChannels.get(peerId);
  if (channel) {
    channel.close();
    poseChannels.delete(peerId);
  }
  poseInterpolators.delete(peerId);
  debugRemoteState.delete(peerId);
  if (selectedPeerId === peerId) {
    hideVolumePopup();
  }
}

async function startScreenShare() {
  if (screenStream) {
    return;
  }

  shareBtn.disabled = true;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { max: 1280 },
        height: { max: 720 },
        frameRate: { ideal: 20, max: 30 }
      },
      audio: false
    });
  } catch (err) {
    shareBtn.disabled = false;
    return;
  }

  const [track] = screenStream.getVideoTracks();
  if (!track) {
    stopScreenShare();
    return;
  }

  screenTrackId = track.id;
  try {
    await track.applyConstraints({
      width: 1280,
      height: 720,
      frameRate: 20
    });
  } catch (err) {
    // Ignore unsupported constraints.
  }
  track.onended = () => {
    stopScreenShare();
  };

  if (!localSharePanel) {
    localSharePanel = createSharePanel();
  }
  if (!localSharePanel.group.parent) {
    scene.add(localSharePanel.group);
  }
  positionLocalSharePanel();
  attachLocalShareStream(screenStream);

  shareBtn.textContent = 'Stop Share';
  shareBtn.disabled = false;
  moveShareBtn.disabled = false;

  sendShareStart();

  peerConnections.forEach((pc, peerId) => {
    const alreadyAdded = pc
      .getSenders()
      .some((sender) => sender.track && sender.track.id === screenTrackId);
    if (!alreadyAdded) {
      pc.addTrack(track, screenStream);
      createOffer(peerId);
    }
  });
}

function stopScreenShare() {
  if (!screenStream) {
    return;
  }

  const previousTrackId = screenTrackId;
  screenStream.getTracks().forEach((track) => track.stop());
  screenStream = null;
  screenTrackId = null;
  pendingShareStart = false;

  if (localSharePanel) {
    localSharePanel.group.removeFromParent();
    if (localSharePanel.texture) {
      localSharePanel.texture.dispose();
      localSharePanel.texture = null;
    }
    if (localSharePanel.video) {
      localSharePanel.video.srcObject = null;
      localSharePanel.video = null;
    }
    localSharePanel.screen.material.map = null;
    localSharePanel.screen.material.color.set(0x0d0f12);
    localSharePanel.screen.material.needsUpdate = true;
  }

  if (moveShareMode) {
    toggleMoveShare(false);
  }

  moveShareBtn.disabled = true;
  shareBtn.textContent = 'Share Screen';
  shareBtn.disabled = false;

  sendShareStop();

  peerConnections.forEach((pc, peerId) => {
    const sender = pc
      .getSenders()
      .find((entry) => entry.track && entry.track.id === previousTrackId);
    if (sender) {
      pc.removeTrack(sender);
      createOffer(peerId);
    }
  });
}

function toggleMoveShare(forceState) {
  const nextState = typeof forceState === 'boolean' ? forceState : !moveShareMode;
  if (nextState === moveShareMode) {
    return;
  }

  moveShareMode = nextState;
  moveShareBtn.classList.toggle('active', moveShareMode);
  moveShareBtn.textContent = moveShareMode ? 'Done Moving' : 'Move Screen';
  renderer.domElement.style.cursor = moveShareMode ? 'grab' : 'default';

  if (moveShareMode) {
    wasLockedBeforeMove = controls.isLocked;
    if (controls.isLocked) {
      controls.unlock();
    }
    hideVolumePopup();
  } else {
    if (wasLockedBeforeMove) {
      controls.lock();
    }
  }
  setMobileControlsActive(joined && !moveShareMode && mobileControls.supported);
  updateControlsHint();
}

function sendShareStart() {
  if (!screenTrackId || !localSharePanel) {
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    pendingShareStart = true;
    return;
  }
  if (!hasJoinedRoom) {
    pendingShareStart = true;
    return;
  }

  const pos = localSharePanel.group.position;
  socket.send(
    JSON.stringify({
      type: 'share-start',
      trackId: screenTrackId,
      position: { x: pos.x, y: pos.y, z: pos.z }
    })
  );

  lastSharePosition.copy(pos);
  lastShareSent = performance.now();
  pendingShareStart = false;
}

function sendShareStop() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify({ type: 'share-stop' }));
}

function sendScreenPose(force) {
  if (!localSharePanel) {
    return;
  }

  const now = performance.now();
  const pos = localSharePanel.group.position;
  const moved = pos.distanceTo(lastSharePosition) > 0.02;

  if (!force && (!moved || now - lastShareSent < 80)) {
    return;
  }

  lastSharePosition.copy(pos);
  lastShareSent = now;

  const poseMsg = PoseMessage.create({
    type: 1,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    timestamp: performance.now() & 0xffffffff
  });
  const buffer = PoseMessage.encode(poseMsg).finish();
  poseChannels.forEach((channel) => {
    if (channel.readyState === 'open') {
      channel.send(buffer);
    }
  });
}

function handleShareStart(share) {
  if (!share || !share.id || !share.trackId) {
    return;
  }

  remoteShareMeta.set(share.id, { trackId: share.trackId });
  const panel = ensureRemoteSharePanel(share.id);
  if (share.position) {
    panel.group.position.set(share.position.x, share.position.y, share.position.z);
  }

  const trackMap = remoteTrackStreams.get(share.id);
  if (trackMap && trackMap.has(share.trackId)) {
    attachRemoteShareStream(share.id, trackMap.get(share.trackId));
  }

  if (remoteAvatarTrackIds.get(share.id) === share.trackId) {
    remoteAvatarTrackIds.delete(share.id);
    resetAvatarScreen(share.id);
    const avatarVideo = remoteVideos.get(share.id);
    if (avatarVideo) {
      avatarVideo.srcObject = null;
    }
    if (trackMap) {
      for (const [trackId, stream] of trackMap.entries()) {
        if (trackId !== share.trackId) {
          attachRemoteStream(share.id, stream, trackId);
          break;
        }
      }
    }
  }
}

function handleShareStop(peerId) {
  remoteShareMeta.delete(peerId);

  const panel = remoteSharePanels.get(peerId);
  if (panel) {
    panel.group.removeFromParent();
    if (panel.texture) {
      panel.texture.dispose();
      panel.texture = null;
    }
    panel.screen.material.map = null;
    panel.screen.material.color.set(0x0d0f12);
    panel.screen.material.needsUpdate = true;
    remoteSharePanels.delete(peerId);
  }

  const shareVideo = remoteShareVideos.get(peerId);
  if (shareVideo) {
    shareVideo.srcObject = null;
    remoteShareVideos.delete(peerId);
  }
}

function updateRemoteSharePose(peerId, position) {
  if (!remoteShareMeta.has(peerId)) {
    return;
  }
  const panel = ensureRemoteSharePanel(peerId);
  panel.group.position.set(position.x, position.y, position.z);
}

function handlePoseMessage(peerId, data) {
  if (!data) {
    return;
  }
  let msg;
  try {
    msg = PoseMessage.decode(new Uint8Array(data));
  } catch (err) {
    return;
  }

  if (msg.type === 0) {
    console.log('[POSE RX] from:', peerId.slice(0, 6), 'yaw:', msg.yaw?.toFixed(3), 'pitch:', msg.pitch?.toFixed(3));
    let interp = poseInterpolators.get(peerId);
    if (!interp) {
      interp = { poses: [], maxPoses: 5 };
      poseInterpolators.set(peerId, interp);
    }
    interp.poses.push({ pose: msg, time: performance.now() });
    if (interp.poses.length > interp.maxPoses) {
      interp.poses.shift();
    }
    return;
  }

  if (msg.type === 1) {
    updateRemoteSharePose(peerId, { x: msg.x, y: msg.y, z: msg.z });
  }
}

function updateInterpolatedAvatars() {
  const now = performance.now();
  const bufferMs = 100;

  function setAvatarRotationFromPose(avatar, yaw, pitch) {
    avatarQuatFacingCamera(
      yaw || 0,
      pitch || 0,
      avatarQuatOut,
      avatarYawQuat,
      avatarPitchQuat
    );
    avatar.group.quaternion.set(
      avatarQuatOut.x,
      avatarQuatOut.y,
      avatarQuatOut.z,
      avatarQuatOut.w
    );
  }

  remoteAvatars.forEach((avatar, peerId) => {
    const interp = poseInterpolators.get(peerId);
    if (!interp || interp.poses.length === 0) {
      return;
    }

    if (interp.poses.length === 1) {
      const p = interp.poses[0].pose;
      avatar.group.position.set(p.x, p.y, p.z);
      setAvatarRotationFromPose(avatar, p.yaw, p.pitch);
      storeDebugRemoteState(peerId, avatar, p.yaw || 0, p.pitch || 0);
      updatePeerAudioPosition(peerId, avatar.group.position);
      return;
    }

    const targetTime = now - bufferMs;
    let p0 = interp.poses[0];
    let p1 = interp.poses[1];
    for (let i = 1; i < interp.poses.length; i += 1) {
      if (interp.poses[i].time > targetTime) {
        p0 = interp.poses[i - 1];
        p1 = interp.poses[i];
        break;
      }
      p0 = interp.poses[i];
      p1 = interp.poses[i];
    }

    const span = p1.time - p0.time || 1;
    const t = Math.max(0, Math.min(1, (targetTime - p0.time) / span));
    const x = p0.pose.x + (p1.pose.x - p0.pose.x) * t;
    const y = p0.pose.y + (p1.pose.y - p0.pose.y) * t;
    const z = p0.pose.z + (p1.pose.z - p0.pose.z) * t;
    const yaw = lerpAngle(p0.pose.yaw, p1.pose.yaw, t);
    const pitch = p0.pose.pitch + (p1.pose.pitch - p0.pose.pitch) * t;

    avatar.group.position.set(x, y, z);
    setAvatarRotationFromPose(avatar, yaw, pitch);
    storeDebugRemoteState(peerId, avatar, yaw, pitch);
    updatePeerAudioPosition(peerId, avatar.group.position);
  });
}

function resetAvatarScreen(peerId) {
  const avatar = remoteAvatars.get(peerId);
  if (!avatar) {
    return;
  }
  if (avatar.texture) {
    avatar.texture.dispose();
  }
  avatar.texture = null;
  avatar.screen.material.map = null;
  avatar.screen.material.color.set(0x111111);
  avatar.screen.material.needsUpdate = true;
}

function attachRemoteShareStream(peerId, stream) {
  const panel = ensureRemoteSharePanel(peerId);
  let video = remoteShareVideos.get(peerId);

  if (!video) {
    video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    remoteShareVideos.set(peerId, video);
  }

  video.srcObject = stream;
  playVideoElement(video);

  if (!panel.texture) {
    const texture = createVideoTexture(video);
    panel.texture = texture;
    panel.screen.material.map = texture;
    panel.screen.material.color.set(0xffffff);
    panel.screen.material.needsUpdate = true;
  }
}

function attachLocalShareStream(stream) {
  if (!localSharePanel) {
    return;
  }

  if (!localSharePanel.video) {
    localSharePanel.video = document.createElement('video');
    localSharePanel.video.autoplay = true;
    localSharePanel.video.playsInline = true;
    localSharePanel.video.muted = true;
  }

  localSharePanel.video.srcObject = stream;
  playVideoElement(localSharePanel.video);

  if (!localSharePanel.texture) {
    const texture = createVideoTexture(localSharePanel.video);
    localSharePanel.texture = texture;
    localSharePanel.screen.material.map = texture;
    localSharePanel.screen.material.color.set(0xffffff);
    localSharePanel.screen.material.needsUpdate = true;
  }
}

function ensureRemoteSharePanel(peerId) {
  if (remoteSharePanels.has(peerId)) {
    return remoteSharePanels.get(peerId);
  }

  const panel = createSharePanel();
  panel.group.position.set(0, 2.2, 4);
  scene.add(panel.group);
  remoteSharePanels.set(peerId, panel);
  return panel;
}

function createSharePanel() {
  const group = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x1f2a32,
    roughness: 0.6,
    metalness: 0.2
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.12), frameMat);
  group.add(frame);

  const screenMat = new THREE.MeshBasicMaterial({
    color: 0x0d0f12
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), screenMat);
  screen.position.z = 0.07;
  group.add(screen);

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x31363b,
    roughness: 0.8
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 0.18, 8), baseMat);
  base.position.set(0, -1.3, 0);
  group.add(base);

  return {
    group,
    screen,
    texture: null,
    video: null,
    hitbox: frame
  };
}

function positionLocalSharePanel() {
  if (!localSharePanel) {
    return;
  }
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const base = controls.getObject().position.clone().add(forward.multiplyScalar(4));
  base.y = 2.2;
  localSharePanel.group.position.copy(base);
}

function updateShareFacing() {
  if (localSharePanel) {
    shareFacingTarget.set(
      camera.position.x,
      localSharePanel.group.position.y,
      camera.position.z
    );
    orientPanelToCamera(localSharePanel, shareFacingTarget);
  }

  remoteSharePanels.forEach((panel) => {
    shareFacingTarget.set(camera.position.x, panel.group.position.y, camera.position.z);
    orientPanelToCamera(panel, shareFacingTarget);
  });
}

function orientPanelToCamera(panel, target) {
  panel.group.lookAt(target);
  panel.group.rotateY(Math.PI);
}

function getAvatarHit(event) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hitboxes = [];
  remoteAvatars.forEach((avatar) => {
    if (avatar.hitbox) {
      hitboxes.push(avatar.hitbox);
    }
  });
  const hits = raycaster.intersectObjects(hitboxes, false);
  if (!hits.length) {
    return null;
  }
  const hit = hits[0].object;
  return hit.userData.peerId || null;
}

function onPointerDown(event) {
  if (moveShareMode) {
    if (!localSharePanel) {
      return;
    }
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(localSharePanel.hitbox, true);
    if (!hits.length) {
      return;
    }

    draggingShare = true;
    shareDragPlane.constant = -localSharePanel.group.position.y;
    if (raycaster.ray.intersectPlane(shareDragPlane, shareDragPoint)) {
      shareDragOffset.copy(localSharePanel.group.position).sub(shareDragPoint);
    } else {
      shareDragOffset.set(0, 0, 0);
    }
    renderer.domElement.style.cursor = 'grabbing';
    return;
  }

  if (!joined || controls.isLocked) {
    hideVolumePopup();
    return;
  }

  const hit = getAvatarHit(event);
  if (hit) {
    openVolumePopup(hit);
  } else {
    hideVolumePopup();
  }
}

function onPointerMove(event) {
  if (!draggingShare || !localSharePanel) {
    return;
  }
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(shareDragPlane, shareDragPoint)) {
    localSharePanel.group.position.copy(shareDragPoint.add(shareDragOffset));
    localSharePanel.group.position.y = Math.max(1.4, localSharePanel.group.position.y);
    sendScreenPose();
  }
}

function onPointerUp() {
  if (!draggingShare) {
    return;
  }
  draggingShare = false;
  renderer.domElement.style.cursor = moveShareMode ? 'grab' : 'default';
  sendScreenPose(true);
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function isTouchOnlyDevice() {
  if (!window.matchMedia) {
    return false;
  }
  return (
    window.matchMedia('(pointer: coarse)').matches &&
    window.matchMedia('(hover: none)').matches
  );
}

function updateControlsHint() {
  if (moveShareMode) {
    controlsHint.textContent = 'Drag the screen to move it';
    return;
  }
  if (mobileControls.active) {
    controlsHint.textContent = 'Left stick to move - Right stick to look';
    return;
  }
  controlsHint.textContent = controls.isLocked
    ? 'WASD to move - ESC to release'
    : 'Click to look around';
}

function setMobileControlsActive(active) {
  if (!mobileControls.supported || !mobileControls.el) {
    return;
  }
  const next = Boolean(active);
  if (next === mobileControls.active) {
    return;
  }
  mobileControls.active = next;
  mobileControls.el.classList.toggle('active', next);
  document.body.classList.toggle('mobile-active', next);
  if (!next) {
    mobileControls.move.set(0, 0);
    mobileControls.look.set(0, 0);
  }
  updateControlsHint();
}

function applyJoystickVector(target, data, deadzone, invertY) {
  if (!data || !data.vector) {
    target.set(0, 0);
    return;
  }
  let x = data.vector.x || 0;
  let y = data.vector.y || 0;
  if (invertY) {
    y = -y;
  }
  const len = Math.hypot(x, y);
  if (len < deadzone) {
    target.set(0, 0);
    return;
  }
  target.set(x, y);
}

function bindHoldButton(button, onDown, onUp) {
  if (!button) {
    return;
  }
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.setPointerCapture) {
      button.setPointerCapture(event.pointerId);
    }
    onDown();
  });
  if (!onUp) {
    return;
  }
  const release = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (
      button.releasePointerCapture &&
      button.hasPointerCapture &&
      button.hasPointerCapture(event.pointerId)
    ) {
      button.releasePointerCapture(event.pointerId);
    }
    onUp();
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

function setupMobileControls() {
  if (!mobileControls.el || !mobileControls.moveZone || !mobileControls.lookZone) {
    return;
  }
  if (!window.nipplejs || !isTouchOnlyDevice()) {
    return;
  }

  mobileControls.supported = true;
  const stickSize = mobileControls.moveZone.clientWidth || 120;

  mobileControls.left = window.nipplejs.create({
    zone: mobileControls.moveZone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#f2b24d',
    size: stickSize,
    restOpacity: 0.4
  });

  mobileControls.left.on('move', (evt, data) => {
    applyJoystickVector(mobileControls.move, data, MOBILE_MOVE_DEADZONE, false);
  });
  mobileControls.left.on('end', () => {
    mobileControls.move.set(0, 0);
  });

  mobileControls.right = window.nipplejs.create({
    zone: mobileControls.lookZone,
    mode: 'static',
    position: { left: '50%', top: '50%' },
    color: '#2bb3a7',
    size: stickSize,
    restOpacity: 0.4
  });

  mobileControls.right.on('move', (evt, data) => {
    applyJoystickVector(mobileControls.look, data, MOBILE_LOOK_DEADZONE, false);
  });
  mobileControls.right.on('end', () => {
    mobileControls.look.set(0, 0);
  });

  bindHoldButton(mobileControls.jumpBtn, () => {
    if (!joined || moveState.jumping) {
      return;
    }
    startJump();
  });

  bindHoldButton(
    mobileControls.crouchBtn,
    () => {
      if (!joined || moveState.crouch) {
        return;
      }
      moveState.crouch = true;
      startCrouchTransition(CROUCH_HEIGHT);
    },
    () => {
      if (!joined || !moveState.crouch) {
        return;
      }
      moveState.crouch = false;
      startCrouchTransition(STANDING_HEIGHT);
    }
  );
}

function applyMobileLook(delta) {
  if (!mobileControls.active || controls.isLocked) {
    return;
  }
  if (
    Math.abs(mobileControls.look.x) < 0.001 &&
    Math.abs(mobileControls.look.y) < 0.001
  ) {
    return;
  }
  mobileLookEuler.setFromQuaternion(camera.quaternion);
  mobileLookEuler.y -= mobileControls.look.x * MOBILE_LOOK_SPEED * delta;
  mobileLookEuler.x += mobileControls.look.y * MOBILE_LOOK_SPEED_PITCH * delta;
  mobileLookEuler.x = clampPitchRad(mobileLookEuler.x);
  mobileLookEuler.z = 0;
  camera.quaternion.setFromEuler(mobileLookEuler);
}

function maybeSendPose() {
  if (!joined) {
    return;
  }

  const now = performance.now();
  if (now - lastPoseSent < 100) {
    return;
  }

  const pos = controls.getObject().position;
  camera.getWorldDirection(cameraForward);
  yawPitchFromCameraForward(cameraForward, cameraYawPitch);
  const yaw = normalizeAngleRad(cameraYawPitch.yaw);
  const pitch = clampPitchRad(cameraYawPitch.pitch);

  const moved = pos.distanceTo(lastPose.position) > 0.02;
  const rotated =
    Math.abs(yaw - lastPose.yaw) > 0.01 ||
    Math.abs(pitch - lastPose.pitch) > 0.01;

  if (!moved && !rotated) {
    return;
  }

  lastPose.position.copy(pos);
  lastPose.yaw = yaw;
  lastPose.pitch = pitch;
  lastPoseSent = now;

  // Log raw camera quaternion for debugging
  const q = camera.getWorldQuaternion(new THREE.Quaternion());
  console.log('[POSE TX] yaw:', yaw.toFixed(3), 'pitch:', pitch.toFixed(3), 'quat:', q.x.toFixed(3), q.y.toFixed(3), q.z.toFixed(3), q.w.toFixed(3));

  const poseMsg = PoseMessage.create({
    type: 0,
    x: pos.x,
    y: currentHeight,
    z: pos.z,
    yaw,
    pitch,
    flags: moveState.crouch ? 1 : 0,
    timestamp: performance.now() & 0xffffffff
  });
  const buffer = PoseMessage.encode(poseMsg).finish();
  poseChannels.forEach((channel) => {
    if (channel.readyState === 'open') {
      channel.send(buffer);
    }
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  let jumpOffset = updateJumpOffset(delta);
  applyMobileLook(delta);

  const canMove = joined && (controls.isLocked || mobileControls.active);
  if (canMove) {
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    let inputX = 0;
    let inputZ = 0;
    let inputScale = 1;

    if (mobileControls.active) {
      inputX = mobileControls.move.x;
      inputZ = mobileControls.move.y;
      inputScale = Math.min(1, Math.hypot(inputX, inputZ));
    } else {
      inputX = Number(moveState.right) - Number(moveState.left);
      inputZ = Number(moveState.forward) - Number(moveState.backward);
    }

    direction.set(inputX, 0, inputZ);
    const moving = direction.lengthSq() > 0.0001;

    if (moving) {
      direction.normalize();
      const speed = 32.0 * inputScale;
      velocity.z -= direction.z * speed * delta;
      velocity.x -= direction.x * speed * delta;
    }

    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);

    const pos = controls.getObject().position;
    const platformHeight = checkPlatformCollision(pos.x, pos.z, pos.y);

    if (platformHeight > 0 && !moveState.jumping) {
      currentPlatformHeight = platformHeight;
    } else if (platformHeight === 0 && !moveState.jumping) {
      currentPlatformHeight = 0;
    }

    let targetHeight = updateCrouchHeight();
    targetHeight += jumpOffset + currentPlatformHeight;

    if (moveState.jumping && jumpVelocity < 0) {
      const newPlatformCheck = checkPlatformCollision(pos.x, pos.z, pos.y);
      if (newPlatformCheck > 0 && pos.y <= newPlatformCheck + STANDING_HEIGHT + 0.1) {
        moveState.jumping = false;
        jumpOffset = 0;
        jumpVelocity = 0;
        currentPlatformHeight = newPlatformCheck;
        targetHeight = updateCrouchHeight() + currentPlatformHeight;
      }
    }

    currentHeight = targetHeight;
    controls.getObject().position.y = currentHeight;
  }

  updateAudioListenerPosition();
  updateInterpolatedAvatars();
  updateNameTagBillboards();
  updateShareFacing();
  updateSpeakingIndicators();
  updateVolumePopupPosition();
  updateDebugView();
  maybeSendPose();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
  if (event.code === 'F3') {
    if (event.repeat) {
      return;
    }
    toggleDebugView();
    event.preventDefault();
    return;
  }

  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      moveState.forward = true;
      break;
    case 'KeyS':
    case 'ArrowDown':
      moveState.backward = true;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      moveState.left = true;
      break;
    case 'KeyD':
    case 'ArrowRight':
      moveState.right = true;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'ControlLeft':
    case 'ControlRight':
      if (!moveState.crouch) {
        moveState.crouch = true;
        startCrouchTransition(CROUCH_HEIGHT);
      }
      break;
    case 'Space':
      if (!moveState.jumping) {
        startJump();
      }
      break;
    default:
      break;
  }
}

function onKeyUp(event) {
  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      moveState.forward = false;
      break;
    case 'KeyS':
    case 'ArrowDown':
      moveState.backward = false;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      moveState.left = false;
      break;
    case 'KeyD':
    case 'ArrowRight':
      moveState.right = false;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'ControlLeft':
    case 'ControlRight':
      if (moveState.crouch) {
        moveState.crouch = false;
        startCrouchTransition(STANDING_HEIGHT);
      }
      break;
    default:
      break;
  }
}

function createGrassland() {
  // No outdoor grassland - we're fully enclosed in the SF office
}

function createSkylineBackdrop() {
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');

  // Gradient sky - SF golden hour with more color bands
  const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  skyGrad.addColorStop(0, '#0a0a1a');
  skyGrad.addColorStop(0.15, '#1a1a3e');
  skyGrad.addColorStop(0.3, '#2d1b4e');
  skyGrad.addColorStop(0.45, '#6b2d5b');
  skyGrad.addColorStop(0.55, '#d4456a');
  skyGrad.addColorStop(0.65, '#ff6b4a');
  skyGrad.addColorStop(0.75, '#ffaa33');
  skyGrad.addColorStop(0.85, '#ffd066');
  skyGrad.addColorStop(1, '#ffe599');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Atmospheric haze layers
  for (let i = 0; i < 5; i++) {
    const y = canvas.height * (0.5 + i * 0.08);
    const hazeGrad = ctx.createLinearGradient(0, y - 40, 0, y + 40);
    hazeGrad.addColorStop(0, 'rgba(255, 200, 150, 0)');
    hazeGrad.addColorStop(0.5, `rgba(255, 180, 120, ${0.08 - i * 0.01})`);
    hazeGrad.addColorStop(1, 'rgba(255, 200, 150, 0)');
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(0, y - 40, canvas.width, 80);
  }

  // SF Bay water with gradient reflection
  const waterGrad = ctx.createLinearGradient(0, canvas.height * 0.78, 0, canvas.height);
  waterGrad.addColorStop(0, 'rgba(255, 180, 100, 0.4)');
  waterGrad.addColorStop(0.3, 'rgba(40, 80, 120, 0.7)');
  waterGrad.addColorStop(1, 'rgba(15, 30, 60, 0.9)');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, canvas.height * 0.78, canvas.width, canvas.height * 0.22);

  // Water shimmer
  ctx.strokeStyle = 'rgba(255, 220, 150, 0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * canvas.width;
    const y = canvas.height * 0.78 + Math.random() * canvas.height * 0.22;
    const len = 20 + Math.random() * 60;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }

  // Distant mountains (Marin headlands) with depth
  const mountainLayers = [
    { offset: 0.62, color: '#1a1a2a', points: [0, 0.62, 300, 0.52, 600, 0.58, 900, 0.48, 1200, 0.55, 1500, 0.50, 1800, 0.56, 2100, 0.52, 2400, 0.58, 2700, 0.54, 3000, 0.60, 3300, 0.55, 3600, 0.58, 3900, 0.54, 4096, 0.60] },
    { offset: 0.68, color: '#252535', points: [0, 0.68, 250, 0.60, 500, 0.65, 800, 0.58, 1100, 0.64, 1400, 0.59, 1700, 0.66, 2000, 0.61, 2300, 0.67, 2600, 0.62, 2900, 0.68, 3200, 0.63, 3500, 0.66, 3800, 0.61, 4096, 0.68] },
  ];

  mountainLayers.forEach((layer) => {
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, canvas.height * layer.points[1]);
    for (let i = 2; i < layer.points.length; i += 2) {
      ctx.lineTo(layer.points[i], canvas.height * layer.points[i + 1]);
    }
    ctx.lineTo(canvas.width, canvas.height * 0.78);
    ctx.lineTo(0, canvas.height * 0.78);
    ctx.closePath();
    ctx.fill();
  });

  // SF Downtown skyline - more buildings with varied styles
  const buildingData = [
    { x: 80, w: 70, h: 200, style: 'modern' },
    { x: 170, w: 90, h: 320, style: 'glass' },
    { x: 280, w: 60, h: 260, style: 'modern' },
    { x: 360, w: 55, h: 240, style: 'art-deco' },
    { x: 440, w: 120, h: 520, style: 'salesforce' },
    { x: 580, w: 80, h: 380, style: 'glass' },
    { x: 680, w: 100, h: 420, style: 'modern' },
    { x: 800, w: 70, h: 340, style: 'glass' },
    { x: 890, w: 90, h: 400, style: 'modern' },
    { x: 1000, w: 50, h: 280, style: 'art-deco' },
    { x: 1070, w: 110, h: 460, style: 'glass' },
    { x: 1200, w: 80, h: 360, style: 'modern' },
    { x: 1300, w: 95, h: 400, style: 'glass' },
    { x: 1420, w: 70, h: 320, style: 'modern' },
    { x: 1510, w: 85, h: 380, style: 'art-deco' },
    { x: 1620, w: 100, h: 440, style: 'glass' },
    { x: 1740, w: 75, h: 340, style: 'modern' },
    { x: 1840, w: 90, h: 400, style: 'glass' },
    { x: 1950, w: 65, h: 300, style: 'modern' },
    { x: 2040, w: 110, h: 480, style: 'glass' },
    { x: 2170, w: 80, h: 360, style: 'art-deco' },
    { x: 2270, w: 95, h: 420, style: 'modern' },
    { x: 2390, w: 70, h: 320, style: 'glass' },
    { x: 2480, w: 100, h: 440, style: 'modern' },
    { x: 2600, w: 85, h: 380, style: 'glass' },
    { x: 2710, w: 75, h: 340, style: 'art-deco' },
    { x: 2810, w: 110, h: 460, style: 'glass' },
    { x: 2940, w: 80, h: 360, style: 'modern' },
    { x: 3040, w: 95, h: 400, style: 'glass' },
    { x: 3160, w: 70, h: 320, style: 'modern' },
    { x: 3250, w: 100, h: 440, style: 'glass' },
    { x: 3370, w: 85, h: 380, style: 'art-deco' },
    { x: 3480, w: 90, h: 400, style: 'modern' },
    { x: 3590, w: 75, h: 340, style: 'glass' },
    { x: 3690, w: 110, h: 480, style: 'glass' },
    { x: 3820, w: 80, h: 360, style: 'modern' },
    { x: 3920, w: 95, h: 420, style: 'glass' },
    { x: 4030, w: 60, h: 280, style: 'art-deco' },
  ];

  const baseY = canvas.height * 0.78;

  buildingData.forEach((b) => {
    // Building base with slight gradient
    const buildGrad = ctx.createLinearGradient(b.x, baseY - b.h, b.x, baseY);
    if (b.style === 'glass') {
      buildGrad.addColorStop(0, '#1a2a3a');
      buildGrad.addColorStop(1, '#0a1520');
    } else if (b.style === 'salesforce') {
      buildGrad.addColorStop(0, '#2a3a4a');
      buildGrad.addColorStop(1, '#151f2a');
    } else {
      buildGrad.addColorStop(0, '#151520');
      buildGrad.addColorStop(1, '#0a0a10');
    }
    ctx.fillStyle = buildGrad;
    ctx.fillRect(b.x, baseY - b.h, b.w, b.h);

    // Window grids with varied colors
    const windowColors = ['#ffeaa7', '#ffe066', '#fff5cc', '#ffd700', '#ffffff'];
    const windowRows = Math.floor(b.h / 12);
    const windowCols = Math.floor(b.w / 10);
    for (let row = 0; row < windowRows; row++) {
      for (let col = 0; col < windowCols; col++) {
        if (Math.random() > 0.35) {
          const brightness = Math.random();
          if (brightness > 0.7) {
            ctx.fillStyle = windowColors[Math.floor(Math.random() * windowColors.length)];
            ctx.globalAlpha = 0.6 + Math.random() * 0.4;
          } else {
            ctx.fillStyle = '#ffeaa7';
            ctx.globalAlpha = 0.3 + Math.random() * 0.3;
          }
          ctx.fillRect(b.x + 3 + col * 10, baseY - b.h + 6 + row * 12, 5, 7);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Building edge highlights
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x, baseY - b.h, b.w, b.h);
  });

  // Transamerica pyramid with detail
  ctx.fillStyle = '#0f0f20';
  ctx.beginPath();
  ctx.moveTo(1800, baseY);
  ctx.lineTo(1720, baseY);
  ctx.lineTo(1760, baseY - 580);
  ctx.lineTo(1800, baseY);
  ctx.fill();

  // Pyramid windows
  ctx.fillStyle = '#ffeaa7';
  for (let row = 0; row < 35; row++) {
    const rowY = baseY - 50 - row * 15;
    const rowWidth = 80 - row * 2;
    const startX = 1760 - rowWidth / 2;
    for (let col = 0; col < Math.floor(rowWidth / 12); col++) {
      if (Math.random() > 0.4) {
        ctx.globalAlpha = 0.4 + Math.random() * 0.5;
        ctx.fillRect(startX + col * 12, rowY, 5, 8);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Golden Gate Bridge with more detail
  const bridgeX = 100;
  const bridgeY = baseY - 120;

  // Tower shadows
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.fillRect(bridgeX + 10, bridgeY + 20, 30, 180);
  ctx.fillRect(bridgeX + 410, bridgeY + 20, 30, 180);

  // Main towers
  ctx.fillStyle = '#8b2500';
  ctx.fillRect(bridgeX, bridgeY - 180, 40, 300);
  ctx.fillRect(bridgeX + 400, bridgeY - 180, 40, 300);

  // Tower details
  ctx.fillStyle = '#a03000';
  ctx.fillRect(bridgeX + 5, bridgeY - 175, 30, 290);
  ctx.fillRect(bridgeX + 405, bridgeY - 175, 30, 290);

  // Main cables
  ctx.strokeStyle = '#c04020';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(bridgeX + 20, bridgeY - 170);
  ctx.quadraticCurveTo(bridgeX + 220, bridgeY - 80, bridgeX + 420, bridgeY - 170);
  ctx.stroke();

  // Suspender cables
  ctx.strokeStyle = 'rgba(180, 60, 30, 0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 20; i++) {
    const x = bridgeX + 40 + i * 20;
    const cableY = bridgeY - 170 + Math.pow((i - 10) / 10, 2) * 90;
    ctx.beginPath();
    ctx.moveTo(x, cableY);
    ctx.lineTo(x, bridgeY + 80);
    ctx.stroke();
  }

  // Road deck
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(bridgeX - 20, bridgeY + 80, 480, 20);

  // Stars with twinkling effect
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height * 0.45;
    const size = Math.random() * 2.5;
    const brightness = 0.3 + Math.random() * 0.7;

    ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();

    // Star glow
    if (size > 1.5) {
      ctx.fillStyle = `rgba(255, 255, 255, ${brightness * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y, size * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Moon
  ctx.fillStyle = '#fffaed';
  ctx.beginPath();
  ctx.arc(3600, 200, 60, 0, Math.PI * 2);
  ctx.fill();

  // Moon glow
  const moonGlow = ctx.createRadialGradient(3600, 200, 60, 3600, 200, 150);
  moonGlow.addColorStop(0, 'rgba(255, 250, 230, 0.3)');
  moonGlow.addColorStop(1, 'rgba(255, 250, 230, 0)');
  ctx.fillStyle = moonGlow;
  ctx.beginPath();
  ctx.arc(3600, 200, 150, 0, Math.PI * 2);
  ctx.fill();

  return canvas;
}

function createOfficeInterior() {
  const group = new THREE.Group();

  const room = {
    width: 50,
    height: 12,
    depth: 40
  };

  // Materials
  const concreteFloorMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.8
  });
  const polishedConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x606060,
    roughness: 0.3,
    metalness: 0.1
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.9
  });
  const darkAccentMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    roughness: 0.5
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x87ceeb,
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    metalness: 0.1
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.3,
    metalness: 0.8
  });
  const warmWoodMat = new THREE.MeshStandardMaterial({
    color: 0xc9a66b,
    roughness: 0.6
  });
  const tealAccentMat = new THREE.MeshStandardMaterial({
    color: 0x00b894,
    roughness: 0.4,
    metalness: 0.2
  });

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width, room.depth),
    polishedConcreteMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  group.add(floor);

  // Ceiling with exposed beams
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width, room.depth),
    whiteMat
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = room.height;
  group.add(ceiling);

  // Exposed ceiling beams
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  for (let i = -20; i <= 20; i += 8) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, room.depth), beamMat);
    beam.position.set(i, room.height - 0.4, 0);
    group.add(beam);
  }

  // SF Skyline backdrop texture
  const skylineTexture = new THREE.CanvasTexture(createSkylineBackdrop());

  // Window panes with skyline - placed BEHIND the frame to avoid z-fighting
  const windowMat = new THREE.MeshStandardMaterial({
    map: skylineTexture,
    side: THREE.DoubleSide
  });
  const backWindow = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width + 4, room.height + 2),
    windowMat
  );
  backWindow.position.set(0, room.height / 2, -room.depth / 2 - 1);
  group.add(backWindow);

  // Back wall - floor to ceiling window frame (in front of skyline)
  const backWindowFrame = new THREE.Mesh(
    new THREE.BoxGeometry(room.width, room.height, 0.3),
    steelMat
  );
  backWindowFrame.position.set(0, room.height / 2, -room.depth / 2);
  group.add(backWindowFrame);

  // Vertical window dividers
  for (let i = -20; i <= 20; i += 5) {
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.15, room.height, 0.4), steelMat);
    divider.position.set(i, room.height / 2, -room.depth / 2);
    group.add(divider);
  }

  // Left window section - placed behind the wall
  const leftWindow = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depth * 0.7, room.height + 2),
    windowMat
  );
  leftWindow.rotation.y = Math.PI / 2;
  leftWindow.position.set(-room.width / 2 - 1, room.height / 2, -room.depth * 0.1);
  group.add(leftWindow);

  // Left wall - partial with windows (in front)
  const leftWallSolid = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depth * 0.4, room.height),
    whiteMat
  );
  leftWallSolid.rotation.y = Math.PI / 2;
  leftWallSolid.position.set(-room.width / 2, room.height / 2, room.depth * 0.3);
  group.add(leftWallSolid);

  // Right wall - solid with art
  const rightWall = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depth, room.height),
    whiteMat
  );
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(room.width / 2, room.height / 2, 0);
  group.add(rightWall);

  // Front wall - fully enclosed with entrance
  const frontWallLeft = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width / 2 - 3, room.height),
    whiteMat
  );
  frontWallLeft.rotation.y = Math.PI;
  frontWallLeft.position.set(-room.width / 4 - 1.5, room.height / 2, room.depth / 2);
  group.add(frontWallLeft);

  const frontWallRight = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width / 2 - 3, room.height),
    whiteMat
  );
  frontWallRight.rotation.y = Math.PI;
  frontWallRight.position.set(room.width / 4 + 1.5, room.height / 2, room.depth / 2);
  group.add(frontWallRight);

  const frontWallTop = new THREE.Mesh(
    new THREE.PlaneGeometry(6, room.height - 4),
    whiteMat
  );
  frontWallTop.rotation.y = Math.PI;
  frontWallTop.position.set(0, room.height - 2, room.depth / 2);
  group.add(frontWallTop);

  // Glass entrance doors
  const entranceDoor = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), glassMat);
  entranceDoor.rotation.y = Math.PI;
  entranceDoor.position.set(0, 2, room.depth / 2 - 0.1);
  group.add(entranceDoor);

  // Modern reception desk near entrance
  const receptionDesk = createModernDesk(6, 1.1, 2);
  receptionDesk.position.set(0, 0, room.depth / 2 - 5);
  group.add(receptionDesk);

  // Work desk clusters
  const deskPositions = [
    { x: -15, z: 5, rotation: 0 },
    { x: -15, z: -5, rotation: Math.PI },
    { x: -8, z: 5, rotation: 0 },
    { x: -8, z: -5, rotation: Math.PI },
    { x: 8, z: 5, rotation: 0 },
    { x: 8, z: -5, rotation: Math.PI },
    { x: 15, z: 5, rotation: 0 },
    { x: 15, z: -5, rotation: Math.PI }
  ];

  deskPositions.forEach((pos) => {
    const desk = createModernDesk(2.4, 0.75, 1.2);
    desk.position.set(pos.x, 0, pos.z);
    desk.rotation.y = pos.rotation;
    group.add(desk);

    const chair = createModernChair();
    chair.position.set(pos.x, 0, pos.z + (pos.rotation === 0 ? 1.2 : -1.2));
    chair.rotation.y = pos.rotation;
    group.add(chair);
  });

  // Lounge area with couches
  const loungeArea = createLoungeArea();
  loungeArea.position.set(18, 0, 8);
  group.add(loungeArea);

  // Kitchen/break area
  const kitchen = createKitchenArea();
  kitchen.position.set(-18, 0, 8);
  group.add(kitchen);

  // BOARDROOM - large glass-walled conference room
  const boardroom = createBoardroom();
  boardroom.position.set(0, 0, -14);
  group.add(boardroom);

  // MEETING ROOMS - smaller glass pods along left side
  const meetingRoom1 = createMeetingRoom('SYNC');
  meetingRoom1.position.set(-20, 0, -4);
  group.add(meetingRoom1);

  const meetingRoom2 = createMeetingRoom('FOCUS');
  meetingRoom2.position.set(-20, 0, 2);
  group.add(meetingRoom2);

  // PRIVATE OFFICES - along right wall
  const office1 = createPrivateOffice('CEO');
  office1.position.set(20, 0, -4);
  group.add(office1);

  const office2 = createPrivateOffice('CTO');
  office2.position.set(20, 0, 2);
  group.add(office2);

  const office3 = createPrivateOffice('CFO');
  office3.position.set(20, 0, -10);
  group.add(office3);

  // Large wall art on right wall
  const artFrame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4, 8), steelMat);
  artFrame.position.set(room.width / 2 - 0.1, 5, 0);
  group.add(artFrame);

  const artCanvas = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 3.5),
    new THREE.MeshStandardMaterial({ color: 0xff6b6b, roughness: 0.9 })
  );
  artCanvas.rotation.y = -Math.PI / 2;
  artCanvas.position.set(room.width / 2 - 0.2, 5, 0);
  group.add(artCanvas);

  // Neon sign
  const neonMat = new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    emissive: 0x00ff88,
    emissiveIntensity: 2
  });
  const neonText = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 4), neonMat);
  neonText.position.set(room.width / 2 - 0.3, 8, -8);
  group.add(neonText);

  // Indoor plants
  const plantPositions = [
    { x: -22, z: 15 },
    { x: 22, z: 15 },
    { x: -22, z: -15 },
    { x: 22, z: -15 },
    { x: 0, z: -15 }
  ];
  plantPositions.forEach((pos) => {
    const plant = createPlant();
    plant.position.set(pos.x, 0, pos.z);
    group.add(plant);
  });

  // Lighting - industrial pendant lights
  const lightPositions = [
    { x: -15, z: 0 },
    { x: 0, z: 0 },
    { x: 15, z: 0 },
    { x: -15, z: -10 },
    { x: 0, z: -10 },
    { x: 15, z: -10 },
    { x: 0, z: 10 }
  ];

  lightPositions.forEach((pos) => {
    const pendantLight = createPendantLight();
    pendantLight.position.set(pos.x, room.height - 1.5, pos.z);
    group.add(pendantLight);

    const pointLight = new THREE.PointLight(0xfff5e6, 0.6, 15);
    pointLight.position.set(pos.x, room.height - 2, pos.z);
    group.add(pointLight);
  });

  // Ambient light from windows
  const windowLight = new THREE.RectAreaLight(0xffeedd, 1.5, room.width, room.height);
  windowLight.position.set(0, room.height / 2, -room.depth / 2 + 1);
  windowLight.lookAt(0, room.height / 2, 0);
  group.add(windowLight);

  scene.add(group);
  return group;
}

function createModernDesk(width, height, depth) {
  const desk = new THREE.Group();

  const topMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.3
  });
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.4,
    metalness: 0.6
  });

  const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, depth), topMat);
  top.position.y = height;
  desk.add(top);

  // Modern A-frame legs
  const legGeo = new THREE.BoxGeometry(0.08, height, 0.08);
  const positions = [
    [-width / 2 + 0.1, height / 2, -depth / 2 + 0.1],
    [width / 2 - 0.1, height / 2, -depth / 2 + 0.1],
    [-width / 2 + 0.1, height / 2, depth / 2 - 0.1],
    [width / 2 - 0.1, height / 2, depth / 2 - 0.1]
  ];

  positions.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, y, z);
    desk.add(leg);
  });

  // Monitor
  const monitorMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.3,
    metalness: 0.5
  });
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.03), monitorMat);
  monitor.position.set(0, height + 0.35, -depth / 3);
  desk.add(monitor);

  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.7, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x4a90d9, emissive: 0x4a90d9, emissiveIntensity: 0.3 })
  );
  screen.position.set(0, height + 0.35, -depth / 3 + 0.02);
  desk.add(screen);

  return desk;
}

function createModernChair() {
  const chair = new THREE.Group();

  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.6
  });
  const meshMat = new THREE.MeshStandardMaterial({
    color: 0x636e72,
    roughness: 0.8,
    transparent: true,
    opacity: 0.9
  });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), seatMat);
  seat.position.y = 0.5;
  chair.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.05), meshMat);
  back.position.set(0, 0.85, -0.22);
  back.rotation.x = 0.1;
  chair.add(back);

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.3,
    metalness: 0.7
  });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), baseMat);
  post.position.y = 0.25;
  chair.add(post);

  // Star base
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.05), baseMat);
    arm.position.y = 0.015;
    arm.rotation.y = (i * Math.PI * 2) / 5;
    arm.position.x = Math.sin(arm.rotation.y) * 0.15;
    arm.position.z = Math.cos(arm.rotation.y) * 0.15;
    chair.add(arm);
  }

  return chair;
}

function createLoungeArea() {
  const lounge = new THREE.Group();

  const couchMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.8
  });
  const cushionMat = new THREE.MeshStandardMaterial({
    color: 0x636e72,
    roughness: 0.9
  });

  // L-shaped couch
  const couchBase = new THREE.Mesh(new THREE.BoxGeometry(4, 0.4, 1.2), couchMat);
  couchBase.position.set(0, 0.2, 0);
  lounge.add(couchBase);
  registerPlatform(couchBase);

  const couchBack = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 0.2), couchMat);
  couchBack.position.set(0, 0.7, -0.5);
  lounge.add(couchBack);

  const couchSide = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 2), couchMat);
  couchSide.position.set(-2.4, 0.2, 0.4);
  lounge.add(couchSide);
  registerPlatform(couchSide);

  // Cushions
  const cushion1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), cushionMat);
  cushion1.position.set(1.5, 0.55, 0);
  cushion1.rotation.z = 0.2;
  lounge.add(cushion1);

  // Coffee table
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0xc9a66b,
    roughness: 0.4
  });
  const coffeeTable = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.8), tableMat);
  coffeeTable.position.set(0, 0.45, 1.2);
  lounge.add(coffeeTable);

  const tableLegs = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1a1a }));
  tableLegs.position.set(0, 0.2, 1.2);
  lounge.add(tableLegs);

  return lounge;
}

function createKitchenArea() {
  const kitchen = new THREE.Group();

  const counterMat = new THREE.MeshStandardMaterial({
    color: 0xfafafa,
    roughness: 0.2,
    metalness: 0.1
  });
  const cabinetMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.6
  });

  // Counter
  const counter = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.8), counterMat);
  counter.position.set(0, 0.55, -1);
  kitchen.add(counter);
  registerPlatform(counter);

  // Base cabinets
  const baseCabinet = new THREE.Mesh(new THREE.BoxGeometry(6, 0.9, 0.7), cabinetMat);
  baseCabinet.position.set(0, 0.45, -1);
  kitchen.add(baseCabinet);

  // Upper cabinets
  const upperCabinet = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 0.4), cabinetMat);
  upperCabinet.position.set(0, 2.5, -1.15);
  kitchen.add(upperCabinet);

  // Coffee machine
  const coffeeMachine = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.5, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x636e72, metalness: 0.5 })
  );
  coffeeMachine.position.set(-2, 1.35, -1);
  kitchen.add(coffeeMachine);

  // Fridge
  const fridge = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.2, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xb2bec3, metalness: 0.7 })
  );
  fridge.position.set(4, 1.1, -1);
  kitchen.add(fridge);

  // Bar stools
  for (let i = -1.5; i <= 1.5; i += 1.5) {
    const stool = createBarStool();
    stool.position.set(i, 0, 0.5);
    kitchen.add(stool);
  }

  return kitchen;
}

function createBoardroom() {
  const room = new THREE.Group();
  const roomWidth = 12;
  const roomDepth = 6;
  const roomHeight = 4;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.25,
    roughness: 0.05,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.3,
    metalness: 0.7
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    roughness: 0.4
  });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomDepth), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  room.add(floor);

  // Glass walls
  const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomHeight), glassMat);
  frontGlass.position.set(0, roomHeight / 2, roomDepth / 2);
  frontGlass.rotation.y = Math.PI;
  room.add(frontGlass);

  const leftGlass = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), glassMat);
  leftGlass.rotation.y = Math.PI / 2;
  leftGlass.position.set(-roomWidth / 2, roomHeight / 2, 0);
  room.add(leftGlass);

  const rightGlass = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), glassMat);
  rightGlass.rotation.y = -Math.PI / 2;
  rightGlass.position.set(roomWidth / 2, roomHeight / 2, 0);
  room.add(rightGlass);

  // Frame posts
  const postGeo = new THREE.BoxGeometry(0.1, roomHeight, 0.1);
  const postPositions = [
    [-roomWidth / 2, roomHeight / 2, roomDepth / 2],
    [roomWidth / 2, roomHeight / 2, roomDepth / 2],
    [-roomWidth / 2, roomHeight / 2, -roomDepth / 2],
    [roomWidth / 2, roomHeight / 2, -roomDepth / 2]
  ];
  postPositions.forEach(([x, y, z]) => {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(x, y, z);
    room.add(post);
  });

  // Conference table
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.2,
    metalness: 0.3
  });
  const table = new THREE.Mesh(new THREE.BoxGeometry(8, 0.1, 2.5), tableMat);
  table.position.set(0, 0.75, 0);
  room.add(table);
  registerPlatform(table);

  const tableBase = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.7, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x2d3436 })
  );
  tableBase.position.set(0, 0.35, 0);
  room.add(tableBase);

  // Executive chairs around the table
  const chairPositions = [
    { x: -3, z: 1.8, rot: Math.PI },
    { x: -1, z: 1.8, rot: Math.PI },
    { x: 1, z: 1.8, rot: Math.PI },
    { x: 3, z: 1.8, rot: Math.PI },
    { x: -3, z: -1.8, rot: 0 },
    { x: -1, z: -1.8, rot: 0 },
    { x: 1, z: -1.8, rot: 0 },
    { x: 3, z: -1.8, rot: 0 },
    { x: -4.5, z: 0, rot: Math.PI / 2 },
    { x: 4.5, z: 0, rot: -Math.PI / 2 }
  ];

  chairPositions.forEach((pos) => {
    const chair = createExecutiveChair();
    chair.position.set(pos.x, 0, pos.z);
    chair.rotation.y = pos.rot;
    room.add(chair);
  });

  // TV Screen on back wall
  const tvMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a2e,
    emissive: 0x4a90d9,
    emissiveIntensity: 0.3
  });
  const tv = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.1), tvMat);
  tv.position.set(0, 2.5, -roomDepth / 2 + 0.1);
  room.add(tv);

  // Room sign
  const sign = createRoomSign('BOARDROOM');
  sign.position.set(0, 3.5, roomDepth / 2 + 0.1);
  room.add(sign);

  // Ceiling light
  const light = new THREE.PointLight(0xffffff, 0.8, 15);
  light.position.set(0, 3.8, 0);
  room.add(light);

  return room;
}

function createMeetingRoom(name) {
  const room = new THREE.Group();
  const roomWidth = 5;
  const roomDepth = 4;
  const roomHeight = 3.5;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.3,
    roughness: 0.05,
    side: THREE.DoubleSide
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.3,
    metalness: 0.7
  });

  // Floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(roomWidth, roomDepth),
    new THREE.MeshStandardMaterial({ color: 0x4a4a5a, roughness: 0.3 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  room.add(floor);

  // Glass walls (front and one side)
  const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomHeight), glassMat);
  frontGlass.position.set(0, roomHeight / 2, roomDepth / 2);
  frontGlass.rotation.y = Math.PI;
  room.add(frontGlass);

  const sideGlass = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), glassMat);
  sideGlass.rotation.y = -Math.PI / 2;
  sideGlass.position.set(roomWidth / 2, roomHeight / 2, 0);
  room.add(sideGlass);

  // Corner posts
  const postGeo = new THREE.BoxGeometry(0.08, roomHeight, 0.08);
  const corners = [
    [roomWidth / 2, roomHeight / 2, roomDepth / 2],
    [roomWidth / 2, roomHeight / 2, -roomDepth / 2]
  ];
  corners.forEach(([x, y, z]) => {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(x, y, z);
    room.add(post);
  });

  // Small round table
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.3 })
  );
  table.position.set(0, 0.75, 0);
  room.add(table);
  registerPlatform(table);

  const tableLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.75, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d3436 })
  );
  tableLeg.position.set(0, 0.375, 0);
  room.add(tableLeg);

  // 4 chairs
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const chair = createModernChair();
    chair.position.set(Math.cos(angle) * 1.5, 0, Math.sin(angle) * 1.5);
    chair.rotation.y = angle + Math.PI;
    room.add(chair);
  }

  // Room sign
  const sign = createRoomSign(name);
  sign.position.set(0, 3, roomDepth / 2 + 0.1);
  room.add(sign);

  // Light
  const light = new THREE.PointLight(0xfff5e6, 0.5, 8);
  light.position.set(0, 3.2, 0);
  room.add(light);

  return room;
}

function createPrivateOffice(title) {
  const office = new THREE.Group();
  const roomWidth = 5;
  const roomDepth = 5;
  const roomHeight = 3.5;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    transparent: true,
    opacity: 0.2,
    roughness: 0.05,
    side: THREE.DoubleSide
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f5,
    roughness: 0.9
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.3,
    metalness: 0.7
  });

  // Floor - nicer carpet
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(roomWidth, roomDepth),
    new THREE.MeshStandardMaterial({ color: 0x2d3a4a, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  office.add(floor);

  // Back wall (solid)
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomHeight), wallMat);
  backWall.position.set(0, roomHeight / 2, -roomDepth / 2);
  office.add(backWall);

  // Side wall (solid)
  const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(roomDepth, roomHeight), wallMat);
  sideWall.rotation.y = -Math.PI / 2;
  sideWall.position.set(roomWidth / 2, roomHeight / 2, 0);
  office.add(sideWall);

  // Front glass wall with door opening
  const frontGlass = new THREE.Mesh(new THREE.PlaneGeometry(roomWidth, roomHeight), glassMat);
  frontGlass.position.set(0, roomHeight / 2, roomDepth / 2);
  frontGlass.rotation.y = Math.PI;
  office.add(frontGlass);

  // Executive desk
  const desk = createModernDesk(2, 0.75, 1);
  desk.position.set(0, 0, -1.5);
  office.add(desk);

  // Executive chair behind desk
  const chair = createExecutiveChair();
  chair.position.set(0, 0, -2.5);
  office.add(chair);

  // Guest chairs
  const guestChair1 = createModernChair();
  guestChair1.position.set(-1, 0, 0.5);
  guestChair1.rotation.y = Math.PI;
  office.add(guestChair1);

  const guestChair2 = createModernChair();
  guestChair2.position.set(1, 0, 0.5);
  guestChair2.rotation.y = Math.PI;
  office.add(guestChair2);

  // Bookshelf on back wall
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.6 })
  );
  shelf.position.set(1.8, 1.5, -roomDepth / 2 + 0.2);
  office.add(shelf);

  // Books on shelf
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const bookColor = [0xe74c3c, 0x3498db, 0x27ae60, 0xf39c12, 0x9b59b6][Math.floor(Math.random() * 5)];
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.35, 0.2),
        new THREE.MeshStandardMaterial({ color: bookColor, roughness: 0.8 })
      );
      book.position.set(1.8 - 0.5 + col * 0.35, 0.7 + row * 0.55, -roomDepth / 2 + 0.15);
      office.add(book);
    }
  }

  // Name plate
  const sign = createRoomSign(title);
  sign.position.set(0, 2.8, roomDepth / 2 + 0.1);
  office.add(sign);

  // Ambient light
  const light = new THREE.PointLight(0xfff5e6, 0.6, 10);
  light.position.set(0, 3.2, 0);
  office.add(light);

  return office;
}

function createExecutiveChair() {
  const chair = new THREE.Group();

  const leatherMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.4
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa,
    roughness: 0.2,
    metalness: 0.9
  });

  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.5), leatherMat);
  seat.position.y = 0.55;
  chair.add(seat);
  registerPlatform(seat);

  // High back
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.1), leatherMat);
  back.position.set(0, 1, -0.22);
  back.rotation.x = 0.08;
  chair.add(back);

  // Headrest
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.08), leatherMat);
  headrest.position.set(0, 1.45, -0.2);
  chair.add(headrest);

  // Armrests
  const armGeo = new THREE.BoxGeometry(0.08, 0.05, 0.3);
  const leftArm = new THREE.Mesh(armGeo, leatherMat);
  leftArm.position.set(-0.3, 0.7, -0.05);
  chair.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, leatherMat);
  rightArm.position.set(0.3, 0.7, -0.05);
  chair.add(rightArm);

  // Chrome base
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), chromeMat);
  post.position.y = 0.25;
  chair.add(post);

  // Star base with wheels
  for (let i = 0; i < 5; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.03, 0.04), chromeMat);
    arm.position.y = 0.02;
    arm.rotation.y = (i * Math.PI * 2) / 5;
    arm.position.x = Math.sin(arm.rotation.y) * 0.18;
    arm.position.z = Math.cos(arm.rotation.y) * 0.18;
    chair.add(arm);

    // Wheel
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 8), chromeMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(
      Math.sin(arm.rotation.y) * 0.4,
      0.02,
      Math.cos(arm.rotation.y) * 0.4
    );
    chair.add(wheel);
  }

  return chair;
}

function createRoomSign(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 64;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = 'bold 28px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.4), material);

  return sign;
}

function createBarStool() {
  const stool = new THREE.Group();

  const seatMat = new THREE.MeshStandardMaterial({
    color: 0xc9a66b,
    roughness: 0.5
  });
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    roughness: 0.3,
    metalness: 0.7
  });

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 16), seatMat);
  seat.position.y = 0.8;
  stool.add(seat);
  registerPlatform(seat);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.75, 8), legMat);
  post.position.y = 0.4;
  stool.add(post);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 16), legMat);
  base.position.y = 0.015;
  stool.add(base);

  return stool;
}

function createPlant() {
  const plant = new THREE.Group();

  const potMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.7
  });
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 0.6, 12), potMat);
  pot.position.y = 0.3;
  plant.add(pot);

  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 1 });
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 12), soilMat);
  soil.position.y = 0.58;
  plant.add(soil);

  // Leaves
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x27ae60,
    roughness: 0.8,
    side: THREE.DoubleSide
  });

  for (let i = 0; i < 8; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.2), leafMat);
    leaf.position.y = 1.2;
    leaf.rotation.y = (i * Math.PI) / 4;
    leaf.rotation.x = -0.3;
    leaf.rotation.z = Math.sin(i) * 0.2;
    plant.add(leaf);
  }

  return plant;
}

function createPendantLight() {
  const light = new THREE.Group();

  const cordMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 8), cordMat);
  cord.position.y = 0.75;
  light.add(cord);

  const shadeMat = new THREE.MeshStandardMaterial({
    color: 0x2d3436,
    roughness: 0.6,
    side: THREE.DoubleSide
  });
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.5, 16, 1, true), shadeMat);
  shade.position.y = -0.25;
  shade.rotation.x = Math.PI;
  light.add(shade);

  return light;
}

function createOutdoorAccents() {
  // No outdoor accents - fully enclosed SF office
}

// ============================================
// JUMPING PUZZLE PLATFORMS
// ============================================

function createJumpingPuzzles() {
  const group = new THREE.Group();

  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x00b894,
    roughness: 0.4,
    metalness: 0.3
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x00ff88,
    emissive: 0x00ff88,
    emissiveIntensity: 0.5
  });

  // Platform route along the left side
  const platformData = [
    { x: -22, y: 1.5, z: 5, w: 2, d: 2 },
    { x: -22, y: 2.5, z: 0, w: 1.5, d: 1.5 },
    { x: -22, y: 3.5, z: -5, w: 1.5, d: 1.5 },
    { x: -20, y: 4.5, z: -8, w: 2, d: 2 },
    { x: -16, y: 5.5, z: -10, w: 1.5, d: 1.5 },
    { x: -12, y: 6.5, z: -12, w: 2, d: 2 },
    { x: -8, y: 7.5, z: -14, w: 2.5, d: 2.5 }, // Secret viewing platform
    { x: -4, y: 8, z: -16, w: 2, d: 2 },
    { x: 0, y: 8.5, z: -17, w: 3, d: 3 }, // Top platform with best view
  ];

  platformData.forEach((p, i) => {
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(p.w, 0.2, p.d),
      platformMat
    );
    platform.position.set(p.x, p.y, p.z);
    group.add(platform);
    registerPlatform(platform);

    // Glow edge
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(p.w + 0.1, 0.05, p.d + 0.1),
      glowMat
    );
    edge.position.set(p.x, p.y - 0.1, p.z);
    group.add(edge);
  });

  // Right side challenge route - harder jumps
  const hardPlatforms = [
    { x: 22, y: 2, z: 5, w: 1.2, d: 1.2 },
    { x: 20, y: 3, z: 2, w: 1, d: 1 },
    { x: 22, y: 4, z: -1, w: 1, d: 1 },
    { x: 20, y: 5, z: -4, w: 1.2, d: 1.2 },
    { x: 18, y: 6, z: -7, w: 1, d: 1 },
    { x: 20, y: 7, z: -10, w: 1.5, d: 1.5 },
    { x: 22, y: 8, z: -13, w: 2, d: 2 }, // Reward platform
  ];

  const hardPlatformMat = new THREE.MeshStandardMaterial({
    color: 0xe17055,
    roughness: 0.4,
    metalness: 0.3
  });
  const hardGlowMat = new THREE.MeshStandardMaterial({
    color: 0xff6b6b,
    emissive: 0xff6b6b,
    emissiveIntensity: 0.5
  });

  hardPlatforms.forEach((p) => {
    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(p.w, 0.2, p.d),
      hardPlatformMat
    );
    platform.position.set(p.x, p.y, p.z);
    group.add(platform);
    registerPlatform(platform);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(p.w + 0.1, 0.05, p.d + 0.1),
      hardGlowMat
    );
    edge.position.set(p.x, p.y - 0.1, p.z);
    group.add(edge);
  });

  // Center floating sculpture you can climb
  const sculptureBase = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.3, 3),
    new THREE.MeshStandardMaterial({ color: 0x6c5ce7, roughness: 0.3 })
  );
  sculptureBase.position.set(0, 4, 0);
  group.add(sculptureBase);
  registerPlatform(sculptureBase);

  const sculptureTop = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.3, 2),
    new THREE.MeshStandardMaterial({ color: 0xa29bfe, roughness: 0.3 })
  );
  sculptureTop.position.set(0, 5.5, 0);
  group.add(sculptureTop);
  registerPlatform(sculptureTop);

  // Floating ring decoration
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.15, 8, 24),
    new THREE.MeshStandardMaterial({
      color: 0xffeaa7,
      emissive: 0xffeaa7,
      emissiveIntensity: 0.3
    })
  );
  ring.position.set(0, 6.5, 0);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  scene.add(group);
}

// ============================================
// SECRETS - DUCK TO SEE
// ============================================

function createSecrets() {
  const group = new THREE.Group();

  const secretMat = new THREE.MeshStandardMaterial({
    color: 0xffeaa7,
    emissive: 0xffeaa7,
    emissiveIntensity: 0.8
  });

  // Secret 1: Under the reception desk
  const secret1 = createSecretMessage('WELCOME TO SF', 0.15);
  secret1.position.set(0, 0.3, 15);
  secret1.rotation.x = -Math.PI / 2;
  group.add(secret1);

  // Secret 2: Behind a plant pot - duck to see through the gap
  const secret2 = createSecretMessage('HIDDEN GEM', 0.12);
  secret2.position.set(-22, 0.4, -15.5);
  secret2.rotation.y = Math.PI / 2;
  group.add(secret2);

  // Secret 3: Under a desk cluster
  const secret3 = createSecretMessage('KEEP EXPLORING', 0.1);
  secret3.position.set(-15, 0.25, 5);
  secret3.rotation.x = -Math.PI / 2;
  group.add(secret3);

  // Secret 4: Under the kitchen counter
  const secret4 = createSecretMessage('COFFEE BREAK', 0.12);
  secret4.position.set(-18, 0.3, -12);
  secret4.rotation.x = -Math.PI / 2;
  group.add(secret4);

  // Secret 5: Under the couch in lounge
  const secret5 = createSecretMessage('NAP TIME?', 0.1);
  secret5.position.set(18, 0.2, -12);
  secret5.rotation.x = -Math.PI / 2;
  group.add(secret5);

  // Secret 6: Tiny message visible only when ducking under jumping platform
  const secret6 = createSecretMessage('YOU FOUND ME!', 0.08);
  secret6.position.set(-8, 7.3, -14);
  secret6.rotation.x = Math.PI;
  group.add(secret6);

  // Secret 7: Hidden in a corner - need to duck and look
  const secret7Box = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 1
    })
  );
  secret7Box.position.set(24, 0.25, 19);
  group.add(secret7Box);

  // Secret 8: Under the art installation
  const secret8 = createSecretMessage('ART IS EVERYWHERE', 0.08);
  secret8.position.set(24, 0.4, 0);
  secret8.rotation.y = -Math.PI / 2;
  group.add(secret8);

  scene.add(group);
}

function createSecretMessage(text, size) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;

  ctx.fillStyle = 'rgba(0, 0, 0, 0)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = 'bold 48px monospace';
  ctx.fillStyle = '#ffeaa7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide
  });

  const aspect = canvas.width / canvas.height;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(size * aspect * 4, size * 4),
    material
  );

  return plane;
}
