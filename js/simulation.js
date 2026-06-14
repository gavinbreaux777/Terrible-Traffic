/*
 * The simulation owns the live params, the current world, and the update loop.
 *
 * Each step is two passes so vehicle ordering never biases the physics:
 *   1. compute every vehicle's acceleration from its current leader,
 *   2. integrate every vehicle,
 * then resolve loop wrap-around, transfers between roads, spawning and sinks.
 */
(function (TT) {
  'use strict';

  class Simulation {
    constructor(params) {
      this.params = params || TT.defaults();
      this.scenarioName = 'ring';
      this.time = 0;
      this.exited = 0; // cars that have left via a sink (throughput)
      this.build('ring');
    }

    build(name) {
      this.scenarioName = name;
      this.world = TT.scenarios[name].build();
      for (const r of this.world.roads) { r.vehicles.length = 0; r._spawnAcc = 0; }
      this.time = 0;
      this.exited = 0;
      this.world.populate(this);
    }

    reset() { this.build(this.scenarioName); }

    step(dt) {
      const p = this.params;
      const carLen = p.vehicleLength;
      const world = this.world;
      this.time += dt;

      // 1. Signals and any other controllers (e.g. roundabout yield gates).
      for (const sig of world.signals) sig.update(dt);
      if (world.controllers) for (const c of world.controllers) c.update(dt, p);

      // 2. Spawning at source roads (open scenarios).
      for (const src of world.sources) {
        src._spawnAcc += p.spawnRate * dt;
        while (src._spawnAcc >= 1) {
          src._spawnAcc -= 1;
          this.trySpawn(src, carLen);
        }
      }

      // 3. Compute accelerations from current state.
      for (const road of world.roads) {
        road.sort();
        for (let i = 0; i < road.vehicles.length; i++) {
          const info = road.leaderInfo(i, carLen);
          road.vehicles[i].computeAccel(info.gap, info.leadSpeed, p);
        }
      }

      // 4. Integrate.
      for (const road of world.roads) {
        for (const veh of road.vehicles) veh.integrate(dt);
      }

      // 5. Resolve loop wrap and road-to-road transfers.
      for (const road of world.roads) {
        if (road.loop) {
          for (const veh of road.vehicles) {
            if (veh.s >= road.length) veh.s -= road.length;
          }
          continue;
        }
        // Open road: anything past the end leaves or transfers.
        const leaving = road.vehicles.filter(v => v.s >= road.length);
        for (const veh of leaving) {
          const overflow = veh.s - road.length;
          const next = this.pickOutgoing(road, carLen, veh);
          road.remove(veh);
          if (next) {
            veh.s = overflow;
            next.add(veh);
          } else if (road.outgoing.length === 0 &&
                     (!this.world.hasExplicitPortals || road._isSink)) {
            this.exited++; // reached a designated sink (or auto-mode dead-end)
          } else {
            // Outgoing exists but is blocked, or explicit-portal mode with no
            // valid exit here: hold at the stop line and wait.
            veh.s = road.length;
            veh.v = 0;
            road.add(veh);
          }
        }
      }
    }

    // Pick the next outgoing road for the vehicle at the front of `road`.
    // For builder-mode routed vehicles, delegates to the router; falls back
    // to random selection if the router returns null or no route is set.
    pickOutgoing(road, carLen, veh) {
      if (!road.outgoing.length) return null;
      const candidates = road.outgoing.filter(r => this.hasRoom(r, carLen));
      if (!candidates.length) return null;

      // Routed selection for builder worlds: follow the leaving vehicle's
      // predetermined route. If a route exists but the next waypoint isn't yet
      // reachable (outgoing blocked), do NOT fall back to a random road — that
      // would send the car off its planned path. Return null to make it wait.
      if (this.world.isBuilderWorld && veh && veh.route && veh.route.length) {
        return TT.router.nextRoad(veh, candidates); // may be null → car waits
      }

      return candidates[(Math.random() * candidates.length) | 0];
    }

    hasRoom(road, carLen) {
      if (!road.vehicles.length) return true;
      let minS = Infinity;
      for (const v of road.vehicles) if (v.s < minS) minS = v.s;
      return minS > carLen + this.params.minGap;
    }

    trySpawn(road, carLen) {
      if (!this.hasRoom(road, carLen)) return;
      const veh = new TT.Vehicle(0, this.params.desiredSpeed * 0.6);

      // Assign a route for builder-mode worlds.
      if (this.world.isBuilderWorld && road._nkTo && this.world.navGraph) {
        const exitNodes = this.world.exitNodes;
        const useExits = this.world.hasExplicitPortals;

        if (useExits) {
          // If there are no exit nodes at all, nowhere to route — suppress spawn.
          if (!exitNodes || exitNodes.length === 0) return;
          // Explicit exit nodes: pick a random reachable exit and route to it.
          // Shuffle so we don't always try the same one first.
          const shuffled = exitNodes.slice().sort(() => Math.random() - 0.5);
          let assigned = false;
          for (const destNk of shuffled) {
            if (destNk === road._nkTo) continue; // already at an exit node
            const route = TT.router.findRoute(this.world.navGraph, road._nkTo, destNk);
            if (route && route.length > 1) {
              veh.route = route.slice(1);
              veh.destEdge = destNk;
              assigned = true;
              break;
            }
          }
          // No reachable exit — suppress the spawn entirely.
          if (!assigned) return;
        } else {
          // No explicit exits: route toward another source (legacy behaviour).
          const sources = this.world.sources;
          const otherSources = sources.filter(s => s !== road && s._nkTo);
          if (otherSources.length) {
            const dest = otherSources[(Math.random() * otherSources.length) | 0];
            const route = TT.router.findRoute(this.world.navGraph, road._nkTo, dest._nkTo);
            if (route && route.length > 1) {
              veh.route = route.slice(1);
              veh.destEdge = dest._nkTo;
            }
          }
        }
      }

      road.add(veh);
    }

    // The "tap the brakes" tool: seed a disturbance to watch a jam propagate.
    disturb() {
      const moving = [];
      for (const road of this.world.roads) {
        for (const v of road.vehicles) if (v.v > 1) moving.push(v);
      }
      const pool = moving.length ? moving : this.allVehicles();
      if (!pool.length) return;
      const target = pool[(Math.random() * pool.length) | 0];
      target.brakeTimer = 2.5;
    }

    allVehicles() {
      const out = [];
      for (const road of this.world.roads) for (const v of road.vehicles) out.push(v);
      return out;
    }

    stats() {
      const all = this.allVehicles();
      let sum = 0, stopped = 0;
      for (const v of all) { sum += v.v; if (v.v < 0.5) stopped++; }
      const avg = all.length ? sum / all.length : 0;
      return {
        cars: all.length,
        avgSpeed: avg,            // m/s
        stopped,
        time: this.time,
        throughput: this.time > 0 ? (this.exited / this.time) * 60 : 0, // cars/min
        // Any world that spawns cars at sources has meaningful throughput.
        hasThroughput: this.world.sources.length > 0,
      };
    }
  }

  TT.Simulation = Simulation;
})(window.TT);
