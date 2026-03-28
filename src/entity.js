import * as THREE from 'three';

let mesh = null;
let originalPositions = null;
let envMap = null;
let material = null;
let sceneRef = null;
let rendererRef = null;

// Pre-generated Marble world panoramas — we load these as equirectangular env maps
// Each one is a 2560x1280 PNG from Marble's panorama output
const WORLD_PANORAMAS = [
  {
    name: 'cottage',
    // Using a high-quality HDR placeholder — we'll swap to Marble panoramas once generated
    url: null, // will use procedural for now, swap to real panorama URLs
    mood: { warm: 0xd4a574, cool: 0x4a6fa5, accent: 0x8b5cf6 },
  },
];

// Current panorama texture
let currentPanoTexture = null;
let pendingPanoUrl = null;

/**
 * Generate a procedural environment map (fallback when no panorama loaded)
 */
function generateProceduralEnvMap(renderer, colors) {
  const envScene = new THREE.Scene();

  // Warm light
  const warm = new THREE.PointLight(colors.warm, 80, 50);
  warm.position.set(5, 5, 3);
  envScene.add(warm);

  // Cool light
  const cool = new THREE.PointLight(colors.cool, 60, 50);
  cool.position.set(-5, -3, -4);
  envScene.add(cool);

  // Accent
  const accent = new THREE.PointLight(colors.accent, 40, 50);
  accent.position.set(0, 0, -6);
  envScene.add(accent);

  envScene.add(new THREE.AmbientLight(0x111111, 0.5));

  // Emissive glow spheres for reflection highlights
  const glowGeo = new THREE.SphereGeometry(0.5, 16, 16);
  [
    { pos: warm.position, color: colors.warm, intensity: 4 },
    { pos: cool.position, color: colors.cool, intensity: 3 },
    { pos: accent.position, color: colors.accent, intensity: 3 },
  ].forEach(({ pos, color, intensity }) => {
    const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    mat.color.multiplyScalar(intensity);
    const s = new THREE.Mesh(glowGeo, mat);
    s.position.copy(pos);
    envScene.add(s);
  });

  // Large surrounding sphere with subtle emissive gradient
  const bgGeo = new THREE.SphereGeometry(30, 32, 32);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x080818,
    side: THREE.BackSide,
  });
  envScene.add(new THREE.Mesh(bgGeo, bgMat));

  const cubeRT = new THREE.WebGLCubeRenderTarget(512, {
    format: THREE.RGBAFormat,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });

  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRT);
  cubeCamera.update(renderer, envScene);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTexture = pmrem.fromCubemap(cubeRT.texture).texture;
  pmrem.dispose();
  cubeRT.dispose();

  return envTexture;
}

/**
 * Load a Marble panorama as environment map
 */
export function loadPanoramaEnvMap(url) {
  if (!rendererRef || !material) {
    pendingPanoUrl = url;
    return;
  }

  const loader = new THREE.TextureLoader();
  loader.load(url, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(rendererRef);
    const envTexture = pmrem.fromEquirectangular(texture).texture;
    pmrem.dispose();
    texture.dispose();

    // Apply to entity
    material.envMap = envTexture;
    material.needsUpdate = true;

    // Also set as scene background (subtle, blurred)
    if (sceneRef) {
      sceneRef.background = envTexture;
    }

    if (currentPanoTexture) currentPanoTexture.dispose();
    currentPanoTexture = envTexture;
    envMap = envTexture;
  });
}

/**
 * Create the Oracle entity
 */
export function createEntity(renderer, scene) {
  rendererRef = renderer;
  sceneRef = scene;

  // Start with procedural env map
  envMap = generateProceduralEnvMap(renderer, {
    warm: 0xd4a574,
    cool: 0x4a6fa5,
    accent: 0x8b5cf6,
  });

  const geometry = new THREE.IcosahedronGeometry(1.5, 4);
  originalPositions = new Float32Array(geometry.attributes.position.array);

  material = new THREE.MeshPhysicalMaterial({
    metalness: 1.0,
    roughness: 0.03,
    envMapIntensity: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    color: 0xffffff,
    envMap,
    iridescence: 0.3,
    iridescenceIOR: 1.5,
  });

  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Load pending panorama if one was queued
  if (pendingPanoUrl) {
    loadPanoramaEnvMap(pendingPanoUrl);
    pendingPanoUrl = null;
  }

  return mesh;
}

/**
 * Update per frame
 */
export function updateEntity(time) {
  if (!mesh) return;

  mesh.rotation.y += 0.002;
  mesh.rotation.x = Math.sin(time * 0.3) * 0.05;

  const breathe = 0.98 + 0.04 * Math.sin(time * 0.8);
  mesh.scale.setScalar(breathe);

  const positions = mesh.geometry.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const ox = originalPositions[i];
    const oy = originalPositions[i + 1];
    const oz = originalPositions[i + 2];

    const noise =
      Math.sin(ox * 3.0 + time * 0.5) *
      Math.cos(oy * 3.0 + time * 0.7) *
      Math.sin(oz * 3.0 + time * 0.6) *
      0.06;

    const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
    positions[i]     = ox + (ox / len) * noise;
    positions[i + 1] = oy + (oy / len) * noise;
    positions[i + 2] = oz + (oz / len) * noise;
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

/**
 * Morph the geometry
 */
export function morphShape(type = 'icosa', detail = 4) {
  if (!mesh) return;

  let newGeo;
  switch (type) {
    case 'octa':
      newGeo = new THREE.OctahedronGeometry(1.5, detail);
      break;
    case 'dodeca':
      newGeo = new THREE.DodecahedronGeometry(1.5, detail);
      break;
    case 'torus':
      newGeo = new THREE.TorusKnotGeometry(1.2, 0.4, 128, 32);
      break;
    case 'sphere':
      newGeo = new THREE.SphereGeometry(1.5, 64, 64);
      break;
    default:
      newGeo = new THREE.IcosahedronGeometry(1.5, detail);
  }

  mesh.geometry.dispose();
  mesh.geometry = newGeo;
  originalPositions = new Float32Array(newGeo.attributes.position.array);
}

/**
 * Set environment map directly
 */
export function setEnvMap(newEnvMap) {
  if (!material) return;
  envMap = newEnvMap;
  material.envMap = envMap;
  material.needsUpdate = true;
}

/**
 * Set mood via procedural env map
 */
export function setMood(moodName, renderer) {
  const moods = {
    default: { warm: 0xd4a574, cool: 0x4a6fa5, accent: 0x8b5cf6 },
    dream:   { warm: 0xff6ec7, cool: 0x00d4ff, accent: 0x7c3aed },
    wrath:   { warm: 0xff2200, cool: 0x330000, accent: 0xff4400 },
    calm:    { warm: 0x88aa88, cool: 0x3366aa, accent: 0x226644 },
    void:    { warm: 0x111111, cool: 0x0a0a2e, accent: 0x1a1a3e },
  };
  if (!moods[moodName] || !renderer || !material) return;
  const newEnv = generateProceduralEnvMap(renderer, moods[moodName]);
  setEnvMap(newEnv);
  if (sceneRef) {
    sceneRef.background = new THREE.Color(0x000000);
    sceneRef.backgroundIntensity = 1;
  }
}

export function getAvailableMoods() {
  return ['default', 'dream', 'wrath', 'calm', 'void'];
}

export function getMesh() {
  return mesh;
}
