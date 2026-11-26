// Mission rounds: how many runs a casual, an average and a good player need to finish each round of daily missions,
// and how far a week of play gets through the weekly rounds. Also checks the rule the SOL rests on: at every moment
// a window has paid no more than its share of what was played in it.
// Runs are on Easy, from level 1, and end at a miss or with a cash out after level STOP (default 3).
//   node sim/missions.cjs [days per skill, default 60] [runs a day, default 40] [stop level, default 3]
const E = require('../src/engine.cjs');
const B = require('../src/bot.cjs');
const MS = require('../src/missions.cjs');

const DAYS = +(process.argv[2] || 60), RUNS = +(process.argv[3] || 40), STOP = +(process.argv[4] || 3), DI = 0, BET = 0.25;
const SKILLS = ['casual', 'average', 'good'];
const t0 = Date.now(), START = Date.parse('2027-01-04T12:00:00Z'); // a Monday

function playLevel(seed, L, skill) {
  const def = E.generateLevel(seed, DI, L), st = E.createState(def);
  const bot = B.createBot(skill, E.makeRng('b|' + seed));
  let tap = true;
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); }
  return { outcomes: st.outcomes.join(''), clear: st.result === 'clear', mov: st.outcomes.map((o, k) => (def.hoops[k].amp ? '1' : '0')).join('') };
}
function playRun(key, skill) {
  const levels = [];
  for (let L = 1; L <= Math.min(STOP, E.LEVELS); L++) { const r = playLevel(key + '|' + L, L, skill); levels.push(r); if (!r.clear) break; }
  return levels;
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
let worst = 0;
function inside(s) { // released so far (ready to claim or claimed) against the share of what was played, per window
  for (const [win, list, played] of [['day', s.d, s.dp], ['week', s.w, s.wp]]) {
    const paid = list.reduce((a, m, i) => a + (m.paid ? MS.reward(win, i % 3, null, Math.floor(i / 3)) : 0), 0);
    if (played > 0) worst = Math.max(worst, paid / (played * MS.SHARES[win]));
    if (paid > played * MS.SHARES[win] + 1e-9) throw new Error(`${win}: paid ${paid} on ${played} played`);
  }
}

console.log(`engine v${E.VERSION}, Easy, ${DAYS} days per skill, up to ${RUNS} runs a day, cash out after level ${STOP}, ${BET} SOL a run`);
console.log(`needs a day ${MS.STEPS.map((x) => MS.NEED.day * x).join(' / ')} SOL, a week ${MS.STEPS.map((x) => MS.NEED.week * x).join(' / ')} SOL; rewards a day ${MS.STEPS.map((x, r) => +(MS.NEED.day * MS.SHARES.day * (x - (r ? MS.STEPS[r - 1] : 0))).toFixed(4)).join(' / ')} SOL, a week ${MS.STEPS.map((x, r) => +(MS.NEED.week * MS.SHARES.week * (x - (r ? MS.STEPS[r - 1] : 0))).toFixed(4)).join(' / ')} SOL\n`);
console.log('daily rounds: runs needed to finish round 1 / 2 / 3 (median over the days it was finished), and the share of days it was');
for (const sk of SKILLS) {
  const at = [[], [], []], slow = {};
  let s = null, weekRounds = [], weekDays = [];
  for (let d = 0; d < DAYS; d++) {
    const ts = START + d * MS.DAY_MS;
    for (let i = 0; i < RUNS; i++) {
      s = MS.play(s, BET, ts).s; inside(s);
      const before = s.d.length / 3, r = MS.run(s, playRun(`m|${sk}|${d}|${i}`, sk), ts);
      s = r.s; inside(s);
      const done = s.d.length / 3 - 1 + (s.d.length === 3 * MS.ROUNDS && s.d.slice(-3).every((m) => m.done) ? 1 : 0);
      for (let k = before - 1; k < done; k++) if (at[k].length <= d || at[k]._d !== d) { at[k].push(i + 1); at[k]._d = d; }
      if (done === MS.ROUNDS) break;
    }
    // what held the day up: the open round's unfinished missions
    const open = MS.view(s, ts).daily.filter((m) => !m.done);
    for (const m of open) slow[m.k + ':' + m.n] = (slow[m.k + ':' + m.n] || 0) + 1;
    if (d % 7 === 6) { const v = MS.view(s, ts); weekRounds.push(v.round.week + (v.weekly.every((m) => m.done) ? 1 : 0)); weekDays.push(v.days); }
  }
  const stuck = Object.entries(slow).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ×${n}`).join(', ');
  console.log(`${sk.padEnd(8)} ${at.map((a) => `${String(med(a) == null ? '-' : med(a)).padStart(3)} runs (${String(Math.round(a.length / DAYS * 100)).padStart(3)}%)`).join('   ')}   left open most: ${stuck || 'nothing'}`);
  console.log(`${''.padEnd(8)} weekly rounds finished by Sunday: ${weekRounds.join(' ')}   days with a daily round: ${weekDays.join(' ')}`);
}
console.log(`\nmost a window had paid against its share of the play: ${(worst * 100).toFixed(1)}% (never over 100%)`);
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
