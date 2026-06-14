# Plan: 4-Way Stop Scenario

## Overview

Add a `fourwayStop` scenario to `js/scenarios.js` that models an all-way stop
intersection. Each of the four approach roads has a stop line. Vehicles must
stop completely before entering the box, then proceed in first-come-first-served
order, one at a time. No traffic signals — departure clearance is enforced by a
new `StopController` added to `js/intersection.js`.

**Files to edit:**
1. `js/intersection.js` — add `TT.StopController`
2. `js/scenarios.js` — register `'fourwayStop'`

No other files need changing. The dropdown, stats panel, and signal dots will all
update automatically from the metadata.

---

## 1. The Control Problem

A 4-way stop has no fixed phases. The rule is:

> The first car to reach a complete stop at the line earns the right-of-way. If
> two cars stop simultaneously, the car to the right yields.

For simulation purposes, a simplified but realistic policy works well:

- The intersection box is owned by **at most one car at a time**.
- A car may enter only when: (a) it has stopped (`v < stopThreshold`), AND (b)
  no other car currently holds the lock.
- The car that "wins" the lock holds it for a configurable clearance window
  (`clearance`, default **3 s** — long enough for the car to cross the ~14 m
  box at a normal crawl-through speed).
- Ties (multiple stopped cars at the same moment) are broken by a simple
  priority queue ordered by arrival-at-stop time.

This avoids the complexity of per-car "simultaneous stop" detection while
producing realistic queuing behavior.

---

## 2. `StopController` — add to `js/intersection.js`

Place this class immediately after `YieldController`, before the closing
`})(window.TT)`.

```js
/*
 * All-way stop controller. Manages a single-occupancy lock on the intersection
 * box. Each managed road must stop before the lock is granted; the lock is held
 * for `clearance` seconds so the box clears before the next car enters.
 *
 * Each tick:
 *   - Tick down the lock timer (if held).
 *   - When the lock expires, release it and immediately re-evaluate.
 *   - For each road, check if the front vehicle has stopped (v < stopThreshold).
 *   - If stopped and no lock is held, grant the lock to the road that has been
 *     waiting longest (lowest arrivalTime). Reset all other roads' arrivalTime.
 *   - Write signalRed onto each road: red = lock not held by this road.
 */
class StopController {
  constructor(roads, opts) {
    opts = opts || {};
    this.roads = roads;                     // all four approach roads
    this.clearance = opts.clearance != null ? opts.clearance : 3.0;  // s
    this.stopThreshold = opts.stopThreshold != null ? opts.stopThreshold : 0.3; // m/s
    this._lockRoad = null;   // road currently holding the lock
    this._lockTimer = 0;     // seconds remaining on the lock
    this._arrival = new Map(); // road → sim-time when it first reached a full stop
    // All roads start red.
    for (const r of this.roads) r.signalRed = true;
  }

  update(dt, params, simTime) {
    // Tick the lock down.
    if (this._lockRoad !== null) {
      this._lockTimer -= dt;
      if (this._lockTimer <= 0) {
        this._lockRoad = null;
        this._lockTimer = 0;
      }
    }

    // Update arrival timestamps for newly stopped front cars.
    for (const r of this.roads) {
      const front = r.vehicles.length ? r.vehicles[r.vehicles.length - 1] : null;
      const stopped = front && front.v < this.stopThreshold;
      if (stopped && !this._arrival.has(r)) {
        this._arrival.set(r, simTime);
      } else if (!stopped && this._arrival.has(r)) {
        this._arrival.delete(r);
      }
    }

    // If no lock is held, grant to the longest-waiting stopped road.
    if (this._lockRoad === null && this._arrival.size > 0) {
      let best = null, bestTime = Infinity;
      for (const [r, t] of this._arrival) {
        if (t < bestTime) { bestTime = t; best = r; }
      }
      if (best !== null) {
        this._lockRoad = best;
        this._lockTimer = this.clearance;
        this._arrival.delete(best); // winner leaves the stopped state
      }
    }

    // Write signalRed: red for everyone except the lock holder.
    for (const r of this.roads) {
      r.signalRed = (r !== this._lockRoad);
    }
  }
}

TT.StopController = StopController;
```

### Integration note — `simulation.js`

`simulation.js` already calls:
```js
if (world.controllers) for (const c of world.controllers) c.update(dt, p);
```

`StopController.update` needs a third argument, `simTime`. The call site must
be updated to:
```js
if (world.controllers) for (const c of world.controllers) c.update(dt, p, this.time);
```

This is a **backward-compatible change** — `YieldController.update(dt, params)`
accepts extra arguments silently. Only `StopController` uses the third param.

**Edit:** `js/simulation.js` line ~40:
```js
// Before:
if (world.controllers) for (const c of world.controllers) c.update(dt, p);
// After:
if (world.controllers) for (const c of world.controllers) c.update(dt, p, this.time);
```

---

## 3. `fourwayStop` scenario — add to `js/scenarios.js`

Append this `register(...)` call inside the existing IIFE, before the closing
`})(window.TT)` on the last line.

### Geometry

Same layout as the existing `intersection` scenario (160 × 160 m world,
centre at (80, 80)) but with **no `SignalController`**. Use identical road
construction logic for the four in-roads and four out-roads, so the visual
layout is identical and easy to compare.

- `cx = 80, cy = 80, L = 70, box = 7, lane = 2.2` — same constants as
  `intersection`.
- `stopLine = inRoad.length` on every in-road — cars stop at the box edge.
- Routing: same as `intersection` — from each approach, cars may leave by any
  of the other three exits (random uniform choice).

### Capabilities

```js
caps: ['spawns']
```

`'spawns'` shows the Spawn Rate slider. No `'fixedCount'` (open system).
No `'yield'` (no `gapAccept` param used).

### Signals and controllers

```js
signals: [],                          // no fixed-time signals
controllers: [stopCtl],               // StopController manages the box
```

The `signals: []` means the renderer draws no signal dots. The `controllers`
array plugs into the existing update loop.

### Full register call

```js
register('fourwayStop', {
  label: 'Intersection — 4-way stop',
  caps: ['spawns'],
  disturb: false,
  build() {
    const cx = 80, cy = 80, L = 70, box = 7, lane = 2.2;
    const dirs = [
      { name: 'N', u: [0, -1] },
      { name: 'E', u: [1,  0] },
      { name: 'S', u: [0,  1] },
      { name: 'W', u: [-1, 0] },
    ];

    const inRoad = [], outRoad = [];
    for (const d of dirs) {
      const [ux, uy] = d.u;
      const tin = [-ux, -uy];
      const rin = [tin[1], -tin[0]];
      const inA = [cx + ux * L + rin[0] * lane, cy + uy * L + rin[1] * lane];
      const inB = [cx + ux * box + rin[0] * lane, cy + uy * box + rin[1] * lane];
      const ri = new TT.Road(StraightPath(inA[0], inA[1], inB[0], inB[1]),
                             { name: 'in_' + d.name });
      ri.stopLine = ri.length;
      inRoad.push(ri);

      const tout = [ux, uy];
      const rout = [tout[1], -tout[0]];
      const outA = [cx + ux * box + rout[0] * lane, cy + uy * box + rout[1] * lane];
      const outB = [cx + ux * L + rout[0] * lane, cy + uy * L + rout[1] * lane];
      const ro = new TT.Road(StraightPath(outA[0], outA[1], outB[0], outB[1]),
                             { name: 'out_' + d.name });
      outRoad.push(ro);
    }

    // Any in-road can exit via any other arm (same as signalized intersection).
    for (let d = 0; d < 4; d++) {
      inRoad[d].outgoing = outRoad.filter((_, k) => k !== d);
    }

    const stopCtl = new TT.StopController(inRoad, { clearance: 3.0 });

    return {
      kind: 'fourwayStop',
      bounds: { w: 160, h: 160 },
      roads: [...inRoad, ...outRoad],
      signals: [],
      controllers: [stopCtl],
      sources: inRoad.slice(),
      populate() { /* cars arrive via sources */ },
    };
  },
});
```

---

## 4. Execution Checklist

Work through these steps in order. Each is atomic and verifiable.

- [ ] **Step 1** — Edit `js/simulation.js` (one line change).
  Find the line:
  ```
  if (world.controllers) for (const c of world.controllers) c.update(dt, p);
  ```
  Change it to:
  ```
  if (world.controllers) for (const c of world.controllers) c.update(dt, p, this.time);
  ```

- [ ] **Step 2** — Edit `js/intersection.js`: add `StopController` class.
  Insert the class body (from Section 2 above) between `YieldController`'s
  closing brace and the `TT.YieldController = YieldController;` export lines.
  Also add `TT.StopController = StopController;` alongside the other exports.

- [ ] **Step 3** — Edit `js/scenarios.js`: append the `register('fourwayStop', ...)`
  call (from Section 3 above) before the final `})(window.TT)` line.

- [ ] **Step 4** — Open `index.html` in a browser. Verify:
  - The scenario dropdown now shows "Intersection — 4-way stop".
  - Selecting it shows four approach roads with no signal dots.
  - Cars spawn, queue at the stop line, proceed one at a time through the box.
  - Throughput stats are shown (sources wired up).
  - The Spawn Rate slider is present and has live effect.
  - Switching back to other scenarios still works correctly.

---

## 5. Edge Cases and Notes

- **Starvation**: A flooded approach (very high spawn rate) could hold the lock
  indefinitely if the front car never fully stops. The IDM ensures cars do stop
  before the red stop line (obstacle at `stopLine`), so starvation should not
  occur in practice.

- **Transfer timing**: A car that holds the lock but gets transferred to an
  outgoing road mid-step will disappear from `r.vehicles`, so the next tick
  will naturally see no front car and drop the arrival entry. The lock timer
  continues regardless — this is correct, since the box needs to clear.

- **Lock on rebuild**: `StopController` constructor sets all roads red and
  clears state. `sim.build()` already clears vehicle lists; no extra reset
  needed in the controller.

- **No `index.html` edit needed**: the scenario dropdown is populated from
  `TT.scenarios` at runtime; adding the registration is sufficient.

- **Comparison with signalized intersection**: The 4-way stop will have lower
  throughput at high volumes because only one car crosses at a time (no
  parallel green phases). This should be visible in the throughput stat.
