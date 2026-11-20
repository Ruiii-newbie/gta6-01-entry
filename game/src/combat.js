// combat.js — Vice Coast: on-foot combat.
// F punches (25 dmg, knockback), mouse click fires the pistol (50 dmg, ammo),
// armed guards approach and shoot back (health 100), health packs heal +40.
// Player health reaching 0 sets mode to 'wasted'.
// Round 5: muzzle flash + hit sparks, screen shake on shooting / being hit,
// and gunfire that sends nearby pedestrians running (pedestrians.js).
import * as THREE from '../vendor/three.min.js';
import { G } from './state.js';
import { pedFleeFromGunfire } from './pedestrians.js';

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
// Muzzle flash: a bright billboard at the gun + a point light, visible for
// one frame-burst after every shot. Hit sparks: a reused pool of small
// orange shards that burst where a bullet lands and fall away.
let flashMesh = null;
let flashLight = null;
let flashT = 0;
const SPARK_POOL = 18;
let sparkPool = [];
let combatShotFxT = 0; // shot-mode staging timer (combat screenshot only)

function addShake(n) {
  G.shake = Math.max(G.shake || 0, n);
}

function makeFlashTexture() {
  // Radial hot-core gradient: a muzzle flash is a burst, not a card —
  // a hard-edged plane reads as a floating yellow poster.
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,240,1)');
  g.addColorStop(0.35, 'rgba(255,220,85,0.9)');
  g.addColorStop(0.7, 'rgba(255,140,30,0.35)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function initFlashFx() {
  if (flashMesh || !sceneRef) return;
  const flashMat = new THREE.MeshBasicMaterial({
    map: makeFlashTexture(), transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), flashMat);
  flashMesh.visible = false;
  sceneRef.add(flashMesh);
  flashLight = new THREE.PointLight(0xffc233, 0, 9, 1.8);
  sceneRef.add(flashLight);
  const sparkGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
  for (let i = 0; i < SPARK_POOL; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa233 });
    const m = new THREE.Mesh(sparkGeo, mat);
    m.visible = false;
    sceneRef.add(m);
    sparkPool.push({ mesh: m, life: 0, vx: 0, vy: 0, vz: 0 });
  }
}

// Show the muzzle flash at the player's gun (or at x,y,z when given).
// Offset to the gun side and up so the flash clears the player's own
// silhouette from the follow camera behind him.
export function showMuzzleFlash(x, y, z) {
  initFlashFx();
  if (!flashMesh) return;
  const p = playerPos();
  const heading = (G.player && G.player.heading) || 0;
  const fx = typeof x === 'number' ? x : p.x + Math.sin(heading) * 0.9 + Math.cos(heading) * 0.45;
  const fz = typeof z === 'number' ? z : p.z + Math.cos(heading) * 0.9 - Math.sin(heading) * 0.45;
  const fy = typeof y === 'number' ? y : 1.45;
  flashMesh.position.set(fx, fy, fz);
  flashMesh.visible = true;
  flashT = 0.07;
  if (flashLight) {
    flashLight.position.set(fx, fy, fz);
    flashLight.intensity = 14;
  }
}

// Burst of hot sparks where a bullet lands.
export function showHitSparks(x, y, z) {
  initFlashFx();
  let spawned = 0;
  for (const s of sparkPool) {
    if (s.life > 0) continue;
    s.life = 0.35;
    s.mesh.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2;
    const up = 1 + Math.random() * 3;
    s.vx = Math.cos(a) * (2 + Math.random() * 3);
    s.vz = Math.sin(a) * (2 + Math.random() * 3);
    s.vy = up;
    s.mesh.visible = true;
    if (++spawned >= 6) break;
  }
}

function updateFlashFx(dt) {
  if (flashMesh) {
    if (flashT > 0) {
      // In shot mode the flash decays 5x slower (0.35 game-seconds): a
      // 0.07 s flash is shorter than the headless capture jitter, so the
      // screenshot kept landing between flashes. Live play is unaffected.
      const decay = (G.flags && G.flags.shotMode) ? dt * 0.2 : dt;
      flashT -= decay;
      if (flashT <= 0) flashMesh.visible = false;
      else if (cameraRef) flashMesh.lookAt(cameraRef.position);
    }
    if (flashLight && flashLight.intensity > 0) {
      flashLight.intensity = Math.max(0, flashLight.intensity - dt * 220);
    }
  }
  for (const s of sparkPool) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.mesh.visible = false; continue; }
    s.vy -= 12 * dt;
    s.mesh.position.x += s.vx * dt;
    s.mesh.position.y += s.vy * dt;
    s.mesh.position.z += s.vz * dt;
    if (s.mesh.position.y < 0.05) s.mesh.position.y = 0.05;
    const k = Math.max(0.2, s.life / 0.35);
    s.mesh.scale.set(k, k, k);
  }
}

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
  addShake(0.5); // being hit kicks the camera
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
  // The shot itself is the event pedestrians react to: the bang sends
  // everyone nearby running, and the camera kicks a little.
  G.gunfireAt = { x: p.x, z: p.z, t: G.time || 0 };
  try { pedFleeFromGunfire(p.x, p.z); } catch (e) { /* peds are optional */ }
  showMuzzleFlash();
  addShake(0.18);
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
  if (hit) {
    damageGuard(hit, SHOT_DAMAGE, p.x, p.z);
    showHitSparks(hit.group.position.x, 1.2, hit.group.position.z);
  } else {
    // Missed: sparks where the round would land, 12 m ahead of the player.
    const heading = (G.player && G.player.heading) || 0;
    showHitSparks(p.x + Math.sin(heading) * 12, 0.4, p.z + Math.cos(heading) * 12);
  }
}

export function updateCombat(dt) {
  if (!G || G.mode !== 'playing') return;
  dt = Math.min(0.1, Math.max(0, dt || 0));
  punchCd = Math.max(0, punchCd - dt);
  guardShootFx = Math.max(0, guardShootFx - dt);
  updateFlashFx(dt);
  // Shot-mode combat staging: the screenshot is a live firefight, so the
  // muzzle flash + sparks re-fire on a timer (visuals only — no ammo
  // spent, no guard damaged) instead of flashing once at stage time and
  // being long gone by the capture.
  if (G.flags && G.flags.shotMode && G.flags.shotName === 'combat') {
    combatShotFxT -= dt;
    if (combatShotFxT <= 0) {
      // Period equals the shot-mode flash hold (0.35 s): the flash is
      // effectively continuous in the staged frame, so no capture can
      // land in the gap between bursts. Live play never runs this branch.
      combatShotFxT = 0.35;
      showMuzzleFlash();
      const alive = guards.filter((g) => g.alive);
      if (alive.length) {
        const g = alive[0];
        showHitSparks(g.group.position.x, 1.2, g.group.position.z);
      }
    }
  }
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
      showMuzzleFlash(gx + (dx / dist) * 0.9, 1.25, gz + (dz / dist) * 0.9);
      // Guards are sloppy at range: hit chance falls with distance.
      const hitChance = Math.max(0.25, 0.85 - dist * 0.02);
      if (Math.random() < hitChance) {
        damagePlayer(8);
        showHitSparks(p.x, 1.2, p.z);
      }
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

export default { updateCombat, spawnGuards, spawnHealthPack, initCombat, getGuardsAlive, damagePlayer, refillAmmo, clearCombat, showMuzzleFlash, showHitSparks };
