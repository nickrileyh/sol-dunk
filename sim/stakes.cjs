// Checks the special levels' stakes (src/special.cjs): a player picks a stake from SP.STAKES, the prize is the stake
// times the multiple, and each stake keeps its own level at each prize. This plays ways a player could pick stakes,
// each attempt on the course set for their level at that stake, with the chance of clearing it from the simulator's
// fitted curves (no flying, so it's quick), and prints what each gets back of everything staked.
//
//   node sim/stakes.cjs [players per row = 2000] [attempts = 60] [--twists=gauntlet,zigzag,wave] [--weighted]
//                       [--net] [--max=0.2]
//
// --net prints the SOL each player came out ahead (+) or behind instead of the return; --max drops the stakes above it.
//
// A way of picking stakes that came out ahead of the house would show a return over 100% for a player the scale
// covers (novice to pro); "past pro" is past the top of the scale and keeps winning however stakes work (the server
// limits those accounts). --weighted plays the design that was tried first and dropped instead: one level per prize,
// moved by stake ÷ the biggest stake played there (at least 0.05), stakes rising at most a quarter an attempt.
const SP = require('../src/special.cjs');
const E = require('../src/engine.cjs');

const args = process.argv.slice(2), nums = args.filter((a) => /^\d+$/.test(a));
const PLAYERS = +(nums[0] || 2000), ATTEMPTS = +(nums[1] || 60);
const tw = (args.find((a) => a.startsWith('--twists=')) || '').slice(9);
const TWISTS = tw ? tw.split(',') : ['gauntlet', 'zigzag', 'wave'];
const WEIGHTED = args.includes('--weighted'), NET = args.includes('--net');
const top = (args.find((a) => a.startsWith('--max=')) || '').slice(6);
if (top) SP.STAKES.splice(SP.STAKES.findIndex((x) => x > +top + 1e-9) >>> 0);
const SKILLS = [['novice', 0], ['average', 2], ['good', 3], ['pro', 4], ['past pro', 4.5]];
const ST = SP.STAKES, LO = ST[0], HI = ST[ST.length - 1];

// the dropped design, for comparison: one level per prize, weighted by stake ÷ reference
const W = {
  ref: (R, slot) => Math.max(0.05, (R.wref && R.wref[slot]) || 0),
  cap: (R, slot) => W.ref(R, slot) * 1.25,
  level: (R, slot) => SP.levelOf(R, slot),
  add(R, slot, won, stake) {
    const w = Math.min(1.25, stake / W.ref(R, slot)), d = SP.levelOf(R, slot);
    R.d[slot] = Math.max(SP.D_MIN, Math.min(SP.D_MAX, d + w * (won ? SP.up(SP.SLOTS[slot]) : -SP.DOWN)));
    R.wref = R.wref || [0, 0, 0]; R.wref[slot] = Math.max(R.wref[slot], stake);
  }
};
const level = (R, slot, stake) => (WEIGHTED ? W.level(R, slot) : SP.levelOf(R, slot, stake));
const clampStake = (R, slot, s) => (WEIGHTED ? Math.max(LO, Math.min(W.cap(R, slot), s)) : s);

function attempt(R, slot, recipe, skill, stake, rng, lose) {
  const x = SP.SLOTS[slot], c = SP.courseFor(level(R, slot, stake), recipe, x);
  const won = !lose && rng() < SP.clearP(recipe, c.g, c.n, skill);
  if (WEIGHTED) W.add(R, slot, won, stake); else SP.addSpecial(R, slot, won, won ? c.n : 0, stake);
  return won;
}

// ways to pick a stake: (record, slot, attempt number, true skill, state) => { stake, lose }
const biggest = (R, slot) => (WEIGHTED ? W.cap(R, slot) : HI);
const S = {
  'plays well, always 0.05': () => ({ stake: 0.05 }),
  'plays well, up a stake every 8 attempts': (R, slot, i) => ({ stake: ST[Math.min(ST.length - 1, Math.floor(i / 8))] }),
  'plays well, as big as allowed': (R, slot) => ({ stake: biggest(R, slot) }),
  'loses 15 at the smallest, then plays big': (R, slot, i) => (i < 15 ? { stake: LO, lose: true } : { stake: biggest(R, slot) }),
  'loses 10 at 0.05, then plays big': (R, slot, i) => (i < 10 ? { stake: 0.05, lose: true } : { stake: biggest(R, slot) }),
  'big only while its level is under their skill': (R, slot, i, k) => (level(R, slot, biggest(R, slot)) < k ? { stake: biggest(R, slot) } : { stake: LO }),
  'big right after a miss, smallest after a clear': (R, slot, i, k, st) => ({ stake: st.lastMiss ? biggest(R, slot) : LO }),
};

console.log(`${WEIGHTED ? 'DROPPED DESIGN (one level, weighted by stake). ' : ''}${PLAYERS} players a row, ${ATTEMPTS} attempts each at one prize; twists ${TWISTS.join(', ')} at 2x, 3x, 5x`);
console.log(`stakes ${ST.join(', ')} SOL; return = all prizes / all stakes, so 90% means the house keeps 10%\n`);
for (const start of ['at their skill', 'at 1.8, hiding their skill']) {
  console.log(`--- levels starting ${start}`);
  console.log('way of picking stakes'.padEnd(48) + SKILLS.map(([n]) => n.padStart(10)).join(''));
  for (const [name, f] of Object.entries(S)) {
    let line = name.padEnd(48);
    for (const [, k] of SKILLS) {
      let staked = 0, back = 0;
      for (let pl = 0; pl < PLAYERS; pl++) {
        const slot = pl % 3, recipe = TWISTS[slot % TWISTS.length];
        const rng = E.makeRng('stakes|' + name + '|' + k + '|' + pl), R = SP.blank(), st = { lastMiss: false };
        R.d[slot] = start === 'at their skill' ? k : 1.8;
        for (let i = 0; i < ATTEMPTS; i++) {
          const pick = f(R, slot, i, k, st), s = clampStake(R, slot, pick.stake);
          const won = attempt(R, slot, recipe, k, s, rng, pick.lose);
          staked += s; if (won) back += s * SP.SLOTS[slot];
          st.lastMiss = !won;
        }
      }
      line += (NET ? `${((back - staked) / PLAYERS >= 0 ? '+' : '') + ((back - staked) / PLAYERS).toFixed(2)}` : `${(back / staked * 100).toFixed(0)}%`).padStart(10);
    }
    console.log(line);
  }
  console.log('');
}
