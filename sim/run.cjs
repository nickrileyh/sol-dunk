// Full Monte Carlo run across skills x difficulties x levels, using worker threads.
// Writes sim/out/patterns.json: pattern counts per (skill, difficulty, level).
//   node sim/run.cjs            (default sizes)
//   node sim/run.cjs 0.25       (quarter-size quick run)
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');

if (isMainThread) {
  const scale = +(process.argv[2] || 1);
  const tiers = (process.argv[3] || require('../src/engine.cjs').DIFFS.map((d, i) => i).join(',')).split(',').map(Number);
  const merge = process.argv[4] === 'merge';
  const sizes = { average: 24000, average_val: 8000, novice: 6000, casual: 6000, good: 6000, pro: 6000, perfect: 2000 };
  const tasks = [];
  for (const key of Object.keys(sizes)) {
    const skill = key === 'average_val' ? 'average' : key;
    const salt = key === 'average_val' ? 'VAL' : 'CAL';
    for (const di of tiers) for (let L = 1; L <= 8; L++) {
      const n = Math.max(200, Math.round(sizes[key] * scale));
      // split big jobs into chunks so both cores stay busy
      const chunks = Math.ceil(n / 2000);
      for (let c = 0; c < chunks; c++) tasks.push({ key, skill, di, L, n: Math.min(2000, n - c * 2000), salt: salt + key + c });
    }
  }
  const out = {};
  const nW = Math.max(1, os.cpus().length);
  let next = 0, done = 0;
  const t0 = Date.now();
  function launch() {
    const w = new Worker(__filename, { workerData: null });
    const feed = () => { if (next < tasks.length) w.postMessage(tasks[next++]); else w.terminate(); };
    w.on('message', (r) => {
      const k = r.key + '|' + r.di + '|' + r.L;
      const o = out[k] || (out[k] = { key: r.key, skill: r.skill, di: r.di, L: r.L, n: 0, counts: {}, miss: {} });
      o.n += r.n;
      for (const p in r.counts) o.counts[p] = (o.counts[p] || 0) + r.counts[p];
      for (const p in r.miss) o.miss[p] = (o.miss[p] || 0) + r.miss[p];
      done++;
      if (done % 20 === 0 || done === tasks.length) {
        const el = (Date.now() - t0) / 1000;
        console.log(`${done}/${tasks.length} tasks  ${el.toFixed(0)}s  eta ${(el / done * (tasks.length - done)).toFixed(0)}s`);
      }
      if (done === tasks.length) {
        fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
        const fp = path.join(__dirname, 'out', 'patterns.json');
        let rows = Object.values(out);
        if (merge && fs.existsSync(fp)) {
          const old = JSON.parse(fs.readFileSync(fp)).filter(r => !tiers.includes(r.di));
          rows = old.concat(rows);
        }
        fs.writeFileSync(fp, JSON.stringify(rows));
        console.log('wrote sim/out/patterns.json');
      }
      feed();
    });
    feed();
  }
  for (let i = 0; i < nW; i++) launch();
} else {
  const { batch } = require('./simcore.cjs');
  parentPort.on('message', (t) => {
    const r = batch(t.di, t.L, t.skill, t.n, t.salt);
    parentPort.postMessage({ key: t.key, skill: t.skill, di: t.di, L: t.L, n: r.n, counts: r.counts, miss: r.miss });
  });
}
