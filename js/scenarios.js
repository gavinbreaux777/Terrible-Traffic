/*
 * World builders, kept in a small registry so adding a new intersection type is
 * a single `register(...)` call — no edits to the dropdown, controls, buttons,
 * or stats are needed (those are all driven by the metadata declared here).
 *
 * Each scenario is registered with:
 *   {
 *     label,            // shown in the scenario dropdown
 *     caps: [...],      // capability tags; controls opt in via the same tags
 *                       //   'fixedCount' -> the "Cars" slider applies
 *                       //   'spawns'     -> the "Spawn rate" slider applies
 *     disturb,          // show the "tap the brakes" tool for this scenario?
 *     build()           // returns a fresh world the Simulation drives:
 *                       //   { kind, bounds:{w,h}, roads:[Road],
 *                       //     signals:[SignalController], sources:[Road],
 *                       //     island?:{x,y,r}, populate(sim) }
 *   }
 *
 * bounds are in meters; the renderer fits them to the canvas. A world that lists
 * `sources` gets throughput stats automatically; one that lists `signals` gets
 * signal dots; one that sets `island` gets a filled centre drawn. New road
 * shapes only need the { length, pointAt(s) } interface from geometry.js.
 */
(function (TT) {
  'use strict';

  const { StraightPath, CirclePath, ArcPath } = TT.geom;

  TT.scenarios = TT.scenarios || {};
  function register(name, def) { TT.scenarios[name] = def; }

  // ---- Ring road (closed loop, conserves cars) -----------------------------
  register('ring', {
    label: 'Highway — ring (phantom jams)',
    caps: ['fixedCount'],
    disturb: true,
    build() {
      const cx = 80, cy = 80, r = 60;
      const loop = new TT.Road(CirclePath(cx, cy, r, -Math.PI / 2), { name: 'ring', loop: true });
      return {
        kind: 'ring',
        bounds: { w: 160, h: 160 },
        roads: [loop],
        signals: [],
        sources: [],
        populate(sim) {
          loop.vehicles.length = 0;
          const n = Math.max(1, Math.round(sim.params.carCount));
          const spacing = loop.length / n;
          for (let i = 0; i < n; i++) {
            loop.add(new TT.Vehicle(i * spacing, sim.params.desiredSpeed * 0.8));
          }
        },
      };
    },
  });

  // ---- Four-way signalized intersection ------------------------------------
  register('intersection', {
    label: 'Intersection — 4-way signals',
    caps: ['spawns'],
    disturb: false,
    build() {
      const cx = 80, cy = 80, L = 70, box = 7, lane = 2.2;
      // Outward unit vectors for N, E, S, W.
      const dirs = [
        { name: 'N', u: [0, -1] },
        { name: 'E', u: [1, 0] },
        { name: 'S', u: [0, 1] },
        { name: 'W', u: [-1, 0] },
      ];

      const inRoad = [], outRoad = [];
      for (const d of dirs) {
        const [ux, uy] = d.u;
        // Incoming: travels inward (dir = -u). Right-hand offset for the lane.
        const tin = [-ux, -uy];
        const rin = [tin[1], -tin[0]];
        const inA = [cx + ux * L + rin[0] * lane, cy + uy * L + rin[1] * lane];
        const inB = [cx + ux * box + rin[0] * lane, cy + uy * box + rin[1] * lane];
        const ri = new TT.Road(StraightPath(inA[0], inA[1], inB[0], inB[1]), { name: 'in_' + d.name });
        ri.stopLine = ri.length; // red light stops cars at the box edge
        inRoad.push(ri);

        // Outgoing: travels outward (dir = u). Right-hand offset.
        const tout = [ux, uy];
        const rout = [tout[1], -tout[0]];
        const outA = [cx + ux * box + rout[0] * lane, cy + uy * box + rout[1] * lane];
        const outB = [cx + ux * L + rout[0] * lane, cy + uy * L + rout[1] * lane];
        const ro = new TT.Road(StraightPath(outA[0], outA[1], outB[0], outB[1]), { name: 'out_' + d.name });
        outRoad.push(ro); // empty outgoing => acts as a sink at its far end
      }

      // From each approach you may leave by any arm except the one you came in on.
      for (let d = 0; d < 4; d++) {
        inRoad[d].outgoing = outRoad.filter((_, k) => k !== d);
      }

      // North/South green, then East/West green.
      const signal = new TT.SignalController([
        { green: [inRoad[0], inRoad[2]], duration: 9 },
        { green: [inRoad[1], inRoad[3]], duration: 9 },
      ], { clearance: 2 });

      return {
        kind: 'intersection',
        bounds: { w: 160, h: 160 },
        roads: [...inRoad, ...outRoad],
        signals: [signal],
        sources: inRoad.slice(),
        populate() { /* cars arrive via sources over time */ },
      };
    },
  });

  // ---- Roundabout (yield on entry, circulating traffic has priority) -------
  register('roundabout', {
    label: 'Roundabout — yield on entry',
    caps: ['spawns', 'yield'],
    disturb: true,
    build() {
      const cx = 80, cy = 80, R = 32;     // ring centreline radius
      const lane = 2.6;                    // half-spacing of the entry/exit lanes
      const innerR = R + 2, outerR = 76;   // approach road extent, as a radius

      // Four arms (E, S, W, N) at ring angles 0, 90, 180, 270 deg so each arc
      // segment spans exactly a quarter of the ring.
      const dirs = [
        { name: 'E', phi: 0 },
        { name: 'S', phi: Math.PI / 2 },
        { name: 'W', phi: Math.PI },
        { name: 'N', phi: 3 * Math.PI / 2 },
      ];

      const arc = [], entry = [], exit = [];
      for (let k = 0; k < 4; k++) {
        const phi = dirs[k].phi;
        const u = [Math.cos(phi), Math.sin(phi)];   // radial, outward
        // Circulation runs counterclockwise on screen (right-hand traffic): the
        // ring sweeps -90 deg, so cars bear right when entering. c is the ring's
        // travel direction at this arm, also the perpendicular for lane offsets.
        const c = [Math.sin(phi), -Math.cos(phi)];

        // Ring segment: a quarter turn that departs this arm counterclockwise.
        arc.push(new TT.Road(ArcPath(cx, cy, R, phi, -Math.PI / 2), { name: 'arc_' + dirs[k].name }));

        // Entry lane: inbound toward the ring, on the +c (downstream) side so the
        // merge is a right turn. Runs from the outer edge in to the ring.
        const eA = [cx + u[0] * outerR + c[0] * lane, cy + u[1] * outerR + c[1] * lane];
        const eB = [cx + u[0] * innerR + c[0] * lane, cy + u[1] * innerR + c[1] * lane];
        entry.push(new TT.Road(StraightPath(eA[0], eA[1], eB[0], eB[1]), { name: 'entry_' + dirs[k].name }));

        // Exit lane: outbound from the ring on the -c side. Sink at the far end.
        const xA = [cx + u[0] * innerR - c[0] * lane, cy + u[1] * innerR - c[1] * lane];
        const xB = [cx + u[0] * outerR - c[0] * lane, cy + u[1] * outerR - c[1] * lane];
        exit.push(new TT.Road(StraightPath(xA[0], xA[1], xB[0], xB[1]), { name: 'exit_' + dirs[k].name }));
      }

      // Wiring. arc[k] departs arm k and ends at arm (k+3)%4 (the next one
      // counterclockwise); there a car may peel off onto that arm's exit or
      // continue on the ring. Entering cars merge onto the arc that departs their
      // own arm (so they can't U-turn straight back out).
      for (let k = 0; k < 4; k++) {
        const next = (k + 3) % 4;
        arc[k].outgoing = [exit[next], arc[next]];
        entry[k].outgoing = [arc[k]];
        // exit[k].outgoing stays [] -> sink at the far end.
      }

      // Yield gates: entry[k] merges at the start of arc[k]. It must give way to
      // circulating traffic finishing the arc that ends at arm k (arc[(k+1)%4])
      // and to any car that just claimed the merge (start of arc[k]). The
      // controller writes signalRed onto the entry lane, so cars slow on approach
      // and accelerate through when a gap opens — instead of stalling at the line.
      const merges = [];
      for (let k = 0; k < 4; k++) {
        const upstream = arc[(k + 1) % 4];
        merges.push({
          entry: entry[k],
          watchers: [
            { road: upstream, point: upstream.length },
            { road: arc[k], point: 0 },
          ],
        });
      }
      const yieldCtl = new TT.YieldController(merges);

      return {
        kind: 'roundabout',
        bounds: { w: 160, h: 160 },
        roads: [...arc, ...entry, ...exit],
        signals: [],
        controllers: [yieldCtl],
        sources: entry.slice(),
        island: { x: cx, y: cy, r: R },
        populate() { /* cars arrive via sources over time */ },
      };
    },
  });
})(window.TT);
