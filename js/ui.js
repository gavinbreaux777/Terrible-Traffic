/*
 * Builds the control panel from TT.controlGroups and keeps it in sync with the
 * live params object. Sliders mutate params in place so the running simulation
 * reacts immediately; onChange lets main.js handle anything that needs more
 * than a value tweak (e.g. repopulating the ring when the car count changes).
 */
(function (TT) {
  'use strict';

  // Rebuilds the panel for the active scenario. A slider tagged with a `cap`
  // only shows when the scenario declares that capability, so each scenario
  // shows just the controls that actually affect it.
  function buildControls(params, onChange, scenarioDef) {
    const caps = new Set((scenarioDef && scenarioDef.caps) || []);
    for (const containerId in TT.controlGroups) {
      const container = document.getElementById(containerId);
      if (!container) continue;
      container.innerHTML = '';
      for (const def of TT.controlGroups[containerId]) {
        if (def.cap && !caps.has(def.cap)) continue;
        container.appendChild(buildSlider(def, params, onChange));
      }
    }
  }

  function buildSlider(def, params, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';

    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = def.label;
    const val = document.createElement('span');
    val.className = 'val';
    row.append(name, val);

    // Styled hover definition shown when the row is hovered.
    if (def.desc) {
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = def.desc;
      wrap.appendChild(tip);
    }

    const input = document.createElement('input');
    input.type = 'range';
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
    input.value = params[def.key];

    const sync = () => { val.textContent = def.fmt(params[def.key]); };
    input.addEventListener('input', () => {
      params[def.key] = parseFloat(input.value);
      sync();
      if (onChange) onChange(def.key, params[def.key]);
    });
    sync();

    wrap.append(row, input);
    return wrap;
  }

  function renderStats(el, s) {
    const rows = [
      ['Cars', s.cars],
      ['Avg speed', Math.round(s.avgSpeed * 3.6) + ' km/h'],
      ['Stopped', s.stopped],
      ['Sim time', s.time.toFixed(0) + ' s'],
    ];
    if (s.hasThroughput) rows.push(['Throughput', s.throughput.toFixed(1) + '/min']);
    el.innerHTML = rows
      .map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`)
      .join('');
  }

  TT.ui = { buildControls, renderStats };
})(window.TT);
