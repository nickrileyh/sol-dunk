// End-to-end test of the game logic: spawns the server in mock-chain mode on a throwaway Postgres, signs in with a
// fresh ed25519 wallet, plays runs with the bot and checks every server result against a local recomputation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bootServer, apiClient, stopAll, check, failed } from './lib/harness.mjs';

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

// servers by test port (the ports are only labels now: each server gets a free one)
const servers = new Map();
async function boot(label, extra) { const s = await bootServer(extra); servers.set(label, s); return { kill: () => s.kill() }; }
const client_ = (label) => apiClient(servers.get(label).url);
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
  const TR = require(path.join(root, 'src/trophies.cjs'));
  const TRU = Math.round(TR.UNIT * 1e9);
  let tro = null, troSeen = 0;
  const NEED = { day: 50_000_000, week: 200_000_000 };
  const srv4 = await boot(8802, { MISSION_DAY_LAMPORTS: String(NEED.day), MISSION_WEEK_LAMPORTS: String(NEED.week), SPECIAL_RECIPE: 'gauntlet', SPECIAL_ENTRY_LAMPORTS: '50000000' });
  const M = client_(8802); await M.signIn(); await M.api('/api/dev/faucet', { lamports: 3e9 });
  const m0 = await M.api('/api/missions');
  check(m0.daily.length === 3 && m0.weekly.length === 3 && m0.playedLamports.day === 0 && m0.needLamports.day === NEED.day, 'missions: three a day, three a week, nothing played');
  check(m0.rounds === MS.ROUNDS && m0.round.day === 0 && m0.round.week === 0 && m0.all.day.length === 3 && m0.baseNeedLamports.week === NEED.week, 'missions: round 1 of three is open');
  const LV = require(path.join(root, 'src/levels.cjs'));
  const rb0 = (await M.api('/api/me')).rakeback;
  check(rb0 && rb0.accLamports === 0 && rb0.readyLamports === 0 && rb0.level === 1, 'rakeback: nothing set aside before the first bet ' + JSON.stringify(rb0));
  let myXp = 0, rbAcc = 0, rbReady = 0; // a local copy of the server's XP and rakeback
  const xpUp = (xp) => { const b = LV.stepsOf(myXp); myXp += xp; if (LV.stepsOf(myXp) > b) { const x = Math.floor(rbAcc); rbAcc -= x; rbReady += x; } };
  check(m0.daily[0].k === MS.daily(m0.day)[0].k && m0.daily.every((d, k) => d.rewardLamports === Math.floor(MS.reward('day', k, NEED.day))), 'missions: the day\'s set and its rewards');
  let mine = MS.roll(null, Date.now()), mbal = (await M.api('/api/me')).balance, paidTotal = 0, sawLocked = false, sawRound = false;
  const addPaid = (x) => { for (const p of (x && x.paid) || []) { paidTotal += p.lamports; mbal += p.lamports; } };
  for (let i = 0; i < 8; i++) {
    const bet = 10_000_000, di = 0;
    const s = await M.api('/api/run/start', { difficulty: di, lamports: bet, clientSeed: 'mis' + i + 'x' });
    mbal -= bet; mine = MS.play(mine, bet, Date.now(), NEED).s; addPaid(s.missions); rbAcc += bet * LV.BACK.run;
    check(s.balance === mbal, `missions run ${i}: start balance ${s.balance} vs ${mbal}`);
    check(s.rakeback.accLamports === Math.floor(rbAcc) && s.rakeback.readyLamports === rbReady, `rakeback run ${i}: 0.2% of the bet is set aside ` + JSON.stringify([s.rakeback, rbAcc, rbReady]));
    let L = 1, seed = s.levelSeed, total = 1, streak = 0, levels = [], end = null;
    while (!end) {
      const def = E.generateLevel(seed, di, L), pl = playTaps(seed, di, L, i % 2 ? 'perfect' : 'good', 'm' + i + ':' + L);
      const a = E.applyLevel(PAY.PAYTABLE[di][L - 1], pl.outcomes, total, E.DIFFS[di].maxWin, streak);
      const cnt = a.capped ? a.capIndex + 1 : pl.outcomes.length;
      levels.push({ outcomes: pl.outcomes.slice(0, cnt).join(''), clear: pl.result === 'clear' && !a.capped, mov: pl.outcomes.slice(0, cnt).map((o, k) => (def.hoops[k].amp ? '1' : '0')).join(''), tilt: pl.outcomes.slice(0, cnt).map((o, k) => (def.hoops[k].tilt ? '1' : '0')).join('') });
      total = a.total; streak = a.streak;
      const r = await M.api('/api/run/level', { runId: s.runId, level: L, taps: pl.taps });
      if (r.status === 'checkpoint' && L < 3) { const n = await M.api('/api/run/continue', { runId: s.runId }); L = n.level; seed = n.levelSeed; continue; }
      if (r.status === 'checkpoint') { end = await M.api('/api/run/cashout', { runId: s.runId }); mbal += end.payoutLamports; }
      else { end = r; mbal += r.payoutLamports; }
    }
    const local = MS.run(mine, levels, Date.now(), NEED); mine = local.s;
    addPaid(end.missions);
    const v = end.missions && end.missions.view;
    check(v && v.all.day.length === mine.d.length && v.all.day.every((d, k) => d.p === mine.d[k].p && d.done === mine.d[k].done && d.paid === mine.d[k].paid), `missions run ${i}: server progress matches a local replay ` + JSON.stringify([v && v.all.day.map((d) => d.p), mine.d.map((d) => d.p)]));
    check(v && v.all.week.length === mine.w.length && v.all.week.every((d, k) => d.p === mine.w[k].p && d.done === mine.w[k].done), `missions run ${i}: weekly progress matches`);
    check(v && v.round.day === mine.d.length / 3 - 1 && v.daily.every((d, k) => d.k === MS.daily(v.day, v.round.day)[k].k) && JSON.stringify(end.missions.opened) === JSON.stringify(local.opened), `missions run ${i}: the open round is the one a local replay opens`);
    if (local.opened.some((o) => o.win === 'day')) sawRound = true;
    if (v && v.all.day.some((d) => d.done && !d.paid && v.playedLamports.day < d.needLamports)) sawLocked = true;
    check(v && v.all.day.every((d) => !d.done || d.paid || v.playedLamports.day < d.needLamports), `missions run ${i}: every done mission whose round's need is played is paid`);
    check(v && v.all.day.reduce((a, d) => a + (d.paid ? d.rewardLamports : 0), 0) <= v.playedLamports.day * MS.SHARES.day + 1e-6, `missions run ${i}: the day has paid no more than its share of the play`);
    check(end.balance === mbal, `missions run ${i}: balance ${end.balance} vs ${mbal} (rewards ${paidTotal})`);
    xpUp(LV.runXp(local.facts) + local.done.reduce((a, d) => a + d.xp, 0));
    check(end.rakeback.readyLamports === rbReady && end.rakeback.accLamports === Math.floor(rbAcc) && end.rakeback.level === LV.lvlOf(myXp).l, `rakeback run ${i}: a level up (the server's own XP) releases it ` + JSON.stringify([end.rakeback, rbReady, rbAcc, LV.lvlOf(myXp).l]));
    // trophies: the server earns them from the same verified levels as a local replay does, and pays nothing for earning
    tro = TR.run(tro, levels, { paid: end.payoutLamports > 0, total, hard: di === E.DIFFS.length - 1, nl: E.LEVELS }, 1).s;
    const tv = end.trophies, mineT = TR.view(tro, tv ? tv.playedLamports : 0, TRU);
    check(tv && tv.list.length === TR.LIST.length && tv.list.every((x, k) => x.earned === mineT.list[k].earned && x.rewardLamports === mineT.list[k].reward && x.can === mineT.list[k].can && x.claimedLamports === 0),
      `trophies run ${i}: the server's trophies match a local replay ` + JSON.stringify(tv && tv.list.filter((x) => x.earned).map((x) => x.id)));
    troSeen = Math.max(troSeen, tv ? tv.list.filter((x) => x.earned).length : 0);
  }
  // trophy SOL: nothing can be claimed until TR.RATE of what's been bet covers it
  check(troSeen >= 3, 'trophies were earned in the runs: ' + troSeen);
  {
    const t0 = (await M.api('/api/trophies')).trophies, first = t0.list.find((x) => x.earned);
    check(t0.playedLamports === 8 * 10_000_000 && t0.open === 0 && t0.list.every((x) => !x.can) && first.moreLamports === first.rewardLamports / TR.RATE - t0.playedLamports, 'trophy SOL waits until the bets cover it: ' + JSON.stringify([first.id, first.moreLamports]));
    const early = await M.api('/api/trophies/claim', { id: first.id });
    check(early.status === 400 && /more to claim/.test(early.error || '') && (await M.api('/api/me')).balance === mbal, 'a claim before then is refused and pays nothing: ' + early.error);
  }
  check(sawLocked, 'a mission done before the need was played waited for it');
  check(sawRound, 'finishing a round of daily missions opened the next');
  check(paidTotal > 0, 'mission rewards were paid: ' + paidTotal);
  // rakeback: what the level ups released can be claimed once
  check(rbReady > 0 && LV.lvlOf(myXp).l > 1, `rakeback: eight runs levelled up and released ${rbReady} lamports`);
  const rk1 = await M.api('/api/rakeback/claim', {});
  check(rk1.claimedLamports === rbReady && rk1.balance === mbal + rbReady && rk1.rakeback.readyLamports === 0 && rk1.rakeback.paidLamports === rbReady, 'rakeback: a claim pays what is ready ' + JSON.stringify(rk1));
  mbal += rk1.claimedLamports;
  const rk2 = await M.api('/api/rakeback/claim', {});
  check(rk2.claimedLamports === 0 && rk2.balance === mbal, 'rakeback: nothing to claim twice');
  check((await client_(8802).api('/api/rakeback/claim', {})).status === 401, 'rakeback: a claim needs a sign-in');

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
  // each prize has SP.PER_SLOT specials a day: a clear moves it on to the next, and after the last it's done until tomorrow
  check(sp1.specials.every((x, k) => x.of === SP.PER_SLOT && x.at === Math.min(perSlot[k][1], SP.PER_SLOT - 1) && x.done === (perSlot[k][1] >= SP.PER_SLOT) && (x.done || x.at === SP.PER_SLOT - 1 ? !x.next : !!x.next)), 'special: each prize is on the one after those cleared today ' + JSON.stringify(sp1.specials.map((x) => [x.at, x.of, x.done])));
  for (let k = 0; perSlot[0][1] < SP.PER_SLOT && k < 40; k++) {
    const s = await M.api('/api/special/start', { clientSeed: 'more' + k + 'x', slot: 0 });
    if (s.status !== 200) { check(false, 'special: clearing on at 2x: ' + s.error); break; }
    tries++; perSlot[0][0]++;
    const st = E.createState(SP.generate(s.seed, 'gauntlet', s.grade, s.rings)), bot = B.createBot('perfect', E.makeRng('more' + k)), taps = [0];
    let tap = true;
    while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); }
    const f = await M.api('/api/special/finish', { runId: s.runId, taps });
    if (f.status === 'won') { wins++; perSlot[0][1]++; }
  }
  const spD = await M.api('/api/special'), balD = (await M.api('/api/me')).balance, over = await M.api('/api/special/start', { clientSeed: 'done1x', slot: 0 });
  check(perSlot[0][1] === SP.PER_SLOT && spD.specials[0].done && spD.specials[0].at === SP.PER_SLOT - 1 && !spD.specials[0].next && !spD.specials[1].done, 'special: a prize is done once all its specials are cleared ' + JSON.stringify(spD.specials.map((x) => [x.at, x.done])));
  check(over.status === 400 && /cleared all/.test(over.error || '') && (await M.api('/api/me')).balance === balD, 'special: no entry at a prize that is done for the day: ' + over.error);
  const hardest = (x) => x.course.grade === SP.GRADES.length - 1 && x.course.rings === SP.N_MAX; // a level past the hardest course
  check(sp1.specials.every((x) => x.course.chance * x.x <= SP.TARGET + 1e-9 || hardest(x)), 'special: courses still set at 90% or less for their level, or the hardest one ' + JSON.stringify(sp1.specials.map((x) => x.course)));
  const mv = await M.api('/api/missions');
  check(mv.playedLamports.day >= 8 * 10_000_000 + tries * 50_000_000, 'special entries count as play for missions');
  // trophy SOL once the bets cover it: claimed once, credited, and never more than TR.RATE of what's been bet
  {
    const t1 = (await M.api('/api/trophies')).trophies, can = t1.list.filter((x) => x.can), b0 = (await M.api('/api/me')).balance;
    const again = TR.view({ e: Object.fromEntries(t1.list.filter((x) => x.earned).map((x) => [x.id, 1])), c: {} }, t1.playedLamports, TRU);
    check(can.length >= 1 && t1.open === can.length && t1.list.every((x, k) => x.can === again.list[k].can) && can.reduce((n, x) => n + x.rewardLamports, 0) <= TR.RATE * t1.playedLamports,
      'trophy SOL opens with the bets (regular runs and special entries), the smallest first: ' + JSON.stringify([t1.playedLamports, can.map((x) => x.id)]));
    let got = 0;
    for (const x of can) {
      const c = await M.api('/api/trophies/claim', { id: x.id });
      got += x.rewardLamports;
      check(c.status === 200 && c.lamports === x.rewardLamports && c.balance === b0 + got && c.trophies.list.find((y) => y.id === x.id).claimedLamports === x.rewardLamports, 'claiming a trophy credits its SOL: ' + x.id);
    }
    const t2 = (await M.api('/api/trophies')).trophies;
    check(t2.claimedLamports === got && t2.open === 0 && got <= TR.RATE * t2.playedLamports, 'claims stay within their share of the bets: ' + JSON.stringify([got, t2.playedLamports]));
    const twice = await M.api('/api/trophies/claim', { id: can[0].id }), unknown = await M.api('/api/trophies/claim', { id: 'nope' }), locked = await M.api('/api/trophies/claim', { id: 'champion' });
    check(twice.status === 400 && /Already/.test(twice.error) && unknown.status === 404 && locked.status === 400 && /Earn/.test(locked.error) && (await M.api('/api/me')).balance === b0 + got, 'a second claim, an unknown trophy and an unearned one are refused');
    const waiting = t2.list.find((x) => x.earned && !x.claimedLamports);
    if (waiting) check((await M.api('/api/trophies/claim', { id: waiting.id })).status === 400, 'the next trophy waits for more bets: ' + waiting.id);
  }
  // a new day: new missions, nothing played, a new special tally
  await M.api('/api/dev/pot/advance', {});
  const m2 = await M.api('/api/missions'), sp2 = await M.api('/api/special');
  check(m2.day !== mv.day && m2.playedLamports.day === 0 && m2.daily.every((d) => d.p === 0 && !d.done), 'missions reset on a new day');
  check(sp2.day !== sp1.day && sp2.specials.every((x) => x.me.tries === 0) && sp2.me.skill.tries === tries, 'the special tallies reset on a new day; the rating stays');
  const poorS = client_(8802); await poorS.signIn();
  check((await poorS.api('/api/special/start', { clientSeed: 'poor1', slot: 0 })).status === 400, 'special entry without balance refused');
  srv4.kill();

  // mission rounds and rakeback, from the shared rules alone
  {
    const LV = require(path.join(root, 'src/levels.cjs'));
    const lv = (outcomes, clear = true, mov = '') => ({ outcomes, clear, mov });
    const f = MS.facts([lv('SSSSSS'), lv('SSRSSS'), lv('SS', false)]);
    check(f.greens === 2 && f.runs === 1 && f.fires === 2 && f.perfect === 1 && f.clears === 2, 'missions: green rings, runs and fires from ring outcomes ' + JSON.stringify(f));
    let ok = true, why = '';
    for (let d = 0; d < 60; d++) {
      const day = new Date(Date.UTC(2026, 10, 2) + d * 86400000).toISOString().slice(0, 10);
      const dr = MS.dailyRounds(day), wr = MS.weeklyRounds(MS.weekKey(Date.parse(day)));
      for (const [rounds, by] of [[dr, MS.DAILY_BY], [wr, MS.WEEKLY_BY]]) {
        const ks = rounds.flat().map((m) => m.k).filter((k) => k !== 'days');
        if (rounds.length !== MS.ROUNDS || rounds.some((r) => r.length !== 3) || new Set(ks).size !== ks.length || ks.some((k) => !by[k])) { ok = false; why = day; }
      }
      if (wr[0][1].k !== 'days' || wr[0][1].n !== 3 || wr[1][2].k !== 'days' || wr[1][2].n !== 5) { ok = false; why = day + ' days'; }
      if (dr.flat().some((m) => m.n < MS.DAILY_BY[m.k].n[m.slot][0])) { ok = false; why = day + ' targets'; }
    }
    check(ok, 'missions: three rounds of three a day and a week, no kind twice in a window, a days mission in weekly rounds 1 and 2 ' + why);
    for (const win of ['day', 'week']) {
      const total = [0, 1, 2].reduce((a, r) => a + [0, 1, 2].reduce((b, s) => b + MS.reward(win, s, null, r), 0), 0);
      check(Math.abs(total - MS.NEED[win] * MS.SHARES[win] * MS.STEPS[MS.ROUNDS - 1]) < 1e-12 && [0, 1, 2].every((r) => Math.abs([0, 1, 2].reduce((b, s) => b + MS.reward(win, s, null, r), 0) - MS.SHARES[win] * (MS.needAt(win, r) - (r ? MS.needAt(win, r - 1) : 0))) < 1e-12), `missions: each ${win} round pays its share of the play its need adds`);
    }
    check(Math.abs(MS.RATE - 0.005) < 1e-12 && MS.RATE + LV.BACK.run <= 0.0071 && LV.CUT.pot === POTS.RAKE && LV.CUT.special <= 1 - SP.TARGET, 'missions and rakeback together give back less than the 1% the house keeps from a good player');
    // a player who swishes everything, a week of days: rounds open one at a time, later rounds wait for more play, and
    // a window never pays more than its share of what was played in it
    let s = null, opened = 0, maxDay = 0, days = 0;
    const t0 = Date.parse('2027-01-04T10:00:00Z'), all = [lv('SSSSSS', true, '010101'), lv('SSSSSS', true, '111111'), lv('SSSSSS', true, '101010'), lv('SSSSSS', true, '111111'), lv('SSSSSS', true, '111111')];
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 30; i++) {
        const ts = t0 + d * MS.DAY_MS + i * 60000;
        s = MS.play(s, 0.5, ts).s;
        const before = s.d.length, r = MS.run(s, all, ts); s = r.s;
        if (s.d.length > before + 3) ok = false; // one run opens one round at most
        opened += r.opened.length;
        for (const [win, list, played] of [['day', s.d, s.dp], ['week', s.w, s.wp]]) {
          const paid = list.reduce((a, m, k) => a + (m.paid ? MS.reward(win, k % 3, null, Math.floor(k / 3)) : 0), 0);
          if (paid > played * MS.SHARES[win] + 1e-9) { ok = false; why = `${win} paid ${paid} on ${played}`; }
        }
        // a round's rewards wait for its need
        if (s.d.some((m, k) => m.paid && s.dp < MS.needAt('day', Math.floor(k / 3)) - 1e-9)) { ok = false; why = 'paid before its need'; }
      }
      const v = MS.view(s, t0 + d * MS.DAY_MS + 3600000);
      maxDay = Math.max(maxDay, v.paid.day); days = v.days;
      if (d === 0) check(v.round.day === MS.ROUNDS - 1 && v.daily.every((m) => m.done && m.paid) && v.next.day === null && Math.abs(v.paid.day - v.max.day) < 1e-9 && v.days === 1, 'missions: a strong day finishes all three daily rounds and collects the whole day ' + JSON.stringify([v.round, v.paid, v.max, v.days]));
      if (d === 2) check(v.all.week[1].k === 'days' && v.all.week[1].done, 'missions: three days with a daily round finish the week\'s first days mission');
    }
    check(ok && opened >= 14 && days === 7 && Math.abs(maxDay - MS.NEED.day * MS.SHARES.day * MS.STEPS[2]) < 1e-9, 'missions: rounds open one at a time and no window pays more than its share of the play ' + why);
    // levels and rakeback
    check(LV.lvlOf(0).l === 1 && LV.xpNeed(1) === 70 && LV.xpNeed(2) === 105 && LV.lvlOf(69).l === 1 && LV.lvlOf(70).l === 2 && LV.lvlOf(175).l === 3, 'levels: 70 XP for the first, 35 more for each after');
    check([0, 49, 50, 124, 125, 1000, 5000].every((x) => { let l = 1, n = 50, y = x; while (y >= n && l < 99) { y -= n; l++; n = 50 + 25 * (l - 1); } return LV.lvlOf(LV.fromOld(x)).l === l; }), 'levels: saved XP keeps its level on the new curve');
    let rb = null;
    rb = LV.add(rb, 'run', 100); rb = LV.add(rb, 'special', 10); rb = LV.add(rb, 'pot', 5);
    check(Math.abs(rb.acc - (0.2 + 0.1 + 0.1)) < 1e-12 && rb.ready === 0, 'rakeback: 0.2% of run bets, 1% of special entries, 2% of pot entries');
    const rel = LV.release(rb, false), got = LV.claim(rb);
    check(Math.abs(rel - 0.4) < 1e-12 && Math.abs(got - 0.4) < 1e-12 && rb.acc === 0 && rb.ready === 0 && Math.abs(rb.paid - 0.4) < 1e-12 && LV.claim(rb) === 0, 'rakeback: a level up releases it, a claim pays it once');
    const top = LV.lvlOf(1e9); let past = 0;
    for (let k = 1; k < LV.MAX; k++) past += LV.xpNeed(k);
    check(top.l === LV.MAX && LV.stepsOf(past + LV.xpNeed(LV.MAX) * 3 + 1) === LV.MAX + 3, 'levels: past the top level, rakeback still releases every level\'s worth of XP');
  }

  // the newer pot challenges, judged from ring outcomes alone, and the special levels' rotation
  {
    const lv = (outcomes, clear = true) => ({ outcomes, clear });
    const TRr = require(path.join(root, 'src/trophies.cjs'));
    const r1 = TRr.run(null, [{ outcomes: 'SSSSSS', clear: true, mov: '010000', tilt: '000100' }, { outcomes: 'SSSS', clear: false }], { paid: false, total: 0, hard: false, nl: 8 }, 7);
    check(r1.earned.join() === 'swish1,cp1,fire3,moving,nova5,perfect,tilted,score50,streak10' && r1.s.sw === 10, 'trophies: judged from ring outcomes ' + r1.earned.join());
    check(TRr.run(null, [{ outcomes: 'RRRRRR', clear: true }], { paid: true, total: 2.2, hard: true, nl: 8 }, 7).earned.join() === 'cp1,double,legend', 'trophies: a 2x cash-out and a Hard clear');
    check(TRr.LIST.reduce((n, t) => n + TRr.reward(t), 0) < 0.1 && TRr.RATE + require(path.join(root, 'src/missions.cjs')).RATE + require(path.join(root, 'src/levels.cjs')).BACK.run < 0.01, 'trophies: rewards are small, and with mission SOL and rakeback they stay under the 1% edge against a good player');
    const f1 = POTS.facts([lv('SSRSSS'), lv('SSSSSS'), lv('RSSSSR'), lv('SSS', false)]);
    check(f1.greens === 2 && f1.hot === 2 && f1.comeback === 9 && f1.early === 11 && f1.perfect === 1, 'pots: green rings, checkpoints on fire, a streak after a rim hit and the first twelve rings ' + JSON.stringify(f1));
    const f2 = POTS.facts([lv('SSSSSS'), lv('SSSS', false)]);
    check(f2.comeback === 0 && f2.best === 10 && f2.greens === 1 && f2.hot === 1 && f2.early === 10, 'pots: a streak counts as a comeback only after a rim hit ' + JSON.stringify(f2));
    check(POTS.progress('early8', [lv('SSSSSS'), lv('SSRRRR')], 0).done === false && POTS.progress('early8', [lv('SSSSSS'), lv('SSRRRR')], 1).done === true, 'pots: a Hard challenge needs a Hard run');
    check(POTS.GOALS.length === 12 && new Set(POTS.GOALS.map((g) => g.id)).size === 12 && POTS.GOALS.every((g) => g.kind in f1 && g.p.length === 3), 'pots: twelve challenges, each of a kind the rules can judge');
    // each prize's specials for a day: PER_SLOT of them in order, every twist somewhere, no twist under two prizes;
    // one prize a day opens with a course with walls, and no opener comes back the next day
    let prev = [], bad = 0, walled = 0; const seen = {}, wallSlots = new Set();
    for (let d = 0; d < 120; d++) {
      const day = new Date(Date.UTC(2026, 10, 1) + d * 86400000).toISOString().slice(0, 10), q = SP.queuesFor(day), all = [].concat(...q).map((R) => R.id);
      const ids = SP.specialsFor(day).map((x) => x.recipe.id);
      if (new Set(ids).size !== 3 || ids.some((id) => prev.includes(id)) || ids.join() !== q.map((x) => x[0].id).join()) bad++;
      if (q.some((x) => x.length !== SP.PER_SLOT) || new Set(all).size !== SP.RECIPES.length) bad++;
      const w = q.map((x, k) => (x[0].ob ? k : -1)).filter((k) => k >= 0);
      if (w.length === 1) { walled++; wallSlots.add(w[0]); }
      ids.forEach((id) => { seen[id] = (seen[id] || 0) + 1; }); prev = ids;
    }
    check(SP.RECIPES.length === 15 && SP.PLAIN.length === 12 && SP.OBST.length === 3 && bad === 0 && Object.keys(seen).length === 15, 'specials: fifteen twists, all of them in a day\'s three queues of five, and no opener two days running ' + JSON.stringify([bad, Object.keys(seen).length]));
    check(walled === 120 && wallSlots.size === 3 && SP.OBST.every((R) => seen[R.id] === 40), 'specials: one prize a day opens with a wall course, the prizes and the three courses taking turns');
    const dq = SP.queuesFor('2026-11-20'), w2 = SP.specialsFor('2026-11-20', [2, 0, SP.PER_SLOT + 3]);
    check(w2[0].recipe === dq[0][2] && w2[0].at === 2 && !w2[0].done && w2[0].next === dq[0][3] && w2[1].recipe === dq[1][0] && w2[2].done && w2[2].recipe === dq[2][SP.PER_SLOT - 1] && w2[2].next === null, 'specials: a prize is on the one after those cleared, and done after the last');
    { // walls: in order, between the rings, the same at any length, and passable; a ball that flies into one is out
      const a = SP.generate('w1', 'walls', 3, 8), b = SP.generate('w1', 'walls', 3, 20), plain = SP.generate('w1', 'gauntlet', 3, 8);
      check(!plain.walls && a.walls.length === 7 && b.walls.length === 19 && a.walls.every((w, i) => w.x0 === b.walls[i].x0 && w.y0 === b.walls[i].y0), 'walls: one between every two rings, the same at any length');
      check(b.walls.every((w, i) => w.x0 > b.hoops[i].x + 60 && w.x1 < b.hoops[i + 1].x - 60 && w.x1 - w.x0 === SP.WALL_W && w.y0 >= 120 && w.y0 < E.WORLD.FLOOR - 100 && (i === 0 || w.x0 > b.walls[i - 1].x1)), 'walls: each stands clear of the rings on both sides');
      const st = E.createState(a); st.next = 1; st.ball.x = a.walls[0].x0 - 50; st.ball.y = a.walls[0].y0 + 40; // past the first ring, below the wall's top
      let n = 0;
      while (!st.done && n++ < 200) E.step(st, false);
      check(st.result === 'wall' && st.walls[0].hit && st.ball.x < a.walls[0].x0, 'walls: flying into one ends the attempt: ' + st.result);
      const over = E.createState(a); over.next = 1; over.ball.x = a.walls[0].x0 - 50; over.ball.y = a.walls[0].y0 - E.PHYS.R - 60; over.ball.vy = -200; // well over its top
      for (n = 0; !over.done && over.ball.x - E.PHYS.R <= a.walls[0].x1 && n < 200; n++) E.step(over, false);
      check(!over.done && over.wi <= 1 && !over.walls[0].hit, 'walls: a ball over its top passes');
      const r = E.replay(a, [0]);
      check(r.result !== 'clear', 'walls: a replay without taps does not clear');
    }
    check(SP.RECIPES.every((R) => SP.TABLES.sp[R.id] && SP.TABLES.sp[R.id].length === SP.GRADES.length), 'specials: every twist has measured tables');
    for (const R of SP.RECIPES) { // a course of n rings is the first n rings of a longer one, inside the ring band
      const a = SP.generate('t1', R.id, 4, 8).hoops, b = SP.generate('t1', R.id, 4, 20).hoops;
      check(a.every((h, i) => h.x === b[i].x && h.y0 === b[i].y0 && h.w === b[i].w && h.amp === b[i].amp && h.phase === b[i].phase) && b.every((h) => h.y0 - h.amp >= E.Y_MIN - 1e-6 && h.y0 + h.amp <= E.Y_MAX + 1e-6 && h.w > 60), 'specials: ' + R.id + ' builds the same rings at any length, inside the ring band');
    }
  }

  // ---- duels (src/duel.cjs): one course, two flights, further wins; the house keeps 10% of each entry
  {
    const DU = require(path.join(root, 'src/duel.cjs'));
    const srvD = await boot(8812, { ADMIN_TOKEN: 'duel-test-admin-token-0123456789' });
    const X = client_(8812), Y = client_(8812), Z = client_(8812);
    for (const p of [X, Y, Z]) { await p.signIn(); await p.api('/api/dev/faucet', { lamports: 1e9 }); }
    const fee = 50_000_000, pot = DU.pot(fee);
    const flyBot = (seed, skill, salt) => { const st = E.createState(DU.generate(seed)), bot = B.createBot(skill, E.makeRng(salt)), taps = [0]; let tap = true; while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); } return { taps, rings: st.outcomes.length, score: DU.score(st.outcomes) }; };
    const bal = async (p) => (await p.api('/api/me')).balance;
    const v0 = await X.api('/api/duel');
    check(v0.feeLamports === fee && v0.prizeLamports === pot && pot === 90_000_000 && v0.waiting.length === 0 && v0.rings === DU.RINGS, 'duel: the view gives the entry and what the winner takes ' + JSON.stringify(v0));
    const c1 = DU.generate('t'), c2 = DU.generate('t', 12);
    check(c1.hoops.length === DU.RINGS && c2.hoops.every((h, i) => h.x === c1.hoops[i].x && h.y0 === c1.hoops[i].y0 && h.w === c1.hoops[i].w) && c1.hoops.every((h) => h.y0 - h.amp >= E.Y_MIN - 1e-6 && h.y0 + h.amp <= E.Y_MAX + 1e-6 && h.w >= DU.W_MIN) && c1.hoops[0].w > c1.hoops[DU.RINGS - 1].w, 'duel: the course stays in the ring band and tightens ring by ring');
    check(DU.compare({ rings: 5, score: 3 }, { rings: 4, score: 30 }) === 1 && DU.compare({ rings: 5, score: 3 }, { rings: 5, score: 4 }) === -1 && DU.compare({ rings: 5, score: 3 }, { rings: 5, score: 3 }) === 0 && DU.payouts(fee, 0).a === pot / 2 && DU.payouts(fee, 1).b === 0, 'duel: more rings wins, then the score, then the pot is split');
    // X has nobody to race: the flight sets the mark, and the entry is held
    const a = await X.api('/api/duel/start', { clientSeed: 'duelA1' });
    check(a.status === 200 && a.rival === null && a.balance === 1e9 - fee, 'duel: with nobody to race, the entry is taken and there is no ghost ' + JSON.stringify([a.status, a.error]));
    check((await X.api('/api/run/level', { runId: a.runId, level: 1, taps: [0] })).status === 404, 'duel: a duel can\'t be played as a run');
    check((await X.api('/api/duel/start', { clientSeed: 'duelA2' })).status === 400 && (await X.api('/api/run/start', { difficulty: 0, lamports: 10_000_000, clientSeed: 'during' })).status === 400, 'duel: nothing else starts while a duel is open');
    const fa = flyBot(a.seed, 'average', 'da');
    const ra = await X.api('/api/duel/finish', { runId: a.runId, taps: fa.taps });
    check(ra.status === 'waiting' && ra.you.rings === fa.rings && ra.you.score === fa.score && ra.payoutLamports === 0 && ra.duel.waiting.length === 1 && ra.duel.waiting[0].rings === fa.rings, 'duel: the flight is replayed and waits as the mark ' + JSON.stringify([ra.status, ra.you, fa.rings, fa.score]));
    check(client.deriveLevelSeed(ra.serverSeed, a.clientSeed, a.nonce, 'duel') === a.seed && client.hex(client.sha256(client.utf8(ra.serverSeed))) === a.serverSeedHash, 'duel: the course comes from the committed seed');
    check((await X.api('/api/duel/finish', { runId: a.runId, taps: fa.taps })).status === 400, 'duel: a second finish is refused');
    const pub = await (await fetch(servers.get(8812).url + '/api/run/' + a.runId)).json();
    check(pub.status === 'waiting' && pub.serverSeed === undefined, 'duel: a waiting mark\'s seed stays shut to everyone else');
    // X can't race their own mark: a second entry sets another mark
    const a2 = await X.api('/api/duel/start', { clientSeed: 'duelA3' });
    check(a2.status === 200 && a2.rival === null && a2.seed !== a.seed, 'duel: a player never races their own mark');
    await X.api('/api/duel/finish', { runId: a2.runId, taps: [0] });
    // Y races the oldest mark: the same course, the mark's taps for the ghost, and the duel settles at the finish
    const xb = await bal(X), b = await Y.api('/api/duel/start', { clientSeed: 'duelB1' });
    check(b.status === 200 && b.seed === a.seed && b.rival && b.rival.rings === fa.rings && b.rival.score === fa.score && JSON.stringify(b.rival.taps) === JSON.stringify(fa.taps) && b.balance === 1e9 - fee, 'duel: the next player gets the mark\'s course and its flight ' + JSON.stringify([b.status, b.error]));
    const fb = flyBot(b.seed, fa.rings > 8 ? 'novice' : 'perfect', 'db');
    const cmp = DU.compare(fb, fa), rb = await Y.api('/api/duel/finish', { runId: b.runId, taps: fb.taps });
    const exp = cmp > 0 ? 'won' : cmp < 0 ? 'lost' : 'draw', pay = DU.payouts(fee, cmp);
    check(rb.status === exp && rb.payoutLamports === pay.a && rb.you.rings === fb.rings && rb.rival.rings === fa.rings && rb.balance === 1e9 - fee + pay.a, `duel: settled from the two replays (${fb.rings} v ${fa.rings}: ${rb.status}, paid ${rb.payoutLamports})`);
    const xa = await bal(X), vx = await X.api('/api/duel');
    check(xa - xb === pay.b && vx.last && vx.last.status === (cmp > 0 ? 'lost' : cmp < 0 ? 'won' : 'draw') && vx.last.payoutLamports === pay.b && vx.waiting.length === 1, 'duel: the mark\'s player is paid and told ' + JSON.stringify([xa - xb, vx.last && vx.last.status]));
    check(pay.a + pay.b === pot && 2 * fee - pot === 2 * Math.round(fee * DU.RAKE), 'duel: the house keeps its cut of both entries and nothing else');
    const pub2 = await (await fetch(servers.get(8812).url + '/api/run/' + a.runId)).json();
    check(pub2.serverSeed === ra.serverSeed, 'duel: a settled duel can be checked by anyone');
    // Z races X's other mark (one tap, hardly a ring) and stops as soon as the duel is won
    const z = await Z.api('/api/duel/start', { clientSeed: 'duelZ1' });
    const m2 = DU.fly(DU.generate(z.seed), [0]), st = E.createState(DU.generate(z.seed)), bot = B.createBot('perfect', E.makeRng('dz')), zt = [0];
    let tap = true;
    while (!st.done && st.outcomes.length <= m2.rings) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) zt.push(st.tick); }
    const rz = await Z.api('/api/duel/finish', { runId: z.runId, taps: zt.filter((t) => t < st.tick), stop: st.tick });
    check(z.rival && z.rival.rings === m2.rings && st.outcomes.length === m2.rings + 1 && rz.status === 'won' && rz.you.rings === m2.rings + 1 && rz.payoutLamports === pot, 'duel: past a rival who\'s out, the flight stops there and wins ' + JSON.stringify([m2.rings, st.outcomes.length, rz.status, rz.you]));
    // a mark nobody takes on is refunded in full
    const t0 = await bal(Z), w = await Z.api('/api/duel/start', { clientSeed: 'duelZ2' });
    await Z.api('/api/duel/finish', { runId: w.runId, taps: [0] });
    const ov = await (await fetch(servers.get(8812).url + '/api/admin/overview', { headers: { authorization: 'Bearer duel-test-admin-token-0123456789' } })).json();
    check((await bal(Z)) === t0 - fee && ov.bankroll && Number(ov.bankroll.owed.runs) === fee, 'duel: a waiting mark holds its entry, and it counts as owed ' + JSON.stringify(ov.bankroll && ov.bankroll.owed));
    const srvW = await boot(8813, { DUEL_WAIT_MS: '1' }), W = client_(8813);
    await W.signIn(); await W.api('/api/dev/faucet', { lamports: 1e9 });
    const wm = await W.api('/api/duel/start', { clientSeed: 'duelW1' });
    await W.api('/api/duel/finish', { runId: wm.runId, taps: [0] });
    await new Promise((r) => setTimeout(r, 30));
    await W.api('/api/dev/duel/sweep', {});
    const vw = await W.api('/api/duel');
    check((await bal(W)) === 1e9 && vw.waiting.length === 0 && vw.last && vw.last.status === 'refunded', 'duel: a mark nobody takes on comes back in full ' + JSON.stringify(vw.last));
    srvW.kill();
    const poor = client_(8812); await poor.signIn();
    check((await poor.api('/api/duel/start', { clientSeed: 'poor1' })).status === 400, 'duel: no entry without the balance');
    srvD.kill();
  }

  await stopAll();
  console.log(failed() ? `${failed()} check(s) failed` : 'game flow: all checks passed');
  process.exitCode = failed() ? 1 : 0;
})().catch(async (e) => { console.error(e); await stopAll(); process.exitCode = 1; });
