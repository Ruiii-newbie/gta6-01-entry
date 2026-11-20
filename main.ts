// Vice Coast — the gta6-01 entry for make.fun's Make GTA 6 bounty.
// main.ts is the entrypoint that hands the game in: it first runs a
// pre-flight check over game/ and screenshots/, then copies both into
// /output (or $MAKEFUN_OUTPUT_DIR) and writes dossier.json there.
//
// Round 5 (2026-11-20) is a systems round, not a re-skin: pedestrians on
// the sidewalks (who flee fast cars and gunfire), a fourth mission — the
// Vice Heist finale, with a 5-star escape — eight hidden Vice stashes with
// a HUD counter, nitro boost on Shift with a HUD meter, and combat feel
// (muzzle flash, hit sparks, screen shake, tire smoke). All four
// screenshots are re-staged to show the new systems. The pre-flight below
// locks exactly that set, so a stale or misnamed frame can never ship as
// the round-5 entry, and it requires the new pedestrians module and the
// four-mission story to be present.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Pre-flight validation: run before anything is copied and before /output
// is created, so a bad entry fails loudly instead of handing in bad files.
function fail(message: string): never {
  console.error(`Vice Coast pre-flight failed: ${message}`);
  process.exit(1);
}

const indexPath = join(here, 'game', 'index.html');
if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
  fail('game/index.html is missing or is not a regular file');
}
// The gate caps game/index.html at 1 MiB (reference/gate.json).
if (statSync(indexPath).size > 1048576) {
  fail(`game/index.html is ${statSync(indexPath).size} bytes, over the 1 MiB limit`);
}

const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail('screenshots/ is missing');
const shotNames = readdirSync(shotsDir).filter((name) => /\.(png|jpe?g)$/i.test(name));
if (shotNames.length !== 4) {
  fail(`screenshots/ holds ${shotNames.length} image files, expected 4`);
}
// Round 5 locks the four re-staged action frames by name (first by name is
// the cover): a stale menu shot or a misnamed frame fails loudly here.
const expectedShots = ['1-chase.jpg', '2-drive.jpg', '3-mission.jpg', '4-combat.jpg'];
for (const name of expectedShots) {
  if (!shotNames.includes(name)) fail(`screenshots/ is missing round-5 frame ${name}`);
}
// Round 5 systems gate: the pedestrians module must exist (it owns the
// sidewalk walkers, crossings and flee behaviour), and missions.js must
// declare all four missions including the Vice Heist finale (id 3).
const pedPath = join(here, 'game', 'src', 'pedestrians.js');
if (!existsSync(pedPath) || !statSync(pedPath).isFile()) {
  fail('game/src/pedestrians.js is missing — round 5 requires the pedestrians module');
}
const missionsSrc = readFileSync(join(here, 'game', 'src', 'missions.js'), 'utf8');
if (!missionsSrc.includes('Vice Heist') || !/id:\s*3/.test(missionsSrc)) {
  fail('game/src/missions.js does not declare the round-5 Vice Heist finale (Mission 4, id 3)');
}
const missionIds = new Set([...missionsSrc.matchAll(/^\s*id:\s*(\d+),/gm)].map((m) => m[1]));
if (missionIds.size < 4) {
  fail(`game/src/missions.js declares ${missionIds.size} missions, expected 4`);
}
for (const name of shotNames) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > 262144) fail(`screenshot ${name} is ${size} bytes, over the 256 KiB limit`);
}

let gameEntries = 0;
let gameBytes = 0;
function walkGame(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    gameEntries += 1;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkGame(path);
    else if (entry.isFile()) gameBytes += statSync(path).size;
  }
}
walkGame(join(here, 'game'));
if (gameEntries > 993) fail(`game/ holds ${gameEntries} files and directories, over the 993 cap`);
if (gameBytes > 50331648) fail(`game/ totals ${gameBytes} bytes, over the 48 MiB cap`);

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
