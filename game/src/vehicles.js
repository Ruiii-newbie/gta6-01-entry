// Vice Coast — vehicles, traffic AI and nitro.
// Box-built low-poly cars, arcade driving, traffic following road lanes.
// Pedestrians live in pedestrians.js (round 5); this module only drives cars.
import * as THREE from 'three';
import {
  CAR_COLORS,
  TRAFFIC_COUNT,
  TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX,
  CAR_TOP_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_REVERSE_TOP, CAR_STEER, CAR_RADIUS,
  ROAD_LINES, HALF_CITY,
  NITRO_TOP_MULT, NITRO_ACCEL_MULT, NITRO_DRAIN, NITRO_REGEN,
} from './config.js';
import { RNG } from './random.js';
import { G } from './state.js';

const rng = new RNG(7); // traffic/ped variety seed (world uses seed 1)
let world = null;
let sceneRef = null;

// Tire-smoke pool: grey puffs that grow and fade (handbrake drifts,
// hard launches, nitro). Reused meshes, never allocated per frame.
const SMOKE_POOL = 24;
let smokePool = [];
let smokeTimer = 0;

function initSmokePool() {
  if (smokePool.length || !sceneRef) return;
  const geo = new THREE.SphereGeometry(0.5, 8, 6);
  for (let i = 0; i < SMOKE_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    sceneRef.add(m);
    smokePool.push({ mesh: m, life: 0 });
  }
}

function spawnSmoke(x, z) {
  initSmokePool();
  for (const p of smokePool) {
    if (p.life > 0) continue;
    p.life = 0.7;
    p.mesh.position.set(x + (Math.random() - 0.5) * 0.8, 0.35, z + (Math.random() - 0.5) * 0.8);
    p.mesh.scale.set(0.6, 0.6, 0.6);
    p.mesh.visible = true;
    return;
  }
}

function updateSmoke(dt) {
  for (const p of smokePool) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    const s = 0.6 + (0.7 - p.life) * 2.2;
    p.mesh.scale.set(s, s * 0.7, s);
    p.mesh.material.opacity = Math.min(0.45, p.life * 0.6);
    p.mesh.position.y += dt * 0.8;
  }
}

function forwardOf(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

export function makeCar(color, opts = {}) {
  const group = new THREE.Group();
  group.name = opts.name || 'car';
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.15, metalness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.8 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 });
  const hub = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 });

  // body (built facing +Z)
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.55, 4.4), paint);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 0.7), paint);
  nose.position.set(0, 0.42, 2.1);
  group.add(nose);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), glass);
  cabin.position.set(0, 1.05, -0.2);
  cabin.castShadow = true;
  group.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 2.0), paint);
  roof.position.set(0, 1.35, -0.2);
  group.add(roof);
  // bumpers + grille
  const bumperF = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.25), trim);
  bumperF.position.set(0, 0.32, 2.28);
  group.add(bumperF);
  const bumperR = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.25), trim);
  bumperR.position.set(0, 0.32, -2.28);
  group.add(bumperR);
  // headlights / taillights
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe9a0, emissiveIntensity: 0.9 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xc02020, emissive: 0x800000, emissiveIntensity: 0.6 });
  for (const sx of [-0.65, 0.65]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), lightMat);
    hl.position.set(sx, 0.62, 2.46);
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), tailMat);
    tl.position.set(sx, 0.62, -2.46);
    group.add(tl);
  }
  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 14);
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 10);
  const wheels = [];
  for (const [wx, wz] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Group();
    const tyreMesh = new THREE.Mesh(wheelGeo, tyre);
    tyreMesh.rotation.z = Math.PI / 2;
    tyreMesh.castShadow = true;
    const hubMesh = new THREE.Mesh(hubGeo, hub);
    hubMesh.rotation.z = Math.PI / 2;
    w.add(tyreMesh);
    w.add(hubMesh);
    w.position.set(wx, 0.36, wz);
    group.add(w);
    wheels.push(w);
  }

  group.userData = {
    heading: opts.heading || 0,
    speed: 0, // m/s, signed
    speedKmh: 0,
    steer: 0,
    color,
    isPlayer: false,
    wheels,
    frontWheels: [wheels[0], wheels[1]],
  };
  return group;
}

export function spawnPlayerCar(scene, x = 104, z = 8, color = 0xd23b2e) {
  world = world || G.world;
  sceneRef = scene || sceneRef;
  const car = makeCar(color, { name: 'player-car' });
  car.position.set(x, 0, z);
  car.rotation.y = 0;
  scene.add(car);
  G.vehicles.push(car);
  return car;
}

export function spawnTraffic(scene) {
  world = world || G.world;
  sceneRef = scene || sceneRef;
  for (let i = 0; i < TRAFFIC_COUNT; i++) {
    const car = makeCar(rng.pick(CAR_COLORS), { name: `traffic-${i}` });
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const line = rng.pick(ROAD_LINES);
    const dir = rng.chance(0.5) ? 1 : -1;
    const lane = dir > 0 ? 3 : -3; // right-hand lane
    const along = rng.range(-220, 220);
    if (axis === 'x') {
      car.position.set(along, 0, line + lane);
      car.userData.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.position.set(line + lane, 0, along);
      car.userData.heading = dir > 0 ? 0 : Math.PI;
    }
    car.userData.axis = axis;
    car.userData.dir = dir;
    car.userData.cruise = rng.range(TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX);
    car.userData.speed = car.userData.cruise;
    car.rotation.y = car.userData.heading;
    scene.add(car);
    G.vehicles.push(car);
    G.traffic.push(car);
  }
  return G.traffic;
}

export function nearestDrivable(maxDist = 4) {
  const p = G.player.pos;
  let best = null;
  let bestD = maxDist;
  for (const car of G.vehicles) {
    if (car === G.player.car) continue;
    const d = Math.hypot(car.position.x - p.x, car.position.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

function updatePlayerCar(dt) {
  const car = G.player.car;
  if (!car || G.player.onFoot) return;
  const inp = G.input;
  const u = car.userData;
  const handbrake = inp.brake;
  // Shot cruise (item 1e): in shot mode the staged speed is the speed —
  // the car holds it instead of coasting to 0, so the HUD reads the staged
  // 35-100 km/h for the whole capture and the frame keeps moving.
  const shotCruise = (G.flags && G.flags.shotMode) ? G.flags.shotCruise : null;
  const cruising = typeof shotCruise === 'number';
  let boosting = false;
  if (cruising) {
    u.speed = shotCruise;
    u.steer = 0;
  } else {

  // Nitro boost: Shift while driving spends the meter for +45% top speed
  // and +60% acceleration; it refills when not boosting. On foot Shift is
  // still sprint (player.js), so the two never fight.
  const wantBoost = !!(inp.sprint && (G.nitro || 0) > 0.5);
  boosting = wantBoost && u.speed > 2;
  if (typeof G.nitro !== 'number') G.nitro = 100;
  if (boosting) G.nitro = Math.max(0, G.nitro - NITRO_DRAIN * dt);
  else G.nitro = Math.min(100, G.nitro + NITRO_REGEN * dt);
  G.boosting = boosting;
  const topSpeed = boosting ? CAR_TOP_SPEED * NITRO_TOP_MULT : CAR_TOP_SPEED;
  const accel = boosting ? CAR_ACCEL * NITRO_ACCEL_MULT : CAR_ACCEL;

  // acceleration / braking / reverse
  if (inp.forward) u.speed += accel * dt;
  else if (inp.back) {
    if (u.speed > 0.5) u.speed -= CAR_BRAKE * dt;
    else u.speed -= accel * 0.6 * dt;
  } else {
    // coast drag
    u.speed -= Math.sign(u.speed) * Math.min(Math.abs(u.speed), 6 * dt);
  }
  if (handbrake) u.speed -= Math.sign(u.speed) * Math.min(Math.abs(u.speed), 26 * dt);
  u.speed = THREE.MathUtils.clamp(u.speed, -CAR_REVERSE_TOP, topSpeed);

  // steering: less bite at high speed, more slide with handbrake
  const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
  const speedFactor = THREE.MathUtils.clamp(Math.abs(u.speed) / 12, 0, 1);
  const steerRate = CAR_STEER * (1 - 0.55 * speedFactor) * (handbrake ? 1.6 : 1);
  u.steer = THREE.MathUtils.lerp(u.steer, steerIn, Math.min(1, dt * 8));
  // forward: steer turns the nose; reverse: steering inverts, as in a real car
  u.heading += u.steer * steerRate * dt * (u.speed >= 0 ? 1 : -1);
  } // end live-driving accel/steer (shot cruise holds speed + heading)

  const f = forwardOf(u.heading);
  let nx = car.position.x + f.x * u.speed * dt;
  let nz = car.position.z + f.z * u.speed * dt;
  if (world) {
    if (world.isBlocked(nx, car.position.z, CAR_RADIUS)) {
      // Hard hit into a building: shake the camera and scrub speed.
      if (Math.abs(u.speed) > 12) G.shake = Math.max(G.shake || 0, 0.45);
      nx = car.position.x;
      u.speed *= 0.4;
    }
    if (world.isBlocked(nx, nz, CAR_RADIUS)) {
      if (Math.abs(u.speed) > 12) G.shake = Math.max(G.shake || 0, 0.45);
      nz = car.position.z;
      u.speed *= 0.4;
    }
  }
  car.position.set(nx, 0, nz);
  car.rotation.y = u.heading;
  u.speedKmh = Math.abs(u.speed) * 3.6;

  // Tire smoke: handbrake drift, hard launch, or nitro at speed.
  const drifting = (handbrake && Math.abs(u.speed) > 8)
    || (inp.forward && Math.abs(u.speed) < 6 && !cruising)
    || (boosting && Math.abs(u.speed) > 10);
  smokeTimer -= dt;
  if (drifting && smokeTimer <= 0) {
    smokeTimer = 0.06;
    const bx = car.position.x - f.x * 2;
    const bz = car.position.z - f.z * 2;
    spawnSmoke(bx, bz);
  }

  // wheel spin + front-wheel steer visual
  const spin = (u.speed * dt) / 0.36;
  for (const w of u.wheels) w.rotation.x += spin;
  for (const w of u.frontWheels) w.rotation.y = u.steer * 0.35;

  // keep the player state glued to the car
  G.player.pos.copy(car.position);
  G.player.heading = u.heading;
  G.player.speed = Math.abs(u.speed);

  // simple car-vs-traffic bump: push apart, scrub speed, shake on a hard hit
  for (const other of G.traffic) {
    const dx = car.position.x - other.position.x;
    const dz = car.position.z - other.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01 && d < 4.4) {
      if (Math.abs(u.speed) > 12) G.shake = Math.max(G.shake || 0, 0.35);
      const push = (4.4 - d) / 2;
      const nx2 = dx / d;
      const nz2 = dz / d;
      car.position.x += nx2 * push;
      car.position.z += nz2 * push;
      other.position.x -= nx2 * push;
      other.position.z -= nz2 * push;
      u.speed *= 0.6;
      other.userData.speed *= 0.7;
    }
  }
}

function updateTraffic(dt) {
  for (const car of G.traffic) {
    const u = car.userData;
    const f = forwardOf(u.heading);
    let nx = car.position.x + f.x * u.speed * dt;
    let nz = car.position.z + f.z * u.speed * dt;

    // turn at intersections: near a crossing road line, small chance per second
    const along = u.axis === 'x' ? nx : nz;
    const cross = u.axis === 'x' ? nz : nx;
    let nearCross = false;
    for (const line of ROAD_LINES) {
      if (Math.abs(cross - line) < 7 && Math.abs(along - line) < 7) { nearCross = true; break; }
    }
    if (nearCross && rng.next() < dt * 0.25) {
      // turn onto the crossing road
      const newAxis = u.axis === 'x' ? 'z' : 'x';
      const newDir = rng.chance(0.5) ? 1 : -1;
      const newLane = newDir > 0 ? 3 : -3;
      if (newAxis === 'x') {
        nz = Math.round(nz / 52) * 52 + newLane;
        u.heading = newDir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        nx = Math.round(nx / 52) * 52 + newLane;
        u.heading = newDir > 0 ? 0 : Math.PI;
      }
      u.axis = newAxis;
      u.dir = newDir;
    }

    // despawn / respawn at the city edge
    if (Math.abs(nx) > HALF_CITY - 8 || Math.abs(nz) > HALF_CITY - 8) {
      const axis = rng.chance(0.5) ? 'x' : 'z';
      const line = rng.pick(ROAD_LINES);
      const dir = rng.chance(0.5) ? 1 : -1;
      const lane = dir > 0 ? 3 : -3;
      const edge = dir > 0 ? -225 : 225;
      if (axis === 'x') {
        nx = edge; nz = line + lane;
        u.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        nx = line + lane; nz = edge;
        u.heading = dir > 0 ? 0 : Math.PI;
      }
      u.axis = axis;
      u.dir = dir;
      u.speed = rng.range(TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX);
    }

    car.position.set(nx, 0, nz);
    car.rotation.y = u.heading;
    u.speed = THREE.MathUtils.lerp(u.speed, u.cruise || u.speed, Math.min(1, dt));
    u.speedKmh = Math.abs(u.speed) * 3.6;
    const spin = (u.speed * dt) / 0.36;
    for (const w of u.wheels) w.rotation.x += spin;
  }
}

export function updateVehicles(dt) {
  world = world || G.world;
  if (G.mode !== 'playing') return;
  updatePlayerCar(dt);
  updateTraffic(dt);
  updateSmoke(dt);
}
