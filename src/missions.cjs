/* SOL DUNK daily and weekly missions: shared by the browser, the server and the simulator.
 *
 * Three missions a day (easy, medium, hard) and three a week, the same for everyone in a window. Days are UTC days and
 * weeks start on Monday 00:00 UTC, so the server can judge them. Every run counts toward them, whatever the bet: they
 * are about how you play (swishes, streaks, clears, points). Each pays XP when done, as before, and SOL too.
 *
 * SOL. A window's SOL rewards pay once the player has played NEED in that window (bets on runs plus special level
 * entries), at once if that's already true when a mission is done, or the moment it becomes true. Rewards not
 * collected when the window ends are gone. The rewards in a window add up to RATE of its NEED, and RATE is half the
 * house's smallest edge against a good player (1%: All-Star and Legend paid back 99% at checkpoint 1), counting days
 * and weeks together. So a good player who plays just enough to collect everything still loses on average, and the
 * house keeps its edge however the player bets. Amounts are in whatever unit NEED is in (SOL here, lamports on the
 * server).
 *
 * Progress is judged from a run's verified ring outcomes per level, so the server decides it from the taps it replays.
 */
(function (root, factory) {
  const M = factory(root.DunkEngine || (typeof require === 'function' ? require('./engine.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.DunkMissions = M;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const DAY_MS = 86400000, WEEK_MS = 7 * DAY_MS, HOOPS = 6, PERFECT_BONUS = 10;
  const NEED = { day: 2, week: 10 };                                  // SOL played in the window before its rewards pay
  const SHARE = { day: [0.0005, 0.001, 0.0015], week: [0.0004, 0.0006, 0.001] }; // reward per slot, as a share of NEED
  // the most the rewards can add to a player's return: 0.3% of a day's play, and 0.2% of a week's on top
  const RATE = SHARE.day.reduce((a, b) => a + b, 0) + SHARE.week.reduce((a, b) => a + b, 0);

  // Daily missions: [target, XP] for the easy, medium and hard slot. "sum" missions add up over the day; the others
  // have to happen within one run. Keys are run facts (see facts).
  const DAILY = [
    { k: 'swish', sum: true, n: [[10, 40], [18, 60], [28, 100]] },
    { k: 'points', sum: true, n: [[50, 40], [90, 60], [140, 100]] },
    { k: 'clears', sum: true, n: [[2, 40], [4, 60], [7, 100]] },
    { k: 'best', n: [[3, 40], [4, 60], [6, 100]] },
    { k: 'score', n: [[20, 40], [32, 60], [48, 100]] },
    { k: 'level', n: [[2, 40], [3, 60], [5, 100]] },
    { k: 'mov', sum: true, n: [[2, 40], [5, 60], [9, 100]] },
    { k: 'perfect', sum: true, n: [[1, 50], [1, 70], [2, 110]] }
  ];
  // Weekly missions all add up over the week.
  const WEEKLY = [
    { k: 'swish', sum: true, n: [[60, 120], [100, 180], [150, 260]] },
    { k: 'points', sum: true, n: [[300, 120], [500, 180], [800, 260]] },
    { k: 'clears', sum: true, n: [[10, 120], [18, 180], [28, 260]] },
    { k: 'mov', sum: true, n: [[12, 120], [22, 180], [36, 260]] },
    { k: 'perfect', sum: true, n: [[2, 140], [4, 200], [6, 280]] },
    { k: 'fires', sum: true, n: [[6, 120], [12, 180], [20, 260]] },
    { k: 'novas', sum: true, n: [[2, 140], [4, 200], [7, 280]] }
  ];
  const DAILY_BY = Object.fromEntries(DAILY.map((d) => [d.k, d]));
  const WEEKLY_BY = Object.fromEntries(WEEKLY.map((d) => [d.k, d]));

  // windows
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayEnd = (ts) => Date.parse(dayKey(ts) + 'T00:00:00Z') + DAY_MS;
  function weekStart(ts) { const d0 = Date.parse(dayKey(ts) + 'T00:00:00Z'); return d0 - ((new Date(d0).getUTCDay() + 6) % 7) * DAY_MS; }
  const weekKey = (ts) => dayKey(weekStart(ts));
  const weekEnd = (ts) => weekStart(ts) + WEEK_MS;

  // the window's three missions: one of each kind at most, drawn from the window's key
  function pick(defs, by, seed) {
    const rng = E.makeRng(seed), pool = defs.map((d) => d.k), list = [];
    for (let slot = 0; slot < 3; slot++) {
      const k = pool.splice(Math.floor(rng() * pool.length), 1)[0], [n, xp] = by[k].n[slot];
      list.push({ k, n, xp, sum: !!by[k].sum, slot });
    }
    return list;
  }
  const daily = (day) => pick(DAILY, DAILY_BY, 'daily|' + day);
  const weekly = (wk) => pick(WEEKLY, WEEKLY_BY, 'weekly|' + wk);
  const reward = (win, slot, need) => (need == null ? NEED[win] : need) * SHARE[win][slot];

  // A run's facts from its verified levels, in order: [{ outcomes: 'SSRS..', clear: true, mov: '0110..' }, ...]
  // (mov: 1 where that ring was moving). The streak carries over from level to level, as in the game.
  function facts(levels) {
    let streak = 0, best = 0, swish = 0, score = 0, perfect = 0, clears = 0, mov = 0, fires = 0, novas = 0;
    for (const lv of levels) {
      const o = String(lv.outcomes || ''), m = String(lv.mov || '');
      for (let i = 0; i < o.length; i++) {
        if (o[i] === 'S') { streak++; swish++; if (m[i] === '1') mov++; } else streak = 0;
        score += o[i] === 'S' ? 1 + Math.min(streak, 5) : 1;
        if (streak > best) best = streak;
        if (streak === 3) fires++; else if (streak === 5) novas++;
      }
      if (lv.clear) { clears++; if (o.length === HOOPS && !o.includes('R')) { perfect++; score += PERFECT_BONUS; } }
    }
    return { swish, points: score, score, clears, best, level: levels.length, mov, perfect, fires, novas };
  }

  // ---- a player's mission state: { day, week, dp, wp (played this day / week), d: [3], w: [3] } with { p, done, paid }
  const blank = () => [0, 1, 2].map(() => ({ p: 0, done: false, paid: false }));
  function roll(s, ts) {
    s = s && typeof s === 'object' ? s : {};
    const day = dayKey(ts), wk = weekKey(ts);
    if (s.day !== day || !Array.isArray(s.d) || s.d.length !== 3) { s.day = day; s.dp = 0; s.d = blank(); }
    if (s.week !== wk || !Array.isArray(s.w) || s.w.length !== 3) { s.week = wk; s.wp = 0; s.w = blank(); }
    return s;
  }
  // pay what's due: every mission done and not paid in a window whose play has reached its need
  function collect(s, need) {
    const out = [];
    for (const [win, list, played] of [['day', s.d, s.dp], ['week', s.w, s.wp]]) {
      if (!(played >= need[win] - 1e-9)) continue;
      const defs = win === 'day' ? daily(s.day) : weekly(s.week);
      list.forEach((m, slot) => { if (m.done && !m.paid) { m.paid = true; out.push({ win, slot, k: defs[slot].k, n: defs[slot].n, amount: reward(win, slot, need[win]) }); } });
    }
    return out;
  }
  const needOf = (need) => ({ day: need && need.day != null ? need.day : NEED.day, week: need && need.week != null ? need.week : NEED.week });
  // a bet (or special entry) was placed: it counts toward both windows' play
  function play(s, amount, ts, need) {
    s = roll(s, ts);
    s.dp += amount; s.wp += amount;
    return { s, paid: collect(s, needOf(need)) };
  }
  // a run ended: its verified levels move the missions on. Returns what it finished and what it paid.
  function run(s, levels, ts, need) {
    s = roll(s, ts);
    const f = facts(levels), done = [];
    for (const [win, list, defs] of [['day', s.d, daily(s.day)], ['week', s.w, weekly(s.week)]]) {
      list.forEach((m, slot) => {
        if (m.done) return;
        const c = defs[slot], v = f[c.k] || 0;
        m.p = Math.min(c.n, c.sum ? m.p + v : Math.max(m.p, v));
        if (m.p >= c.n) { m.done = true; done.push({ win, slot, k: c.k, n: c.n, xp: c.xp }); }
      });
    }
    return { s, facts: f, done, paid: collect(s, needOf(need)) };
  }
  // everything the Missions page shows
  function view(s, ts, need) {
    s = roll(s, ts); need = needOf(need);
    const one = (win, list, defs) => defs.map((c, slot) => Object.assign({}, c, list[slot], { reward: reward(win, slot, need[win]) }));
    return {
      day: s.day, week: s.week, dayEnds: dayEnd(ts), weekEnds: weekEnd(ts), need,
      played: { day: s.dp, week: s.wp }, daily: one('day', s.d, daily(s.day)), weekly: one('week', s.w, weekly(s.week))
    };
  }

  return { DAY_MS, WEEK_MS, NEED, SHARE, RATE, DAILY, WEEKLY, DAILY_BY, WEEKLY_BY, dayKey, dayEnd, weekKey, weekEnd, daily, weekly, reward, facts, roll, collect, play, run, view };
});
