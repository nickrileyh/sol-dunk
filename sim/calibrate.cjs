// Calibrate payout tables so the AVERAGE player returns TARGET (90%) at every checkpoint.
//
//   node sim/calibrate.cjs [patterns.json] [--target 0.9] [--write]
//
// Method
//   Each level's per-hoop multipliers are 1 + b * w, where w is a fixed weight per outcome
//   (rim, swish streak 1..5+) and b is solved per (difficulty, level).
//   We carry the money-weighted distribution of "streak at checkpoint" from level to level
//   (the fire streak carries over when you keep playing), and solve b so that
//       E[ total multiplier * 1{reached checkpoint L} ] = TARGET   for every L.
//   That makes the average player's return the same whichever checkpoint they cash out at:
//   level 1 holds the house edge, every later level is break-even for the average player.
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.cjs');

const args = process.argv.slice(2);
const file = args.find(a => a.endsWith('.json')) || 'patterns.json';
const TARGET = +(args[args.indexOf('--target') + 1] || 0.9) || 0.9;
const WRITE = args.includes('--write');
// --mode flat      : average player returns TARGET at every checkpoint (strategy-proof)
// --mode perlevel  : every level is its own bet with edge (1-TARGET) for the average player
// --mode guard     : perlevel, but also caps a GOOD player's per-level return at --guard (default 1.0)
// --mode house     : (default) average player gets TARGET at checkpoint 1; every later level is
//                    priced so a GOOD player breaks even on it (GUARD), never paying less per
//                    hoop than the level before. Level 1 is also capped at GUARD1 for good players.
const MODE = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : 'house';
const GUARD = args.includes('--guard') ? +args[args.indexOf('--guard') + 1] : 1.0;
const GUARD1 = args.includes('--guard1') ? +args[args.indexOf('--guard1') + 1] : 1.08;
const GUARD_FROM = args.includes('--guard-from') ? +args[args.indexOf('--guard-from') + 1] : 2;

const W_RIM = 0.5;
const W_SW = [1.0, 1.2, 1.4, 1.6, 1.8];
const STREAK_CAP = W_SW.length;

const data = JSON.parse(fs.readFileSync(path.isAbsolute(file) ? file : path.join(__dirname, 'out', file)));
const byKey = {};
for (const d of data) byKey[d.key + '|' + d.di + '|' + d.L] = d;

function patterns(key, di, L) {
  const d = byKey[key + '|' + di + '|' + L];
  if (!d) throw new Error('missing ' + key + ' ' + di + ' ' + L);
  const out = [];
  for (const k in d.counts) {
    const [o, r] = k.split('|');
    out.push({ o, clear: r === 'C', c: d.counts[k], p: d.counts[k] / d.n });
  }
  return { n: d.n, pats: out };
}

function tableFor(b) {
  return { rim: 1 + b * W_RIM, swish: W_SW.map(w => 1 + b * w) };
}
function roundTable(t) {
  const r = x => Math.round(x * 1000) / 1000;
  return { rim: r(t.rim), swish: t.swish.map(r) };
}

// money flow through one level for a given start-streak mass vector
function flow(pats, tab, massIn) {
  const massOut = new Array(STREAK_CAP + 1).fill(0);
  let ev = 0;
  for (let s = 0; s <= STREAK_CAP; s++) {
    const mi = massIn[s];
    if (!mi) continue;
    for (const pt of pats) {
      if (!pt.clear) continue;
      let m = 1, st = s;
      for (let i = 0; i < pt.o.length; i++) {
        if (pt.o[i] === 'S') { st = st < STREAK_CAP ? st + 1 : STREAK_CAP; m *= tab.swish[st - 1]; }
        else { st = 0; m *= tab.rim; }
      }
      const c = mi * pt.p * m;
      ev += c; massOut[st] += c;
    }
  }
  return { ev, massOut };
}

function solveLevel(pats, massIn, target) {
  let lo = 0, hi = 4;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (flow(pats, tableFor(mid), massIn).ev < target) lo = mid; else hi = mid;
  }
  const b = (lo + hi) / 2;
  // rounded tables: search nearby b for the rounded table closest to target
  let best = null;
  for (let k = -60; k <= 60; k++) {
    const bb = b * (1 + k * 0.0005);
    const tab = roundTable(tableFor(bb));
    const ev = flow(pats, tab, massIn).ev;
    const err = Math.abs(ev - target);
    if (!best || err < best.err) best = { b: bb, tab, ev, err };
  }
  return best;
}

function solveFor(pats, massIn, target) {
  let lo = 0, hi = 6;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (flow(pats, tableFor(mid), massIn).ev < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function calibrate(key) {
  const PAY = [], STATS = [];
  for (let di = 0; di < 4; di++) {
    let mass = [1, 0, 0, 0, 0, 0], gmass = [1, 0, 0, 0, 0, 0], rtpPrev = 1, prevB = 0;
    const rows = [], stats = [];
    for (let L = 1; L <= 8; L++) {
      const { pats, n } = patterns(key, di, L);
      const sumIn = mass.reduce((a, b) => a + b, 0);
      let target = MODE === 'flat' ? TARGET : rtpPrev * TARGET;
      let b = solveFor(pats, mass, target);
      const guarded = (MODE === 'guard' && L >= GUARD_FROM) || MODE === 'house';
      if (guarded) {
        const G = MODE === 'house' && L === 1 ? GUARD1 : GUARD;
        const gp = patterns('good', di, L).pats;
        const gIn = gmass.reduce((a, c) => a + c, 0);
        const bg = solveFor(gp, gmass, gIn * G);
        if (MODE === 'house' && L >= 2) b = Math.min(b, bg); // later levels: ~10% per level for average, capped for good players
        else if (bg < b) b = bg;
        if (MODE === 'house' && L >= 2 && b < prevB) b = prevB; // deeper never pays less per hoop
        target = flow(pats, tableFor(b), mass).ev;
      }
      // round, then nudge b so the rounded table lands on target; rounding never pays over the target
      // (at small multipliers one 0.001 step moves a level's return by a few tenths of a percent)
      let best = null;
      for (let k = -60; k <= 60; k++) {
        const bb = b * (1 + k * 0.0005);
        const tab = roundTable(tableFor(bb));
        const ev = flow(pats, tab, mass).ev;
        const err = Math.abs(ev - target), over = ev > target + 1e-9;
        if (!best || (best.over && !over) || (best.over === over && err < best.err)) best = { b: bb, tab, ev, err, over };
      }
      const f = flow(pats, best.tab, mass);
      mass = f.massOut; rtpPrev = f.ev;
      if (MODE === 'guard' || MODE === 'house') gmass = flow(patterns('good', di, L).pats, best.tab, gmass).massOut;
      prevB = best.b;
      rows.push(best.tab);
      let clear = 0, hoops = 0, passed = 0, sw = 0;
      for (const pt of pats) {
        if (pt.clear) clear += pt.p;
        passed += pt.o.length * pt.p; hoops += (pt.o.length + (pt.clear ? 0 : 1)) * pt.p;
        for (const ch of pt.o) if (ch === 'S') sw += pt.p;
      }
      stats.push({ clear: +clear.toFixed(4), pass: +(passed / hoops).toFixed(4), swish: +(sw / passed).toFixed(4), n, b: +best.b.toFixed(5), rtp: +f.ev.toFixed(4), levelEdge: +(1 - f.ev / sumIn).toFixed(4) });
    }
    PAY.push(rows); STATS.push(stats);
  }
  return { PAY, STATS };
}

// RTP for any skill under a given paytable, cash-out at checkpoint k (exact, no cap)
function rtpCurve(key, PAY) {
  const res = [];
  for (let di = 0; di < 4; di++) {
    let mass = [1, 0, 0, 0, 0, 0];
    const curve = [];
    for (let L = 1; L <= 8; L++) {
      const { pats } = patterns(key, di, L);
      const f = flow(pats, PAY[di][L - 1], mass);
      mass = f.massOut;
      curve.push(f.ev);
    }
    res.push(curve);
  }
  return res;
}

const { PAY, STATS } = calibrate('average');
const names = E.DIFFS.map(d => d.name);
console.log('Calibrated to average player, mode', MODE, 'target', TARGET, MODE === 'guard' ? 'guard ' + GUARD + ' from L' + GUARD_FROM : '', '\n');
for (let di = 0; di < 4; di++) {
  console.log(`== ${names[di]}`);
  for (let L = 1; L <= 8; L++) {
    const t = PAY[di][L - 1], s = STATS[di][L - 1];
    console.log(`  L${L}  rim x${t.rim.toFixed(3)}  swish x${t.swish.map(v => v.toFixed(3)).join(' ')}   avg clear ${(s.clear * 100).toFixed(1)}%  pass ${(s.pass * 100).toFixed(1)}%  swish ${(s.swish * 100).toFixed(0)}%  rtp ${s.rtp}  lvl-edge ${(s.levelEdge * 100).toFixed(1)}%`);
  }
}

console.log('\nRTP by skill if you cash out at checkpoint 1..8 (no cap):');
const skills = ['novice', 'casual', 'average', 'average_val', 'good', 'pro', 'perfect'];
const curves = {};
for (const sk of skills) {
  try { curves[sk] = rtpCurve(sk, PAY); } catch (e) { /* missing */ }
}
for (let di = 0; di < 4; di++) {
  console.log(`== ${names[di]}`);
  for (const sk of skills) if (curves[sk]) console.log('  ' + sk.padEnd(12) + curves[sk][di].map(v => (v * 100).toFixed(1).padStart(7)).join(''));
}

if (WRITE) {
  const meta = { mode: MODE, guard: GUARD, guardFrom: GUARD_FROM, target: TARGET, weights: { rim: W_RIM, swish: W_SW }, generated: new Date().toISOString().slice(0, 10), engine: E.VERSION, samples: STATS[0][0].n };
  const avgClear = STATS.map(r => r.map(s => s.clear));
  const avgSwish = STATS.map(r => r.map(s => s.swish));
  const body = `/* Generated by sim/calibrate.cjs — do not edit by hand.
 * Mode "${MODE}": an average player gets back ${TARGET * 100}% when cashing out at checkpoint 1; each later level keeps
 * at least a ${Math.round((1 - TARGET) * 100)}% edge against the average player and lets a strong player gain at most ${Math.round((GUARD - 1) * 100)}% on it.
 * PAYTABLE[difficulty][level-1] = { rim, swish: [streak1..5+] }. AVG_RTP = average-player return if cashing out after each level. */
(function (root, factory) {
  const P = factory();
  if (typeof module === 'object' && module.exports) module.exports = P;
  else root.DunkPaytable = P;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return ${JSON.stringify({ PAYTABLE: PAY, AVG_CLEAR: avgClear, AVG_SWISH: avgSwish, AVG_RTP: curves.average.map(r => r.map(v => +v.toFixed(4))), META: meta })};
});
`;
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'paytable.cjs'), body);
  fs.writeFileSync(path.join(__dirname, 'out', 'calibration.json'), JSON.stringify({ PAY, STATS, curves, meta }, null, 1));
  console.log('\nwrote src/paytable.cjs and sim/out/calibration.json');
}
