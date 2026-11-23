// Quick stats: node sim/quick.cjs [n] [skills] [diffs]
const { batch, summarize } = require('./simcore.cjs');
const n = +(process.argv[2] || 400);
const skills = (process.argv[3] || 'perfect,pro,good,average,casual,novice').split(',');
const diffs = (process.argv[4] || '0,1,2,3').split(',').map(Number);
const t0 = Date.now();
for (const di of diffs) {
  console.log('\n== difficulty', di);
  for (const sk of skills) {
    const row = [];
    for (let L = 1; L <= 8; L++) {
      const r = batch(di, L, sk, n, 'q' + L);
      const s = summarize(r);
      row.push(`${(s.pass * 100).toFixed(1)}/${(s.swish * 100).toFixed(0)}/${(s.clear * 100).toFixed(0)}`);
      if (sk === 'average' && L === 1) console.log('   miss kinds L1 avg:', JSON.stringify(r.miss));
    }
    console.log(sk.padEnd(8), row.join('  '));
  }
}
console.log('\n(pass%/swish%/clear%)  time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
