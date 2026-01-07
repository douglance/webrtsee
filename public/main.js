import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const overlay = document.getElementById('overlay');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const statusEl = document.getElementById('status');
const controlsHint = document.getElementById('controlsHint');
const localVideo = document.getElementById('localVideo');
const shareBtn = document.getElementById('shareBtn');
const moveShareBtn = document.getElementById('moveShareBtn');

let scene;
let camera;
let renderer;
let controls;
let clock;

let socket;
let localStream;
let myId;
let joined = false;
let hasJoinedRoom = false;
let pendingShareStart = false;

const peerConnections = new Map();
const remoteAvatars = new Map();
const remoteVideos = new Map();
const remoteSharePanels = new Map();
const remoteShareVideos = new Map();
const remoteShareMeta = new Map();
const remoteTrackStreams = new Map();
const remoteAvatarTrackIds = new Map();

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
  right: false
};
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

const lastPose = {
  position: new THREE.Vector3(),
  yaw: 0,
  pitch: 0
};
let lastPoseSent = 0;

initScene();
animate();

joinBtn.addEventListener('click', () => {
  if (joined) {
    return;
  }
  joinExperience();
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

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87c9ff);
  scene.fog = new THREE.Fog(0x87c9ff, 25, 140);

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    400
  );

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, renderer.domElement);
  controls.getObject().position.set(0, 1.6, 18);
  scene.add(controls.getObject());

  clock = new THREE.Clock();

  const hemiLight = new THREE.HemisphereLight(0xd7f1ff, 0x4d6b3d, 0.9);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffffff, 0.85);
  sunLight.position.set(30, 40, 20);
  scene.add(sunLight);

  createGrassland();
  createOfficeInterior();
  createOutdoorAccents();

  renderer.domElement.addEventListener('click', () => {
    if (joined && !moveShareMode) {
      controls.lock();
    }
  });

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointerleave', onPointerUp);

  controls.addEventListener('lock', () => {
    if (!moveShareMode) {
      controlsHint.textContent = 'WASD to move - ESC to release';
    }
  });

  controls.addEventListener('unlock', () => {
    if (!moveShareMode) {
      controlsHint.textContent = 'Click to look around';
    }
  });

  window.addEventListener('resize', onWindowResize);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
}

async function joinExperience() {
  joinBtn.disabled = true;
  statusEl.textContent = 'Requesting camera...';

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: 640,
        height: 480
      },
      audio: false
    });
  } catch (err) {
    statusEl.textContent = 'Camera access denied';
    joinBtn.disabled = false;
    return;
  }

  localVideo.srcObject = localStream;
  playVideoElement(localVideo);
  overlay.classList.add('hidden');
  joined = true;
  shareBtn.disabled = false;
  connectSocket();
}

function connectSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener('open', () => {
    statusEl.textContent = 'Connected to room';
    const room = roomInput.value.trim() || 'lobby';
    socket.send(JSON.stringify({ type: 'join', room }));
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
      msg.peers.forEach((peerId) => {
        if (peerId === myId) {
          return;
        }
        ensureRemoteAvatar(peerId);
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
        ensureRemoteAvatar(msg.id);
      }
      return;
    }

    if (msg.type === 'peer-left') {
      cleanupPeer(msg.id);
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

    if (msg.type === 'screenpose') {
      if (msg.id && msg.id !== myId && msg.position) {
        updateRemoteSharePose(msg.id, msg.position);
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

    if (msg.type === 'pose') {
      if (msg.id !== myId && msg.position && msg.rotation) {
        updateRemotePose(msg.id, msg.position, msg.rotation);
      }
    }
  });

  socket.addEventListener('close', () => {
    statusEl.textContent = 'Disconnected';
    hasJoinedRoom = false;
    pendingShareStart = false;
  });
}

function createPeerConnection(peerId) {
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

  if (screenStream) {
    screenStream.getVideoTracks().forEach((track) => {
      pc.addTrack(track, screenStream);
    });
  }

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    const track = event.track;
    if (!stream || !track || track.kind !== 'video') {
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
  const pc = createPeerConnection(peerId);
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
  const pc = createPeerConnection(peerId);
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
  if (texture.colorSpace !== undefined) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
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
    metalness: 0.1
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.08), boardMat);
  group.add(board);

  const screenMat = new THREE.MeshBasicMaterial({
    color: 0x111111
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), screenMat);
  screen.position.z = 0.041;
  group.add(screen);

  scene.add(group);

  const avatar = {
    group,
    screen,
    texture: null
  };

  remoteAvatars.set(peerId, avatar);
  return avatar;
}

function updateRemotePose(peerId, position, rotation) {
  const avatar = ensureRemoteAvatar(peerId);
  avatar.group.position.set(position.x, position.y, position.z);
  avatar.group.rotation.set(rotation.x || 0, (rotation.y || 0) + Math.PI, 0);
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
    scene.remove(avatar.group);
    remoteAvatars.delete(peerId);
  }

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
}

async function startScreenShare() {
  if (screenStream) {
    return;
  }

  shareBtn.disabled = true;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
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
    controlsHint.textContent = 'Drag the screen to move it';
  } else {
    controlsHint.textContent = controls.isLocked
      ? 'WASD to move - ESC to release'
      : 'Click to look around';
    if (wasLockedBeforeMove) {
      controls.lock();
    }
  }
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
  if (!localSharePanel || !socket || socket.readyState !== WebSocket.OPEN) {
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

  socket.send(
    JSON.stringify({
      type: 'screenpose',
      position: { x: pos.x, y: pos.y, z: pos.z }
    })
  );
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
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 0.18, 12), baseMat);
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

function onPointerDown(event) {
  if (!moveShareMode || !localSharePanel) {
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

function maybeSendPose() {
  if (!joined || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const now = performance.now();
  if (now - lastPoseSent < 100) {
    return;
  }

  const pos = controls.getObject().position;
  const yaw = controls.getObject().rotation.y;
  const pitch = camera.rotation.x;

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

  socket.send(
    JSON.stringify({
      type: 'pose',
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: pitch, y: yaw }
    })
  );
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (controls.isLocked) {
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    direction.z = Number(moveState.forward) - Number(moveState.backward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();

    const speed = 18.0;

    if (moveState.forward || moveState.backward) {
      velocity.z -= direction.z * speed * delta;
    }

    if (moveState.left || moveState.right) {
      velocity.x -= direction.x * speed * delta;
    }

    controls.moveRight(-velocity.x * delta);
    controls.moveForward(-velocity.z * delta);
    controls.getObject().position.y = 1.6;
  }

  updateShareFacing();
  maybeSendPose();
  renderer.render(scene, camera);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onKeyDown(event) {
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
    default:
      break;
  }
}

function createGrassland() {
  const texture = new THREE.CanvasTexture(createGrassCanvas());
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(48, 48);

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 1
  });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    material
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const pathMaterial = new THREE.MeshStandardMaterial({
    color: 0xb07c4b,
    roughness: 0.9
  });
  const path = new THREE.Mesh(new THREE.PlaneGeometry(10, 60), pathMaterial);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, 8);
  scene.add(path);
}

function createGrassCanvas() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#2c7d32';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 3000; i += 1) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    const shade = 80 + Math.floor(Math.random() * 80);
    const height = Math.random() * 6 + 1;
    ctx.fillStyle = `rgb(32, ${shade}, 44)`;
    ctx.fillRect(x, y, 1, height);
  }

  for (let i = 0; i < 200; i += 1) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 1.2 + 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

function createOfficeInterior() {
  const group = new THREE.Group();
  group.position.set(0, 0, -10);

  const room = {
    width: 28,
    height: 9,
    depth: 18
  };

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe6e1d7,
    roughness: 0.9
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xb88b5c,
    roughness: 0.8
  });
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0xf2f2ef,
    roughness: 0.95
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width, room.depth),
    floorMat
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  group.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width, room.depth),
    ceilingMat
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = room.height;
  group.add(ceiling);

  const backWall = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width, room.height),
    wallMat
  );
  backWall.position.set(0, room.height / 2, -room.depth / 2);
  group.add(backWall);

  const leftWall = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depth, room.height),
    wallMat
  );
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-room.width / 2, room.height / 2, 0);
  group.add(leftWall);

  const rightWall = new THREE.Mesh(
    new THREE.PlaneGeometry(room.depth, room.height),
    wallMat
  );
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.position.set(room.width / 2, room.height / 2, 0);
  group.add(rightWall);

  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x4a4a4a,
    roughness: 0.7
  });
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(room.width + 1, 0.4, room.depth + 1),
    baseMat
  );
  base.position.set(0, -0.2, -0.2);
  group.add(base);

  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x9fd3ff,
    roughness: 0.15,
    metalness: 0.3,
    transparent: true,
    opacity: 0.65
  });

  const window = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), windowMat);
  window.position.set(0, room.height * 0.6, -room.depth / 2 + 0.02);
  group.add(window);

  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x2bb3a7,
    roughness: 0.4
  });
  const stripe = new THREE.Mesh(new THREE.PlaneGeometry(room.width, 0.4), accentMat);
  stripe.position.set(0, 2.2, -room.depth / 2 + 0.03);
  group.add(stripe);

  const panelMat = new THREE.MeshStandardMaterial({
    color: 0xf8f5ed,
    emissive: 0xf0e4b0,
    emissiveIntensity: 0.6
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 2), panelMat);
  panel.position.set(0, room.height - 0.2, -2);
  panel.rotation.x = Math.PI / 2;
  group.add(panel);

  const warmLight = new THREE.PointLight(0xfff1d2, 0.7, 30);
  warmLight.position.set(0, room.height - 0.6, -2);
  group.add(warmLight);

  const coolLight = new THREE.PointLight(0xd2f2ff, 0.5, 25);
  coolLight.position.set(-8, room.height - 0.6, -6);
  group.add(coolLight);

  const deskPositions = [
    [-7, -2, 0],
    [7, -2, 0],
    [-7, -6, Math.PI],
    [7, -6, Math.PI]
  ];

  deskPositions.forEach(([x, z, rotation]) => {
    const desk = createDesk();
    desk.position.set(x, 0, z);
    desk.rotation.y = rotation;
    group.add(desk);
  });

  const board = createWhiteboard();
  board.position.set(0, 4.8, -room.depth / 2 + 0.06);
  group.add(board);

  scene.add(group);
}

function createDesk() {
  const desk = new THREE.Group();

  const topMat = new THREE.MeshStandardMaterial({
    color: 0x7d593c,
    roughness: 0.6
  });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.2), topMat);
  top.position.y = 1.0;
  desk.add(top);

  const legMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a1d,
    roughness: 0.8
  });
  const legGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  const legPositions = [
    [-1.1, 0.5, -0.5],
    [1.1, 0.5, -0.5],
    [-1.1, 0.5, 0.5],
    [1.1, 0.5, 0.5]
  ];

  legPositions.forEach(([x, y, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, y, z);
    desk.add(leg);
  });

  const monitorMat = new THREE.MeshStandardMaterial({
    color: 0x1c2026,
    roughness: 0.4,
    metalness: 0.2
  });
  const monitor = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.05), monitorMat);
  monitor.position.set(0, 1.35, -0.3);
  desk.add(monitor);

  const keyboard = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.05, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6 })
  );
  keyboard.position.set(0, 1.05, 0.05);
  desk.add(keyboard);

  const chair = createChair();
  chair.position.set(0, 0, 1.1);
  chair.rotation.y = Math.PI;
  desk.add(chair);

  return desk;
}

function createChair() {
  const chair = new THREE.Group();
  const seatMat = new THREE.MeshStandardMaterial({
    color: 0x2d3b44,
    roughness: 0.8
  });

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.12, 12), seatMat);
  seat.position.y = 0.6;
  chair.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.12), seatMat);
  back.position.set(0, 0.95, -0.25);
  chair.add(back);

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.7 })
  );
  post.position.y = 0.3;
  chair.add(post);

  return chair;
}

function createWhiteboard() {
  const board = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x8a8f94,
    roughness: 0.5
  });

  const frame = new THREE.Mesh(new THREE.BoxGeometry(8, 2.6, 0.08), frameMat);
  board.add(frame);

  const boardSurface = new THREE.Mesh(
    new THREE.PlaneGeometry(7.6, 2.2),
    new THREE.MeshStandardMaterial({ color: 0xf5f3ed, roughness: 0.3 })
  );
  boardSurface.position.z = 0.05;
  board.add(boardSurface);

  return board;
}

function createOutdoorAccents() {
  const sculptureMat = new THREE.MeshStandardMaterial({
    color: 0x235a52,
    roughness: 0.4,
    metalness: 0.2
  });
  const sculpture = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.2, 12, 48), sculptureMat);
  sculpture.position.set(-12, 3.5, 10);
  sculpture.rotation.x = Math.PI / 2.8;
  scene.add(sculpture);

  const planterMat = new THREE.MeshStandardMaterial({
    color: 0x2b3b2f,
    roughness: 0.8
  });
  const planter = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1, 16), planterMat);
  planter.position.set(12, 0.5, 6);
  scene.add(planter);

  const leavesMat = new THREE.MeshStandardMaterial({
    color: 0x3a7a3a,
    roughness: 0.9
  });
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(2, 12, 12), leavesMat);
  leaves.position.set(12, 2.4, 6);
  scene.add(leaves);
}
