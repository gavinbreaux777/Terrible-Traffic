# Code Summary — Terrible-Traffic

Quick reference for the codebase. All files are IIFEs that export onto `window.TT`.
No build step; `index.html` loads scripts as classic `<script>` tags. **Load order matters.**

---

## Load Order (`index.html`)

```
config.js          → TT.defaults(), TT.controlGroups
geometry.js        → TT.geom  (StraightPath, CirclePath, ArcPath)
vehicle.js         → TT.Vehicle
road.js            → TT.Road
intersection.js    → TT.SignalController, TT.YieldController
scenarios.js       → TT.scenarios  (destructures TT.geom at load time — must come after geometry.js)
simulation.js      → TT.Simulation
renderer.js        → TT.Renderer
ui.js              → TT.ui
main.js            → entry point, wires everything together
```

---

## Unit System

All world coordinates and distances are **meters**. Time is **seconds**. Speed is **m/s**.
The simulation never deals in pixels — only the renderer converts via a scale factor.

---

## Data Flow (per frame)

```
main.js: frame()
  └─ sim.step(dt)                  fixed sub-step loop (MAX_SUBSTEP = 0.04 s)
       ├─ signals.update(dt)       write signalRed onto roads
       ├─ controllers.update(dt)   yield gates (roundabout)
       ├─ spawning                 trySpawn() on source roads
       ├─ pass 1: computeAccel()   IDM — reads current state only
       ├─ pass 2: integrate(dt)    moves all vehicles
       └─ transfers                loop wrap, road-to-road hand-offs, sinks
  └─ renderer.render(sim)          pure read — never mutates sim state
```

The two-pass order (compute ALL accels → integrate ALL) is **load-bearing** for
stable physics. Never collapse it into a single loop.

---

## File-by-File Reference

### `config.js`
- `TT.defaults()` — returns the live params object (IDM coefficients, car count, etc.).
  Sliders mutate this object in place; physics reads it every step.
- `TT.controlGroups` — object keyed by DOM container id; each value is an array of
  slider definitions. `ui.js` generates all sliders from this; scenarios opt in via `caps`.

Key params: `desiredSpeed`, `timeHeadway`, `minGap`, `maxAccel`, `comfortDecel`,
`vehicleLength`, `carCount`, `spawnRate`, `timeScale`, `gapAccept`.

---

### `geometry.js` — `TT.geom`

Path objects: `{ length, pointAt(s) → { x, y, angle } }`.
`angle` is the tangent heading in radians.

| Constructor | Shape |
|-------------|-------|
| `StraightPath(x1,y1,x2,y2)` | Straight line |
| `CirclePath(cx,cy,r,startRad)` | Full CCW circle |
| `ArcPath(cx,cy,r,startRad,sweepRad)` | Partial arc; sign of sweep sets direction |

Any object satisfying `{ length, pointAt(s) }` works as a road path — no renderer changes needed.

---

### `vehicle.js` — `TT.Vehicle`

```js
new TT.Vehicle(s, v)
// s = arc-length position on its road (meters from road start)
// v = speed (m/s)
// brakeTimer — counts down; while > 0 the car brakes hard (disturbance tool)
```

- `computeAccel(gap, leadSpeed, params)` — **IDM** formula; stores result in `this.a`.
  `gap` = clear distance to the car ahead (bumper-to-bumper).
  `gap === Infinity` = open road.
- `integrate(dt)` — Euler step: `v += a*dt`, `s += v*dt`, clamp `v ≥ 0`.

Phantom traffic jams emerge from IDM with no special-casing.

---

### `road.js` — `TT.Road`

One-way lane: a path + sorted vehicle list.

```js
new TT.Road(path, opts)
// opts.name     string
// opts.loop     bool — if true, front car follows rear car across the seam
// opts.stopLine number — arc-length where a red light acts as an obstacle
```

Key properties:
- `road.vehicles` — array sorted ascending by `s`
- `road.outgoing` — array of Road; cars that reach `road.length` transfer onto one
- `road.signalRed` — written by signal controllers; `leaderInfo` treats it as an obstacle
- `road.stopLine` — defaults to `road.length`

`leaderInfo(i, carLen)` returns `{ gap, leadSpeed }` for vehicle at index `i`.
For the frontmost car on an open road: returns red-signal obstacle or `Infinity`.

---

### `intersection.js`

**`TT.SignalController(phases, opts)`**

Fixed-time phases. Each phase: `{ green: [Road, ...], duration }`.
Inserts an all-red clearance (`opts.clearance`, default 1.5 s) between phases.
Writes `road.signalRed` every tick. `allRoads` is the union of all roads in all phases.

**`TT.YieldController(merges, opts)`**

Dynamic yield (used by roundabout). Each merge: `{ entry: Road, watchers: [{ road, point }] }`.
Holds `entry.signalRed = true` while any circulating car is inside the conflict zone or
will reach `point` within `acceptGap` seconds (default 2.6 s).

---

### `scenarios.js` — `TT.scenarios`

Registry: `TT.scenarios[name] = { label, caps, disturb, build() }`.

`build()` returns a **world object**:
```js
{
  kind:        string,
  bounds:      { w, h },       // meters — renderer fits to canvas
  roads:       [Road, ...],
  signals:     [SignalController, ...],
  controllers: [YieldController, ...],  // optional
  sources:     [Road, ...],    // roads where cars spawn; enables throughput stats
  island:      { x, y, r },   // optional filled centre (roundabout)
  populate(sim) {}             // called once on build; seeds initial vehicles
}
```

**`caps` tags:**
- `'fixedCount'` — "Cars" slider shown; changing it triggers `sim.reset()`
- `'spawns'`     — "Spawn rate" slider shown
- `'yield'`      — "Gap accept" slider shown

Built-in scenarios: `ring`, `intersection`, `roundabout`.

**`ring`**: `CirclePath` loop, fixed car count, conserves vehicles.
**`intersection`**: 4 in-roads + 4 out-roads, `StraightPath`, `SignalController` (N/S then E/W).
**`roundabout`**: 4 `ArcPath` ring segments + 4 entry + 4 exit `StraightPath`s, `YieldController`.

Adding a new scenario = one `register(...)` call; no other files need editing.

---

### `simulation.js` — `TT.Simulation`

```js
new TT.Simulation(params)
sim.build(name)    // switch to a scenario by name
sim.reset()        // rebuild current scenario
sim.step(dt)       // advance physics by dt seconds
sim.disturb()      // tap the brakes on a random moving car
sim.stats()        // → { cars, avgSpeed, stopped, time, throughput, hasThroughput }
```

**`pickOutgoing(road, carLen)`** — picks a random `road.outgoing` entry that passes `hasRoom()`.
**`hasRoom(road, carLen)`** — true if the rearmost car is more than `carLen + minGap` from s=0.
**`trySpawn(road, carLen)`** — spawns at s=0 with 60% of desired speed if there's room.

Transfer logic (step 5): vehicles past `road.length` are moved to a picked outgoing road,
or counted as `exited` if outgoing is empty (sink), or held at the stop line if outgoing
exists but is full.

---

### `renderer.js` — `TT.Renderer`

Pure view. Called every frame via `renderer.render(sim)`.

- `layout(bounds)` — fits world bounds to canvas with 8% padding; handles HiDPI.
  Returns `{ scale, ox, oy }` where `X(x) = ox + x*scale`, `Y(y) = oy + y*scale`.
- `strokePath(path, X, Y)` — samples `pointAt` at ~2 m intervals; works for any path type.
- Cars colored by speed: `hsl(ratio*120, 75%, 55%)` — red (stopped) → green (desired speed).
  `brakeTimer > 0` overrides to bright red.

Constants: `LANE_W = 3.4 m` (visual road width), `CAR_W = 1.9 m`.

---

### `ui.js` — `TT.ui`

- `buildControls(params, onChange, scenarioDef)` — generates sliders from `TT.controlGroups`,
  filtered by `scenarioDef.caps`. Sliders mutate `params` in place.
- `renderStats(el, s)` — writes stats table into a DOM element.

---

### `main.js`

Entry point. On `DOMContentLoaded`:
1. Creates `params`, `sim`, `renderer`.
2. Populates scenario `<select>` from `TT.scenarios` registry.
3. Wires Play/Pause, Reset, Disturb, scenario change.
4. Runs `requestAnimationFrame` loop with fixed sub-stepping.
5. Updates stats every 0.2 s of real time.

`MAX_SUBSTEP = 0.04 s` — IDM integration stays stable at this granularity.
`MAX_FRAME = 0.1 s` — clamps real-world dt after tab switch or lag spike.

---

## Key Invariants

1. **Two-pass step**: compute all accels first, then integrate all — do not merge.
2. **Sorted vehicle list**: `road.sort()` runs before `leaderInfo` each step.
3. **SI units throughout**: meters and seconds everywhere in simulation code.
4. **Load order**: `geometry.js` before `scenarios.js` (destructures `TT.geom` at load time).
5. **Pure renderer**: `renderer.js` and `ui.js` never write to `sim` or `params`.
6. **Outgoing wiring**: road-to-road routing is entirely via `road.outgoing` arrays;
   the simulation never hardcodes topology.
7. **Ring vs open**: loop roads wrap `s`; open roads transfer or sink at `road.length`.
