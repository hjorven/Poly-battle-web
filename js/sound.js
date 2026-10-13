// Kleine Soundeffekte, direkt mit WebAudio erzeugt (keine Dateien nötig).
// Stummschaltung wird pro Browser gemerkt.

const KEY = 'pb_mute';
let ctx = null;
let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* ohne Speicher: an */ }

function audio() {
  if (muted) return null;
  if (!ctx) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browser starten Audio erst nach einer Nutzeraktion.
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Ein Ton: Frequenz-Verlauf, Dauer, Wellenform, Lautstärke, Startverzögerung.
function tone(a, { from, to = from, dur = 0.12, type = 'sine', vol = 0.18, delay = 0 }) {
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(a, { dur = 0.15, vol = 0.25, delay = 0, freq = 900 }) {
  const t0 = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq;
  const gain = a.createGain();
  gain.gain.value = vol;
  src.connect(filter).connect(gain).connect(a.destination);
  src.start(t0);
}

const SOUNDS = {
  select: a => tone(a, { from: 660, dur: 0.05, vol: 0.08 }),
  move: a => tone(a, { from: 300, to: 520, dur: 0.12, type: 'triangle', vol: 0.12 }),
  attack: a => { noise(a, { dur: 0.18, vol: 0.35, freq: 1400 }); tone(a, { from: 180, to: 90, dur: 0.18, type: 'square', vol: 0.06 }); },
  kill: a => { noise(a, { dur: 0.3, vol: 0.4, freq: 600 }); tone(a, { from: 220, to: 60, dur: 0.35, type: 'sawtooth', vol: 0.08 }); },
  capture: a => [523, 659, 784, 1047].forEach((f, i) => tone(a, { from: f, dur: 0.16, type: 'triangle', vol: 0.14, delay: i * 0.09 })),
  build: a => { noise(a, { dur: 0.06, vol: 0.3, freq: 2500 }); noise(a, { dur: 0.06, vol: 0.3, freq: 2500, delay: 0.1 }); },
  coin: a => { tone(a, { from: 988, dur: 0.07, type: 'square', vol: 0.06 }); tone(a, { from: 1319, dur: 0.18, type: 'square', vol: 0.06, delay: 0.07 }); },
  research: a => [440, 554, 659].forEach((f, i) => tone(a, { from: f, dur: 0.22, vol: 0.12, delay: i * 0.06 })),
  promote: a => [659, 784, 988, 1319].forEach((f, i) => tone(a, { from: f, dur: 0.14, type: 'triangle', vol: 0.14, delay: i * 0.07 })),
  splash: a => noise(a, { dur: 0.35, vol: 0.25, freq: 500 }),
  turn: a => { tone(a, { from: 392, dur: 0.12, vol: 0.12 }); tone(a, { from: 523, dur: 0.2, vol: 0.12, delay: 0.1 }); },
  peace: a => [523, 659, 784].forEach(f => tone(a, { from: f, dur: 0.6, vol: 0.07 })),
  war: a => { tone(a, { from: 110, to: 98, dur: 0.6, type: 'sawtooth', vol: 0.1 }); noise(a, { dur: 0.4, vol: 0.3, freq: 300 }); },
  error: a => tone(a, { from: 200, to: 150, dur: 0.15, type: 'square', vol: 0.06 }),
  win: a => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, { from: f, dur: 0.3, type: 'triangle', vol: 0.14, delay: i * 0.12 })),
  lose: a => [392, 330, 262, 196].forEach((f, i) => tone(a, { from: f, dur: 0.35, vol: 0.12, delay: i * 0.18 }))
};

export function sfx(name) {
  const play = SOUNDS[name];
  if (!play) return;
  try {
    const a = audio();
    if (a) play(a);
  } catch (e) { /* Audio ist Beiwerk – Fehler nie ans Spiel weitergeben */ }
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* egal */ }
}
