/*
 * Path primitives. A Path maps a 1-D arc-length coordinate `s` (meters from
 * the road's start) onto a 2-D world point plus a heading. Vehicles only ever
 * track `s` and `v`; the path turns that into something the renderer can draw.
 *
 * Adding a new road shape (e.g. an arbitrary polyline or a bezier on/off ramp)
 * means adding another object with the same { length, pointAt(s) } interface.
 */
(function (TT) {
  'use strict';

  // pointAt(s) returns { x, y, angle } where angle is the tangent heading.

  function StraightPath(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    return {
      length: len,
      pointAt(s) {
        const t = len === 0 ? 0 : s / len;
        return { x: x1 + dx * t, y: y1 + dy * t, angle };
      },
    };
  }

  // Circle traversed counter-clockwise starting at angle `startRad`.
  function CirclePath(cx, cy, r, startRad) {
    startRad = startRad || 0;
    return {
      length: 2 * Math.PI * r,
      radius: r,
      cx, cy,
      pointAt(s) {
        const theta = startRad + s / r;
        return {
          x: cx + r * Math.cos(theta),
          y: cy + r * Math.sin(theta),
          angle: theta + Math.PI / 2, // tangent for CCW travel
        };
      },
    };
  }

  // A partial arc of a circle: starts at `startRad`, sweeps `sweepRad` radians
  // (sign sets the travel direction). Used for the segments of a roundabout ring.
  function ArcPath(cx, cy, r, startRad, sweepRad) {
    const dir = sweepRad < 0 ? -1 : 1;
    return {
      length: Math.abs(sweepRad) * r,
      radius: r,
      cx, cy,
      pointAt(s) {
        const theta = startRad + dir * (s / r);
        return {
          x: cx + r * Math.cos(theta),
          y: cy + r * Math.sin(theta),
          angle: theta + dir * Math.PI / 2, // tangent in the travel direction
        };
      },
    };
  }

  TT.geom = { StraightPath, CirclePath, ArcPath };
})(window.TT);
