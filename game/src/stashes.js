// stashes.js — Vice Coast: hidden "Vice stashes" (cash pickups).
// Eight stashes are tucked around the city near landmarks. Walk over one
// on foot to pocket $150. A HUD counter (STASHES n/8) tracks them, the
// minimap shows uncollected stashes as gold dots, and collected stashes
// persist in the save so a stash stays found across sessions.
import * as THREE from 'three';
import { G } from './state.js';
import { saveGame } from './save.js';

export const STASH_COUNT = 8;
export const STASH_REWARD = 150;

// Landmark-adjacent spots, all on roads / sidewalks, never inside a block:
// garage, Coral Hotel, 24H Mart, harbor, boardwalk, Vice Club, Eastside,
// South Vice.
export const STASH_SPOTS = [
  { x: 104, z: 16, note: "Mara's Garage" },
  { x: -200, z: -24, note: 'Coral Hotel' },
  { x: 58, z: 110, note: '24H Mart' },
  { x: -220, z: 50, note: 'Vice Harbor' },
  { x: 6, z: 20, note: 'Boardwalk' },
  { x: -14, z: -52, note: 'Vice Club' },
  { x: 156, z: 98, note: 'Eastside' },
  { x: -98, z: -150, note: 'South Vice' },
];

let sceneRef = null;
let worldRef = null;
const stashes = []; // { group, index, spot, spin }
let bobT = 0;

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

function makeStashMesh() {
  const g = new THREE.Group();
  g.name = 'stash';
  // Gold cash box + green band: reads as money at a glance, distinct from
  // the green health packs and orange ammo boxes.
  const gold = new THREE.MeshStandardMaterial({ color: 0xffc233, roughness: 0.35, metalness: 0.6, emissive: 0x8a6a00, emissiveIntensity: 0.5 });
  const band = new THREE.MeshStandardMaterial({ color: 0x2ecc71, roughness: 0.5, emissive: 0x0a6a2a, emissiveIntensity: 0.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.6), gold);
  box.position.y = 0.65;
  box.castShadow = true;
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.18, 0.62), band);
  strap.position.y = 0.65;
  const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 12);
  const coin = new THREE.Mesh(coinGeo, gold);
  coin.position.y = 1.05;
  coin.rotation.x = 0.4;
  g.add(box, strap, coin);
  g.userData.coin = coin;
  return g;
}

export function getStashes() {
  return stashes;
}

export function getStashesFound() {
  return G.stashesFound || 0;
}

// Live positions of uncollected stashes (minimap gold dots).
export function getStashPositions() {
  return stashes.map((s) => ({ x: s.group.position.x, z: s.group.position.z, index: s.index }));
}

function collectedSet() {
  const arr = (G.stashesCollected && Array.isArray(G.stashesCollected)) ? G.stashesCollected : [];
  return new Set(arr);
}

export function spawnStashes(scene) {
  sceneRef = scene || sceneRef;
  worldRef = worldRef || G.world;
  if (!sceneRef) return stashes;
  clearStashes();
  const done = collectedSet();
  G.stashTotal = STASH_COUNT;
  if (typeof G.stashesFound !== 'number') G.stashesFound = done.size;
  for (let i = 0; i < STASH_SPOTS.length; i++) {
    if (done.has(i)) continue;
    const spot = STASH_SPOTS[i];
    let x = spot.x;
    let z = spot.z;
    // Nudge off a collider (a landmark sign post, a hydrant) if needed.
    if (isBlocked(x, z, 0.8)) {
      let placed = false;
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3]]) {
        if (!isBlocked(x + dx, z + dz, 0.8)) { x += dx; z += dz; placed = true; break; }
      }
      if (!placed) continue;
    }
    const mesh = makeStashMesh();
    mesh.position.set(x, 0, z);
    sceneRef.add(mesh);
    stashes.push({ group: mesh, index: i, spot });
  }
  return stashes;
}

export function clearStashes() {
  for (const s of stashes) {
    try { if (sceneRef) sceneRef.remove(s.group); } catch (e) { /* ignore */ }
  }
  stashes.length = 0;
}

// Re-spawn after a reset, keeping already-collected stashes collected.
export function resetStashes(scene) {
  return spawnStashes(scene);
}

function collectStash(s) {
  G.cash = (G.cash || 0) + STASH_REWARD;
  G.stashesFound = (G.stashesFound || 0) + 1;
  if (!Array.isArray(G.stashesCollected)) G.stashesCollected = [];
  if (!G.stashesCollected.includes(s.index)) G.stashesCollected.push(s.index);
  toast(`Vice stash found! +$${STASH_REWARD} (${G.stashesFound}/${STASH_COUNT}) — ${s.spot.note}.`);
  pushSound('pickup');
  try { if (sceneRef) sceneRef.remove(s.group); } catch (e) { /* ignore */ }
  const i = stashes.indexOf(s);
  if (i >= 0) stashes.splice(i, 1);
  try { saveGame(); } catch (e) { /* ignore */ }
}

export function updateStashes(dt) {
  if (!G || G.mode !== 'playing') return;
  dt = Math.min(0.1, Math.max(0, dt || 0));
  bobT += dt;
  const onFoot = !!(G.player && G.player.onFoot);
  const p = (G.player && G.player.pos) || { x: 0, z: 0 };
  for (let i = stashes.length - 1; i >= 0; i--) {
    const s = stashes[i];
    s.group.rotation.y += dt * 1.6;
    s.group.position.y = Math.sin(bobT * 2 + s.index) * 0.1;
    if (s.group.userData.coin) s.group.userData.coin.rotation.y += dt * 3;
    const d = Math.hypot(s.group.position.x - (p.x || 0), s.group.position.z - (p.z || 0));
    if (onFoot && d < 2.5) collectStash(s);
  }
}

export default { spawnStashes, updateStashes, resetStashes, clearStashes, getStashesFound, getStashPositions, STASH_SPOTS, STASH_COUNT, STASH_REWARD };
