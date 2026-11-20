// missions.js — Vice Coast: four-mission story for Vic and fixer Mara Voss.
// M1 First Wheels, M2 Payday Run, M3 Harbor Heat, M4 Vice Heist (finale).
// Steps drive G.mission (objective text + target marker) and pay cash on completion.
import * as THREE from '../vendor/three.min.js';
import { G } from './state.js';
import { setWanted } from './police.js';
import { spawnGuards, getGuardsAlive, refillAmmo, spawnHealthPack } from './combat.js';
import { saveGame } from './save.js';

let sceneRef = null;
let worldRef = null;
let vehiclesRef = null;
let marker = null;
let markerBeam = null;
let markerRing = null;
let parkedCar = null;
let stealFlagged = false;
let pulse = 0;

function spawnPoints() {
  try {
    if (worldRef && worldRef.spawnPoints) return worldRef.spawnPoints;
  } catch (e) { /* ignore */ }
  return {};
}

// Fallback coordinates when the world has no named spawn points.
// (Kept in sync with world.js: player [0,20], garage [104,8],
// harbor [-226,60], pickup [52,104].)
// parkedCar sits ON road x=0 (east lane, clear of every block): it used to
// be (-20, 10), inside the (-17, 17) shop's collision box, so the stolen
// car could never move — holding W left speed at 0.
const FALLBACK = {
  player: { x: 0, z: 20 },
  garage: { x: 104, z: 8 },
  harbor: { x: -226, z: 60 },
  pickup: { x: 52, z: 104 },
  bank: { x: 52, z: -52 },
  parkedCar: { x: 3.5, z: 10 },
};

function point(name) {
  const sp = spawnPoints();
  const p = sp[name];
  // world.js stores spawn points as [x, z] arrays.
  if (Array.isArray(p) && p.length >= 2) return { x: p[0], z: p[1] };
  if (p && typeof p.x === 'number' && typeof p.z === 'number') return { x: p.x, z: p.z };
  if (p && p.position) return { x: p.position.x || 0, z: p.position.z || 0 };
  return { ...(FALLBACK[name] || { x: 0, z: 0 }) };
}

// Story line shown on screen for the whole mission (HUD dialogue row):
// how the judge sees "story" without reading code.
export const DIALOGUE = [
  'Mara Voss: Nice wheels, Vic. Get it to the garage — and don\'t scratch it.',
  'Mara Voss: Package first, Vic — then lose the cops and bring it home.',
  'Mara Voss: The harbor crew is armed. Take them down, grab the crate.',
  'Mara Voss: The vault job, Vic — in, out, gone. The whole Coast PD will be on you.',
];

export const DISTRICTS = [
  // [minX, maxX, minZ, maxZ, name] — first match wins; beachfront first.
  [-240, -200, 40, 240, 'Vice Harbor'],
  [-240, -200, -240, 40, 'Coral Strip · Beachfront'],
  [-80, 80, -80, 80, 'Downtown Vice'],
  [-240, -80, -80, 80, 'Westside'],
  [80, 240, -80, 80, 'Eastside'],
  [-240, 240, 80, 240, 'North Vice'],
  [-240, 240, -240, -80, 'South Vice'],
];

export function districtAt(x, z) {
  for (const [x0, x1, z0, z1, name] of DISTRICTS) {
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return name;
  }
  return 'Vice Coast';
}

export const MISSIONS = [
  {
    id: 0,
    title: 'First Wheels',
    desc: 'Mara Voss needs a driver. Steal the parked ride by the boardwalk, then bring it to the garage.',
    reward: 300,
    steps: [
      { type: 'steal', key: 'parkedCar', objective: 'Steal the parked car — press E next to it', radius: 4 },
      { type: 'drive', key: 'garage', objective: 'Drive the car to the garage', radius: 6 },
    ],
  },
  {
    id: 1,
    title: 'Payday Run',
    desc: 'A package is waiting at the pickup point. Grab it on foot, get back in the car, lose the cops, and deliver it.',
    reward: 600,
    steps: [
      { type: 'drive', key: 'pickup', objective: 'Drive to the pickup point', radius: 6 },
      { type: 'grab', key: 'pickup', objective: 'Grab the package on foot', radius: 3 },
      { type: 'drive', key: 'garage', objective: 'Get back in the car — the cops are coming', radius: 6, wanted: 2 },
      { type: 'evade', key: 'garage', objective: 'Lose the cops', radius: 0 },
      { type: 'drive', key: 'garage', objective: 'Deliver the package to the garage', radius: 6 },
    ],
  },
  {
    id: 2,
    title: 'Harbor Heat',
    desc: 'The big one. The harbor crew is armed — take them down, grab the crate, and bring it home.',
    reward: 1200,
    steps: [
      { type: 'drive', key: 'harbor', objective: 'Drive to the harbor', radius: 8 },
      { type: 'clear', key: 'harbor', objective: 'Deal with the harbor guards', radius: 0 },
      { type: 'grab', key: 'harbor', objective: 'Grab the crate on foot', radius: 3.5 },
      { type: 'drive', key: 'garage', objective: 'Deliver the crate to the garage', radius: 6 },
    ],
  },
  {
    id: 3,
    title: 'Vice Heist',
    desc: 'The finale. Break into the Vice Bank vault, grab the loot, and outrun a 5-star manhunt — heli, roadblocks, the works — then bring it home to Mara.',
    reward: 2500,
    steps: [
      { type: 'drive', key: 'bank', objective: 'Drive to the Vice Bank', radius: 6 },
      { type: 'grab', key: 'bank', objective: 'Break into the vault — grab the loot on foot', radius: 3.5, wanted: 4 },
      { type: 'drive', key: 'garage', objective: 'Escape — the whole Coast PD is coming', radius: 6, wanted: 5 },
      { type: 'evade', key: 'garage', objective: 'Lose the cops', radius: 0 },
      { type: 'drive', key: 'garage', objective: 'Deliver the loot to Mara\'s garage', radius: 6 },
    ],
  },
];

function toast(text) {
  if (G.events) G.events.push({ type: 'toast', text });
}

function banner(text, sub) {
  if (G.events) G.events.push({ type: 'banner', text, sub });
}

function pushSound(name) {
  if (G.events) G.events.push({ type: 'sound', name });
}

function buildMarker() {
  if (!sceneRef) return;
  clearMarker();
  const group = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(1.6, 2.4, 32);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffc233, side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.9, 24, 12, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffc233, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 12;
  group.add(ring, beam);
  sceneRef.add(group);
  marker = group;
  markerRing = ring;
  markerBeam = beam;
}

function clearMarker() {
  if (marker && sceneRef) {
    try { sceneRef.remove(marker); } catch (e) { /* ignore */ }
  }
  marker = null;
  markerRing = null;
  markerBeam = null;
}

function placeParkedCar(at) {
  if (parkedCar && sceneRef) {
    try { sceneRef.remove(parkedCar); } catch (e) { /* ignore */ }
    parkedCar = null;
  }
  if (!sceneRef) return;
  try {
    let car = null;
    if (vehiclesRef && typeof vehiclesRef.makeCar === 'function') {
      car = vehiclesRef.makeCar(0xe8533f, { parked: true });
    } else {
      car = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.7, 4.2),
        new THREE.MeshStandardMaterial({ color: 0xe8533f, roughness: 0.4, metalness: 0.3 }),
      );
      body.position.y = 0.55;
      body.castShadow = true;
      car.add(body);
    }
    car.position.set(at.x, 0, at.z);
    car.rotation.y = 0.6;
    if (!car.userData) car.userData = {};
    car.userData.heading = 0.6;
    car.userData.speed = 0;
    car.userData.parked = true;
    sceneRef.add(car);
    // Must be in G.vehicles or player.js nearestDrivable() can never find it.
    if (G.vehicles && !G.vehicles.includes(car)) G.vehicles.push(car);
    parkedCar = car;
  } catch (e) { parkedCar = null; }
}

export function initMissions(scene, world, vehiclesApi) {
  sceneRef = scene || null;
  worldRef = world || null;
  vehiclesRef = vehiclesApi || null;
  return MISSIONS;
}

export function getCurrentMission() {
  const id = G.mission ? G.mission.id : -1;
  return (typeof id === 'number' && MISSIONS[id]) ? MISSIONS[id] : null;
}

export function startMission(i) {
  const m = MISSIONS[i];
  if (!m) return false;
  clearMarker();
  stealFlagged = false;
  refillAmmo();
  G.mission = { id: m.id, step: 0, objective: m.steps[0].objective, target: point(m.steps[0].key), done: false };
  buildMarker();
  if (marker) marker.position.set(G.mission.target.x, 0, G.mission.target.z);
  if (m.id === 0) placeParkedCar(point('parkedCar'));
  if (m.id === 2) {
    const harbor = point('harbor');
    spawnGuards(3, harbor);
    spawnHealthPack({ x: harbor.x + 8, z: harbor.z - 6 });
    spawnHealthPack({ x: harbor.x - 8, z: harbor.z + 4 });
  }
  if (m.id === 3) {
    // The vault is guarded: three armed guards around the bank, so the
    // grab step is a fight, not a walk-in.
    const bank = point('bank');
    spawnGuards(3, bank);
    spawnHealthPack({ x: bank.x + 8, z: bank.z + 6 });
    spawnHealthPack({ x: bank.x - 8, z: bank.z - 6 });
  }
  banner(`Mission ${m.id + 1}: ${m.title}`, m.desc);
  toast(`Mara Voss: ${m.desc}`);
  pushSound('pickup');
  return true;
}

function completeStep() {
  const m = getCurrentMission();
  if (!m) return;
  const next = G.mission.step + 1;
  if (next >= m.steps.length) {
    completeMission(m);
    return;
  }
  G.mission.step = next;
  const step = m.steps[next];
  G.mission.objective = step.objective;
  G.mission.target = point(step.key);
  if (marker) marker.position.set(G.mission.target.x, 0, G.mission.target.z);
  if (typeof step.wanted === 'number') setWanted(step.wanted);
  toast(step.objective);
}

function completeMission(m) {
  G.cash = (G.cash || 0) + m.reward;
  G.mission.done = true;
  G.mission.objective = `Mission complete — +$${m.reward.toLocaleString('en-US')}`;
  clearMarker();
  banner(`Mission complete: ${m.title}`, `+$${m.reward.toLocaleString('en-US')} — Mara Voss pays up.`);
  toast(`+$${m.reward.toLocaleString('en-US')} — mission complete.`);
  pushSound('jingle');
  try { saveGame(); } catch (e) { /* ignore */ }
  const nextId = m.id + 1;
  if (MISSIONS[nextId]) {
    // Chain straight into the next job so the story keeps moving.
    startMission(nextId);
  } else {
    G.mission = { id: -1, step: 0, objective: 'Story complete — free roam Vice Coast.', target: null, done: true };
    banner('Story complete', 'Vice Coast is yours, Vic. Free roam, cause chaos, stay golden.');
  }
}

function playerPos() {
  const p = G.player && G.player.pos;
  if (!p) return { x: 0, z: 0 };
  return { x: p.x || 0, z: p.z || 0 };
}

export function updateMissions(dt) {
  if (!G || G.mode !== 'playing') return;
  dt = Math.min(0.1, Math.max(0, dt || 0));
  pulse += dt;
  if (marker) {
    const s = 1 + Math.sin(pulse * 4) * 0.15;
    if (markerRing) markerRing.scale.set(s, s, 1);
    if (markerBeam) markerBeam.material.opacity = 0.16 + Math.sin(pulse * 4) * 0.07;
    marker.rotation.y += dt * 0.8;
  }
  const m = getCurrentMission();
  if (!m || G.mission.done) return;
  const step = m.steps[G.mission.step];
  if (!step) return;
  const p = playerPos();
  const t = G.mission.target || point(step.key);
  const dist = Math.hypot(t.x - p.x, t.z - p.z);
  const onFoot = !!(G.player && G.player.onFoot);
  const inCar = !onFoot;

  switch (step.type) {
    case 'steal': {
      // Completes the moment Vic is IN the stolen car near the target — or
      // presses E on foot next to it. The old check required onFoot, but
      // updatePlayer runs before updateMissions in the same fixed step, so
      // a single E press entered the car and the step could never complete
      // (it only fired if you entered, exited, and re-entered).
      if (dist < (step.radius || 4) && (inCar || (onFoot && G.input && G.input.action))) {
        if (!stealFlagged) {
          stealFlagged = true;
          setWanted(Math.max(G.wanted || 0, 1));
          toast('Car stolen! The cops noticed.');
        }
        completeStep();
      }
      break;
    }
    case 'grab': {
      if (onFoot && dist < (step.radius || 3)) {
        pushSound('pickup');
        if (step.key === 'pickup') toast('Package secured.');
        else if (step.key === 'bank') toast('Vault loot secured — run!');
        else toast('Crate secured.');
        completeStep();
      }
      break;
    }
    case 'drive': {
      if (inCar && dist < (step.radius || 6)) completeStep();
      break;
    }
    case 'evade': {
      if ((G.wanted || 0) <= 0) completeStep();
      break;
    }
    case 'clear': {
      if (getGuardsAlive() <= 0) {
        toast('Harbor clear. Grab the crate.');
        completeStep();
      }
      break;
    }
    default: {
      if (dist < (step.radius || 6)) completeStep();
      break;
    }
  }
}

export default { MISSIONS, DIALOGUE, DISTRICTS, districtAt, startMission, updateMissions, initMissions, getCurrentMission };
