/* Global namespace. Every other file hangs things off of this. */
window.TT = window.TT || {};

/*
 * Default simulation parameters. These are the live values the IDM driver
 * model and the world builders read from. Sliders in the UI mutate this same
 * object, so changes take effect immediately on the running simulation.
 *
 * Units are SI: meters, seconds, m/s, m/s^2.
 */
TT.defaults = function () {
  return {
    // --- Driver model (Intelligent Driver Model) ---
    desiredSpeed: 16,     // v0  ~58 km/h, free-flow target speed
    timeHeadway: 1.4,     // T   safe following time gap
    minGap: 2.0,          // s0  bumper-to-bumper gap at standstill
    maxAccel: 1.2,        // a   comfortable acceleration
    comfortBrake: 2.2,    // b   comfortable deceleration
    // --- Traffic ---
    carCount: 28,         // ring scenario: number of cars on the loop
    spawnRate: 0.55,      // intersection scenario: cars/sec per entry arm
    gapAccept: 2.6,       // roundabout: smallest time gap (s) a car will enter into
    vehicleLength: 5,     // car body length
    // --- Simulation ---
    timeScale: 1.0,       // wall-clock multiplier
  };
};

/*
 * Slider definitions, grouped to match the panel sections. The UI builds
 * controls from these. `key` indexes into the params object above.
 *
 * `desc` is the hover tooltip shown for each slider. `cap` (optional) names a
 * capability a scenario must declare for the slider to apply; omit it to show
 * the slider in every scenario. Scenarios declare their capabilities in
 * scenarios.js, so a new scenario automatically gets the right sliders.
 */
TT.controlGroups = {
  trafficControls: [
    { key: 'carCount',     label: 'Cars',               min: 1,   max: 80,  step: 1,    fmt: v => v,
      cap: 'fixedCount',
      desc: 'How many cars are placed on the loop. Changing this rebuilds the ring with the cars spaced out evenly.' },
    { key: 'spawnRate',    label: 'Spawn rate',         min: 0,   max: 1.5, step: 0.05, fmt: v => v.toFixed(2) + '/s',
      cap: 'spawns',
      desc: 'How often new cars enter from each approach arm. Higher values flood the junction and build queues.' },
    { key: 'gapAccept',    label: 'Gap acceptance',     min: 0.5, max: 5,   step: 0.1,  fmt: v => v.toFixed(1) + ' s',
      cap: 'yield',
      desc: 'Smallest gap in circulating traffic an entering car will accept. Lower = bolder merges; higher = cars wait for bigger gaps.' },
    { key: 'vehicleLength',label: 'Car length',         min: 3,   max: 12,  step: 0.5,  fmt: v => v + ' m',
      desc: 'Bumper-to-bumper length of each car. Longer cars take up more road and pack less densely.' },
  ],
  driverControls: [
    { key: 'desiredSpeed', label: 'Desired speed',      min: 2,   max: 40,  step: 1,    fmt: v => Math.round(v * 3.6) + ' km/h',
      desc: 'Free-flow target speed (v0): how fast cars drive when nothing is in their way.' },
    { key: 'timeHeadway',  label: 'Following time',     min: 0.3, max: 3.0, step: 0.1,  fmt: v => v.toFixed(1) + ' s',
      desc: 'Safe time gap (T) drivers keep to the car ahead. Lower = tailgating, which makes phantom jams worse.' },
    { key: 'minGap',       label: 'Standstill gap',     min: 0.5, max: 6,   step: 0.5,  fmt: v => v.toFixed(1) + ' m',
      desc: 'Bumper-to-bumper distance (s0) kept when fully stopped in a queue.' },
    { key: 'maxAccel',     label: 'Acceleration',       min: 0.3, max: 4,   step: 0.1,  fmt: v => v.toFixed(1) + ' m/s²',
      desc: 'Comfortable acceleration (a): how briskly cars speed up toward their desired speed.' },
    { key: 'comfortBrake', label: 'Braking',            min: 0.5, max: 6,   step: 0.1,  fmt: v => v.toFixed(1) + ' m/s²',
      desc: 'Comfortable deceleration (b): how hard cars brake when closing on the car ahead.' },
  ],
  simControls: [
    { key: 'timeScale',    label: 'Time scale',         min: 0.1, max: 5,   step: 0.1,  fmt: v => v.toFixed(1) + '×',
      desc: 'Wall-clock multiplier. Speed simulated time up or slow it down without changing the physics.' },
  ],
};
