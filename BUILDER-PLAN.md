# Road Builder — Implementation Plan

## Overview

A free-form road builder mode that lets users drag roads and place intersections
on a grid, then watch cars navigate the resulting network. Cars spawn at any map
edge where a road exits and are assigned a random different edge exit as their
destination; they pathfind through intersections to reach it.

We will start at phase 1 and implement them each and test before moving on. Each phase will have no context from the previous one

This is a new **mode**, not a new scenario — the builder sits alongside the
existing ring / intersection / roundabout scenarios and produces a custom world
that the same simulation engine drives.

---

## Grid Model

The map is a fixed grid of **nodes** (intersection sites) connected by **edges**
(road slots). Cars and simulation logic never see the grid; it only exists in the
builder layer to constrain snapping and generate a valid world.

```
Grid 8 × 8 nodes (7 × 7 cells)
Cell size: 50 m  ← CELL constant in builder-model.js, trivial to change
World bounds: (8-1) × 50 = 350 m × 350 m
Intersection box radius: 7 m (same as existing 4-way scenario)
Road segment length: 50 - 2 × 7 = 36 m  (between box edges, fits ~5 cars)
```

> Grid dimensions (`CELL`, `COLS`, `ROWS`) are top-of-file constants in
> `builder-model.js`. Changing the grid size is a one-line edit with no
> ripple effects — `toWorld()` derives all geometry from them at build time.

Each **node** carries:
```js
{
  type: null | 'fourway' | 'tee_N' | 'tee_E' | 'tee_S' | 'tee_W' | 'roundabout',
  // type null = no intersection; roads can still pass through the node slot
  // tee_X = the arm facing direction X is closed (e.g. tee_N = no north arm)
  connectors: Set<'N'|'E'|'S'|'W'>  // derived from type, which arms are open
}
```

Each **edge** (between two adjacent nodes, tagged by the node pair and direction)
carries:
```js
{
  hasRoad: bool   // a road segment exists on this edge
}
```

Roads are always **bidirectional pairs** — one Road object in each direction —
because the simulation uses one-way lanes. The builder creates both when the
user draws a segment.

### Border edges

Any edge whose *outer* node lies off the grid (i.e. an edge departing a border
node outward) is a **border edge**. If a road exits through such an edge it
becomes a source (spawn point) and sink (despawn point) for that direction.
There is no node at the outer end — cars simply materialise or vanish there.

---

## Intersection Types

All intersection types fit into the same 7 m box around the grid node centre.
Roads must meet the box edge exactly at the cardinal compass point to connect.

| Type | Open arms | Interior control |
|------|-----------|-----------------|
| `fourway` | N E S W | `SignalController` — two phases (N/S green, E/W green) |
| `tee_N` | E S W (no north) | `SignalController` — two phases |
| `tee_E` | N S W (no east) | `SignalController` — two phases |
| `tee_S` | N E W (no south) | `SignalController` — two phases |
| `tee_W` | N E S (no west) | `SignalController` — two phases |
| `roundabout` | N E S W | `YieldController` — arc segments + yield gates |

A road can only connect to a node arm that the intersection type declares open.
The builder enforces this at draw time: if the user tries to draw a road into a
closed arm, the snap is rejected and the road segment does not form.

---

## Routing

Cars have a **destination**: a specific border edge they are trying to reach.
Destination is assigned at spawn (random border edge ≠ spawn edge). The car
carries:

```js
vehicle.route = [nodeId, nodeId, ...]  // waypoint list through the grid
vehicle.destEdge = edgeKey             // final exit edge
```

### Pathfinding

At world-build time, the builder computes a **navigation graph** from the grid
state: nodes are intersections, directed edges are road pairs. When a car spawns,
BFS (unweighted — all edges cost 1) finds the shortest path from the spawn border
node to the destination border node. The resulting node sequence is stored on the
vehicle as `route`.

At each intersection transfer (`pickOutgoing` in `simulation.js`), the car pops
the next node from its route and picks the outgoing road that leads toward it.
If the route is exhausted or invalid, the car falls back to random selection
(existing behaviour) so the simulation never hard-stalls.

### `router.js`

New file. Exports:
- `buildNavGraph(gridState)` → adjacency structure over grid nodes
- `findRoute(navGraph, fromNode, toNode)` → `[nodeId, ...]` or `null`
- `nextRoad(vehicle, currentRoad, outgoing, nodeMap)` → the Road to take next
  (replaces random selection when `vehicle.route` is set)

---

## Files to Create

### `js/builder-model.js`

Grid state as a plain data object (no DOM). Exports on `TT.builderModel`:

```
init(cols, rows, cellSize)   → fresh grid
placeIntersection(col, row, type)
removeIntersection(col, row)
drawRoad(fromNode, toNode)       // adds edge, validates arm connectivity
eraseRoad(fromNode, toNode)
canConnect(fromNode, dir, toNode) → bool  // open arms + compatible types
borderEdges()                   → list of { node, dir, worldPt }
toWorld()                       → { roads, signals, controllers, sources,
                                    bounds, island?, nodeMap }
                                // the world object Simulation can drive
serialize() / deserialize(json) // save/load the grid
```

`toWorld()` is the bridge to the simulation. It:
1. Creates a pair of `Road` objects (StraightPath) for each edge that has a road.
2. Creates a `SignalController` or `YieldController` for each intersection node.
3. Wires `road.outgoing` arrays so transfers route correctly.
4. Tags each border-exit road as a source (with `_spawnAcc = 0`).
5. Returns the world object including a `nodeMap` (road → node id) the router uses.

### `js/builder-world.js`

Thin layer that calls `builderModel.toWorld()`, registers the result as a
pseudo-scenario, and notifies the simulation to rebuild. Also calls
`router.buildNavGraph()` and attaches it to the world so `simulation.js` can
route vehicles.

### `js/builder-ui.js`

Canvas interaction for builder mode. Exports `TT.builderUI`:

```
attach(canvas, model, onWorldChange)  // hooks mouse events
detach(canvas)
setTool(tool)     // 'road' | 'fourway' | 'tee_N' | ... | 'roundabout' | 'erase'
renderOverlay(ctx, t)  // called by Renderer after roads are drawn
```

**Interaction details:**

- `road` tool: mousedown on a grid node snaps to it; mousemove draws a ghost
  along the nearest valid grid edge; mouseup commits the segment (or cancels if
  not a valid connection).
- Intersection tools: mousedown-release on any node places or replaces the
  intersection type. Incompatible road connections (closed arm) are automatically
  erased.
- `erase` tool: click a road segment or intersection node to remove it (and
  invalidate dangling roads from closed arms).
- All snapping is to the **nearest grid node** whose pixel distance from the
  cursor is within `SNAP_RADIUS` (≈ half a cell width in pixels).
- Ghost preview: translucent road pair drawn from the snapped start node to the
  cursor (clamped to the nearest valid edge direction).

### `js/router.js`

See Routing section above. Does not touch the DOM or Canvas; pure data.

---

## Files to Modify

### `js/vehicle.js`

Add two optional properties:
```js
this.route = null;      // [nodeId, ...] or null
this.destEdge = null;   // string key or null
```
No behaviour change — `computeAccel` and `integrate` ignore them.

### `js/simulation.js`

`pickOutgoing(road, carLen)` — after selecting candidates, check if the vehicle
at the front of `road` has a `route`; if so, delegate to
`TT.router.nextRoad(vehicle, road, candidates, world.nodeMap)` instead of random
selection. Falls back to random if the router returns null.

`trySpawn(road, carLen)` — if `world.isBuilderWorld` is set, assign `route` and
`destEdge` using `TT.router` before adding the vehicle.

### `js/renderer.js`

Add `renderBuilderOverlay(world, builderUI, t)` call at the end of `render()`,
guarded by `world.isBuilderWorld`. The overlay draws:
- Faint grid lines at each cell boundary
- A hollow circle at each grid node that has no intersection
- A filled square / circle / icon at each intersection node (colour by type)
- Highlighted open-arm connectors on hover
- The ghost preview segment from `builderUI`
- A small coloured dot on each car showing its destination direction (optional)

### `js/main.js`

- Add a "Builder" button / tab that shows the builder toolbar and hides the
  scenario dropdown.
- Wire `builderUI.attach(canvas, model, rebuild)` when builder mode is active.
- `rebuild()` calls `builderWorld.applyToSim(sim)` and `refreshPanel()`.
- Wire the tool palette buttons to `builderUI.setTool(...)`.

### `index.html`

- Builder toolbar (hidden by default, shown in builder mode):
  ```
  [ Road ] [ 4-Way ] [ T-North ] [ T-East ] [ T-South ] [ T-West ] [ Roundabout ] [ Erase ]
  ```
- Mode toggle: `[ Scenarios ▾ ]  [ Build ]` — tabs above the canvas.
- No new script dependencies beyond the new files; load order in `<script>` tags:
  ```
  router.js          (no deps)
  builder-model.js   (needs TT.geom, TT.Road, TT.SignalController, TT.YieldController, TT.router)
  builder-world.js   (needs TT.builderModel, TT.Simulation)
  builder-ui.js      (needs TT.builderModel, TT.renderer — just the overlay hook)
  ```
  Insert after `intersection.js` and before `scenarios.js`.

---

## Implementation Phases

### Phase 1 — Grid model + world generation (no UI)

Goal: `builderModel.toWorld()` produces a valid world the Simulation can run.

1. Implement `builder-model.js` with grid CRUD and `toWorld()`.
2. Hard-code a test grid (two nodes, one road edge) and verify cars spawn, move,
   and despawn correctly in the existing simulation loop.
3. Validate that `SignalController` and `YieldController` wire up correctly from
   the generated world.

Completion check: open `index.html`, switch to the generated world via JS
console, see cars moving.

### Phase 2 — Routing

Goal: spawned cars navigate to a destination, not random exit.

1. Implement `router.js` (`buildNavGraph`, `findRoute`, `nextRoad`).
2. Extend `simulation.js` `pickOutgoing` and `trySpawn` for routed worlds.
3. Test with a simple grid that has two border exits and a forced path between
   them.

Completion check: cars consistently exit at their assigned destination and do
not U-turn or loop.

### Phase 3 — Builder UI (canvas interaction)

Goal: user can draw roads and place intersections with the mouse.

1. Implement `builder-ui.js`: grid snapping, road tool (drag to draw), erase
   tool.
2. Hook into `main.js` and `index.html`: mode toggle, tool palette.
3. Implement renderer overlay (grid lines, node icons, ghost preview).

Completion check: user can build a simple grid network by clicking and dragging,
then watch cars navigate it.

### Phase 4 — Intersection placement tools

Goal: all intersection types are placeable and connect correctly.

1. Add intersection tool handling to `builder-ui.js`.
2. Enforce arm validation (`canConnect`): erase incompatible road stubs when a
   different intersection type is placed.
3. Render intersection icons clearly enough to distinguish type at a glance.

Completion check: user can mix 4-way, T-intersections, and roundabouts in one
network; signals and yield gates operate correctly.

### Phase 5 — Polish

- Save/load the grid to `localStorage` so the layout survives page refresh.
- Keyboard shortcuts: `R` = road, `4` = 4-way, `T` = T (cycle), `O` = roundabout,
  `E` = erase, `Escape` = cancel current drag.
- Destination visualisation: tiny coloured arrow on each car pointing toward its
  exit arm direction.
- Edge-case handling: disconnected islands, dead-end roads (no border exit reachable),
  cars stuck waiting for blocked outgoing.

---

## Constraints & Guard Rails

- The simulation physics and two-pass step order are **not modified**. All new
  behaviour is at the world-generation and routing layers.
- `builder-model.js` must produce worlds whose roads, signals, and controllers
  are structurally identical to what `scenarios.js` produces — the simulation
  must not know the difference.
- Grid coordinates are always in meters matching the existing SI unit convention.
- Script loading order in `index.html` must be respected: `router.js` before
  `builder-model.js`, geometry and intersection before both.
- The builder is a progressive enhancement — the existing ring/intersection/
  roundabout scenarios continue to work unchanged.
