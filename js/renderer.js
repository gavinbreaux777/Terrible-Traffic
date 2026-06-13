/*
 * Canvas renderer. Pure view layer: it reads the simulation and draws, never
 * mutating state. World coordinates are meters; the world bounds are scaled to
 * fit the canvas each frame so the simulation never needs to know pixels.
 *
 * Cars are colored by speed (red = stopped, green = at desired speed), which
 * makes traffic waves on the ring road pop out visually.
 */
(function (TT) {
  'use strict';

  const LANE_W = 3.4;   // visual lane width, meters
  const CAR_W = 1.9;    // car body width, meters

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
    }

    // Fit world bounds into the canvas; returns the transform.
    layout(bounds) {
      const dpr = window.devicePixelRatio || 1;
      const cssW = this.canvas.clientWidth;
      const cssH = this.canvas.clientHeight;
      if (this.canvas.width !== cssW * dpr || this.canvas.height !== cssH * dpr) {
        this.canvas.width = cssW * dpr;
        this.canvas.height = cssH * dpr;
      }
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(cssW / bounds.w, cssH / bounds.h) * 0.92;
      const ox = (cssW - bounds.w * scale) / 2;
      const oy = (cssH - bounds.h * scale) / 2;
      return { scale, ox, oy, cssW, cssH };
    }

    render(sim) {
      const ctx = this.ctx;
      const world = sim.world;
      const t = this.layout(world.bounds);
      const X = x => t.ox + x * t.scale;
      const Y = y => t.oy + y * t.scale;

      ctx.clearRect(0, 0, t.cssW, t.cssH);
      ctx.fillStyle = '#0b0d11';
      ctx.fillRect(0, 0, t.cssW, t.cssH);

      // Centre decor. An intersection draws a junction box; a roundabout (or any
      // world that declares an `island`) draws a filled non-drivable centre.
      if (world.kind === 'intersection') {
        const half = 9 * t.scale;
        ctx.fillStyle = '#15191f';
        ctx.fillRect(X(world.bounds.w / 2) - half, Y(world.bounds.h / 2) - half, half * 2, half * 2);
      }
      if (world.island) {
        ctx.beginPath();
        ctx.arc(X(world.island.x), Y(world.island.y), (world.island.r - LANE_W / 2) * t.scale, 0, Math.PI * 2);
        ctx.fillStyle = '#15191f';
        ctx.fill();
      }

      // Roads.
      ctx.lineCap = 'round';
      for (const road of world.roads) {
        ctx.strokeStyle = '#272d37';
        ctx.lineWidth = LANE_W * t.scale;
        this.strokePath(road.path, X, Y);
      }

      // Signals: a dot at each controlled stop line.
      const controlled = new Set();
      for (const sig of world.signals) for (const r of sig.allRoads) controlled.add(r);
      for (const road of controlled) {
        const pt = road.path.pointAt(road.stopLine);
        ctx.beginPath();
        ctx.arc(X(pt.x), Y(pt.y), Math.max(3, 1.3 * t.scale), 0, Math.PI * 2);
        ctx.fillStyle = road.signalRed ? '#ff5256' : '#46d17a';
        ctx.fill();
      }

      // Vehicles.
      const v0 = sim.params.desiredSpeed;
      const len = sim.params.vehicleLength;
      for (const road of world.roads) {
        for (const veh of road.vehicles) {
          const pt = road.path.pointAt(veh.s);
          const ratio = Math.max(0, Math.min(1, veh.v / v0));
          const hue = ratio * 120; // 0 red -> 120 green
          ctx.save();
          ctx.translate(X(pt.x), Y(pt.y));
          ctx.rotate(pt.angle);
          ctx.fillStyle = veh.brakeTimer > 0 ? '#ff3b3b' : `hsl(${hue},75%,55%)`;
          const w = len * t.scale, h = CAR_W * t.scale;
          ctx.fillRect(-w, -h / 2, w, h); // anchored at the front bumper (s)
          ctx.restore();
        }
      }
    }

    // Draw any path by sampling pointAt along its length, so straights, full
    // circles, arcs, and any future shape all render with no special-casing.
    strokePath(path, X, Y) {
      const ctx = this.ctx;
      const n = Math.max(2, Math.ceil(path.length / 2)); // ~2 m per segment
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const pt = path.pointAt((path.length * k) / n);
        const px = X(pt.x), py = Y(pt.y);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  TT.Renderer = Renderer;
})(window.TT);
