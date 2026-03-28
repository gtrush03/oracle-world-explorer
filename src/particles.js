import * as THREE from 'three';

const PARTICLE_COUNT = 2500;

let points = null;
let particleData = []; // per-particle orbital params

/**
 * Create the orbital particle system
 */
export function createParticles(scene) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const sizes = new Float32Array(PARTICLE_COUNT);
  const alphas = new Float32Array(PARTICLE_COUNT);

  particleData = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Orbital parameters
    const radius = 2 + Math.random() * 6;
    const speed = (0.05 + Math.random() * 0.15) * (Math.random() > 0.5 ? 1 : -1);
    const theta = Math.random() * Math.PI * 2;
    const phi = (Math.random() - 0.5) * Math.PI * 0.8;
    const yOffset = (Math.random() - 0.5) * 3;
    const orbitTilt = (Math.random() - 0.5) * 0.5;

    particleData.push({ radius, speed, theta, phi, yOffset, orbitTilt });

    // Initial positions
    const x = Math.cos(theta) * radius;
    const y = Math.sin(phi) * radius * 0.3 + yOffset;
    const z = Math.sin(theta) * radius;

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // White with slight gold tint variation
    const goldAmount = Math.random() * 0.15;
    colors[i * 3]     = 1.0;
    colors[i * 3 + 1] = 1.0 - goldAmount * 0.3;
    colors[i * 3 + 2] = 1.0 - goldAmount;

    // Size variation
    sizes[i] = 0.02 + Math.random() * 0.03;

    // Alpha variation
    alphas[i] = 0.3 + Math.random() * 0.5;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.PointsMaterial({
    size: 0.04,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  points = new THREE.Points(geometry, material);
  scene.add(points);

  return points;
}

/**
 * Update particle positions each frame
 */
export function updateParticles(time) {
  if (!points) return;

  const positions = points.geometry.attributes.position.array;
  const alphas = points.geometry.attributes.alpha;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = particleData[i];
    const angle = p.theta + time * p.speed;

    // Orbital motion with slight wobble
    const wobble = Math.sin(time * 0.5 + i) * 0.2;
    const r = p.radius + wobble;

    positions[i * 3]     = Math.cos(angle) * r;
    positions[i * 3 + 1] = Math.sin(angle * p.orbitTilt) * r * 0.3 + p.yOffset + Math.sin(time * 0.3 + i * 0.1) * 0.1;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    // Pulse alpha gently
    if (alphas) {
      alphas.array[i] = 0.3 + 0.4 * Math.sin(time * 0.5 + i * 0.7) * 0.5 + 0.5;
    }
  }

  points.geometry.attributes.position.needsUpdate = true;
}

/**
 * Get points object for external use
 */
export function getPoints() {
  return points;
}
