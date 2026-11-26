/* SOL DUNK player levels and level-up rakeback: shared by the browser and the server.
 *
 * Levels. XP comes from how you play (points, clears, perfect levels, missions, trophies), never from what you bet.
 * A level takes NEED_BASE XP plus NEED_STEP more for each level before it.
 *
 * Rakeback. Every bet sets a little SOL aside for the player: RATE (20%) of the house's cut of it. It builds up while
 * they play and is released to claim each time they level up, so a level up always comes with SOL.
 *
 * The house's edge. Rakeback is a share of what was bet, not of what was lost. A share of losses would pay a player
 * for the swings: bet big once, claim on a loss, keep a win, and the house is behind. The cut it counts is the least
 * the house keeps of each kind of bet:
 *   run      1%, its smallest edge against a good player (Hard pays one back 99% at checkpoint 1);
 *   special  5%, half the 10% a settled special level keeps, since a strong player's first attempts do better;
 *   pot      10%, the rake on every entry.
 * So rakeback is 0.2% of run bets, 1% of special entries and 2% of pot entries. With the mission rewards (at most
 * 0.5% of play, src/missions.cjs) a run bet gives back 0.7% at most, under the 1% the house keeps from a good player,
 * so the house keeps its edge however fast anyone levels up. Levelling only decides when rakeback can be claimed,
 * never how much there is, so nothing is gained by faking a level.
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

  // ---- rakeback: { acc (building up), ready (released, waiting to be claimed), paid (claimed so far) }
  const RATE = 0.2;
  const CUT = { run: 0.01, special: 0.05, pot: 0.1 };
  const BACK = { run: RATE * CUT.run, special: RATE * CUT.special, pot: RATE * CUT.pot };
  function fix(s) {
    s = s && typeof s === 'object' ? s : {};
    for (const k of ['acc', 'ready', 'paid']) if (!(s[k] > 0)) s[k] = 0;
    return s;
  }
  // a bet of some kind was placed
  function add(s, kind, amount) { s = fix(s); s.acc += amount * (BACK[kind] || 0); return s; }
  // a level up: what has built up is released to claim (whole: in whole units, the rest keeps building)
  function release(s, whole) { s = fix(s); const x = whole ? Math.floor(s.acc) : s.acc; s.acc -= x; s.ready += x; return x; }
  // the player claims what is ready
  function claim(s) { s = fix(s); const x = s.ready; s.ready = 0; s.paid += x; return x; }

  return { NEED_BASE, NEED_STEP, MAX, xpNeed, lvlOf, stepsOf, fromOld, runXp, specialXp, RATE, CUT, BACK, fix, add, release, claim };
});
