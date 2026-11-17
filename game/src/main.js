// main.js — Vice Coast: wiring. Renderer, scene, fixed-step loop, input,
// cameras, screen state machine, menus, save/load and shot mode.
// Every subsystem update is guarded so one missing optional ref never
// crashes the loop.
import * as THREE from '../vendor/three.min.js';
import { G } from './state.js';
import { buildWorld } from './world.js';
import * as Vehicles from './vehicles.js';
import { createPlayer, updatePlayer } from './player.js';
import * as Police from './police.js';
import * as Missions from './missions.js';
import * as Combat from './combat.js';
import { initHUD, updateHUD } from './hud.js';
import { AudioSys } from './audio.js';
import { saveGame, loadGame, hasSave, applySave } from './save.js';
import { stageShot, getShotName } from './shots.js';

const FIXED_DT = 1 / 60;
const CAMERA_MODES = ['follow', 'hood', 'top'];

let renderer = null;
let scene = null;
let camera = null;
let world = null;
let playerMesh = null;
let clock = null;
let accumulator = 0;
let lastTime = 0;
let prevMode = '';
let orbitAngle = 0;
let camPos = null;
let camTarget = null;
let shotName = '';
let warned = new Set();

function warnOnce(key, err) {
  if (warned.has(key)) return;
  warned.add(key);
  try { console.warn('[vice-coast]', key, err); } catch (e) { /* ignore */ }
}

function safe(fn, key) {
  try {
    if (typeof fn === 'function') fn();
  } catch (e) {
    warnOnce(key, e);
  }
}

// ---------- menus ----------
const MENU_IDS = ['menu-title', 'menu-pause', 'menu-busted', 'menu-wasted'];

function showOnly(id) {
  for (const m of MENU_IDS) {
    const el = document.getElementById(m);
    if (el) el.classList.toggle('hidden', m !== id);
  }
  const hud = document.getElementById('hud');
  if (hud) hud.classList.toggle('hidden', id === 'menu-title');
}

function showMenuForMode(mode) {
  if (mode === 'title') showOnly('menu-title');
  else if (mode === 'paused') showOnly('menu-pause');
  else if (mode === 'busted') showOnly('menu-busted');
  else if (mode === 'wasted') showOnly('menu-wasted');
  else showOnly(null);
}

function refreshTitleMenu() {
  const title = document.getElementById('mission-title');
  const desc = document.getElementById('mission-desc');
  const m = Missions.MISSIONS[0];
  if (title && m) title.textContent = `Mission 1: ${m.title}`;
  if (desc && m) desc.textContent = m.desc;
  const menuTitle = document.getElementById('menu-title');
  if (menuTitle) {
    // The save note lives inside the panel (added by panelizeMenus).
    const host = menuTitle.querySelector('.menu-panel') || menuTitle;
    let saveNote = document.getElementById('save-note');
    if (!saveNote) {
      saveNote = document.createElement('p');
      saveNote.id = 'save-note';
      saveNote.className = 'save-note';
      host.appendChild(saveNote);
    }
    const s = loadGame();
    saveNote.textContent = s
      ? `Saved game: $${(s.cash || 0).toLocaleString('en-US')} · mission ${Math.max(0, s.missionId + 1)} of 3`
      : 'No saved game yet — start fresh and make Mara Voss proud.';
  }
}

// index.html puts menu content flat inside each .menu overlay; wrap it in
// the .menu-panel card style.css styles, and add a controls list to the
// title screen.
function panelizeMenus() {
  for (const id of MENU_IDS) {
    const menu = document.getElementById(id);
    if (!menu || menu.querySelector('.menu-panel')) continue;
    const panel = document.createElement('div');
    panel.className = 'menu-panel';
    while (menu.firstChild) panel.appendChild(menu.firstChild);
    menu.appendChild(panel);
  }
  const titlePanel = document.querySelector('#menu-title .menu-panel');
  if (titlePanel && !titlePanel.querySelector('.controls-list')) {
    const ul = document.createElement('ul');
    ul.className = 'controls-list';
    const rows = [
      ['W A S D', 'Drive / walk'],
      ['Shift', 'Sprint on foot'],
      ['Space', 'Brake / handbrake'],
      ['E', 'Enter car / steal / interact'],
      ['F', 'Punch'],
      ['Click', 'Fire pistol'],
      ['C', 'Camera'],
      ['P / Esc', 'Pause'],
    ];
    for (const [k, v] of rows) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = k;
      li.appendChild(b);
      li.appendChild(document.createTextNode(v));
      ul.appendChild(li);
    }
    titlePanel.appendChild(ul);
  }
}

// ---------- game state ----------
function resetState() {
  G.mode = 'playing';
  G.time = 0;
  G.cash = 0;
  G.health = 100;
  G.wanted = 0;
  G.heat = 0;
  G.ammo = 24;
  if (G.mission) { G.mission.id = -1; G.mission.step = 0; G.mission.objective = ''; G.mission.target = null; G.mission.done = false; }
  if (Array.isArray(G.events)) G.events.length = 0;
  if (G.flags) { G.flags.shot = false; G.flags.shotMode = false; }
  safe(() => Police.clearPolice(), 'clearPolice');
  safe(() => Combat.clearCombat(), 'clearCombat');
  if (G.player) {
    const sp = (world && world.spawnPoints && world.spawnPoints.player) || [0, 20];
    // world.js stores spawn points as [x, z] arrays.
    const sx = Array.isArray(sp) ? sp[0] : (sp.x ?? (sp.position ? sp.position.x : 0));
    const sz = Array.isArray(sp) ? sp[1] : (sp.z ?? (sp.position ? sp.position.z : 0));
    if (G.player.pos) { G.player.pos.x = sx; G.player.pos.z = sz; if (typeof G.player.pos.y === 'number') G.player.pos.y = 0; }
    G.player.heading = 0;
    G.player.speed = 0;
    G.player.onFoot = true;
    G.player.car = null;
    if (G.player.mesh) { G.player.mesh.position.set(sx, 0, sz); G.player.mesh.visible = true; }
  }
}

function startFresh() {
  resetState();
  // The player car persists in the world from boot; no re-spawn (a second
  // spawnPlayerCar would duplicate it in G.vehicles).
  safe(() => Missions.startMission(0), 'startMission');
  G.mode = 'playing';
  showMenuForMode('playing');
  AudioSys.init();
}

function continueSaved() {
  const s = loadGame();
  resetState();
  if (s) {
    applySave(s);
    const next = (typeof s.missionId === 'number' && s.missionId >= 0) ? Math.min(s.missionId, 2) : 0;
    safe(() => Missions.startMission(next), 'startMission');
  } else {
    startFresh();
    return;
  }
  G.mode = 'playing';
  showMenuForMode('playing');
  AudioSys.init();
}

function pauseGame() {
  if (G.mode !== 'playing') return;
  G.mode = 'paused';
  safe(() => saveGame(), 'savePause');
  safe(() => AudioSys.suspend(), 'audioSuspend');
  showMenuForMode('paused');
}

function resumeGame() {
  if (G.mode !== 'paused') return;
  G.mode = 'playing';
  safe(() => AudioSys.resume(), 'audioResume');
  showMenuForMode('playing');
}

function quitToTitle() {
  safe(() => saveGame(), 'saveQuit');
  safe(() => Police.clearPolice(), 'clearPoliceQuit');
  safe(() => Combat.clearCombat(), 'clearCombatQuit');
  G.mode = 'title';
  G.cameraMode = 'orbit';
  refreshTitleMenu();
  showMenuForMode('title');
}

// ---------- input ----------
const keys = new Set();

function bindInput() {
  window.addEventListener('keydown', (e) => {
    AudioSys.init();
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === 'e' && G.input) G.input.action = true;
    if (k === 'f' && G.input) G.input.punch = true;
    if (k === 'm') AudioSys.setMuted(!AudioSys.isMuted);
    if (k === 'c') cycleCamera();
    if (k === 'p' || k === 'escape') {
      if (G.mode === 'playing') pauseGame();
      else if (G.mode === 'paused') resumeGame();
    }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('mousedown', (e) => {
    AudioSys.init();
    if (e.button !== 0) return;
    if (G.mode === 'playing' && G.player && G.player.onFoot && G.input) G.input.shoot = true;
  });
  window.addEventListener('blur', () => {
    if (G.mode === 'playing' && !shotName) pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'playing' && !shotName) pauseGame();
  });
}

function pollInput() {
  if (!G.input) return;
  G.input.forward = keys.has('w') || keys.has('arrowup');
  G.input.back = keys.has('s') || keys.has('arrowdown');
  G.input.left = keys.has('a') || keys.has('arrowleft');
  G.input.right = keys.has('d') || keys.has('arrowright');
  G.input.brake = keys.has(' ');
  G.input.sprint = keys.has('shift');
}

function cycleCamera() {
  const cur = CAMERA_MODES.indexOf(G.cameraMode);
  G.cameraMode = CAMERA_MODES[(cur + 1) % CAMERA_MODES.length] || 'follow';
}

// ---------- camera ----------
function updateCamera(dt) {
  if (!camera || !G.player || !G.player.pos) return;
  const p = G.player.pos;
  const heading = G.player.heading || 0;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const mode = G.cameraMode || 'follow';

  if (mode === 'orbit' || G.mode === 'title') {
    orbitAngle += dt * 0.08;
    const cx = (world && world.spawnPoints && world.spawnPoints.player) ? 0 : 0;
    const tx = cx + Math.cos(orbitAngle) * 70;
    const tz = Math.sin(orbitAngle) * 70;
    // Downtown rooftops reach 40, so 34 sat at roof level and a roof
    // filled half the title/start frame. 48 clears them.
    camPos.set(tx, 48, tz);
    camTarget.set(0, 4, 0);
  } else if (mode === 'top') {
    camPos.set(p.x, 70, p.z + 0.01);
    camTarget.set(p.x, 0, p.z);
  } else if (mode === 'hood' && G.player.car) {
    camPos.set(p.x + fx * 0.6, 1.35, p.z + fz * 0.6);
    camTarget.set(p.x + fx * 30, 1.2, p.z + fz * 30);
  } else {
    // Follow: behind and above, looking ahead.
    const dist = G.player.onFoot ? 8 : 11;
    const height = G.player.onFoot ? 4.5 : 5;
    camPos.set(p.x - fx * dist, height, p.z - fz * dist);
    camTarget.set(p.x + fx * 7, 1.5, p.z + fz * 7);
  }
  const k = mode === 'orbit' || G.mode === 'title' ? 1 - Math.exp(-dt * 1.2) : 1 - Math.exp(-dt * 5);
  camera.position.lerp(camPos, Math.min(1, k));
  const look = new THREE.Vector3().copy(camTarget);
  camera.lookAt(look);
}

// ---------- fixed update ----------
function fixedUpdate(dt) {
  pollInput();
  G.time = (G.time || 0) + dt;
  safe(() => updatePlayer(dt), 'updatePlayer');
  safe(() => { if (typeof Vehicles.updateVehicles === 'function') Vehicles.updateVehicles(dt); }, 'updateVehicles');
  safe(() => Police.updatePolice(dt), 'updatePolice');
  safe(() => Missions.updateMissions(dt), 'updateMissions');
  safe(() => Combat.updateCombat(dt), 'updateCombat');
  safe(() => AudioSys.update(), 'audioUpdate');
  // Edge-triggered inputs live for exactly one fixed step.
  if (G.input) G.input.action = false;
}

// ---------- frame loop ----------
function frame(t) {
  requestAnimationFrame(frame);
  if (!lastTime) lastTime = t;
  let dt = (t - lastTime) / 1000;
  lastTime = t;
  dt = Math.min(0.1, Math.max(0, dt));

  // Mode-change side effects (busted / wasted arrive from police / combat).
  if (G.mode !== prevMode) {
    if (G.mode === 'busted' || G.mode === 'wasted') {
      safe(() => saveGame(), 'saveEnd');
      safe(() => AudioSys.setSiren(false), 'sirenOff');
      showMenuForMode(G.mode);
    } else if (G.mode === 'playing' && prevMode !== 'paused') {
      showMenuForMode('playing');
    }
    prevMode = G.mode;
  }

  if (G.mode === 'playing') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_DT && steps < 5) {
      fixedUpdate(FIXED_DT);
      accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === 5) accumulator = 0;
  }

  updateCamera(dt);
  safe(() => updateHUD(dt), 'updateHUD');
  if (renderer && scene && camera) {
    try { renderer.render(scene, camera); } catch (e) { warnOnce('render', e); }
  }
}

// ---------- boot ----------
function fallbackWorld() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x9aa78f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Minimal lights: only used when buildWorld failed (the real world
  // brings its own sun + hemisphere).
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b3, 2.2);
  sun.position.set(80, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -120;
  sun.shadow.camera.right = 120;
  sun.shadow.camera.top = 120;
  sun.shadow.camera.bottom = -120;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  return {
    buildings: [],
    colliders: [],
    spawnPoints: {
      player: [0, 20],
      garage: [104, 8],
      harbor: [-226, 60],
      pickup: [52, 104],
    },
    isBlocked: () => false,
    roadAt: () => true,
  };
}

function buildScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd3e8);
  scene.fog = new THREE.Fog(0xa8d8e8, 90, 320);
  // Lighting comes from world.js (sun, hemisphere, sky dome, fog); main.js
  // adds no lights of its own, so the scene is never double-lit. The
  // fallback world below adds its own minimal lights.

  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 800);
  camera.position.set(0, 30, 60);
  camPos = new THREE.Vector3().copy(camera.position);
  camTarget = new THREE.Vector3(0, 4, 0);

  try {
    world = buildWorld(scene);
  } catch (e) {
    warnOnce('buildWorld', e);
    world = fallbackWorld();
  }
  if (!world || typeof world.isBlocked !== 'function') world = fallbackWorld();

  safe(() => { playerMesh = createPlayer(scene); }, 'createPlayer');
  if (playerMesh && G.player) G.player.mesh = playerMesh;

  safe(() => { if (typeof Vehicles.spawnTraffic === 'function') Vehicles.spawnTraffic(scene); }, 'spawnTraffic');
  safe(() => { if (typeof Vehicles.spawnPeds === 'function') Vehicles.spawnPeds(scene); }, 'spawnPeds');
  safe(() => { if (typeof Vehicles.spawnPlayerCar === 'function') Vehicles.spawnPlayerCar(scene); }, 'spawnPlayerCarBoot');

  safe(() => Police.initPolice(scene, world, Vehicles), 'initPolice');
  safe(() => Missions.initMissions(scene, world, Vehicles), 'initMissions');
  safe(() => Combat.initCombat(scene, camera, world), 'initCombat');
  safe(() => initHUD(world), 'initHUD');
}

function onContinueClick() {
  AudioSys.init();
  AudioSys.click();
  if (G.mode === 'paused') resumeGame();
  else continueSaved();
}

function bindButtons() {
  const start = document.getElementById('btn-start');
  if (start) start.addEventListener('click', () => { AudioSys.init(); AudioSys.click(); startFresh(); });
  // #btn-continue lives on the pause menu; the title menu has none, so add
  // one there when a save exists (distinct id, same handler).
  if (hasSave()) {
    const titleMenu = document.getElementById('menu-title');
    if (titleMenu && !titleMenu.querySelector('#btn-continue-title')) {
      const b = document.createElement('button');
      b.id = 'btn-continue-title';
      b.className = 'secondary';
      b.textContent = 'Continue saved game';
      const panel = titleMenu.querySelector('.menu-panel') || titleMenu;
      const anchor = document.getElementById('btn-start');
      if (anchor) panel.insertBefore(b, anchor);
      else panel.appendChild(b);
      b.addEventListener('click', onContinueClick);
    }
  }
  // #btn-continue appears on the pause menu (resume): branch on live mode.
  document.querySelectorAll('#btn-continue').forEach((cont) => {
    cont.addEventListener('click', onContinueClick);
  });
  document.querySelectorAll('#btn-restart').forEach((restart) => {
    restart.addEventListener('click', () => { AudioSys.init(); AudioSys.click(); startFresh(); });
  });
  // Busted / wasted menus: any button inside retries, click on the menu retries too.
  for (const id of ['menu-busted', 'menu-wasted']) {
    const menu = document.getElementById(id);
    if (!menu) continue;
    menu.addEventListener('click', (e) => {
      if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) {
        AudioSys.init();
        startFresh();
      }
    });
  }
  // Pause menu: continue button resumes when the game is paused.
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

export function boot() {
  const canvasHolder = document.body;
  // index.html already provides <canvas id="game-canvas">; render into it
  // instead of creating a second canvas.
  const existingCanvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({
    canvas: existingCanvas || undefined,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  if (!existingCanvas) {
    renderer.domElement.id = 'game-canvas';
    canvasHolder.prepend(renderer.domElement);
  }
  window.addEventListener('resize', onResize);

  buildScene();
  bindInput();
  panelizeMenus();
  bindButtons();
  refreshTitleMenu();

  shotName = getShotName();
  if (shotName) {
    // Shot mode: stage the scene, hide every menu, run the loop, no audio.
    G.flags = G.flags || {};
    G.flags.shot = true;
    G.flags.shotMode = true;
    try { document.body.classList.add('shot-mode'); } catch (e) { /* ignore */ }
    const staged = stageShot(shotName, { scene, camera, world, vehicles: Vehicles });
    if (!staged.ok) warnOnce('stageShot', staged.error);
    if (shotName === 'start') {
      // The start shot is the title screen: show the VICE COAST menu
      // over the orbiting city (HUD stays hidden), instead of a bare
      // HUD-less city view with no title in it.
      showMenuForMode('title');
    } else {
      showOnly(null);
      const hud = document.getElementById('hud');
      if (hud) hud.classList.remove('hidden');
    }
    prevMode = G.mode;
  } else {
    G.mode = 'title';
    G.cameraMode = 'orbit';
    showMenuForMode('title');
    prevMode = 'title';
  }

  clock = new THREE.Clock();
  requestAnimationFrame(frame);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

export default { boot };
