// Where a landing on the rim drops in and where it falls off.
//
// Drops the ball onto a still, level ring from many starting points and speeds, with no taps after the drop, and
// sorts each drop by where the ball's centre was when it first touched a rim, measured from the middle of that
// rim's tube (negative = toward the opening, positive = outside). The rule since engine v15 (the owner asked for
// it): outside the middle falls off, on both rims. Inside it, the near rim drops the ball in; the far rim only
// does once the centre is well inside, since the ball is still travelling forward.
//
//   node sim/landing.cjs [mode = 0] [level = 1]
const E = require('../src/engine.cjs');
const P = E.PHYS;

function drop(di, L, x0, up, vy0) {
  const lv = E.generateLevel('landing', di, L);
  const st = E.createState(lv), h = st.hoops[0];
  h.amp = 0; h.tilt = 0; h.c = 1; h.s = 0;
  st.ball.x = h.x + x0; st.ball.y = h.y0 - up; st.ball.vy = vy0;
  let first = null;
  for (let i = 0; i < 1200 && !st.done && st.next === 0; i++) {
    E.step(st, false);
    if (!first && h.touched) {
      const lx = st.ball.x - h.x, half = h.w / 2;
      first = lx < 0 ? { rim: 'near', out: -(lx + half) } : { rim: 'far', out: lx - half };
    }
  }
  return first && { rim: first.rim, out: first.out, scored: st.next > 0 };
}

const di = +(process.argv[2] || 0), L = +(process.argv[3] || 1);
const bins = {};
for (const vy0 of [0, 150, 300, 450]) for (const up of [60, 90, 120]) for (let x = -160; x <= 80; x += 0.25) {
  const r = drop(di, L, x, up, vy0);
  if (!r) continue;
  const b = Math.max(-10, Math.min(10, Math.round(r.out / 2) * 2));
  const o = bins[r.rim + b] || (bins[r.rim + b] = { n: 0, scored: 0 });
  o.n++; if (r.scored) o.scored++;
}
console.log(E.DIFFS[di].name + ' level ' + L + ', engine v' + E.VERSION + ': the rim tube is ' + (P.RP * 2).toFixed(1) + ' units wide');
console.log("centre's distance outside the middle of the tube -> share of drops that go in (drops)");
for (const rim of ['near', 'far']) {
  let line = (rim + ' rim').padEnd(9);
  for (let b = -10; b <= 10; b += 2) {
    const o = bins[rim + b];
    line += ((b > 0 ? '+' : '') + b + (b === -10 ? ' or less' : b === 10 ? ' or more' : '')).padStart(b === -10 || b === 10 ? 12 : 5) + ' ' + (o ? (Math.round(100 * o.scored / o.n) + '%').padStart(4) : '   -');
  }
  console.log(line);
}
