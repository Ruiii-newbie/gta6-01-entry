// Vice Coast — vehicles, traffic AI and pedestrians.
// Box-built low-poly cars, arcade driving, traffic following road lanes,
// pedestrians wandering sidewalks and fleeing fast cars.
import * as THREE from 'three';
import {
  CAR_COLORS, SHIRT_COLORS, TRAFFIC_COUNT, PED_COUNT,
  TRAFFIC_SPEED_MIN, TRAFFIC_SPEED_MAX,
  CAR_TOP_SPEED, CAR_ACCEL, CAR_BRAKE, CAR_REVERSE_TOP, CAR_STEER, CAR_RADIUS,
  ROAD_LINES, HALF_CITY,
} from './config.js';
import { RNG } from './random.js';
import { G } from './state.js';

const rng = new RNG(7); // traffic/ped variety seed (world uses seed 1)
let world = null;

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
  const car = makeCar(color, { name: 'player-car' });
  car.position.set(x, 0, z);
  car.rotation.y = 0;
  scene.add(car);
  G.vehicles.push(car);
  return car;
}

export function spawnTraffic(scene) {
  world = world || G.world;
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

function makePedMesh() {
  const group = new THREE.Group();
  group.name = 'ped';
  const skin = new THREE.MeshStandardMaterial({ color: 0xc98e6a, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: rng.pick(SHIRT_COLORS), roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x333a44, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 8), shirt);
  body.position.y = 1.0;
  body.castShadow = true;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), skin);
  head.position.y = 1.68;
  group.add(head);
  const legGeo = new THREE.BoxGeometry(0.14, 0.5, 0.16);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.12, 0.4, 0);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.12, 0.4, 0);
  group.add(legL);
  group.add(legR);
  group.userData = { legL, legR, bob: rng.range(0, Math.PI * 2) };
  return group;
}

export function spawnPeds(scene) {
  world = world || G.world;
  for (let i = 0; i < PED_COUNT; i++) {
    const ped = makePedMesh();
    // start on a sidewalk: near a block centre, off the road
    const x = rng.range(-200, 200);
    const z = rng.range(-200, 200);
    ped.position.set(x, 0, z);
    ped.userData.heading = rng.range(0, Math.PI * 2);
    ped.userData.speed = rng.range(1.0, 1.8);
    ped.userData.target = null;
    ped.userData.state = 'walk';
    scene.add(ped);
    G.peds.push(ped);
  }
  return G.peds;
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

  // acceleration / braking / reverse
  if (inp.forward) u.speed += CAR_ACCEL * dt;
  else if (inp.back) {
    if (u.speed > 0.5) u.speed -= CAR_BRAKE * dt;
    else u.speed -= CAR_ACCEL * 0.6 * dt;
  } else {
    // coast drag
    u.speed -= Math.sign(u.speed) * Math.min(Math.abs(u.speed), 6 * dt);
  }
  if (handbrake) u.speed -= Math.sign(u.speed) * Math.min(Math.abs(u.speed), 26 * dt);
  u.speed = THREE.MathUtils.clamp(u.speed, -CAR_REVERSE_TOP, CAR_TOP_SPEED);

  // steering: less bite at high speed, more slide with handbrake
  const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
  const speedFactor = THREE.MathUtils.clamp(Math.abs(u.speed) / 12, 0, 1);
  const steerRate = CAR_STEER * (1 - 0.55 * speedFactor) * (handbrake ? 1.6 : 1);
  u.steer = THREE.MathUtils.lerp(u.steer, steerIn, Math.min(1, dt * 8));
  // forward: steer turns the nose; reverse: steering inverts, as in a real car
  u.heading += u.steer * steerRate * dt * (u.speed >= 0 ? 1 : -1);

  const f = forwardOf(u.heading);
  let nx = car.position.x + f.x * u.speed * dt;
  let nz = car.position.z + f.z * u.speed * dt;
  if (world) {
    if (world.isBlocked(nx, car.position.z, CAR_RADIUS)) {
      nx = car.position.x;
      u.speed *= 0.4;
    }
    if (world.isBlocked(nx, nz, CAR_RADIUS)) {
      nz = car.position.z;
      u.speed *= 0.4;
    }
  }
  car.position.set(nx, 0, nz);
  car.rotation.y = u.heading;
  u.speedKmh = Math.abs(u.speed) * 3.6;

  // wheel spin + front-wheel steer visual
  const spin = (u.speed * dt) / 0.36;
  for (const w of u.wheels) w.rotation.x += spin;
  for (const w of u.frontWheels) w.rotation.y = u.steer * 0.35;

  // keep the player state glued to the car
  G.player.pos.copy(car.position);
  G.player.heading = u.heading;
  G.player.speed = Math.abs(u.speed);

  // simple car-vs-traffic bump: push apart, scrub speed
  for (const other of G.traffic) {
    const dx = car.position.x - other.position.x;
    const dz = car.position.z - other.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01 && d < 4.4) {
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

function updatePeds(dt) {
  const playerCar = G.player.car;
  const playerPos = G.player.pos;
  for (const ped of G.peds) {
    const u = ped.userData;
    // flee: a fast car (player's) close by
    let fleeX = 0;
    let fleeZ = 0;
    if (playerCar && Math.abs(playerCar.userData.speed) > 8) {
      const dx = ped.position.x - playerCar.position.x;
      const dz = ped.position.z - playerCar.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 10 && d > 0.01) {
        fleeX = dx / d;
        fleeZ = dz / d;
        u.state = 'flee';
      }
    }
    if (u.state === 'flee' && (!playerCar || Math.abs(playerCar.userData.speed) <= 8)) {
      u.state = 'walk';
    }

    let tx;
    let tz;
    let speed = u.speed;
    if (u.state === 'flee') {
      tx = ped.position.x + fleeX * 10;
      tz = ped.position.z + fleeZ * 10;
      speed = 4.2;
    } else {
      if (!u.target || Math.hypot(u.target.x - ped.position.x, u.target.z - ped.position.z) < 1.5) {
        // pick a new nearby sidewalk-ish target
        u.target = {
          x: THREE.MathUtils.clamp(ped.position.x + rng.range(-40, 40), -225, 225),
          z: THREE.MathUtils.clamp(ped.position.z + rng.range(-40, 40), -225, 225),
        };
      }
      tx = u.target.x;
      tz = u.target.z;
    }
    const dx = tx - ped.position.x;
    const dz = tz - ped.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.05) {
      const vx = dx / d;
      const vz = dz / d;
      let nx = ped.position.x + vx * speed * dt;
      let nz = ped.position.z + vz * speed * dt;
      if (world && world.isBlocked(nx, nz, 0.5)) {
        // blocked by a building: sidestep and pick a new target
        u.target = null;
      } else {
        ped.position.set(nx, 0, nz);
      }
      const targetHeading = Math.atan2(vx, vz);
      let dh = targetHeading - u.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      u.heading += THREE.MathUtils.clamp(dh, -8 * dt, 8 * dt);
      ped.rotation.y = u.heading;
      u.bob += dt * speed * 2.4;
      u.legL.rotation.x = Math.sin(u.bob) * 0.5;
      u.legR.rotation.x = -Math.sin(u.bob) * 0.5;
    }
    void playerPos;
  }
}

export function updateVehicles(dt) {
  world = world || G.world;
  if (G.mode !== 'playing') return;
  updatePlayerCar(dt);
  updateTraffic(dt);
  updatePeds(dt);
}
