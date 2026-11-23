// Core simulation: one level attempt by a bot. Returns a compact outcome pattern.
const E = require('../src/engine.cjs');
const B = require('../src/bot.cjs');

function playLevel(seed, di, L, skillName, botSeed) {
  const level = E.generateLevel(seed, di, L);
  const st = E.createState(level);
  const bot = B.createBot(skillName, E.makeRng(botSeed));
  let tap = true; // the first tap starts the level
  while (!st.done) {
    E.step(st, tap);
    tap = B.decide(bot, st);
  }
  return { result: st.result, outcomes: st.outcomes.join(''), missKind: st.missKind, ticks: st.tick, flaps: st.flaps };
}

// Run n attempts of (di, L, skill); returns pattern counts keyed "OUTCOMES|result".
function batch(di, L, skillName, n, salt) {
  const counts = Object.create(null);
  const miss = Object.create(null);
  for (let i = 0; i < n; i++) {
    const r = playLevel('s' + salt + '-' + i, di, L, skillName, 'b' + salt + '-' + skillName + '-' + i);
    const key = r.outcomes + '|' + (r.result === 'clear' ? 'C' : 'X');
    counts[key] = (counts[key] || 0) + 1;
    if (r.result !== 'clear') { const mk = r.result === 'floor' ? 'floor' : r.missKind; miss[mk] = (miss[mk] || 0) + 1; }
  }
  return { di, L, skill: skillName, n, counts, miss };
}

// Summary stats from pattern counts
function summarize(res) {
  let hoopsTried = 0, passed = 0, swish = 0, clears = 0;
  for (const key in res.counts) {
    const c = res.counts[key];
    const [o, r] = key.split('|');
    passed += o.length * c;
    for (const ch of o) if (ch === 'S') swish += c;
    hoopsTried += (o.length + (r === 'C' ? 0 : 1)) * c;
    if (r === 'C') clears += c;
  }
  return { pass: passed / hoopsTried, swish: swish / Math.max(1, passed), clear: clears / res.n };
}

module.exports = { playLevel, batch, summarize };
