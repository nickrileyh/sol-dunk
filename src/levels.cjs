/* SOL DUNK player levels and level-up rakeback: shared by the browser and the server.
 *
 * Levels. XP comes from how you play (points, clears, perfect levels, missions, trophies), never from what you bet.
 * A level takes NEED_BASE XP plus NEED_STEP more for each level before it.
 *
 * Rakeback (the owner asked for it to be a percent of losses, with a very small amount from volume). Each level up
 * releases, to claim:
 *   - LOSS (5%) of what the player lost since their last level up, net of what they won: a level's bets less its
 *     payouts, if that's a loss (runs and challenges are netted separately), and
 *   - VOL (0.05%) of every bet, win or lose.
 * The share of run losses falls from LOSS to LOSS_TOP (2%) as the player's rating from regular runs climbs from
 * RATED[0] to RATED[1] (2.2 to 2.8, between average, 2, and good, 3, on the simulator's scale), and the loss part of
 * a level is at most CAP (2%) of what was bet in it.
 *
 * The house's edge. A share of losses pays a player for the swings: a loss is paid back at once and a win is kept. So
 * how much it can pay depends on how little the house keeps from the player's best way of playing. An average player
 * keeps no more than 90% on any way of playing regular runs (Easy, checkpoint 1), so even 5% of every bet back would
 * leave the house an edge; a good one keeps 97-99%, so 5% of a deep run's losses would beat the house, and 2% doesn't.
 * The rating (src/special.cjs, from every ring passed and missed, each counted by its run's bet so that cheap bad
 * runs can't hide skill) tells the two apart. Challenges keep their 10% (a settled special level, the pot's and the
 * duel's rake) from everyone, so their losses get the full LOSS. CAP bounds what anyone gets however they bet. With
 * mission SOL (at most 0.5% of play, src/missions.cjs) and trophy SOL (src/trophies.cjs), node sim/rakeback.cjs plays
 * every way of betting it knows for each skill and checks the house keeps an edge on all of them. Levelling only
 * decides when rakeback is released; a level's window nets its wins and losses whenever it ends.
 *
 * Amounts are in whatever unit the bets are in (SOL in the demo, lamports on the server).
 */
(function (root, factory) {
  const M = factory();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.DunkLevels = M;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---- levels
  const NEED_BASE = 70, NEED_STEP = 35, MAX = 99;
  const xpNeed = (l) => NEED_BASE + NEED_STEP * (Math.min(l, MAX) - 1); // XP from level l to l + 1
  function lvlOf(xp) {
    let l = 1, need = xpNeed(1);
    while (xp >= need && l < MAX) { xp -= need; l++; need = xpNeed(l); }
    return { l, into: xp, need };
  }
  // level ups so far, counting on past the top level (each further xpNeed(MAX) is one more), so rakeback keeps coming
  function stepsOf(xp) { const v = lvlOf(xp); return v.l + (v.l >= MAX ? Math.floor(v.into / v.need) : 0); }
  // XP saved under the first curve (50 + 25 a level) moves to this one at the same level and the same way through it
  function fromOld(xp) {
    let l = 1, need = 50;
    while (xp >= need && l < MAX) { xp -= need; l++; need = 50 + 25 * (l - 1); }
    let total = 0;
    for (let k = 1; k < l; k++) total += xpNeed(k);
    return Math.round(total + Math.min(1, xp / need) * xpNeed(l));
  }
  // the XP a run earns by itself, from its verified facts (src/missions.cjs facts); a special level's from its points
  const runXp = (f) => (f.points || 0) + (f.clears || 0) * 5 + (f.perfect || 0) * 15;
  const specialXp = (points, won) => points + (won ? 25 : 0);

  // ---- rakeback
  // { v: the volume part building up; w: this level's window [run bets, run payouts, challenge bets, challenge payouts];
  //   k: the share of run losses; acc: what a level up would release now (v and the loss part, for show and for the
  //   house's cover check); ready: released, waiting to be claimed; paid: claimed so far;
  //   rec: { r: { 'tier|level': [passed, missed], each ring counted by its run's bet }, n: rings, nb: rings x bet } }
  const LOSS = 0.05, LOSS_TOP = 0.02, VOL = 0.0005, CAP = 0.02, RATED = [2.2, 2.8];
  const KINDS = { run: 0, special: 1, pot: 1, duel: 1 };
  // the share of run losses for a rating (the middle of it, on the special levels' scale: 2 average, 3 good)
  const share = (m) => (!(m > RATED[0]) ? LOSS : m >= RATED[1] ? LOSS_TOP : LOSS - (LOSS - LOSS_TOP) * (m - RATED[0]) / (RATED[1] - RATED[0]));
  function lossPart(s) {
    const [rb, rp, gb, gp] = s.w;
    return Math.min(CAP * (rb + gb), s.k * Math.max(0, rb - rp) + LOSS * Math.max(0, gb - gp));
  }
  const sum = (s) => { s.acc = s.v + lossPart(s); return s; };
  function fix(s) {
    s = s && typeof s === 'object' ? s : {};
    for (const k of ['acc', 'ready', 'paid']) if (!(s[k] > 0)) s[k] = 0;
    if (!(s.v >= 0)) s.v = s.acc; // a record from before (20% of the house's cut of every bet) keeps what it built up
    if (!Array.isArray(s.w) || s.w.length !== 4) s.w = [0, 0, 0, 0];
    if (!(s.k >= 0)) s.k = LOSS;
    if (!s.rec || typeof s.rec !== 'object' || !s.rec.r) s.rec = { r: {}, n: 0, nb: 0 };
    return sum(s);
  }
  // a bet of some kind was placed / paid out (a payout counts against that level's losses)
  function add(s, kind, amount) { s = fix(s); const i = KINDS[kind] ? 2 : 0; s.v += amount * VOL; s.w[i] += amount; return sum(s); }
  function pay(s, kind, amount) { s = fix(s); const i = KINDS[kind] ? 3 : 1; s.w[i] += amount; return sum(s); }
  // a regular level the bank verified: its rings go into the rating, counted by the run's bet
  function rings(s, di, L, passes, missed, bet) {
    s = fix(s);
    const key = di + '|' + L, c = s.rec.r[key] || (s.rec.r[key] = [0, 0]), n = passes + (missed ? 1 : 0);
    c[0] += passes * bet; c[1] += (missed ? 1 : 0) * bet; s.rec.n += n; s.rec.nb += n * bet;
    return s;
  }
  // that record for SP.regular: the counts scaled back to rings, so a player's rating is as sure as their rings make it
  function recOf(s) {
    s = fix(s);
    const f = s.rec.nb > 0 ? s.rec.n / s.rec.nb : 0, r = {};
    for (const k in s.rec.r) r[k] = [s.rec.r[k][0] * f, s.rec.r[k][1] * f];
    return { r };
  }
  // the player's rating changed: their share of run losses follows it
  function rate(s, m) { s = fix(s); s.k = share(m); return sum(s); }
  // a level up: what has built up is released to claim (whole: in whole units, the rest keeps building)
  function release(s, whole) {
    s = fix(s);
    const all = s.v + lossPart(s), x = whole ? Math.floor(all) : all;
    s.v = all - x; s.w = [0, 0, 0, 0]; s.ready += x;
    sum(s);
    return x;
  }
  // the player claims what is ready
  function claim(s) { s = fix(s); const x = s.ready; s.ready = 0; s.paid += x; return x; }

  return { NEED_BASE, NEED_STEP, MAX, xpNeed, lvlOf, stepsOf, fromOld, runXp, specialXp, LOSS, LOSS_TOP, VOL, CAP, RATED, share, lossPart, fix, add, pay, rings, recOf, rate, release, claim };
});
