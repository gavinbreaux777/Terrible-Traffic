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
    let builderMode = false;

    const statsEl = document.getElementById('stats');
    const playBtn = document.getElementById('playPause');
    const resetBtn = document.getElementById('reset');
    const disturbBtn = document.getElementById('disturb');
    const playBtnBuild = document.getElementById('playPauseBuild');
    const resetBtnBuild = document.getElementById('resetBuild');
    const disturbBtnBuild = document.getElementById('disturbBuild');
    const scenarioSel = document.getElementById('scenario');
    const scenarioTabBtn = document.getElementById('tabScenario');
    const buildTabBtn = document.getElementById('tabBuild');
    const builderToolbar = document.getElementById('builderToolbar');
    const scenarioPanel = document.getElementById('scenarioPanel');

    // Populate the scenario dropdown straight from the registry, so adding a
    // scenario in scenarios.js makes it appear here with no edits.
    for (const name in TT.scenarios) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = TT.scenarios[name].label;
      scenarioSel.appendChild(opt);
    }
    scenarioSel.value = sim.scenarioName;

    const scenarioDef = () => builderMode
      ? { caps: ['spawns'], disturb: true }
      : TT.scenarios[sim.scenarioName];

    const onControlChange = (key) => {
      if (key === 'carCount' && scenarioDef().caps.includes('fixedCount')) sim.reset();
    };

    function syncPlayLabel() {
      const label = running ? 'Pause' : 'Play';
      playBtn.textContent = label;
      playBtnBuild.textContent = label;
    }

    function refreshPanel() {
      TT.ui.buildControls(params, onControlChange, scenarioDef());
      const showDisturb = scenarioDef().disturb;
      disturbBtn.style.display = showDisturb ? '' : 'none';
      disturbBtnBuild.style.display = showDisturb ? '' : 'none';
    }
    refreshPanel();

    // Builder mode: rebuild sim from the current grid state.
    function rebuild() {
      TT.builderWorld.apply(sim);
      refreshPanel();
    }

    // Mode toggle
    function enterBuilderMode() {
      builderMode = true;
      scenarioPanel.style.display = 'none';
      builderToolbar.style.display = '';
      scenarioTabBtn.classList.remove('active');
      buildTabBtn.classList.add('active');
      TT.builderUI.attach(canvas, TT.builderModel, rebuild, () => renderer._lastTransform);
      rebuild();
    }

    function enterScenarioMode() {
      builderMode = false;
      TT.builderUI.detach(canvas);
      scenarioPanel.style.display = '';
      builderToolbar.style.display = 'none';
      scenarioTabBtn.classList.add('active');
      buildTabBtn.classList.remove('active');
      sim.build(scenarioSel.value);
      refreshPanel();
    }

    scenarioTabBtn.addEventListener('click', () => { if (builderMode) enterScenarioMode(); });
    buildTabBtn.addEventListener('click', () => { if (!builderMode) enterBuilderMode(); });

    // Tool palette
    document.querySelectorAll('[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        TT.builderUI.setTool(btn.dataset.tool);
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    function togglePlay() {
      running = !running;
      syncPlayLabel();
      if (running) last = performance.now();
    }
    function doReset() { if (builderMode) rebuild(); else sim.reset(); }
    function doDisturb() { sim.disturb(); }

    playBtn.addEventListener('click', togglePlay);
    playBtnBuild.addEventListener('click', togglePlay);
    resetBtn.addEventListener('click', doReset);
    resetBtnBuild.addEventListener('click', doReset);
    disturbBtn.addEventListener('click', doDisturb);
    disturbBtnBuild.addEventListener('click', doDisturb);

    scenarioSel.addEventListener('change', () => {
      sim.build(scenarioSel.value);
      refreshPanel();
    });

    // Start in scenario mode with the tab marked active.
    scenarioTabBtn.classList.add('active');

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
