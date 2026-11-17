// Vice Coast — the single mutable shared state.
// Every module reads/writes G; no other global game state exists.
import * as THREE from 'three';

export const G = {
  mode: 'title', // 'title' | 'playing' | 'paused' | 'busted' | 'wasted'
  time: 0, // seconds since the run started
  cash: 0,
  health: 100,
  wanted: 0, // 0-5 stars
  heat: 0, // 0-100, decays over time, feeds wanted
  cameraMode: 'follow', // 'follow' | 'far' | 'top' (C toggles; main.js owns it)
  cameraYaw: 0, // radians, set every frame by main.js; movement is relative to it
  world: null, // set by buildWorld: { buildings, colliders, spawnPoints, isBlocked, roadAt, ... }
  player: {
    pos: new THREE.Vector3(0, 0, 20),
    heading: 0,
    speed: 0,
    onFoot: true,
    car: null, // THREE.Group of the driven car, or null
    mesh: null, // on-foot character group
  },
  vehicles: [], // every car group (player car + traffic)
  traffic: [], // AI traffic cars only (subset of vehicles)
  peds: [], // pedestrian groups
  police: [], // police cars / officers (owned by police.js)
  mission: {
    id: 0,
    step: 0,
    objective: '',
    target: null, // THREE.Vector3 or null
    done: false,
  },
  input: {
    forward: false,
    back: false,
    left: false,
    right: false,
    brake: false, // Space handbrake
    action: false, // E enter/exit car
    punch: false, // F
    shoot: false, // mouse click
    sprint: false, // Shift
  },
  events: [], // { type, data, t } gameplay event log for HUD/audio hooks
  flags: {
    shot: null,
    shotMode: false,
    muted: false,
  },
};

export function pushEvent(type, data = {}) {
  G.events.push({ type, data, t: G.time });
  if (G.events.length > 200) G.events.splice(0, G.events.length - 200);
}
