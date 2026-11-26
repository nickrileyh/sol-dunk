// Measures the daily pot's courses (src/pots.cjs): for each theme, how far each of the game's bots gets on it, and how
// often one flies all of it. The pot ranks attempts by rings, so a course has to spread players out and end nearly
// everyone: the aim is novices at a handful of rings, average players around ten, pros in the twenties, and even perfect
// play not finishing every time. Run it after a change to the engine, the bot, src/duel.cjs's course or a theme.
//
//   node sim/pots.cjs [flights per theme and skill = 150]
const E = require('../src/engine.cjs'), B = require('../src/bot.cjs'), PT = require('../src/pots.cjs');
const N = +process.argv[2] || 150, t0 = Date.now();
console.log(`rings passed on the pot's ${PT.RINGS}-ring course, 10th / 50th / 90th percentile (and how often all of it), ${N} flights each`);
for (const T of PT.THEMES) {
  const rows = [];
  for (const s of Object.keys(B.SKILLS)) {
    const rs = [];
    let all = 0;
    for (let i = 0; i < N; i++) {
      const st = E.createState(PT.course('m' + (i % 12), T)), bot = B.createBot(s, E.makeRng('pb|' + s + '|' + i));
      let tap = true;
      while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); }
      rs.push(st.outcomes.length); if (st.result === 'clear') all++;
    }
    rs.sort((a, b) => a - b);
    const q = (p) => rs[Math.floor(p * (N - 1))];
    rows.push(`${s} ${q(0.1)}/${q(0.5)}/${q(0.9)}${all ? ' (' + Math.round((100 * all) / N) + '%)' : ''}`);
  }
  console.log(T.name.padEnd(11), rows.join(' | '));
}
console.log(`time ${Math.round((Date.now() - t0) / 1000)} s`);
