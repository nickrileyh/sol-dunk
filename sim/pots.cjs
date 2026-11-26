// Pot challenge odds: the chance that one run makes each challenge, for casual, average and good players.
// Runs start on level 1 of the challenge's own tier and play on until they bust (or clear all 8 levels).
// Prints each challenge's measured chance next to its p in src/pots.cjs; copy the new numbers in after a
// physics change. Extra challenges can be tried as kind:n@tier (kinds: best, swishes, score, perfect, clears,
// greens, hot, comeback, early).
//   node sim/pots.cjs [runs per skill, default 20000] [best:7@1,score:90@1,...]
const E = require('../src/engine.cjs');
const B = require('../src/bot.cjs');
const P = require('../src/pots.cjs');

const N = +(process.argv[2] || 20000);
const extra = (process.argv[3] || '').split(',').filter(Boolean).map((s) => {
  const [kn, tier] = s.split('@'), [kind, n] = kn.split(':');
  return { id: `${kind}${n}@${tier}`, kind, n: +n, tier: +tier, text: 'try', p: null };
});
const SKILLS = ['casual', 'average', 'good'];

function playLevel(seed, di, L, skill, botSeed) {
  const st = E.createState(E.generateLevel(seed, di, L));
  const bot = B.createBot(skill, E.makeRng(botSeed));
  let tap = true; // the first tap starts the level
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); }
  return { outcomes: st.outcomes.join(''), clear: st.result === 'clear' };
}

const goals = P.GOALS.concat(extra), t0 = Date.now();
console.log(`engine v${E.VERSION}, ${N} runs per skill   chance per run [casual, average, good]   aim: average 4-15%, good 25-50%`);
for (const tier of [...new Set(goals.map((g) => g.tier))].sort()) {
  const here = goals.filter((g) => g.tier === tier), got = {};
  for (const sk of SKILLS) {
    const hit = Object.fromEntries(here.map((g) => [g.id, 0]));
    for (let i = 0; i < N; i++) {
      const levels = [];
      for (let L = 1; L <= E.LEVELS; L++) {
        const r = playLevel(`pot|${tier}|${sk}|${i}|${L}`, tier, L, sk, `potb|${tier}|${sk}|${i}|${L}`);
        levels.push(r);
        if (!r.clear) break;
      }
      for (const g of here) if (P.progress(g, levels, tier).done) hit[g.id]++;
    }
    for (const g of here) (got[g.id] = got[g.id] || []).push(+(hit[g.id] / N).toFixed(3));
  }
  for (const g of here) {
    const [, avg, good] = got[g.id], ok = avg >= 0.04 && avg <= 0.15 && good >= 0.25 && good <= 0.5;
    console.log(`${g.id.padEnd(12)} ${P.TIER_NAMES[tier].padEnd(9)} ${JSON.stringify(got[g.id]).padEnd(22)} p now ${JSON.stringify(g.p)}${ok ? '' : '   outside the aim'}`);
  }
}
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
