/*
 * A single vehicle. State is just position `s` along its road and speed `v`.
 * The heavy lifting is the Intelligent Driver Model (IDM), which computes
 * acceleration from the gap and relative speed to the car ahead.
 *
 *   IDM:  a = aMax * [ 1 - (v/v0)^delta - (sStar/gap)^2 ]
 *         sStar = s0 + v*T + (v*dv) / (2*sqrt(aMax*b))
 *
 * The (v/v0)^delta term pulls you toward the desired speed in free flow; the
 * (sStar/gap)^2 term brakes you as the gap to the leader closes. Phantom
 * traffic jams emerge naturally from this — no special-casing required.
 */
(function (TT) {
  'use strict';

  const DELTA = 4; // free-acceleration exponent (standard IDM value)

  let nextId = 1;

  class Vehicle {
    constructor(s, v) {
      this.id = nextId++;
      this.s = s;            // arc-length position along current road (m)
      this.v = v || 0;       // speed (m/s)
      this.accel = 0;        // last computed acceleration (m/s^2), for coloring
      this.route = null;     // [nodeKey, ...] waypoints for builder-mode routing, or null
      this.destEdge = null;  // destination edge key, or null
      this.brakeTimer = 0;   // >0 forces a hard brake (the "tap the brakes" tool)
      this.hue = 210;        // base color; renderer shifts by speed
    }

    /*
     * Compute (but don't yet apply) acceleration for this step.
     *  gap        distance of clear road ahead, bumper to bumper (m)
     *  leadSpeed  speed of the obstacle ahead (m/s); use this.v if none
     *  p          live params object (TT params)
     */
    computeAccel(gap, leadSpeed, p) {
      if (this.brakeTimer > 0) {
        // Seeded disturbance: brake hard regardless of the road ahead.
        this.accel = -Math.max(6, p.comfortBrake * 2.5);
        return this.accel;
      }

      const v = this.v;
      const v0 = p.desiredSpeed;
      const free = 1 - Math.pow(v / v0, DELTA);

      let interaction = 0;
      if (gap !== Infinity) {
        const dv = v - leadSpeed; // closing speed (positive = approaching)
        const sStar =
          p.minGap +
          Math.max(0, v * p.timeHeadway + (v * dv) / (2 * Math.sqrt(p.maxAccel * p.comfortBrake)));
        const g = Math.max(gap, 0.1); // guard against divide-by-zero / overlap
        interaction = (sStar / g) * (sStar / g);
      }

      this.accel = p.maxAccel * (free - interaction);
      return this.accel;
    }

    // Integrate one step with the previously computed acceleration.
    integrate(dt) {
      if (this.brakeTimer > 0) this.brakeTimer -= dt;
      let v = this.v + this.accel * dt;
      if (v < 0) v = 0; // cars don't reverse in this model
      // Trapezoidal-ish position update keeps standstill cars from drifting.
      this.s += 0.5 * (this.v + v) * dt;
      this.v = v;
    }
  }

  TT.Vehicle = Vehicle;
})(window.TT);
