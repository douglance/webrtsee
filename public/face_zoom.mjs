const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/face_detector.tflite';
const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const VISION_IMPORTS = [
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs',
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest'
];
const DEFAULTS = {
  padding: 0.4,
  smoothing: 0.2,
  detectIntervalMs: 80,
  targetFps: 30,
  minConfidence: 0.5,
  minSuppression: 0.3
};

export function createFaceZoomProcessor(inputStream, options = {}) {
  if (!inputStream) {
    return null;
  }
  const canvas = document.createElement('canvas');
  if (typeof canvas.captureStream !== 'function') {
    console.warn('[FaceZoom] canvas.captureStream not supported');
    return null;
  }
  return new FaceZoomProcessor(inputStream, options);
}

class FaceZoomProcessor {
  constructor(inputStream, options) {
    this.options = { ...DEFAULTS, ...options };
    this.inputStream = inputStream;
    this.enabled = false;
    this.running = true;
    this.detecting = false;
    this.lastDetectTime = 0;
    this.targetBox = null;
    this.smoothBox = null;
    this.faceDetector = null;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    if (this.ctx) {
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
    }
    this.setInitialCanvasSize();
    this.stream = this.canvas.captureStream(this.options.targetFps);

    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = inputStream;
    this.video.addEventListener('loadedmetadata', () => {
      this.video.play().catch(() => {});
    });
    this.video.play().catch(() => {});

    this.ready = this.initDetector();
    this.render = this.render.bind(this);
    this.rafId = requestAnimationFrame(this.render);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) {
      this.targetBox = null;
    }
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
  }

  setInitialCanvasSize() {
    const track = this.inputStream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    const width = Math.floor(settings.width || 0);
    const height = Math.floor(settings.height || 0);
    if (width > 0 && height > 0) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  updateCanvasSize() {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (width > 0 && height > 0) {
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
    }
  }

  async initDetector() {
    const vision = await loadVisionApi();
    if (!vision || !vision.FaceDetector || !vision.FilesetResolver) {
      console.warn('[FaceZoom] MediaPipe vision API unavailable');
      return;
    }
    try {
      const resolver = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
      this.faceDetector = await vision.FaceDetector.createFromOptions(resolver, {
        baseOptions: {
          modelAssetPath: MODEL_URL
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: this.options.minConfidence,
        minSuppressionThreshold: this.options.minSuppression
      });
    } catch (err) {
      console.warn('[FaceZoom] Failed to initialize face detector', err);
    }
  }

  async runDetection(timestamp, frameWidth, frameHeight) {
    if (!this.faceDetector || this.detecting) {
      return;
    }
    this.detecting = true;
    try {
      const result = await this.faceDetector.detectForVideo(this.video, timestamp);
      const faceBox = pickLargestBox(result && result.detections, frameWidth, frameHeight);
      if (faceBox) {
        this.targetBox = expandBox(
          faceBox,
          frameWidth,
          frameHeight,
          this.options.padding
        );
      } else {
        this.targetBox = fullFrameBox(frameWidth, frameHeight);
      }
    } catch (err) {
      console.warn('[FaceZoom] Face detection error', err);
    } finally {
      this.detecting = false;
    }
  }

  render(timestamp) {
    if (!this.running) {
      return;
    }
    if (this.video.readyState >= 2 && this.ctx) {
      this.updateCanvasSize();
      const width = this.canvas.width;
      const height = this.canvas.height;
      if (width > 0 && height > 0) {
        if (
          this.enabled &&
          this.faceDetector &&
          timestamp - this.lastDetectTime >= this.options.detectIntervalMs
        ) {
          this.lastDetectTime = timestamp;
          this.runDetection(timestamp, width, height);
        } else if (!this.enabled) {
          this.targetBox = fullFrameBox(width, height);
        }
        const fallback = fullFrameBox(width, height);
        const target = this.targetBox || fallback;
        this.smoothBox = smoothBox(this.smoothBox, target, this.options.smoothing);
        const box = this.smoothBox || target;
        this.ctx.drawImage(
          this.video,
          box.x,
          box.y,
          box.w,
          box.h,
          0,
          0,
          width,
          height
        );
      }
    }
    this.rafId = requestAnimationFrame(this.render);
  }
}

async function loadVisionApi() {
  const globalApi =
    globalThis.vision ||
    globalThis.tasksVision ||
    globalThis.TasksVision ||
    globalThis.mediapipeTasksVision;
  if (globalApi && globalApi.FaceDetector && globalApi.FilesetResolver) {
    return globalApi;
  }
  for (const url of VISION_IMPORTS) {
    try {
      const mod = await import(url);
      const api = mod.default || mod;
      if (api && api.FaceDetector && api.FilesetResolver) {
        return api;
      }
    } catch (err) {
      console.warn('[FaceZoom] Failed to load MediaPipe Tasks Vision', err);
    }
  }
  return null;
}

function pickLargestBox(detections, frameWidth, frameHeight) {
  if (!Array.isArray(detections) || detections.length === 0) {
    return null;
  }
  let best = null;
  let bestArea = 0;
  detections.forEach((detection) => {
    const raw = extractBox(detection);
    if (!raw) {
      return;
    }
    let { x, y, w, h } = raw;
    if (w <= 1 && h <= 1) {
      x *= frameWidth;
      y *= frameHeight;
      w *= frameWidth;
      h *= frameHeight;
    }
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = { x, y, w, h };
    }
  });
  if (!best || best.w <= 0 || best.h <= 0) {
    return null;
  }
  return best;
}

function extractBox(detection) {
  const box = detection && detection.boundingBox;
  if (!box) {
    return null;
  }
  const originX = readNumber(box.originX, box.xMin, box.xmin, box.left);
  const originY = readNumber(box.originY, box.yMin, box.ymin, box.top);
  let width = readNumber(box.width);
  let height = readNumber(box.height);
  const maxX = readNumber(box.xMax, box.xmax, box.right);
  const maxY = readNumber(box.yMax, box.ymax, box.bottom);

  const x = Number.isFinite(originX) ? originX : 0;
  const y = Number.isFinite(originY) ? originY : 0;
  if (!Number.isFinite(width) && Number.isFinite(maxX)) {
    width = maxX - x;
  }
  if (!Number.isFinite(height) && Number.isFinite(maxY)) {
    height = maxY - y;
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  return { x, y, w: width, h: height };
}

function expandBox(box, frameWidth, frameHeight, padding) {
  const aspect = frameWidth / frameHeight;
  let centerX = box.x + box.w * 0.5;
  let centerY = box.y + box.h * 0.5;
  let width = box.w * (1 + padding);
  let height = box.h * (1 + padding);

  if (width / height < aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }

  width = Math.min(width, frameWidth);
  height = Math.min(height, frameHeight);

  const halfW = width * 0.5;
  const halfH = height * 0.5;
  centerX = clamp(centerX, halfW, frameWidth - halfW);
  centerY = clamp(centerY, halfH, frameHeight - halfH);

  return {
    x: centerX - halfW,
    y: centerY - halfH,
    w: width,
    h: height
  };
}

function fullFrameBox(width, height) {
  return { x: 0, y: 0, w: width, h: height };
}

function smoothBox(current, target, smoothing) {
  if (!current) {
    return { ...target };
  }
  const t = clamp(smoothing, 0, 1);
  current.x = lerp(current.x, target.x, t);
  current.y = lerp(current.y, target.y, t);
  current.w = lerp(current.w, target.w, t);
  current.h = lerp(current.h, target.h, t);
  return current;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}
