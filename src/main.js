import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { initGemini, sendMessage, sendFunctionResponse, onText, onFunctionCall } from './gemini.js';
import { initGestures, startCamera, stopCamera, isGesturesActive, recalibrateHead } from './gestures.js';

// ── Renderer ─────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);

// Camera — FOV 75, matching Spark editor
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(0, 0, 1);

// ── OrbitControls ────────────────────────────────────────────

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.target.set(0, 0, 0);
controls.minDistance = 0.1;
controls.maxDistance = 15;
controls.autoRotate = false;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.enablePan = true;
controls.maxPolarAngle = Math.PI * 0.85;
controls.minPolarAngle = Math.PI * 0.15;

// ── Collider for Raycasting ──────────────────────────────────

const raycaster = new THREE.Raycaster();
raycaster.far = 50;
const colliderMeshes = [];
let colliderLoaded = false;

function loadCollider(url) {
  colliderMeshes.length = 0;
  colliderLoaded = false;
  const loader = new GLTFLoader();
  loader.load(url, (gltf) => {
    const collider = gltf.scene;
    // Apply same quaternion flip as the splat
    collider.quaternion.set(1, 0, 0, 0);
    collider.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshBasicMaterial({
          transparent: true, opacity: 0, depthWrite: false, colorWrite: false,
          side: THREE.DoubleSide
        });
        colliderMeshes.push(child);
      }
    });
    scene.add(collider);
    colliderLoaded = true;
    console.log('[Oracle] Collider loaded:', colliderMeshes.length, 'meshes');
  });
}

// ── Worlds ───────────────────────────────────────────────────

const WORLDS = {
  manhattan: {
    url: 'https://cdn.marble.worldlabs.ai/50134904-97be-496d-80b2-7b26e7340590/a9ceecb6-54d7-482b-9404-a9d3dd62a470_ceramic_500k.spz',
    camY: 0, sky: 0x87CEEB, label: 'Manhattan Fifth Ave (HQ)',
    collider: 'https://cdn.marble.worldlabs.ai/50134904-97be-496d-80b2-7b26e7340590/cd554cce.glb',
  },
  temple: {
    url: 'https://cdn.marble.worldlabs.ai/aadaf92f-0932-4c7d-85ba-9c530827fbae/44a1f5e6-423b-4c36-bbfc-60d6a68348c3_sand_500k.spz',
    camY: 0, sky: 0x2a1a0a, label: 'Ancient Temple',
    collider: null,
  },
  cyberpunk: {
    url: 'https://cdn.marble.worldlabs.ai/7da989cd-642b-4f72-bd81-1457ba36b8bc/3c0121e4-fdef-4ac7-b28b-b1b7134d4b50_sand.spz',
    camY: 0, sky: 0x0a0a1a, label: 'Cyberpunk Rooftop',
    collider: null,
  },
  haunted: {
    url: 'https://storage.googleapis.com/forge-dev-public/hackathon-260227/haunted-house.spz',
    camY: 1, sky: 0x1a1a2a, label: 'Haunted House',
    collider: null,
  },
  cottage: {
    url: 'https://storage.googleapis.com/forge-dev-public/hackathon-260227/cozy_cottage.spz',
    camY: 1, sky: 0x6699CC, label: 'Cozy Cottage',
    collider: null,
  },
  spaceship: {
    url: 'https://storage.googleapis.com/forge-dev-public/hackathon-260227/cozy-spaceship_2.spz',
    camY: 6.5, sky: 0x050510, label: 'Spaceship',
    collider: null,
  },
};

let currentSplat = null, currentWorldName = null, isLoading = false;

function switchWorld(name) {
  const w = WORLDS[name];
  if (!w || isLoading || currentWorldName === name) return;
  isLoading = true;
  const el = document.getElementById('loading');
  if (el) { el.textContent = `entering ${w.label || name}...`; el.style.opacity = '1'; }

  if (currentSplat) { scene.remove(currentSplat); currentSplat.dispose?.(); }

  const splat = new SplatMesh({ url: w.url });

  // *** THE FIX: Every Spark example does this — OpenCV to OpenGL convention ***
  splat.quaternion.set(1, 0, 0, 0);

  scene.add(splat);
  currentSplat = splat;
  currentWorldName = name;

  if (w.collider) loadCollider(w.collider);

  scene.background = new THREE.Color(w.sky);

  // Camera at street level, further back
  camera.position.set(0, w.camY - 0.4, 2.5);
  controls.target.set(0, w.camY - 0.4, 0);

  // Reset gesture state
  headYaw = 0; headPitch = 0; handPull = 0;
  sYaw = 0; sPitch = 0; sPull = 0;
  controls.autoRotate = false;

  splat.addEventListener('loaded', () => {
    isLoading = false;
    if (el) el.style.opacity = '0';
    const wi = document.getElementById('world-indicator');
    if (wi) wi.textContent = `dreaming: ${w.label || name}`;
  });
  setTimeout(() => { isLoading = false; if (el) el.style.opacity = '0'; }, 60000);
}

// ── 3D Hands ─────────────────────────────────────────────────

const HAND_BONES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
];
const handJoints = [[], []];
const handLines = [null, null];

function createHandMeshes(idx) {
  const color = idx === 0 ? 0xff9966 : 0x66bbff;
  const joints = [];
  for (let i = 0; i < 21; i++) {
    const isTip = [4, 8, 12, 16, 20].includes(i);
    const geo = new THREE.SphereGeometry(isTip ? 0.004 : 0.002, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isTip ? 0.9 : 0.5 });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    joints.push(m);
  }
  handJoints[idx] = joints;
  const pos = new Float32Array(HAND_BONES.length * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
  lines.visible = false;
  scene.add(lines);
  handLines[idx] = lines;
}
createHandMeshes(0);
createHandMeshes(1);

// ── Spider-Man Web ───────────────────────────────────────────

// Pointer dot — glowing sphere showing where web will land
const pointerGeo = new THREE.SphereGeometry(0.03, 12, 12);
const pointerMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.8 });
const pointerDot = new THREE.Mesh(pointerGeo, pointerMat);
pointerDot.visible = false;
scene.add(pointerDot);

// Web main line — multi-segment bezier (no TubeGeometry per frame)
const WEB_SEGMENTS = 30;
const webMainGeo = new THREE.BufferGeometry();
const webMainPositions = new Float32Array(WEB_SEGMENTS * 3);
webMainGeo.setAttribute('position', new THREE.BufferAttribute(webMainPositions, 3));
const webMainLine = new THREE.Line(webMainGeo, new THREE.LineBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 1.0
}));
webMainLine.visible = false;
scene.add(webMainLine);

// Secondary strands — brighter, more visible
let webTube = null;
const webStrands = [];
for (let i = 0; i < 3; i++) {
  const positions = new Float32Array(17 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.5 });
  const line = new THREE.Line(geo, mat);
  line.visible = false;
  scene.add(line);
  webStrands.push(line);
}

let webActive = false;
let webHandIdx = 0;
let webPointerTarget = new THREE.Vector3();
let webShootStart = 0; // timestamp when web started
const WEB_SHOOT_DURATION = 300; // ms for web to reach target

function updateWeb() {
  if (!webActive) {
    pointerDot.visible = false;
    webMainLine.visible = false;
    webStrands.forEach(s => s.visible = false);
    return;
  }

  const tipJoint = handJoints[webHandIdx][8];
  if (!tipJoint.visible) return;

  const handPos = tipJoint.position.clone();
  const dir = new THREE.Vector3().subVectors(handPos, camera.position).normalize();

  // Raycast to find building surface
  raycaster.set(camera.position, dir);
  const hits = colliderLoaded ? raycaster.intersectObjects(colliderMeshes, false) : [];

  if (hits.length > 0) {
    webPointerTarget.copy(hits[0].point);
  } else {
    webPointerTarget.copy(camera.position).addScaledVector(dir, 4.0); // shorter range
  }

  // Shoot animation — web extends from hand to target over WEB_SHOOT_DURATION
  const shootElapsed = performance.now() - webShootStart;
  const shootProgress = Math.min(shootElapsed / WEB_SHOOT_DURATION, 1.0);
  // Ease out — fast start, slow arrival
  const shootT = 1 - Math.pow(1 - shootProgress, 3);

  // Current web endpoint (animated from hand toward target)
  const currentEnd = handPos.clone().lerp(webPointerTarget, shootT);

  // Pointer dot — only visible once web reaches target
  pointerDot.position.copy(webPointerTarget);
  pointerDot.visible = shootProgress > 0.2;
  const t = performance.now() * 0.005;
  pointerMat.opacity = 0.7 + Math.sin(t) * 0.3;
  pointerDot.scale.setScalar(1.0 + Math.sin(t * 2) * 0.3);

  // Main web line — extends with animation
  const mid = handPos.clone().lerp(currentEnd, 0.5);
  mid.y -= 0.06 * shootT; // sag grows as web extends
  const curve = new THREE.QuadraticBezierCurve3(handPos, mid, currentEnd);
  const pts = curve.getPoints(WEB_SEGMENTS - 1);
  const pos = webMainGeo.attributes.position.array;
  for (let i = 0; i < WEB_SEGMENTS; i++) {
    const p = pts[i];
    const wobble = Math.sin(i / WEB_SEGMENTS * Math.PI) * Math.sin(t * 5 + i * 0.5) * 0.015 * shootT;
    pos[i*3] = p.x + wobble;
    pos[i*3+1] = p.y + wobble;
    pos[i*3+2] = p.z;
  }
  webMainGeo.attributes.position.needsUpdate = true;
  webMainLine.visible = true;

  // Secondary strands — extend with main line
  webStrands.forEach((strand, si) => {
    const offsets = [0.025, -0.025, 0.015];
    const offset = offsets[si] || 0;
    const midOff = mid.clone();
    midOff.x += offset; midOff.z += offset * 0.7;
    const c2 = new THREE.QuadraticBezierCurve3(handPos, midOff, currentEnd);
    const strandPts = c2.getPoints(16);
    const pos = strand.geometry.attributes.position.array;
    for (let j = 0; j < strandPts.length; j++) {
      pos[j*3] = strandPts[j].x;
      pos[j*3+1] = strandPts[j].y;
      pos[j*3+2] = strandPts[j].z;
    }
    strand.geometry.attributes.position.needsUpdate = true;
    strand.visible = true;
  });
}

function updateHandIn3D(idx, landmarks) {
  const joints = handJoints[idx];
  const lines = handLines[idx];
  if (!landmarks) { joints.forEach(j => j.visible = false); lines.visible = false; return; }
  for (let i = 0; i < 21; i++) {
    const lm = landmarks[i];
    const fovScale = camera.fov / 75; // normalize to base FOV
    const wx = -(lm.x - 0.5) * 0.5 * fovScale;
    const wy = -(lm.y - 0.5) * 0.4 * fovScale;
    const p = new THREE.Vector3(wx, wy, -1.0);
    p.applyMatrix4(camera.matrixWorld);
    joints[i].position.copy(p);
    joints[i].visible = true;
  }
  const pos = lines.geometry.attributes.position.array;
  for (let b = 0; b < HAND_BONES.length; b++) {
    const [a, bi] = HAND_BONES[b];
    pos[b*6]=joints[a].position.x; pos[b*6+1]=joints[a].position.y; pos[b*6+2]=joints[a].position.z;
    pos[b*6+3]=joints[bi].position.x; pos[b*6+4]=joints[bi].position.y; pos[b*6+5]=joints[bi].position.z;
  }
  lines.geometry.attributes.position.needsUpdate = true;
  lines.visible = true;
}

// ── Head + Hand → Camera ─────────────────────────────────────
// Head DIRECTLY maps to view angle — realtime POV matching
// No accumulation, no velocity. Head position = camera angle.

let headYaw = 0, headPitch = 0, headRoll = 0, handPull = 0;
let sYaw = 0, sPitch = 0, sRoll = 0, sPull = 0;

// Head parallax offset — applied during render, removed after
let headOffX = 0, headOffY = 0;

function canMove(origin, direction, distance) {
  if (!colliderLoaded || colliderMeshes.length === 0) return true;
  raycaster.set(origin, direction.clone().normalize());
  raycaster.far = distance + 0.3;
  const hits = raycaster.intersectObjects(colliderMeshes, false);
  return !(hits.length > 0 && hits[0].distance < distance + 0.3);
}

function applyGestures(dt) {
  // Smooth follow
  sYaw += (headYaw - sYaw) * 0.15;
  sPitch += (headPitch - sPitch) * 0.15;
  sRoll += (headRoll - sRoll) * 0.12;
  sPull += (handPull - sPull) * 0.12;

  // Dead zone
  if (Math.abs(sYaw) < 0.02) sYaw = 0;
  if (Math.abs(sPitch) < 0.02) sPitch = 0;

  // HEAD = small parallax offset (NOT rotation, NOT orbit)
  // Just shift the camera position slightly based on head, like looking through a window
  // Clamped to small range so it can't do 360 or get stuck
  headOffX = sYaw * 0.4;   // max ±0.4 units sideways
  headOffY = sPitch * 0.3;  // max ±0.3 units vertical

  // HAND → walk
  if (Math.abs(sPull) > 0.03 && !flyAnim) {
    const lookDir = new THREE.Vector3().subVectors(controls.target, camera.position);
    lookDir.y = 0;
    lookDir.normalize();
    const walkSpeed = sPull * dt * 4.0;
    const moveDir = lookDir.clone();
    if (walkSpeed < 0) moveDir.negate();

    if (canMove(camera.position, moveDir, Math.abs(walkSpeed))) {
      const move = lookDir.multiplyScalar(walkSpeed);
      camera.position.add(move);
      controls.target.add(move);
    }
  }
}

// ── Fly-To (smooth camera teleport) ─────────────────────────

let flyAnim = null;
function flyTo(posArr, lookArr, duration = 1.0) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endPos = new THREE.Vector3(posArr[0], posArr[1], posArr[2]);
  const endTarget = new THREE.Vector3(lookArr[0], lookArr[1], lookArr[2]);
  const startTime = performance.now();
  flyAnim = { startPos, startTarget, endPos, endTarget, startTime, duration: duration * 1000 };
}

function tickFly() {
  if (!flyAnim) return;
  const elapsed = performance.now() - flyAnim.startTime;
  let t = Math.min(elapsed / flyAnim.duration, 1.0);
  // Smooth ease-in-out
  t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  camera.position.lerpVectors(flyAnim.startPos, flyAnim.endPos, t);
  controls.target.lerpVectors(flyAnim.startTarget, flyAnim.endTarget, t);

  // Add arc — rise up in the middle of the flight, then come down (swing feel)
  const arcHeight = flyAnim.startPos.distanceTo(flyAnim.endPos) * 0.15;
  const arc = Math.sin(t * Math.PI) * arcHeight;
  camera.position.y += arc;
  controls.target.y += arc;

  // Widen FOV during swing for speed feel
  camera.fov = 75 + arc * 20;
  camera.updateProjectionMatrix();

  if (t >= 1.0) {
    baseAzimuth = controls.getAzimuthalAngle();
    basePolar = controls.getPolarAngle();
    flyAnim = null;
    // Reset FOV
    camera.fov = 75;
    camera.updateProjectionMatrix();
  }
}

// ── Render ───────────────────────────────────────────────────

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  applyGestures(Math.min(Math.max(clock.getDelta(), 0.005), 0.05));
  tickFly();
  // Floor clamp BEFORE controls to prevent temporary clipping
  if (currentWorldName && WORLDS[currentWorldName]) {
    const floorY = WORLDS[currentWorldName].camY;
    if (camera.position.y < floorY) camera.position.y = floorY;
    if (controls.target.y < floorY) controls.target.y = floorY;
  }
  controls.update();
  // Floor clamp
  if (currentWorldName && WORLDS[currentWorldName]) {
    const floorY = WORLDS[currentWorldName].camY - 0.4;
    if (camera.position.y < floorY) camera.position.y = floorY;
    if (controls.target.y < floorY) controls.target.y = floorY;
  }
  // Push away from walls (4 directions)
  if (colliderLoaded && colliderMeshes.length > 0 && !flyAnim) {
    const wallDist = 0.3;
    const dirs = [
      new THREE.Vector3(1,0,0), new THREE.Vector3(-1,0,0),
      new THREE.Vector3(0,0,1), new THREE.Vector3(0,0,-1),
    ];
    for (const d of dirs) {
      raycaster.set(camera.position, d);
      raycaster.far = wallDist;
      const hits = raycaster.intersectObjects(colliderMeshes, false);
      if (hits.length > 0 && hits[0].distance < wallDist) {
        const push = wallDist - hits[0].distance;
        camera.position.addScaledVector(d, -push);
        controls.target.addScaledVector(d, -push);
      }
    }
  }
  updateWeb();
  // Apply head tracking for render only — position + tilt
  camera.position.x += headOffX;
  camera.position.y += headOffY;
  const savedRotX = camera.rotation.x;
  const savedRotZ = camera.rotation.z;
  camera.rotation.x += sPitch * 0.15;  // head up/down = camera tilts up/down
  camera.rotation.z = -sRoll * 0.6;    // head tilt = camera rolls
  renderer.render(scene, camera);
  camera.position.x -= headOffX;
  camera.position.y -= headOffY;
  camera.rotation.x = savedRotX;
  camera.rotation.z = savedRotZ;
}
animate();

switchWorld('manhattan');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Gestures ─────────────────────────────────────────────────

const worldNames = Object.keys(WORLDS);
let worldIdx = 0;
function nextWorld() { worldIdx = (worldIdx + 1) % worldNames.length; switchWorld(worldNames[worldIdx]); showToast(worldNames[worldIdx].toUpperCase()); }
function showToast(t) { const el = document.getElementById('toast'); if (!el) return; el.textContent = t; el.classList.add('v'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('v'), 1200); }

initGestures({
  onHeadLook: (yaw, pitch, roll) => { headYaw = yaw; headPitch = pitch; headRoll = roll || 0; },
  onRightHand: (pull) => { handPull = pull; },
  onLeftHand: () => {},
  onFist: nextWorld,
  onPalmDown: () => {},
  onSpiderMan: (handIdx, active) => {
    console.log('[Spider-Man]', handIdx, active, 'webActive:', webActive);
    if (active) {
      if (webActive) return;
      webActive = true;
      webHandIdx = handIdx;
      webShootStart = performance.now();
      showToast('WEB!');
    } else {
      if (!webActive) return; // already released
      webActive = false;
      webMainLine.visible = false;
      webStrands.forEach(s => s.visible = false);
      pointerDot.visible = false;

      const target = webPointerTarget.clone();
      // Offset slightly back from the surface so you don't clip into the building
      const dir = new THREE.Vector3().subVectors(camera.position, target).normalize();
      target.addScaledVector(dir, 0.3);

      // Clamp web teleport target above floor
      const floorY = WORLDS[currentWorldName]?.camY || 0;
      if (target.y < floorY) target.y = floorY;

      // Check if path is clear
      const flyDir = new THREE.Vector3().subVectors(target, camera.position).normalize();
      const flyDist = camera.position.distanceTo(target);
      if (!canMove(camera.position, flyDir, flyDist)) {
        // Find the wall hit point and stop there
        raycaster.set(camera.position, flyDir);
        raycaster.far = flyDist;
        const hits = raycaster.intersectObjects(colliderMeshes, false);
        if (hits.length > 0) {
          target.copy(hits[0].point);
          target.addScaledVector(flyDir, -0.5); // back off 0.5 from wall
        }
      }

      // Look direction = forward from new position (maintain current look direction roughly)
      const lookDir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
      const lookTarget = target.clone().add(lookDir);

      flyTo([target.x, target.y, target.z], [lookTarget.x, lookTarget.y, lookTarget.z], 1.5);
      showToast('THWIP!');
    }
  },
  onHandsUpdate: (states) => {
    updateHandIn3D(0, states[0].landmarks);
    updateHandIn3D(1, states[1].landmarks);
    if (!states[0].landmarks) handPull = 0;
    const el = document.getElementById('gesture-label');
    if (!el) return;
    const p = [];
    if (Math.abs(headYaw) > 0.02) p.push('LOOKING');
    if (states[0].landmarks) p.push(states[0].gestureLabel);
    el.textContent = p.join(' · ');
    el.style.opacity = p.length ? '1' : '0';
  },
});

setTimeout(async () => {
  try { await startCamera(); const b = document.getElementById('hands-btn'); if (b) { b.classList.add('active'); b.textContent = 'tracking on'; } }
  catch (e) { console.warn('Camera:', e); }
}, 1000);

document.getElementById('hands-btn')?.addEventListener('click', async () => {
  const btn = document.getElementById('hands-btn');
  if (isGesturesActive()) {
    stopCamera(); btn.classList.remove('active'); btn.textContent = 'tracking';
    headYaw = 0; headPitch = 0; handPull = 0; sYaw = 0; sPitch = 0; sPull = 0;
    controls.autoRotate = false;
  } else {
    btn.textContent = 'loading...';
    try { await startCamera(); btn.classList.add('active'); btn.textContent = 'tracking on'; }
    catch(e) { btn.textContent = 'tracking'; }
  }
});

// ── Voice + Chat ─────────────────────────────────────────────

let recog = null, listening = false;
const micBtn = document.getElementById('mic-btn');
micBtn?.addEventListener('click', () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  if (listening && recog) { recog.stop(); return; }
  recog = new SR(); recog.continuous = false; recog.lang = 'en-US';
  recog.onstart = () => { listening = true; micBtn?.classList.add('listening'); };
  recog.onresult = (e) => { addMsg(e.results[0][0].transcript, 'user'); sendMessage(e.results[0][0].transcript); };
  recog.onend = () => { listening = false; micBtn?.classList.remove('listening'); };
  recog.onerror = () => { listening = false; micBtn?.classList.remove('listening'); };
  recog.start();
});

const chatMsgs = document.getElementById('chat-messages');
const chatIn = document.getElementById('chat-input');
function addMsg(t, s = 'oracle') {
  if (!chatMsgs) return;
  const d = document.createElement('div');
  d.className = `msg msg-${s}`; d.textContent = t;
  chatMsgs.appendChild(d); chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

document.getElementById('connect-btn')?.addEventListener('click', async () => {
  const key = prompt('Gemini API key:');
  if (!key) return;
  const btn = document.getElementById('connect-btn');
  btn.textContent = 'connecting...';
  try {
    await initGemini(key);
    document.getElementById('status-dot').style.background = '#4ade80';
    btn.textContent = 'connected';
    onText(t => addMsg(t, 'oracle'));
    onFunctionCall(fn => { if (fn.name === 'change_world') switchWorld(fn.args.world_name); sendFunctionResponse(fn.name, 'done'); });
    addMsg('I am here.', 'oracle');
  } catch (e) { btn.textContent = 'retry'; }
});

chatIn?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && chatIn.value.trim()) { addMsg(chatIn.value.trim(), 'user'); sendMessage(chatIn.value.trim()); chatIn.value = ''; }
});

window.oracle = { switchWorld, nextWorld, recalibrateHead, worlds: WORLDS, scene, camera, renderer, controls };
