let audioContext = null;
let isPlaying = false;

/**
 * Initialize ambient drone audio on user interaction
 */
export function initAudio() {
  if (audioContext) return;

  audioContext = new (window.AudioContext || window.webkitAudioContext)();

  // Master gain
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 0;
  masterGain.connect(audioContext.destination);

  // Fade in over 3 seconds
  masterGain.gain.linearRampToValueAtTime(1.0, audioContext.currentTime + 3);

  // Oscillator 1: deep drone at 60Hz
  const osc1 = audioContext.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 60;
  const gain1 = audioContext.createGain();
  gain1.gain.value = 0.03;
  osc1.connect(gain1);
  gain1.connect(masterGain);
  osc1.start();

  // Oscillator 2: harmonic at 90Hz
  const osc2 = audioContext.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 90;
  const gain2 = audioContext.createGain();
  gain2.gain.value = 0.02;
  osc2.connect(gain2);
  gain2.connect(masterGain);
  osc2.start();

  // Oscillator 3: sub-harmonic texture at 45Hz
  const osc3 = audioContext.createOscillator();
  osc3.type = 'triangle';
  osc3.frequency.value = 45;
  const gain3 = audioContext.createGain();
  gain3.gain.value = 0.015;
  osc3.connect(gain3);
  gain3.connect(masterGain);
  osc3.start();

  // Gentle delay for spatial feel
  const delay = audioContext.createDelay(1.0);
  delay.delayTime.value = 0.4;
  const delayGain = audioContext.createGain();
  delayGain.gain.value = 0.3;
  masterGain.connect(delay);
  delay.connect(delayGain);
  delayGain.connect(masterGain);

  isPlaying = true;
}

/**
 * Check if audio is currently playing
 */
export function isAudioPlaying() {
  return isPlaying;
}
