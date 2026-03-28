import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { initGemini, sendMessage, sendFunctionResponse, onText, onFunctionCall } from './gemini.js';
import { initGestures, startCamera, stopCamera, isGesturesActive, recalibrateHead } from './gestures.js';

// ── Renderer ─────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
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
controls.dampingFactor = 0.08;
controls.target.set(0, 0, 0);
controls.minDistance = 0.1;
controls.maxDistance = 15;
controls.autoRotate = false;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.enablePan = true;
controls.maxPolarAngle = Math.PI * 0.85;
controls.minPolarAngle = Math.PI * 0.15;

// ── Worlds ───────────────────────────────────────────────────

const WORLDS = {
  manhattan: {
    url: 'https://cdn.marble.worldlabs.ai/50134904-97be-496d-80b2-7b26e7340590/a9ceecb6-54d7-482b-9404-a9d3dd62a470_ceramic_500k.spz',
    camY: -0.6, sky: 0x87CEEB, label: 'Manhattan Fifth Ave (HQ)',
  },
  temple: {
    url: 'https://cdn.marble.worldlabs.ai/aadaf92f-0932-4c7d-85ba-9c530827fbae/44a1f5e6-423b-4c36-bbfc-60d6a68348c3_sand_500k.spz',
    camY: 0, sky: 0x2a1a0a, label: 'Ancient Temple',
  },
  cyberpunk: {
    url: 'https://cdn.marble.worldlabs.ai/7da989cd-642b-4f72-bd81-1457ba36b8bc/3c0121e4-fdef-4ac7-b28b-b1b7134d4b50_sand.spz',
    camY: 0, sky: 0x0a0a1a, label: 'Cyberpunk Rooftop',
  },
  haunted: {
    url: 'https://storage.googleapis.com/forge-dev-public/hackathon-260227/haunted-house.spz',
    camY: 1, sky: 0x1a1a2a, label: 'Haunted House',
  },
  cottage: {
    url: 'https://storage.googleapis.com/forge-dev-public/hackathon-260227/cozy_cottage.spz',
    camY: 1, sky: 0x6699CC, label: 'Cozy Cottage',
  },
  spaceship: {
    url: 'https://storage.googleapis.com/forge-dev-public/hackathon-260227/cozy-spaceship_2.spz',
    camY: 6.5, sky: 0x050510, label: 'Spaceship',
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

  scene.background = new THREE.Color(w.sky);

  // Camera at the world's Y height, slightly back
  camera.position.set(0, w.camY, 1);
  controls.target.set(0, w.camY, 0);

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

function updateHandIn3D(idx, landmarks) {
  const joints = handJoints[idx];
  const lines = handLines[idx];
  if (!landmarks) { joints.forEach(j => j.visible = false); lines.visible = false; return; }
  for (let i = 0; i < 21; i++) {
    const lm = landmarks[i];
    const p = new THREE.Vector3(-(lm.x - 0.5) * 0.4, -(lm.y - 0.5) * 0.35, -1.0);
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
// Head DIRECTLY sets the view angle (position-based, not velocity)
// Right hand: up = walk forward, down = walk backward

let headYaw = 0, headPitch = 0, handPull = 0;
let sYaw = 0, sPitch = 0, sPull = 0;

let baseAzimuth = 0;
let basePolar = Math.PI / 2;
let headActive = false;

function applyGestures(dt) {
  // Smooth — 0.12 = buttery smooth, follows head with slight lag
  sYaw += (headYaw - sYaw) * 0.12;
  sPitch += (headPitch - sPitch) * 0.12;
  sPull += (handPull - sPull) * 0.1;

  // HEAD → directly set orbit angle
  if (Math.abs(headYaw) > 0.01 || Math.abs(headPitch) > 0.01) {
    if (!headActive) {
      baseAzimuth = controls.getAzimuthalAngle();
      basePolar = controls.getPolarAngle();
      headActive = true;
    }

    const targetAzimuth = baseAzimuth - sYaw * 1.2;  // head right = orbit right
    const targetPolar = Math.max(controls.minPolarAngle, Math.min(controls.maxPolarAngle,
      basePolar + sPitch * 0.6));  // head down = look down

    const dist = camera.position.distanceTo(controls.target);
    const t = controls.target;
    camera.position.set(
      t.x + dist * Math.sin(targetPolar) * Math.sin(targetAzimuth),
      t.y + dist * Math.cos(targetPolar),
      t.z + dist * Math.sin(targetPolar) * Math.cos(targetAzimuth)
    );
  } else if (headActive && Math.abs(sYaw) < 0.01 && Math.abs(sPitch) < 0.01) {
    // Head returned to center — update base to current angle
    baseAzimuth = controls.getAzimuthalAngle();
    basePolar = controls.getPolarAngle();
    headActive = false;
  }

  // HAND → walk forward/backward (move both camera + target along look direction)
  if (Math.abs(sPull) > 0.03) {
    // Get the horizontal look direction (camera → target, Y zeroed)
    const lookDir = new THREE.Vector3();
    lookDir.subVectors(controls.target, camera.position);
    lookDir.y = 0;
    lookDir.normalize();

    const walkSpeed = sPull * dt * 3.0;
    const move = lookDir.multiplyScalar(walkSpeed);

    // Move both camera and target together (walking, not zooming)
    camera.position.add(move);
    controls.target.add(move);
  }
}

// ── Render ───────────────────────────────────────────────────

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  applyGestures(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
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
  onHeadLook: (yaw, pitch) => { headYaw = yaw; headPitch = pitch; },
  onRightHand: (pull) => { handPull = pull; },
  onLeftHand: () => {},
  onFist: nextWorld,
  onPalmDown: () => {},
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
