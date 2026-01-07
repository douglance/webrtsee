import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { PoseMessage } from './proto/pose.js';

const overlay = document.getElementById('overlay');
const joinBtn = document.getElementById('joinBtn');
const roomInput = document.getElementById('roomInput');
const statusEl = document.getElementById('status');
const controlsHint = document.getElementById('controlsHint');
const localVideo = document.getElementById('localVideo');
const shareBtn = document.getElementById('shareBtn');
const moveShareBtn = document.getElementById('moveShareBtn');
const shareLinkInput = document.getElementById('shareLink');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const muteBtn = document.getElementById('muteBtn');
const masterVolume = document.getElementById('masterVolume');
const volumePopup = document.getElementById('volumePopup');
const popupPeerName = document.getElementById('popupPeerName');
const peerVolume = document.getElementById('peerVolume');
const mutePeerBtn = document.getElementById('mutePeerBtn');

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
const STANDING_HEIGHT = 1.6;
const CROUCH_HEIGHT = 0.9;
const JUMP_HEIGHT = 0.8;
const JUMP_DURATION = 0.4;

let jumpStartTime = 0;
let currentHeight = STANDING_HEIGHT;
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();

const lastPose = {
  position: new THREE.Vector3(),
  yaw: 0,
  pitch: 0
};
let lastPoseSent = 0;

setupLobby();
initScene();
animate();

joinBtn.addEventListener('click', () => {
  if (joined) {
    return;
  }
  joinExperience();
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
  popupPeerName.textContent = `Peer ${peerId.slice(0, 6)}`;
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
  scene.background = new THREE.Color(0x87c9ff);
  scene.fog = new THREE.Fog(0x87c9ff, 25, 140);

  camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    260
  );

  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new PointerLockControls(camera, renderer.domElement);
  controls.getObject().position.set(0, STANDING_HEIGHT, 18);
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
    hideVolumePopup();
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

  localStream = new MediaStream(localMediaStream.getVideoTracks());
  localVideo.srcObject = localMediaStream;
  playVideoElement(localVideo);
  createLocalAudioStream(localMediaStream);
  overlay.classList.add('hidden');
  joined = true;
  shareBtn.disabled = false;
  muteBtn.disabled = false;
  masterVolume.disabled = false;
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
        const peerId = msg.id;
        ensureRemoteAvatar(peerId);
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
    hitbox: board
  };

  board.userData.peerId = peerId;

  remoteAvatars.set(peerId, avatar);
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
  const channel = poseChannels.get(peerId);
  if (channel) {
    channel.close();
    poseChannels.delete(peerId);
  }
  poseInterpolators.delete(peerId);
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
    controlsHint.textContent = 'Drag the screen to move it';
    hideVolumePopup();
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

  remoteAvatars.forEach((avatar, peerId) => {
    const interp = poseInterpolators.get(peerId);
    if (!interp || interp.poses.length === 0) {
      return;
    }

    if (interp.poses.length === 1) {
      const p = interp.poses[0].pose;
      avatar.group.position.set(p.x, p.y, p.z);
      avatar.group.rotation.set(p.pitch || 0, (p.yaw || 0) + Math.PI, 0);
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
    const yaw = p0.pose.yaw + (p1.pose.yaw - p0.pose.yaw) * t;
    const pitch = p0.pose.pitch + (p1.pose.pitch - p0.pose.pitch) * t;

    avatar.group.position.set(x, y, z);
    avatar.group.rotation.set(pitch, yaw + Math.PI, 0);
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

function maybeSendPose() {
  if (!joined) {
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
    let targetHeight = moveState.crouch ? CROUCH_HEIGHT : STANDING_HEIGHT;

    if (moveState.jumping) {
      const jumpElapsed = (performance.now() - jumpStartTime) / 1000;
      if (jumpElapsed < JUMP_DURATION) {
        const jumpProgress = jumpElapsed / JUMP_DURATION;
        const jumpOffset = JUMP_HEIGHT * Math.sin(jumpProgress * Math.PI);
        targetHeight += jumpOffset;
      } else {
        moveState.jumping = false;
      }
    }

    currentHeight = targetHeight;
    controls.getObject().position.y = currentHeight;
  }

  updateAudioListenerPosition();
  updateInterpolatedAvatars();
  updateShareFacing();
  updateSpeakingIndicators();
  updateVolumePopupPosition();
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
    case 'ShiftLeft':
    case 'ShiftRight':
      moveState.crouch = true;
      break;
    case 'Space':
      if (!moveState.jumping) {
        moveState.jumping = true;
        jumpStartTime = performance.now();
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
      moveState.crouch = false;
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

  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.12, 8), seatMat);
  seat.position.y = 0.6;
  chair.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.12), seatMat);
  back.position.set(0, 0.95, -0.25);
  chair.add(back);

  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6),
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
  const sculpture = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.2, 8, 24), sculptureMat);
  sculpture.position.set(-12, 3.5, 10);
  sculpture.rotation.x = Math.PI / 2.8;
  scene.add(sculpture);

  const planterMat = new THREE.MeshStandardMaterial({
    color: 0x2b3b2f,
    roughness: 0.8
  });
  const planter = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1, 10), planterMat);
  planter.position.set(12, 0.5, 6);
  scene.add(planter);

  const leavesMat = new THREE.MeshStandardMaterial({
    color: 0x3a7a3a,
    roughness: 0.9
  });
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 8), leavesMat);
  leaves.position.set(12, 2.4, 6);
  scene.add(leaves);
}
