/*
 * Route planning for builder-mode worlds. Pure data — no DOM, no Canvas.
 *
 * buildNavGraph  — build adjacency map from the current grid state
 * findRoute      — BFS shortest path between two node keys
 * nextRoad       — pick the outgoing Road that follows the vehicle's route
 */
(function (TT) {
  'use strict';

  /*
   * Build a navigation graph from the builder model's current grid state.
   * Returns: { [nodeKey]: [neighbourNodeKey, ...] }
   * Only includes edges where hasRoad === true.
   */
  function buildNavGraph(roads) {
    const graph = {};
    function ensure(k) { if (!graph[k]) graph[k] = []; }

    for (const road of roads) {
      if (!road._nkFrom || !road._nkTo) continue; // skip roundabout arc internals
      ensure(road._nkFrom);
      ensure(road._nkTo);
      // Add a directed arc for every outgoing connection this road has.
      // This mirrors exactly what nextRoad will match at runtime.
      for (const out of road.outgoing) {
        if (out._nkTo) graph[road._nkTo].push(out._nkTo);
      }
    }
    return graph;
  }

  /*
   * BFS from fromNode to toNode over the nav graph.
   * Returns an array of node keys [fromNode, ..., toNode], or null if no path.
   */
  function findRoute(navGraph, fromNode, toNode) {
    if (fromNode === toNode) return [fromNode];
    const visited = new Set([fromNode]);
    const queue = [[fromNode, [fromNode]]];
    while (queue.length) {
      const [cur, path] = queue.shift();
      for (const nb of (navGraph[cur] || [])) {
        if (nb === toNode) return [...path, nb];
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push([nb, [...path, nb]]);
        }
      }
    }
    return null;
  }

  /*
   * Pick the next Road for a vehicle to take at a transfer point.
   * If the vehicle has a route, find the outgoing road whose _nkTo matches
   * the next waypoint. Returns null to fall back to random selection.
   *
   * vehicle    — the Vehicle being transferred
   * outgoing   — array of candidate Road objects (already filtered for room)
   */
  function nextRoad(vehicle, outgoing) {
    if (!vehicle.route || !vehicle.route.length) return null;
    const target = vehicle.route[0];
    const match = outgoing.find(r => r._nkTo === target);
    if (match) {
      vehicle.route.shift(); // consume the waypoint
      return match;
    }
    return null; // fall back to random
  }

  TT.router = { buildNavGraph, findRoute, nextRoad };
})(window.TT);
