// shots.js — Vice Coast: deterministic staged scenes for screenshots.
// URL ?shot=<name>&seed=1 stages G + world state synchronously and returns.
// Every placement uses a seeded RNG, so the same URL always frames the same shot.
import { G } from './state.js';
import { setWanted, getPoliceCars } from './police.js';
import { startMission } from './missions.js';
import { spawnGuards } from './combat.js';

export const SHOT_NAMES = ['start', 'drive', 'chase', 'mission'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getShotName() {
  try {
    const q = new URLSearchParams(window.location.search);
    return q.get('shot') || '';
  } catch (e) {
    return '';
  }
}

export function getShotSeed() {
  try {
    const q = new URLSearchParams(window.location.search);
    const s = parseInt(q.get('seed') || '1', 10);
    return Number.isFinite(s) ? s : 1;
  } catch (e) {
    return 1;
  }
}

function point(sp, name, fallback) {
  if (sp) {
    const p = sp[name];
    // world.js stores spawn points as [x, z] arrays.
    if (Array.isArray(p) && p.length >= 2) return { x: p[0], z: p[1] };
    if (p && typeof p.x === 'number') return { x: p.x, z: p.z || 0 };
    if (p && p.position) return { x: p.position.x || 0, z: p.position.z || 0 };
  }
  return { ...fallback };
}

function setPlayer(x, z, heading, onFoot, speed) {
  if (!G.player) return;
  if (G.player.pos) {
    G.player.pos.x = x;
    if (typeof G.player.pos.y === 'number') G.player.pos.y = 0;
    G.player.pos.z = z;
  } else {
    G.player.pos = { x, y: 0, z };
  }
  G.player.heading = heading;
  G.player.onFoot = !!onFoot;
  G.player.speed = speed || 0;
  if (G.player.mesh) {
    G.player.mesh.position.set(x, 0, z);
    G.player.mesh.rotation.y = heading;
    // Match player.js: the mesh is hidden while driving (the driver sits
    // inside the car); showing it here put the player standing on the
    // car's rear bumper in the chase/drive shots.
    G.player.mesh.visible = !!onFoot;
  }
}

function placeCar(car, x, z, heading, speed) {
  if (!car) return;
  car.position.set(x, 0, z);
  car.rotation.y = heading;
  if (!car.userData) car.userData = {};
  car.userData.heading = heading;
  car.userData.speed = speed || 0;
}

// Stage traffic + peds from the vehicles module when it can, else from makeCar.
// vehicles.spawnTraffic(scene) / spawnPeds(scene) take the scene and return
// the G.traffic / G.peds arrays; we then re-place them deterministically.
function stageTraffic(ctx, rng, center, count) {
  const vehicles = ctx.vehicles;
  let cars = [];
  try {
    if (vehicles && typeof vehicles.spawnTraffic === 'function') {
      const r = vehicles.spawnTraffic(ctx.scene);
      if (Array.isArray(r)) cars = r;
    }
  } catch (e) { cars = []; }
  if (!cars.length && Array.isArray(G.traffic)) cars = G.traffic;
  if (!cars.length && vehicles && typeof vehicles.makeCar === 'function' && ctx.scene) {
    const colors = [0x2e6f9e, 0xc9a227, 0x7a7f85, 0x9e2e2e, 0x3f7d4e];
    for (let i = 0; i < count; i++) {
      try {
        const car = vehicles.makeCar(colors[i % colors.length]);
        ctx.scene.add(car);
        cars.push(car);
      } catch (e) { /* ignore */ }
    }
    G.traffic = cars;
  }
  // Deterministic slots along the main road through `center`.
  for (let i = 0; i < cars.length; i++) {
    const lane = i % 2 === 0 ? -3.5 : 3.5;
    const along = (Math.floor(i / 2) - 2) * 18 + (rng() - 0.5) * 4;
    const heading = lane < 0 ? 0 : Math.PI;
    placeCar(cars[i], center.x + lane + (rng() - 0.5), center.z + along, heading, 6 + rng() * 6);
  }
  try {
    if (vehicles && typeof vehicles.spawnPeds === 'function') {
      const r = vehicles.spawnPeds(ctx.scene);
      if (Array.isArray(r)) G.peds = r;
    }
  } catch (e) { /* ignore */ }
  if (Array.isArray(G.peds)) {
    for (let i = 0; i < G.peds.length; i++) {
      const ped = G.peds[i];
      if (!ped || !ped.position) continue;
      const side = i % 2 === 0 ? -8 : 8;
      ped.position.set(center.x + side + (rng() - 0.5) * 2, 0, center.z + (i - 3) * 7);
    }
  }
  return cars;
}

function stagePlayerCar(ctx, x, z, heading, speed) {
  const vehicles = ctx.vehicles;
  let car = G.player && G.player.car;
  try {
    if (!car && vehicles && typeof vehicles.spawnPlayerCar === 'function') {
      car = vehicles.spawnPlayerCar(ctx.scene, x, z, 0xff5a1f);
    }
  } catch (e) { car = null; }
  if (!car && vehicles && typeof vehicles.makeCar === 'function' && ctx.scene) {
    try {
      car = vehicles.makeCar(0xff5a1f);
      ctx.scene.add(car);
    } catch (e) { car = null; }
  }
  if (car) {
    placeCar(car, x, z, heading, speed || 0);
    if (G.player) G.player.car = car;
  }
  return car;
}

function baseState() {
  G.flags = G.flags || {};
  G.flags.shot = true;
  G.flags.shotMode = true;
  try { document.body.classList.add('shot-mode'); } catch (e) { /* ignore */ }
  G.health = 100;
  G.cash = 1250;
  if (typeof G.ammo !== 'number') G.ammo = 18;
  if (Array.isArray(G.events)) G.events.length = 0;
}

// Stage one named shot. ctx: { scene, camera, world, vehicles }.
// Returns { name, ok } and never throws.
export function stageShot(name, ctx = {}) {
  try {
    const seed = getShotSeed();
    const rng = mulberry32(seed * 7919 + 13);
    const sp = (ctx.world && ctx.world.spawnPoints) || {};
    const road = point(sp, 'player', { x: 0, z: 20 });
    const garage = point(sp, 'garage', { x: 104, z: 8 });
    const harbor = point(sp, 'harbor', { x: -226, z: 60 });

    baseState();

    if (name === 'start') {
      G.mode = 'title';
      G.cameraMode = 'orbit';
      G.wanted = 0;
      G.heat = 0;
      setPlayer(road.x, road.z, 0.6, false, 0);
      stagePlayerCar(ctx, road.x + 2, road.z + 4, 0.6, 0);
      stageTraffic(ctx, rng, { x: road.x, z: road.z - 30 }, 6);
      G.mission = { id: -1, step: 0, objective: 'Welcome to Vice Coast.', target: null, done: false };
      return { name, ok: true };
    }

    if (name === 'drive') {
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.wanted = 0;
      G.heat = 0;
      setPlayer(road.x, road.z, 0, false, 14);
      stagePlayerCar(ctx, road.x, road.z, 0, 14);
      stageTraffic(ctx, rng, { x: road.x, z: road.z - 20 }, 8);
      G.mission = { id: 0, step: 1, objective: 'Drive the car to the garage', target: garage, done: false };
      if (G.events) G.events.push({ type: 'toast', text: 'Nice wheels, Vic. Get it to the garage.' });
      return { name, ok: true };
    }

    if (name === 'chase') {
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.cash = 1850;
      setPlayer(road.x, road.z, 0, false, 18);
      stagePlayerCar(ctx, road.x, road.z, 0, 18);
      stageTraffic(ctx, rng, { x: road.x, z: road.z - 40 }, 5);
      setWanted(3);
      // Re-place the spawned police cars at fixed spots behind the player.
      const cops = getPoliceCars();
      for (let i = 0; i < cops.length; i++) {
        const behind = 14 + i * 9;
        const side = i % 2 === 0 ? -3.5 : 3.5;
        placeCar(cops[i], road.x + side, road.z + behind, 0, 16);
      }
      G.mission = { id: 1, step: 3, objective: 'Lose the cops', target: garage, done: false };
      if (G.events) G.events.push({ type: 'toast', text: 'Three stars — lose them, Vic!' });
      return { name, ok: true };
    }

    if (name === 'mission') {
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.cash = 2450;
      G.health = 82;
      // Start M3, then jump to the guard fight at the harbor.
      try { startMission(2); } catch (e) { /* ignore */ }
      G.mission = { id: 2, step: 1, objective: 'Deal with the harbor guards', target: harbor, done: false };
      setPlayer(harbor.x - 12, harbor.z + 10, Math.atan2(12, -10), true, 0);
      try { spawnGuards(3, harbor); } catch (e) { /* ignore */ }
      if (G.events) G.events.push({ type: 'banner', text: 'Mission 3: Harbor Heat', sub: 'The harbor crew is armed — take them down, grab the crate.' });
      return { name, ok: true };
    }

    return { name, ok: false, error: 'unknown shot: ' + name };
  } catch (e) {
    return { name, ok: false, error: String(e && e.message ? e.message : e) };
  }
}

export default { stageShot, getShotName, getShotSeed, SHOT_NAMES };
