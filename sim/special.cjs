// Prices the special level: how often players of each skill clear each recipe, and the prize that keeps a good
// player at or below TARGET return (97%). Writes the prizes into src/special.cjs with --write.
//
//   node sim/special.cjs [attempts per recipe and skill = 20000] [recipe id ...] [--write]
//
// Re-run it whenever the physics (src/engine.cjs), the bot or a recipe changes.
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.cjs');
const B = require('../src/bot.cjs');
const SP = require('../src/special.cjs');

const SKILLS = ['casual', 'average', 'good', 'pro'];
const TARGET = 0.97;      // a good player's return at most
const Z = 2;              // price against the clear rate's upper bound (about 97.5% confidence)

function attempt(recipe, skill, i) {
  const level = SP.generate('sp' + i, recipe);
  const st = E.createState(level);
  const bot = B.createBot(skill, E.makeRng('spb|' + skill + '|' + recipe + '|' + i));
  let tap = true;
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); }
  return { clear: st.result === 'clear', rings: st.outcomes.length, swish: st.outcomes.filter((o) => o === 'S').length, ticks: st.tick };
}

if (!isMainThread) {
  const { jobs } = workerData;
  const out = [];
  for (const j of jobs) {
    let clears = 0, rings = 0, swish = 0, ticks = 0;
    for (let i = j.from; i < j.to; i++) { const r = attempt(j.recipe, j.skill, i); if (r.clear) { clears++; ticks += r.ticks; } rings += r.rings; swish += r.swish; }
    out.push({ ...j, clears, rings, swish, ticks });
  }
  parentPort.postMessage(out);
} else {
  const args = process.argv.slice(2), write = args.includes('--write');
  const nums = args.filter((a) => /^\d+$/.test(a)), ids = args.filter((a) => !/^\d+$/.test(a) && a !== '--write');
  const N = nums.length ? +nums[0] : 20000;
  const recipes = ids.length ? ids : SP.RECIPES.map((r) => r.id);
  for (const id of recipes) if (!SP.BY[id]) { console.error('unknown recipe ' + id); process.exit(1); }
  const W = Math.max(1, os.cpus().length), jobs = [];
  for (const recipe of recipes) for (const skill of SKILLS) {
    const per = Math.ceil(N / W);
    for (let w = 0; w < W; w++) jobs.push({ recipe, skill, from: w * per, to: Math.min(N, (w + 1) * per), w });
  }
  const t0 = Date.now();
  const parts = Array.from({ length: W }, (_, w) => jobs.filter((j) => j.w === w));
  Promise.all(parts.map((p) => new Promise((res, rej) => {
    const wk = new Worker(__filename, { workerData: { jobs: p } });
    wk.on('message', res); wk.on('error', rej);
  }))).then((res) => {
    const all = res.flat(), agg = {};
    for (const r of all) {
      const k = r.recipe + '|' + r.skill, a = agg[k] || (agg[k] = { clears: 0, n: 0, rings: 0, swish: 0, ticks: 0 });
      a.clears += r.clears; a.n += r.to - r.from; a.rings += r.rings; a.swish += r.swish; a.ticks += r.ticks;
    }
    const prizes = {};
    console.log(`special level, engine v${E.VERSION}, ${N} attempts per recipe and skill (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
    console.log('recipe        rings  secs   clear: casual average   good    pro   prize   return: casual average  good   pro');
    for (const id of recipes) {
      const R = SP.BY[id], p = SKILLS.map((s) => agg[id + '|' + s].clears / agg[id + '|' + s].n);
      const g = agg[id + '|good'], pg = p[2], hi = pg + Z * Math.sqrt(Math.max(pg * (1 - pg), 1e-6) / g.n);
      const x = Math.floor((TARGET / hi) * 20) / 20; // to the 0.05× below
      const secs = g.clears ? g.ticks / g.clears * E.DT : 0;
      prizes[id] = { x, p: p.map((v) => Math.round(v * 1e4) / 1e4) };
      const pc = (v) => (v * 100).toFixed(1).padStart(6) + '%';
      console.log(`${id.padEnd(13)} ${String(R.n).padStart(5)} ${secs.toFixed(1).padStart(5)}        ${p.map(pc).join(' ')}  ${(x.toFixed(2) + '×').padStart(6)}          ${p.map((v) => pc(v * x)).join('')}`);
    }
    if (write) {
      const file = path.join(__dirname, '..', 'src', 'special.cjs'), src = fs.readFileSync(file, 'utf8');
      const old = /(\/\/ @@PRIZES@@[^\n]*\n[^\n]*\n)([\s\S]*?)(\n\s*\/\/ @@END@@)/;
      if (!old.test(src)) { console.error('no @@PRIZES@@ block in src/special.cjs'); process.exit(1); }
      const prev = (() => { try { return SP.PRIZES; } catch (e) { return {}; } })();
      const merged = Object.assign({}, prev, prizes);
      const body = '  const PRIZES = {\n' + SP.RECIPES.filter((r) => merged[r.id]).map((r) => `    ${r.id}: { x: ${merged[r.id].x}, p: [${merged[r.id].p.join(', ')}] }`).join(',\n') +
        `\n  }; // engine v${E.VERSION}, ${N} attempts each, ${new Date().toISOString().slice(0, 10)}`;
      fs.writeFileSync(file, src.replace(old, (m, a, b, c) => a + body + c));
      console.log('\nwrote prizes into src/special.cjs');
    }
  });
}
