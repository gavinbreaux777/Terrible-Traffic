/*
 * A road is a one-way lane: a path plus the ordered list of vehicles on it.
 * Vehicles are always kept sorted by `s` (ascending), so the car ahead of
 * index i is simply index i+1.
 *
 * Two kinds of road exist:
 *   - loop roads (the ring): the front car follows the rear car across the seam.
 *   - open roads (intersection arms): the front car follows the traffic signal
 *     at its stop line, then transfers onto an outgoing road past the line.
 *
 * Road only knows how to report each car's leader. The Simulation drives the
 * two-pass update (compute all accelerations, then integrate) and handles
 * transfers between roads, so ordering never biases the physics.
 */
(function (TT) {
  'use strict';

  let nextId = 1;

  class Road {
    constructor(path, opts) {
      opts = opts || {};
      this.id = nextId++;
      this.name = opts.name || ('road' + this.id);
      this.path = path;
      this.length = path.length;
      this.loop = !!opts.loop;
      this.vehicles = [];

      // Signal handling (open roads only).
      this.stopLine = opts.stopLine != null ? opts.stopLine : this.length;
      this.signalRed = false;

      // Routing: outgoing roads a car may transfer onto at the end.
      this.outgoing = []; // array of Road
    }

    add(vehicle) {
      this.vehicles.push(vehicle);
      this.sort();
    }

    remove(vehicle) {
      const i = this.vehicles.indexOf(vehicle);
      if (i >= 0) this.vehicles.splice(i, 1);
    }

    sort() {
      this.vehicles.sort((a, b) => a.s - b.s);
    }

    /*
     * Leader info for the vehicle at index i.
     * Returns { gap, leadSpeed } where gap is clear distance ahead (bumper to
     * bumper) and leadSpeed is the obstacle's speed. gap === Infinity means
     * open road ahead.
     */
    leaderInfo(i, carLen) {
      const v = this.vehicles[i];
      const n = this.vehicles.length;

      if (this.loop) {
        const lead = this.vehicles[(i + 1) % n];
        if (lead === v) return { gap: Infinity, leadSpeed: v.v }; // alone on loop
        let gap = lead.s - carLen - v.s;
        if (i + 1 >= n) gap += this.length; // wrap across the seam
        return { gap, leadSpeed: lead.v };
      }

      // Open road: car ahead on the same road, if any.
      if (i + 1 < n) {
        const lead = this.vehicles[i + 1];
        return { gap: lead.s - carLen - v.s, leadSpeed: lead.v };
      }

      // Frontmost car: the signal is the obstacle when red.
      if (this.signalRed) {
        const gap = this.stopLine - v.s;
        if (gap >= 0) return { gap, leadSpeed: 0 };
      }

      // Frontmost car on a free-flowing corner: look through the bend to the
      // first car on the continuation road so cars don't pile into the corner.
      // The two segments behave as one continuous lane.
      if (this._corner && this.outgoing.length === 1) {
        const next = this.outgoing[0];
        if (next.vehicles.length) {
          let leadS = Infinity, leadV = 0;
          for (const u of next.vehicles) if (u.s < leadS) { leadS = u.s; leadV = u.v; }
          // Distance to that car: remaining road on this segment + its position.
          const gap = (this.length - v.s) + leadS - carLen;
          return { gap: Math.max(gap, 0), leadSpeed: leadV };
        }
      }

      return { gap: Infinity, leadSpeed: v.v };
    }
  }

  TT.Road = Road;
})(window.TT);
