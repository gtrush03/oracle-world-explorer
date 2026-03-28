import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import * as THREE from 'three';

let composer = null;
let bloomPass = null;

/**
 * Set up post-processing pipeline
 */
export function createPostProcessing(renderer, scene, camera) {
  composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    1.5,   // strength
    0.4,   // radius
    0.1    // threshold
  );
  composer.addPass(bloomPass);

  return composer;
}

/**
 * Render with post-processing
 */
export function renderPostFX() {
  if (!composer) return;
  composer.render();
}

/**
 * Resize post-processing buffers
 */
export function resizePostFX(width, height) {
  if (!composer) return;
  composer.setSize(width, height);
  if (bloomPass) {
    bloomPass.resolution.set(width, height);
  }
}

/**
 * Adjust bloom parameters
 */
export function setBloom(strength, radius, threshold) {
  if (!bloomPass) return;
  if (strength !== undefined) bloomPass.strength = strength;
  if (radius !== undefined) bloomPass.radius = radius;
  if (threshold !== undefined) bloomPass.threshold = threshold;
}

/**
 * Get the composer for external use
 */
export function getComposer() {
  return composer;
}
