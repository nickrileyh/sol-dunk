/* SOL DUNK special level: shared by the browser, the server and the simulator.
 *
 * One special a day (UTC), the same for everyone: a long level with a twist, such as every ring moving or every rim
 * leaning. Each attempt gets a fresh layout from its own provably fair seed, so nobody can learn a course by heart.
 * The player pays a fixed entry; clearing every ring pays a fixed prize. Missing any ring loses the entry.
 *
 * Prizes come from the simulator (node sim/special.cjs): a good player gets back at most 97% of their entries on
 * average, an average one far less. Strong players (the simulator's "pro") can come out ahead, as on deep levels of
 * the regular tables; the server keeps accounts it limits for beating the house out of specials.
 *
 * The special is one level made like the engine's (same physics, ring band and climb budget), with more rings and its
 * own settings; the last ring is the finish. engine.createState / step / replay play it like any other level.
 */
(function (root, factory) {
  const S = factory(root.DunkEngine || (typeof require === 'function' ? require('./engine.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.DunkSpecial = S;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const ENTRY = 0.05;        // entry in SOL (the server can set its own)
  const DAY_MS = 86400000;
  const DEG = 3.141592653589793 / 180;
  // the same as in the engine's generateLevel: where the ball starts, and how much climbing a gap can ask for
  const START_Y = 300, CLIMB_RATE = 350, DROP_TIME = 0.45, CLIMB_MARGIN = 40;

  // The recipes. base = [tier, level] whose pace, spacing, ring width and height changes it starts from; n = rings;
  // set = settings that replace the base's (as in engine levelConfig); narrow = ring width taken off (units);
  // shape = how ring heights are chosen ('walk' like a normal level, 'zigzag' high-low, 'wave' a rolling line);
  // lean = 'alt' tilts alternate left and right.
  const RECIPES = [
    { id: 'gauntlet', name: 'The gauntlet', blurb: 'Every ring moves', n: 14, base: [2, 5], set: { moveP: 1, moveAmp: 46 } },
    { id: 'tilt', name: 'Tilt alley', blurb: 'Every rim leans, left then right', n: 16, base: [3, 4], set: { tiltP: 1, tiltMax: 14, moveP: 0.3 }, lean: 'alt' },
    { id: 'zigzag', name: 'Zigzag', blurb: 'High ring, low ring, all the way', n: 15, base: [3, 4], set: { moveP: 0.4 }, shape: 'zigzag' },
    { id: 'needle', name: 'Needle', blurb: 'Tight rims, nothing moves', n: 18, base: [3, 5], set: { moveP: 0, tiltP: 0 }, narrow: 14 },
    { id: 'marathon', name: 'Marathon', blurb: 'Eighteen rings without a miss', n: 18, base: [1, 6] },
    { id: 'wave', name: 'The wave', blurb: 'Rings ride a rolling line', n: 17, base: [3, 4], set: { moveP: 0.8, moveAmp: 44 }, shape: 'wave' },
    { id: 'express', name: 'Express', blurb: 'A quicker ball, rings spread to match', n: 14, base: [2, 4], fast: 1.25 }
  ];
  const BY = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

  // @@PRIZES@@ written by node sim/special.cjs --write: prize (× entry) per recipe, and the share of attempts that
  // clear it for [casual, average, good, pro] players. Don't edit by hand.
  const PRIZES = {
    gauntlet: { x: 2.65, p: [0.0367, 0.1148, 0.3583, 0.6509] },
    tilt: { x: 2.85, p: [0.0222, 0.0893, 0.3314, 0.6732] },
    zigzag: { x: 2.75, p: [0.0469, 0.1238, 0.3413, 0.5909] },
    needle: { x: 2.35, p: [0.0464, 0.1361, 0.3988, 0.7386] },
    marathon: { x: 2.7, p: [0.0295, 0.1023, 0.3466, 0.6419] },
    wave: { x: 2.95, p: [0.023, 0.0886, 0.3212, 0.6562] },
    express: { x: 2.65, p: [0.0359, 0.1125, 0.3539, 0.6834] }
  }; // engine v12, 20000 attempts each, 2026-11-24
  // @@END@@

  // the recipe's settings: the base level's, changed as the recipe says
  function config(R) {
    const C = E.levelConfig(R.base[0], R.base[1]);
    if (R.set) Object.assign(C, R.set);
    if (R.fast) { C.speed *= R.fast; C.spacing *= R.fast; C.firstX *= R.fast; } // faster, and the rings spread with it
    if (R.narrow) C.hoopW -= R.narrow;
    return C;
  }

  // One special level from a seed: the same shape of object as engine.generateLevel, with more rings.
  function generate(seed, recipe) {
    const R = typeof recipe === 'string' ? BY[recipe] : recipe;
    const C = config(R), rng = E.makeRng('special|' + seed + '|' + R.id);
    const hoops = [], n = R.n, mid = (E.Y_MIN + E.Y_MAX) / 2, half = (E.Y_MAX - E.Y_MIN) / 2;
    let x = C.firstX, prevY = START_Y;
    const wPhase = rng(), wLen = 5 + Math.floor(rng() * 3); // the wave's starting point and length (rings)
    for (let i = 0; i < n; i++) {
      // a fixed number of draws per ring, as in the engine
      const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng(), r7 = rng(), r8 = rng(), r9 = rng();
      let gap = C.firstX;
      if (i > 0) { gap = C.spacing * (0.92 + 0.16 * r9); x += gap; }
      let amp = 0, period = 1, phase = 0;
      if (r2 < C.moveP) { amp = C.moveAmp * (0.75 + 0.25 * r3); period = C.periodBase * (0.85 + 0.3 * r4); phase = r5; }
      let y;
      if (R.shape === 'zigzag') y = i % 2 ? E.Y_MIN + 10 + r1 * 40 : E.Y_MAX - 10 - r1 * 40;
      else if (R.shape === 'wave') y = mid + half * 0.8 * E.wave(wPhase + i / wLen) + (r1 * 2 - 1) * 14;
      else {
        y = i === 0 ? 320 + (r1 * 2 - 1) * 45 : prevY + (r1 * 2 - 1) * C.dy;
        if (y < E.Y_MIN) y = E.Y_MIN + (E.Y_MIN - y) * 0.5;
        if (y > E.Y_MAX) y = E.Y_MAX - (y - E.Y_MAX) * 0.5;
      }
      // never ask for more climbing than perfect play can deliver in the time available
      const T = gap / C.speed;
      let maxUp = CLIMB_RATE * (T - DROP_TIME) - CLIMB_MARGIN;
      if (maxUp < 30) maxUp = 30;
      if (prevY - (y - amp) > maxUp) y = prevY - maxUp + amp;
      if (y - amp < E.Y_MIN) y = E.Y_MIN + amp;
      if (y + amp > E.Y_MAX) y = E.Y_MAX - amp;
      let tilt = 0;
      if (r6 < C.tiltP) tilt = (R.lean === 'alt' ? (i % 2 ? 1 : -1) : r7 < 0.5 ? -1 : 1) * C.tiltMax * (0.6 + 0.4 * r8) * DEG;
      hoops.push({ i, x, y0: y, w: C.hoopW, amp, period, phase, tilt, c: E.dcos(tilt), s: E.dsin(tilt), cp: i === n - 1 });
      prevY = y;
    }
    return { seed: String(seed), di: R.base[0], L: 0, special: R.id, speed: C.speed, startY: START_Y, hoops, endX: x + C.spacing };
  }

  // the day's special: every recipe once per cycle, in a shuffled order, no repeat two days running
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayStart = (day) => Date.parse(String(day).slice(0, 10) + 'T00:00:00Z');
  const closesAt = (day) => dayStart(day) + DAY_MS;
  const EPOCH = Date.UTC(2026, 0, 5);
  function order(cycle) {
    const a = RECIPES.slice(), r = E.makeRng('specialcycle|' + cycle);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function recipeFor(day) {
    const L = RECIPES.length, k = Math.floor((dayStart(day) - EPOCH) / DAY_MS);
    const cycle = Math.floor(k / L), pos = ((k % L) + L) % L, a = order(cycle);
    if (a[0] === order(cycle - 1)[L - 1]) { const t = a[0]; a[0] = a[1]; a[1] = t; }
    return a[pos];
  }
  const prizeOf = (id) => (PRIZES[id] ? PRIZES[id].x : 0);

  return { ENTRY, DAY_MS, START_Y, RECIPES, BY, PRIZES, config, generate, dayKey, dayStart, closesAt, recipeFor, prizeOf };
});
