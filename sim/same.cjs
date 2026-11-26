// Does a change leave the game playing exactly as it did?
//
// Plays regular levels and special courses with every bot and prints one digest of every tap and outcome. Run it in
// two checkouts (or before and after a change): the same digest means the engine, the bot and the generators play
// those levels tap for tap the same, so their measured tables still hold. Engine v16 (walls, which only special
// courses have) was checked this way against v15, and a full sim/run.cjs then gave the same counts in every row.
//
//   node sim/same.cjs [root of a checkout = this one] [twists = a few without walls]
const path = require('path'), crypto = require('crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const E = require(root + '/src/engine.cjs'), B = require(root + '/src/bot.cjs'), SP = require(root + '/src/special.cjs');
const twists = (process.argv[3] || 'gauntlet,tilt,needle,stairs,ripple,slowmo').split(',').filter((id) => SP.BY[id]);
const h = crypto.createHash('sha256');
let n = 0;
function play(lv, skill, seed) {
  const st = E.createState(lv), bot = B.createBot(skill, E.makeRng('b|' + skill + '|' + seed)), taps = [];
  let tap = true;
  while (!st.done) { if (tap) taps.push(st.tick); E.step(st, tap); tap = B.decide(bot, st); }
  h.update(taps.join(',') + '|' + st.result + '|' + st.missKind + '|' + st.outcomes.join('') + ';'); n++;
}
for (const skill of Object.keys(B.SKILLS)) for (let i = 0; i < 60; i++) {
  for (let di = 0; di < E.DIFFS.length; di++) for (const L of [1, 4, 8]) play(E.generateLevel('s' + i, di, L), skill, i);
  for (const id of twists) for (const g of [0, 4, SP.GRADES.length - 1]) play(SP.generate('s' + i, id, g, 12), skill, i);
}
console.log(`engine v${E.VERSION}: ${n} plays (regular levels and ${twists.join(', ')}), digest ${h.digest('hex').slice(0, 16)}`);
