/*
 * Entry point: wires the simulation, renderer and UI together and runs the
 * animation loop. Uses a fixed sub-step so the IDM integration stays stable
 * regardless of frame rate or the time-scale slider.
 */
(function (TT) {
  'use strict';

  const MAX_SUBSTEP = 0.04; // seconds of sim time per integration step
  const MAX_FRAME = 0.1;    // clamp real frame dt (e.g. after a tab switch)

  window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const params = TT.defaults();
    const sim = new TT.Simulation(params);
    const renderer = new TT.Renderer(canvas);

    let running = true;
    let last = performance.now();
    let statAccum = 0;

    const statsEl = document.getElementById('stats');
    const playBtn = document.getElementById('playPause');
    const resetBtn = document.getElementById('reset');
    const disturbBtn = document.getElementById('disturb');
    const scenarioSel = document.getElementById('scenario');

    // Populate the scenario dropdown straight from the registry, so adding a
    // scenario in scenarios.js makes it appear here with no edits.
    for (const name in TT.scenarios) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = TT.scenarios[name].label;
      scenarioSel.appendChild(opt);
    }
    scenarioSel.value = sim.scenarioName;

    const scenarioDef = () => TT.scenarios[sim.scenarioName];

    const onControlChange = (key) => {
      // Changing how many cars sit on the ring means rebuilding the loop.
      if (key === 'carCount' && scenarioDef().caps.includes('fixedCount')) sim.reset();
    };

    function refreshPanel() {
      TT.ui.buildControls(params, onControlChange, scenarioDef());
      disturbBtn.style.display = scenarioDef().disturb ? '' : 'none';
    }
    refreshPanel();

    playBtn.addEventListener('click', () => {
      running = !running;
      playBtn.textContent = running ? 'Pause' : 'Play';
      if (running) last = performance.now();
    });

    resetBtn.addEventListener('click', () => sim.reset());
    disturbBtn.addEventListener('click', () => sim.disturb());

    scenarioSel.addEventListener('change', () => {
      sim.build(scenarioSel.value);
      refreshPanel();
    });

    function frame(now) {
      let dt = (now - last) / 1000;
      last = now;
      if (dt > MAX_FRAME) dt = MAX_FRAME;

      if (running) {
        let simSeconds = dt * params.timeScale;
        while (simSeconds > 1e-4) {
          const step = Math.min(MAX_SUBSTEP, simSeconds);
          sim.step(step);
          simSeconds -= step;
        }
        statAccum += dt;
      }

      renderer.render(sim);

      if (statAccum >= 0.2) {
        statAccum = 0;
        TT.ui.renderStats(statsEl, sim.stats());
      }

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  });
})(window.TT);
