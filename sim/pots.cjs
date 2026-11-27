// Measures the daily pot's courses (src/pots.cjs): for each theme, how far each of the game's bots gets on it, what it
// scores, and how often one flies all of it. The pot ranks attempts by score (then rings), so a course has to spread
// players out and end nearly everyone: the aim is novices at a handful of rings, average players around ten, pros in
// the twenties, scores that keep climbing with skill, and even perfect play not finishing every time. Run it after a
// change to the engine, the bot, src/duel.cjs's course or a theme.
//
//   node sim/pots.cjs [flights per theme and skill = 150]
const E = require('../src/engine.cjs'), B = require('../src/bot.cjs'), PT = require('../src/pots.cjs'), DU = require('../src/duel.cjs');
const N = +process.argv[2] || 150, t0 = Date.now();
console.log(`the pot's ${PT.RINGS}-ring course, ${N} flights for each theme and skill: rings passed and score, 10th / 50th / 90th percentile (and how often all of it)`);
const SK = Object.keys(B.SKILLS);
for (const T of PT.THEMES) {
  const rows = [], scores = [];
  for (const s of SK) {
    const rs = [], ss = [];
    let all = 0;
    for (let i = 0; i < N; i++) {
      const st = E.createState(PT.course('m' + (i % 12), T)), bot = B.createBot(s, E.makeRng('pb|' + s + '|' + i));
      let tap = true;
      while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); }
      rs.push(st.outcomes.length); ss.push(DU.score(st.outcomes)); if (st.result === 'clear') all++;
    }
    rs.sort((a, b) => a - b); ss.sort((a, b) => a - b);
    const q = (a, p) => a[Math.floor(p * (N - 1))];
    rows.push(`${s.padEnd(8)} rings ${q(rs, 0.1)}/${q(rs, 0.5)}/${q(rs, 0.9)}${all ? ' (' + Math.round((100 * all) / N) + '%)' : ''}`.padEnd(32) + `score ${q(ss, 0.1)}/${q(ss, 0.5)}/${q(ss, 0.9)}`);
    scores.push(q(ss, 0.5));
  }
  console.log(T.name + ':');
  for (const r of rows) console.log('  ' + r);
  // a pot that ranks by score has to put the skills in order
  console.log('  medians in order of skill: ' + (scores.every((v, i) => !i || v >= scores[i - 1]) ? 'yes' : 'NO ' + scores.join(' ')));
}
console.log(`time ${Math.round((Date.now() - t0) / 1000)} s`);
