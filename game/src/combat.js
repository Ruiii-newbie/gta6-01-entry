// combat.js — Vice Coast: on-foot combat.
// F punches (25 dmg, knockback), mouse click fires the pistol (50 dmg, ammo),
// armed guards approach and shoot back (health 100), health packs heal +40.
// Player health reaching 0 sets mode to 'wasted'.
import * as THREE from '../vendor/three.min.js';
import { G } from './state.js';

export const PUNCH_DAMAGE = 25;
export const SHOT_DAMAGE = 50;
export const GUARD_HEALTH = 100;
export const PUNCH_RANGE = 2.4;
export const SHOOT_RANGE = 60;
export const START_AMMO = 24;

let sceneRef = null;
let cameraRef = null;
let worldRef = null;
const guards = []; // { group, health, shootCd, alive }
const packs = []; // { group, kind }
const raycaster = new THREE.Raycaster();
let punchCd = 0;
let guardShootFx = 0;

function playerPos() {
  const p = G.player && G.player.pos;
  if (!p) return { x: 0, z: 0 };
  return { x: p.x || 0, z: p.z || 0 };
}

function toast(text) {
  if (G.events) G.events.push({ type: 'toast', text });
}

function pushSound(name) {
  if (G.events) G.events.push({ type: 'sound', name });
}

function isBlocked(x, z, r) {
  try {
    if (worldRef && typeof worldRef.isBlocked === 'function') return worldRef.isBlocked(x, z, r);
  } catch (e) { /* ignore */ }
  return false;
}

export function initCombat(scene, camera, world) {
  sceneRef = scene || null;
  cameraRef = camera || null;
  worldRef = world || null;
  if (typeof G.ammo !== 'number') G.ammo = START_AMMO;
  return guards;
}

export function refillAmmo() {
  G.ammo = START_AMMO;
}

export function getGuardsAlive() {
  return guards.filter((g) => g.alive).length;
}

export function getGuards() {
  return guards;
}

function makeGuardMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.7 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x8a2f2f, roughness: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.5), vest);
  body.position.y = 1.05;
  body.castShadow = true;
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.8 }),
  );
  head.position.y = 1.85;
  head.castShadow = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.4), mat);
  legs.position.y = 0.35;
  const gun = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.7),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.6 }),
  );
  gun.position.set(0.3, 1.25, 0.45);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x22ff66, emissive: 0x00aa33 }));
  bar.position.y = 2.2;
  g.add(body, head, legs, gun, bar);
  g.userData.isGuard = true;
  g.userData.bar = bar;
  return g;
}

export function spawnGuards(n, at) {
  if (!sceneRef) return [];
  const cx = (at && at.x) || 0;
  const cz = (at && at.z) || 0;
  const made = [];
  for (let i = 0; i < (n || 0); i++) {
    const mesh = makeGuardMesh();
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    mesh.position.set(cx + Math.cos(a) * (6 + i * 2), 0, cz + Math.sin(a) * (6 + i * 2));
    sceneRef.add(mesh);
    const guard = { group: mesh, health: GUARD_HEALTH, shootCd: 0.8 + i * 0.4, alive: true };
    mesh.userData.guard = guard;
    guards.push(guard);
    made.push(guard);
  }
  if (made.length) toast(`${made.length} armed guards ahead — watch out!`);
  return made;
}

function makePackMesh(kind) {
  const g = new THREE.Group();
  const color = kind === 'ammo' ? 0xffaa00 : 0x2ecc71;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.7, 0.7),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 }),
  );
  box.position.y = 0.7;
  box.castShadow = true;
  const cross = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.16, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }),
  );
  cross.position.set(0, 0.7, 0.38);
  g.add(box, cross);
  g.userData.isPack = true;
  g.userData.kind = kind;
  return g;
}

export function spawnHealthPack(at, kind = 'health') {
  if (!sceneRef) return null;
  const mesh = makePackMesh(kind);
  mesh.position.set((at && at.x) || 0, 0, (at && at.z) || 0);
  sceneRef.add(mesh);
  const pack = { group: mesh, kind };
  packs.push(pack);
  return pack;
}

export function clearCombat() {
  for (const g of guards) { try { if (sceneRef) sceneRef.remove(g.group); } catch (e) {} }
  guards.length = 0;
  for (const p of packs) { try { if (sceneRef) sceneRef.remove(p.group); } catch (e) {} }
  packs.length = 0;
}

function damageGuard(guard, dmg, fromX, fromZ) {
  if (!guard.alive) return;
  guard.health -= dmg;
  // Knockback away from the attacker.
  const dx = guard.group.position.x - fromX;
  const dz = guard.group.position.z - fromZ;
  const d = Math.hypot(dx, dz) || 1;
  guard.group.position.x += (dx / d) * 0.9;
  guard.group.position.z += (dz / d) * 0.9;
  const bar = guard.group.userData.bar;
  if (bar) bar.scale.x = Math.max(0.05, guard.health / GUARD_HEALTH);
  if (guard.health <= 0) {
    guard.alive = false;
    guard.group.visible = false;
    if (sceneRef) sceneRef.remove(guard.group);
    toast('Guard down.');
    pushSound('pickup');
    if (Math.random() < 0.5) {
      spawnHealthPack({ x: guard.group.position.x, z: guard.group.position.z }, 'health');
    }
  }
}

export function damagePlayer(n) {
  if (!G || G.mode !== 'playing') return;
  G.health = Math.max(0, (G.health || 0) - n);
  if (G.health <= 0) {
    G.mode = 'wasted';
    pushSound('sting');
    toast('Wasted! Mara Voss is not happy.');
  }
}

function doPunch() {
  const p = playerPos();
  let best = null;
  let bestD = PUNCH_RANGE;
  for (const g of guards) {
    if (!g.alive) continue;
    const d = Math.hypot(g.group.position.x - p.x, g.group.position.z - p.z);
    if (d < bestD) { best = g; bestD = d; }
  }
  pushSound('punch');
  if (best) damageGuard(best, PUNCH_DAMAGE, p.x, p.z);
}

function doShoot() {
  if (typeof G.ammo !== 'number') G.ammo = START_AMMO;
  if (G.ammo <= 0) {
    toast('Out of ammo — punch your way out!');
    pushSound('click');
    return;
  }
  G.ammo -= 1;
  pushSound('shot');
  const p = playerPos();
  let hit = null;

  if (cameraRef && sceneRef) {
    try {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), cameraRef);
      raycaster.far = SHOOT_RANGE;
      const meshes = [];
      for (const g of guards) if (g.alive) meshes.push(...g.group.children);
      const hits = raycaster.intersectObjects(meshes, false);
      if (hits.length) {
        let obj = hits[0].object;
        while (obj && !(obj.userData && obj.userData.guard)) obj = obj.parent;
        if (obj && obj.userData.guard) hit = obj.userData.guard;
      }
    } catch (e) { hit = null; }
  }
  // Fallback: nearest guard roughly ahead of the player.
  if (!hit) {
    const heading = (G.player && G.player.heading) || 0;
    let bestD = SHOOT_RANGE;
    for (const g of guards) {
      if (!g.alive) continue;
      const dx = g.group.position.x - p.x;
      const dz = g.group.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > bestD) continue;
      const ang = Math.atan2(dx, dz);
      let diff = ang - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.6) { hit = g; bestD = d; }
    }
  }
  if (hit) damageGuard(hit, SHOT_DAMAGE, p.x, p.z);
}

export function updateCombat(dt) {
  if (!G || G.mode !== 'playing') return;
  dt = Math.min(0.1, Math.max(0, dt || 0));
  punchCd = Math.max(0, punchCd - dt);
  guardShootFx = Math.max(0, guardShootFx - dt);
  const onFoot = !!(G.player && G.player.onFoot);
  const p = playerPos();

  // Player attacks (on foot only).
  if (onFoot && G.input) {
    if (G.input.punch && punchCd <= 0) {
      punchCd = 0.4;
      doPunch();
    }
    if (G.input.shoot) {
      G.input.shoot = false;
      doShoot();
    }
    if (G.input.punch) G.input.punch = false;
  } else if (G.input) {
    G.input.shoot = false;
    G.input.punch = false;
  }

  // Guard AI: approach the player, shoot when in range.
  for (const g of guards) {
    if (!g.alive) continue;
    const gx = g.group.position.x;
    const gz = g.group.position.z;
    const dx = p.x - gx;
    const dz = p.z - gz;
    const dist = Math.hypot(dx, dz) || 0.001;
    g.group.rotation.y = Math.atan2(dx, dz);
    if (dist > 14) {
      const sp = 3.2 * dt;
      let nx = gx + (dx / dist) * sp;
      let nz = gz + (dz / dist) * sp;
      if (isBlocked(nx, nz, 1)) { nx = gx; nz = gz; }
      g.group.position.set(nx, 0, nz);
    }
    g.shootCd -= dt;
    if (dist < 26 && onFoot && g.shootCd <= 0) {
      g.shootCd = 1.3 + Math.random() * 0.5;
      guardShootFx = 0.12;
      pushSound('shot');
      // Guards are sloppy at range: hit chance falls with distance.
      const hitChance = Math.max(0.25, 0.85 - dist * 0.02);
      if (Math.random() < hitChance) damagePlayer(8);
    }
    // Muzzle flash: brief emissive pulse on the gun bar.
    const bar = g.group.userData.bar;
    if (bar && bar.material) bar.material.emissive.setHex(guardShootFx > 0 ? 0xffff00 : 0x00aa33);
  }

  // Health / ammo packs: bob, spin, pick up on foot within 2 m.
  for (let i = packs.length - 1; i >= 0; i--) {
    const pack = packs[i];
    pack.group.rotation.y += dt * 2;
    pack.group.position.y = Math.sin(performance.now() * 0.003 + i) * 0.08;
    const d = Math.hypot(pack.group.position.x - p.x, pack.group.position.z - p.z);
    if (onFoot && d < 2) {
      if (pack.kind === 'ammo') {
        G.ammo = (G.ammo || 0) + 12;
        toast('Picked up ammo (+12).');
      } else {
        G.health = Math.min(100, (G.health || 0) + 40);
        toast('Health pack +40.');
      }
      pushSound('pickup');
      if (sceneRef) sceneRef.remove(pack.group);
      packs.splice(i, 1);
    }
  }
}

export default { updateCombat, spawnGuards, spawnHealthPack, initCombat, getGuardsAlive, damagePlayer, refillAmmo, clearCombat };
