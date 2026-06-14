/*
 * Thin bridge between the builder model and the simulation.
 * Calls builderModel.toWorld(), pushes the result into the running sim,
 * and rebuilds the nav graph so routing works immediately.
 *
 * Usage (from main.js):
 *   TT.builderWorld.apply(sim);   // rebuild sim from current grid state
 */
(function (TT) {
  'use strict';

  const builderWorld = {
    // Replace the sim's world with a freshly-generated builder world.
    apply(sim) {
      const world = TT.builderModel.toWorld();
      sim.world = world;
      for (const r of world.roads) { r.vehicles.length = 0; r._spawnAcc = 0; }
      sim.time = 0;
      sim.exited = 0;
      world.populate(sim);
    },
  };

  TT.builderWorld = builderWorld;
})(window.TT);
