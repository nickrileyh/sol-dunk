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

  // The challenges. tier = the easiest mode where it counts (0 Easy, 1 Hard; engine v14 has just the two).
  // p = the chance one run makes it at that tier for a [casual, average, good] player, from the simulator
  // (they keep going until they bust); the demo uses it to simulate other entrants. Aim: an average player
  // makes one in about 4-15% of runs, a strong one in 25-50%. Measured on engine v13 (20,000 runs per skill):
  // with the rings spread out 1:1 with the speed, swishes got rarer (an average player swishes 65% of Pro's
  // level-1 rings, down from 71%), so the streak, swish and score challenges came down and "Swish every ring in
  // a level" moved to Pro. Each replaced its v12 challenge in place, so every day keeps the same kind of challenge.
  // Engine v14 has two modes, Easy (v13's Pro rings) and Hard (v13's Legend rings); every challenge was measured
  // again (node sim/pots.cjs, 3000 runs per skill). Hard's three drifted below the aim on Legend's rings and were
  // replaced in place by easier ones (Clear level 4, Swish 12 rings, Swish 5 in a row), and Score 120 by Clear
  // level 6 on Easy.
  // Engine v15 (the outer half of the near rim falls off) moved them by under a point; p holds its measurement
  // (5,000 runs per skill).
  const GOALS = [
    { id: 'streak8', kind: 'best', n: 8, tier: 0, text: 'Swish 8 in a row', p: [0.02, 0.087, 0.328] },
    { id: 'perfect1', kind: 'perfect', n: 1, tier: 0, text: 'Swish every ring in a level', p: [0.037, 0.126, 0.399] },
    { id: 'clear4', kind: 'clears', n: 4, tier: 1, text: 'Clear level 4', p: [0.024, 0.105, 0.372] },
    { id: 'score90', kind: 'score', n: 90, tier: 0, text: 'Score 90 in one run', p: [0.005, 0.06, 0.465] },
    { id: 'swish12', kind: 'swishes', n: 12, tier: 1, text: 'Swish 12 rings in one run', p: [0.008, 0.075, 0.422] },
    { id: 'streak5', kind: 'best', n: 5, tier: 1, text: 'Swish 5 in a row', p: [0.043, 0.123, 0.355] },
    { id: 'clear6', kind: 'clears', n: 6, tier: 0, text: 'Clear level 6', p: [0.023, 0.108, 0.386] },
    // five more kinds (the owner asked for more fun and unique challenges), measured the same way on engine v15 (5,000 runs per skill):
    // the green ring itself, arriving at a checkpoint on fire, a streak after a rim hit, and a fast start
    { id: 'green4', kind: 'greens', n: 4, tier: 0, text: 'Swish 4 green rings in one run', p: [0.018, 0.106, 0.408] },
    { id: 'hot2', kind: 'hot', n: 2, tier: 0, text: 'Reach 2 checkpoints on fire', p: [0.029, 0.117, 0.426] },
    { id: 'comeback7', kind: 'comeback', n: 7, tier: 0, text: 'Hit a rim, then swish 7 in a row', p: [0.032, 0.109, 0.351] },
    { id: 'early10', kind: 'early', n: 10, tier: 0, text: 'Swish 10 of your first 12 rings', p: [0.015, 0.095, 0.341] },
    { id: 'early8', kind: 'early', n: 8, tier: 1, text: 'Swish 8 of your first 12 rings', p: [0.029, 0.099, 0.352] }
  ];
  // challenges taken out of the rotation (engine v13 and v14): no new pot gets one, but a pot that opened with one
  // before an update is still shown and judged by it until it closes
  const RETIRED = [
    { id: 'clear5', kind: 'clears', n: 5, tier: 1, text: 'Clear level 5' },
    { id: 'swish15', kind: 'swishes', n: 15, tier: 1, text: 'Swish 15 rings in one run' },
    { id: 'streak6', kind: 'best', n: 6, tier: 1, text: 'Swish 6 in a row' },
    { id: 'score120', kind: 'score', n: 120, tier: 0, text: 'Score 120 in one run' },
    { id: 'streak10', kind: 'best', n: 10, tier: 0, text: 'Swish 10 in a row' },
    { id: 'score100', kind: 'score', n: 100, tier: 0, text: 'Score 100 in one run' },
    { id: 'swish25', kind: 'swishes', n: 25, tier: 0, text: 'Swish 25 rings in one run' },
    { id: 'streak8a', kind: 'best', n: 8, tier: 1, text: 'Swish 8 in a row' }
  ];
  const GOAL_BY = Object.fromEntries(RETIRED.concat(GOALS).map((g) => [g.id, g]));
  const TIER_NAMES = ['Easy', 'Hard'];
  const tierText = (t) => (t >= 1 ? 'on Hard' : 'in either mode');

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
  // best: longest swish streak; greens: green (checkpoint) rings swished; hot: checkpoints reached on fire (3 or more
  // swishes in a row as the level ends); comeback: longest swish streak after the run's first rim hit; early: swishes
  // among the run's first EARLY rings
  const EARLY = 12, FIRE = 3;
  function facts(levels) {
    let streak = 0, best = 0, swishes = 0, score = 0, perfect = 0, clears = 0, greens = 0, hot = 0, comeback = 0, early = 0, rings = 0, rimmed = false;
    for (const lv of levels) {
      const o = String(lv.outcomes || '');
      for (const c of o) {
        if (c === 'S') { streak++; swishes++; if (rings < EARLY) early++; } else { streak = 0; rimmed = true; }
        rings++;
        score += ringPoints(c, streak);
        if (streak > best) best = streak;
        if (rimmed && streak > comeback) comeback = streak;
      }
      if (lv.clear) {
        clears++;
        if (o.length === HOOPS && !o.includes('R')) { perfect++; score += 10; }
        if (o[o.length - 1] === 'S') greens++;
        if (streak >= FIRE) hot++;
      }
    }
    return { best, swishes, score, perfect, clears, greens, hot, comeback, early };
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
