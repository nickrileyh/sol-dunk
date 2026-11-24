/*
 * SOL DUNK — deterministic game engine.
 *
 * Shared, byte-for-byte, by the browser game, the Monte Carlo simulator and the
 * payout server. Every run is a pure function of (level seed, tap ticks), so the
 * server can replay a player's taps and get exactly the same outcome.
 *
 * Determinism rules followed here:
 *   - fixed 120 Hz timestep, taps are integer tick indices
 *   - only + - * / Math.sqrt Math.floor Math.imul (all exactly specified by IEEE-754 / ECMAScript)
 *   - no Math.sin/cos/pow/exp (implementation-defined precision) and no `**`
 *   - seeded PRNG (cyrb128 + sfc32), integer only
 */
(function (root, factory) {
  const E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.DunkEngine = E;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 10;
  const TICK_HZ = 120;
  const DT = 1 / TICK_HZ;

  // World units: the playfield is 400 wide x 720 tall. Ball sits 112 from the left edge.
  const WORLD = { W: 400, H: 720, FLOOR: 652, CEIL: 0, BALL_SX: 112 };

  // v10: the ball and the rim tube are 10% larger than up to v9 (the owner asked for bigger ball and rims).
  // Each ring widens by exactly what keeps the gap the ball has to fit through the same as v9 (see RING_GROW),
  // so the game is as hard as before and the house edge holds. Ring widths in DIFFS are the v9 numbers.

  // Physics. Tap sets vertical velocity (classic flap), gravity pulls down.
  const PHYS = {
    G: 1350,        // gravity, units/s^2 (floaty, forgiving)
    FLAP: 470,      // upward speed after a tap (same hop height, more hang time)
    VMAX: 640,      // terminal fall speed (no sudden plunges)
    R: 18.7,        // ball radius (17 up to v9)
    RP: 7.7,        // rim tube radius: collision pegs at each end of the rim (7 up to v9)
    REST: 0.36,     // restitution off the rim (soft: rim hits often roll in)
    TFRIC: 0.2,     // tangential damping on a firm rim knock (scaled down for gentle contact)
    KNOCK: 30,      // normal speed above which a contact is a knock (bounce + rim event); below it the ball rests/rolls
    VX_K: 5.0,      // how fast forward speed recovers to level speed (1/s)
    RECOVER: 54     // ticks after a rim knock over which that push fades back in (0.45 s), so the bounce plays out
  };

  // the swish gap (rim to rim, less the ball) = w - 2*(R + RP); keep it at the v9 value (R 17, RP 7)
  const RING_GROW = Math.round(2 * (PHYS.R + PHYS.RP - 17 - 7) * 10) / 10; // 4.8

  const HOOPS_PER_LEVEL = 6;
  const LEVELS = 8;
  const MAX_TICKS = TICK_HZ * 45;   // a level can never take longer than this
  const Y_MIN = 220, Y_MAX = 540;   // rim centre band
  const FIRST_HOOP_X = 250;
  const START_Y = 300;

  // Difficulty tiers. Arrays are per level (1..8).
  // Speed grows 4% per level and the rings spread out with it (spacing and the first ring's distance
  // grow 4% too), so every level gives the same time between rims. Deeper levels get harder through
  // tighter, moving and tilted rims and bigger height changes, not through less time to react.
  const DIFFS = [
    {
      id: 'rookie', name: 'Rookie', blurb: 'Wide rings, gentle pace',
      speed: 138, spacing: 230, maxWin: 50,
      hoopW:   [93, 92, 91, 90, 89, 88, 87, 86],
      dy:      [115, 122, 129, 136, 143, 150, 157, 164],
      moveP:   [0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8],   // a few rings bob gently from level 1
      moveAmp: [22, 24, 28, 31, 34, 38, 42, 46],
      tiltP:   [0, 0, 0, 0, 0.2, 0.3, 0.4, 0.5],
      tiltMax: [0, 0, 0, 0, 8, 9, 10, 11]
    },
    {
      id: 'pro', name: 'Pro', blurb: 'The classic feel',
      speed: 148, spacing: 234, maxWin: 100,
      hoopW:   [91, 90, 89, 88, 87, 86, 85, 84],
      dy:      [120, 128, 136, 144, 152, 160, 168, 176],
      moveP:   [0, 0.3, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95],
      moveAmp: [0, 28, 34, 40, 45, 50, 55, 60],
      tiltP:   [0, 0, 0, 0.2, 0.3, 0.4, 0.5, 0.6],
      tiltMax: [0, 0, 0, 8, 10, 11, 12, 13]
    },
    {
      id: 'allstar', name: 'All-Star', blurb: 'Moving rings',
      speed: 160, spacing: 238, maxWin: 250,
      hoopW:   [87, 85, 83, 82, 81, 80, 79, 78],
      dy:      [140, 152, 164, 174, 182, 190, 198, 206],
      moveP:   [0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
      moveAmp: [0, 35, 40, 45, 50, 55, 60, 64],
      tiltP:   [0, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      tiltMax: [0, 0, 8, 10, 11, 12, 13, 14]
    },
    {
      id: 'legend', name: 'Legend', blurb: 'Fast and tilted',
      speed: 170, spacing: 242, maxWin: 1000,
      hoopW:   [85, 83, 81, 80, 79, 78, 77, 76],
      dy:      [150, 162, 174, 184, 192, 200, 208, 216],
      moveP:   [0.25, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1],
      moveAmp: [30, 37, 42, 47, 52, 56, 60, 64],
      tiltP:   [0, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85],
      tiltMax: [0, 9, 10, 11, 12, 13, 14, 15]
    }
  ];

  const EV = { FLAP: 1, RIM: 2, SWISH: 4, SCORE: 8, MISS: 16, FLOOR: 32, CLEAR: 64, CEIL: 128, BLOCK: 256 };

  // ---------- deterministic PRNG ----------
  function hashSeed(str) { // cyrb128
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }
  function sfc32(a, b, c, d) {
    return function () {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      let t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  function makeRng(str) {
    const s = hashSeed(String(str));
    const r = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 12; i++) r();
    return r;
  }

  // ---------- deterministic trig (small angles only, |x| < 0.6 rad) ----------
  function dsin(x) { const x2 = x * x; return x * (1 - x2 / 6 * (1 - x2 / 20 * (1 - x2 / 42 * (1 - x2 / 72)))); }
  function dcos(x) { const x2 = x * x; return 1 - x2 / 2 * (1 - x2 / 12 * (1 - x2 / 30 * (1 - x2 / 56))); }

  // Smooth triangle wave, period 1, range [-1, 1]; close to -cos(2*pi*u) but polynomial.
  function wave(u) {
    const p = u - Math.floor(u);
    const tri = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
    return tri * (1.5 - 0.5 * tri * tri);
  }
  function waveD(u) {
    const p = u - Math.floor(u);
    let tri, d;
    if (p < 0.5) { tri = 4 * p - 1; d = 4; } else { tri = 3 - 4 * p; d = -4; }
    return (1.5 - 1.5 * tri * tri) * d;
  }

  function hoopY(h, t) { return h.amp === 0 ? h.y0 : h.y0 + h.amp * wave(t / h.period + h.phase); }
  function hoopVY(h, t) { return h.amp === 0 ? 0 : h.amp * waveD(t / h.period + h.phase) / h.period; }

  // ---------- levels ----------
  function levelConfig(di, L) {
    const D = DIFFS[di], k = L - 1, stretch = 1 + 0.04 * k;
    return {
      speed: D.speed * stretch,
      spacing: D.spacing * stretch,
      firstX: FIRST_HOOP_X * stretch,
      hoopW: D.hoopW[k] + RING_GROW, dy: D.dy[k],
      moveP: D.moveP[k], moveAmp: D.moveAmp[k],
      tiltP: D.tiltP[k], tiltMax: D.tiltMax[k],
      periodBase: 3.4 - 0.1 * k
    };
  }

  function levelFeatures(di, L) {
    const C = levelConfig(di, L), C1 = levelConfig(di, 1);
    const f = [];
    if (C.moveP > 0) f.push(C.moveP >= 1 ? 'All rims move' : 'Moving rims');
    if (C.tiltP > 0) f.push('Tilted rims');
    const sp = Math.round((C.speed / C1.speed - 1) * 100);
    if (sp > 0) f.push('+' + sp + '% speed');
    if (C.hoopW < C1.hoopW) f.push('Tighter rims');
    if (!f.length) f.push('Static rims');
    return f;
  }

  // Climb budget: rapid tapping lifts the ball ~350 units/s; the drop into a rim needs ~0.45 s.
  const CLIMB_RATE = 350, DROP_TIME = 0.45, CLIMB_MARGIN = 40;

  function generateLevel(seed, di, L) {
    const C = levelConfig(di, L);
    const rng = makeRng('lvl|' + seed + '|' + di + '|' + L);
    const hoops = [];
    let x = C.firstX;
    let prevY = START_Y;
    for (let i = 0; i < HOOPS_PER_LEVEL; i++) {
      // fixed number of draws per hoop keeps layouts stable when tuning features
      const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng(), r7 = rng(), r8 = rng(), r9 = rng();
      let gap = C.firstX;
      if (i > 0) { gap = C.spacing * (0.92 + 0.16 * r9); x += gap; }
      let amp = 0, period = 1, phase = 0;
      if (r2 < C.moveP) {
        amp = C.moveAmp * (0.75 + 0.25 * r3);
        period = C.periodBase * (0.85 + 0.3 * r4);
        phase = r5;
      }
      let y = i === 0 ? 320 + (r1 * 2 - 1) * 45 : prevY + (r1 * 2 - 1) * C.dy;
      if (y < Y_MIN) y = Y_MIN + (Y_MIN - y) * 0.5;
      if (y > Y_MAX) y = Y_MAX - (y - Y_MAX) * 0.5;
      // never ask for more climbing than perfect play can deliver in the time available
      const T = gap / C.speed;
      let maxUp = CLIMB_RATE * (T - DROP_TIME) - CLIMB_MARGIN;
      if (maxUp < 30) maxUp = 30;
      if (prevY - (y - amp) > maxUp) y = prevY - maxUp + amp;
      if (y - amp < Y_MIN) y = Y_MIN + amp;
      if (y + amp > Y_MAX) y = Y_MAX - amp;
      let tilt = 0;
      if (r6 < C.tiltP) tilt = (r7 < 0.5 ? -1 : 1) * C.tiltMax * (0.6 + 0.4 * r8) * (3.141592653589793 / 180);
      hoops.push({ i, x, y0: y, w: C.hoopW, amp, period, phase, tilt, c: dcos(tilt), s: dsin(tilt), cp: i === HOOPS_PER_LEVEL - 1 });
      prevY = y;
    }
    return { seed: String(seed), di, L, speed: C.speed, startY: START_Y, hoops, endX: x + C.spacing };
  }

  // ---------- simulation ----------
  function createState(level) {
    const hs = new Array(level.hoops.length);
    for (let i = 0; i < hs.length; i++) {
      const h = level.hoops[i];
      hs[i] = { i: h.i, x: h.x, y0: h.y0, w: h.w, amp: h.amp, period: h.period, phase: h.phase, tilt: h.tilt, c: h.c, s: h.s, cp: h.cp, st: 0, touched: false };
    }
    return {
      level, hoops: hs, speed: level.speed,
      ball: { x: 0, y: level.startY, vx: level.speed, vy: 0 },
      tick: 0, next: 0, prevLy: NaN, contact: false, knockTick: -100000,
      done: false, result: null, missKind: null,
      outcomes: [], flaps: 0, rimHits: 0, impact: 0, ev: 0
    };
  }

  function miss(st, h, kind) {
    h.st = 2; st.done = true; st.result = 'miss';
    st.missKind = h.touched ? 'rimout' : kind;
  }

  function hoopInteract(st, h, t) {
    const b = st.ball, P = PHYS;
    const half = h.w * 0.5;
    if (b.x - h.x < -(half + P.R + 40)) { st.prevLy = NaN; return 0; }
    let ev = 0;
    const hy = hoopY(h, t), hvy = hoopVY(h, t);
    const c = h.c, s = h.s, mn = P.R + P.RP;

    // rim pegs (the two ends of the rim as seen from the side)
    for (let side = -1; side <= 1; side += 2) {
      const px = h.x + side * half * c, py = hy + side * half * s;
      const dx = b.x - px, dy = b.y - py, d2 = dx * dx + dy * dy;
      if (d2 < mn * mn) {
        st.contact = true;
        const d = Math.sqrt(d2) || 1e-9, nx = dx / d, ny = dy / d;
        b.x = px + nx * mn; b.y = py + ny * mn;
        const rvx = b.vx, rvy = b.vy - hvy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;
          const imp = -vn, firm = imp > P.KNOCK;
          // A knock bounces; resting or rolling contact just stops the ball sinking into the rim.
          // Friction scales with how hard the hit was, so the ball can roll off (or in) instead of
          // sticking to the edge of the rim while gravity and the forward push balance out.
          const fr = imp >= 120 ? P.TFRIC : P.TFRIC * (imp / 120) * (imp / 120);
          const vn2 = firm ? -P.REST * vn : 0, vt2 = vt * (1 - fr);
          b.vx = vn2 * nx + vt2 * tx;
          b.vy = vn2 * ny + vt2 * ty + hvy;
          if (firm || !h.touched) { st.impact = imp; st.rimHits++; ev |= EV.RIM; }
          if (firm) st.knockTick = st.tick;
          h.touched = true;
        }
      }
    }

    // hoop-local frame (x along the rim, y toward the rim's "down" side)
    const dx = b.x - h.x, dy = b.y - hy;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c;

    // score: centre crosses the rim line downward, inside the opening
    const pl = st.prevLy;
    if (pl === pl && pl < 0 && ly >= 0 && lx > -half && lx < half) {
      h.st = 1;
      st.outcomes.push(h.touched ? 'R' : 'S');
      ev |= EV.SCORE | (h.touched ? 0 : EV.SWISH);
      st.next++; st.prevLy = NaN;
      if (h.cp) { st.done = true; st.result = 'clear'; ev |= EV.CLEAR; }
      return ev;
    }

    // no net: the ball may rise up through the ring; only a downward pass scores.
    // the ring is missed once the ball is fully past its far side without scoring.
    if (lx > half + P.RP + P.R + 2) { miss(st, h, ly < 0 ? 'over' : 'under'); ev |= EV.MISS; }
    st.prevLy = ly;
    return ev;
  }

  // Advance one tick. `tap` = the player tapped at the start of this tick.
  function step(st, tap) {
    if (st.done) return 0;
    const b = st.ball, P = PHYS;
    let ev = 0;
    if (tap) { b.vy = -P.FLAP; st.flaps++; ev |= EV.FLAP; }
    b.vy += P.G * DT; if (b.vy > P.VMAX) b.vy = P.VMAX;
    // Forward flight eases back to level speed. Right after a rim knock that push fades back in
    // from zero, so a bounce keeps its own direction instead of the ball ploughing on through the rim.
    // While the ball rests on a rim the push is steady, so it can't balance on the edge.
    const since = st.tick - st.knockTick;
    const kx = since >= P.RECOVER ? P.VX_K : P.VX_K * (since / P.RECOVER);
    const onRim = st.contact; st.contact = false;
    if (onRim) { if (b.vx < st.speed) { b.vx += st.speed * (kx * DT); if (b.vx > st.speed) b.vx = st.speed; } }
    else b.vx += (st.speed - b.vx) * (kx * DT);
    b.x += b.vx * DT; b.y += b.vy * DT;
    st.tick++;
    const t = st.tick * DT;
    if (b.y < WORLD.CEIL + P.R) { b.y = WORLD.CEIL + P.R; if (b.vy < 0) b.vy = 0; ev |= EV.CEIL; }
    const h = st.hoops[st.next];
    if (h) ev |= hoopInteract(st, h, t);
    if (!st.done && b.y > WORLD.FLOOR - P.R) { st.done = true; st.result = 'floor'; ev |= EV.FLOOR; }
    if (!st.done && st.tick >= MAX_TICKS) { st.done = true; st.result = 'miss'; st.missKind = 'timeout'; ev |= EV.MISS; }
    st.ev = ev;
    return ev;
  }

  // Validate a tap list: sorted, unique, integer ticks, first tap at 0.
  function validTaps(taps) {
    if (!Array.isArray(taps) || taps.length === 0 || taps.length > 4000) return false;
    if (taps[0] !== 0) return false;
    for (let i = 0; i < taps.length; i++) {
      const v = taps[i];
      if (typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > MAX_TICKS) return false;
      if (i > 0 && v <= taps[i - 1]) return false;
    }
    return true;
  }

  // Replay a level from a tap list. Used by the server to verify a client's run.
  function replay(level, taps) {
    const st = createState(level);
    let ti = 0;
    const n = taps.length;
    while (!st.done) {
      let tap = false;
      if (ti < n && taps[ti] === st.tick) { tap = true; ti++; }
      step(st, tap);
    }
    return { result: st.result, missKind: st.missKind, outcomes: st.outcomes.slice(), ticks: st.tick, flaps: st.flaps, extraTaps: n - ti };
  }

  // ---------- payouts ----------
  // pt = PAYTABLE[di][L-1] = { rim, swish: [x1, x2, x3, x4, x5plus] }
  function hoopMultiplier(pt, outcome, streak) {
    if (outcome === 'S') return pt.swish[(streak < pt.swish.length ? streak : pt.swish.length) - 1];
    return pt.rim;
  }

  // Walk a level's outcomes from a starting total multiplier and starting swish streak
  // (the streak carries over between levels); applies the max-win cap.
  // Returns { total, streak, steps: [{o, streak, m, total}], capped, capIndex }
  function applyLevel(pt, outcomes, startTotal, cap, startStreak) {
    let total = startTotal, streak = startStreak || 0;
    const steps = [];
    for (let i = 0; i < outcomes.length; i++) {
      const o = outcomes[i];
      streak = o === 'S' ? streak + 1 : 0;
      const m = hoopMultiplier(pt, o, streak);
      total = total * m;
      if (cap && total >= cap) {
        total = cap;
        steps.push({ o, streak, m, total });
        return { total, streak, steps, capped: true, capIndex: i };
      }
      steps.push({ o, streak, m, total });
    }
    return { total, streak, steps, capped: false, capIndex: -1 };
  }

  return {
    VERSION, TICK_HZ, DT, WORLD, PHYS, HOOPS_PER_LEVEL, LEVELS, MAX_TICKS, Y_MIN, Y_MAX, DIFFS, EV,
    makeRng, hashSeed, dsin, dcos, wave, waveD, hoopY, hoopVY,
    levelConfig, levelFeatures, generateLevel, createState, step, replay, validTaps,
    hoopMultiplier, applyLevel
  };
});
