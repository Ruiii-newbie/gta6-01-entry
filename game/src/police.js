// police.js — Vice Coast: wanted level (0–5 stars) and police pursuit.
// Police cars spawn at road edges when wanted > 0 (count = wanted), chase
// the player, ram a driven car, and bust the player on foot at close range.
// Heat decays once no police car has seen the player for 8 seconds.
import * as THREE from '../vendor/three.min.js';
import { G } from './state.js';

export const MAX_WANTED = 5;

let sceneRef = null;
let worldRef = null;
let vehiclesRef = null;
const policeCars = []; // { group, heading, speed, seenAt }
let heli = null; // { group, rotor, angle }
let lastSeenAt = 0; // seconds (performance.now based clock)
let nextDecayAt = 0;
let sirenState = false;
let clock = 0;

function playerPos() {
  const p = G.player && G.player.pos;
  if (!p) return { x: 0, z: 0 };
  return { x: p.x || 0, z: p.z || 0 };
}

function toast(text) {
  if (G.events) G.events.push({ type: 'toast', text });
}

function pushSound(name, extra = {}) {
  if (G.events) G.events.push({ type: 'sound', name, ...extra });
}

function setSiren(on) {
  if (on === sirenState) return;
  sirenState = on;
  pushSound('siren', { on });
}

// Fallback police car (white body, dark roof bar) when vehicles.makeCar is absent.
function fallbackCar() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.7, 4.2),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 }),
  );
  body.position.y = 0.55;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.6, 2.1),
    new THREE.MeshStandardMaterial({ color: 0x1a2a44, roughness: 0.3, metalness: 0.4 }),
  );
  cabin.position.set(0, 1.15, -0.2);
  cabin.castShadow = true;
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.18, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.4 }),
  );
  bar.position.set(0, 1.55, -0.2);
  const lightL = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.16, 0.34),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xaa0000 }),
  );
  lightL.position.set(-0.35, 1.56, -0.2);
  const lightR = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.16, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x0022aa }),
  );
  lightR.position.set(0.35, 1.56, -0.2);
  g.add(body, cabin, bar, lightL, lightR);
  g.userData.heading = 0;
  g.userData.speed = 0;
  g.userData.lightL = lightL;
  g.userData.lightR = lightR;
  return g;
}

function makePoliceCar() {
  let car = null;
  try {
    if (vehiclesRef && typeof vehiclesRef.makeCar === 'function') {
      car = vehiclesRef.makeCar(0xf2f2f2, { police: true });
    }
  } catch (e) { car = null; }
  if (!car) car = fallbackCar();
  if (!car.userData) car.userData = {};
  car.userData.isPolice = true;
  car.userData.heading = car.userData.heading || 0;
  car.userData.speed = 0;
  // Two-tone PD livery: black hood + trunk over the white body, so a
  // police car reads as police at contact-sheet size, not as traffic.
  try {
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.4, metalness: 0.3 });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.1, 0.9), blackMat);
    hood.position.set(0, 0.85, 1.9);
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.1, 0.9), blackMat);
    trunk.position.set(0, 0.85, -1.9);
    car.add(hood, trunk);
  } catch (e) { /* cosmetic only */ }
  // Add a flashing light bar when the base car has none (vehicles.makeCar
  // has no police variant); updatePolice flashes these each frame. The bar
  // is oversized on purpose: at 20 m a 0.45 m bar is invisible, and the
  // chase shot has to read "police" at contact-sheet size.
  if (!car.userData.lightL) {
    try {
      const lightL = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.24, 0.42),
        new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff0000, emissiveIntensity: 2 }),
      );
      lightL.position.set(-0.38, 1.52, -0.2);
      const lightR = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.24, 0.42),
        new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x0044ff, emissiveIntensity: 2 }),
      );
      lightR.position.set(0.38, 1.52, -0.2);
      car.add(lightL, lightR);
      car.userData.lightL = lightL;
      car.userData.lightR = lightR;
    } catch (e) { /* cosmetic only */ }
  }
  return car;
}

function makeHelicopter() {
  // Low-poly PD helicopter from primitives, like everything else: box
  // body, glass nose, tail boom + fin, skids, spinning main rotor.
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a2a44, roughness: 0.4, metalness: 0.4 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: 0.15, metalness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.5, 3.6), bodyMat);
  body.position.y = 0;
  body.castShadow = true;
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 1.2), glassMat);
  nose.position.set(0, -0.1, 2.1);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.45, 0.3, 3.0), whiteMat);
  stripe.position.y = 0.45;
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.2), bodyMat);
  boom.position.set(0, 0.3, -3.6);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.4, 1.0), whiteMat);
  fin.position.set(0, 0.9, -5.4);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 0.25), whiteMat);
  tailRotor.position.set(-0.35, 0.6, -5.4);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8), whiteMat);
  mast.position.y = 1.05;
  const rotor = new THREE.Group();
  rotor.position.y = 1.45;
  const bladeGeo = new THREE.BoxGeometry(8.5, 0.08, 0.5);
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.4 });
  rotor.add(new THREE.Mesh(bladeGeo, bladeMat));
  const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
  blade2.rotation.y = Math.PI / 2;
  rotor.add(blade2);
  const skidMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.4 });
  for (const sx of [-1.0, 1.0]) {
    const skid = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 3.4), skidMat);
    skid.position.set(sx, -1.0, 0);
    g.add(skid);
  }
  const lightL = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xaa0000 }),
  );
  lightL.position.set(-0.9, 0.85, 0.5);
  const lightR = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.2, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x0022aa }),
  );
  lightR.position.set(0.9, 0.85, 0.5);
  g.add(body, nose, stripe, boom, fin, tailRotor, mast, rotor, lightL, lightR);
  g.userData.rotor = rotor;
  g.userData.tailRotor = tailRotor;
  g.userData.lightL = lightL;
  g.userData.lightR = lightR;
  g.userData.isHeli = true;
  return g;
}

function ensureHeli() {
  if (heli || !sceneRef) return heli;
  const group = makeHelicopter();
  sceneRef.add(group);
  const p = playerPos();
  heli = { group, angle: 0.6, radius: 26, height: 14 };
  group.position.set(p.x + Math.sin(0.6) * 26, 14, p.z + Math.cos(0.6) * 26);
  if (G) G.helicopter = group;
  return heli;
}

function removeHeli() {
  if (!heli) return;
  try { if (sceneRef) sceneRef.remove(heli.group); } catch (e) { /* ignore */ }
  heli = null;
  if (G) G.helicopter = null;
}

// Stage the helicopter at an exact spot (shots.js): position + orbit angle.
export function placeHeli(x, y, z, angle) {
  const h = ensureHeli();
  if (!h) return null;
  h.group.position.set(x, y, z);
  if (typeof angle === 'number') h.angle = angle;
  h.group.rotation.y = (typeof angle === 'number' ? angle : 0) + Math.PI;
  return h.group;
}

export function getHelicopter() {
  return heli ? heli.group : null;
}

function roadAt(x, z) {
  try {
    if (worldRef && typeof worldRef.roadAt === 'function') return worldRef.roadAt(x, z);
  } catch (e) { /* ignore */ }
  return true;
}

function isBlocked(x, z, r) {
  try {
    if (worldRef && typeof worldRef.isBlocked === 'function') return worldRef.isBlocked(x, z, r);
  } catch (e) { /* ignore */ }
  return false;
}

// Pick a spawn point on a road, 45–70 m from the player, off to a side.
function pickSpawn() {
  const p = playerPos();
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 45 + Math.random() * 25;
    const x = p.x + Math.cos(a) * d;
    const z = p.z + Math.sin(a) * d;
    if (roadAt(x, z) && !isBlocked(x, z, 3)) return { x, z };
  }
  // Fallback: anywhere on a road ring, or the player position offset.
  return { x: p.x + 50, z: p.z + 20 };
}

function spawnOne() {
  if (!sceneRef) return;
  const car = makePoliceCar();
  const s = pickSpawn();
  car.position.set(s.x, 0, s.z);
  const p = playerPos();
  const heading = Math.atan2(p.x - s.x, p.z - s.z);
  car.userData.heading = heading;
  car.rotation.y = heading;
  sceneRef.add(car);
  policeCars.push({ group: car, heading, speed: 0, seenAt: clock, flash: Math.random() });
  if (G.police) G.police = policeCars.map((c) => c.group);
}

function removeOne(c) {
  try {
    if (sceneRef) sceneRef.remove(c.group);
    if (c.group && c.group.geometry && c.group.geometry.dispose) { /* group: dispose children */ }
    c.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  } catch (e) { /* ignore */ }
  const i = policeCars.indexOf(c);
  if (i >= 0) policeCars.splice(i, 1);
  if (G.police) G.police = policeCars.map((x) => x.group);
}

export function initPolice(scene, world, vehiclesApi) {
  sceneRef = scene || null;
  worldRef = world || null;
  vehiclesRef = vehiclesApi || null;
  return policeCars;
}

export function getPoliceCars() {
  return policeCars.map((c) => c.group);
}

// Stage one police car at an exact spot (shots.js): sets the pursuit
// record's heading/speed as well as the mesh, so the live loop does not
// steer it away from its staged pose on the next frame.
// NOTE: setWanted only sets the level — cars spawn on the first live
// frame, AFTER staging — so placePolice spawns the car itself when the
// fleet does not have index i yet. Without this the call was a silent
// no-op and the cops spawned at random spots (behind the camera).
export function placePolice(i, x, z, heading, speed) {
  while (policeCars.length <= i) spawnOne();
  const c = policeCars[i];
  if (!c) return null;
  c.heading = heading;
  c.speed = speed || 0;
  c.group.position.set(x, 0, z);
  c.group.rotation.y = heading;
  c.group.userData.heading = heading;
  c.group.userData.speed = speed || 0;
  // Staged speed: in shot mode the pursuit holds this instead of the AI
  // top speed, so staged cops stay ahead-beside instead of ramming past.
  c.group.userData.shotSpeed = speed || 0;
  return c.group;
}

export function clearPolice() {
  while (policeCars.length) removeOne(policeCars[0]);
  removeHeli();
  setSiren(false);
}

export function setWanted(n) {
  const v = Math.max(0, Math.min(MAX_WANTED, Math.round(n) || 0));
  const changed = v !== G.wanted;
  G.wanted = v;
  if (v === 0) {
    G.heat = 0;
    clearPolice();
  } else {
    lastSeenAt = clock;
    nextDecayAt = clock + 10;
  }
  if (changed && v > 0) toast(`Wanted level ${v} — lose the cops!`);
  return G.wanted;
}

export function addHeat(n) {
  G.heat = Math.max(0, (G.heat || 0) + (n || 0));
  // Every 2 heat is roughly one star; cap at 5 stars.
  const stars = Math.min(MAX_WANTED, Math.ceil((G.heat || 0) / 2));
  if (stars > (G.wanted || 0)) setWanted(stars);
  return G.wanted;
}

export function updatePolice(dt) {
  if (!G || G.mode !== 'playing') {
    if (G && G.mode !== 'playing') setSiren(false);
    return;
  }
  dt = Math.min(0.1, Math.max(0, dt || 0));
  clock += dt;
  const wanted = G.wanted || 0;

  // Helicopter: wanted 3+ puts a PD heli circling overhead (low, so it
  // stays in the follow camera's frame). Gone below 3 stars.
  if (wanted >= 3) ensureHeli();
  else removeHeli();
  if (heli) {
    const p = playerPos();
    // In shot mode the heli holds a fixed offset ahead-above the player
    // (the player drives at cruise, so an absolute staged spot would fall
    // behind the camera within seconds); live, it circles slowly.
    if (G.flags && G.flags.shotMode) {
      const h = (G.player && G.player.heading) || 0;
      const fx = Math.sin(h);
      const fz = Math.cos(h);
      heli.group.position.set(p.x + fx * 24 + fz * 6, heli.height, p.z + fz * 24 - fx * 6);
      heli.group.rotation.y = h + Math.PI;
    } else {
      heli.angle += dt * 0.12;
      heli.group.position.set(
        p.x + Math.sin(heli.angle) * heli.radius,
        heli.height,
        p.z + Math.cos(heli.angle) * heli.radius,
      );
      heli.group.rotation.y = heli.angle + Math.PI;
    }
    const rotor = heli.group.userData.rotor;
    if (rotor) rotor.rotation.y += dt * 22;
    const tail = heli.group.userData.tailRotor;
    if (tail) tail.rotation.x += dt * 30;
    const phase = Math.floor(clock * 6) % 2 === 0;
    const hl = heli.group.userData.lightL;
    const hr = heli.group.userData.lightR;
    if (hl && hl.material) hl.material.emissive.setHex(phase ? 0xff0000 : 0x330000);
    if (hr && hr.material) hr.material.emissive.setHex(phase ? 0x000033 : 0x0044ff);
  }

  // Keep the fleet at exactly `wanted` cars.
  if (sceneRef) {
    while (policeCars.length < wanted) spawnOne();
    while (policeCars.length > wanted) removeOne(policeCars[policeCars.length - 1]);
  }
  setSiren(wanted > 0 && policeCars.length > 0);

  if (!policeCars.length) return;
  const p = playerPos();
  const playerSpeed = Math.abs((G.player && G.player.speed) || 0);
  const onFoot = !!(G.player && G.player.onFoot);
  let anySeen = false;

  for (const c of policeCars) {
    const car = c.group;
    const dx = p.x - car.position.x;
    const dz = p.z - car.position.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    if (dist < 55) { anySeen = true; c.seenAt = clock; }

    // Steer toward the player, with a limited turn rate — live play only.
    // In shot mode the staged heading holds: a cop staged ahead-beside
    // would otherwise U-turn toward the player and end up behind the
    // camera, which is exactly the original chase-shot bug.
    if (!(G.flags && G.flags.shotMode)) {
      const desired = Math.atan2(dx, dz);
      let diff = desired - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turnRate = 2.6;
      c.heading += Math.max(-turnRate * dt, Math.min(turnRate * dt, diff));
    }
    // Top speed grows with the wanted level; slow down when very close.
    // In shot mode the staged speed rules (placePolice), so the frame holds.
    const shotSpeed = (G.flags && G.flags.shotMode) ? car.userData.shotSpeed : null;
    const top = typeof shotSpeed === 'number' ? shotSpeed : Math.min(26, 13 + wanted * 2.4);
    const targetSpeed = dist < 6 ? top * 0.45 : top;
    c.speed += (targetSpeed - c.speed) * Math.min(1, dt * 1.4);

    // Step forward; if a building blocks the way, turn away (live only —
    // staged cops sit on clear road and must not swerve out of frame).
    let nx = car.position.x + Math.sin(c.heading) * c.speed * dt;
    let nz = car.position.z + Math.cos(c.heading) * c.speed * dt;
    if (!(G.flags && G.flags.shotMode) && isBlocked(nx, nz, 2.2)) {
      c.heading += Math.PI * 0.6;
      nx = car.position.x + Math.sin(c.heading) * c.speed * dt * 0.5;
      nz = car.position.z + Math.cos(c.heading) * c.speed * dt * 0.5;
    }
    car.position.set(nx, 0, nz);
    car.rotation.y = c.heading;
    car.userData.heading = c.heading;
    car.userData.speed = c.speed;

    // Flash the light bar.
    const phase = Math.floor(clock * 6 + c.flash * 10) % 2 === 0;
    const l = car.userData.lightL;
    const r = car.userData.lightR;
    if (l && l.material) l.material.emissive.setHex(phase ? 0xff0000 : 0x330000);
    if (r && r.material) r.material.emissive.setHex(phase ? 0x000033 : 0x0044ff);

    // Ram: bump a driven player car and bleed its speed.
    if (!onFoot && dist < 3.6) {
      const pc = G.player.car;
      if (pc && pc.userData) pc.userData.speed = (pc.userData.speed || 0) * 0.985;
      if (G.player.speed) G.player.speed *= 0.985;
    }

    // Bust: on foot, slow, and a cop right on top of the player.
    // Never in shot mode — a staged frame must not flip to the menu.
    if (onFoot && dist < 3 && playerSpeed < 1 && !(G.flags && G.flags.shotMode)) {
      G.mode = 'busted';
      if (G.events) G.events.push({ type: 'sound', name: 'sting' });
      toast('Busted! Mara Voss will sort the bail.');
      setSiren(false);
      return;
    }
  }

  if (G.police) G.police = policeCars.map((c) => c.group);

  // Heat decay: 8 s with no police car in sight starts the cool-down,
  // then the wanted level drops one star every 10 s.
  if (anySeen) {
    lastSeenAt = clock;
    nextDecayAt = clock + 10;
  } else if (wanted > 0 && clock - lastSeenAt > 8) {
    if (clock >= nextDecayAt) {
      setWanted(wanted - 1);
      nextDecayAt = clock + 10;
      if (G.wanted > 0) toast('Heat cooling off…');
      else toast('You lost the cops. Clean.');
    }
  }
}

export default { setWanted, addHeat, updatePolice, initPolice, clearPolice, getPoliceCars, placePolice, placeHeli, getHelicopter, MAX_WANTED };
