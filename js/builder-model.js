/*
 * Grid model for the road builder. Stores nodes (intersection sites) and edges
 * (road slots) on a fixed grid, then converts the current state into a world
 * object that Simulation can drive — structurally identical to what scenarios.js
 * produces.
 *
 * Grid coordinates are integers (col, row). World coordinates are meters:
 *   world_x = col * CELL,  world_y = row * CELL
 *
 * Each active edge creates two Road objects (one per direction). Typed nodes
 * (fourway, tee_*) get a SignalController. Roundabout support is deferred to
 * Phase 4.
 *
 * A road is a source (spawns cars) when nothing feeds into its start node from
 * the direction it came from and the start node is not an intersection.
 */
(function (TT) {
  'use strict';

  const CELL = 50;         // meters per grid cell
  const BOX_R = 7;         // intersection box half-width (metres) — matches 4-way scenario
  const LO = 1.7;          // lane offset: half of visual LANE_W (3.4 m)

  const DEFAULT_COLS = 8;
  const DEFAULT_ROWS = 8;

  const DIR = {
    N: { dc: 0, dr: -1 },
    E: { dc: 1, dr:  0 },
    S: { dc: 0, dr:  1 },
    W: { dc: -1, dr: 0 },
  };
  const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const ALL_DIRS = ['N', 'E', 'S', 'W'];

  // Arms that are open for each intersection type
  const TYPE_ARMS = {
    fourway:    ['N', 'E', 'S', 'W'],
    tee_N:      ['E', 'S', 'W'],   // north arm closed
    tee_E:      ['N', 'S', 'W'],   // east arm closed
    tee_S:      ['N', 'E', 'W'],   // south arm closed
    tee_W:      ['N', 'E', 'S'],   // west arm closed
    roundabout: ['N', 'E', 'S', 'W'],
    entry:      ['N', 'E', 'S', 'W'],
    exit:       ['N', 'E', 'S', 'W'],
    entryexit:  ['N', 'E', 'S', 'W'],
  };

  const PORTAL_TYPES = new Set(['entry', 'exit', 'entryexit']);
  function isPortal(t) { return PORTAL_TYPES.has(t); }

  function nodeKey(c, r) { return c + ',' + r; }

  // Canonical edge key so (c1,r1)-(c2,r2) and (c2,r2)-(c1,r1) hash the same.
  // Smaller col first; tie-break by smaller row.
  function edgeKey(c1, r1, c2, r2) {
    if (c1 > c2 || (c1 === c2 && r1 > r2)) return c2 + ',' + r2 + '-' + c1 + ',' + r1;
    return c1 + ',' + r1 + '-' + c2 + ',' + r2;
  }

  // Direction label from (c1,r1) to adjacent (c2,r2); null if not adjacent.
  function dirOf(c1, r1, c2, r2) {
    const dc = c2 - c1, dr = r2 - r1;
    for (const d of ALL_DIRS) {
      if (DIR[d].dc === dc && DIR[d].dr === dr) return d;
    }
    return null;
  }

  // Right-hand-side perpendicular offset for a road travelling in (tx, ty).
  // Matches the lane-offset convention used in scenarios.js: [ty, -tx] * LO.
  function laneOff(tx, ty) {
    return { px: ty * LO, py: -tx * LO };
  }

  // -------------------------------------------------------------------------

  const model = {
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cellSize: CELL,
    nodes: {},   // nodeKey → { type: string|null, connectors: Set<dir> }
    edges: {},   // edgeKey → { hasRoad: bool }

    init(cols, rows, cellSize) {
      this.cols    = cols     != null ? cols     : DEFAULT_COLS;
      this.rows    = rows     != null ? rows     : DEFAULT_ROWS;
      this.cellSize = cellSize != null ? cellSize : CELL;
      this.nodes = {};
      this.edges = {};
      return this;
    },

    // Place or replace an intersection node. Erases any roads on closed arms.
    placeIntersection(col, row, type) {
      const arms = TYPE_ARMS[type] || [];
      this.nodes[nodeKey(col, row)] = { type, connectors: new Set(arms) };
      for (const dir of ALL_DIRS) {
        if (!arms.includes(dir)) {
          const d = DIR[dir];
          const ek = edgeKey(col, row, col + d.dc, row + d.dr);
          if (this.edges[ek]) this.edges[ek].hasRoad = false;
        }
      }
    },

    removeIntersection(col, row) {
      delete this.nodes[nodeKey(col, row)];
    },

    // Add a road between two adjacent grid nodes. Returns false if invalid.
    drawRoad(n1, n2) {
      const dir = dirOf(n1.col, n1.row, n2.col, n2.row);
      if (!dir || !this.canConnect(n1, dir, n2)) return false;
      this.edges[edgeKey(n1.col, n1.row, n2.col, n2.row)] = { hasRoad: true };
      return true;
    },

    eraseRoad(n1, n2) {
      const ek = edgeKey(n1.col, n1.row, n2.col, n2.row);
      if (this.edges[ek]) this.edges[ek].hasRoad = false;
    },

    // Can a road connect these two nodes in the given direction?
    canConnect(n1, dir, n2) {
      const d = DIR[dir];
      if (!d) return false;
      if (n2.col !== n1.col + d.dc || n2.row !== n1.row + d.dr) return false;
      const k1 = nodeKey(n1.col, n1.row);
      const k2 = nodeKey(n2.col, n2.row);
      if (this.nodes[k1] && !this.nodes[k1].connectors.has(dir)) return false;
      if (this.nodes[k2] && !this.nodes[k2].connectors.has(OPP[dir])) return false;
      return true;
    },

    // Returns all virtual border exits: { col, row, dir, worldPt } for each
    // boundary node that has a road leading inward.
    borderEdges() {
      const result = [];
      const cs = this.cellSize;
      for (const ek in this.edges) {
        if (!this.edges[ek].hasRoad) continue;
        const parts = ek.split('-');
        const [c1, r1] = parts[0].split(',').map(Number);
        const [c2, r2] = parts[1].split(',').map(Number);
        const pairs = [[c1, r1, c2, r2], [c2, r2, c1, r1]];
        for (const [ac, ar, bc, br] of pairs) {
          const dir = dirOf(ac, ar, bc, br);
          const oppDir = OPP[dir];
          const od = DIR[oppDir];
          const pc = ac + od.dc, pr = ar + od.dr;
          const onGrid = pc >= 0 && pc < this.cols && pr >= 0 && pr < this.rows;
          if (!onGrid) {
            result.push({ col: ac, row: ar, dir: oppDir, worldPt: { x: ac * cs, y: ar * cs } });
          }
        }
      }
      return result;
    },

    // ------------------------------------------------------------------
    // Convert the current grid state to a world object for Simulation.
    // ------------------------------------------------------------------
    toWorld() {
      const { StraightPath } = TT.geom;
      const cs = this.cellSize;
      const cols = this.cols, rows = this.rows;

      const allRoads = [];
      const signals  = [];
      const sources  = [];

      // edgeKey → { ab, ba, dir, c1, r1, c2, r2 }
      const roadMap = {};

      // --- Step 1: Road pairs for each active edge ---

      for (const ek in this.edges) {
        if (!this.edges[ek].hasRoad) continue;

        const parts = ek.split('-');
        const [c1, r1] = parts[0].split(',').map(Number);
        const [c2, r2] = parts[1].split(',').map(Number);
        const dir = dirOf(c1, r1, c2, r2);
        if (!dir) continue;

        const d = DIR[dir];
        const tx = d.dc, ty = d.dr;        // unit travel vector
        const off = laneOff(tx, ty);        // perpendicular offset for the +lane

        // Clip the road ends by the intersection box at each node.
        const nkA = nodeKey(c1, r1);
        const nkB = nodeKey(c2, r2);
        const typeA = this.nodes[nkA] && this.nodes[nkA].type;
        const typeB = this.nodes[nkB] && this.nodes[nkB].type;
        const boxA = (typeA && !isPortal(typeA)) ? BOX_R : 0;
        const boxB = (typeB && !isPortal(typeB)) ? BOX_R : 0;

        const ax = c1 * cs, ay = r1 * cs;
        const bx = c2 * cs, by = r2 * cs;

        // AB road: travels in (tx, ty), right-hand lane offset = +off
        const abX1 = ax + tx * boxA + off.px,  abY1 = ay + ty * boxA + off.py;
        const abX2 = bx - tx * boxB + off.px,  abY2 = by - ty * boxB + off.py;
        const roadAB = new TT.Road(StraightPath(abX1, abY1, abX2, abY2), { name: ek + '_fwd' });
        roadAB._nkFrom = nkA;
        roadAB._nkTo   = nkB;
        roadAB._travelDir = dir;

        // BA road: travels in (-tx, -ty), right-hand lane offset = -off
        const baX1 = bx - tx * boxB - off.px,  baY1 = by - ty * boxB - off.py;
        const baX2 = ax + tx * boxA - off.px,  baY2 = ay + ty * boxA - off.py;
        const roadBA = new TT.Road(StraightPath(baX1, baY1, baX2, baY2), { name: ek + '_rev' });
        roadBA._nkFrom = nkB;
        roadBA._nkTo   = nkA;
        roadBA._travelDir = OPP[dir];

        roadMap[ek] = { ab: roadAB, ba: roadBA, dir, c1, r1, c2, r2 };
        allRoads.push(roadAB, roadBA);
      }

      // --- Step 2: Source/sink detection ---
      // If any explicit portal node (entry/exit/entryexit) exists, use those.
      // Otherwise fall back to auto-detection (dead-end road = source).

      const sinks = new Set();

      const hasExplicitPortals = Object.values(this.nodes).some(n => isPortal(n.type));

      if (hasExplicitPortals) {
        for (const road of allRoads) {
          const fromNode = this.nodes[road._nkFrom];
          const toNode   = this.nodes[road._nkTo];
          if (fromNode && (fromNode.type === 'entry' || fromNode.type === 'entryexit')) {
            sources.push(road);
          }
          if (toNode && (toNode.type === 'exit' || toNode.type === 'entryexit')) {
            road.outgoing = [];
            road._isSink = true;
            sinks.add(road);
          }
        }
      } else {
        // Auto-detection: a road is a source when its start node is not an
        // intersection AND no active road feeds into it from that direction.
        for (const ek in roadMap) {
          const { ab, ba, dir, c1, r1, c2, r2 } = roadMap[ek];

          const nkA = nodeKey(c1, r1);
          if (!(this.nodes[nkA] && this.nodes[nkA].type)) {
            const od = DIR[OPP[dir]];
            const pc = c1 + od.dc, pr = r1 + od.dr;
            const prevEk = (pc >= 0 && pc < cols && pr >= 0 && pr < rows)
              ? edgeKey(pc, pr, c1, r1) : null;
            const fed = prevEk && this.edges[prevEk] && this.edges[prevEk].hasRoad;
            if (!fed) sources.push(ab);
          }

          const nkB = nodeKey(c2, r2);
          if (!(this.nodes[nkB] && this.nodes[nkB].type)) {
            const d = DIR[dir];
            const pc = c2 + d.dc, pr = r2 + d.dr;
            const prevEk = (pc >= 0 && pc < cols && pr >= 0 && pr < rows)
              ? edgeKey(c2, r2, pc, pr) : null;
            const fed = prevEk && this.edges[prevEk] && this.edges[prevEk].hasRoad;
            if (!fed) sources.push(ba);
          }
        }
      }

      // --- Step 3: Build per-node road index and wire outgoing ---

      // nodeRoads: nodeKey → { incoming:[{road,fromDir}], departing:[{road,toDir}] }
      const nodeRoads = {};
      function nr(nk) {
        if (!nodeRoads[nk]) nodeRoads[nk] = { incoming: [], departing: [] };
        return nodeRoads[nk];
      }

      for (const ek in roadMap) {
        const { ab, ba, dir, c1, r1, c2, r2 } = roadMap[ek];
        const nkA = nodeKey(c1, r1);
        const nkB = nodeKey(c2, r2);
        nr(nkA).departing.push({ road: ab, toDir: dir });
        nr(nkB).incoming.push({ road: ab, fromDir: dir });
        nr(nkB).departing.push({ road: ba, toDir: OPP[dir] });
        nr(nkA).incoming.push({ road: ba, fromDir: OPP[dir] });
      }

      // Wire outgoing: for each road arriving at node N, connect to all roads
      // departing N except the U-turn (the road going back the way this one came).
      // Skip roads already marked as sinks (their outgoing is already locked to []).
      for (const nk in nodeRoads) {
        const { incoming, departing } = nodeRoads[nk];
        for (const { road, fromDir } of incoming) {
          if (sinks.has(road)) continue;
          const uTurnDir = OPP[fromDir]; // would go back toward the road's origin
          road.outgoing = departing
            .filter(dep => dep.toDir !== uTurnDir)
            .map(dep => dep.road);
        }
      }

      // --- Step 4: Signal controllers and roundabout yield controllers ---

      const controllers = [];

      for (const nk in this.nodes) {
        const node = this.nodes[nk];
        if (!node.type) continue;
        if (isPortal(node.type)) continue;

        if (node.type === 'roundabout') {
          // Build roundabout internals: 4 arc segments + entry/exit stubs.
          // The node's incoming/departing roads are the approach roads from the grid.
          // We insert a mini-roundabout inside BOX_R at the node centre.
          const parts = nk.split(',');
          const nc = Number(parts[0]), nr_ = Number(parts[1]);
          const cx = nc * cs, cy = nr_ * cs;
          const R = BOX_R - 1.5;   // ring centreline radius inside the box
          const lane = 1.5;         // half-spacing of entry/exit lanes

          // Order: E S W N (phi = 0, 90, 180, 270 deg) — matches scenarios.js
          const armDirs = ['E', 'S', 'W', 'N'];
          const phis = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];

          const nrData = nodeRoads[nk];

          // Build 4 ring arcs (always all 4 — unused ones carry no cars but
          // keep the wiring topology simple)
          const arcRoads = [];
          const entryRoads = [];
          const exitRoads = [];

          for (let k = 0; k < 4; k++) {
            const phi = phis[k];
            const u = [Math.cos(phi), Math.sin(phi)];
            const c_ = [Math.sin(phi), -Math.cos(phi)]; // CCW travel direction at this arm

            // Quarter arc sweeping -90 deg (CCW on screen)
            const arcRoad = new TT.Road(TT.geom.ArcPath(cx, cy, R, phi, -Math.PI / 2), { name: nk + '_arc_' + armDirs[k] });
            arcRoads.push(arcRoad);
            allRoads.push(arcRoad);

            // Entry stub: from the box edge inward to the ring
            const eA = [cx + u[0] * BOX_R + c_[0] * lane, cy + u[1] * BOX_R + c_[1] * lane];
            const eB = [cx + u[0] * (R + 1) + c_[0] * lane, cy + u[1] * (R + 1) + c_[1] * lane];
            const entryRoad = new TT.Road(TT.geom.StraightPath(eA[0], eA[1], eB[0], eB[1]), { name: nk + '_entry_' + armDirs[k] });
            entryRoads.push(entryRoad);
            allRoads.push(entryRoad);

            // Exit stub: from the ring outward to the box edge
            const xA = [cx + u[0] * (R + 1) - c_[0] * lane, cy + u[1] * (R + 1) - c_[1] * lane];
            const xB = [cx + u[0] * BOX_R - c_[0] * lane, cy + u[1] * BOX_R - c_[1] * lane];
            const exitRoad = new TT.Road(TT.geom.StraightPath(xA[0], xA[1], xB[0], xB[1]), { name: nk + '_exit_' + armDirs[k] });
            exitRoads.push(exitRoad);
            allRoads.push(exitRoad);
          }

          // Wire ring: arc[k] exits at arm (k+3)%4 → exit[(k+3)%4] or arc[(k+3)%4]
          for (let k = 0; k < 4; k++) {
            const next = (k + 3) % 4;
            arcRoads[k].outgoing = [exitRoads[next], arcRoads[next]];
            entryRoads[k].outgoing = [arcRoads[k]];
            // exitRoads[k].outgoing set below when wired to the departure road
          }

          // Connect the approach roads (from the grid) to the entry stubs,
          // and exit stubs to the departure roads (going out of the grid).
          // Grid road arriving at this node from direction D → entry at arm D
          // Grid road departing from this node toward direction D → exit at arm D
          const armIndex = { E: 0, S: 1, W: 2, N: 3 };
          if (nrData) {
            for (const { road, fromDir } of nrData.incoming) {
              // road arrives travelling fromDir, so it came from OPP[fromDir] arm
              const k = armIndex[fromDir];
              if (k != null) road.outgoing = [entryRoads[k]];
            }
            for (const { road: depRoad, toDir } of nrData.departing) {
              // depRoad departs in toDir — it should be fed by exit at that arm
              const k = armIndex[toDir];
              if (k != null) exitRoads[k].outgoing = [depRoad];
            }
          }

          // Yield gates: entry[k] yields to arc[(k+1)%4] ending and arc[k] start
          const merges = [];
          for (let k = 0; k < 4; k++) {
            const upstream = arcRoads[(k + 1) % 4];
            merges.push({
              entry: entryRoads[k],
              watchers: [
                { road: upstream, point: upstream.length },
                { road: arcRoads[k], point: 0 },
              ],
            });
          }
          controllers.push(new TT.YieldController(merges));

          // Island metadata (used by renderer to draw filled centre)
          // Store on world after return — collected below
          allRoads._roundaboutIsland = allRoads._roundaboutIsland || [];
          allRoads._roundaboutIsland.push({ x: cx, y: cy, r: R });

          continue;
        }

        // Signal-controlled intersections (fourway, tee_*)
        const sigNrData = nodeRoads[nk];
        if (!sigNrData || !sigNrData.incoming.length) continue;

        const byFrom = {};
        for (const { road, fromDir } of sigNrData.incoming) byFrom[fromDir] = road;

        const nsRoads = [];
        if (byFrom.S) nsRoads.push(byFrom.S);
        if (byFrom.N) nsRoads.push(byFrom.N);
        const ewRoads = [];
        if (byFrom.E) ewRoads.push(byFrom.E);
        if (byFrom.W) ewRoads.push(byFrom.W);

        const phases = [];
        if (nsRoads.length) phases.push({ green: nsRoads, duration: 20 });
        if (ewRoads.length) phases.push({ green: ewRoads, duration: 20 });

        if (phases.length) {
          signals.push(new TT.SignalController(phases, { clearance: 1.5 }));
        }
      }

      const islands = allRoads._roundaboutIsland || [];
      delete allRoads._roundaboutIsland;

      // Collect exit node keys so simulation can route cars toward them.
      const exitNodes = [];
      if (hasExplicitPortals) {
        for (const nk in this.nodes) {
          const t = this.nodes[nk].type;
          if (t === 'exit' || t === 'entryexit') exitNodes.push(nk);
        }
      }

      return {
        kind: 'builder',
        bounds: { w: (cols - 1) * cs, h: (rows - 1) * cs },
        roads: allRoads,
        signals,
        controllers,
        sources,
        exitNodes,
        hasExplicitPortals,
        isBuilderWorld: true,
        island: islands.length === 1 ? islands[0] : null,
        navGraph: TT.router ? TT.router.buildNavGraph(allRoads) : null,
        populate() { /* cars arrive via sources */ },
      };
    },

    serialize() {
      const nodesJson = {};
      for (const k in this.nodes) {
        const n = this.nodes[k];
        nodesJson[k] = { type: n.type, connectors: [...n.connectors] };
      }
      return JSON.stringify({
        cols: this.cols, rows: this.rows, cellSize: this.cellSize,
        nodes: nodesJson, edges: this.edges,
      });
    },

    deserialize(json) {
      const d = JSON.parse(json);
      this.cols = d.cols; this.rows = d.rows; this.cellSize = d.cellSize;
      this.nodes = {};
      for (const k in d.nodes) {
        const n = d.nodes[k];
        this.nodes[k] = { type: n.type, connectors: new Set(n.connectors) };
      }
      this.edges = d.edges;
    },
  };

  TT.builderModel = model;
  model.init();

  // -------------------------------------------------------------------------
  // Hard-coded test scenario: a horizontal road with a T-intersection
  // -------------------------------------------------------------------------
  //
  //   [1,4] ── [2,4] ── [3,4] ── [4,4]
  //                       |
  //                     [3,3]
  //
  // tee_S at (3,4): open N, E, W — south arm is closed.
  // Border sources spawn from the left (1,4), right (4,4), and top (3,3).

  model.drawRoad({ col: 1, row: 4 }, { col: 2, row: 4 });
  model.drawRoad({ col: 2, row: 4 }, { col: 3, row: 4 });
  model.drawRoad({ col: 3, row: 4 }, { col: 4, row: 4 });
  model.drawRoad({ col: 3, row: 3 }, { col: 3, row: 4 });
  model.placeIntersection(3, 4, 'tee_S');

  TT.scenarios['builder-test'] = {
    label: 'Builder Test (T-intersection)',
    caps: ['spawns'],
    disturb: true,
    build() { return TT.builderModel.toWorld(); },
  };

})(window.TT);
