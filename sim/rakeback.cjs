// Checks rakeback (src/levels.cjs): every level up releases a share of what the player lost since the last one, net of
// what they won, plus a very small share of every bet. A share of losses pays a player for the swings (a loss is paid
// back at once, a win is kept), so this plays ways of betting that lean on that, for each of the simulator's skills,
// and prints what the house keeps of everything bet after rakeback, mission SOL and trophy SOL.
//
//   node sim/rakeback.cjs [accounts per row = 400] [runs per account = 300] [--xp=2] [--flat] [--old] [--rated=2.2,3]
//
// Each run is played from the levels the bots really flew (sim/out/patterns.json, written by sim/run.cjs: every ring's
// outcome on every level, for each skill), paid by the live tables, so it's quick. Each account is new: it starts at
// level 1, where levels come quickly. --xp scales the XP a run earns (missions add XP too, and the more XP, the more
// level ups, the shorter each level's window and the more a share of losses pays; 2 is about a player who finishes
// their missions). Mission SOL and trophy SOL are counted at the most they can pay (0.5% of every bet; 0.2% of every
// bet up to 0.085 SOL), so the house's real edge is a little better than printed. --flat counts every ring the same
// in the rating, whatever its run's bet; --old plays the rakeback from before (20% of the house's cut of every bet).
//
// A way of betting that beats the house shows a negative "house keeps" for a skill the tables are priced for (novice
// to good). Pros beat the regular tables deep into a run with or without rakeback; they're shown for reference.
const E = require('../src/engine.cjs');
const PAY = require('../src/paytable.cjs');
const LV = require('../src/levels.cjs');
const SP = require('../src/special.cjs');
const DATA = require('./out/patterns.json');

const args = process.argv.slice(2), nums = args.filter((a) => /^\d+$/.test(a));
const ACCOUNTS = +(nums[0] || 400), RUNS = +(nums[1] || 300);
const XPM = +((args.find((a) => a.startsWith('--xp=')) || '').slice(5) || 2);
const FLAT = args.includes('--flat'), OLD = args.includes('--old');
const rated = (args.find((a) => a.startsWith('--rated=')) || '').slice(8); // try other ratings for the share's fall, e.g. --rated=2.2,2.8
if (rated) rated.split(',').forEach((x, i) => { LV.RATED[i] = +x; });
const SKILLS = ['novice', 'casual', 'average', 'good', 'pro'];
const BET = 0.1;

// ---- the levels the bots flew: for each skill, tier and level, every pattern of outcomes and how often it came up
const TAB = {};
for (const d of DATA) {
  const list = [];
  let c = 0;
  for (const k in d.counts) {
    const [o, r] = k.split('|');
    c += d.counts[k] / d.n;
    list.push({ o, clear: r === 'C', c });
  }
  TAB[d.key + '|' + d.di + '|' + d.L] = list;
}
function sample(key, di, L, u) {
  const list = TAB[key + '|' + di + '|' + L];
  for (const x of list) if (u < x.c) return x;
  return list[list.length - 1];
}
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// one run: cash out at checkpoint cashAt (8 plays every level); returns the multiplier paid (0 for a bust), the levels
// flown (for the rating) and the XP it earns (points + 5 a cleared level + 15 a perfect one)
function run(key, di, cashAt, rng) {
  let total = 1, streak = 0, xp = 0;
  const levels = [];
  for (let L = 1; L <= E.LEVELS; L++) {
    const p = sample(key, di, L, rng());
    const a = E.applyLevel(PAY.PAYTABLE[di][L - 1], p.o, total, E.DIFFS[di].maxWin, streak);
    let swishes = 0;
    for (const st of a.steps) { xp += st.o === 'S' ? Math.min(1 + st.streak, 6) : 1; if (st.o === 'S') swishes++; }
    if (a.capped) { levels.push({ L, passes: a.capIndex + 1, missed: false }); return { m: a.total, levels, xp }; }
    if (!p.clear) { levels.push({ L, passes: p.o.length, missed: true }); return { m: 0, levels, xp }; }
    const perfect = swishes === p.o.length;
    xp += 5 + (perfect ? 25 : 0); // a perfect level: +10 points and +15 XP
    levels.push({ L, passes: p.o.length, missed: false });
    total = a.total; streak = a.streak;
    if (L === cashAt) return { m: total, levels, xp };
  }
  return { m: total, levels, xp };
}

// What a bet pays on average, exactly: the money-weighted streak carried level to level through every pattern the bots
// flew (as sim/calibrate.cjs does; no max-win cap, so a little more than the game pays deep on Hard). The house's edge
// on a bet doesn't depend on what came before it, so an account's expected take is its bets times these, and only
// rakeback has to be sampled: comparing sampled payouts instead would drown it in the noise of 1000x wins.
const RTP = {};
function rtp(key, di, cashAt) {
  const id = key + '|' + di + '|' + cashAt;
  if (RTP[id] != null) return RTP[id];
  let mass = [1, 0, 0, 0, 0, 0];
  for (let L = 1; L <= cashAt; L++) {
    const next = [0, 0, 0, 0, 0, 0];
    let prev = 0;
    for (const x of TAB[key + '|' + di + '|' + L]) {
      const p = x.c - prev; prev = x.c;
      if (!x.clear) continue;
      for (let s0 = 0; s0 < 6; s0++) {
        if (!mass[s0]) continue;
        const a = E.applyLevel(PAY.PAYTABLE[di][L - 1], x.o, 1, null, s0);
        next[Math.min(5, a.streak)] += mass[s0] * p * a.total;
      }
    }
    mass = next;
  }
  return (RTP[id] = mass.reduce((u, v) => u + v, 0));
}

// ways of betting: next(state) => { di, cashAt, bet, key? } (key: the skill the run is flown at, if not the player's)
const H = 1, Z = 0;
const W = {
  'Easy, cash out at checkpoint 1': () => ({ di: Z, cashAt: 1, bet: BET }),
  'Easy, checkpoint 3': () => ({ di: Z, cashAt: 3, bet: BET }),
  'Easy, every level': () => ({ di: Z, cashAt: 8, bet: BET }),
  'Hard, checkpoint 1': () => ({ di: H, cashAt: 1, bet: BET }),
  'Hard, checkpoint 2': () => ({ di: H, cashAt: 2, bet: BET }),
  'Hard, checkpoint 3': () => ({ di: H, cashAt: 3, bet: BET }),
  'Hard, every level': () => ({ di: H, cashAt: 8, bet: BET }),
  'Hard: 3 at checkpoint 1, then every level': (st) => ({ di: H, cashAt: st.i % 4 === 3 ? 8 : 1, bet: BET }),
  'Hard: 3 at checkpoint 1, then every level at 3x': (st) => (st.i % 4 === 3 ? { di: H, cashAt: 8, bet: 3 * BET } : { di: H, cashAt: 1, bet: BET }),
  'Hard: 10 at checkpoint 1, then every level at 5x': (st) => (st.i % 11 === 10 ? { di: H, cashAt: 8, bet: 5 * BET } : { di: H, cashAt: 1, bet: BET }),
  'Hard checkpoint 1, double after each bust': (st) => ({ di: H, cashAt: 1, bet: BET * Math.min(8, 2 ** st.busts) }),
  'Hard every level, stop after a 10x win': () => ({ di: H, cashAt: 8, bet: BET, stopAt: 10 }),
  'Easy every level, stop after a 10x win': () => ({ di: Z, cashAt: 8, bet: BET, stopAt: 10 }),
  // hiding skill: 200 cheap runs flown badly (as a novice) to pull the rating down, then the mixed way above
  'hides skill (200 cheap bad runs), then 3 + every level': (st) => (st.i < 200 ? { di: Z, cashAt: 1, bet: BET / 100, key: 'novice' } : { di: H, cashAt: (st.i - 200) % 4 === 3 ? 8 : 1, bet: BET }),
};

function account(key, way, rng) {
  const rb = LV.fix({});
  let xp = 0, steps = LV.stepsOf(0), bets = 0, pays = 0, take = 0, back = 0, oldBack = 0;
  const st = { i: 0, busts: 0 };
  for (; st.i < RUNS; st.i++) {
    const w = W[way](st), k = w.key || key;
    bets += w.bet; take += w.bet * (1 - rtp(k, w.di, w.cashAt));
    LV.add(rb, 'run', w.bet);
    oldBack += w.bet * 0.002;
    const r = run(k, w.di, w.cashAt, rng), paid = w.bet * r.m;
    pays += paid;
    LV.pay(rb, 'run', paid);
    for (const l of r.levels) LV.rings(rb, w.di, l.L, l.passes, l.missed, FLAT ? 1 : w.bet);
    st.busts = r.m === 0 ? st.busts + 1 : 0;
    xp += r.xp * XPM;
    const now = LV.stepsOf(xp);
    if (now > steps) { steps = now; LV.rate(rb, SP.regular(LV.recOf(rb)).m); back += LV.release(rb, false); }
    if (w.stopAt && r.m >= w.stopAt) { st.i++; break; }
  }
  if (OLD) back = oldBack;
  const ms = 0.005 * bets, tr = Math.min(0.002 * bets, 0.085);
  return { bets, pays, take, back, ms, tr, m: SP.regular(LV.recOf(rb)).m };
}

const t0 = Date.now();
console.log(`rakeback: ${OLD ? 'before (20% of the house\'s cut of every bet)' : `${LV.LOSS * 100}% of net losses (run losses: ${LV.LOSS * 100}% down to ${LV.LOSS_TOP * 100}% for ratings ${LV.RATED[0]} to ${LV.RATED[1]}) + ${LV.VOL * 100}% of bets, at most ${LV.CAP * 100}% of a level's bets`}${FLAT ? ', unweighted rating' : ''}`);
console.log(`${ACCOUNTS} new accounts per row, up to ${RUNS} runs each at ${BET} SOL, XP x${XPM}; mission SOL and trophy SOL counted at their most\n`);
const pad = (s, n) => (String(s) + ' '.repeat(n)).slice(0, n), lpad = (s, n) => (' '.repeat(n) + s).slice(-n);
const rows = [];
let worst = Infinity, worstAt = '';
for (const way of Object.keys(W)) {
  const row = { way, c: [] };
  for (const key of SKILLS) {
    const rng = rng32(7 + key.length * 131 + way.length * 7919);
    let b = 0, p = 0, tk = 0, bk = 0, ms = 0, tr = 0, mm = 0;
    for (let a = 0; a < ACCOUNTS; a++) { const x = account(key, way, rng); b += x.bets; p += x.pays; tk += x.take; bk += x.back; ms += x.ms; tr += x.tr; mm += x.m; }
    const keep = (tk - bk - ms - tr) / b;
    row.c.push({ edge: tk / b, keep, back: bk / b, ofLoss: tk > 0 ? bk / tk : NaN, m: mm / ACCOUNTS });
    if (key !== 'pro' && keep < worst) { worst = keep; worstAt = `${way}, ${key}`; }
  }
  rows.push(row);
}
function table(title, f) {
  console.log(title);
  console.log(pad('', 54) + SKILLS.map((k) => lpad(k, 9)).join(''));
  for (const r of rows) console.log(pad(r.way, 54) + r.c.map((c) => lpad(f(c), 9)).join(''));
  console.log('');
}
table('the house keeps, % of everything bet, after rakeback, mission SOL and trophy SOL', (c) => (c.keep * 100).toFixed(2));
table('the house\'s edge before any reward, %', (c) => (c.edge * 100).toFixed(2));
table('rakeback, % of everything bet (it was 0.2% of run bets)', (c) => (c.back * 100).toFixed(2));
table('rakeback, % of what the player lost on average', (c) => (c.ofLoss > 0 ? (c.ofLoss * 100).toFixed(1) : '-'));
table('rating at the end (special levels\' scale: 0 novice, 1 casual, 2 average, 3 good, 4 pro)', (c) => c.m.toFixed(2));
console.log(`least the house keeps from novice to good: ${(worst * 100).toFixed(2)}% (${worstAt})`);
console.log(`time ${((Date.now() - t0) / 1000).toFixed(0)}s`);
