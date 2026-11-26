// Prices the special levels, which are tuned to each player (src/special.cjs).
//
// 1. For every twist at every grade, plays long courses (N_MAX rings) with each bot on the skill scale and measures
//    the chance of passing n rings (kept in sim/out/special_curves.json), then fits ln S(n) = a + b n + c n^2 over the
//    lengths a course can have. 2. Reads the per-ring miss rate of every regular level for each bot from the main
//    simulation (sim/out/patterns.json, so run sim/run.cjs first). 3. With --write, puts both in src/special.cjs.
// 4. Checks the courses: for each prize, the course set for a player at each skill's level, and the one for someone
//    new, played by every bot. 5. Checks the staircase: new players of each skill play one special over and over,
//    each attempt on the course set for their level, which then moves; with and without regular runs first, and good
//    players and pros who lose their first attempts on purpose to bring the level down.
//
//   node sim/special.cjs [attempts per twist, grade and skill = 2000] [--write] [--refit] [--curves] [--twists=a,b,c]
//                        [--only=a,b,c]
//
// --twists picks the twist steps 4 and 5 play in the 2x, 3x and 5x slots (by default the first, third and fifth).
// --refit skips step 1's play and fits the saved curves; --curves stops after step 3. Re-run it in full whenever the
// physics (src/engine.cjs), the bot or a twist changes. --only plays just those twists in step 1 and keeps the saved
// curves of the rest: for a new twist, or one whose settings changed, when nothing else did (same attempts as the
// saved ones; check first that the other twists still play tap for tap as they did).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.cjs');
const B = require('../src/bot.cjs');
const SP = require('../src/special.cjs');

function attempt(recipe, g, n, skill, seed) {
  const st = E.createState(SP.generate(seed, recipe, g, n));
  const bot = B.createBot(skill, E.makeRng('spb|' + skill + '|' + seed));
  let tap = true;
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); }
  return st.outcomes.length; // rings passed (n if it cleared)
}

const LEARN_A = 40, REG_RUNS = 5, SANDBAG = 6; // REG_RUNS: about what the 0.5 SOL unlock takes at a 0.1 SOL bet
if (!isMainThread) {
  if (workerData.tables) Object.assign(SP.TABLES, workerData.tables);
  const out = [];
  for (const j of workerData.jobs) {
    if (j.kind === 'curve') {
      const hist = new Array(SP.N_MAX + 1).fill(0);
      for (let i = j.from; i < j.to; i++) hist[attempt(j.recipe, j.g, SP.N_MAX, j.skill, 'sp' + i)]++;
      out.push({ ...j, hist });
    } else if (j.kind === 'check') { // attempts on one chosen course
      let wins = 0;
      for (let i = j.from; i < j.to; i++) if (attempt(j.recipe, j.g, j.n, j.skill, 'chk|' + j.tag + '|' + i) >= j.n) wins++;
      out.push({ ...j, wins });
    } else { // learn: players from scratch, each attempt on the course set for their level, which then moves
      const won = new Array(LEARN_A).fill(0), lv = new Array(LEARN_A).fill(0), k = SP.ANCHORS.indexOf(j.skill);
      for (let pl = j.from; pl < j.to; pl++) {
        let Rt = SP.blank();
        const rng = E.makeRng('learn|' + j.tag + '|' + pl);
        if (j.how === 'regular') for (let run = 0; run < REG_RUNS; run++) { // regular runs on Easy, from the measured miss rates
          for (let L = 1; L <= E.LEVELS; L++) {
            const h = SP.missReg(0, L, k);
            let pass = 0;
            while (pass < E.HOOPS_PER_LEVEL && rng() >= h) pass++;
            Rt = SP.addLevel(Rt, 0, L, pass, pass < E.HOOPS_PER_LEVEL);
            if (pass < E.HOOPS_PER_LEVEL) break;
          }
        }
        for (let a = 0; a < LEARN_A; a++) {
          const c = SP.courseFor(SP.levelOf(Rt, j.slot), j.recipe, j.x);
          const passed = j.how === 'sandbag' && a < SANDBAG ? 0 : attempt(j.recipe, c.g, c.n, j.skill, 'lrn|' + j.tag + '|' + pl + '|' + a);
          const ok = passed >= c.n;
          if (ok) won[a]++;
          Rt = SP.addSpecial(Rt, j.slot, ok, passed);
          lv[a] += SP.levelOf(Rt, j.slot);
        }
      }
      out.push({ ...j, won, lv });
    }
  }
  parentPort.postMessage(out);
  return;
}

const args = process.argv.slice(2), write = args.includes('--write'), refit = args.includes('--refit'), curvesOnly = args.includes('--curves');
const N = +(args.find((a) => /^\d+$/.test(a)) || 2000), small = N < 200; // a small N is a quick smoke test
const CHECK = small ? 40 : Math.max(600, Math.round(N * 0.75)), PLAYERS = small ? 4 : Math.max(60, Math.round(N / 16));
const W = Math.max(1, os.cpus().length);
const CURVES = path.join(__dirname, 'out', 'special_curves.json');

function runJobs(jobs, tables) {
  const parts = Array.from({ length: W }, () => []);
  jobs.forEach((j, i) => parts[i % W].push(j));
  return Promise.all(parts.map((p) => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { jobs: p, tables } });
    wk.on('message', res); wk.on('error', rej);
  }))).then((r) => r.flat());
}
const split = (job, n, chunk) => Array.from({ length: Math.ceil(n / chunk) }, (_, c) => ({ ...job, from: c * chunk, to: Math.min(n, (c + 1) * chunk) }));

// S[n] = P(passed >= n), then a weighted least-squares fit of ln S(n), quadratic in n, from the first ring to N_MAX
// (the rating also needs the chance of passing the first few rings of a course); linear if the quadratic turns back up
function fit(hist, total) {
  const S = [];
  let left = total;
  for (let n = 0; n <= SP.N_MAX; n++) { S[n] = left / total; left -= hist[n]; }
  const pts = [];
  for (let n = 1; n <= SP.N_MAX; n++) if (S[n] * total >= 20 && S[n] < 0.9995) pts.push([n, Math.log(S[n]), total * S[n] / (1 - S[n])]);
  const solve = (deg) => { // normal equations, deg 1 or 2
    const m = deg + 1, A = Array.from({ length: m }, () => new Array(m + 1).fill(0));
    for (const [n, y, w] of pts) {
      const f = [1, n, n * n].slice(0, m);
      for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) A[r][c] += w * f[r] * f[c]; A[r][m] += w * f[r] * y; }
    }
    for (let c = 0; c < m; c++) { // Gauss-Jordan
      let piv = c;
      for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let r = 0; r < m; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let q = c; q <= m; q++) A[r][q] -= k * A[c][q]; }
    }
    const x = A.map((row, r) => row[m] / row[r]);
    return [x[0], x[1], deg === 2 ? x[2] : 0];
  };
  const falls = (q) => q && q[1] + 2 * q[2] < 0 && q[1] + 2 * q[2] * SP.N_MAX < 0;
  let q = pts.length >= 4 ? solve(2) : null;
  if (!falls(q)) q = pts.length >= 2 ? solve(1) : null;
  if (!falls(q)) { // too few points to fit: nobody misses, or nobody gets far
    if (S[SP.N_MIN] > 0.99) q = [0, Math.log(Math.max(0.9995, S[SP.N_MAX])) / SP.N_MAX, 0];
    else q = [0, Math.log(Math.max(S[SP.N_MIN], 0.5 / total)) / SP.N_MIN, 0];
  }
  return { q, S };
}

(async () => {
  const t0 = Date.now(), K = SP.ANCHORS.length;
  // 1. the curves
  let agg;
  const only = (args.find((x) => x.startsWith('--only=')) || '').slice(7).split(',').filter((id) => SP.BY[id]);
  if (refit) agg = JSON.parse(fs.readFileSync(CURVES, 'utf8')).agg;
  else {
    const jobs = [];
    for (const R of SP.RECIPES) if (!only.length || only.includes(R.id)) for (let g = 0; g < SP.GRADES.length; g++) for (const skill of SP.ANCHORS)
      jobs.push(...split({ kind: 'curve', recipe: R.id, g, skill }, N, 500));
    agg = {};
    if (only.length) { // keep the other twists' saved curves
      const saved = JSON.parse(fs.readFileSync(CURVES, 'utf8'));
      if (saved.attempts !== N) { console.error(`the saved curves have ${saved.attempts} attempts per cell: run --only with the same number`); process.exit(1); }
      for (const k in saved.agg) if (!only.includes(k.split('|')[0])) agg[k] = saved.agg[k];
    }
    for (const r of await runJobs(jobs)) {
      const k = r.recipe + '|' + r.g + '|' + r.skill, a = agg[k] || (agg[k] = new Array(SP.N_MAX + 1).fill(0));
      r.hist.forEach((v, i) => { a[i] += v; });
    }
    fs.writeFileSync(CURVES, JSON.stringify({ engine: E.VERSION, attempts: N, rings: SP.N_MAX, agg }));
  }
  const sp = {};
  let worst = 0, worstAt = '', errSum = 0, errN = 0;
  for (const R of SP.RECIPES) {
    sp[R.id] = [];
    for (let g = 0; g < SP.GRADES.length; g++) {
      sp[R.id][g] = SP.ANCHORS.map((skill) => {
        const h = agg[R.id + '|' + g + '|' + skill], total = h.reduce((a, b) => a + b, 0), f = fit(h, total);
        for (let n = 1; n <= SP.N_MAX; n++) if (f.S[n] > 0.03) {
          const e = Math.abs(Math.min(1, Math.exp(f.q[0] + f.q[1] * n + f.q[2] * n * n)) - f.S[n]);
          errSum += e; errN++;
          if (e > worst) { worst = e; worstAt = `${R.id} grade ${g} ${skill} at ${n} rings`; }
        }
        return [Math.round(f.q[0] * 1e4) / 1e4, Math.round(f.q[1] * 1e5) / 1e5, Math.round(f.q[2] * 1e6) / 1e6];
      });
    }
  }
  // 2. regular levels, from the main simulation
  const pats = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'patterns.json'), 'utf8'));
  const reg = E.DIFFS.map((D, di) => Array.from({ length: E.LEVELS }, (_, k) => SP.ANCHORS.map((skill) => {
    const row = pats.find((p) => p.key === skill && p.di === di && p.L === k + 1);
    if (!row) throw new Error(`no ${skill} tier ${di} level ${k + 1} in patterns.json: run sim/run.cjs first`);
    let pass = 0, miss = 0;
    for (const key in row.counts) { const [o, r] = key.split('|'), c = row.counts[key]; pass += o.length * c; if (r !== 'C') miss += c; }
    return Math.round(Math.log(Math.max(miss, 0.5) / (pass + miss)) * 1e4) / 1e4;
  })));
  console.log(`special levels, engine v${E.VERSION}: ${N} attempts of ${SP.N_MAX} rings per twist, grade and skill${refit ? ' (saved curves)' : ''} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`fit of the chance of passing 1-${SP.N_MAX} rings: off by ${(errSum / errN * 100).toFixed(1)} points on average, ${(worst * 100).toFixed(1)} at most (${worstAt})\n`);
  const pc = (v) => (v * 100).toFixed(0).padStart(4) + '%';
  SP.TABLES.reg = reg; SP.TABLES.sp = sp;
  const tables = { reg, sp };
  console.log('chance of clearing 12 rings, by grade (Easy 1, 3, 5, Hard 3, 4, 5, 6, 8, and two steps past Hard 8), for ' + SP.ANCHORS.join(' / '));
  for (const R of SP.RECIPES) console.log('  ' + R.id.padEnd(9) + sp[R.id].map((cells, g) => SP.ANCHORS.map((a, k) => Math.round(SP.clearP(R.id, g, 12, k) * 100)).join('/').padStart(16)).join(''));

  // 3. write
  if (write) {
    const file = path.join(__dirname, '..', 'src', 'special.cjs'), src = fs.readFileSync(file, 'utf8');
    const old = /(\/\/ @@TABLES@@[^\n]*\n(?:\s*\/\/[^\n]*\n)*)([\s\S]*?)(\n\s*\/\/ @@END@@)/;
    if (!old.test(src)) { console.error('no @@TABLES@@ block in src/special.cjs'); process.exit(1); }
    const regTxt = reg.map((tier) => '      [' + tier.map((lv) => '[' + lv.join(', ') + ']').join(', ') + ']').join(',\n');
    const spTxt = SP.RECIPES.map((R) => `      ${R.id}: [\n` + sp[R.id].map((cells) => '        [' + cells.map((c) => '[' + c.join(', ') + ']').join(', ') + ']').join(',\n') + '\n      ]').join(',\n');
    const body = `  const TABLES = {\n    reg: [\n${regTxt}\n    ],\n    sp: {\n${spTxt}\n    }\n  }; // engine v${E.VERSION}, ${N} attempts per cell, ${new Date().toISOString().slice(0, 10)}`;
    fs.writeFileSync(file, src.replace(old, (m, a, b, c) => a + body + c));
    console.log('\nwrote the tables into src/special.cjs');
  }

  // the hardest course must be hard enough for a pro: what the course set for levels 3, 4 and 4.5 is expected to pay
  console.log('\nexpected return of the course set for levels 3 / 4 / 4.5, for ' + SP.SLOTS.map((x) => x + '×').join(', ') + ' (over ' + Math.round(SP.TARGET * 100) + '% at level 4 means no course is hard enough)');
  for (const R of SP.RECIPES) console.log('  ' + R.id.padEnd(10) + SP.SLOTS.map((x) => [3, 4, 4.5].map((d) => { const c = SP.courseFor(d, R.id, x); return `${Math.round(c.rtp * 100)}% (${c.g},${c.n})`.padStart(13); }).join('')).join('  |'));

  if (curvesOnly) { console.log(`\ntime ${((Date.now() - t0) / 1000).toFixed(0)} s`); return; }

  // 4. the course set for each skill's level, and for someone new, played by every bot
  const SKILLS = SP.ANCHORS.concat('perfect'), checks = [], picked = ((args.find((x) => x.startsWith('--twists=')) || '').slice(9).split(',').filter((id) => SP.BY[id])), slotRecipe = (slot) => picked[slot] || SP.RECIPES[slot * 2].id; // one twist per slot is enough
  SP.SLOTS.forEach((x, slot) => {
    const recipe = slotRecipe(slot), fresh = SP.courseFor(SP.START, recipe, x);
    SKILLS.forEach((skill, k) => {
      const known = SP.courseFor(Math.min(k, K - 1), recipe, x);
      checks.push(...split({ kind: 'check', tag: 'k' + slot + skill, recipe, slot, x, skill, who: 'known', g: known.g, n: known.n, est: known.rtp }, CHECK, 500));
      checks.push(...split({ kind: 'check', tag: 'n' + slot + skill, recipe, slot, x, skill, who: 'new', g: fresh.g, n: fresh.n, est: fresh.rtp }, CHECK, 500));
    });
  });
  const sum = {};
  for (const r of await runJobs(checks, tables)) { const k = [r.slot, r.skill, r.who].join('|'), s = sum[k] || (sum[k] = { ...r, wins: 0, n2: 0 }); s.wins += r.wins; s.n2 += r.to - r.from; }
  console.log(`\n4. return on the course set for each skill's level, and on a new player's course (${CHECK} fresh attempts each; target ${SP.TARGET * 100}%)`);
  console.log('prize  twist      skill     its own level: grade, rings, est. -> played     new player\'s: grade, rings, est. -> played');
  SP.SLOTS.forEach((x, slot) => SKILLS.forEach((skill) => {
    const a = sum[[slot, skill, 'known'].join('|')], b = sum[[slot, skill, 'new'].join('|')];
    const show = (r) => `${String(r.g).padStart(2)} ${String(r.n).padStart(3)} ${pc(r.est)} -> ${pc(r.wins / r.n2 * x)}`;
    console.log(`${(x + '×').padEnd(6)} ${a.recipe.padEnd(10)} ${skill.padEnd(9)} ${show(a)}                  ${show(b)}`);
  }));

  // 5. the staircase: new players playing one special LEARN_A times
  const learn = [], hows = { honest: SP.ANCHORS, regular: SP.ANCHORS, sandbag: ['good', 'pro'] };
  SP.SLOTS.forEach((x, slot) => { for (const how in hows) for (const skill of hows[how]) learn.push(...split({ kind: 'learn', tag: how + slot + skill, how, slot, x, recipe: slotRecipe(slot), skill }, PLAYERS, 20)); });
  const L = {};
  for (const r of await runJobs(learn, tables)) {
    const k = [r.how, r.slot, r.skill].join('|'), s = L[k] || (L[k] = { ...r, won: new Array(LEARN_A).fill(0), lv: new Array(LEARN_A).fill(0), n: 0 });
    r.won.forEach((v, i) => { s.won[i] += v; s.lv[i] += r.lv[i]; }); s.n += r.to - r.from;
  }
  const BUCKETS = [[0, 5], [5, 15], [15, LEARN_A], [0, LEARN_A]];
  console.log(`\n5. return as the level settles: ${PLAYERS} new players per row, each playing one special ${LEARN_A} times`);
  console.log(`   (a clear raises its level by ${SP.SLOTS.map((x) => SP.up(x).toFixed(2)).join(' / ')} for ${SP.SLOTS.map((x) => x + '×').join(' / ')}, a miss lowers it by ${SP.DOWN}; new players start at ${SP.START})`);
  console.log(`   honest: starting at ${SP.START}, as if their unlock runs showed nothing; regular: ${REG_RUNS} regular runs on Easy first`);
  console.log(`   (each until it busts); sandbag: starting at ${SP.START}, with the first ${SANDBAG} attempts lost on purpose`);
  console.log('prize  how      skill      attempts 1-5   6-15  16-40    all   level after');
  SP.SLOTS.forEach((x, slot) => { for (const how in hows) for (const skill of hows[how]) {
    const s = L[[how, slot, skill].join('|')];
    const ret = ([a, b]) => { let w = 0; for (let i = a; i < b; i++) w += s.won[i]; return w * x / (s.n * (b - a)); };
    console.log(`${(x + '×').padEnd(6)} ${how.padEnd(8)} ${skill.padEnd(9)}  ${BUCKETS.map((bk) => pc(ret(bk)).padStart(7)).join('')}   ${(s.lv[LEARN_A - 1] / s.n).toFixed(1).padStart(5)}`);
  } });
  console.log(`\ntime ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})();
