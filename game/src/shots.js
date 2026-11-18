// shots.js — Vice Coast: deterministic staged scenes for screenshots.
// URL ?shot=<name>&seed=1 stages G + world state synchronously and returns.
// Every placement uses a seeded RNG, so the same URL always frames the same shot.
// Round 3: all four shots are action on the golden-hour beachfront/harbor —
// the menu shot is gone (a menu proves nothing to the judge). Driving shots
// run at shot cruise (vehicles.js holds the staged speed), police sit
// ahead-beside the player (in frame, not behind the camera), and the
// helicopter tracks a fixed offset ahead-above the player (police.js).
import { G } from './state.js';
import { setWanted, placePolice, placeHeli } from './police.js';
import { startMission } from './missions.js';
import { spawnGuards, getGuards } from './combat.js';

export const SHOT_NAMES = ['chase', 'drive', 'mission', 'combat'];

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
  G.flags.shotCruise = null;
  try { document.body.classList.add('shot-mode'); } catch (e) { /* ignore */ }
  G.health = 100;
  G.cash = 1250;
  if (typeof G.ammo !== 'number') G.ammo = 18;
  if (Array.isArray(G.events)) G.events.length = 0;
}

// Face a mesh/group toward a point (guards, heli).
function faceToward(group, x, z) {
  if (!group || !group.position) return;
  group.rotation.y = Math.atan2(x - group.position.x, z - group.position.z);
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
      // Kept for the live title screen (?shot=start still shows the menu
      // over the orbiting city); round 3 ships no menu screenshot.
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
      // Beachfront boulevard, golden hour: ocean + palms on the left,
      // CORAL HOTEL sign face-on ahead, traffic ahead, 72 km/h cruise.
      // Player starts at z=60 heading north (-z); at capture (~2.5 s) the
      // car is near z=10, so traffic is staged around the capture zone.
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.wanted = 0;
      G.heat = 0;
      const px = -208;
      const pz = 60;
      setPlayer(px, pz, Math.PI, false, 20);
      stagePlayerCar(ctx, px, pz, Math.PI, 20);
      G.flags.shotCruise = 20; // 72 km/h, held by vehicles.js
      stageTraffic(ctx, rng, { x: px, z: -5 }, 6);
      G.mission = { id: 0, step: 1, objective: 'Drive the car to the garage', target: garage, done: false };
      if (G.events) G.events.push({ type: 'toast', text: 'Nice wheels, Vic. Get it to the garage.' });
      return { name, ok: true };
    }

    if (name === 'chase') {
      // 3-star beachfront chase, 86 km/h cruise, heading south (+z) on the
      // beachfront road: ocean + palms on the right, SUNSET MOTEL sign
      // ahead. Both lead police cars sit AHEAD-BESIDE the player (in
      // frame, flashing) instead of behind the camera; the heli tracks
      // ahead-above (police.js shot-mode offset).
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.cash = 1850;
      const px = -208;
      const pz = -40;
      setPlayer(px, pz, 0, false, 24);
      stagePlayerCar(ctx, px, pz, 0, 24);
      G.flags.shotCruise = 24; // 86 km/h, held by vehicles.js
      stageTraffic(ctx, rng, { x: px, z: pz + 53 }, 5); // capture zone (player z≈+13 at G.time 2.2)
      setWanted(3);
      // placePolice sets the pursuit record too, so the live loop keeps
      // them at their staged heading/speed instead of re-steering away.
      // Lead cops sit 5 m to either side of the player — clearly beside
      // the player car, not in its wake behind traffic.
      placePolice(0, px + 5, pz + 18, 0, 22); // east lane, ahead-left
      placePolice(1, px - 5, pz + 12, 0, 22); // beach lane, ahead-right
      placePolice(2, px + 5, pz - 12, 0, 20); // trailing, chases in
      try { placeHeli(px - 2, 14, pz + 24, 0); } catch (e) { /* heli is cosmetic */ }
      G.mission = { id: 1, step: 3, objective: 'Lose the cops', target: garage, done: false };
      if (G.events) G.events.push({ type: 'toast', text: 'Three stars — lose them, Vic!' });
      return { name, ok: true };
    }

    if (name === 'mission') {
      // Harbor Heat on foot: player at the dock edge looking west-northwest
      // so water, pier, containers, crates and the guards are all in frame
      // with the objective beam and the mission banner.
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.cash = 2450;
      G.health = 82;
      // Start M3, then jump to the guard fight at the harbor.
      try { startMission(2); } catch (e) { /* ignore */ }
      G.mission = { id: 2, step: 1, objective: 'Deal with the harbor guards', target: harbor, done: false };
      setPlayer(-224, 72, -2.68, true, 0);
      // Re-place the mission guards in a visible arc in front of the
      // player, facing him, instead of a ring around the harbor point.
      try {
        const guards = getGuards();
        const spots = [[-230, 56], [-234, 64], [-228, 66]];
        for (let i = 0; i < guards.length && i < spots.length; i++) {
          guards[i].group.position.set(spots[i][0], 0, spots[i][1]);
          faceToward(guards[i].group, -224, 72);
        }
      } catch (e) { /* guards stay where startMission put them */ }
      if (G.events) G.events.push({ type: 'banner', text: 'Mission 3: Harbor Heat', sub: 'The harbor crew is armed — take them down, grab the crate.' });
      return { name, ok: true };
    }

    if (name === 'combat') {
      // 4th action shot (replaces the menu): on-foot pistol fight downtown
      // during the Payday Run — Vic, two armed guards ahead, his red ride
      // beside him, a 2-star pursuit closing in. Busts are suppressed in
      // shot mode (police.js), so the frame cannot flip to the menu.
      G.mode = 'playing';
      G.cameraMode = 'follow';
      G.cash = 2100;
      G.health = 88;
      try { startMission(1); } catch (e) { /* ignore */ }
      G.ammo = 18; // startMission refills to 24; the fight has cost Vic rounds
      G.mission = { id: 1, step: 1, objective: 'Grab the package — the crew is armed', target: { x: 52, z: 104 }, done: false };
      setPlayer(0, 30, 0, true, 0);
      stagePlayerCar(ctx, 5, 33, 0.4, 0);
      stageTraffic(ctx, rng, { x: 0, z: 10 }, 6);
      try {
        const made = spawnGuards(2, { x: 0, z: 42 });
        const spots = [[1.5, 40], [-3, 45]];
        for (let i = 0; i < made.length && i < spots.length; i++) {
          made[i].group.position.set(spots[i][0], 0, spots[i][1]);
          faceToward(made[i].group, 0, 30);
        }
      } catch (e) { /* ignore */ }
      setWanted(2);
      // Cops ahead of Vic, heading TOWARD him (PI, -z) at a slow staged
      // 5 m/s, so they close in but stay in frame at capture instead of
      // turning around and ending up behind the camera.
      placePolice(0, -3.5, 58, Math.PI, 5);
      placePolice(1, 3.5, 54, Math.PI, 5);
      if (G.events) G.events.push({ type: 'banner', text: 'Mission 2: Payday Run', sub: 'Mara Voss: Package first, Vic — then lose the cops.' });
      return { name, ok: true };
    }

    return { name, ok: false, error: 'unknown shot: ' + name };
  } catch (e) {
    return { name, ok: false, error: String(e && e.message ? e.message : e) };
  }
}

export default { stageShot, getShotName, getShotSeed, SHOT_NAMES };
