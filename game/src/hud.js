// hud.js — Vice Coast: HUD, minimap, toasts and mission banners.
// Reads live state from G only; never owns game rules.
import { G } from './state.js';
import { MISSIONS, DIALOGUE, districtAt } from './missions.js';

let els = {};
let worldRef = null;
let toastTimer = null;
let bannerTimer = null;
let minimapCtx = null;
let pulse = 0;

const MINIMAP_RANGE = 130; // metres shown from the player to the canvas edge

function wrapCluster(ids, cls) {
  try {
    const first = $(ids[0]);
    if (!first || !first.parentNode) return;
    if (first.parentNode.classList && first.parentNode.classList.contains(cls)) return;
    const div = document.createElement('div');
    div.className = cls;
    first.parentNode.insertBefore(div, first);
    for (const id of ids) {
      const el = $(id);
      if (el) div.appendChild(el);
    }
  } catch (e) { /* HUD grouping must never break the game */ }
}

function $(id) {
  return document.getElementById(id);
}

function fmtCash(n) {
  return '$' + Math.round(n || 0).toLocaleString('en-US');
}

function ensureBanner() {
  let b = $('mission-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'mission-banner';
    b.className = 'mission-banner hidden';
    const hud = $('hud') || document.body;
    hud.appendChild(b);
  }
  return b;
}

function showBanner(text, sub) {
  const b = ensureBanner();
  b.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'mission-banner-title';
  t.textContent = text;
  b.appendChild(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'mission-banner-sub';
    s.textContent = sub;
    b.appendChild(s);
  }
  b.classList.remove('hidden');
  b.classList.add('show');
  if (bannerTimer) clearTimeout(bannerTimer);
  // In shot mode the banner is a staged element: it stays up for the whole
  // capture instead of racing the 4.5 s wall-clock timer (headless load
  // already eats most of that before the screenshot).
  if (G.flags && G.flags.shotMode) return;
  bannerTimer = setTimeout(() => {
    b.classList.remove('show');
    b.classList.add('hidden');
  }, 4500);
}

function showToast(text) {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  box.appendChild(el);
  // Keep the stack short; oldest toasts fade out first.
  while (box.children.length > 4) box.removeChild(box.firstChild);
  // In shot mode the toast is staged text: it stays up for the capture.
  if (G.flags && G.flags.shotMode) return;
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  }, 4000);
}

export function initHUD(world) {
  worldRef = world || null;
  // index.html lays the HUD elements out flat; group the status cluster and
  // the speed cluster into the positioned wrappers style.css expects.
  wrapCluster(['wanted-stars', 'cash', 'health-bar', 'hud-district', 'hud-clock'], 'hud-top-left');
  wrapCluster(['speed', 'ammo'], 'hud-bottom-right');
  els = {
    hud: $('hud'),
    stars: $('wanted-stars'),
    cash: $('cash'),
    healthFill: document.querySelector('#health-bar > #health-fill') || $('health-fill'),
    healthBar: $('health-bar'),
    district: $('hud-district'),
    clock: $('hud-clock'),
    missionLine: $('hud-mission'),
    dialogue: $('hud-dialogue'),
    minimap: $('minimap'),
    objective: $('objective'),
    speed: $('speed'),
    ammo: $('ammo'),
    toasts: $('toasts'),
  };
  if (els.minimap) {
    try { minimapCtx = els.minimap.getContext('2d'); } catch (e) { minimapCtx = null; }
  }
  ensureBanner();
  return els;
}

function drawMinimap() {
  if (!minimapCtx || !els.minimap) return;
  const c = minimapCtx;
  const W = els.minimap.width || 180;
  const H = els.minimap.height || 180;
  const p = (G.player && G.player.pos) || { x: 0, z: 0 };
  const px = p.x || 0;
  const pz = p.z || 0;
  const scale = W / (MINIMAP_RANGE * 2);
  const toX = (x) => W / 2 + (x - px) * scale;
  const toY = (z) => H / 2 + (z - pz) * scale;

  // Dark water/land background.
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#0d2b33';
  c.fillRect(0, 0, W, H);

  // Ocean west of the beach + sand strip, so the coast reads on the map.
  const waterX = toX(-238);
  if (waterX > 0) {
    c.fillStyle = '#1e7fa8';
    c.fillRect(0, 0, Math.min(W, waterX), H);
  }
  const beachX = toX(-214);
  if (beachX > 0 && waterX < W) {
    c.fillStyle = '#c9a86a';
    c.fillRect(Math.max(0, waterX), 0, Math.max(0, Math.min(W, beachX) - Math.max(0, waterX)), H);
  }

  // Roads: the city is a grid; draw the grid lines in range.
  c.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  c.lineWidth = 2;
  const step = 40;
  const startX = Math.floor((px - MINIMAP_RANGE) / step) * step;
  const startZ = Math.floor((pz - MINIMAP_RANGE) / step) * step;
  c.beginPath();
  for (let x = startX; x <= px + MINIMAP_RANGE; x += step) {
    c.moveTo(toX(x), 0);
    c.lineTo(toX(x), H);
  }
  for (let z = startZ; z <= pz + MINIMAP_RANGE; z += step) {
    c.moveTo(0, toY(z));
    c.lineTo(W, toY(z));
  }
  c.stroke();

  // Buildings as blocks, when the world exposes them.
  try {
    const buildings = (worldRef && worldRef.buildings) || [];
    c.fillStyle = 'rgba(8, 60, 72, 0.9)';
    for (const b of buildings) {
      const bx = b.position ? b.position.x : (b.x || 0);
      const bz = b.position ? b.position.z : (b.z || 0);
      const bw = (b.scale ? b.scale.x : (b.w || 10)) || 10;
      const bd = (b.scale ? b.scale.z : (b.d || 10)) || 10;
      const mx = toX(bx);
      const my = toY(bz);
      if (mx < -20 || mx > W + 20 || my < -20 || my > H + 20) continue;
      c.fillRect(mx - (bw * scale) / 2, my - (bd * scale) / 2, Math.max(2, bw * scale), Math.max(2, bd * scale));
    }
  } catch (e) { /* minimap must never crash the game */ }

  // Mission marker: pulsing gold diamond.
  const target = G.mission && G.mission.target;
  if (target && typeof target.x === 'number' && !G.mission.done) {
    const mx = toX(target.x);
    const my = toY(target.z);
    const r = 5 + Math.sin(pulse * 5) * 2;
    c.fillStyle = '#ffc233';
    c.beginPath();
    c.moveTo(mx, my - r);
    c.lineTo(mx + r, my);
    c.lineTo(mx, my + r);
    c.lineTo(mx - r, my);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255, 194, 51, 0.5)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(mx, my, r + 5, 0, Math.PI * 2);
    c.stroke();
  }

  // Traffic: grey dots.
  try {
    const traffic = G.traffic || [];
    c.fillStyle = '#9aa5ad';
    for (const t of traffic) {
      const pos = t.position || t;
      if (!pos) continue;
      c.fillRect(toX(pos.x || 0) - 1.5, toY(pos.z || 0) - 1.5, 3, 3);
    }
  } catch (e) { /* ignore */ }

  // Police: red dots.
  try {
    const police = G.police || [];
    c.fillStyle = '#ff3b30';
    for (const pc of police) {
      const pos = pc.position || pc;
      if (!pos) continue;
      c.beginPath();
      c.arc(toX(pos.x || 0), toY(pos.z || 0), 3.5, 0, Math.PI * 2);
      c.fill();
    }
  } catch (e) { /* ignore */ }

  // Player: white arrow rotated by heading.
  const heading = (G.player && G.player.heading) || 0;
  const cx = W / 2;
  const cy = H / 2;
  c.save();
  c.translate(cx, cy);
  // Canvas y grows downward while world z grows "down" on the map; heading
  // is atan2(dx, dz), so rotate by heading directly.
  c.rotate(heading);
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#0d2b33';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, -8);
  c.lineTo(5.5, 6);
  c.lineTo(0, 3);
  c.lineTo(-5.5, 6);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();

  // North tick.
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.font = 'bold 10px sans-serif';
  c.fillText('N', W - 14, 14);
}

function drainEvents() {
  if (!G.events || !G.events.length) return;
  const rest = [];
  for (const ev of G.events) {
    if (!ev) continue;
    if (ev.type === 'toast' && ev.text) showToast(ev.text);
    else if (ev.type === 'banner' && ev.text) showBanner(ev.text, ev.sub);
    else rest.push(ev);
  }
  G.events.length = 0;
  for (const ev of rest) G.events.push(ev);
}

export function updateHUD(dt) {
  dt = Math.max(0, dt || 0);
  pulse += dt;
  drainEvents();
  if (!G) return;

  // Wanted stars.
  if (els.stars) {
    const w = Math.max(0, Math.min(5, G.wanted || 0));
    const text = '★'.repeat(w) + '☆'.repeat(5 - w);
    if (els.stars.textContent !== text) els.stars.textContent = text;
    els.stars.classList.toggle('hot', w >= 3);
  }

  // Cash.
  if (els.cash) {
    const text = fmtCash(G.cash);
    if (els.cash.textContent !== text) els.cash.textContent = text;
  }

  // Health bar.
  const hp = Math.max(0, Math.min(100, G.health || 0));
  if (els.healthFill) els.healthFill.style.width = hp + '%';
  if (els.healthBar) {
    els.healthBar.classList.toggle('low', hp <= 25);
    els.healthBar.title = `Health ${Math.round(hp)}`;
  }

  // District name + golden-hour clock (17:21 at run start, 1 game-minute
  // per 2 real seconds, so staged shots read ~17:21-17:23).
  const p = (G.player && G.player.pos) || { x: 0, z: 0 };
  if (els.district) {
    const text = districtAt(p.x || 0, p.z || 0);
    if (els.district.textContent !== text) els.district.textContent = text;
  }
  if (els.clock) {
    const mins = 17 * 60 + 21 + Math.floor((G.time || 0) / 2);
    const text = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    if (els.clock.textContent !== text) els.clock.textContent = text;
  }

  // Mission title + distance, and the story dialogue line on screen.
  const mid = G.mission ? G.mission.id : -1;
  const m = (typeof mid === 'number' && MISSIONS[mid]) ? MISSIONS[mid] : null;
  if (els.missionLine) {
    let text = '';
    if (m && !G.mission.done) {
      const t = G.mission.target;
      if (t && typeof t.x === 'number') {
        const d = Math.round(Math.hypot(t.x - (p.x || 0), t.z - (p.z || 0)));
        text = `MISSION ${m.id + 1} · ${m.title.toUpperCase()} — ${d} M`;
      } else {
        text = `MISSION ${m.id + 1} · ${m.title.toUpperCase()}`;
      }
    }
    if (els.missionLine.textContent !== text) els.missionLine.textContent = text;
    els.missionLine.classList.toggle('hidden', !text);
  }
  if (els.dialogue) {
    const text = (m && !G.mission.done) ? (DIALOGUE[m.id] || '') : '';
    if (els.dialogue.textContent !== text) els.dialogue.textContent = text;
    els.dialogue.classList.toggle('hidden', !text);
  }

  // Speed (km/h) — big readout while driving; on foot it says so.
  if (els.speed) {
    const kmh = Math.round(Math.abs((G.player && G.player.speed) || 0) * 3.6);
    const text = (G.player && !G.player.onFoot) ? kmh + ' km/h' : 'ON FOOT';
    if (els.speed.textContent !== text) els.speed.textContent = text;
  }

  // Ammo, with the weapon name — PISTOL is the player's sidearm.
  if (els.ammo) {
    const text = typeof G.ammo === 'number' ? `PISTOL · ${G.ammo}` : 'PISTOL · —';
    if (els.ammo.textContent !== text) els.ammo.textContent = text;
  }

  // Objective.
  if (els.objective) {
    const text = (G.mission && G.mission.objective) || 'Free roam — explore Vice Coast.';
    if (els.objective.textContent !== text) els.objective.textContent = text;
  }

  drawMinimap();
}

export default { initHUD, updateHUD };
