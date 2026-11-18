# Vice Coast

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/Ruiii-newbie/gta6-01-entry/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/Ruiii-newbie/gta6-01-entry/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Built for make.fun's [Make GTA 6 bounty](https://make.fun/bounty/gta6-01) ($1,666 in USDC, top 100 paid), referral code 575ehchc.

An original open-world crime game set in a sun-soaked modern coastal city.
You are **Vic**, a driver trying to make a name for himself. Your fixer,
**Mara Voss**, lines up the jobs — steal the wheels, run the package, hit
the harbor. The Vice Coast police do not take kindly to any of it.

Everything is original: our own city, characters, vehicles, names, story,
art and sounds. No Rockstar / GTA names, characters, maps or assets anywhere.

## How to play

| Key | Action |
| --- | --- |
| W / A / S / D or arrows | Drive / walk |
| Shift | Sprint (on foot) |
| Space | Brake / handbrake |
| E | Enter or exit a car / steal a car / interact |
| F | Punch (on foot) |
| Mouse click | Fire pistol (on foot) |
| C | Cycle camera (follow / hood / top) |
| P or Esc | Pause |
| M | Mute / unmute |

Steal cars, lose the cops (heat cools off when no police car can see you),
and finish all three missions:

1. **First Wheels** — steal the parked ride and bring it to the garage. $300.
2. **Payday Run** — grab the package, get back in the car, lose a 2-star
   wanted level, deliver. $600.
3. **Harbor Heat** — take down three armed guards, grab the crate, deliver.
   $1,200 and the story is yours.

Getting busted on foot or wasted sends you back to the menu — your cash and
mission progress are saved. Health packs heal +40; guards sometimes drop one.

## How to run

```sh
node serve.ts
```

Then open <http://localhost:8080> in desktop Chrome. The game is plain
static files under `game/` — no build step, no network requests at runtime.
Three.js r160 is vendored at `game/vendor/three.min.js`.

Progress saves to `localStorage` (`vice-coast-save-v1`) on mission complete
and when you pause or quit to the title screen; **Continue** on the title
screen picks it back up.

## Screenshots

`screenshots/` holds four renders of the game itself, staged with
`?shot=` (`chase`, `drive`, `mission`, `combat`, all with `seed=1`):
a 3-star beachfront police chase with the PD helicopter overhead
(86 km/h, the cover), a golden-hour drive down the palm-lined beachfront
boulevard, the Harbor Heat mission on foot at the docks, and an on-foot
pistol fight downtown during the Payday Run. Every shot shows the denser
HUD: district name, clock, mission title + distance, a Mara Voss story
line, weapon + ammo, and a large speed readout.

## Structure

- `game/index.html` — page shell, HUD and menu markup
- `game/src/main.js` — renderer, fixed-step loop, input, cameras, menus
- `game/src/state.js` — shared game state `G`
- `game/src/config.js` — tuning constants
- `game/src/random.js` — seeded RNG
- `game/src/world.js` — city, buildings, roads, colliders, spawn points
- `game/src/player.js` — on-foot and driving player
- `game/src/vehicles.js` — cars, traffic, pedestrians
- `game/src/police.js` — wanted level, pursuit AI, busts, heat decay
- `game/src/missions.js` — three-mission story, markers, rewards
- `game/src/combat.js` — punching, pistol, guards, health packs
- `game/src/hud.js` — stars, cash, health, minimap, toasts, banners
- `game/src/audio.js` — synthesized WebAudio (engine, sirens, shots, jingles)
- `game/src/save.js` — localStorage save / load
- `game/src/shots.js` — deterministic `?shot=` staging for screenshots
