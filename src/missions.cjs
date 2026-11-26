/* SOL DUNK daily and weekly missions: shared by the browser, the server and the simulator.
 *
 * Missions come in rounds of three (easy, medium, hard): three rounds a day and three a week, the same for everyone in
 * a window. Finishing all three of a round opens the next one, with new missions and more SOL. Days are UTC days and
 * weeks start on Monday 00:00 UTC, so the server can judge them. Every run counts toward them, whatever the bet: they
 * are about how you play (swishes, streaks, clears, points). Each pays XP when done, and SOL too.
 *
 * SOL. A round's SOL rewards are released once the player has played that round's need in the window (bets on runs
 * plus special level entries): NEED for round 1, then NEED × STEPS for the later rounds. A reward is released at once if
 * that's already true when its mission is done, or the moment it becomes true. A released reward is the player's to
 * claim (claim): it waits in `ready` until they tap Claim, and stays there after its window ends. A reward still
 * waiting for play when its window ends is gone.
 *
 * The house's edge. A round's rewards add up to the window's share (SHARE: 0.3% a day, 0.2% a week) of the play its
 * need adds on top of the round before, so however far a player gets, what a window has paid is never more than that
 * share of what they played in it. Later rounds pay more only because they ask for more play; the shares never rise.
 * RATE, days and weeks together, is half the house's smallest edge against a good player (1%: Hard pays a good player
 * back 99% at checkpoint 1), so a good player who plays just enough to collect everything still loses on average, and
 * the house keeps its edge however the player bets. Amounts are in whatever unit NEED is in (SOL here, lamports on
 * the server).
 *
 * Progress is judged from a run's verified ring outcomes per level, so the server decides it from the taps it replays.
 * One weekly mission counts something else the server knows: the days on which the player finished a daily round.
 */
(function (root, factory) {
  const M = factory(root.DunkEngine || (typeof require === 'function' ? require('./engine.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.DunkMissions = M;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const DAY_MS = 86400000, WEEK_MS = 7 * DAY_MS, HOOPS = 6, PERFECT_BONUS = 10;
  const NEED = { day: 2, week: 10 };                                  // SOL played in the window before round 1's rewards pay
  const ROUNDS = 3;                                                   // rounds of three missions in a window
  const STEPS = [1, 2.5, 5];                                          // a round's rewards pay at NEED × its step (2, 5, 10 SOL a day)
  const SHARE = { day: [0.0005, 0.001, 0.0015], week: [0.0004, 0.0006, 0.001] }; // reward per slot, as a share of the play a round adds
  // the most the rewards can add to a player's return: 0.3% of a day's play, and 0.2% of a week's on top
  const RATE = SHARE.day.reduce((a, b) => a + b, 0) + SHARE.week.reduce((a, b) => a + b, 0);
  const SHARES = { day: SHARE.day.reduce((a, b) => a + b, 0), week: SHARE.week.reduce((a, b) => a + b, 0) };
  // Later daily rounds ask for more: totals that add up over the day grow by GROW, and every mission pays XP_STEP more
  // XP a round. Targets that have to happen within one run stay as they are (a round can't ask for a longer streak).
  const GROW = [1, 1.5, 2], XP_STEP = 20;

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
    { k: 'perfect', sum: true, flat: true, n: [[1, 50], [1, 70], [2, 110]] },
    { k: 'greens', sum: true, n: [[1, 40], [3, 60], [5, 100]] },
    { k: 'fires', sum: true, n: [[1, 40], [2, 60], [3, 100]] },
    { k: 'runs', sum: true, n: [[3, 40], [5, 60], [8, 100]] }
  ];
  // Weekly missions all add up over the week.
  const WEEKLY = [
    { k: 'swish', sum: true, n: [[60, 120], [100, 180], [150, 260]] },
    { k: 'points', sum: true, n: [[300, 120], [500, 180], [800, 260]] },
    { k: 'clears', sum: true, n: [[10, 120], [18, 180], [28, 260]] },
    { k: 'mov', sum: true, n: [[12, 120], [22, 180], [36, 260]] },
    { k: 'perfect', sum: true, n: [[2, 140], [4, 200], [6, 280]] },
    { k: 'fires', sum: true, n: [[6, 120], [12, 180], [20, 260]] },
    { k: 'novas', sum: true, n: [[2, 140], [4, 200], [7, 280]] },
    { k: 'greens', sum: true, n: [[8, 120], [14, 180], [22, 260]] },
    { k: 'runs', sum: true, n: [[15, 120], [25, 180], [40, 260]] }
  ];
  // Every week ties the days together: "finish a daily round on N days" sits in weekly round 1 (medium slot) and
  // round 2 (hard slot). It counts days of this week, so the days before its round opened count too.
  const WEEK_DAYS = [{ slot: 1, k: 'days', n: 3, xp: 180 }, { slot: 2, k: 'days', n: 5, xp: 260 }, null];
  const DAILY_BY = Object.fromEntries(DAILY.map((d) => [d.k, d]));
  const WEEKLY_BY = Object.fromEntries(WEEKLY.map((d) => [d.k, d]));

  // windows
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayEnd = (ts) => Date.parse(dayKey(ts) + 'T00:00:00Z') + DAY_MS;
  function weekStart(ts) { const d0 = Date.parse(dayKey(ts) + 'T00:00:00Z'); return d0 - ((new Date(d0).getUTCDay() + 6) % 7) * DAY_MS; }
  const weekKey = (ts) => dayKey(weekStart(ts));
  const weekEnd = (ts) => weekStart(ts) + WEEK_MS;

  // a window's rounds, three missions each: no kind twice in a window, drawn from the window's key
  const picked = new Map();
  function pick(defs, by, seed, fixed, grow) {
    if (picked.has(seed)) return picked.get(seed);
    const rng = E.makeRng(seed), pool = defs.map((d) => d.k), rounds = [];
    for (let round = 0; round < ROUNDS; round++) {
      const list = [], f = fixed && fixed[round];
      for (let slot = 0; slot < 3; slot++) {
        if (f && f.slot === slot) { list.push({ k: f.k, n: f.n, xp: f.xp, sum: false, slot, round }); continue; }
        const k = pool.splice(Math.floor(rng() * pool.length), 1)[0], [n, xp] = by[k].n[slot], up = grow && by[k].sum && !by[k].flat;
        list.push({ k, n: up ? Math.round(n * GROW[round]) : n, xp: grow ? xp + XP_STEP * round : xp, sum: !!by[k].sum, slot, round });
      }
      rounds.push(list);
    }
    if (picked.size > 40) picked.clear();
    picked.set(seed, rounds);
    return rounds;
  }
  const dailyRounds = (day) => pick(DAILY, DAILY_BY, 'daily|' + day, null, true);
  const weeklyRounds = (wk) => pick(WEEKLY, WEEKLY_BY, 'weekly|' + wk, WEEK_DAYS, false);
  const daily = (day, round) => dailyRounds(day)[round | 0];
  const weekly = (wk, round) => weeklyRounds(wk)[round | 0];
  // what a round's rewards wait for, and what a mission pays: its slot's share of the play its round adds
  const needAt = (win, round, need) => (need == null ? NEED[win] : need) * STEPS[round | 0];
  const reward = (win, slot, need, round) => (need == null ? NEED[win] : need) * SHARE[win][slot] * (STEPS[round | 0] - (round ? STEPS[round - 1] : 0));

  // A run's facts from its verified levels, in order: [{ outcomes: 'SSRS..', clear: true, mov: '0110..' }, ...]
  // (mov: 1 where that ring was moving). The streak carries over from level to level, as in the game.
  // greens: green (checkpoint) rings swished, the last ring of a cleared level; runs: the run itself.
  function facts(levels) {
    let streak = 0, best = 0, swish = 0, score = 0, perfect = 0, clears = 0, mov = 0, fires = 0, novas = 0, greens = 0;
    for (const lv of levels) {
      const o = String(lv.outcomes || ''), m = String(lv.mov || '');
      for (let i = 0; i < o.length; i++) {
        if (o[i] === 'S') { streak++; swish++; if (m[i] === '1') mov++; } else streak = 0;
        score += o[i] === 'S' ? 1 + Math.min(streak, 5) : 1;
        if (streak > best) best = streak;
        if (streak === 3) fires++; else if (streak === 5) novas++;
      }
      if (lv.clear) {
        clears++;
        if (o.length === HOOPS && !o.includes('R')) { perfect++; score += PERFECT_BONUS; }
        if (o.length === HOOPS && o[HOOPS - 1] === 'S') greens++;
      }
    }
    return { swish, points: score, score, clears, best, level: levels.length, mov, perfect, fires, novas, greens, runs: levels.length ? 1 : 0 };
  }

  // ---- a player's mission state: { day, week, dp, wp (played this day / week), d, w, wd, wdd, ready }
  // d and w hold { p, done, paid } for every mission of the rounds opened so far, three a round, in order; wd counts
  // this week's days with a daily round finished and wdd is the last day counted. paid: the reward was released. A
  // released reward has c: false and its amount in r until it's claimed (c: true); one released before claims existed
  // has no c, and was credited then, so it counts as claimed. ready: everything released and not yet claimed, this
  // window's or an earlier one's (it doesn't roll over with the windows, so the server can count it as owed).
  const blank = () => [0, 1, 2].map(() => ({ p: 0, done: false, paid: false }));
  const isReady = (m) => !!(m && m.paid && m.c === false);
  const isClaimed = (m) => !!(m && m.paid && m.c !== false);
  const okList = (a) => Array.isArray(a) && a.length >= 3 && a.length % 3 === 0 && a.length <= 3 * ROUNDS;
  function roll(s, ts) {
    s = s && typeof s === 'object' ? s : {};
    const day = dayKey(ts), wk = weekKey(ts);
    if (s.day !== day || !okList(s.d)) { s.day = day; s.dp = 0; s.d = blank(); }
    if (s.week !== wk || !okList(s.w)) { s.week = wk; s.wp = 0; s.w = blank(); s.wd = 0; s.wdd = ''; }
    s.wd = s.wd | 0;
    s.ready = s.ready > 0 ? +s.ready : 0;
    return s;
  }
  const roundsOf = (s, win) => (win === 'day' ? dailyRounds(s.day) : weeklyRounds(s.week));
  // release what's due: every mission done and not released whose round's need has been played in its window. It
  // becomes ready to claim.
  function collect(s, need) {
    const out = [];
    for (const [win, list, played] of [['day', s.d, s.dp], ['week', s.w, s.wp]]) {
      const defs = roundsOf(s, win);
      list.forEach((m, i) => {
        const round = Math.floor(i / 3), slot = i % 3;
        if (!m.done || m.paid || !(played >= needAt(win, round, need[win]) - 1e-9)) return;
        const amount = reward(win, slot, need[win], round);
        m.paid = true; m.c = false; m.r = amount; s.ready = (s.ready || 0) + amount;
        out.push({ win, i, slot, round, k: defs[round][slot].k, n: defs[round][slot].n, amount });
      });
    }
    return out;
  }
  const needOf = (need) => ({ day: need && need.day != null ? need.day : NEED.day, week: need && need.week != null ? need.week : NEED.week });
  // a bet (or special entry) was placed: it counts toward both windows' play
  function play(s, amount, ts, need) {
    s = roll(s, ts);
    s.dp += amount; s.wp += amount;
    return { s, ready: collect(s, needOf(need)) };
  }
  // move a window's open round on with some facts; finishing all three opens the next round (it starts at the next run)
  function advance(s, win, f, done, opened) {
    const list = win === 'day' ? s.d : s.w, round = list.length / 3 - 1, defs = roundsOf(s, win)[round];
    let all = true;
    for (let slot = 0; slot < 3; slot++) {
      const m = list[round * 3 + slot], c = defs[slot];
      if (!m.done) {
        const v = f[c.k] || 0;
        m.p = Math.min(c.n, c.sum ? m.p + v : Math.max(m.p, v));
        if (m.p >= c.n) { m.done = true; done.push({ win, slot, round, k: c.k, n: c.n, xp: c.xp }); }
      }
      all = all && m.done;
    }
    if (all && round < ROUNDS - 1) { list.push(...blank()); opened.push({ win, round: round + 1 }); return true; }
    return false;
  }
  // a run ended: its verified levels move the missions on. Returns what it finished, the rounds it opened and what it
  // released to claim.
  function run(s, levels, ts, need) {
    s = roll(s, ts);
    const f = facts(levels), done = [], opened = [];
    advance(s, 'day', f, done, opened);
    // a day counts for the week once its first daily round is finished
    if (s.d.length > 3 || s.d.every((m) => m.done)) { if (s.wdd !== s.day) { s.wd++; s.wdd = s.day; } }
    // a weekly round opened by this run only takes the days so far, not this run's rings
    if (advance(s, 'week', Object.assign({}, f, { days: s.wd }), done, opened)) advance(s, 'week', { days: s.wd }, done, opened);
    return { s, facts: f, done, opened, ready: collect(s, needOf(need)) };
  }
  // Claim released SOL: one mission (win 'day' or 'week' and its index in that window's list) or, with no win,
  // everything ready, earlier windows' too. Returns { s, amount, items } or { s, error: 'unknown' | 'claimed' |
  // 'locked' }. The caller credits the amount. s should be rolled to now first (view does).
  function claim(s, win, i) {
    s = s && typeof s === 'object' ? s : {};
    const snap = () => { if (!(s.ready > 1e-6)) s.ready = 0; };
    if (win == null) {
      const amount = s.ready > 0 ? s.ready : 0, items = [];
      for (const [w, list] of [['day', s.d], ['week', s.w]]) (list || []).forEach((m, j) => { if (isReady(m)) { m.c = true; items.push({ win: w, i: j, amount: m.r }); } });
      s.ready = 0;
      return { s, amount, items };
    }
    const list = win === 'day' ? s.d : win === 'week' ? s.w : null, m = list && list[i | 0];
    if (!m || !(i >= 0)) return { s, error: 'unknown' };
    if (isClaimed(m)) return { s, error: 'claimed' };
    if (!isReady(m)) return { s, error: 'locked' };
    const amount = Math.min(m.r, s.ready > 0 ? s.ready : 0);
    m.c = true; s.ready -= amount; snap();
    return { s, amount, items: [{ win, i: i | 0, amount }] };
  }
  // Everything the missions pages show, from every opened mission of each window ({ ...def, p, done, paid, ready,
  // claimed, reward, need }), what was played and the base needs. daily / weekly: the open round's three; round: its
  // number from 0; need: what the open round's SOL waits for; paid: SOL released (ready or claimed); ready / claimed:
  // released and waiting for a tap, or claimed; waiting: earned but waiting for play; due: the play that releases the
  // first waiting reward; next: the round after this one; max: all a window can pay. readyAll: everything ready to
  // claim, earlier windows' too; earlier: the part of it from windows that have ended.
  function shape(v) {
    const out = Object.assign({}, v, { rounds: ROUNDS, round: {}, need: {}, paid: {}, ready: {}, claimed: {}, waiting: {}, due: {}, next: {}, max: {} });
    for (const win of ['day', 'week']) {
      const all = v.all[win], r = all.length / 3 - 1, base = v.base[win];
      const wait = all.filter((m) => m.done && !m.paid);
      out.round[win] = r;
      out.need[win] = needAt(win, r, base);
      out.paid[win] = all.reduce((a, m) => a + (m.paid ? m.reward : 0), 0);
      out.ready[win] = all.reduce((a, m) => a + (m.ready ? m.reward : 0), 0);
      out.claimed[win] = all.reduce((a, m) => a + (m.claimed ? m.reward : 0), 0);
      out.waiting[win] = wait.reduce((a, m) => a + m.reward, 0);
      out.due[win] = wait.length ? Math.min(...wait.map((m) => m.need)) : null;
      out.next[win] = r < ROUNDS - 1 ? { round: r + 1, need: needAt(win, r + 1, base), reward: base * SHARES[win] * (STEPS[r + 1] - STEPS[r]) } : null;
      out.max[win] = base * SHARES[win] * STEPS[ROUNDS - 1];
    }
    out.daily = v.all.day.slice(-3); out.weekly = v.all.week.slice(-3);
    const here = out.ready.day + out.ready.week;
    out.readyAll = v.readyAll != null ? Math.max(v.readyAll, here) : here;
    out.earlier = out.readyAll - here > here * 1e-9 + 1e-9 ? out.readyAll - here : 0;
    return out;
  }
  function view(s, ts, need) {
    s = roll(s, ts); need = needOf(need);
    const one = (win, list) => { const defs = roundsOf(s, win); return list.map((m, i) => { const round = Math.floor(i / 3), slot = i % 3; return Object.assign({}, defs[round][slot], { p: m.p, done: m.done, paid: !!m.paid, ready: isReady(m), claimed: isClaimed(m), i, reward: isReady(m) ? m.r : reward(win, slot, need[win], round), need: needAt(win, round, need[win]) }); }); };
    return shape({ day: s.day, week: s.week, dayEnds: dayEnd(ts), weekEnds: weekEnd(ts), base: need, played: { day: s.dp, week: s.wp }, days: s.wd, readyAll: s.ready, all: { day: one('day', s.d), week: one('week', s.w) } });
  }

  return { DAY_MS, WEEK_MS, NEED, ROUNDS, STEPS, GROW, SHARE, SHARES, RATE, DAILY, WEEKLY, WEEK_DAYS, DAILY_BY, WEEKLY_BY, dayKey, dayEnd, weekKey, weekEnd, daily, weekly, dailyRounds, weeklyRounds, needAt, reward, facts, roll, collect, play, run, claim, isReady, isClaimed, shape, view };
});
