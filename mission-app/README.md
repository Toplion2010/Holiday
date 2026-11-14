# ARES Expedition

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
