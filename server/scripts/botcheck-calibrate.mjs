#!/usr/bin/env node
// How the tap-precision check (lib/botcheck.mjs) scores the game's bots: the spread of drop points per skill, and the
// score a player of each skill reaches after 80, 150 and 300 rings. A human-like skill should stay well under the
// review threshold (BOT_SCORE_REVIEW, 0.8); the perfect bot should pass it.
//   node scripts/botcheck-calibrate.mjs [levels per skill, default 200]
import { createRequire } from 'node:module';
import { levelSignals, addSignals, botScore } from '../lib/botcheck.mjs';

const require = createRequire(import.meta.url);
const E = require('../../src/engine.cjs');
const B = require('../../src/bot.cjs');
const N = Number(process.argv[2]) || 200;

for (const di of [0, 1]) {
  for (const skill of ['novice', 'average', 'good', 'pro', 'perfect']) {
    let stats = null, rings = 0;
    const at = {};
    for (let k = 0; k < N; k++) {
      const L = 1 + (k % 8), def = E.generateLevel(`cal:${di}:${skill}:${k}`, di, L);
      const st = E.createState(def), bot = B.createBot(skill, E.makeRng('c' + k)), taps = [0];
      let tap = true;
      while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); }
      const sig = levelSignals(def, taps);
      stats = addSignals(stats, sig); rings += sig.offs.length;
      for (const m of [80, 150, 300]) if (!at[m] && rings >= m) at[m] = botScore(stats).score;
    }
    const s = botScore(stats);
    console.log(`${E.DIFFS[di].name.padEnd(5)} ${skill.padEnd(8)} rings ${String(rings).padStart(5)}  spread ${s.sd}  swish ${s.swishRate}  score@80 ${at[80]}  @150 ${at[150]}  @300 ${at[300]}  final ${s.score}`);
  }
}
