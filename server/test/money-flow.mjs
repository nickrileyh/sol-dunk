// Money on a real Solana runtime (LiteSVM behind a JSON-RPC endpoint, test/lib/svm-rpc.mjs): deposits signed by the
// player's wallet, the deposit watcher, withdrawals that land, land late, get lost or lose their answer, the hot
// wallet running dry, reviews, limits, sweeps to the cold wallet, the bankroll, parallel requests and the ledger.
// Every withdrawal is checked against the player's on-chain balance: paid exactly once.
import { createRequire } from 'node:module';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, Message, Transaction, SystemProgram, Connection } from '@solana/web3.js';
import { bootServer, apiClient, admin as adminClient, stopAll, check, failed } from './lib/harness.mjs';
import { startSvmRpc } from './lib/svm-rpc.mjs';

const require = createRequire(import.meta.url);
const E = require('../../src/engine.cjs');
const B = require('../../src/bot.cjs');
const SOL = 1e9;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000, step = 150) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(step); }
}

(async () => {
  const rpc = await startSvmRpc();
  const conn = new Connection(rpc.url, 'confirmed');
  const house = Keypair.generate(), cold = Keypair.generate();
  const ADMIN = 'test-admin-token-' + 'x'.repeat(32);
  const srv = await bootServer({
    MOCK_CHAIN: '0', NETWORK: 'localnet', RPC_URL: rpc.url, HOUSE_SECRET: bs58.encode(house.secretKey), COLD_ADDRESS: cold.publicKey.toBase58(),
    ADMIN_TOKEN: ADMIN, HOT_MIN_LAMPORTS: String(1 * SOL), HOT_TARGET_LAMPORTS: String(2 * SOL), HOT_MAX_LAMPORTS: String(4 * SOL),
    DEPOSIT_COMMITMENT: 'finalized', DEPOSIT_WAIT_MS: '5000', WITHDRAW_WAIT_MS: '3000', WITHDRAW_REVIEW_LAMPORTS: String(2 * SOL),
    PRIORITY_FEE_MICROLAMPORTS: '1000', RESEND_GAP_MS: '300', WATCH_DEPOSITS: '0', RISK_FRACTION: '1', MAX_BET_LAMPORTS: String(10 * SOL)
  });
  const A = adminClient(srv.url, ADMIN);
  const hotAddr = house.publicKey.toBase58();
  await rpc.ctl({ airdrop: { address: hotAddr, lamports: 3 * SOL } });

  // a player with a funded wallet, signed in
  async function player(lamports = 10 * SOL) {
    const kp = nacl.sign.keyPair(), c = apiClient(srv.url);
    const wallet = Keypair.fromSecretKey(kp.secretKey);
    await rpc.ctl({ airdrop: { address: wallet.publicKey.toBase58(), lamports } });
    await c.signIn(kp);
    return { c, wallet, address: wallet.publicKey.toBase58() };
  }
  // what Phantom does with the server's deposit message: sign it and send it
  async function walletDeposit(p, lamports) {
    const prep = await p.c.api('/api/deposit/prepare', { lamports });
    if (!prep.message) return { prep };
    const tx = Transaction.populate(Message.from(bs58.decode(prep.message)));
    tx.sign(p.wallet);
    const signature = await conn.sendRawTransaction(tx.serialize());
    return { prep, signature };
  }
  async function transfer(fromKp, to, lamports) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ feePayer: fromKp.publicKey, blockhash, lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: fromKp.publicKey, toPubkey: typeof to === 'string' ? new (require('@solana/web3.js').PublicKey)(to) : to, lamports }));
    tx.sign(fromKp);
    return conn.sendRawTransaction(tx.serialize());
  }
  const bal = async (p) => (await p.c.api('/api/me')).balance;
  const wStatus = async (p, id) => ((await p.c.api('/api/me')).withdrawals || []).find((w) => w.id === id);
  const settle = async () => { await A('/reconcile', {}); };

  // ---- sign-in message names the site and the network
  const p1 = await player();
  const signin = await apiClient(srv.url).api('/api/auth/nonce', { address: p1.address });
  check(/wants you to sign in with your Solana account/.test(signin.message) && /Chain ID: localnet/.test(signin.message), 'sign-in message is SIWS-style: ' + signin.message.split('\n')[0]);

  // ---- deposit through the wallet, credited once it's final
  const d1 = await walletDeposit(p1, 2 * SOL);
  const c1 = await p1.c.api('/api/deposit/confirm', { signature: d1.signature });
  check(c1.status === 'credited' && c1.credited === 2 * SOL && c1.balance === 2 * SOL, 'deposit credited: ' + JSON.stringify([c1.status, c1.credited, c1.balance, c1.error]));
  check(rpc.balance(hotAddr) === 5 * SOL, 'the SOL is in the hot wallet: ' + rpc.balance(hotAddr) / SOL + ' cold ' + rpc.balance(cold.publicKey.toBase58()) / SOL);
  const c1b = await p1.c.api('/api/deposit/confirm', { signature: d1.signature });
  check(c1b.status === 'credited' && c1b.credited === 0 && c1b.balance === 2 * SOL, 'the same deposit again is not credited twice');
  const p2 = await player();
  const steal = await p2.c.api('/api/deposit/confirm', { signature: d1.signature });
  check(steal.status === 400 && (await bal(p2)) === 0, 'someone else can\'t claim your deposit: ' + steal.error);
  check((await p1.c.api('/api/deposit/prepare', { lamports: 1000 })).status === 400, 'deposit below the minimum refused');

  // ---- the watcher credits a transfer the client never reported, and ignores the house's own money
  const direct = await transfer(p1.wallet, hotAddr, 0.5 * SOL);
  await rpc.ctl({ airdrop: { address: cold.publicKey.toBase58(), lamports: 5 * SOL } });
  await transfer(cold, hotAddr, 1 * SOL); // a top-up from the cold wallet: not a deposit
  await sleep(200);
  await A('/watch-deposits', {});
  check((await bal(p1)) === 2.5 * SOL, 'the watcher credited a deposit the client never confirmed');
  const late = await p1.c.api('/api/deposit/confirm', { signature: direct });
  check(late.credited === 0 && (await bal(p1)) === 2.5 * SOL, 'confirming it afterwards doesn\'t credit it again');
  const stranger = Keypair.generate();
  await rpc.ctl({ airdrop: { address: stranger.publicKey.toBase58(), lamports: 2 * SOL } });
  const strangerSig = await transfer(stranger, hotAddr, 0.3 * SOL);
  await sleep(200);
  await A('/watch-deposits', {});
  const rv = await A('/reviews');
  check(rv.unmatched.length === 1 && rv.unmatched[0].from_address === stranger.publicKey.toBase58() && rv.unmatched[0].lamports === 0.3 * SOL, 'a transfer from a wallet that never signed in is kept aside for review');
  check(!rv.unmatched.some((u) => u.from_address === cold.publicKey.toBase58()), 'the cold-wallet top-up is not a deposit');
  // the stranger signs in later: the operator credits it
  const sc = apiClient(srv.url); await sc.signIn(nacl.sign.keyPair.fromSecretKey(stranger.secretKey));
  const res = await A('/unmatched/resolve', { signature: strangerSig, from: stranger.publicKey.toBase58(), action: 'credit', note: 'signed in later' });
  check(res.ok && (await sc.api('/api/me')).balance === 0.3 * SOL, 'the operator credits it once the wallet has signed in');

  // ---- a run on the real-chain server (bets are bank balance; nothing on chain)
  const di = 0, bet = 0.01 * SOL;
  const s = await p1.c.api('/api/run/start', { difficulty: di, lamports: bet, clientSeed: 'money1' });
  check(s.status === 200 && s.balance === 2.49 * SOL, 'a bet comes off the balance: ' + JSON.stringify([s.status, s.error]));
  {
    const def = E.generateLevel(s.levelSeed, di, 1), st = E.createState(def), bot = B.createBot('perfect', E.makeRng('m1')), taps = [0];
    let tap = true;
    while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); }
    const r = await p1.c.api('/api/run/level', { runId: s.runId, level: 1, taps });
    if (r.status === 'checkpoint') await p1.c.api('/api/run/cashout', { runId: s.runId });
  }
  let before = await bal(p1);

  // ---- withdrawal: lands, paid exactly once
  const w0 = rpc.balance(p1.address);
  const w1 = await p1.c.api('/api/withdraw', { lamports: 0.5 * SOL });
  check(w1.status === 'sent' && w1.signature && w1.balance === before - 0.5 * SOL, 'withdrawal sent: ' + JSON.stringify([w1.status, w1.error]));
  check(rpc.balance(p1.address) === w0 + 0.5 * SOL, 'the player\'s wallet got exactly 0.5 SOL');
  check((await p1.c.api('/api/withdraw', { lamports: 1000 })).status === 400, 'withdrawal below the minimum refused');

  // ---- the answer to the broadcast is lost, but the transaction landed: marked sent, never sent again
  let w = rpc.balance(p1.address);
  await rpc.ctl({ lose: 1 });
  const w2 = await p1.c.api('/api/withdraw', { lamports: 0.3 * SOL });
  check(w2.status === 'sent' || w2.status === 'sending', 'lost answer: the withdrawal is on its way: ' + w2.status);
  await settle();
  check((await wStatus(p1, w2.id)).status === 'sent', 'lost answer: the reconciler finds it landed');
  await rpc.ctl({ advance: 400 }); await settle(); await sleep(200); await settle();
  check((await wStatus(p1, w2.id)).status === 'sent' && rpc.balance(p1.address) === w + 0.3 * SOL, 'lost answer: paid exactly once, even after its blockhash expired');

  // ---- the network drops it: it expires, then goes out again with a new signature, paid once
  w = rpc.balance(p1.address);
  await rpc.ctl({ drop: 1 });
  const w3 = await p1.c.api('/api/withdraw', { lamports: 0.2 * SOL });
  check(w3.status === 'sending', 'dropped: still sending after the wait: ' + w3.status);
  await settle();
  check((await wStatus(p1, w3.id)).status === 'sending', 'dropped: not given up while its blockhash is still valid');
  await rpc.ctl({ advance: 400 }); await settle();
  const w3b = await waitFor(async () => { await settle(); const x = await wStatus(p1, w3.id); return x.status === 'sent' ? x : null; });
  check(w3b && w3b.signature !== w3.signature && rpc.balance(p1.address) === w + 0.2 * SOL, 'dropped: re-sent after expiry and paid exactly once');

  // ---- it lands late (after the server stopped waiting) but before expiry: sent, once
  w = rpc.balance(p1.address);
  await rpc.ctl({ hold: 1 });
  const w4 = await p1.c.api('/api/withdraw', { lamports: 0.1 * SOL });
  await settle();
  check((await wStatus(p1, w4.id)).status === 'sending', 'late: waiting while nothing is on chain');
  await rpc.ctl({ land: true }); await sleep(150); await settle();
  check((await wStatus(p1, w4.id)).status === 'sent' && rpc.balance(p1.address) === w + 0.1 * SOL, 'late: found once it landed, paid exactly once');

  // ---- a lagging RPC node says a landed transfer doesn't exist, long after its blockhash expired: never re-signed
  w = rpc.balance(p1.address);
  await rpc.ctl({ hold: 1 });
  const w5 = await p1.c.api('/api/withdraw', { lamports: 0.1 * SOL });
  const sig5 = (await wStatus(p1, w5.id)).signature;
  await rpc.ctl({ land: true, lag: true }); // it lands, but the node answering status lookups is far behind
  await rpc.ctl({ advance: 400 });
  for (let i = 0; i < 4; i++) { await settle(); await sleep(350); }
  const w5s = await wStatus(p1, w5.id);
  check(w5.status === 'sending' && w5s.status === 'sending' && w5s.signature === sig5, 'lagging node: the transfer is not signed again: ' + [w5.status, w5s.status]);
  await rpc.ctl({ lag: false }); await settle();
  check((await wStatus(p1, w5.id)).status === 'sent' && rpc.balance(p1.address) === w + 0.1 * SOL, 'lagging node: paid exactly once');

  // ---- the hot wallet can't pay: queued, then sent once it's topped up
  const hot = rpc.balance(hotAddr);
  const rich = await player(30 * SOL);
  const big = await walletDeposit(rich, 12 * SOL); await rich.c.api('/api/deposit/confirm', { signature: big.signature });
  // move most of the hot wallet away so it can't pay (as if swept)
  const hotNow = rpc.balance(hotAddr);
  await A('/pause', { withdrawals: true });
  const wq = await rich.c.api('/api/withdraw', { lamports: 1.5 * SOL });
  check(wq.status === 'queued' && /paused/.test(wq.message), 'paused: the withdrawal is queued: ' + wq.message);
  await sleep(2100); await settle();
  check((await wStatus(rich, wq.id)).status === 'queued', 'paused: nothing goes out while paused');
  // sweep everything above what the hot wallet must keep (its target, or what's queued plus HOT_MIN) to cold
  const cold0 = rpc.balance(cold.publicKey.toBase58());
  const sw = await A('/sweep', {});
  await sleep(200); await A('/reconcile', {});
  const keep = Math.max(2 * SOL, 1.5 * SOL + 1 * SOL);
  check(sw.transfer && rpc.balance(cold.publicKey.toBase58()) > cold0 + 10 * SOL, 'sweep: the excess went to the cold wallet: ' + JSON.stringify(sw));
  check(Math.abs(rpc.balance(hotAddr) - keep) < 0.01 * SOL, `sweep: the hot wallet keeps what it needs (${rpc.balance(hotAddr) / SOL} SOL)`);
  check((await A('/sweep', {})).transfer === null, 'sweep: nothing more to sweep');
  const rw0 = rpc.balance(rich.address);
  await A('/pause', { withdrawals: false });
  await sleep(2100);
  const sentQ = await waitFor(async () => { await settle(); return (await wStatus(rich, wq.id)).status === 'sent'; }, 8000);
  check(sentQ && rpc.balance(rich.address) === rw0 + 1.5 * SOL, 'unpaused: the queued withdrawal went out once');
  // now ask for more than the hot wallet holds (but under the review size)
  const hotLeft = rpc.balance(hotAddr);
  const want = Math.min(1.9 * SOL, hotLeft + 0.5 * SOL);
  if (want > hotLeft) {
    const wl = await rich.c.api('/api/withdraw', { lamports: want });
    check(wl.status === 'queued', 'hot wallet short: queued: ' + wl.status);
    const me = await A('/overview');
    check(me.counts.w_queued >= 1, 'hot wallet short: the operator sees it queued');
    await transfer(cold, hotAddr, 2 * SOL);
    await sleep(200);
    const ok = await waitFor(async () => { await settle(); return (await wStatus(rich, wl.id)).status === 'sent'; }, 8000);
    check(ok, 'hot wallet topped up: the queued withdrawal goes out');
  } else check(false, `test setup: hot wallet ${hotLeft} too full to test a shortfall`);

  // ---- reviews: large withdrawals wait; approve sends, reject refunds
  const r0 = await bal(rich);
  const wr = await rich.c.api('/api/withdraw', { lamports: 2 * SOL });
  check(wr.status === 'review' && (await bal(rich)) === r0 - 2 * SOL, 'a large withdrawal waits for review (taken off the balance)');
  const rr = await A('/reviews');
  check(rr.withdrawals.some((x) => x.id === wr.id), 'it is in the review queue');
  const wrj = await rich.c.api('/api/withdraw', { lamports: 2 * SOL });
  const rej = await A(`/withdrawals/${wrj.id}/reject`, { note: 'test' });
  check(rej.ok && (await bal(rich)) === r0 - 2 * SOL, 'rejected: refunded to the balance');
  const rw1 = rpc.balance(rich.address);
  await transfer(cold, hotAddr, 2 * SOL); await sleep(150);
  const ap = await A(`/withdrawals/${wr.id}/approve`, {});
  check(ap.ok, 'approved');
  const apOk = await waitFor(async () => { await settle(); return (await wStatus(rich, wr.id)).status === 'sent'; });
  check(apOk && rpc.balance(rich.address) === rw1 + 2 * SOL, 'approved: sent once');
  check((await A(`/withdrawals/${wr.id}/approve`, {})).status === 400, 'approving twice is refused');

  // ---- the bankroll: max bets come from reserves (hot + cold) less everything owed
  const cfg = await p1.c.api('/api/config');
  const ov = await A('/overview');
  const free = ov.bankroll.free;
  check(ov.bankroll.reserves.cold.length === 1 && ov.bankroll.reserves.total === rpc.balance(hotAddr) + rpc.balance(cold.publicKey.toBase58()), 'reserves count the hot and cold wallets');
  check(free > 0 && ov.bankroll.owed.balances === (await bal(p1)) + (await bal(p2)) + (await bal(rich)) + (await sc.api('/api/me')).balance, 'owed is every player balance');
  const want1 = Math.min(10 * SOL, Math.floor(Math.floor(1 * free) / E.DIFFS[1].maxWin));
  check(Math.abs(cfg.difficulties[1].maxBet - want1) <= want1 * 0.02 + 1, `Hard's max bet follows the bankroll: ${cfg.difficulties[1].maxBet} vs ${want1}`);
  const over = await rich.c.api('/api/run/start', { difficulty: 1, lamports: cfg.difficulties[1].maxBet * 3 + 1000, clientSeed: 'toobig' });
  check(over.status === 400 && /Maximum bet/.test(over.error), 'a bet whose top win is too much for the bankroll is refused: ' + over.error);

  // ---- parallel withdrawals can't overdraw
  const par = await player();
  const dp = await walletDeposit(par, 1 * SOL); await par.c.api('/api/deposit/confirm', { signature: dp.signature });
  await transfer(cold, hotAddr, 1 * SOL); await sleep(150);
  const many = await Promise.all(Array.from({ length: 10 }, () => par.c.api('/api/withdraw', { lamports: 0.4 * SOL })));
  const okN = many.filter((x) => x.status === 'sent' || x.status === 'sending' || x.status === 'queued').length;
  check(okN === 2 && (await bal(par)) === 0.2 * SOL, `10 parallel withdrawals of 0.4 from 1 SOL: ${okN} went through`);

  // ---- daily per-player limit sends the rest to review
  // (a second server with the limit set, on the same chain)
  const srv2 = await bootServer({
    MOCK_CHAIN: '0', NETWORK: 'localnet', RPC_URL: rpc.url, HOUSE_SECRET: bs58.encode(house.secretKey), COLD_ADDRESS: cold.publicKey.toBase58(),
    ADMIN_TOKEN: ADMIN, WITHDRAW_DAY_USER_LAMPORTS: String(0.5 * SOL), WATCH_DEPOSITS: '0', WITHDRAW_WAIT_MS: '2000', HOT_MAX_LAMPORTS: String(100 * SOL), HOT_TARGET_LAMPORTS: String(50 * SOL)
  });
  const q = { c: apiClient(srv2.url), wallet: null };
  const kpq = nacl.sign.keyPair(); q.wallet = Keypair.fromSecretKey(kpq.secretKey); q.address = q.wallet.publicKey.toBase58();
  await rpc.ctl({ airdrop: { address: q.address, lamports: 5 * SOL } }); await q.c.signIn(kpq);
  const dq = await walletDeposit(q, 2 * SOL); await q.c.api('/api/deposit/confirm', { signature: dq.signature });
  const q1 = await q.c.api('/api/withdraw', { lamports: 0.4 * SOL });
  const q2 = await q.c.api('/api/withdraw', { lamports: 0.4 * SOL });
  check(q1.status === 'sent' && q2.status === 'review', 'daily limit: the first goes out, the second waits for review: ' + [q1.status, q2.status]);
  srv2.kill();

  // ---- the ledger matches every balance, and the books balance
  const lc = await A('/ledger-check');
  check(lc.ok, 'every balance equals the sum of its ledger: ' + JSON.stringify(lc.mismatches));
  const ov2 = await A('/overview');
  check(ov2.bankroll.free > 0 && ov2.bankroll.reserves.total >= ov2.bankroll.owed.total, 'solvent: reserves cover everything owed');

  // ---- signing out everywhere
  const tok = p1.c.token;
  await A(`/users/${p1.address}/revoke`, {});
  check((await p1.c.api('/api/me')).status === 401, 'a revoked token no longer works');
  p1.c.setToken(tok);

  rpc.close();
  await stopAll();
  console.log(failed() ? `${failed()} check(s) failed` : 'money flow: all checks passed');
  process.exitCode = failed() ? 1 : 0;
})().catch(async (e) => { console.error(e); await stopAll(); process.exitCode = 1; });
