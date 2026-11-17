// Vice Coast — on-foot player character.
// Capsule body + head, walk bob, WASD/arrows relative to the camera,
// Shift sprint, E enter/exit the nearest drivable car.
import * as THREE from 'three';
import { WALK_SPEED, SPRINT_SPEED, PLAYER_RADIUS, ENTER_CAR_DIST } from './config.js';
import { G } from './state.js';
import { nearestDrivable } from './vehicles.js';

let world = null;
let bobPhase = 0;
let prevAction = false;
let inputBound = false;

const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyE: 'action',
  KeyF: 'punch',
  Space: 'brake',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};

function bindInput() {
  if (inputBound) return;
  inputBound = true;
  window.addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code];
    if (k) {
      G.input[k] = true;
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    const k = KEYMAP[e.code];
    if (k) G.input[k] = false;
  });
  window.addEventListener('mousedown', () => { G.input.shoot = true; });
  window.addEventListener('mouseup', () => { G.input.shoot = false; });
  window.addEventListener('blur', () => {
    for (const key of Object.keys(G.input)) G.input[key] = false;
  });
}

export function createPlayer(scene) {
  bindInput();
  world = G.world;
  const group = new THREE.Group();
  group.name = 'player';

  const skin = new THREE.MeshStandardMaterial({ color: 0xc98e6a, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0x2e6fd2, roughness: 0.9 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.9 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 10), shirt);
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), skin);
  head.position.y = 1.78;
  head.castShadow = true;
  group.add(head);

  const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairMesh.position.y = 1.82;
  group.add(hairMesh);

  const legGeo = new THREE.BoxGeometry(0.16, 0.55, 0.18);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.14, 0.42, 0);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.14, 0.42, 0);
  legL.castShadow = true;
  legR.castShadow = true;
  group.add(legL);
  group.add(legR);

  const armGeo = new THREE.BoxGeometry(0.13, 0.55, 0.15);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.46, 1.1, 0);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.46, 1.1, 0);
  group.add(armL);
  group.add(armR);

  group.userData = { legL, legR, armL, armR, body };
  group.position.copy(G.player.pos);
  scene.add(group);
  G.player.mesh = group;
  return group;
}

function tryEnterExitCar() {
  if (G.player.onFoot) {
    const car = nearestDrivable(ENTER_CAR_DIST);
    if (car) {
      G.player.car = car;
      G.player.onFoot = false;
      if (G.player.mesh) G.player.mesh.visible = false;
      G.player.pos.copy(car.position);
      G.player.heading = car.userData.heading;
      car.userData.isPlayer = true;
    }
  } else if (G.player.car) {
    const car = G.player.car;
    // step out to the car's right side
    const h = car.userData.heading;
    const rx = Math.cos(h);
    const rz = -Math.sin(h);
    let px = car.position.x + rx * 3;
    let pz = car.position.z + rz * 3;
    if (world && world.isBlocked(px, pz, PLAYER_RADIUS)) {
      px = car.position.x - rx * 3;
      pz = car.position.z - rz * 3;
    }
    G.player.pos.set(px, 0, pz);
    G.player.heading = h;
    G.player.onFoot = true;
    G.player.car = null;
    car.userData.isPlayer = false;
    car.userData.speed = 0;
    if (G.player.mesh) {
      G.player.mesh.visible = true;
      G.player.mesh.position.copy(G.player.pos);
    }
  }
}

export function updatePlayer(dt) {
  const p = G.player;
  if (!p.mesh) return;
  world = world || G.world;

  // E edge: enter / exit car
  if (G.input.action && !prevAction) tryEnterExitCar();
  prevAction = G.input.action;

  if (!p.onFoot) return; // driving is handled by updateVehicles
  if (G.mode !== 'playing') return;

  const inp = G.input;
  let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  let mz = (inp.forward ? 1 : 0) - (inp.back ? 1 : 0);
  if (mx === 0 && mz === 0) {
    // idle: ease the walk bob back to neutral
    bobPhase *= 0.9;
    const u = p.mesh.userData;
    u.legL.rotation.x *= 0.8;
    u.legR.rotation.x *= 0.8;
    u.armL.rotation.x *= 0.8;
    u.armR.rotation.x *= 0.8;
    return;
  }
  const len = Math.hypot(mx, mz);
  mx /= len;
  mz /= len;

  // movement relative to the camera yaw
  const yaw = G.cameraYaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // camera looks along -Z rotated by yaw; forward on screen = (-sin, -cos) in xz
  const wx = mx * cos - mz * sin;
  const wz = -mx * sin - mz * cos;
  const speed = inp.sprint ? SPRINT_SPEED : WALK_SPEED;

  let nx = p.pos.x + wx * speed * dt;
  let nz = p.pos.z + wz * speed * dt;
  if (world) {
    if (world.isBlocked(nx, p.pos.z, PLAYER_RADIUS)) nx = p.pos.x;
    if (world.isBlocked(nx, nz, PLAYER_RADIUS)) nz = p.pos.z;
    if (world.isBlocked(nx, nz, PLAYER_RADIUS)) { nx = p.pos.x; nz = p.pos.z; }
  }
  p.pos.set(nx, 0, nz);
  p.speed = speed;

  // face the direction of travel (smooth turn)
  const targetHeading = Math.atan2(wx, wz);
  let dh = targetHeading - p.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  p.heading += THREE.MathUtils.clamp(dh, -10 * dt, 10 * dt);

  // walk bob + limb swing
  bobPhase += dt * speed * 1.6;
  const swing = Math.sin(bobPhase) * 0.55;
  const u = p.mesh.userData;
  u.legL.rotation.x = swing;
  u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing * 0.8;
  u.armR.rotation.x = swing * 0.8;
  u.body.position.y = 1.05 + Math.abs(Math.sin(bobPhase)) * 0.06;

  p.mesh.position.copy(p.pos);
  p.mesh.rotation.y = p.heading;
}
