/* SOL DUNK trophies: shared by the browser, the server and the demo.
 *
 * Fifteen one-time goals. Each adds XP, and each pays a little SOL that the player claims on the Trophies page.
 *
 * SOL. A trophy's reward is its XP times UNIT (0.001 to 0.025 SOL, 0.085 SOL for all fifteen). A player can claim
 * trophy SOL only up to RATE (0.2%) of everything they have bet (run bets and special level entries): a reward can be
 * claimed once RATE x bets covers it on top of what has been claimed already and the smaller rewards still open. So
 * trophy SOL never adds more than RATE to a player's return, however they bet and whenever they stop, and a fresh
 * account can't farm the easy trophies: it has to bet 500 times a reward before it can claim it. Mission SOL (0.5%,
 * src/missions.cjs), trophy SOL and the volume part of rakeback (0.05%, src/levels.cjs) add up to 0.75% at most, under
 * the house's smallest edge against a good player (1%: Hard pays a good player back 99% at checkpoint 1); rakeback's
 * share of losses is sized by node sim/rakeback.cjs, which counts trophy SOL at its most. Raise UNIT to pay more per
 * trophy (players then bet more before each claim); don't raise RATE past what is left of that edge, and run the
 * simulator after any change to it. Amounts are in whatever unit the caller passes (SOL in the browser, lamports on
 * the server).
 *
 * A trophy is judged from a run's verified ring outcomes per level, so the server decides it from the taps it replays.
 * Special levels and practice runs don't count.
 */
(function (root, factory) {
  const T = factory(root.DunkMissions || (typeof require === 'function' ? require('./missions.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = T;
  else root.DunkTrophies = T;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MS) {
  'use strict';

  const UNIT = 0.0001;  // SOL per XP of a trophy: Clean (10 XP) pays 0.001 SOL, Champion (250 XP) 0.025
  const RATE = 0.002;   // the most trophy SOL can add to a player's return: claims never pass RATE x everything bet

  // f: a run's facts (see facts) plus { paid, total, hard, totalSwish, nl }
  const LIST = [
    { id: 'swish1', name: 'Clean', desc: 'Swish a ring', xp: 10, test: (f) => f.swish >= 1 },
    { id: 'cp1', name: 'Checkpoint', desc: 'Clear level 1', xp: 10, test: (f) => f.clears >= 1 },
    { id: 'fire3', name: 'Heating up', desc: 'Swish 3 in a row', xp: 20, test: (f) => f.best >= 3 },
    { id: 'moving', name: 'Moving target', desc: 'Swish a moving ring', xp: 15, test: (f) => f.mov >= 1 },
    { id: 'nova5', name: 'Supernova', desc: 'Swish 5 in a row', xp: 40, test: (f) => f.best >= 5 },
    { id: 'perfect', name: 'Perfect level', desc: 'Swish all 6 rings in a level', xp: 50, test: (f) => f.perfect >= 1 },
    { id: 'tilted', name: 'Angles', desc: 'Swish a tilted ring', xp: 25, test: (f) => f.tilt >= 1 },
    { id: 'deep4', name: 'Deep run', desc: 'Reach level 4', xp: 40, test: (f) => f.level >= 4 },
    { id: 'score50', name: 'High flyer', desc: 'Score 50 in one run', xp: 40, test: (f) => f.score >= 50 },
    { id: 'double', name: 'Double up', desc: 'Cash out at 2× or more', xp: 60, test: (f) => !!f.paid && f.total >= 2 },
    { id: 'legend', name: 'Legendary', desc: 'Clear level 1 on Hard', xp: 60, test: (f) => !!f.hard && f.clears >= 1 },
    { id: 'deep6', name: 'Into the deep', desc: 'Reach level 6', xp: 80, test: (f) => f.level >= 6 },
    { id: 'streak10', name: 'Unstoppable', desc: 'Swish 10 in a row', xp: 100, test: (f) => f.best >= 10 },
    { id: 'swish100', name: 'Swish collector', desc: 'Swish 100 rings in total', xp: 50, test: (f) => f.totalSwish >= 100 },
    { id: 'champion', name: 'Champion', desc: 'Clear all 8 levels', xp: 250, test: (f) => f.clears >= (f.nl || 8) }
  ];
  const BY = Object.fromEntries(LIST.map((t) => [t.id, t]));
  const EPS = 1e-9;
  // a trophy's reward in the caller's unit (unit: one XP's worth; UNIT for SOL, UNIT x 1e9 for lamports)
  const reward = (t, unit) => Math.round(t.xp * (unit == null ? UNIT : unit) * 1e9) / 1e9;

  // A run's facts from its verified levels: the missions' facts, plus the tilted rings swished
  // (levels: [{ outcomes: 'SSRS..', clear, mov: '0110..', tilt: '0010..' }, ...])
  function facts(levels) {
    const f = MS.facts(levels);
    let tilt = 0;
    for (const lv of levels) {
      const o = String(lv.outcomes || ''), t = String(lv.tilt || '');
      for (let i = 0; i < o.length; i++) if (o[i] === 'S' && t[i] === '1') tilt++;
    }
    f.tilt = tilt;
    return f;
  }

  // ---- a player's trophy state: { e: { id: when earned }, c: { id: amount claimed }, sw: rings swished in regular runs }
  function norm(s) {
    s = s && typeof s === 'object' ? s : {};
    if (!s.e || typeof s.e !== 'object') s.e = {};
    if (!s.c || typeof s.c !== 'object') s.c = {};
    s.sw = +s.sw || 0;
    return s;
  }
  const claimed = (s) => Object.values(norm(s).c).reduce((a, b) => a + (+b || 0), 0);
  // a regular run ended: its verified levels may earn trophies. ctx: { paid, total, hard, nl }
  function run(s, levels, ctx, ts) {
    s = norm(s); ctx = ctx || {};
    const f = facts(levels);
    s.sw += f.swish;
    const g = Object.assign({}, f, { paid: !!ctx.paid, total: +ctx.total || 0, hard: !!ctx.hard, totalSwish: s.sw, nl: ctx.nl || 8 });
    const earned = [];
    for (const t of LIST) if (!s.e[t.id] && t.test(g)) { s.e[t.id] = ts || Date.now(); earned.push(t.id); }
    return { s, facts: g, earned };
  }
  // Everything the Trophies page shows. What can be claimed now is worked out together, the smallest rewards first:
  // a reward can be claimed while RATE x bets covers it on top of what's been claimed and the smaller ones still open,
  // so the page never offers more than the player can actually take. `more` is how much more to bet until then.
  function view(s, played, unit) {
    s = norm(s); played = +played || 0;
    const sum = claimed(s), eps = EPS * Math.max(1, played);
    const list = LIST.map((t) => ({ id: t.id, xp: t.xp, reward: reward(t, unit), earned: !!s.e[t.id], claimed: +s.c[t.id] || 0, can: false, more: 0 }));
    let need = sum;
    for (const x of list.filter((x) => x.earned && !x.claimed).sort((a, b) => a.reward - b.reward)) {
      need += x.reward;
      const short = need / RATE - played;
      if (short > eps) x.more = short; else x.can = true;
    }
    for (const x of list) if (!x.earned) x.more = Math.max(0, (sum + x.reward) / RATE - played);
    return { rate: RATE, played, claimed: sum, open: list.filter((x) => x.can).length, list };
  }
  // claim one trophy's SOL: { amount } or { error: 'unknown' | 'locked' | 'claimed' | 'more', more }
  function claim(s, id, played, unit) {
    s = norm(s);
    if (!BY[id]) return { s, error: 'unknown' };
    if (!s.e[id]) return { s, error: 'locked' };
    if (s.c[id]) return { s, error: 'claimed' };
    const x = view(s, played, unit).list.find((y) => y.id === id);
    if (!x.can) return { s, error: 'more', more: x.more };
    s.c[id] = x.reward;
    return { s, amount: x.reward };
  }

  return { UNIT, RATE, LIST, BY, reward, facts, norm, claimed, run, claim, view };
});
