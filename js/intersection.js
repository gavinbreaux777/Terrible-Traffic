/*
 * A fixed-time signal controller. It owns a set of phases; each phase names the
 * roads that get a green light and how long that phase lasts. A short all-red
 * clearance is inserted between phases so cross traffic clears the box.
 *
 * The controller writes `signalRed` onto each road it manages every tick; the
 * road's leader logic does the rest (a red light is just an obstacle at the
 * stop line). Swapping in actuated or adaptive control later means replacing
 * only this file.
 */
(function (TT) {
  'use strict';

  class SignalController {
    constructor(phases, opts) {
      opts = opts || {};
      this.phases = phases;            // [{ green: [Road,...], duration }]
      this.clearance = opts.clearance != null ? opts.clearance : 1.5; // all-red secs
      this.allRoads = [];
      for (const ph of phases) for (const r of ph.green) {
        if (!this.allRoads.includes(r)) this.allRoads.push(r);
      }
      this.index = 0;
      this.timer = phases.length ? phases[0].duration : 0;
      this.inClearance = false;
      this.apply();
    }

    apply() {
      const green = this.inClearance ? [] : this.phases[this.index].green;
      for (const r of this.allRoads) r.signalRed = !green.includes(r);
    }

    update(dt) {
      if (!this.phases.length) return;
      this.timer -= dt;
      if (this.timer > 0) return;

      if (this.inClearance) {
        // Clearance finished: start the next green phase.
        this.inClearance = false;
        this.index = (this.index + 1) % this.phases.length;
        this.timer = this.phases[this.index].duration;
      } else {
        // Green finished: go all-red briefly before the next phase.
        this.inClearance = true;
        this.timer = this.clearance;
      }
      this.apply();
    }
  }

  /*
   * A give-way (yield) controller for un-signalized merges like a roundabout.
   * It does the same job as SignalController — write `signalRed` onto a road so
   * the IDM treats the stop line as an obstacle — but the "light" is dynamic:
   * an entry lane is held red only while conflicting traffic is at, or about to
   * reach, the merge point. When a gap opens the light clears and the waiting
   * car accelerates smoothly through (no hard stall, because the obstacle was
   * visible on approach and the car was already slowing for it).
   *
   * Each merge is { entry, watchers } where every watcher is { road, point }:
   * the arc-length `point` on `road` that coincides with the merge. A
   * circulating car blocks the entry if it is inside the conflict zone or will
   * reach the merge within `acceptGap` seconds.
   */
  class YieldController {
    constructor(merges, opts) {
      opts = opts || {};
      this.merges = merges;                       // [{ entry, watchers:[{road,point}] }]
      this.acceptGap = opts.acceptGap != null ? opts.acceptGap : 2.6; // s
      this.zone = opts.zone != null ? opts.zone : 6; // conflict half-width, m
      this.update(0);
    }

    update(dt, params) {
      // Live gap-acceptance slider overrides the default when present.
      const acceptGap = params && params.gapAccept != null ? params.gapAccept : this.acceptGap;
      for (const m of this.merges) {
        let blocked = false;
        for (const w of m.watchers) {
          for (const veh of w.road.vehicles) {
            const dist = w.point - veh.s;      // distance from car to the merge
            if (dist < -this.zone) continue;   // already cleared the merge
            if (dist < this.zone) { blocked = true; break; } // in the conflict zone
            if (dist / Math.max(veh.v, 0.5) < acceptGap) { blocked = true; break; }
          }
          if (blocked) break;
        }
        m.entry.signalRed = blocked;
      }
    }
  }

  TT.SignalController = SignalController;
  TT.YieldController = YieldController;
})(window.TT);
