// save.js — Vice Coast: localStorage save / load. No network, no account.
import { G } from './state.js';

export const SAVE_KEY = 'vice-coast-save-v1';
export const SAVE_VERSION = 1;

function readRaw() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// Snapshot the durable progress. Called on mission complete and on menu quit.
export function saveGame() {
  try {
    const data = {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      cash: Math.round(G.cash || 0),
      missionId: (G.mission && typeof G.mission.id === 'number') ? G.mission.id : -1,
      missionsDone: (G.mission && G.mission.done) ? 1 : 0,
      best: Math.max(0, Math.round(G.cash || 0)),
      health: Math.round(G.health || 100),
      wanted: 0,
    };
    // Keep the best cash ever held, across saves.
    const prev = readRaw();
    if (prev && typeof prev.best === 'number') data.best = Math.max(prev.best, data.best);
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return data;
  } catch (e) {
    return null;
  }
}

// Returns the parsed save object, or null when there is none / it is corrupt.
export function loadGame() {
  const data = readRaw();
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SAVE_VERSION) return null;
  return {
    cash: typeof data.cash === 'number' ? data.cash : 0,
    missionId: typeof data.missionId === 'number' ? data.missionId : -1,
    missionsDone: typeof data.missionsDone === 'number' ? data.missionsDone : 0,
    best: typeof data.best === 'number' ? data.best : 0,
    health: typeof data.health === 'number' ? data.health : 100,
    savedAt: data.savedAt || 0,
  };
}

export function hasSave() {
  return loadGame() !== null;
}

// Apply a loaded save to live state. Returns true when applied.
export function applySave(data) {
  if (!data) return false;
  try {
    G.cash = data.cash || 0;
    if (typeof data.health === 'number') G.health = Math.max(1, Math.min(100, data.health));
    G.wanted = 0;
    G.heat = 0;
    return true;
  } catch (e) {
    return false;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

export default { saveGame, loadGame, hasSave, applySave, clearSave, SAVE_KEY };
