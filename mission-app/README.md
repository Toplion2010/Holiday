# HolySquare

Mars EVA game on real HiRISE terrain of the Gale crater boxwork area, Mount Sharp. The 3D scene, HUD, sky and time model are the Martian Map walk mode (copied from `nasa-hackathon-main/frontend/src/features/{walk,sky,hud}` and `src/shared/{eva,time}`); resources, science scoring and faults are the ARES Expedition engine (`src/expedition/`); the astronaut is `mars-exploration-3d/mars_astronaut_animated.glb`.

## Screens

| Route | Screen |
|---|---|
| `#/` | HolySquare boot checks, any key → home |
| `#/home` | Home: **Start simulation** (S or 1 → `#/game`) and **Mission control** (M or 2 → `#/control`) |
| `#/control` | Mission Control: base, crew, site, conditions, today's expeditions (from `src/data/base.json`) |
| `#/mission` → `#/console` | EVA setup and planning console |
| `#/credits` | Data sources |
| `#/game` | HAB-1 base screen (3D astronaut and rover, loadout, stops in order) → Mars EVA game (below) |
| `#/planner` | HolySquare expedition planner |

HolySquare screens and the game use different global stylesheets with the same CSS variable names, so `src/main.tsx` loads one group per page and reloads when you move between groups.

### Editing Mission Control data

Everything on `#/control` except stop names, objectives and distances comes from `src/data/base.json`: `base`, `crew` (one entry per crew member), `site`, `conditions` (placeholders, shown as "REMS-based estimate") and `expeditions` (`id` must match a waypoint in `src/lib/site.ts`, for example `SO-1`; `risk` is `Low`, `Med` or `High`). The dev server reloads on save.

## Play

```
npm install
npm run dev
```

Home → Start simulation → HAB-1 base screen: set the loadout, add stops and put them in order (A → B → C), choose the work at each, and check the expedition value against O₂, suit power and time. Exit the airlock, then click the scene to capture the mouse.

| Key | Action |
|---|---|
| W A S D / arrows | walk (in the rover: W/S drive, A/D turn) |
| Mouse | look |
| E | work at a science station / enter the habitat to end the EVA |
| R | patch a suit leak (5 min) |
| B | autopilot home on / off |
| V | third-person / helmet view |
| 1 2 3 | time ×1 ×10 ×60 |
| H | HUD full / minimal |
| Esc | release mouse; Esc again returns to the title screen |

In the EVA:

- **Health:** heart rate (follows effort and uphill grade), suit temperature (heaters need suit power, more at night), O₂ and suit battery; rover battery and wheels.
- **Hazards:** radiation dose (background from `src/data/base.json`, ×30 in a solar particle event), wind and dust, sun elevation and daylight left.
- **Autopilot home:** retraces the path you walked (every point was already crossed safely). It switches on by itself when O₂ reaches the reserve needed to get home, and for a medical emergency (heart rate above 175 bpm for 2 min, or a random collapse), when the crew member cannot move and the EVA ends after evacuation.
- **Voice, "Hey Holiday":** click the mic button (Chrome or Edge), then say "Hey Holiday, status / next stop / health / hazards / start science / repair / go home / cancel autopilot". Replies are spoken. The text box takes the same commands.

Goal: reach the orange beacons (five Curiosity stations), do the science, and get back to the blue habitat beacon before oxygen, suit power or the EVA time limit run out. Random events: dust storm (sky optical depth rises), suit leak (oxygen use doubles), comms blackout, rover battery fault. "Go to point" and minimap jumps are charged as walking that distance at 0.7 m/s.

The original planner console is at `#/planner`.

### What changed in the copied Martian Map code

- `features/walk/walkScene.ts`: optional `hooks` (`beforeRender` / `afterRender`) and `setInputEnabled()`; rover heading also drives the compass/minimap independently of mouse look.
- `features/walk/WalkPanel.tsx`: optional `game` prop that passes the hooks to the scene and draws game panels over it.
- Config: `@` → `src` alias in `vite.config.ts` / `tsconfig.app.json`; `erasableSyntaxOnly` off (the copied code uses parameter properties).
- Site packages copied to `public/data/local/` (Gale is the game site; Ares 3 and Jezero are there for the copied tests only and are not listed in `index.json`).

## Deploy (seymur.top/holiday)

The game is the Vercel project `seymur-holiday`, with files under `/holiday/`; seymur.top (project `seymur-top`, repo `Toplion2010/seymur-top`) forwards `/holiday/*` to it with a rewrite in its `vercel.json`.

```
MSYS_NO_PATHCONV=1 VITE_BASE=/holiday/ npm run build   # MSYS_NO_PATHCONV only in Git Bash
mkdir -p ../deploy/holiday && cp -r dist/. ../deploy/holiday/
rm -rf ../deploy/holiday/data/local/ares3 ../deploy/holiday/data/local/jezero   # test-only data
cd ../deploy && vercel deploy --prod --project seymur-holiday
```

Keep the `vercel.json` with the `/` → `/holiday/` redirect in the deploy folder.

## HolySquare planner


Local Mars expedition prototype, adapted from ARES//NAV and Martian Map with user-cleared reuse. Original applications remain in sibling folders.

## Run

With Node 24 and pnpm installed:

```
pnpm install
pnpm dev --host 127.0.0.1
```

This workspace also has a bundled runtime. Use:

```
export PATH="/Users/mustafa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
/Users/mustafa/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm dev --host 127.0.0.1
```

`pnpm test` runs 38 existing and new tests. `pnpm build` produces a static build with offline manifest. `pnpm preview --host 127.0.0.1` serves it. Prepare offline assets from Sources in the production preview; development mode intentionally does not cache Vite modules.

## Workflow

Prepare equipment/base → Science (select required and optional activities; explicitly approve any suggested stand-off) → Plans → Calculate → approve a feasible alternative → Start. Map and astronaut view share position, time and resources. Events pause affected plans. Recalculate or request a return and approve the change. Results exports an action log and deterministic replay data.

## Configuration and implementation

- `src/expedition/model.ts`: hypothetical equipment, scoring and consumption assumptions.
- `src/expedition/types.ts`: mission/data contracts.
- `src/expedition/engine.ts`, `actions.ts`: simulation, fault transitions, recorded actions and replay.
- `src/expedition/planning.ts`: route alternatives, bounded station order search, resource feasibility and walking-return analysis.
- `src/route/`: adapted ARES grid search; diagonal clearance and invalid numerical terrain checks added.
- `src/expedition/mars24.ts`, `geo.ts`: reused Martian Map solar time and terrain frame utilities.
- `public/data/gale/gale-data-manifest.json`: observation provenance and limitations.
- `public/data/gale/validity-verification.json`: original DEM missing-data verification and derivative comparison.
- `notices/`: original licenses and provenance records.

## Data

USGS Gale numerical DEM and optical mosaic overlap the local 3 km footprint. THEMIS night infrared is a third independent data type, used as brightness context only. Five curated Curiosity rover stations have official mission evidence. PIA26697 is a real MAHLI photograph with metadata; simulated activities do not generate new real observations.

Original DEM validity was checked from numerical source pixels with a 6 m support halo. All 2,247,001 navigation cells have valid numerical support. Bundled elevation differs from source block averages by less than 0.006 m (quantization). This is not a traversability certification. The 1 m source spacing includes coarser native data; absolute registration is approximately 100 m.

NASA/USGS sources and exact URLs are in the manifest. Code license permissions and competition eligibility are separate; user explicitly confirmed reuse clearance on 14 November 2026.

## Verification and remaining limitations

Production build and 38 automated tests passed. Tests include blocked corners, missing terrain, separate reserves, activity/return consumption, pause/playback invariance, no repeated science, shorter work, directional costs, rover failure, stale-plan rejection and replay.

This remains a research prototype. Return geometry is refreshed periodically (60 simulated seconds) and after faults; HUD labels the last evaluation age. Terrain shadows and solar charging are not modeled. Native terrain source resolution varies. No live local weather or spatial radiation map is claimed. Surface station registration is uncertain. Speech depends on browser support and may require network service; text commands remain local. Camera gesture recognition requires explicit user permission and hardware testing. Offline caching is implemented but a fully disconnected browser walkthrough remains to be performed. Replay reconstructs recorded plans/actions; it does not independently regenerate plans against changed datasets.

Browser walkthrough verified: calculate alternatives → approve fastest → assisted traversal at 300× → complete activity → return to base. Final elapsed time 33:03; oxygen 1.425 kg and suit energy 1512 Wh remained. Full offline, rover emergency, camera/microphone and cross-device browser walkthroughs still require verification before this is a completed submission.

## HolySquare branding and rover correction

The runnable implementation is `mission-app`. The sibling `mars-exploration-3d` contains Blender/GLB assets and generation scripts, not driving input logic. The active rover uses `public/models/perseverance.glb`, not that sibling's animated rover.

The bundled Perseverance model faces +Z: its front hazcams are at positive Z and rear hazcams/RTG at negative Z. The former +90° visual rotation made its nose face +X while the vehicle drove along −Z. `roverRig.ts` now rotates the visual child by 180° before sizing/grounding; the chassis, terrain pitch/roll and mast retain their existing −Z convention. No movement or camera offset compensations are applied.

W/S and up/down drive forward/reverse along chassis yaw; A/D and left/right turn in place. Turning carries the camera with the chassis while preserving independent mouse look. Compass, minimap arrow and exported rover heading follow the chassis. Walking still follows the camera. Autopilot uses actual chassis yaw instead of estimating heading from the last displacement, so it can turn while stopped and after reversing.

Branding changed in boot/home/control/console/design screens, planner header/loading/export, base link, EVA export, browser title and package metadata. Original ARES source credits, licenses, mission callsigns and internal storage/debug identifiers remain intact.

Validation: production build passed; 160 tests passed, including GLB axis evidence, production drive/reverse/turn and camera-offset checks at five headings, and autopilot return from four starting headings without teleporting. Browser checks confirmed HolySquare boot/home/title, rover forward/reverse at 204° and 255°, left turn to 152°, and autopilot return from 10 m to the habitat arrival radius. The model nose now follows its longitudinal travel direction. The embedded browser did not acquire pointer lock, so physical mouse-look interaction remains unverified (camera-offset preservation is covered by tests). Full lint still reports two pre-existing rules-of-hooks errors in unchanged bundled MediaPipe JS; source-only lint has warnings but no errors. Build retains existing chunk-size and mixed-import warnings.
