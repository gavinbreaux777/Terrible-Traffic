# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Terrible-Traffic** is a browser-based traffic simulator/game. No build step, no
dependencies — open `index.html` directly in a browser (double-click works; it
runs from `file://`). Plain JS + Canvas 2D.

## Running

Just open `index.html`. There is no build, lint, or test tooling. Scripts are
loaded as classic `<script>` tags (not ES modules) specifically so the page
works without a local server.

## Reference Docs

- **`CODE-SUMMARY.md`** — read this first when you need to understand code structure,
  file responsibilities, key data shapes, or invariants. Covers every file with
  constructors, properties, and method signatures.

## Architecture

Every file is an IIFE that hangs its exports off the global `window.TT`
namespace. **Load order in `index.html` matters** — a file may reference another
module's exports at call time, and `scenarios.js` destructures `TT.geom` at load
time, so `geometry.js` must precede it.

The model is unit-consistent SI (meters, seconds, m/s). The simulation knows
nothing about pixels; the renderer scales world bounds to the canvas each frame.

Data flow per frame (`js/main.js`): fixed sub-step loop → `Simulation.step(dt)`
→ `Renderer.render(sim)`.

- **`config.js`** — `TT.defaults()` returns the live params object (IDM
  coefficients, car count, etc.). `TT.controlGroups` declares the sliders; the
  UI is generated from it. Sliders mutate the same params object the physics
  reads, so changes apply live.
- **`geometry.js`** — `Path` primitives (`StraightPath`, `CirclePath`,
  `ArcPath`). A path maps arc-length `s` → `{x, y, angle}`. Add a road shape by
  implementing the same `{ length, pointAt(s) }` interface; the renderer draws
  any path by sampling `pointAt`, so new shapes need no renderer changes.
- **`vehicle.js`** — `Vehicle` holds only `s` (position) and `v` (speed). The
  **Intelligent Driver Model (IDM)** lives in `computeAccel()`; phantom jams
  emerge from it with no special-casing. `brakeTimer` drives the "tap the
  brakes" disturbance tool.
- **`road.js`** — a one-way lane: a path + vehicles kept sorted by `s`.
  `leaderInfo(i)` reports the gap/lead-speed for the car ahead (or the loop
  seam, or a red signal as an obstacle at the stop line).
- **`intersection.js`** — `SignalController` cycles fixed-time phases and writes
  `signalRed` onto the roads it manages.
- **`scenarios.js`** — a registry (`register(name, def)`) of scenarios. Each
  `def` is `{ label, caps, disturb, build() }`; `build()` returns a world
  (`{kind, bounds, roads, signals, sources, island?, populate}`). Adding a
  scenario is one `register(...)` call — the dropdown, sliders, the disturb
  button, and throughput stats are all driven by the metadata, so no other file
  needs editing. `caps` opt a scenario into capability-tagged sliders
  (`fixedCount` → Cars, `spawns` → Spawn rate); a world with `sources` gets
  throughput stats, with `signals` gets signal dots, with `island` gets a filled
  centre. Built-ins: `ring`, `intersection`, `roundabout`.
- **`simulation.js`** — owns params + world. `step()` is a deliberate two-pass
  update (compute **all** accelerations, then integrate **all**) so vehicle
  ordering never biases the physics; then resolves loop wrap, road-to-road
  transfers, spawning and sinks.
- **`renderer.js`** / **`ui.js`** — pure view layers; never mutate sim state.
  Cars are colored by speed (red = stopped → green = desired speed).

## Conventions

- All scenarios share the same car physics; they differ only in road topology
  and whether routing/signals are needed. Keep new behavior in the right layer:
  topology in `scenarios.js`, control logic in `intersection.js`, car behavior
  in `vehicle.js`.
- Road-to-road transfers reuse the open-road model: a car past a road's end
  picks a random `outgoing` road that has room (`pickOutgoing`/`hasRoom`). The
  roundabout builds on this — the ring is four `ArcPath` segments, and entering
  cars yield because the ring segments are listed first in `world.roads` (so
  circulating cars claim space before `hasRoom` is checked for entries).
- The two-pass step order in `simulation.js` is load-bearing for stable physics
  — don't collapse it into a single compute+integrate pass.

## How Claude Code Should Work

- Before writing any code, present the plan for what you are about to write.
- If you are unsure about anything, do not make assumptions, find the information or ask
