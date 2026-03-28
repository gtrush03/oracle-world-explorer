/**
 * Gesture Control System for Oracle
 *
 * HEAD (FaceMesh) = LOOK ONLY
 *   Turn head left/right -> yaw
 *   Tilt head up/down -> pitch
 *   Auto-calibrates on first detection
 *   RAW clamped output (smoothing handled by main.js)
 *
 * RIGHT HAND = ZOOM (pull in / push out)
 *   Hand up (Y < 0.3) = pull in (+)
 *   Hand down (Y > 0.7) = push out (-)
 *   Middle zone = neutral
 *   Fist held 300ms = switch world
 *   EMA smoothing at 0.12
 *
 * LEFT HAND = PAN
 *   Position maps to pan direction
 *   Palm flat = next waypoint
 *   EMA smoothing at 0.12
 */

// ── Constants ───────────────────────────────────────────────

const HAND_SMOOTH = 0.25;   // EMA alpha for hands
// HEAD_SMOOTH removed — main.js handles all head smoothing via lerp
const FIST_HOLD_MS = 300;
const FIST_COOLDOWN_MS = 1500;
const PALM_FLAT_THRESH = 0.035;
const PALM_RELEASE_THRESH = 0.065;
const PALM_COOLDOWN_MS = 1200;
const HEAD_CLAMP_LO = 0.15;
const HEAD_CLAMP_HI = 0.85;
const HEAD_YAW_SCALE = 8.0;   // moderate turn ≈ 0.7, full turn clips at 1.0
const HEAD_PITCH_SCALE = 6.0;  // pitch has less range than yaw
const ZOOM_DEAD_LO = 0.4;     // hand slightly above center = forward
const ZOOM_DEAD_HI = 0.6;     // hand slightly below center = backward

// ── State ───────────────────────────────────────────────────

const handStates = [
  // index 0 = Right hand
  {
    label: 'R',
    landmarks: null,
    sx: 0.5,
    sy: 0.5,
    gestureLabel: '',
    fistPending: false,
    fistStart: 0,
    fistCooldown: 0,
    spiderManActive: false,
    spiderManStart: 0,
  },
  // index 1 = Left hand
  {
    label: 'L',
    landmarks: null,
    sx: 0.5,
    sy: 0.5,
    gestureLabel: '',
    palmDownActive: false,
    palmCooldown: 0,
    spiderManActive: false,
    spiderManStart: 0,
  },
];

const headState = {
  sx: 0.5,
  sy: 0.5,
  detected: false,
  calibrated: false,
  baseX: 0.5,
  baseY: 0.5,
  lostTime: 0,
};

// ── Callbacks ───────────────────────────────────────────────

let cbHeadLook = null;     // (yaw, pitch)
let cbRightHand = null;    // (pullValue)
let cbLeftHand = null;     // (panX, panY)
let cbFist = null;         // ()
let cbPalmDown = null;     // ()
let cbSpiderMan = null;    // (handIdx, active)
let cbHandsUpdate = null;  // (handStates, headState)

// ── DOM / instances ─────────────────────────────────────────

let camEl = null;
let camCanvas = null;
let camCtx = null;
let handsInstance = null;
let faceMeshInstance = null;
let cameraInstance = null;
let active = false;

// Store the latest face landmarks for overlay drawing (decoupled from hands)
let latestFaceLandmarks = null;

// ── EMA helper ──────────────────────────────────────────────

function ema(prev, next, alpha) {
  return prev + alpha * (next - prev);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── Hand Processing ─────────────────────────────────────────

function processHands(results) {
  const now = performance.now();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    handStates[0].landmarks = null;
    handStates[1].landmarks = null;
    handStates[0].gestureLabel = '';
    handStates[1].gestureLabel = '';
    handStates[0].fistPending = false;
    // Fire release callbacks if gestures were active
    if (handStates[0].spiderManActive && cbSpiderMan) cbSpiderMan(0, false);
    if (handStates[1].spiderManActive && cbSpiderMan) cbSpiderMan(1, false);
    handStates[0].spiderManActive = false;
    handStates[0].spiderManStart = 0;
    handStates[1].palmDownActive = false;
    handStates[1].spiderManActive = false;
    handStates[1].spiderManStart = 0;
    drawOverlay();
    if (cbHandsUpdate) cbHandsUpdate(handStates, headState);
    return;
  }

  const hands = results.multiHandLandmarks;
  const labels = results.multiHandedness;

  if (hands.length === 1) {
    // MediaPipe handedness is mirrored: "Right" in camera = user's left hand
    // But we also use X position as fallback
    let idx;
    if (labels && labels[0]) {
      // MediaPipe labels are mirrored: "Right" = user's right when camera is mirrored
      // Since camera is mirrored for selfie, "Right" label = right hand (index 0)
      idx = labels[0].label === 'Right' ? 0 : 1;
    } else {
      idx = hands[0][0].x < 0.5 ? 0 : 1;
    }
    assignHand(hands[0], idx, now);
    const other = 1 - idx;
    handStates[other].landmarks = null;
    handStates[other].gestureLabel = '';
    if (other === 0) handStates[0].fistPending = false;
    if (other === 1) handStates[1].palmDownActive = false;
  } else {
    // Two hands: use X position to determine which is left/right
    const [a, b] = hands[0][0].x < hands[1][0].x ? [0, 1] : [1, 0];
    assignHand(hands[a], 0, now);
    assignHand(hands[b], 1, now);
  }

  drawOverlay();
  if (cbHandsUpdate) cbHandsUpdate(handStates, headState);
}

function assignHand(lm, idx, now) {
  const s = handStates[idx];
  s.sx = ema(s.sx, lm[0].x, HAND_SMOOTH);
  s.sy = ema(s.sy, lm[0].y, HAND_SMOOTH);
  s.landmarks = lm;

  if (idx === 0) {
    processRightHand(lm, s, now);
  } else {
    processLeftHand(lm, s, now);
  }
}

function processRightHand(lm, s, now) {
  // Zoom: map smoothed Y to pull value with dead zone in middle
  let pull = 0;
  if (s.sy < ZOOM_DEAD_LO) {
    // Hand up = pull in (positive)
    pull = (ZOOM_DEAD_LO - s.sy) / ZOOM_DEAD_LO; // 0 to 1
  } else if (s.sy > ZOOM_DEAD_HI) {
    // Hand down = push out (negative)
    pull = -(s.sy - ZOOM_DEAD_HI) / (1.0 - ZOOM_DEAD_HI); // 0 to -1
  }
  pull = clamp(pull, -1, 1);

  if (cbRightHand) cbRightHand(pull);

  if (pull > 0.1) {
    s.gestureLabel = 'PULL IN';
  } else if (pull < -0.1) {
    s.gestureLabel = 'PUSH OUT';
  } else {
    s.gestureLabel = 'READY';
  }

  // Fist detection: all fingertips below wrist Y
  const wristY = lm[0].y;
  const isFist = [8, 12, 16, 20].every(i => lm[i].y > wristY);

  if (isFist) {
    if (!s.fistPending) {
      s.fistPending = true;
      s.fistStart = now;
    }
    if (
      s.fistPending &&
      now - s.fistStart >= FIST_HOLD_MS &&
      now - s.fistCooldown > FIST_COOLDOWN_MS
    ) {
      s.fistCooldown = now;
      s.gestureLabel = 'SWITCH!';
      if (cbFist) cbFist();
    }
  } else {
    s.fistPending = false;
  }

  // Spider-Man pose: index + pinky up, middle + ring down (forgiving thresholds)
  const isSpiderMan = !isFist &&
    lm[8].y < wristY + 0.02 &&    // index roughly above wrist (forgiving)
    lm[20].y < wristY + 0.02 &&   // pinky roughly above wrist
    lm[12].y > wristY - 0.02 &&   // middle roughly below wrist
    lm[16].y > wristY - 0.02;     // ring roughly below wrist

  if (isSpiderMan && !s.spiderManActive) {
    if (!s.spiderManStart) s.spiderManStart = now;
    // Show charging circle while holding (100ms hold)
    const holdProgress = Math.min((now - s.spiderManStart) / 50, 1.0);
    s.gestureLabel = holdProgress < 1 ? 'CHARGING...' : 'WEB!';
    if (holdProgress >= 1.0) {
      s.spiderManActive = true;
      if (cbSpiderMan) cbSpiderMan(0, true);
    }
  } else if (!isSpiderMan) {
    s.spiderManStart = 0;
    if (s.spiderManActive) {
      s.spiderManActive = false;
      s.gestureLabel = '';
      if (cbSpiderMan) cbSpiderMan(0, false);
    }
  }

  if (s.spiderManActive) s.gestureLabel = 'WEB!';
}

function processLeftHand(lm, s, now) {
  // Pan: map smoothed position to -1..+1
  const px = (1 - s.sx - 0.5) * 2.0; // mirror + center
  const py = (s.sy - 0.5) * 2.0;

  if (cbLeftHand) cbLeftHand(clamp(px, -1, 1), clamp(py, -1, 1));
  s.gestureLabel = 'PAN';

  // Palm flat detection: wrist Y close to MCP Y (landmark 9)
  const yDelta = Math.abs(lm[0].y - lm[9].y);

  if (yDelta < PALM_FLAT_THRESH && !s.palmDownActive) {
    s.palmDownActive = true;
    if (now - s.palmCooldown > PALM_COOLDOWN_MS) {
      s.palmCooldown = now;
      s.gestureLabel = 'WAYPOINT!';
      if (cbPalmDown) cbPalmDown();
    }
  } else if (yDelta > PALM_RELEASE_THRESH && s.palmDownActive) {
    s.palmDownActive = false;
  }

  if (s.palmDownActive) {
    s.gestureLabel = 'WAYPOINT';
  }

  // Left hand: NO spider-man. Instead, X position = orbit rotation
  // Already handled by cbLeftHand(px, py) above
}

// ── Face Processing ─────────────────────────────────────────

function processFace(results) {
  if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
    headState.detected = false;
    latestFaceLandmarks = null;
    if (!headState.lostTime) headState.lostTime = performance.now();
    // Auto-recalibrate if lost for >500ms
    if (performance.now() - headState.lostTime > 500) {
      headState.calibrated = false;
    }
    if (cbHeadLook) cbHeadLook(0, 0, 0);
    return;
  }
  // When face detected, clear lost timer:
  headState.lostTime = 0;

  const lm = results.multiFaceLandmarks[0];
  latestFaceLandmarks = lm;

  // Compute face center from inner eye corners + nose tip
  const le = lm[133]; // left inner eye corner
  const re = lm[362]; // right inner eye corner
  const nose = lm[1]; // nose tip

  const rawX = (le.x + re.x + nose.x) / 3;
  const rawY = (le.y + re.y + nose.y) / 3;

  // Clamp raw values to stable range
  const cx = clamp(rawX, HEAD_CLAMP_LO, HEAD_CLAMP_HI);
  const cy = clamp(rawY, HEAD_CLAMP_LO, HEAD_CLAMP_HI);

  // Auto-calibrate: first detection = center
  if (!headState.calibrated) {
    headState.baseX = cx;
    headState.baseY = cy;
    headState.sx = cx;
    headState.sy = cy;
    headState.calibrated = true;
  }

  // Use raw clamped values directly (no EMA — main.js handles smoothing via lerp)
  headState.sx = cx;
  headState.sy = cy;
  headState.detected = true;

  // Compute yaw/pitch relative to calibration center, clamped to -1..+1
  // Positive yaw = head moved right in real life (sx decreased in mirrored cam)
  // Positive pitch = head moved down in real life (sy increased)
  const yaw = clamp((headState.baseX - headState.sx) * HEAD_YAW_SCALE, -1, 1);
  const pitch = clamp((headState.sy - headState.baseY) * HEAD_PITCH_SCALE, -1, 1);

  // Head tilt (roll) — angle between the two eyes
  const eyeDx = re.x - le.x;
  const eyeDy = re.y - le.y;
  const roll = Math.atan2(eyeDy, eyeDx); // radians, 0 = level

  if (cbHeadLook) cbHeadLook(yaw, pitch, roll);
}

// ── Webcam Overlay ──────────────────────────────────────────

const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16],// ring
  [0, 17], [17, 18], [18, 19], [19, 20],// pinky
  [5, 9], [9, 13], [13, 17],            // palm
];

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10,
];

const FACE_KEY_POINTS = [133, 362, 1, 33, 263, 10, 152];

function drawOverlay() {
  if (!camCanvas || !camCtx) return;
  const w = camCanvas.width;
  const h = camCanvas.height;
  camCtx.clearRect(0, 0, w, h);

  // ── Face overlay ──
  const faceLm = latestFaceLandmarks;
  if (faceLm) {
    // Face oval outline
    camCtx.strokeStyle = 'rgba(74, 222, 128, 0.3)';
    camCtx.lineWidth = 1;
    camCtx.beginPath();
    for (let n = 0; n < FACE_OVAL.length; n++) {
      const px = (1 - faceLm[FACE_OVAL[n]].x) * w;
      const py = faceLm[FACE_OVAL[n]].y * h;
      if (n === 0) camCtx.moveTo(px, py);
      else camCtx.lineTo(px, py);
    }
    camCtx.stroke();

    // Key landmark dots (eyes, nose, forehead, chin)
    camCtx.fillStyle = '#4ade80';
    for (const i of FACE_KEY_POINTS) {
      camCtx.beginPath();
      camCtx.arc((1 - faceLm[i].x) * w, faceLm[i].y * h, 3, 0, Math.PI * 2);
      camCtx.fill();
    }

    // Smoothed center crosshair
    const cx = (1 - headState.sx) * w;
    const cy = headState.sy * h;
    camCtx.strokeStyle = 'rgba(74, 222, 128, 0.5)';
    camCtx.lineWidth = 1;
    camCtx.beginPath();
    camCtx.moveTo(cx - 12, cy);
    camCtx.lineTo(cx + 12, cy);
    camCtx.moveTo(cx, cy - 12);
    camCtx.lineTo(cx, cy + 12);
    camCtx.stroke();

    // Calibration center (yellow circle)
    const bx = (1 - headState.baseX) * w;
    const by = headState.baseY * h;
    camCtx.strokeStyle = 'rgba(255, 255, 100, 0.3)';
    camCtx.lineWidth = 1;
    camCtx.beginPath();
    camCtx.arc(bx, by, 8, 0, Math.PI * 2);
    camCtx.stroke();

    // Label
    camCtx.font = '9px monospace';
    camCtx.fillStyle = 'rgba(74, 222, 128, 0.5)';
    camCtx.fillText('HEAD \u2192 LOOK', 4, 12);
  }

  // ── Hand overlays ──
  for (let idx = 0; idx < handStates.length; idx++) {
    const s = handStates[idx];
    if (!s.landmarks) continue;
    const lm = s.landmarks;
    const color = idx === 0 ? '255, 180, 100' : '100, 180, 255'; // orange=right, blue=left

    // Bone connections
    camCtx.strokeStyle = `rgba(${color}, 0.4)`;
    camCtx.lineWidth = 1.5;
    for (const [a, b] of HAND_BONES) {
      camCtx.beginPath();
      camCtx.moveTo((1 - lm[a].x) * w, lm[a].y * h);
      camCtx.lineTo((1 - lm[b].x) * w, lm[b].y * h);
      camCtx.stroke();
    }

    // Joint dots
    camCtx.fillStyle = `rgba(${color}, 0.6)`;
    for (const pt of lm) {
      camCtx.beginPath();
      camCtx.arc((1 - pt.x) * w, pt.y * h, 1.5, 0, Math.PI * 2);
      camCtx.fill();
    }

    // Gesture label at wrist
    camCtx.font = '8px monospace';
    camCtx.fillStyle = s.gestureLabel === 'WEB!' ? 'rgba(255, 50, 50, 0.95)' : `rgba(${color}, 0.8)`;
    camCtx.fillText(s.gestureLabel, (1 - lm[0].x) * w - 20, lm[0].y * h - 8);
  }
}

// ── Public API ──────────────────────────────────────────────

export function initGestures(cb) {
  cbHeadLook = cb.onHeadLook || null;
  cbRightHand = cb.onRightHand || null;
  cbLeftHand = cb.onLeftHand || null;
  cbFist = cb.onFist || null;
  cbPalmDown = cb.onPalmDown || null;
  cbSpiderMan = cb.onSpiderMan || null;
  cbHandsUpdate = cb.onHandsUpdate || null;
}

export function recalibrateHead() {
  headState.calibrated = false;
}

export async function startCamera() {
  if (active) return;

  camEl = document.getElementById('cam');
  camCanvas = document.getElementById('cam-overlay');
  if (!camCanvas) {
    camCanvas = document.createElement('canvas');
    camCanvas.id = 'cam-overlay';
    document.body.appendChild(camCanvas);
  }
  camCanvas.width = 280;
  camCanvas.height = 210;
  camCanvas.style.display = 'block';
  camCtx = camCanvas.getContext('2d');

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
  });
  camEl.srcObject = stream;
  camEl.style.display = 'block';

  // ── MediaPipe Hands ──
  handsInstance = new window.Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
  });
  handsInstance.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.65,
  });
  handsInstance.onResults(processHands);

  // ── MediaPipe FaceMesh ──
  faceMeshInstance = new window.FaceMesh({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${f}`,
  });
  faceMeshInstance.setOptions({
    maxNumFaces: 1,
    refineLandmarks: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  faceMeshInstance.onResults(processFace);

  // ── Camera loop ──
  let frameN = 0;
  cameraInstance = new window.Camera(camEl, {
    onFrame: async () => {
      frameN++;
      // Hands every frame, face every 2nd (face is heavier)
      await handsInstance.send({ image: camEl });
      if (frameN % 2 === 0) await faceMeshInstance.send({ image: camEl });
    },
    width: 640,
    height: 480,
  });
  cameraInstance.start();
  active = true;
}

export function stopCamera() {
  if (cameraInstance) cameraInstance.stop();
  if (camEl && camEl.srcObject) {
    camEl.srcObject.getTracks().forEach(t => t.stop());
    camEl.style.display = 'none';
  }
  if (camCanvas) camCanvas.style.display = 'none';
  active = false;
}

export function isGesturesActive() {
  return active;
}
