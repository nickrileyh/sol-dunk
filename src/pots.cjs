/* SOL DUNK challenge pots: shared by the browser, the server and the simulator.
 *
 * Each pot runs for one UTC day. Players pay a fixed entry into the pot, then play ordinary runs. Everyone who
 * meets the pot's challenge in a run (started after they entered, on the named tier or harder) before the pot
 * closes splits it equally. The house keeps RAKE of every entry, whoever wins, so the pot pays the house from
 * every player however skilled; the players' own runs are bets as usual. If nobody makes it, the pot rolls over
 * into the next one.
 *
 * Challenges are judged only from a run's verified ring outcomes ('S' swish, 'R' rim) per level, so the server
 * can decide them from the taps it replays, and the browser shows the same progress live.
 */
(function (root, factory) {
  const P = factory();
  if (typeof module === 'object' && module.exports) module.exports = P;
  else root.DunkPots = P;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RAKE = 0.1;               // the house's share of every entry
  const ENTRY = 0.05;             // entry in SOL (the server can set its own)
  const DAY_MS = 86400000;
  const HOOPS = 6;

  // ring points, the same as the score in the game: a rim hit 1, a swish 1 + streak (up to 6), a perfect level +10
  const ringPoints = (o, streak) => (o === 'S' ? 1 + Math.min(streak, 5) : 1);

  // The challenges. tier = the easiest tier where it counts (0 Rookie, 1 Pro, 2 All-Star, 3 Legend).
  // p = the chance one run makes it at that tier for a [casual, average, good] player, from the simulator
  // (they keep going until they bust); the demo uses it to simulate other entrants.
  const GOALS = [
    { id: 'streak10', kind: 'best', n: 10, tier: 1, text: 'Swish 10 in a row', p: [0.018, 0.083, 0.376] },
    { id: 'perfect1', kind: 'perfect', n: 1, tier: 2, text: 'Swish every ring in a level', p: [0.034, 0.103, 0.345] },
    { id: 'clear4', kind: 'clears', n: 4, tier: 2, text: 'Clear level 4', p: [0.053, 0.154, 0.416] },
    { id: 'score100', kind: 'score', n: 100, tier: 1, text: 'Score 100 in one run', p: [0.009, 0.095, 0.529] },
    { id: 'swish25', kind: 'swishes', n: 25, tier: 1, text: 'Swish 25 rings in one run', p: [0.003, 0.046, 0.39] },
    { id: 'streak8a', kind: 'best', n: 8, tier: 2, text: 'Swish 8 in a row', p: [0.013, 0.052, 0.243] },
    { id: 'perfect2', kind: 'perfect', n: 2, tier: 1, text: 'Swish every ring in two levels', p: [0.003, 0.036, 0.26] }
  ];
  const GOAL_BY = Object.fromEntries(GOALS.map((g) => [g.id, g]));
  const TIER_NAMES = ['Rookie', 'Pro', 'All-Star', 'Legend'];
  const tierText = (t) => (t >= 3 ? 'on Legend' : t > 0 ? 'on ' + TIER_NAMES[t] + ' or harder' : 'on any tier');

  // a small seeded generator (the same mulberry32 the engine uses), so every pot's challenge is fixed by its day
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // windows: one pot per UTC day ("2026-11-24"); the demo can add rounds to a day ("2026-11-24#2")
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayStart = (day) => Date.parse(day + 'T00:00:00Z');
  const closesAt = (key) => dayStart(String(key).slice(0, 10)) + DAY_MS;
  // Each run of GOALS.length days uses every challenge once, in a shuffled order, so no challenge comes up two
  // days running (a demo round moves one step along the same order).
  const EPOCH = Date.UTC(2026, 0, 5);
  function order(cycle) {
    const a = GOALS.slice(), r = rng('potcycle|' + cycle);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function goalFor(key) {
    const L = GOALS.length, n = Math.floor((dayStart(String(key).slice(0, 10)) - EPOCH) / DAY_MS) + (+String(key).split('#')[1] || 0);
    const cycle = Math.floor(n / L), pos = ((n % L) + L) % L, a = order(cycle);
    if (a[0] === order(cycle - 1)[L - 1]) { const t = a[0]; a[0] = a[1]; a[1] = t; } // no repeat across cycles either
    return a[pos];
  }

  // levels: [{ outcomes: 'SSRSSS', clear: true }, ...] in order, as verified so far
  function facts(levels) {
    let streak = 0, best = 0, swishes = 0, score = 0, perfect = 0, clears = 0;
    for (const lv of levels) {
      const o = String(lv.outcomes || '');
      for (const c of o) {
        if (c === 'S') { streak++; swishes++; } else streak = 0;
        score += ringPoints(c, streak);
        if (streak > best) best = streak;
      }
      if (lv.clear) { clears++; if (o.length === HOOPS && !o.includes('R')) { perfect++; score += 10; } }
    }
    return { best, swishes, score, perfect, clears };
  }
  // where a run stands on a challenge: { value, target, done }. A run below the challenge's tier never counts.
  function progress(goal, levels, tier) {
    const g = typeof goal === 'string' ? GOAL_BY[goal] : goal;
    if (!g) return { value: 0, target: 1, done: false, counts: false };
    const counts = tier >= g.tier;
    const value = facts(levels)[g.kind] || 0;
    return { value: Math.min(value, g.n), target: g.n, done: counts && value >= g.n, counts };
  }

  // Close a pot. entries: total paid in (lamports or SOL); carryIn: rolled in from earlier pots; winners: how many
  // made it. Returns what each winner gets, the house's rake, and what rolls over (all of it if nobody made it,
  // otherwise just the indivisible remainder). integer = true works in whole lamports.
  function split(entries, carryIn, winners, integer) {
    const rake = integer ? Math.ceil(entries * RAKE) : entries * RAKE;
    const pool = carryIn + entries - rake;
    if (!winners) return { share: 0, rake, carry: pool, pool };
    const share = integer ? Math.floor(pool / winners) : pool / winners;
    return { share, rake, carry: integer ? pool - share * winners : 0, pool };
  }
  // the pot as it stands: what's in it for the winners
  const poolOf = (entries, carryIn) => carryIn + entries * (1 - RAKE);

  return { RAKE, ENTRY, DAY_MS, GOALS, GOAL_BY, TIER_NAMES, tierText, rng, dayKey, dayStart, closesAt, goalFor, facts, progress, split, poolOf };
});
