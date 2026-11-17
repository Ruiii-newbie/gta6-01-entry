// audio.js — Vice Coast: synthesized WebAudio sound, zero audio assets.
// Everything is generated with oscillators / filtered noise at runtime.
// Silent until the first user gesture, and silent in shot mode (?shot=).
import { G } from './state.js';

let ctx = null;
let master = null;
let muted = false;
let engineOsc = null;
let engineOsc2 = null;
let engineGain = null;
let sirenOsc = null;
let sirenGain = null;
let sirenTimer = null;
let sirenOn = false;
let sirenHigh = false;
let started = false;

function now() {
  return ctx ? ctx.currentTime : 0;
}

function noiseBuffer(seconds = 0.5) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = null) {
  if (!ctx || muted) return;
  try {
    const t = now() + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch (e) { /* audio must never break the game */ }
}

function burst(dur, vol, filterFreq, when = 0) {
  if (!ctx || muted) return;
  try {
    const t = now() + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  } catch (e) { /* ignore */ }
}

function isShotMode() {
  try {
    if (G && G.flags && G.flags.shot) return true;
    if (typeof document !== 'undefined' && document.body && document.body.classList.contains('shot-mode')) return true;
  } catch (e) { /* ignore */ }
  return false;
}

function ensureEngine() {
  if (!ctx || engineOsc) return;
  try {
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 55;
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'square';
    engineOsc2.frequency.value = 28;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    engineOsc.connect(f);
    engineOsc2.connect(f);
    f.connect(engineGain);
    engineGain.connect(master);
    engineOsc.start();
    engineOsc2.start();
  } catch (e) { /* ignore */ }
}

export const AudioSys = {
  get ready() { return !!ctx; },
  get isMuted() { return muted; },

  // Call from the first user gesture (click / keydown). Safe to call repeatedly.
  init() {
    if (ctx || isShotMode()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      ensureEngine();
      started = true;
    } catch (e) { ctx = null; }
  },

  setMuted(b) {
    muted = !!b;
    if (G && G.flags) G.flags.muted = muted;
    if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, now(), 0.02);
    if (muted) this.setSiren(false);
  },

  // Per-frame: engine pitch follows speed; drains sound events from G.events.
  update() {
    if (!ctx || isShotMode()) return;
    try {
      const speed = Math.abs((G.player && G.player.speed) || 0);
      const driving = G.player && !G.player.onFoot;
      if (engineOsc && engineGain) {
        const target = driving ? Math.min(0.085, 0.02 + speed * 0.0016) : 0.0;
        engineGain.gain.setTargetAtTime(muted ? 0 : target, now(), 0.1);
        engineOsc.frequency.setTargetAtTime(52 + speed * 2.4, now(), 0.08);
        engineOsc2.frequency.setTargetAtTime(26 + speed * 1.2, now(), 0.08);
      }
      // Drain sound events queued by gameplay modules.
      if (G.events && G.events.length) {
        const rest = [];
        for (const ev of G.events) {
          if (ev && ev.type === 'sound') {
            if (ev.name === 'shot') this.shot();
            else if (ev.name === 'punch') this.punch();
            else if (ev.name === 'pickup') this.pickup();
            else if (ev.name === 'jingle') this.jingle();
            else if (ev.name === 'click') this.click();
            else if (ev.name === 'siren') this.setSiren(!!ev.on);
          } else rest.push(ev);
        }
        G.events.length = 0;
        for (const ev of rest) G.events.push(ev);
      }
    } catch (e) { /* ignore */ }
  },

  setSiren(on) {
    if (!ctx || isShotMode()) { sirenOn = false; return; }
    if (on === sirenOn) return;
    sirenOn = !!on;
    try {
      if (sirenOn && !muted) {
        if (!sirenOsc) {
          sirenOsc = ctx.createOscillator();
          sirenOsc.type = 'triangle';
          sirenGain = ctx.createGain();
          sirenGain.gain.value = 0.0001;
          sirenOsc.connect(sirenGain);
          sirenGain.connect(master);
          sirenOsc.start();
        }
        sirenGain.gain.setTargetAtTime(0.05, now(), 0.1);
        sirenHigh = false;
        if (!sirenTimer) {
          sirenTimer = setInterval(() => {
            if (!sirenOsc || !sirenOn || muted) return;
            sirenHigh = !sirenHigh;
            sirenOsc.frequency.setTargetAtTime(sirenHigh ? 880 : 660, now(), 0.05);
          }, 420);
        }
      } else if (sirenGain) {
        sirenGain.gain.setTargetAtTime(0.0001, now(), 0.1);
        if (sirenTimer) { clearInterval(sirenTimer); sirenTimer = null; }
      }
    } catch (e) { /* ignore */ }
  },

  shot() { burst(0.16, 0.5, 2800); tone(160, 0.08, 'square', 0.18, 0, 60); },
  punch() { burst(0.12, 0.45, 300); tone(90, 0.1, 'sine', 0.35, 0, 45); },
  pickup() { tone(660, 0.1, 'sine', 0.22); tone(990, 0.16, 'sine', 0.22, 0.09); },
  click() { tone(1200, 0.04, 'square', 0.08); },

  // Mission-complete arpeggio.
  jingle() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.11));
  },

  // Short sting for busted / wasted.
  sting() {
    tone(220, 0.5, 'sawtooth', 0.16, 0, 110);
    tone(233, 0.5, 'sawtooth', 0.16, 0.05, 116);
  },

  suspend() {
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    this.setSiren(false);
  },

  resume() {
    if (ctx && ctx.state === 'suspended' && !isShotMode()) ctx.resume().catch(() => {});
  },
};

export default AudioSys;
