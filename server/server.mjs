// SOL DUNK game server.
//
//   Wallet sign-in (an ed25519-signed sign-in message), SOL deposits to the house's hot wallet, withdrawals from it,
//   provably fair level seeds, and a server-side replay of every level before anything is paid.
//
//   npm start          NETWORK=devnet (the default); a local Postgres is started in data/ unless DATABASE_URL is set
//   npm run dev        MOCK_CHAIN=1: no Solana at all, /api/dev/faucet credits test SOL
//
// Every setting is in deploy/.env.example; the launch steps are in docs/LAUNCH.md and the threat model in
// server/SECURITY.md. Storage is Postgres (lib/db.mjs), money on chain is lib/payments.mjs, the operator API is
// lib/admin.mjs.
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { loadConfig, LAMPORTS } from './lib/config.mjs';
import { createLog } from './lib/log.mjs';
import { openDb, OPEN } from './lib/db.mjs';
import { RpcChain, MockChain, loadHouseKey, validAddress } from './lib/chain.mjs';
import { createPayments } from './lib/payments.mjs';
import { levelSignals, addSignals, botScore } from './lib/botcheck.mjs';
import { securityHeaders, pagePolicy, createLimiter, geoGate, originGuard, requestLog, safeEqual, countryOf } from './lib/http.mjs';
import { mountAdmin } from './lib/admin.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require('../src/engine.cjs');
const PAY = require('../src/paytable.cjs');
const POTS = require('../src/pots.cjs');
const MS = require('../src/missions.cjs');
const TR = require('../src/trophies.cjs');
const SP = require('../src/special.cjs');
const LV = require('../src/levels.cjs');

export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const hmacHex = (key, msg) => crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(msg).digest('hex');
const sha256Hex = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
// identical to the client: HMAC-SHA256(serverSeed, clientSeed:nonce:level)
const levelSeed = (run, L) => hmacHex(run.serverSeed, `${run.clientSeed}:${run.nonce}:${L}`);
export const solText = (l) => String(+(l / LAMPORTS).toFixed(6));
const utcDayStart = (ts = Date.now()) => { const d = new Date(ts); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };
const OVER = ['cashout', 'maxwin', 'final'];

export async function createServer(CFG, log) {
  // ---------------------------------------------------------------- storage
  let dbUrl = CFG.databaseUrl, devPg = null;
  if (!dbUrl) {
    const { startDevPostgres } = await import('./lib/devpg.mjs');
    devPg = await startDevPostgres(path.join(CFG.dataDir, `pg-${CFG.mock ? 'mock' : CFG.network}`));
    dbUrl = await devPg.createDb('soldunk');
    log.info('using a local Postgres (set DATABASE_URL for a real one)', { port: devPg.port });
  }
  const db = await openDb(dbUrl, log);
  const tx = db.tx;
  // closed beta: wallets named in ALLOWLIST are added to the list (the operator API adds and removes others)
  for (const a of CFG.allowlist) if (validAddress(a)) await db.pool.query(`insert into allowlist (address, note) values ($1, 'ALLOWLIST') on conflict do nothing`, [a]);

  // the sign-in token key: from TOKEN_SECRET, or made once and kept in the database (development)
  let TOKEN_SECRET = CFG.tokenSecret;
  if (!TOKEN_SECRET) {
    TOKEN_SECRET = await tx(async (t) => {
      let s = await t.setting('tokenSecret');
      if (!s) { s = crypto.randomBytes(32).toString('hex'); await t.putSetting('tokenSecret', s); }
      return s;
    });
  }
  // the day clock (pots, missions, specials) is real time; in development /api/dev/pot/advance moves it on a day
  let potClock = CFG.devEndpoints ? Number(await tx((t) => t.setting('potClock', 0))) || 0 : 0;
  const potNow = () => Date.now() + potClock;

  // ---------------------------------------------------------------- chain
  const house = loadHouseKey(CFG, log);
  const chain = CFG.mock ? new MockChain(CFG, house) : new RpcChain(CFG, house, log);

  // pause switches (the operator's kill switches), cached briefly
  let pauseCache = { at: 0, v: null };
  async function pauses() {
    if (Date.now() - pauseCache.at > 2000) pauseCache = { at: Date.now(), v: Object.assign({ play: false, deposits: false, withdrawals: false }, await tx((t) => t.setting('pause', {}))) };
    return pauseCache.v;
  }
  const isPaused = async (k) => !!(await pauses())[k];
  const payments = createPayments({ db, chain, CFG, log, isPaused });

  // ---------------------------------------------------------------- the bankroll
  // free = reserves (hot + cold) - everything owed. One bet's biggest possible win may use at most RISK_FRACTION of
  // it (and never more than MAX_PAYOUT); the cover check makes sure every open bet could be paid at once.
  let limitCache = { at: 0, v: null };
  async function bankroll({ fresh = false } = {}) {
    if (!fresh && limitCache.v && Date.now() - limitCache.at < 10_000) return limitCache.v;
    const [res, owed] = await Promise.all([chain.reserves(), tx((t) => t.owed())]);
    const v = { reserves: res, owed, free: res.total - owed.total };
    limitCache = { at: Date.now(), v };
    return v;
  }
  function maxBetFor(u, di, free) {
    const payoutCap = Math.min(CFG.maxPayout, Math.floor(CFG.riskFraction * Math.max(0, free)));
    let m = Math.min(CFG.maxBet, Math.floor(payoutCap / E.DIFFS[di].maxWin));
    if (u && u.flagged) m = Math.min(m, CFG.minBet * 10);
    return Math.max(0, m);
  }

  // ---------------------------------------------------------------- tokens
  function makeToken(u) {
    const body = `${u.address}.${Date.now() + CFG.tokenDays * 86400_000}.${u.tv || 0}`;
    return Buffer.from(`${body}.${hmacHex(TOKEN_SECRET, body)}`).toString('base64url');
  }
  function readToken(tok) {
    try {
      const parts = Buffer.from(tok, 'base64url').toString().split('.');
      if (parts.length !== 4) return null;
      const [address, exp, ver, sig] = parts;
      if (!address || !(+exp > Date.now())) return null;
      if (!safeEqual(sig, hmacHex(TOKEN_SECRET, `${address}.${exp}.${ver}`))) return null;
      return { address, ver: +ver };
    } catch { return null; }
  }
  // the signed-in player, inside a transaction (locked unless lock: false)
  async function auth(t, req, { lock = true } = {}) {
    const h = req.get('authorization') || '';
    const tk = h.startsWith('Bearer ') ? readToken(h.slice(7)) : null;
    if (!tk) throw new HttpError(401, 'Sign in with your wallet first');
    const u = await t.user(tk.address, { lock, create: false });
    if (!u || (u.tv || 0) !== tk.ver) throw new HttpError(401, 'Sign in with your wallet again');
    if (CFG.access === 'allowlist' && !(await t.allowed(u.address))) throw new HttpError(403, 'SOL DUNK is in a closed beta. This wallet isn’t on the list.');
    return u;
  }
  const maybeAuth = async (t, req) => { try { return await auth(t, req, { lock: false }); } catch { return null; } };
  // rakeback (rules in src/levels.cjs): every bet sets 20% of the house's cut of it aside, and a level up releases it
  // to claim. The level is the server's own: XP from the runs and missions it verifies.
  const rakeView = (u) => { const s = LV.fix(u.rb); return { accLamports: Math.floor(s.acc), readyLamports: s.ready, paidLamports: s.paid, level: LV.lvlOf(u.xp || 0).l }; };
  const rakeAdd = (u, kind, lamports) => { u.rb = LV.add(u.rb, kind, lamports); };
  function xpAdd(u, xp) {
    const before = LV.stepsOf(u.xp || 0);
    u.xp = (u.xp || 0) + Math.max(0, Math.floor(xp));
    if (LV.stepsOf(u.xp) > before) { u.rb = LV.fix(u.rb); LV.release(u.rb, true); }
  }
  const publicMe = (u) => ({ address: u.address, balance: u.balance, flagged: !!u.flagged, hold: !!u.hold, kyc: u.kyc || 'none', rakeback: rakeView(u) });

  // ---------------------------------------------------------------- app
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', CFG.trustProxy);
  app.use(originGuard(CFG));
  app.use(securityHeaders(CFG));
  app.use(requestLog(log));
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => { res.set('cache-control', 'no-store'); next(); });
  const limit = createLimiter(CFG);
  const who = (req) => { const h = req.get('authorization') || ''; return h.slice(-16) || req.ip; };
  app.use('/api', limit('ip', 600, 60_000));
  const geo = geoGate(CFG);
  const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((out) => { if (!res.headersSent) res.json(out); }).catch((e) => {
    const status = e.status || 500;
    if (status >= 500) log.error('request failed', { err: e, p: req.path });
    if (!res.headersSent) res.status(status).json({ error: status >= 500 ? 'Server error' : e.message });
  });
  const pausedPlay = async () => { if (await isPaused('play')) throw new HttpError(503, 'Play is paused for maintenance. Your balance is safe; try again soon.'); };

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/readyz', wrap(async (req, res) => {
    try { await db.pool.query('select 1'); await chain.health(); return { ok: true }; }
    catch (e) { res.status(503); return { ok: false, error: String(e.message) }; }
  }));

  app.get('/api/config', wrap(async () => {
    const b = await bankroll().catch(() => null);
    return {
      network: CFG.network, house: chain.address, mock: CFG.mock, access: CFG.access,
      minBet: CFG.minBet, maxBet: CFG.maxBet, maxPayout: CFG.maxPayout, minDeposit: CFG.minDeposit, minWithdraw: CFG.minWithdraw,
      difficulties: E.DIFFS.map((d, i) => ({ id: d.id, name: d.name, maxWin: d.maxWin, maxBet: b ? maxBetFor(null, i, b.free) : 0, index: i })),
      engine: E.VERSION, paytable: PAY.META
    };
  }));

  // ---------------------------------------------------------------- sign-in: sign a one-time message with the wallet
  app.post('/api/auth/nonce', limit('auth', 30, 60_000), wrap(async (req) => {
    const { address } = req.body || {};
    if (!validAddress(address)) throw bad('Invalid wallet address');
    return tx(async (t) => {
      if (CFG.access === 'allowlist' && !(await t.allowed(address))) throw new HttpError(403, 'SOL DUNK is in a closed beta. This wallet isn’t on the list.');
      const now = Date.now(), exp = now + 5 * 60_000;
      // Sign-In With Solana style, so wallets show which site is asking
      const message = `${CFG.domain} wants you to sign in with your Solana account:\n${address}\n\nSign in to SOL DUNK. This doesn't send a transaction or cost anything.\n\nURI: ${CFG.publicUrl || 'http://' + CFG.domain}\nVersion: 1\nChain ID: ${CFG.network}\nNonce: ${crypto.randomBytes(12).toString('hex')}\nIssued At: ${new Date(now).toISOString()}\nExpiration Time: ${new Date(exp).toISOString()}`;
      await t.putNonce(address, message, exp);
      return { message };
    });
  }));
  app.post('/api/auth/verify', limit('auth', 30, 60_000), wrap(async (req) => {
    const { address, signature } = req.body || {};
    if (!validAddress(address) || typeof signature !== 'string') throw bad('Invalid sign-in');
    return tx(async (t) => {
      const n = await t.takeNonce(address);
      if (!n || n.exp < Date.now()) throw bad('Sign-in expired. Try again.');
      let ok = false;
      try { ok = nacl.sign.detached.verify(Buffer.from(n.message, 'utf8'), bs58.decode(signature), new PublicKey(address).toBytes()); } catch { ok = false; }
      if (!ok) throw new HttpError(401, 'Signature check failed');
      if (CFG.access === 'allowlist' && !(await t.allowed(address))) throw new HttpError(403, 'SOL DUNK is in a closed beta. This wallet isn’t on the list.');
      const u = await t.user(address);
      return { token: makeToken(u), ...publicMe(u) };
    });
  }));
  app.get('/api/me', wrap(async (req) => tx(async (t) => {
    const u = await auth(t, req, { lock: false });
    return { ...publicMe(u), withdrawals: (await t.recentWithdrawals(u.address, 5)).map((w) => ({ id: w.id, lamports: w.lamports, status: w.status, signature: w.signature, at: w.created_at })) };
  })));

  // ---------------------------------------------------------------- deposits
  // the server builds the transfer, the wallet signs and sends it, and the server credits it once it sees it on chain
  app.post('/api/deposit/prepare', geo, limit('money', 20, 60_000, who), wrap(async (req) => {
    if (await isPaused('deposits')) throw new HttpError(503, 'Deposits are paused for maintenance. Try again soon.');
    const lamports = Math.floor(Number((req.body || {}).lamports));
    if (!(lamports >= CFG.minDeposit)) throw bad(`Minimum deposit is ${solText(CFG.minDeposit)} SOL`);
    if (!Number.isSafeInteger(lamports)) throw bad('Invalid amount');
    const u = await tx(async (t) => {
      const u = await auth(t, req, { lock: false });
      if (CFG.depositDayLimit) {
        const today = await t.depositedSince(u.address, utcDayStart());
        if (today + lamports > CFG.depositDayLimit) throw bad(`Deposits are limited to ${solText(CFG.depositDayLimit)} SOL a day${today ? ` (${solText(today)} so far today)` : ''}`);
      }
      return u;
    });
    return { message: await chain.depositMessage(u.address, lamports), house: chain.address };
  }));
  app.post('/api/deposit/confirm', limit('money', 20, 60_000, who), wrap(async (req, res) => {
    const signature = String((req.body || {}).signature || '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw bad('Invalid transaction signature');
    const u = await tx((t) => auth(t, req, { lock: false }));
    let tr = null;
    const end = Date.now() + CFG.depositWaitMs;
    for (;;) {
      tr = await chain.readTransfers(signature, CFG.depositCommitment);
      if (tr.found || Date.now() > end) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (!tr.found) { res.status(202); return { status: 'pending', message: 'Deposit seen. It will be credited as soon as the network finalizes it.' }; }
    if (tr.failed) throw bad('That transaction failed on chain, so nothing was sent');
    const r = (await payments.creditTransfers(signature, tr.transfers, tr.slot, 'client', u.address))[0];
    if (!r) throw bad('No transfer from your wallet to the house wallet in that transaction');
    const me = await tx(async (t) => publicMe(await t.user(u.address, { lock: false })));
    return { status: 'credited', credited: r.credited ? r.lamports : 0, message: r.credited ? 'Deposit credited' : 'That deposit is already credited', ...me };
  }));

  // ---------------------------------------------------------------- withdrawals
  // paid from the hot wallet to the player's own signed-in wallet (never anywhere else). Large ones, held or limited
  // accounts, and anything past the daily limits wait for a person to review them.
  const W_TEXT = {
    sent: 'Withdrawal sent', sending: 'Withdrawal on its way', review: 'Your withdrawal is waiting for a quick review. It usually takes less than a day.',
    queued: 'Withdrawal queued. It will be sent shortly.', paused: 'Withdrawals are paused for maintenance. Yours is queued and will be sent when they resume.'
  };
  app.post('/api/withdraw', limit('money', 20, 60_000, who), wrap(async (req) => {
    const lamports = Math.floor(Number((req.body || {}).lamports));
    if (!Number.isSafeInteger(lamports) || lamports <= 0) throw bad('Enter an amount to withdraw');
    if (lamports < CFG.minWithdraw) throw bad(`Minimum withdrawal is ${solText(CFG.minWithdraw)} SOL`);
    const w = await tx(async (t) => {
      const u = await auth(t, req);
      if (lamports > u.balance) throw bad('Amount is more than your balance');
      if (await t.openRun(u.address)) throw bad('Finish your current run first');
      if (CFG.kycWithdraw && u.kyc !== 'verified' && (await t.withdrawnTotal(u.address)) + lamports > CFG.kycWithdraw) {
        throw new HttpError(403, `Withdrawing more than ${solText(CFG.kycWithdraw)} SOL in total needs a verified identity. Contact support to verify.`);
      }
      const reasons = [];
      if (lamports >= CFG.withdrawReview) reasons.push('large withdrawal');
      if (u.flagged) reasons.push('limited account: ' + u.flagged.reason);
      if (u.hold) reasons.push('hold: ' + u.hold.reason);
      const day = utcDayStart();
      if (CFG.withdrawDayUser && (await t.autoWithdrawnSince(u.address, day)) + lamports > CFG.withdrawDayUser) reasons.push('over the daily limit');
      if (CFG.withdrawDayTotal && (await t.autoWithdrawnSince(null, day)) + lamports > CFG.withdrawDayTotal) {
        reasons.push('daily circuit breaker');
        t.afterCommit(() => log.alert('circuit-breaker', `Automatic withdrawals have reached today's limit of ${solText(CFG.withdrawDayTotal)} SOL. New ones wait for review.`));
      }
      const id = crypto.randomUUID(), status = reasons.length ? 'review' : 'queued';
      await t.credit(u, -lamports, 'withdraw', id);
      await t.insertWithdrawal({ id, address: u.address, lamports, status, auto: !reasons.length, reason: reasons.join('; ') || null });
      if (status === 'review') {
        await t.addReview('withdrawal', u.address, id, { lamports, reasons });
        t.afterCommit(() => log.alert('review-' + id, `Withdrawal of ${solText(lamports)} SOL by ${u.address} is waiting for review (${reasons.join('; ')}).`));
      }
      return { id, status, u: publicMe(u) };
    });
    let row = { status: w.status, signature: null };
    if (w.status === 'queued') {
      if (await isPaused('withdrawals')) row.status = 'paused';
      else row = await payments.kick(w.id).catch((e) => { log.warn('withdrawal: first send attempt failed; the queue will retry', { id: w.id, err: e }); return { status: 'queued' }; });
    }
    const me = await tx(async (t) => publicMe(await t.user(w.u.address, { lock: false })));
    return { id: w.id, status: row.status === 'paused' ? 'queued' : row.status, signature: row.signature || undefined, message: W_TEXT[row.status] || W_TEXT.queued, ...me };
  }));

  if (CFG.devEndpoints) {
    app.post('/api/dev/faucet', wrap(async (req) => tx(async (t) => {
      const u = await auth(t, req);
      const lamports = Math.floor(Number((req.body || {}).lamports || LAMPORTS));
      if (!(lamports > 0 && lamports <= 1000 * LAMPORTS)) throw bad('Invalid amount');
      await t.credit(u, lamports, 'faucet', null);
      return publicMe(u);
    })));
  }

  // ---------------------------------------------------------------- challenge pots (rules in src/pots.cjs)
  // One pot per UTC day. Players pay a fixed entry, then play ordinary runs; everyone who meets the day's challenge in
  // a run (started after entering, on the challenge's tier or harder) splits the pot when the day ends. The house
  // keeps POTS.RAKE of every entry whoever wins; with no winners the pot rolls into the next day's.
  const potFor = (t, day, lock = false) => t.pot(day, {
    lock, create: { day, goal: CFG.potGoal && POTS.GOAL_BY[CFG.potGoal] ? CFG.potGoal : POTS.goalFor(day).id, fee: CFG.potEntry, carryIn: 0, paidIn: 0, createdAt: Date.now() }
  });
  // close every pot whose day is over, oldest first, so a rollover can roll on through quiet days
  async function settlePots() {
    for (let guard = 0; guard < 400; guard++) {
      const did = await tx(async (t) => {
        const due = (await t.unsettledPots()).filter((p) => POTS.closesAt(p.day) <= potNow());
        if (!due.length) return false;
        const p = await t.pot(due[0].day, { lock: true });
        if (!p || p.settled) return true;
        const winners = (await t.potEntries(p.day)).filter((e) => e.done);
        const r = POTS.split(p.paidIn, p.carryIn, winners.length, true);
        for (const e of winners) {
          const u = await t.user(e.address);
          await t.credit(u, r.share, 'pot_win', p.day);
          u.potWon = (u.potWon || 0) + r.share;
          const { address, ...doc } = e;
          await t.putPotEntry(p.day, address, { ...doc, won: r.share });
        }
        Object.assign(p, { settled: true, settledAt: Date.now(), winners: winners.length, share: r.share, rake: r.rake, carryOut: r.carry });
        await t.putPot(p);
        await t.incSetting('houseRake', r.rake);
        if (r.carry) { const next = POTS.dayKey(POTS.closesAt(p.day)); await potFor(t, next); await t.addToPot(next, 'carryIn', r.carry); }
        return true;
      });
      if (!did) break;
    }
  }
  async function potView(t, p, u) {
    const g = POTS.GOAL_BY[p.goal], c = await t.potCounts(p.day);
    const out = {
      key: p.day, goal: { id: g.id, kind: g.kind, n: g.n, tier: g.tier, text: g.text, sub: POTS.tierText(g.tier) },
      feeLamports: p.fee, rake: POTS.RAKE, entrants: c.entrants, completed: c.completed,
      poolLamports: Math.floor(POTS.poolOf(p.paidIn, p.carryIn)), carryInLamports: p.carryIn,
      closesAt: POTS.closesAt(p.day) - potClock, simulated: false
    };
    if (u) { const e = await t.potEntry(p.day, u.address); out.me = e ? { entered: true, done: !!e.done, best: e.best || 0 } : { entered: false }; }
    return out;
  }
  async function lastPot(t, u) {
    const p = await t.lastSettledPot();
    if (!p) return null;
    const e = u ? await t.potEntry(p.day, u.address) : null, c = await t.potCounts(p.day);
    return { key: p.day, goal: POTS.GOAL_BY[p.goal].text, entrants: c.entrants, winners: p.winners, shareLamports: p.share, rolledLamports: p.winners ? 0 : p.carryOut, me: e ? { done: !!e.done, wonLamports: e.won || 0 } : null };
  }
  // a verified level may complete the player's challenge (only in a run started after they entered, on the tier or harder)
  async function potCheck(t, u, run) {
    const day = POTS.dayKey(potNow()), e = await t.potEntry(day, u.address);
    if (!e || !(run.potAt >= e.at)) return null;
    const p = await t.pot(day);
    const pr = POTS.progress(p.goal, verifiedLevels(run), run.di);
    if (!pr.counts) return { counts: false, done: !!e.done };
    if (pr.value > (e.best || 0)) e.best = pr.value;
    const just = !e.done && pr.done;
    if (just) { e.done = true; e.doneAt = potNow(); e.runId = run.id; }
    await t.putPotEntry(day, u.address, e);
    return { counts: true, done: !!e.done, just, value: pr.value, target: pr.target };
  }
  app.get('/api/pot', wrap(async (req) => {
    await settlePots();
    return tx(async (t) => {
      const u = await maybeAuth(t, req), p = await potFor(t, POTS.dayKey(potNow()));
      return { ...(await potView(t, p, u)), last: await lastPot(t, u) };
    });
  }));
  app.post('/api/pot/enter', geo, wrap(async (req) => {
    await pausedPlay();
    await settlePots();
    return tx(async (t) => {
      const u = await auth(t, req);
      const day = POTS.dayKey(potNow()), p = await potFor(t, day);
      if (await t.potEntry(day, u.address)) throw bad('You’re already in today’s pot');
      if (POTS.closesAt(p.day) - potNow() < 60_000) throw bad('This pot is about to close. The next one opens at midnight UTC.');
      if (u.balance < p.fee) throw bad('Not enough balance for the entry');
      await t.credit(u, -p.fee, 'pot_entry', day);
      rakeAdd(u, 'pot', p.fee);
      await t.addToPot(day, 'paidIn', p.fee);
      await t.putPotEntry(day, u.address, { at: potNow(), done: false, best: 0 });
      const p2 = await t.pot(day);
      return { ...(await potView(t, p2, u)), last: await lastPot(t, u), ...publicMe(u) };
    });
  }));
  if (CFG.devEndpoints) {
    // tests: move the day clock on a day, closing today's pot
    app.post('/api/dev/pot/advance', wrap(async () => {
      potClock += POTS.DAY_MS;
      await tx((t) => t.putSetting('potClock', potClock));
      await settlePots();
      return { ok: true, houseRake: Number(await tx((t) => t.setting('houseRake', 0))) };
    }));
  }

  // ---------------------------------------------------------------- missions (rules in src/missions.cjs)
  // Missions come in rounds of three, three rounds a UTC day and three a week; finishing a round opens the next. Every
  // run counts toward them whatever the bet; each pays SOL once the player has played its round's need in the window
  // (run bets and special entries), so the rewards stay inside the house's edge.
  async function missionPay(t, u, paid) {
    let sum = 0;
    const out = paid.map((p) => { const lamports = Math.floor(p.amount); sum += lamports; return { win: p.win, slot: p.slot, round: p.round, k: p.k, n: p.n, lamports }; });
    if (sum) {
      await t.credit(u, sum, 'mission', null);
      u.returned += sum; u.missionPaid = (u.missionPaid || 0) + sum; // counts in the player's return
      await t.incSetting('missionPaid', sum);
    }
    return out;
  }
  function missionView(u) {
    u.ms = MS.roll(u.ms, potNow());
    const v = MS.view(u.ms, potNow(), CFG.missionNeed), fix = (l) => l.map((m) => ({ k: m.k, n: m.n, xp: m.xp, sum: m.sum, slot: m.slot, round: m.round, p: m.p, done: m.done, paid: m.paid, rewardLamports: Math.floor(m.reward), needLamports: m.need }));
    // daily / weekly: the open round's three; all: every mission of the rounds opened so far; needLamports: what the
    // open round's SOL waits for (baseNeedLamports is round 1's)
    return {
      day: v.day, week: v.week, dayEnds: v.dayEnds - potClock, weekEnds: v.weekEnds - potClock, rounds: v.rounds, round: v.round, days: v.days,
      needLamports: v.need, baseNeedLamports: v.base, playedLamports: v.played, daily: fix(v.daily), weekly: fix(v.weekly), all: { day: fix(v.all.day), week: fix(v.all.week) }
    };
  }
  // a bet or a special entry counts toward both windows' play; it may unlock rewards already earned
  async function missionPlay(t, u, lamports) { const r = MS.play(u.ms, lamports, potNow(), CFG.missionNeed); u.ms = r.s; return missionPay(t, u, r.paid); }
  // the rings of a run that counted, level by level (a max win ends the run at the capped ring, which isn't a clear)
  const verifiedLevels = (run) => run.levels.map((l) => {
    const n = l.counted == null ? l.outcomes.length : l.counted;
    return { outcomes: l.outcomes.slice(0, n), clear: l.result === 'clear' && !l.capped, mov: l.mov || '', tilt: l.tilt || '' };
  });
  app.get('/api/missions', wrap(async (req) => tx(async (t) => missionView(await auth(t, req)))));
  // claim the rakeback a level up has released
  app.post('/api/rakeback/claim', limit('claims', 30, 60_000, who), wrap(async (req) => tx(async (t) => {
    const u = await auth(t, req);
    u.rb = LV.fix(u.rb);
    const lamports = LV.claim(u.rb);
    if (lamports > 0) {
      await t.credit(u, lamports, 'rakeback', null);
      u.returned += lamports; // counts in the player's return
      await t.incSetting('rakebackPaid', lamports);
    }
    return { claimedLamports: lamports, ...publicMe(u) };
  })));

  // ---------------------------------------------------------------- trophies (rules in src/trophies.cjs)
  // Fifteen one-time goals, judged from the levels the server verified in regular runs (settle). Each pays a little
  // SOL that the player claims. Claims never pass TR.RATE (0.2%) of everything the player has bet (u.wagered: run bets
  // and special entries), so trophy SOL stays inside the house's edge and a fresh account can't farm the easy ones.
  const TR_UNIT = Math.round(TR.UNIT * 1e9); // lamports per XP of a trophy
  function trophyView(u) {
    const v = TR.view(u.tro, u.wagered, TR_UNIT);
    return { rate: v.rate, playedLamports: v.played, claimedLamports: v.claimed, open: v.open,
      list: v.list.map((x) => ({ id: x.id, xp: x.xp, rewardLamports: x.reward, earned: x.earned, claimedLamports: x.claimed, can: x.can, moreLamports: Math.ceil(x.more) })) };
  }
  app.get('/api/trophies', wrap(async (req) => tx(async (t) => ({ trophies: trophyView(await auth(t, req)) }))));
  app.post('/api/trophies/claim', limit('runs', 240, 60_000, who), wrap(async (req) => tx(async (t) => {
    const u = await auth(t, req);
    const id = String((req.body || {}).id || '');
    const r = TR.claim(u.tro, id, u.wagered, TR_UNIT);
    u.tro = r.s;
    if (r.error === 'unknown') throw new HttpError(404, 'Trophy not found');
    if (r.error === 'locked') throw bad('Earn this trophy first');
    if (r.error === 'claimed') throw bad('Already claimed');
    if (r.error) throw bad('Bet ' + Math.ceil(r.more / 1e7) / 100 + ' SOL more to claim this');
    await t.credit(u, r.amount, 'trophy', id);
    u.returned += r.amount; u.trophyPaid = (u.trophyPaid || 0) + r.amount; // counts in the player's return
    await t.incSetting('trophyPaid', r.amount);
    await review(t, u);
    return { id, lamports: r.amount, trophies: trophyView(u), ...publicMe(u) };
  })));

  // ---------------------------------------------------------------- reviews: limits, holds, big wins, bots
  async function review(t, u) {
    // limit accounts that keep beating the house (skilled players and bots)
    let why = null;
    if (!u.flagged && u.runs >= CFG.sharpMinRuns && u.wagered > 0 && u.returned / u.wagered > CFG.sharpRtp) why = 'high return';
    if (!u.flagged && u.hoops >= 120 && u.swishes / u.hoops > 0.97) why = 'superhuman swish rate';
    if (why) {
      u.flagged = { reason: why, at: Date.now() };
      await t.addReview('flag', u.address, null, { reason: why, wagered: u.wagered, returned: u.returned, runs: u.runs });
      t.afterCommit(() => log.alert('flag-' + u.address, `Account ${u.address} was limited: ${why}.`));
    }
  }
  async function hold(t, u, reason, details) {
    if (u.hold) return;
    u.hold = { reason, at: Date.now() };
    await t.addReview('hold', u.address, details.ref || null, { reason, ...details });
    t.afterCommit(() => log.alert('hold-' + u.address + reason, `Withdrawals by ${u.address} are held for review: ${reason} (${JSON.stringify(details)}).`));
  }
  async function bigWin(t, u, run, payout) {
    if (payout >= CFG.bigWin || (run.total >= CFG.bigWinX && payout >= CFG.bigWinXMin)) {
      await hold(t, u, 'big win', { ref: run.id, payoutLamports: payout, total: run.total, bet: run.bet });
    }
  }
  async function botCheck(t, u, def, taps, ref) {
    u.bot = addSignals(u.bot, levelSignals(def, taps));
    const b = botScore(u.bot);
    if (b.score != null && b.score >= CFG.botReview) await hold(t, u, 'tap precision', { ref, ...b });
  }

  // ---------------------------------------------------------------- runs
  async function getRun(t, u, runId) {
    const r = await t.run(String(runId || ''));
    if (!r || r.address !== u.address || r.kind === 'special') throw new HttpError(404, 'Run not found');
    return r;
  }
  async function settle(t, u, run, status) {
    run.status = status; run.endedAt = Date.now(); run.exposure = 0;
    let payout = 0;
    if (OVER.includes(status)) { payout = Math.floor(run.bet * run.total); await t.credit(u, payout, 'payout', run.id); }
    run.payout = payout;
    u.returned += payout; u.runs++;
    // missions move on from the levels the server verified (a voided run doesn't count)
    if (run.kind !== 'special' && status !== 'void') {
      const r = MS.run(u.ms, verifiedLevels(run), potNow(), CFG.missionNeed);
      u.ms = r.s; run.missions = { done: r.done, opened: r.opened, paid: await missionPay(t, u, r.paid) };
      xpAdd(u, LV.runXp(r.facts) + r.done.reduce((a, d) => a + d.xp, 0)); // the XP the server can vouch for; a level up releases rakeback
      // trophies are earned from the same verified levels; their SOL is claimed separately (/api/trophies/claim)
      const tr = TR.run(u.tro, verifiedLevels(run), { paid: payout > 0, total: run.total, hard: run.di === E.DIFFS.length - 1, nl: E.LEVELS }, Date.now());
      u.tro = tr.s; run.trophies = tr.earned;
    }
    await review(t, u);
    if (payout) await bigWin(t, u, run, payout);
    return payout;
  }
  // what a player has bet in regular runs (special entries aside); the specials open at CFG.specialUnlock
  async function runPlayed(t, u) {
    if (u.runPlayed == null) u.runPlayed = await t.runBets(u.address);
    return u.runPlayed;
  }

  app.post('/api/run/start', geo, limit('runs', 120, 60_000, who), wrap(async (req) => {
    const { difficulty, lamports, clientSeed } = req.body || {};
    const di = Number(difficulty), bet = Math.floor(Number(lamports));
    if (!(di >= 0 && di < E.DIFFS.length && di === Math.floor(di))) throw bad('Unknown difficulty');
    if (typeof clientSeed !== 'string' || !/^[0-9a-zA-Z]{4,64}$/.test(clientSeed)) throw bad('Invalid client seed');
    if (!Number.isSafeInteger(bet) || !(bet >= CFG.minBet)) throw bad(`Minimum bet is ${solText(CFG.minBet)} SOL`);
    await pausedPlay();
    const reserves = await chain.reserves();
    const out = await tx(async (t) => {
      const u = await auth(t, req);
      if (await t.openRun(u.address)) throw bad('You already have a run in progress');
      if (bet > u.balance) throw bad('Not enough balance for that bet');
      await t.bankrollLock(); // one bet at a time from here: the cover check sees every other open bet
      const owed = await t.owed(), free = reserves.total - owed.total;
      const max = maxBetFor(u, di, free);
      if (bet > max) throw bad(max >= CFG.minBet ? `Maximum bet on ${E.DIFFS[di].name} is ${solText(max)} SOL right now` : 'The house can’t take bets right now. Try again later.');
      const exposure = bet * E.DIFFS[di].maxWin;
      if (free - exposure + bet < 0) throw bad('The house can’t cover a bet that size right now. Try a smaller bet.');
      await t.credit(u, -bet, 'bet', null);
      u.wagered += bet; u.runPlayed = (await runPlayed(t, u)) + bet;
      rakeAdd(u, 'run', bet);
      const paid = await missionPlay(t, u, bet);
      const run = {
        id: crypto.randomUUID(), address: u.address, kind: 'run', di, bet, exposure,
        serverSeed: crypto.randomBytes(32).toString('hex'), clientSeed, nonce: u.nonce++,
        level: 1, total: 1, streak: 0, status: 'playing', levels: [],
        createdAt: Date.now(), potAt: potNow(), levelStartedAt: Date.now(), updatedAt: Date.now()
      };
      await t.insertRun(run);
      return { runId: run.id, serverSeedHash: sha256Hex(run.serverSeed), nonce: run.nonce, level: 1, levelSeed: levelSeed(run, 1), missions: { paid, view: missionView(u) }, ...publicMe(u) };
    });
    limitCache.at = 0;
    return out;
  }));

  app.post('/api/run/level', limit('runs', 240, 60_000, who), wrap(async (req) => {
    const { runId, level, taps } = req.body || {};
    return tx(async (t) => {
      const u = await auth(t, req);
      const run = await getRun(t, u, runId);
      if (run.status !== 'playing') throw bad('This run is not waiting for a level');
      if (Number(level) !== run.level) throw bad('Wrong level');
      if (!E.validTaps(taps)) throw bad('Invalid tap data');
      const def = E.generateLevel(levelSeed(run, run.level), run.di, run.level);
      const r = E.replay(def, taps);
      // a real player can't finish a level faster than the game runs
      const gameMs = r.ticks * E.DT * 1000, elapsed = Date.now() - run.levelStartedAt;
      if (elapsed < gameMs * CFG.minRealtime - 250) {
        run.flag = 'too fast'; await settle(t, u, run, 'void');
        await t.addReview('void', u.address, run.id, { gameMs, elapsed });
        // the void and its review are committed; the player gets the refusal
        t.afterCommit(() => log.warn('run voided: submitted faster than real time', { address: u.address, run: run.id }));
        return { __refuse: 'Level submitted faster than real time. The run was voided.' };
      }
      const pt = PAY.PAYTABLE[run.di][run.level - 1];
      const a = E.applyLevel(pt, r.outcomes, run.total, E.DIFFS[run.di].maxWin, run.streak);
      const counted = a.capped ? a.capIndex + 1 : r.outcomes.length;
      u.hoops += counted; u.swishes += r.outcomes.slice(0, counted).filter((o) => o === 'S').length;
      run.total = a.total; run.streak = a.streak; run.updatedAt = Date.now();
      run.levels.push({ level: run.level, taps: taps.length, outcomes: r.outcomes.join(''), result: r.result, ticks: r.ticks, counted, capped: a.capped,
        mov: r.outcomes.slice(0, counted).map((o, k) => (def.hoops[k].amp ? '1' : '0')).join(''),
        tilt: r.outcomes.slice(0, counted).map((o, k) => (def.hoops[k].tilt ? '1' : '0')).join('') });
      // the special levels' skill rating learns from every verified level (src/special.cjs)
      u.skill = SP.addLevel(u.skill, run.di, run.level, counted, !a.capped && r.result !== 'clear');
      await botCheck(t, u, def, taps, run.id);
      let status;
      if (a.capped) status = 'maxwin';
      else if (r.result !== 'clear') status = 'bust';
      else if (run.level >= E.LEVELS) status = 'final';
      else status = 'checkpoint';
      const pot = await potCheck(t, u, run);
      let payout = 0;
      if (status === 'checkpoint') run.status = 'checkpoint';
      else payout = await settle(t, u, run, status);
      return {
        status, total: run.total, outcomes: r.outcomes.slice(0, counted), streak: run.streak, pot,
        potLamports: Math.floor(run.bet * run.total), payoutLamports: payout,
        missions: run.missions ? { ...run.missions, view: missionView(u) } : undefined,
        trophies: status === 'checkpoint' ? undefined : trophyView(u),
        serverSeed: status === 'checkpoint' ? undefined : run.serverSeed, ...publicMe(u)
      };
    }).then((out) => { if (out.__refuse) throw bad(out.__refuse); return out; });
  }));

  app.post('/api/run/continue', limit('runs', 240, 60_000, who), wrap(async (req) => tx(async (t) => {
    const u = await auth(t, req);
    const run = await getRun(t, u, (req.body || {}).runId);
    if (run.status !== 'checkpoint') throw bad('Nothing to continue');
    run.level++; run.status = 'playing'; run.levelStartedAt = Date.now(); run.updatedAt = Date.now();
    return { level: run.level, levelSeed: levelSeed(run, run.level) };
  })));

  app.post('/api/run/cashout', limit('runs', 240, 60_000, who), wrap(async (req) => tx(async (t) => {
    const u = await auth(t, req);
    const run = await getRun(t, u, (req.body || {}).runId);
    if (run.status !== 'checkpoint') throw bad('You can only cash out at a checkpoint');
    const payout = await settle(t, u, run, 'cashout');
    return { payoutLamports: payout, total: run.total, serverSeed: run.serverSeed, missions: { ...run.missions, view: missionView(u) }, trophies: trophyView(u), ...publicMe(u) };
  })));

  // ---------------------------------------------------------------- special levels (rules in src/special.cjs)
  // Three a UTC day, prizes 2x, 3x and 5x a fixed entry. Every course is set for the player's level in that special,
  // which moves like a weighted staircase (up after a clear, down after a miss) and settles where they clear it often
  // enough to get back 90%: the house expects 10% from everyone. Each attempt gets a fresh course from its own provably
  // fair seed, HMAC-SHA256(serverSeed, clientSeed:nonce:special). Accounts limited for beating the house can't enter.
  // Each prize has SP.PER_SLOT specials a day, in an order that's the same for everyone: a player is on the one after
  // those they've cleared today (their wins), and once they've cleared them all that prize is done until tomorrow.
  function specialsToday(u) {
    const day = SP.dayKey(potNow()), fee = CFG.specialEntry, forced = CFG.specialRecipe && SP.BY[CFG.specialRecipe];
    const wins = u && u.special && u.special.day === day && Array.isArray(u.special.wins) ? u.special.wins : null;
    return {
      day, fee,
      list: SP.specialsFor(day, wins).map(({ slot, x, recipe, at, of, done, next }) => {
        const R = forced || recipe, d = SP.levelOf(u && u.skill, slot), c = SP.courseFor(d, R.id, x);
        return { slot, x, recipe: R, g: c.g, n: c.n, chance: c.chance, level: Math.round(d * 100) / 100, prize: Math.floor(fee * x), at, of, done, next: done ? null : forced && next ? forced : next };
      })
    };
  }
  const unlockText = () => `Bet ${solText(CFG.specialUnlock)} SOL in regular runs to unlock the special levels`;
  async function specialView(t, u) {
    const { day, fee, list } = specialsToday(u);
    const tl = u && u.special && u.special.day === day ? u.special : null;
    const out = {
      day, feeLamports: fee, closesAt: SP.closesAt(day) - potClock, target: SP.TARGET, unlockLamports: CFG.specialUnlock,
      specials: list.map((s) => ({
        slot: s.slot, x: s.x, prizeLamports: s.prize, recipe: { id: s.recipe.id, name: s.recipe.name, blurb: s.recipe.blurb },
        at: s.at, of: s.of, done: s.done, next: s.next ? { id: s.next.id, name: s.next.name } : null,
        course: { grade: s.g, rings: s.n, chance: s.chance, level: s.level, levelName: SP.levelName(s.level) }, me: tl ? { tries: tl.tries[s.slot] || 0, wins: tl.wins[s.slot] || 0 } : { tries: 0, wins: 0 }
      }))
    };
    if (u) { const played = await runPlayed(t, u); out.me = { blocked: !!u.flagged, skill: SP.rating(u.skill), playedLamports: played, locked: played < CFG.specialUnlock }; }
    return out;
  }
  app.get('/api/special', wrap(async (req) => tx(async (t) => specialView(t, await maybeAuth(t, req)))));
  app.post('/api/special/start', geo, limit('runs', 120, 60_000, who), wrap(async (req) => {
    const { clientSeed, slot } = req.body || {};
    if (typeof clientSeed !== 'string' || !/^[0-9a-zA-Z]{4,64}$/.test(clientSeed)) throw bad('Invalid client seed');
    if (!(slot >= 0 && slot < SP.SLOTS.length && slot === Math.floor(slot))) throw bad('Unknown special level');
    await pausedPlay();
    const reserves = await chain.reserves();
    const out = await tx(async (t) => {
      const u = await auth(t, req);
      if (await t.openRun(u.address)) throw bad('Finish your current run first');
      if (u.flagged) throw bad('The special levels aren’t available on this account');
      if ((await runPlayed(t, u)) < CFG.specialUnlock) throw bad(unlockText());
      const { day, fee, list } = specialsToday(u), s = list[slot];
      if (s.done) throw bad(`You’ve cleared all ${s.of} of today’s ${s.x}× specials. New ones come at midnight UTC.`);
      if (u.balance < fee) throw bad('Not enough balance for the entry');
      await t.bankrollLock();
      const owed = await t.owed();
      if (reserves.total - owed.total - s.prize + fee < 0) throw bad('The house can’t cover the prize right now. Try again later.');
      await t.credit(u, -fee, 'special_entry', null);
      u.wagered += fee;
      rakeAdd(u, 'special', fee);
      const paid = await missionPlay(t, u, fee);
      if (!u.special || u.special.day !== day || !Array.isArray(u.special.tries)) u.special = { day, tries: [0, 0, 0], wins: [0, 0, 0] };
      if (CFG.specialDayTries && u.special.tries[slot] >= CFG.specialDayTries) throw bad(`That special is limited to ${CFG.specialDayTries} attempts a day. It's back tomorrow.`);
      u.special.tries[slot]++;
      const run = {
        id: crypto.randomUUID(), address: u.address, kind: 'special', slot, recipe: s.recipe.id, grade: s.g, rings: s.n, chance: s.chance,
        day, di: SP.GRADES[s.g][0], bet: fee, prize: s.prize, exposure: s.prize,
        serverSeed: crypto.randomBytes(32).toString('hex'), clientSeed, nonce: u.nonce++,
        level: 1, total: 1, status: 'playing', levels: [], createdAt: Date.now(), levelStartedAt: Date.now(), updatedAt: Date.now()
      };
      await t.insertRun(run);
      return {
        runId: run.id, serverSeedHash: sha256Hex(run.serverSeed), nonce: run.nonce, seed: levelSeed(run, 'special'),
        slot, recipe: s.recipe.id, grade: s.g, rings: s.n, chance: s.chance, feeLamports: fee, prizeLamports: s.prize,
        missions: { paid, view: missionView(u) }, special: await specialView(t, u), ...publicMe(u)
      };
    });
    limitCache.at = 0;
    return out;
  }));
  app.post('/api/special/finish', limit('runs', 120, 60_000, who), wrap(async (req) => {
    const { runId, taps } = req.body || {};
    return tx(async (t) => {
      const u = await auth(t, req);
      const run = await t.run(String(runId || ''));
      if (!run || run.address !== u.address || run.kind !== 'special') throw new HttpError(404, 'Run not found');
      if (run.status !== 'playing') throw bad('This attempt is already over');
      const def = SP.generate(levelSeed(run, 'special'), run.recipe, run.grade, run.rings);
      if (!E.validTaps(taps, def.maxTicks)) throw bad('Invalid tap data');
      const r = E.replay(def, taps);
      const gameMs = r.ticks * E.DT * 1000, elapsed = Date.now() - run.levelStartedAt;
      if (elapsed < gameMs * CFG.minRealtime - 250) {
        run.flag = 'too fast'; await settle(t, u, run, 'void');
        await t.addReview('void', u.address, run.id, { gameMs, elapsed });
        return { __refuse: 'Level submitted faster than real time. The attempt was voided.' };
      }
      const won = r.result === 'clear';
      u.hoops += r.outcomes.length; u.swishes += r.outcomes.filter((o) => o === 'S').length;
      u.skill = SP.addSpecial(u.skill, run.slot, won, r.outcomes.length); // that special's level moves: up after a clear, down after a miss
      await botCheck(t, u, def, taps, run.id);
      run.levels.push({ level: 1, taps: taps.length, outcomes: r.outcomes.join(''), result: r.result, ticks: r.ticks });
      run.total = won ? run.prize / run.bet : 0;
      const status = won ? 'won' : 'lost';
      run.status = status; run.endedAt = Date.now(); run.exposure = 0;
      const payout = won ? run.prize : 0;
      run.payout = payout;
      if (payout) { await t.credit(u, payout, 'special_prize', run.id); }
      u.returned += payout; u.runs++;
      if (won && u.special && u.special.day === run.day && Array.isArray(u.special.wins)) u.special.wins[run.slot]++;
      xpAdd(u, LV.specialXp(MS.facts([{ outcomes: r.outcomes.join(''), clear: false }]).points, won));
      await review(t, u);
      if (payout) await bigWin(t, u, run, payout);
      return { status, outcomes: r.outcomes, result: r.result, payoutLamports: payout, serverSeed: run.serverSeed, special: await specialView(t, u), ...publicMe(u) };
    }).then((out) => { if (out.__refuse) throw bad(out.__refuse); return out; });
  }));

  // provably fair: anyone can check a finished run
  app.get('/api/run/:id', wrap(async (req) => tx(async (t) => {
    const run = await t.run(req.params.id, { lock: false });
    if (!run) throw new HttpError(404, 'Run not found');
    const done = !OPEN.includes(run.status);
    return {
      id: run.id, kind: run.kind || 'run', recipe: run.recipe, grade: run.grade, rings: run.rings, difficulty: run.di, betLamports: run.bet, status: run.status, total: run.total, payoutLamports: run.payout || 0,
      serverSeedHash: sha256Hex(run.serverSeed), serverSeed: done ? run.serverSeed : undefined, clientSeed: run.clientSeed, nonce: run.nonce, levels: run.levels
    };
  })));

  // the operator's API (review queue, approvals, pauses, the allowlist, solvency)
  mountAdmin(app, { db, tx, chain, payments, CFG, log, wrap, HttpError, bankroll, settlePots, resetPauses: () => { pauseCache.at = 0; }, publicMe });

  // abandoned runs: a waiting checkpoint is cashed out for the player; an abandoned level is lost
  async function sweepRuns() {
    const now = Date.now();
    const r = await db.pool.query(`select id, address from runs where (status = 'checkpoint' and (doc->>'updatedAt')::bigint < $1) or (status = 'playing' and (doc->>'levelStartedAt')::bigint < $2) limit 200`,
      [now - CFG.checkpointTimeoutMs, now - CFG.playingTimeoutMs]);
    for (const row of r.rows) {
      await tx(async (t) => {
        const u = await t.user(row.address), run = await t.run(row.id);
        if (!run) return;
        if (run.status === 'checkpoint' && Date.now() - run.updatedAt > CFG.checkpointTimeoutMs) await settle(t, u, run, 'cashout');
        else if (run.status === 'playing' && Date.now() - run.levelStartedAt > CFG.playingTimeoutMs) await settle(t, u, run, 'abandoned');
      }).catch((e) => log.error('abandoned run sweep failed', { err: e, run: row.id }));
    }
  }

  // the game itself (built with: SERVER_URL=/ node build.cjs)
  const pageFile = path.join(__dirname, '..', 'dist', 'index.server.html');
  // the page's config names this server's network and limits, whatever the build said (then the script hashes)
  const html = fs.existsSync(pageFile) ? fs.readFileSync(pageFile, 'utf8').replace(/window\.SOL_DUNK_CONFIG = (\{[^\n<]*\});/, (m, j) => {
    const c = JSON.parse(j);
    Object.assign(c, { serverUrl: '/', network: CFG.network, minBet: CFG.minBet / LAMPORTS, maxBet: CFG.maxBet / LAMPORTS });
    return 'window.SOL_DUNK_CONFIG = ' + JSON.stringify(c) + ';';
  }) : null;
  const policy = html ? pagePolicy(html) : null;
  app.get('/', (req, res) => {
    if (!html) return res.status(404).send('Build the game first: SERVER_URL=/ node build.cjs');
    const c = countryOf(CFG, req);
    if ((c && CFG.blockedCountries.includes(c)) || (!c && CFG.geoRequired)) return res.status(451).type('text/plain').send('SOL DUNK isn’t available where you are.');
    if (CFG.csp === 'on') res.set('content-security-policy', policy);
    else if (CFG.csp === 'report-only') res.set('content-security-policy-report-only', policy);
    res.set('cache-control', 'no-cache').type('html').send(html);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  // malformed JSON and other errors from the parsers
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log.error('unhandled', { err, p: req.path });
    res.status(status).json({ error: status >= 500 ? 'Server error' : 'Bad request' });
  });

  // ---------------------------------------------------------------- background work
  const timers = [];
  const every = (ms, name, fn) => {
    let busy = false;
    const h = setInterval(async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { log.error(name + ' failed', { err: e }); } finally { busy = false; } }, ms);
    h.unref(); timers.push(h);
  };
  function startBackground() {
    every(15_000, 'run sweep', sweepRuns);
    every(60_000, 'pot settlement', settlePots);
    payments.start();
  }
  async function close() {
    timers.splice(0).forEach(clearInterval);
    payments.stop();
    await db.close();
    if (devPg) await devPg.stop();
  }
  return { app, db, chain, payments, close, startBackground, settlePots, sweepRuns };
}

// ---------------------------------------------------------------- start
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { CFG, errors, warnings } = loadConfig();
  const log = createLog(CFG);
  for (const w of warnings) log.warn('config: ' + w);
  if (errors.length) { for (const e of errors) log.error('config: ' + e); log.error('refusing to start: fix the settings above'); process.exit(1); }
  await log.initSentry();
  const s = await createServer(CFG, log);
  s.startBackground();
  const srv = s.app.listen(CFG.port, () => {
    log.info(`SOL DUNK server on :${CFG.port}`, { network: CFG.mock ? 'mock' : CFG.network, rpc: CFG.mock ? null : new URL(CFG.rpc).host, house: s.chain.address, cold: CFG.coldAddress || null, access: CFG.access });
  });
  let closing = false;
  const shutdown = (sig) => {
    if (closing) return;
    closing = true;
    log.info('shutting down', { sig });
    srv.close(async () => { await s.close().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (e) => log.error('unhandled rejection', { err: e }));
}
