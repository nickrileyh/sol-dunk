// End-to-end test: spawns the server in mock-chain mode, signs in with a fresh ed25519 wallet,
// plays runs with the bot and checks every server result against a local recomputation.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const E = require(path.join(root, 'src/engine.cjs'));
const B = require(path.join(root, 'src/bot.cjs'));
const PAY = require(path.join(root, 'src/paytable.cjs'));

// the browser's own SHA-256/HMAC code, pulled straight out of game.js
const gameSrc = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');
const start = gameSrc.indexOf('const K256'), end = gameSrc.indexOf('// ---------------------------------------------------------------- settings');
const client = new Function(gameSrc.slice(start, end) + '; return { deriveLevelSeed, sha256, utf8, hex };')();

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } };

async function boot(port, extra) {
  const dir = fs.mkdtempSync('/tmp/soldunk-');
  const proc = spawn(process.execPath, [path.join(here, '..', 'server.mjs')], {
    env: { ...process.env, MOCK_CHAIN: '1', PORT: String(port), DB_FILE: path.join(dir, 'db.json'), MIN_REALTIME: '0', ...extra }, stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/api/config`); return proc; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('server did not start');
}
function client_(port) {
  let token = null;
  const api = async (p, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json();
    return { status: res.status, ...j };
  };
  return {
    api,
    async signIn() {
      const kp = nacl.sign.keyPair();
      const address = bs58.encode(kp.publicKey);
      const { message } = await api('/api/auth/nonce', { address });
      const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
      const r = await api('/api/auth/verify', { address, signature: bs58.encode(sig) });
      token = r.token;
      return { address, r };
    },
    setToken(t) { token = t; }, get token() { return token; }
  };
}
// play one level with a bot, returning the taps it made
function playTaps(seed, di, L, skill, salt) {
  const st = E.createState(E.generateLevel(seed, di, L));
  const bot = B.createBot(skill, E.makeRng(salt));
  const taps = [0];
  let tap = true;
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); }
  return { taps, outcomes: st.outcomes, result: st.result };
}

(async () => {
  const port = 8799;
  const srv = await boot(port);
  const c = client_(port);
  const { r: me } = await c.signIn();
  check(me.token && me.balance === 0, 'sign-in returns a token and zero balance');
  await c.api('/api/dev/faucet', { lamports: 5e9 });
  let expected = 5e9;
  const tally = { runs: 0, cashout: 0, bust: 0, final: 0, maxwin: 0, levels: 0 };
  const skills = ['average', 'good', 'pro', 'perfect'];
  for (let i = 0; i < 40; i++) {
    const di = i % E.DIFFS.length, bet = 10_000_000 + (i % 5) * 5_000_000;
    const skill = skills[(i * 7) % 4];
    const s = await c.api('/api/run/start', { difficulty: di, lamports: bet, clientSeed: 'cs' + i + 'xyz' });
    check(s.status === 200, 'start run ' + JSON.stringify(s));
    if (s.status !== 200) continue;
    expected -= bet; tally.runs++;
    const seeds = [s.levelSeed];
    let L = 1, total = 1, streak = 0, seed = s.levelSeed, ended = null, revealed = null;
    while (!ended) {
      const p = playTaps(seed, di, L, skill, 'b' + i + ':' + L);
      const local = E.applyLevel(PAY.PAYTABLE[di][L - 1], p.outcomes, total, E.DIFFS[di].maxWin, streak);
      const r = await c.api('/api/run/level', { runId: s.runId, level: L, taps: p.taps });
      tally.levels++;
      const want = local.capped ? 'maxwin' : p.result !== 'clear' ? 'bust' : L >= E.LEVELS ? 'final' : 'checkpoint';
      check(r.status === want, `run ${i} L${L}: server ${r.status} vs local ${want}`);
      check(Math.abs(r.total - local.total) < 1e-12, `run ${i} L${L}: total ${r.total} vs ${local.total}`);
      total = local.total; streak = local.streak;
      if (r.status === 'checkpoint') {
        const goOn = skill === 'perfect' || L < 2 || (i % 3 !== 0 && L < 5);
        if (goOn) { const n = await c.api('/api/run/continue', { runId: s.runId }); L = n.level; seed = n.levelSeed; seeds.push(seed); }
        else {
          const co = await c.api('/api/run/cashout', { runId: s.runId });
          check(co.payoutLamports === Math.floor(bet * total), 'cash-out amount');
          expected += co.payoutLamports; ended = 'cashout'; revealed = co.serverSeed;
          const again = await c.api('/api/run/cashout', { runId: s.runId });
          check(again.status === 400, 'second cash-out is refused');
        }
      } else {
        ended = r.status; expected += r.payoutLamports; revealed = r.serverSeed;
        if (r.status !== 'bust') check(r.payoutLamports === Math.floor(bet * total), 'auto payout amount');
      }
    }
    tally[ended]++;
    // provably fair: revealed seed matches the hash and re-derives every level seed (with the browser's own code)
    check(client.hex(client.sha256(client.utf8(revealed))) === s.serverSeedHash, 'seed hash matches');
    seeds.forEach((sd, k) => check(client.deriveLevelSeed(revealed, 'cs' + i + 'xyz', s.nonce, k + 1) === sd, 'level seed ' + (k + 1) + ' re-derives'));
  }
  const bal = await c.api('/api/me');
  check(bal.balance === expected, `ledger: server ${bal.balance} vs expected ${expected}`);
  console.log('runs', JSON.stringify(tally), 'final balance ' + (bal.balance / 1e9).toFixed(4) + ' SOL');

  // refusals
  const s2 = await c.api('/api/run/start', { difficulty: 1, lamports: 10_000_000, clientSeed: 'abcd' });
  check((await c.api('/api/run/start', { difficulty: 1, lamports: 10_000_000, clientSeed: 'abce' })).status === 400, 'second open run refused');
  check((await c.api('/api/run/level', { runId: s2.runId, level: 2, taps: [0] })).status === 400, 'wrong level refused');
  check((await c.api('/api/run/level', { runId: s2.runId, level: 1, taps: [5, 9] })).status === 400, 'taps not starting at 0 refused');
  check((await c.api('/api/run/level', { runId: s2.runId, level: 1, taps: [0, 9, 9] })).status === 400, 'duplicate taps refused');
  check((await c.api('/api/run/cashout', { runId: s2.runId })).status === 400, 'cash-out mid-level refused');
  check((await c.api('/api/run/start', { difficulty: 1, lamports: 9e12, clientSeed: 'abcf' })).status === 400, 'oversized bet refused');
  const tok = c.token; c.setToken(tok.slice(0, -3) + 'AAA');
  check((await c.api('/api/me')).status === 401, 'tampered token refused');
  c.setToken(tok);
  const w = await c.api('/api/withdraw', { lamports: 1e9 });
  check(w.status === 400, 'withdraw blocked while a run is open');
  srv.kill();

  // real-time check: a level submitted instantly is voided
  const srv2 = await boot(8800, { MIN_REALTIME: '0.9' });
  const c2 = client_(8800); await c2.signIn(); await c2.api('/api/dev/faucet', { lamports: 1e9 });
  const s3 = await c2.api('/api/run/start', { difficulty: 1, lamports: 10_000_000, clientSeed: 'fast1' });
  const p3 = playTaps(s3.levelSeed, 1, 1, 'perfect', 'fast');
  const r3 = await c2.api('/api/run/level', { runId: s3.runId, level: 1, taps: p3.taps });
  check(r3.status === 400 && /real time/.test(r3.error), 'instant submission is voided: ' + JSON.stringify(r3));
  srv2.kill();

  // challenge pots: entry, completion only on the challenge's tier and after entering, an equal split less the rake, rollover
  const POTS = require(path.join(root, 'src/pots.cjs'));
  const srv3 = await boot(8801, { POT_GOAL: 'streak5', POT_ENTRY_LAMPORTS: '50000000' });
  const A = client_(8801), Bc = client_(8801), C = client_(8801);
  for (const x of [A, Bc, C]) { await x.signIn(); await x.api('/api/dev/faucet', { lamports: 1e9 }); }
  const fee = 50_000_000;
  // play one run with a bot until it busts or clears `levels` levels, then cash out; returns the last pot note, with
  // just set if any level of the run completed the challenge
  async function potRun(x, di, skill, salt, levels) {
    const s = await x.api('/api/run/start', { difficulty: di, lamports: 10_000_000, clientSeed: 'pot' + salt });
    let L = 1, seed = s.levelSeed, note = null, just = false;
    const out = () => (note ? Object.assign({}, note, { just }) : null);
    for (;;) {
      const pl = playTaps(seed, di, L, skill, 'p' + salt + ':' + L);
      const r = await x.api('/api/run/level', { runId: s.runId, level: L, taps: pl.taps });
      note = r.pot || note; if (r.pot && r.pot.just) just = true;
      if (r.status !== 'checkpoint') return out();
      if (L >= levels) { await x.api('/api/run/cashout', { runId: s.runId }); return out(); }
      const n = await x.api('/api/run/continue', { runId: s.runId }); L = n.level; seed = n.levelSeed;
    }
  }
  const before = await potRun(A, 1, 'perfect', 'pre', 2);
  check(before === null, 'a run before entering does not count');
  const p0 = await A.api('/api/pot');
  check(p0.goal.id === 'streak5' && p0.entrants === 0 && p0.me && p0.me.entered === false, 'pot shows the challenge: ' + JSON.stringify(p0.goal));
  for (const x of [A, Bc, C]) {
    const b0 = (await x.api('/api/me')).balance, e = await x.api('/api/pot/enter', {});
    check(e.status === 200 && e.me.entered && e.balance === b0 - fee, 'enter the pot: the entry is debited');
  }
  check((await A.api('/api/pot/enter', {})).status === 400, 'second entry refused');
  const easy = await potRun(A, 0, 'perfect', 'easy', 2);
  check(easy && easy.counts === false && !easy.done, 'a run below the challenge tier does not count');
  const hard = await potRun(A, 1, 'perfect', 'hard', 3);
  check(hard && hard.done && hard.just, 'a perfect run on Hard completes "swish 5 in a row" ' + JSON.stringify(hard));
  const again = await potRun(A, 1, 'perfect', 'hard2', 2);
  check(again && again.done && !again.just, 'completing again does not count twice');
  // a run that falls to the floor before the first ring (one tap, then nothing): it can't complete anything
  const bs = await Bc.api('/api/run/start', { difficulty: 1, lamports: 10_000_000, clientSeed: 'potb' });
  const bRun = (await Bc.api('/api/run/level', { runId: bs.runId, level: 1, taps: [0] })).pot;
  check(!bRun || !bRun.done, 'a run that misses does not complete it');
  const mid = await C.api('/api/pot');
  check(mid.entrants === 3 && mid.completed === 1 && mid.poolLamports === Math.floor(3 * fee * (1 - POTS.RAKE)), 'pot totals: ' + JSON.stringify([mid.entrants, mid.completed, mid.poolLamports]));
  const balA = (await A.api('/api/me')).balance, balB = (await Bc.api('/api/me')).balance;
  await A.api('/api/dev/pot/advance', {});
  const after = await A.api('/api/pot');
  const share = 3 * fee - Math.ceil(3 * fee * POTS.RAKE);
  check(after.last && after.last.winners === 1 && after.last.shareLamports === share && after.last.me.wonLamports === share, 'the winner takes the pot less the rake: ' + JSON.stringify(after.last));
  check((await A.api('/api/me')).balance === balA + share, 'winnings credited');
  check((await Bc.api('/api/me')).balance === balB, 'non-finishers get nothing');
  check(after.entrants === 0 && after.carryInLamports === 0 && after.key !== mid.key, 'a new pot opens empty');
  // nobody finishes: the pot rolls over into the next day's
  await Bc.api('/api/pot/enter', {}); await C.api('/api/pot/enter', {});
  await Bc.api('/api/dev/pot/advance', {});
  const rolled = await Bc.api('/api/pot');
  const pool2 = 2 * fee - Math.ceil(2 * fee * POTS.RAKE);
  check(rolled.last.winners === 0 && rolled.last.rolledLamports === pool2 && rolled.carryInLamports === pool2 && rolled.poolLamports === pool2, 'no winners: the pot rolls over: ' + JSON.stringify([rolled.last, rolled.carryInLamports]));
  const poor = client_(8801); await poor.signIn();
  check((await poor.api('/api/pot/enter', {})).status === 400, 'entry without balance refused');
  srv3.kill();

  // missions: every run counts; a window's SOL pays once its need has been played; the server agrees with a local replay
  const MS = require(path.join(root, 'src/missions.cjs'));
  const SP = require(path.join(root, 'src/special.cjs'));
  const NEED = { day: 50_000_000, week: 200_000_000 };
  const srv4 = await boot(8802, { MISSION_DAY_LAMPORTS: String(NEED.day), MISSION_WEEK_LAMPORTS: String(NEED.week), SPECIAL_RECIPE: 'gauntlet', SPECIAL_ENTRY_LAMPORTS: '50000000' });
  const M = client_(8802); await M.signIn(); await M.api('/api/dev/faucet', { lamports: 3e9 });
  const m0 = await M.api('/api/missions');
  check(m0.daily.length === 3 && m0.weekly.length === 3 && m0.playedLamports.day === 0 && m0.needLamports.day === NEED.day, 'missions: three a day, three a week, nothing played');
  check(m0.daily[0].k === MS.daily(m0.day)[0].k && m0.daily.every((d, k) => d.rewardLamports === Math.floor(MS.reward('day', k, NEED.day))), 'missions: the day\'s set and its rewards');
  let mine = MS.roll(null, Date.now()), mbal = (await M.api('/api/me')).balance, paidTotal = 0, sawLocked = false;
  const addPaid = (x) => { for (const p of (x && x.paid) || []) { paidTotal += p.lamports; mbal += p.lamports; } };
  for (let i = 0; i < 8; i++) {
    const bet = 10_000_000, di = 0;
    const s = await M.api('/api/run/start', { difficulty: di, lamports: bet, clientSeed: 'mis' + i + 'x' });
    mbal -= bet; mine = MS.play(mine, bet, Date.now(), NEED).s; addPaid(s.missions);
    check(s.balance === mbal, `missions run ${i}: start balance ${s.balance} vs ${mbal}`);
    let L = 1, seed = s.levelSeed, total = 1, streak = 0, levels = [], end = null;
    while (!end) {
      const def = E.generateLevel(seed, di, L), pl = playTaps(seed, di, L, i % 2 ? 'perfect' : 'good', 'm' + i + ':' + L);
      const a = E.applyLevel(PAY.PAYTABLE[di][L - 1], pl.outcomes, total, E.DIFFS[di].maxWin, streak);
      const cnt = a.capped ? a.capIndex + 1 : pl.outcomes.length;
      levels.push({ outcomes: pl.outcomes.slice(0, cnt).join(''), clear: pl.result === 'clear' && !a.capped, mov: pl.outcomes.slice(0, cnt).map((o, k) => (def.hoops[k].amp ? '1' : '0')).join('') });
      total = a.total; streak = a.streak;
      const r = await M.api('/api/run/level', { runId: s.runId, level: L, taps: pl.taps });
      if (r.status === 'checkpoint' && L < 3) { const n = await M.api('/api/run/continue', { runId: s.runId }); L = n.level; seed = n.levelSeed; continue; }
      if (r.status === 'checkpoint') { end = await M.api('/api/run/cashout', { runId: s.runId }); mbal += end.payoutLamports; }
      else { end = r; mbal += r.payoutLamports; }
    }
    const local = MS.run(mine, levels, Date.now(), NEED); mine = local.s;
    addPaid(end.missions);
    const v = end.missions && end.missions.view;
    check(v && v.daily.every((d, k) => d.p === mine.d[k].p && d.done === mine.d[k].done && d.paid === mine.d[k].paid), `missions run ${i}: server progress matches a local replay ` + JSON.stringify([v && v.daily.map((d) => d.p), mine.d.map((d) => d.p)]));
    check(v && v.weekly.every((d, k) => d.p === mine.w[k].p && d.done === mine.w[k].done), `missions run ${i}: weekly progress matches`);
    if (v && v.playedLamports.day < NEED.day && v.daily.some((d) => d.done && !d.paid)) sawLocked = true;
    if (v && v.playedLamports.day >= NEED.day) check(v.daily.every((d) => !d.done || d.paid), `missions run ${i}: once the need is played every done mission is paid`);
    check(end.balance === mbal, `missions run ${i}: balance ${end.balance} vs ${mbal} (rewards ${paidTotal})`);
  }
  check(sawLocked, 'a mission done before the need was played waited for it');
  check(paidTotal > 0, 'mission rewards were paid: ' + paidTotal);

  // the special levels: three a day at 2x, 3x and 5x a fixed entry, each course set for the player's level in it (up
  // after a clear, down after a miss), a fresh course per attempt, the prize for clearing every ring
  const sfee = 50_000_000, view = (v) => v.specials.map((x) => [x.slot, x.recipe.id, x.course.grade, x.course.rings].join(':'));
  const sp0 = await M.api('/api/special');
  check(sp0.specials.length === 3 && sp0.specials.every((x, k) => x.slot === k && x.x === SP.SLOTS[k] && x.recipe.id === 'gauntlet' && x.prizeLamports === Math.floor(sfee * x.x)) && sp0.feeLamports === sfee, 'special: three slots, prizes 2x 3x 5x ' + JSON.stringify(view(sp0)));
  check(sp0.specials.every((x) => x.course.chance * x.x <= SP.TARGET + 1e-9 && x.course.rings >= SP.N_MIN && x.course.rings <= SP.N_MAX && x.me.tries === 0), 'special: every course set at 90% or less for a player at its level');
  check(sp0.me && sp0.me.skill && sp0.me.skill.rings > 0 && !sp0.me.blocked && sp0.specials.every((x) => x.course.level > SP.START), 'special: regular runs that show skill start the levels higher ' + JSON.stringify([sp0.me, sp0.specials.map((x) => x.course.level)]));
  const fresh = client_(8802); await fresh.signIn();
  const spF = await fresh.api('/api/special');
  check(spF.specials.every((x) => { const c = SP.courseFor(SP.START, 'gauntlet', x.x); return x.course.grade === c.g && x.course.rings === c.n && x.course.level === SP.START; }), 'special: someone new gets the courses set for a new player ' + JSON.stringify(view(spF)));
  check(view(spF).join() !== view(sp0).join(), 'special: a player who has shown skill gets other courses than someone new');
  // the specials open once a player has bet SP.UNLOCK entries in regular runs (0.5 SOL here); M has played 0.08
  const unlock = SP.UNLOCK * sfee;
  check(sp0.unlockLamports === unlock && sp0.me.locked === true && sp0.me.playedLamports === 8 * 10_000_000 && spF.me.locked === true && spF.me.playedLamports === 0, 'special: locked until the regular runs reach the unlock ' + JSON.stringify([sp0.unlockLamports, sp0.me.playedLamports]));
  const lockedTry = await M.api('/api/special/start', { clientSeed: 'lock1', slot: 0 });
  check(lockedTry.status === 400 && /unlock/.test(lockedTry.error || ''), 'special: an entry before the unlock is refused: ' + lockedTry.error);
  const open1 = await M.api('/api/run/start', { difficulty: 0, lamports: unlock - 8 * 10_000_000, clientSeed: 'openrun' });
  check((await M.api('/api/special/start', { clientSeed: 'sp0x', slot: 0 })).status === 400, 'special refused while a run is open');
  const pl1 = playTaps(open1.levelSeed, 0, 1, 'novice', 'open1');
  const e1 = await M.api('/api/run/level', { runId: open1.runId, level: 1, taps: pl1.taps });
  if (e1.status === 'checkpoint') await M.api('/api/run/cashout', { runId: open1.runId });
  const spU = await M.api('/api/special');
  check(spU.me.locked === false && spU.me.playedLamports === unlock, 'special: the regular runs reaching the unlock open the specials');
  check((await M.api('/api/special/start', { clientSeed: 'sp0y', slot: 3 })).status === 400 && (await M.api('/api/special/start', { clientSeed: 'sp0z' })).status === 400, 'special: an unknown slot is refused');
  let wins = 0, tries = 0;
  const lv2 = (await M.api('/api/special')).specials[2].course.level;
  const perSlot = [[0, 0], [0, 0], [0, 0]];
  for (const [k, slot, skill] of [[0, 2, 'perfect'], [1, 2, 'perfect'], [2, 0, 'novice'], [3, 1, 'perfect'], [4, 2, 'perfect']]) {
    const b0 = (await M.api('/api/me')).balance, pre = (await M.api('/api/special')).specials[slot];
    const s = await M.api('/api/special/start', { clientSeed: 'spec' + k + 'x', slot });
    tries++; perSlot[slot][0]++;
    const got = s.missions && s.missions.paid ? s.missions.paid.reduce((a, p) => a + p.lamports, 0) : 0;
    check(s.status === 200 && s.balance === b0 - sfee + got && s.prizeLamports === pre.prizeLamports && s.grade === pre.course.grade && s.rings === pre.course.rings, `special ${k}: start debits the entry and plays the course offered ` + JSON.stringify([s.status, s.error, s.grade, s.rings]));
    if (k === 0) {
      check((await M.api('/api/run/level', { runId: s.runId, level: 1, taps: [0] })).status === 404, 'a special can\'t be played as a run');
      check((await M.api('/api/run/start', { difficulty: 0, lamports: 10_000_000, clientSeed: 'during' })).status === 400, 'no run while a special is open');
    }
    const def = SP.generate(s.seed, 'gauntlet', s.grade, s.rings), st = E.createState(def), bot = B.createBot(skill, E.makeRng('sp' + k)), taps = [0];
    check(def.hoops.length === s.rings && def.hoops[s.rings - 1].cp, `special ${k}: a course of ${s.rings} rings, the last one gold`);
    let tap = true;
    while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); }
    const f = await M.api('/api/special/finish', { runId: s.runId, taps });
    const won = st.result === 'clear';
    if (won) { wins++; perSlot[slot][1]++; }
    check(f.status === (won ? 'won' : 'lost') && f.payoutLamports === (won ? s.prizeLamports : 0), `special ${k}: server ${f.status} vs local ${st.result}`);
    check(f.balance === s.balance + (won ? s.prizeLamports : 0), `special ${k}: balance after`);
    check(client.hex(client.sha256(client.utf8(f.serverSeed))) === s.serverSeedHash && client.deriveLevelSeed(f.serverSeed, 'spec' + k + 'x', s.nonce, 'special') === s.seed, `special ${k}: provably fair seed`);
    check((await M.api('/api/special/finish', { runId: s.runId, taps })).status === 400, `special ${k}: a second finish is refused`);
  }
  const sp1 = await M.api('/api/special');
  check(sp1.specials.every((x, k) => x.me.tries === perSlot[k][0] && x.me.wins === perSlot[k][1]) && wins >= 2, 'special tally by slot: ' + JSON.stringify(sp1.specials.map((x) => x.me)));
  check(sp1.me.skill.tries === tries && sp1.specials[2].course.level > lv2 && perSlot[2][1] >= 1, `special: clearing the 5x special raises its level (${lv2} -> ${sp1.specials[2].course.level})`);
  const hardest = (x) => x.course.grade === SP.GRADES.length - 1 && x.course.rings === SP.N_MAX; // a level past the hardest course
  check(sp1.specials.every((x) => x.course.chance * x.x <= SP.TARGET + 1e-9 || hardest(x)), 'special: courses still set at 90% or less for their level, or the hardest one ' + JSON.stringify(sp1.specials.map((x) => x.course)));
  const mv = await M.api('/api/missions');
  check(mv.playedLamports.day >= 8 * 10_000_000 + tries * 50_000_000, 'special entries count as play for missions');
  // a new day: new missions, nothing played, a new special tally
  await M.api('/api/dev/pot/advance', {});
  const m2 = await M.api('/api/missions'), sp2 = await M.api('/api/special');
  check(m2.day !== mv.day && m2.playedLamports.day === 0 && m2.daily.every((d) => d.p === 0 && !d.done), 'missions reset on a new day');
  check(sp2.day !== sp1.day && sp2.specials.every((x) => x.me.tries === 0) && sp2.me.skill.tries === tries, 'the special tallies reset on a new day; the rating stays');
  const poorS = client_(8802); await poorS.signIn();
  check((await poorS.api('/api/special/start', { clientSeed: 'poor1', slot: 0 })).status === 400, 'special entry without balance refused');
  srv4.kill();

  // play limits: a daily loss limit refuses what would pass it; lowering works at once, raising waits a day
  const srv5 = await boot(8803, { POT_ENTRY_LAMPORTS: '50000000' });
  const Lc = client_(8803); await Lc.signIn(); await Lc.api('/api/dev/faucet', { lamports: 2e9 });
  const l0 = await Lc.api('/api/limits');
  check(l0.status === 200 && l0.lossLamports === 0 && l0.pending === null && l0.lossTodayLamports === 0, 'limits: none to begin with ' + JSON.stringify(l0));
  const l1 = await Lc.api('/api/limits', { lossLamports: 100_000_000 });
  check(l1.lossLamports === 100_000_000 && l1.pending === null, 'limits: a new limit works at once');
  // lose 0.06 SOL: a run that hits the floor at once
  const lr = await Lc.api('/api/run/start', { difficulty: 0, lamports: 60_000_000, clientSeed: 'lim1' });
  await Lc.api('/api/run/level', { runId: lr.runId, level: 1, taps: [0] });
  check((await Lc.api('/api/limits')).lossTodayLamports === 60_000_000, 'limits: the day\'s loss counts the lost bet');
  const over = await Lc.api('/api/run/start', { difficulty: 0, lamports: 50_000_000, clientSeed: 'lim2' });
  check(over.status === 400 && /loss limit/.test(over.error || '') && /0\.04 SOL more/.test(over.error), 'limits: a bet past the limit is refused: ' + over.error);
  const potOver = await Lc.api('/api/pot/enter', {});
  check(potOver.status === 400 && /loss limit/.test(potOver.error || ''), 'limits: a pot entry past the limit is refused');
  const fits = await Lc.api('/api/run/start', { difficulty: 0, lamports: 40_000_000, clientSeed: 'lim3' });
  check(fits.status === 200, 'limits: a bet that fits under the limit plays');
  await Lc.api('/api/run/level', { runId: fits.runId, level: 1, taps: [0] });
  const full = await Lc.api('/api/run/start', { difficulty: 0, lamports: 10_000_000, clientSeed: 'lim4' });
  check(full.status === 400 && /reached your daily loss limit/.test(full.error || ''), 'limits: once reached, every bet is refused: ' + full.error);
  const raise = await Lc.api('/api/limits', { lossLamports: 500_000_000 });
  check(raise.lossLamports === 100_000_000 && raise.pending && raise.pending.lossLamports === 500_000_000 && raise.pending.at > Date.now() + 23 * 3600e3, 'limits: raising waits a day ' + JSON.stringify(raise));
  check((await Lc.api('/api/run/start', { difficulty: 0, lamports: 10_000_000, clientSeed: 'lim5' })).status === 400, 'limits: a waiting raise changes nothing yet');
  const off = await Lc.api('/api/limits', { lossLamports: 0 });
  check(off.lossLamports === 100_000_000 && off.pending && off.pending.lossLamports === 0, 'limits: turning it off waits a day too');
  const lower = await Lc.api('/api/limits', { lossLamports: 50_000_000 });
  check(lower.lossLamports === 50_000_000 && lower.pending === null, 'limits: lowering works at once and drops a waiting change');
  await Lc.api('/api/limits', { lossLamports: 200_000_000 });
  await Lc.api('/api/dev/pot/advance', {});
  const l2 = await Lc.api('/api/limits');
  check(l2.lossLamports === 200_000_000 && l2.pending === null && l2.lossTodayLamports === 0, 'limits: a day later the raise applies and the day\'s loss resets ' + JSON.stringify(l2));
  check((await Lc.api('/api/run/start', { difficulty: 0, lamports: 10_000_000, clientSeed: 'lim6' })).status === 200, 'limits: a new day plays again');
  check((await Lc.api('/api/limits', { lossLamports: -5 })).status === 400, 'limits: a negative limit is refused');
  srv5.kill();

  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
