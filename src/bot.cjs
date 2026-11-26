/*
 * SOL DUNK — human-like autopilot.
 *
 * Used by the simulator to measure how players of different skill fare, and by the
 * lobby attract mode (skill "perfect"). It plans the "final drop" into the next rim
 * with a single-tap trajectory solve, cruises above the rim otherwise, and adds the
 * kinds of error real players make: tap timing jitter, aim error (where along the rim
 * they drop), misjudging moving rims, and the occasional lapse.
 */
(function (root, factory) {
  const B = factory(root.DunkEngine || (typeof require === 'function' ? require('./engine.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = B;
  else root.DunkBot = B;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';
  const P = E.PHYS, W = E.WORLD, DT = E.DT;

  // Skill presets. timing = tap jitter (s, sd); aim = drop-point error (units, sd);
  // tail = share of hoops with a much bigger aim error; lapse = chance per hoop of a
  // badly mistimed final tap; moveK/tiltK = extra aim error on moving / tilted rims.
  const SKILLS = {
    novice:  { timing: 0.085, aim: 22,  tail: 0.20, tailK: 2.2, lapse: 0.040, phase: 0.15, moveK: 1.0, tiltK: 0.9, cruise: 40, cruiseSd: 15, minGap: 0.15, commit: 0.17 },
    casual:  { timing: 0.068, aim: 18,  tail: 0.16, tailK: 2.1, lapse: 0.022, phase: 0.11, moveK: 0.9, tiltK: 0.8, cruise: 38, cruiseSd: 12, minGap: 0.14, commit: 0.16 },
    average: { timing: 0.055, aim: 15,  tail: 0.12, tailK: 2.0, lapse: 0.012, phase: 0.085, moveK: 0.8, tiltK: 0.7, cruise: 36, cruiseSd: 10, minGap: 0.13, commit: 0.15 },
    good:    { timing: 0.042, aim: 11,  tail: 0.10, tailK: 2.0, lapse: 0.006, phase: 0.06, moveK: 0.7, tiltK: 0.6, cruise: 35, cruiseSd: 8, minGap: 0.12, commit: 0.15 },
    pro:     { timing: 0.030, aim: 8,   tail: 0.08, tailK: 1.9, lapse: 0.003, phase: 0.04, moveK: 0.6, tiltK: 0.5, cruise: 34, cruiseSd: 6, minGap: 0.11, commit: 0.14 },
    perfect: { timing: 0, aim: 0, tail: 0, tailK: 1, lapse: 0, phase: 0, moveK: 0, tiltK: 0, cruise: 34, cruiseSd: 0, minGap: 0.10, commit: 0.12 }
  };
  const AIM_BIAS = 3; // aim slightly toward the back rim: the front rim is met at a shallower angle

  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * v);
  }

  function createBot(skill, rng) {
    const p = typeof skill === 'string' ? SKILLS[skill] : skill;
    return { p, rng, sched: -1, lastTap: -1000, key: -1, aimDX: 0, aimDY: 0, phaseErr: 0, cruise: 36, lapse: false, lapseShift: 0, h: null, fine: p.timing === 0, wall: null, wm: 0, schedWall: null };
  }

  // Walls (special courses): the wall between the ball and the ring it's heading for, as the height the ball's
  // centre has to stay above (hi) while it overlaps it. How much room the player leaves (WALL_ROOM, give or take) is
  // judged afresh for each wall, worse for weaker players, so they clip one now and then. A level without walls
  // never gets here, and draws no random numbers for it.
  const WALL_ROOM = 12, WALL_SD = 0.6, WALL_DT = 1.2;
  function wallGuard(bot, st, h) {
    const ws = st.walls;
    if (!ws || st.wi >= ws.length) return null;
    const w = ws[st.wi];
    if (w.x0 >= h.x || st.ball.x - P.R > w.x1) return null; // it's past the ring ahead (or behind the ball)
    if (bot.wall !== w) { bot.wall = w; bot.wm = WALL_ROOM + (bot.p.cruiseSd ? gauss(bot.rng) * bot.p.cruiseSd * WALL_SD : 0); }
    return { xa: w.x0 - P.R, xb: w.x1 + P.R, hi: w.y0 - P.R - bot.wm, dt: bot.p.timing * WALL_DT };
  }
  // a free fall from (x, y, vy): is it clear of the wall between the times t0 and t1 from now?
  function fallClear(g, x, y, vy, vx, t0, t1) {
    const ta = Math.max(t0, (g.xa - x) / vx), tb = Math.min(t1, (g.xb - x) / vx);
    if (tb <= ta) return true;
    const ya = y + vy * ta + 0.5 * P.G * ta * ta, yb = y + vy * tb + 0.5 * P.G * tb * tb;
    return ya <= g.hi && yb <= g.hi; // a fall curves downward, so it's lowest at one end or the other
  }
  // tap in tk seconds, then fall: clear of the wall all the way? A player knows their taps land a little early or
  // late (g.dt, from their timing), and only takes a line that clears either way.
  function tapClear(g, b, vx, tk) {
    if (!g) return true;
    for (let j = -1; j <= 1; j++) {
      const t = Math.max(0, tk + j * g.dt);
      if (!fallClear(g, b.x, b.y, b.vy, vx, 0, t)) return false;
      if (!fallClear(g, b.x + vx * t, b.y + b.vy * t + 0.5 * P.G * t * t, -P.FLAP, vx, 0, 1e9)) return false;
      if (!g.dt) break;
    }
    return true;
  }

  function perceivedY(bot, t) { return E.hoopY(bot.h, t + bot.phaseErr) + bot.aimDY; }

  function acquire(bot, st, h) {
    const p = bot.p, rng = bot.rng;
    bot.key = st.next; bot.h = h;
    // average vertical rim speed, used to scale error on moving rims
    const mv = h.amp ? (h.amp * 3.0 / h.period) : 0;
    const tiltDeg = Math.abs(h.tilt) * 57.29577951308232;
    const speedK = st.speed / 165;
    let sd = p.aim * speedK * (1 + p.moveK * mv / 100) * (1 + p.tiltK * tiltDeg / 20);
    if (p.tail && rng() < p.tail) sd *= p.tailK;
    bot.aimDX = AIM_BIAS + (sd ? gauss(rng) * sd : 0);
    bot.aimDY = 0; // height misjudgement barely moves the drop point; aim error covers it
    bot.phaseErr = p.phase && h.amp ? gauss(rng) * p.phase : 0;
    bot.cruise = p.cruise + (p.cruiseSd ? gauss(rng) * p.cruiseSd : 0);
    bot.lapse = p.lapse > 0 && rng() < p.lapse;
    bot.lapseShift = (rng() < 0.5 ? -1 : 1) * (0.09 + 0.12 * rng());
    bot.tiltSeen = true;
  }

  // Best single "final" tap: tap in k ticks, then free-fall through the rim.
  function planFinal(bot, st, vx, guard) {
    const b = st.ball, h = bot.h, t0 = st.tick * DT;
    const aimX = h.x + bot.aimDX * h.c;
    const tn = bot.tiltSeen ? h.s / h.c : 0;
    const stepK = bot.fine ? 1 : 2;
    let best = null;
    for (let k = 0; k <= 100; k += stepK) {
      const tk = k * DT;
      let yk;
      const vyk = b.vy + P.G * tk;
      if (vyk > P.VMAX) { const tc = (P.VMAX - b.vy) / P.G; yk = b.y + b.vy * tc + 0.5 * P.G * tc * tc + P.VMAX * (tk - tc); }
      else yk = b.y + b.vy * tk + 0.5 * P.G * tk * tk;
      if (yk > W.FLOOR - P.R - 6) break;
      const xk = b.x + vx * tk;
      if (xk > aimX - 8) break;
      if (yk - (P.FLAP * P.FLAP) / (2 * P.G) < P.R + 2) continue; // would bonk the ceiling
      if (guard && !tapClear(guard, b, vx, tk)) continue;           // would clip the wall on the way
      let hy = perceivedY(bot, t0 + tk + 0.35) + (aimX - h.x) * tn, s = NaN, xc = aimX;
      const iters = (h.amp || tn) ? 4 : 1;
      for (let it = 0; it < iters; it++) {
        const disc = P.FLAP * P.FLAP + 2 * P.G * (hy - yk);
        if (disc < 0) { s = NaN; break; }
        s = (P.FLAP + Math.sqrt(disc)) / P.G;
        xc = xk + vx * s;
        hy = perceivedY(bot, t0 + tk + s) + (xc - h.x) * tn;
      }
      if (!(s > 0)) continue;
      const vc = -P.FLAP + P.G * s;
      const err = Math.abs(xc - aimX);
      const cost = err + (vc < 320 ? (320 - vc) * 0.08 : 0);
      if (!best || cost < best.cost) best = { k, cost, err, xc, vc };
    }
    return best;
  }

  function crossNoTap(bot, st, vx) {
    const b = st.ball, h = bot.h, t0 = st.tick * DT;
    const tn = bot.tiltSeen ? h.s / h.c : 0;
    let hy = perceivedY(bot, t0) + (b.x - h.x) * tn, s = NaN;
    const iters = (h.amp || tn) ? 4 : 1;
    for (let it = 0; it < iters; it++) {
      const disc = b.vy * b.vy + 2 * P.G * (hy - b.y);
      if (disc < 0) { s = NaN; break; }
      s = (-b.vy + Math.sqrt(disc)) / P.G;
      hy = perceivedY(bot, t0 + s) + (b.x + vx * s - h.x) * tn;
    }
    if (!(s > 0)) return null;
    return { xc: b.x + vx * s, vc: b.vy + P.G * s };
  }

  function schedule(bot, st, k, final) {
    const p = bot.p;
    let jit = p.timing ? gauss(bot.rng) * p.timing : 0;
    if (final && bot.lapse) { jit += bot.lapseShift; bot.lapse = false; }
    const when = st.tick + k + Math.round(jit / DT);
    if (when <= st.tick) { bot.lastTap = st.tick; return true; }
    bot.sched = when;
    return false;
  }

  // Decide whether to tap on the tick that is about to run (index st.tick).
  function decide(bot, st) {
    if (st.done) return false;
    const p = bot.p;
    if (bot.sched >= 0 && bot.key !== st.next) bot.sched = -1; // target scored: drop the stale tap
    // a tap planned to hold the ball over a wall isn't needed once the wall is behind it
    if (bot.sched >= 0 && bot.schedWall) { if (st.ball.x - P.R > bot.schedWall.x1) bot.sched = -1; if (bot.sched < 0) bot.schedWall = null; }
    if (bot.sched >= 0) {
      if (st.tick >= bot.sched) { bot.sched = -1; bot.schedWall = null; bot.lastTap = st.tick; return true; }
      return false;
    }
    if ((st.tick - bot.lastTap) * DT < p.minGap) return false;
    if (!bot.fine && (st.tick & 1)) return false; // humans decide ~60x/s, not 120x/s
    const h = st.hoops[st.next];
    if (!h) return false;
    if (bot.key !== st.next) acquire(bot, st, h);
    const b = st.ball;
    const vx = b.vx < st.speed * 0.85 ? (b.vx + st.speed) * 0.5 : st.speed;
    const aimX = h.x + bot.aimDX * h.c;
    const horizon = Math.round(p.commit / DT);

    // already on a line into the rim? then just wait
    const guard = st.walls && st.walls.length ? wallGuard(bot, st, h) : null;
    const nt = crossNoTap(bot, st, vx);
    const fin = planFinal(bot, st, vx, guard);
    if (nt && nt.vc > 150 && (!guard || fallClear(guard, b.x, b.y, b.vy, vx, 0, 1e9))) {
      const e = Math.abs(nt.xc - aimX);
      if (e <= 10 || (fin && e <= fin.err + 3)) return false;
      if (nt.xc > aimX && (!fin || fin.xc > aimX)) return false; // too high: taps only make it later
    }
    if (fin && fin.err < 12) {
      if (fin.k <= horizon) return schedule(bot, st, fin.k, true);
      return false;
    }
    // cruise: keep the ball a little above the rim until the drop lines up
    const hyNow = perceivedY(bot, st.tick * DT);
    // close to the rim and above it, or already past its centre: a tap can only hurt
    if (b.x > aimX - 60 && b.y < hyNow - P.R) return false;
    if (b.x > h.x - 6 && b.y < hyNow + P.R) return false;
    let yc = hyNow - bot.cruise;
    let forWall = null;
    if (guard && guard.hi - 6 < yc) { yc = guard.hi - 6; forWall = bot.wall; } // a wall first: hold the line above its top
    if (yc < P.R + 30) yc = P.R + 30;
    if (b.vy < 0 && b.y < yc + 40) return false; // still rising
    let tau;
    if (b.y >= yc) tau = 0;
    else {
      const disc = b.vy * b.vy + 2 * P.G * (yc - b.y);
      tau = (-b.vy + Math.sqrt(disc)) / P.G;
    }
    const k = Math.round(tau / DT);
    if (k <= horizon) { const now = schedule(bot, st, k, false); bot.schedWall = now ? null : forWall; return now; }
    return false;
  }

  return { SKILLS, createBot, decide, gauss, AIM_BIAS };
});
