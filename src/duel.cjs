/* SOL DUNK duels: shared by the browser, the server and the tests.
 *
 * Two players, one course, the same rings for both from one provably fair seed. Each pays the entry; whoever gets
 * further takes the pot, and the house keeps RAKE of every entry whoever wins. The house never takes a side, so a
 * duel earns the same from every pair of players however good they are.
 *
 * The course is sudden death: it starts wide and still and gets harder ring by ring (tighter rims, then moving and
 * leaning rings, bigger steps between them), so someone always falls. The ball's speed never changes, so the time
 * between rims is the same from the first ring to the last.
 *
 * A duel is decided only from the two verified flights (the replay of each player's taps): more rings passed wins;
 * level on rings, the higher score wins (a swish scores more than a rim hit, a swish streak more still); level on
 * both, the pot is split. The second player races the first one's flight, drawn as a ghost on the same course, so
 * a flight is always against a real one. Seeing the ghost gives nothing away that helps: there is no choice to
 * make in a duel other than to pass the next ring.
 *
 * On the server a player with nobody to race flies first and sets the mark: the next player to enter races it.
 * A mark nobody takes on within WAIT_MS is refunded in full. In the demo there are no other players, so the rival
 * is the game's own autopilot at about the player's level, and the page says so.
 */
(function (root, factory) {
  const D = factory(root.DunkEngine || (typeof require === 'function' ? require('./engine.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = D;
  else root.DunkDuel = D;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const ENTRY = 0.05;             // entry in SOL (the server can set its own)
  const RAKE = 0.1;               // the house's share of every entry
  const RINGS = 30;               // the course's length: hardly anyone sees the last ring
  const WAIT_MS = 24 * 3600000;   // a mark nobody takes on is refunded after this long
  const DEG = 3.141592653589793 / 180;
  // the same as in the engine's generateLevel: where the ball starts, and how much climbing a gap can ask for
  const START_Y = 300, CLIMB_RATE = 350, DROP_TIME = 0.45, CLIMB_MARGIN = 40;
  const SPEED = 200, SPACING = 316, FIRST_X = 320;
  const RAMP = 24;                // rings until the course is at its hardest settings; past it only the rims tighten
  const W_MIN = 62;               // no ring is tighter than this (the ball then has about 9 units to spare)
  const lerp = (a, b, t) => a + (b - a) * t;

  // the settings of ring i: easier than Easy level 1 at first, about Hard level 8 by ring RAMP
  function ringConfig(i) {
    const t = Math.min(1, i / RAMP), late = Math.max(0, i - RAMP);
    return {
      w: Math.max(W_MIN, Math.round((lerp(97, 80, t) - late * 1.5) * 10) / 10),
      moveP: i < 3 ? 0 : lerp(0.15, 1, t), moveAmp: lerp(26, 64, t), period: lerp(3.4, 2.7, t),
      tiltP: i < 5 ? 0 : lerp(0, 0.85, t), tiltMax: lerp(6, 15, t), dy: lerp(105, 210, t)
    };
  }

  // The course from a seed: the same shape of object as engine.generateLevel (a fixed number of draws per ring).
  function generate(seed, n) {
    n = n || RINGS;
    const rng = E.makeRng('duel|' + seed), hoops = [];
    let x = FIRST_X, prevY = START_Y;
    for (let i = 0; i < n; i++) {
      const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng(), r7 = rng(), r8 = rng(), r9 = rng();
      const C = ringConfig(i);
      let gap = FIRST_X;
      if (i > 0) { gap = SPACING * (0.92 + 0.16 * r9); x += gap; }
      let amp = 0, period = 1, phase = 0;
      if (r2 < C.moveP) { amp = C.moveAmp * (0.75 + 0.25 * r3); period = C.period * (0.85 + 0.3 * r4); phase = r5; }
      let y = i === 0 ? 320 + (r1 * 2 - 1) * 40 : prevY + (r1 * 2 - 1) * C.dy;
      if (y < E.Y_MIN) y = E.Y_MIN + (E.Y_MIN - y) * 0.5;
      if (y > E.Y_MAX) y = E.Y_MAX - (y - E.Y_MAX) * 0.5;
      // never ask for more climbing than perfect play can deliver in the time available
      let maxUp = CLIMB_RATE * (gap / SPEED - DROP_TIME) - CLIMB_MARGIN;
      if (maxUp < 30) maxUp = 30;
      if (prevY - (y - amp) > maxUp) y = prevY - maxUp + amp;
      if (y - amp < E.Y_MIN) y = E.Y_MIN + amp;
      if (y + amp > E.Y_MAX) y = E.Y_MAX - amp;
      let tilt = 0;
      if (r6 < C.tiltP) tilt = (r7 < 0.5 ? -1 : 1) * C.tiltMax * (0.6 + 0.4 * r8) * DEG;
      hoops.push({ i, x, y0: y, w: C.w, amp, period, phase, tilt, c: E.dcos(tilt), s: E.dsin(tilt), cp: i === n - 1 });
      prevY = y;
    }
    return { seed: String(seed), di: 0, L: 0, special: 'duel', speed: SPEED, startY: START_Y, hoops, endX: x + SPACING, maxTicks: E.TICK_HZ * (20 + 3 * n) };
  }

  // a flight's score from its ring outcomes ('S' swish, anything else a rim hit): the game's own score, without the
  // perfect-level bonus (a duel has no levels)
  function score(outcomes) {
    let s = 0, streak = 0;
    for (const o of outcomes) { if (o === 'S') { streak++; s += 2 + Math.min(4, streak - 1); } else { streak = 0; s += 1; } }
    return s;
  }
  // what a flight comes to: r is engine.replay's answer or a finished engine state
  const flight = (r) => ({ rings: r.outcomes.length, score: score(r.outcomes), cleared: r.result === 'clear' });
  // A player's flight from their taps. A player who is already past a rival who's out stops there (stop: the tick
  // they stopped at), so the flight counts only what they flew; stopping early can never add a ring.
  function fly(def, taps, stop) {
    const st = E.createState(def), n = taps.length, end = stop == null ? Infinity : stop;
    let ti = 0;
    while (!st.done && st.tick < end) {
      let tap = false;
      if (ti < n && taps[ti] === st.tick) { tap = true; ti++; }
      E.step(st, tap);
    }
    return { rings: st.outcomes.length, score: score(st.outcomes), cleared: st.result === 'clear', outcomes: st.outcomes.slice(), result: st.done ? st.result : 'stopped', ticks: st.tick, extraTaps: n - ti };
  }
  // 1 if a beat b, -1 if b beat a, 0 for a draw
  const compare = (a, b) => (a.rings !== b.rings ? (a.rings > b.rings ? 1 : -1) : a.score !== b.score ? (a.score > b.score ? 1 : -1) : 0);
  // The pot after the house's cut, in whole units of the entry's own unit (lamports on the server): 2 x entry less
  // RAKE of each. A draw splits it; an odd unit stays with the house.
  const pot = (entry) => 2 * entry - 2 * Math.round(entry * RAKE);
  function payouts(entry, cmp) {
    const p = pot(entry);
    return cmp > 0 ? { a: p, b: 0 } : cmp < 0 ? { a: 0, b: p } : { a: Math.floor(p / 2), b: Math.floor(p / 2) };
  }

  return { ENTRY, RAKE, RINGS, WAIT_MS, START_Y, SPEED, W_MIN, RAMP, ringConfig, generate, score, flight, fly, compare, pot, payouts };
});
