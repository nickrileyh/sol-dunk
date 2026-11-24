// SOL DUNK game server.
//
//   Wallet sign-in (ed25519 message signature), SOL deposits to the house wallet, withdrawals,
//   provably-fair level seeds, and server-side replay of every level before any payout.
//
//   npm start                      devnet, needs HOUSE_SECRET funded with devnet SOL
//   npm run dev                    MOCK_CHAIN=1: no RPC calls, /api/dev/faucet credits test SOL
//
// Environment
//   PORT=8787  NETWORK=devnet  RPC_URL=https://api.devnet.solana.com
//   HOUSE_SECRET=<base58 secret key or JSON byte array>   (dev: generated into data/house.json)
//   TOKEN_SECRET=<random string>   DB_FILE=data/db.json
//   MIN_BET_LAMPORTS=1000000  MAX_BET_LAMPORTS=1000000000  MAX_PAYOUT_LAMPORTS=50000000000
//   MIN_REALTIME=0.9   (a level can't be submitted faster than 90% of its game time)
//   SHARP_RTP=1.15  SHARP_MIN_RUNS=150   (players above this return get limited bets and no special level)
//   POT_ENTRY_LAMPORTS=50000000  SPECIAL_ENTRY_LAMPORTS=50000000
//   MISSION_DAY_LAMPORTS=2000000000  MISSION_WEEK_LAMPORTS=10000000000  (play before a window's mission SOL pays)
//   WITHDRAW_REVIEW_LAMPORTS=20000000000 (larger withdrawals wait for manual review)
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require('../src/engine.cjs');
const PAY = require('../src/paytable.cjs');
const POTS = require('../src/pots.cjs');
const MS = require('../src/missions.cjs');
const SP = require('../src/special.cjs');

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const CFG = {
  port: num(env.PORT, 8787),
  network: env.NETWORK || 'devnet',
  rpc: env.RPC_URL || 'https://api.devnet.solana.com',
  mock: env.MOCK_CHAIN === '1',
  dbFile: env.DB_FILE || path.join(__dirname, 'data', 'db.json'),
  tokenSecret: env.TOKEN_SECRET || '',
  minBet: num(env.MIN_BET_LAMPORTS, 1_000_000),
  maxBet: num(env.MAX_BET_LAMPORTS, 1_000_000_000),
  maxPayout: num(env.MAX_PAYOUT_LAMPORTS, 50_000_000_000),
  minDeposit: num(env.MIN_DEPOSIT_LAMPORTS, 10_000_000),
  minRealtime: num(env.MIN_REALTIME, 0.9),
  sharpRtp: num(env.SHARP_RTP, 1.15),
  sharpMinRuns: num(env.SHARP_MIN_RUNS, 150),
  withdrawReview: num(env.WITHDRAW_REVIEW_LAMPORTS, 20_000_000_000),
  potEntry: num(env.POT_ENTRY_LAMPORTS, Math.round(POTS.ENTRY * 1e9)), // challenge pot entry
  potGoal: env.MOCK_CHAIN === '1' ? env.POT_GOAL || '' : '',            // tests only: force a challenge
  specialEntry: num(env.SPECIAL_ENTRY_LAMPORTS, Math.round(SP.ENTRY * 1e9)),
  specialRecipe: env.MOCK_CHAIN === '1' ? env.SPECIAL_RECIPE || '' : '', // tests only: force a recipe
  missionNeed: { day: num(env.MISSION_DAY_LAMPORTS, Math.round(MS.NEED.day * 1e9)), week: num(env.MISSION_WEEK_LAMPORTS, Math.round(MS.NEED.week * 1e9)) },
  checkpointTimeoutMs: 10 * 60 * 1000,
  playingTimeoutMs: 3 * 60 * 1000
};
const LAMPORTS = 1_000_000_000;

// ------------------------------------------------------------------ storage (JSON file; use Postgres in production)
fs.mkdirSync(path.dirname(CFG.dbFile), { recursive: true });
const db = fs.existsSync(CFG.dbFile)
  ? JSON.parse(fs.readFileSync(CFG.dbFile, 'utf8'))
  : { users: {}, runs: {}, deposits: {}, withdrawals: [], nonces: {}, secret: crypto.randomBytes(32).toString('hex') };
const TOKEN_SECRET = CFG.tokenSecret || db.secret;
db.pots = db.pots || {}; db.potClock = db.potClock || 0; db.houseRake = db.houseRake || 0; db.missionPaid = db.missionPaid || 0;
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = CFG.dbFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, CFG.dbFile);
  }, 50);
}

// one operation at a time per user: no double spends from parallel requests
const chains = new Map();
function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(key, next.catch(() => {}));
  return next;
}

// ------------------------------------------------------------------ chain
function loadHouse() {
  if (env.HOUSE_SECRET) {
    const s = env.HOUSE_SECRET.trim();
    return Keypair.fromSecretKey(s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s));
  }
  const f = path.join(path.dirname(CFG.dbFile), 'house.json');
  if (fs.existsSync(f)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, 'utf8'))));
  const kp = Keypair.generate();
  fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}
const house = loadHouse();
const conn = CFG.mock ? null : new Connection(CFG.rpc, 'confirmed');
let houseBal = { at: 0, lamports: 0 };
async function houseLamports() {
  if (CFG.mock) return Number.MAX_SAFE_INTEGER;
  if (Date.now() - houseBal.at > 20_000) houseBal = { at: Date.now(), lamports: await conn.getBalance(house.publicKey, 'confirmed') };
  return houseBal.lamports;
}

// ------------------------------------------------------------------ helpers
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);
const hmacHex = (key, msg) => crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(msg).digest('hex');
const sha256Hex = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
// identical to the client: HMAC-SHA256(serverSeed, clientSeed:nonce:level)
const levelSeed = (run, L) => hmacHex(run.serverSeed, `${run.clientSeed}:${run.nonce}:${L}`);
const sol = (l) => (l / LAMPORTS).toFixed(4);

function makeToken(address) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const body = `${address}.${exp}`;
  return Buffer.from(`${body}.${hmacHex(TOKEN_SECRET, body)}`).toString('base64url');
}
function readToken(tok) {
  try {
    const [address, exp, sig] = Buffer.from(tok, 'base64url').toString().split('.');
    if (!address || +exp < Date.now()) return null;
    const want = hmacHex(TOKEN_SECRET, `${address}.${exp}`);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    return address;
  } catch { return null; }
}
function validAddress(a) { try { return typeof a === 'string' && PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch { return false; } }
function user(address) {
  return db.users[address] || (db.users[address] = { address, balance: 0, nonce: 0, wagered: 0, returned: 0, runs: 0, hoops: 0, swishes: 0, flagged: null, createdAt: Date.now() });
}
function maxBetFor(u, di) {
  const byPayout = Math.floor(CFG.maxPayout / E.DIFFS[di].maxWin);
  let m = Math.min(CFG.maxBet, byPayout);
  if (u.flagged) m = Math.min(m, CFG.minBet * 10);
  return m;
}
function publicMe(u) { return { address: u.address, balance: u.balance, flagged: !!u.flagged }; }

// ------------------------------------------------------------------ app
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use((req, res, next) => { res.set('cache-control', 'no-store'); next(); });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).then((out) => res.json(out)).catch((e) => {
  const status = e.status || 500;
  if (status >= 500) console.error(e);
  res.status(status).json({ error: status >= 500 ? 'Server error' : e.message });
});
function auth(req) {
  const h = req.get('authorization') || '';
  const address = h.startsWith('Bearer ') ? readToken(h.slice(7)) : null;
  if (!address) throw new HttpError(401, 'Sign in with your wallet first');
  return user(address);
}
function maybeAuth(req) { try { return auth(req); } catch { return null; } }

app.get('/api/config', wrap(async () => ({
  network: CFG.network, house: house.publicKey.toBase58(), mock: CFG.mock,
  minBet: CFG.minBet, maxBet: CFG.maxBet, maxPayout: CFG.maxPayout,
  difficulties: E.DIFFS.map((d, i) => ({ id: d.id, name: d.name, maxWin: d.maxWin, maxBet: Math.min(CFG.maxBet, Math.floor(CFG.maxPayout / d.maxWin)), index: i })),
  engine: E.VERSION, paytable: PAY.META
})));

// --- sign-in: sign a one-time message with the wallet
app.post('/api/auth/nonce', wrap(async (req) => {
  const { address } = req.body || {};
  if (!validAddress(address)) throw bad('Invalid wallet address');
  const message = `SOL DUNK sign-in\n\nWallet: ${address}\nNonce: ${crypto.randomBytes(12).toString('hex')}\nIssued: ${new Date().toISOString()}`;
  db.nonces[address] = { message, exp: Date.now() + 5 * 60 * 1000 };
  save();
  return { message };
}));
app.post('/api/auth/verify', wrap(async (req) => {
  const { address, signature } = req.body || {};
  const n = db.nonces[address];
  if (!n || n.exp < Date.now()) throw bad('Sign-in expired. Try again.');
  let ok = false;
  try { ok = nacl.sign.detached.verify(Buffer.from(n.message, 'utf8'), bs58.decode(signature), new PublicKey(address).toBytes()); } catch { ok = false; }
  if (!ok) throw new HttpError(401, 'Signature check failed');
  delete db.nonces[address];
  const u = user(address); save();
  return { token: makeToken(address), ...publicMe(u) };
}));
app.get('/api/me', wrap(async (req) => publicMe(auth(req))));

// --- deposits: the server builds the transfer, the wallet signs and sends it, the server verifies it on-chain
app.post('/api/deposit/prepare', wrap(async (req) => {
  const u = auth(req);
  const lamports = Math.floor(Number((req.body || {}).lamports));
  if (!(lamports >= CFG.minDeposit)) throw bad(`Minimum deposit is ${sol(CFG.minDeposit)} SOL`);
  if (CFG.mock) throw bad('Deposits are disabled in mock mode. Use /api/dev/faucet.');
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const from = new PublicKey(u.address);
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: from, toPubkey: house.publicKey, lamports }));
  return { message: bs58.encode(tx.serializeMessage()) };
}));
app.post('/api/deposit/confirm', wrap(async (req) => {
  const u = auth(req);
  const signature = String((req.body || {}).signature || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw bad('Invalid transaction signature');
  if (CFG.mock) throw bad('Deposits are disabled in mock mode');
  let tx = null;
  for (let i = 0; i < 20 && !tx; i++) {
    tx = await conn.getParsedTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!tx) throw bad('Transaction not found yet. Try again in a moment.');
  if (tx.meta && tx.meta.err) throw bad('That transaction failed on-chain');
  if (tx.blockTime && Date.now() / 1000 - tx.blockTime > 24 * 3600) throw bad('That transaction is too old to credit');
  const houseAddr = house.publicKey.toBase58();
  let lamports = 0;
  for (const ix of tx.transaction.message.instructions) {
    const p = ix.parsed;
    if (ix.program === 'system' && p && p.type === 'transfer' && p.info.source === u.address && p.info.destination === houseAddr) lamports += Number(p.info.lamports);
  }
  if (!(lamports > 0)) throw bad('No transfer from your wallet to the house wallet in that transaction');
  return withLock(u.address, async () => {
    if (db.deposits[signature]) throw bad('That deposit was already credited');
    db.deposits[signature] = { address: u.address, lamports, at: Date.now() };
    u.balance += lamports; houseBal.at = 0; save();
    return { credited: lamports, ...publicMe(u) };
  });
}));

// --- withdrawals: paid from the house wallet; large ones and flagged accounts wait for review
app.post('/api/withdraw', wrap(async (req) => {
  const u = auth(req);
  const lamports = Math.floor(Number((req.body || {}).lamports));
  if (!(lamports > 0)) throw bad('Enter an amount to withdraw');
  return withLock(u.address, async () => {
    if (lamports > u.balance) throw bad('Amount is more than your balance');
    if (Object.values(db.runs).some((r) => r.address === u.address && (r.status === 'playing' || r.status === 'checkpoint'))) throw bad('Finish your current run first');
    u.balance -= lamports;
    const w = { id: crypto.randomUUID(), address: u.address, lamports, at: Date.now(), status: 'pending', signature: null };
    db.withdrawals.push(w); save();
    if (lamports >= CFG.withdrawReview || u.flagged) { w.status = 'review'; save(); return { status: 'review', ...publicMe(u) }; }
    if (CFG.mock) { w.status = 'sent'; w.signature = 'mock-' + w.id; save(); return { status: 'sent', signature: w.signature, ...publicMe(u) }; }
    try {
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: house.publicKey, toPubkey: new PublicKey(u.address), lamports }));
      w.signature = await sendAndConfirmTransaction(conn, tx, [house], { commitment: 'confirmed' });
      w.status = 'sent'; houseBal.at = 0; save();
      return { status: 'sent', signature: w.signature, ...publicMe(u) };
    } catch (e) {
      u.balance += lamports; w.status = 'failed'; w.error = String(e.message || e); save();
      throw bad('Withdrawal failed and was refunded. Try again shortly.');
    }
  });
}));

if (CFG.mock) {
  app.post('/api/dev/faucet', wrap(async (req) => {
    const u = auth(req);
    const lamports = Math.floor(Number((req.body || {}).lamports || LAMPORTS));
    return withLock(u.address, async () => { u.balance += lamports; save(); return publicMe(u); });
  }));
}

// ------------------------------------------------------------------ challenge pots (rules in src/pots.cjs)
// One pot per UTC day. Players pay a fixed entry, then play ordinary runs; everyone who meets the day's challenge in
// a run (started after entering, on the challenge's tier or harder) splits the pot when the day ends. The house
// keeps POTS.RAKE of every entry whoever wins; with no winners the pot rolls into the next day's.
// The day clock (pots, missions, the special level) is real time; in mock mode /api/dev/pot/advance moves it on a day.
const potNow = () => Date.now() + db.potClock;
function potFor(day) {
  return db.pots[day] || (db.pots[day] = { day, goal: CFG.potGoal && POTS.GOAL_BY[CFG.potGoal] ? CFG.potGoal : POTS.goalFor(day).id, fee: CFG.potEntry, entries: {}, carryIn: 0, paidIn: 0, settled: false, createdAt: Date.now() });
}
// close every pot whose day is over (oldest first, so a rollover can roll on through quiet days)
function settlePots() {
  let changed = false;
  for (;;) {
    const due = Object.values(db.pots).filter((p) => !p.settled && POTS.closesAt(p.day) <= potNow()).sort((a, b) => (a.day < b.day ? -1 : 1));
    if (!due.length) break;
    for (const p of due) {
      const winners = Object.keys(p.entries).filter((a) => p.entries[a].done);
      const r = POTS.split(p.paidIn, p.carryIn, winners.length, true);
      for (const a of winners) { const u = user(a); u.balance += r.share; u.potWon = (u.potWon || 0) + r.share; p.entries[a].won = r.share; }
      Object.assign(p, { settled: true, settledAt: Date.now(), winners: winners.length, share: r.share, rake: r.rake, carryOut: r.carry });
      db.houseRake += r.rake;
      if (r.carry) potFor(POTS.dayKey(POTS.closesAt(p.day))).carryIn += r.carry;
      changed = true;
    }
  }
  if (changed) save();
}
function potView(p, u) {
  const g = POTS.GOAL_BY[p.goal], es = Object.values(p.entries);
  const out = {
    key: p.day, goal: { id: g.id, kind: g.kind, n: g.n, tier: g.tier, text: g.text, sub: POTS.tierText(g.tier) },
    feeLamports: p.fee, rake: POTS.RAKE, entrants: es.length, completed: es.filter((e) => e.done).length,
    poolLamports: Math.floor(POTS.poolOf(p.paidIn, p.carryIn)), carryInLamports: p.carryIn,
    closesAt: POTS.closesAt(p.day) - db.potClock, simulated: false
  };
  if (u) { const e = p.entries[u.address]; out.me = e ? { entered: true, done: !!e.done, best: e.best || 0 } : { entered: false }; }
  return out;
}
function lastPot(u) {
  const p = Object.values(db.pots).filter((x) => x.settled).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  if (!p) return null;
  const e = u && p.entries[u.address];
  return { key: p.day, goal: POTS.GOAL_BY[p.goal].text, entrants: Object.keys(p.entries).length, winners: p.winners, shareLamports: p.share, rolledLamports: p.winners ? 0 : p.carryOut, me: e ? { done: !!e.done, wonLamports: e.won || 0 } : null };
}
// a verified level may complete the player's challenge (only in a run started after they entered, on the tier or harder)
function potCheck(u, run) {
  const p = db.pots[POTS.dayKey(potNow())], e = p && p.entries[u.address];
  if (!e || !(run.potAt >= e.at)) return null;
  const pr = POTS.progress(p.goal, verifiedLevels(run), run.di);
  if (!pr.counts) return { counts: false, done: !!e.done };
  if (pr.value > (e.best || 0)) e.best = pr.value;
  const just = !e.done && pr.done;
  if (just) { e.done = true; e.doneAt = potNow(); e.runId = run.id; }
  save();
  return { counts: true, done: !!e.done, just, value: pr.value, target: pr.target };
}
app.get('/api/pot', wrap(async (req) => {
  settlePots();
  const u = maybeAuth(req);
  return { ...potView(potFor(POTS.dayKey(potNow())), u), last: lastPot(u) };
}));
app.post('/api/pot/enter', wrap(async (req) => {
  const u = auth(req);
  return withLock(u.address, async () => {
    settlePots();
    const p = potFor(POTS.dayKey(potNow()));
    if (p.entries[u.address]) throw bad('You’re already in today’s pot');
    if (POTS.closesAt(p.day) - potNow() < 60_000) throw bad('This pot is about to close. The next one opens at midnight UTC.');
    if (u.balance < p.fee) throw bad('Not enough balance for the entry');
    u.balance -= p.fee; p.paidIn += p.fee;
    p.entries[u.address] = { at: potNow(), done: false, best: 0 };
    save();
    return { ...potView(p, u), last: lastPot(u), ...publicMe(u) };
  });
}));
setInterval(settlePots, 60_000).unref();
if (CFG.mock) {
  // tests: move the pot clock on a day, closing today's pot
  app.post('/api/dev/pot/advance', wrap(async () => { db.potClock += POTS.DAY_MS; settlePots(); save(); return { ok: true, houseRake: db.houseRake }; }));
}

// ------------------------------------------------------------------ missions (rules in src/missions.cjs)
// Three missions a UTC day and three a week. Every run counts toward them whatever the bet; each pays SOL once the
// player has played the window's need (run bets and special entries), so the rewards stay inside the house's edge.
function missionPay(u, paid) {
  let sum = 0;
  const out = paid.map((p) => { const lamports = Math.floor(p.amount); sum += lamports; return { win: p.win, slot: p.slot, k: p.k, n: p.n, lamports }; });
  if (sum) { u.balance += sum; u.returned += sum; u.missionPaid = (u.missionPaid || 0) + sum; db.missionPaid += sum; } // counts in the player's return
  return out;
}
function missionView(u) {
  u.ms = MS.roll(u.ms, potNow());
  const v = MS.view(u.ms, potNow(), CFG.missionNeed), fix = (l) => l.map((m) => ({ k: m.k, n: m.n, xp: m.xp, sum: m.sum, p: m.p, done: m.done, paid: m.paid, rewardLamports: Math.floor(m.reward) }));
  return { day: v.day, week: v.week, dayEnds: v.dayEnds - db.potClock, weekEnds: v.weekEnds - db.potClock, needLamports: v.need, playedLamports: v.played, daily: fix(v.daily), weekly: fix(v.weekly) };
}
// a bet or a special entry counts toward both windows' play; it may unlock rewards already earned
function missionPlay(u, lamports) { const r = MS.play(u.ms, lamports, potNow(), CFG.missionNeed); u.ms = r.s; return missionPay(u, r.paid); }
// the rings of a run that counted, level by level (a max win ends the run at the capped ring, which isn't a clear)
const verifiedLevels = (run) => run.levels.map((l) => {
  const n = l.counted == null ? l.outcomes.length : l.counted;
  return { outcomes: l.outcomes.slice(0, n), clear: l.result === 'clear' && !l.capped, mov: l.mov || '' };
});
app.get('/api/missions', wrap(async (req) => missionView(auth(req))));

// the most the house could owe right now: every balance, every open run's pot (a special's prize), every open pot
function owedLamports() {
  return Object.values(db.users).reduce((a, x) => a + x.balance, 0)
    + Object.values(db.runs).filter((r) => r.status === 'checkpoint' || r.status === 'playing').reduce((a, r) => a + (r.kind === 'special' ? r.prize : Math.floor(r.bet * r.total)), 0)
    + Object.values(db.pots).filter((p) => !p.settled).reduce((a, p) => a + p.carryIn + p.paidIn, 0); // pots in play belong to players
}

// --- runs
function openRun(u) { return Object.values(db.runs).find((r) => r.address === u.address && (r.status === 'playing' || r.status === 'checkpoint')); }
function getRun(u, runId) {
  const r = db.runs[runId];
  if (!r || r.address !== u.address || r.kind === 'special') throw new HttpError(404, 'Run not found');
  return r;
}
function settle(u, run, status) {
  run.status = status; run.endedAt = Date.now();
  let payout = 0;
  if (status === 'cashout' || status === 'maxwin' || status === 'final') {
    payout = Math.floor(run.bet * run.total);
    u.balance += payout;
  }
  run.payout = payout;
  u.returned += payout; u.runs++;
  // missions move on from the levels the server verified (a voided run doesn't count)
  if (run.kind !== 'special' && status !== 'void') {
    const r = MS.run(u.ms, verifiedLevels(run), potNow(), CFG.missionNeed);
    u.ms = r.s; run.missions = { done: r.done, paid: missionPay(u, r.paid) };
  }
  // limit accounts that keep beating the house (skilled players and bots)
  if (!u.flagged && u.runs >= CFG.sharpMinRuns && u.wagered > 0 && u.returned / u.wagered > CFG.sharpRtp) u.flagged = { reason: 'high return', at: Date.now() };
  if (!u.flagged && u.hoops >= 120 && u.swishes / u.hoops > 0.97) u.flagged = { reason: 'superhuman swish rate', at: Date.now() };
  save();
  return payout;
}

app.post('/api/run/start', wrap(async (req) => {
  const u = auth(req);
  const { difficulty, lamports, clientSeed } = req.body || {};
  const di = Number(difficulty), bet = Math.floor(Number(lamports));
  if (!(di >= 0 && di < E.DIFFS.length && di === Math.floor(di))) throw bad('Unknown difficulty');
  if (typeof clientSeed !== 'string' || !/^[0-9a-zA-Z]{4,64}$/.test(clientSeed)) throw bad('Invalid client seed');
  if (!(bet >= CFG.minBet)) throw bad(`Minimum bet is ${sol(CFG.minBet)} SOL`);
  return withLock(u.address, async () => {
    if (openRun(u)) throw bad('You already have a run in progress');
    const max = maxBetFor(u, di);
    if (bet > max) throw bad(`Maximum bet on ${E.DIFFS[di].name} is ${sol(max)} SOL`);
    if (bet > u.balance) throw bad('Not enough balance for that bet');
    // the house must be able to cover the biggest possible win plus every player balance
    const need = bet * E.DIFFS[di].maxWin;
    if ((await houseLamports()) - owedLamports() < need) throw bad('The house can’t cover a bet that size right now. Try a smaller bet.');
    u.balance -= bet; u.wagered += bet;
    const paid = missionPlay(u, bet);
    const run = {
      id: crypto.randomUUID(), address: u.address, di, bet,
      serverSeed: crypto.randomBytes(32).toString('hex'), clientSeed, nonce: u.nonce++,
      level: 1, total: 1, streak: 0, status: 'playing', levels: [],
      createdAt: Date.now(), potAt: potNow(), levelStartedAt: Date.now(), updatedAt: Date.now()
    };
    db.runs[run.id] = run; save();
    return { runId: run.id, serverSeedHash: sha256Hex(run.serverSeed), nonce: run.nonce, level: 1, levelSeed: levelSeed(run, 1), missions: { paid, view: missionView(u) }, ...publicMe(u) };
  });
}));

app.post('/api/run/level', wrap(async (req) => {
  const u = auth(req);
  const { runId, level, taps } = req.body || {};
  return withLock(u.address, async () => {
    const run = getRun(u, runId);
    if (run.status !== 'playing') throw bad('This run is not waiting for a level');
    if (Number(level) !== run.level) throw bad('Wrong level');
    if (!E.validTaps(taps)) throw bad('Invalid tap data');
    const def = E.generateLevel(levelSeed(run, run.level), run.di, run.level);
    const r = E.replay(def, taps);
    // a real player can't finish a level faster than the game runs
    const gameMs = r.ticks * E.DT * 1000, elapsed = Date.now() - run.levelStartedAt;
    if (elapsed < gameMs * CFG.minRealtime - 250) {
      run.flag = 'too fast'; settle(u, run, 'void');
      throw bad('Level submitted faster than real time. The run was voided.');
    }
    const pt = PAY.PAYTABLE[run.di][run.level - 1];
    const a = E.applyLevel(pt, r.outcomes, run.total, E.DIFFS[run.di].maxWin, run.streak);
    const counted = a.capped ? a.capIndex + 1 : r.outcomes.length;
    u.hoops += counted; u.swishes += r.outcomes.slice(0, counted).filter((o) => o === 'S').length;
    run.total = a.total; run.streak = a.streak; run.updatedAt = Date.now();
    run.levels.push({ level: run.level, taps: taps.length, outcomes: r.outcomes.join(''), result: r.result, ticks: r.ticks, counted, capped: a.capped,
      mov: r.outcomes.slice(0, counted).map((o, k) => (def.hoops[k].amp ? '1' : '0')).join('') });
    let status;
    if (a.capped) status = 'maxwin';
    else if (r.result !== 'clear') status = 'bust';
    else if (run.level >= E.LEVELS) status = 'final';
    else status = 'checkpoint';
    const pot = potCheck(u, run);
    let payout = 0;
    if (status === 'checkpoint') { run.status = 'checkpoint'; save(); }
    else payout = settle(u, run, status);
    return {
      status, total: run.total, outcomes: r.outcomes.slice(0, counted), streak: run.streak, pot,
      potLamports: Math.floor(run.bet * run.total), payoutLamports: payout,
      missions: run.missions ? { ...run.missions, view: missionView(u) } : undefined,
      serverSeed: status === 'checkpoint' ? undefined : run.serverSeed, ...publicMe(u)
    };
  });
}));

app.post('/api/run/continue', wrap(async (req) => {
  const u = auth(req);
  return withLock(u.address, async () => {
    const run = getRun(u, (req.body || {}).runId);
    if (run.status !== 'checkpoint') throw bad('Nothing to continue');
    run.level++; run.status = 'playing'; run.levelStartedAt = Date.now(); run.updatedAt = Date.now(); save();
    return { level: run.level, levelSeed: levelSeed(run, run.level) };
  });
}));

app.post('/api/run/cashout', wrap(async (req) => {
  const u = auth(req);
  return withLock(u.address, async () => {
    const run = getRun(u, (req.body || {}).runId);
    if (run.status !== 'checkpoint') throw bad('You can only cash out at a checkpoint');
    const payout = settle(u, run, 'cashout');
    return { payoutLamports: payout, total: run.total, serverSeed: run.serverSeed, missions: { ...run.missions, view: missionView(u) }, ...publicMe(u) };
  });
}));

// ------------------------------------------------------------------ special level (rules in src/special.cjs)
// One special a UTC day: a long level with a twist. Each attempt pays a fixed entry and gets a fresh course from its
// own provably fair seed (HMAC-SHA256(serverSeed, clientSeed:nonce:special)); clearing every ring pays the prize.
// Accounts limited for beating the house can't enter: strong players can come out ahead on a fixed prize.
function specialToday() {
  const day = SP.dayKey(potNow());
  return { day, R: (CFG.specialRecipe && SP.BY[CFG.specialRecipe]) || SP.recipeFor(day) };
}
function specialView(u) {
  const { day, R } = specialToday(), fee = CFG.specialEntry, x = SP.prizeOf(R.id);
  const out = {
    day, recipe: { id: R.id, name: R.name, blurb: R.blurb, rings: R.n }, feeLamports: fee, prizeLamports: Math.floor(fee * x), x,
    odds: (SP.PRIZES[R.id] || { p: [] }).p, closesAt: SP.closesAt(day) - db.potClock
  };
  if (u) { const t = u.special && u.special.day === day ? u.special : { tries: 0, wins: 0 }; out.me = { tries: t.tries, wins: t.wins, blocked: !!u.flagged }; }
  return out;
}
app.get('/api/special', wrap(async (req) => specialView(maybeAuth(req))));
app.post('/api/special/start', wrap(async (req) => {
  const u = auth(req);
  const { clientSeed } = req.body || {};
  if (typeof clientSeed !== 'string' || !/^[0-9a-zA-Z]{4,64}$/.test(clientSeed)) throw bad('Invalid client seed');
  return withLock(u.address, async () => {
    if (openRun(u)) throw bad('Finish your current run first');
    if (u.flagged) throw bad('The special level isn’t available on this account');
    const { day, R } = specialToday(), fee = CFG.specialEntry, prize = Math.floor(fee * SP.prizeOf(R.id));
    if (!(prize > fee)) throw bad('There’s no special level today');
    if (u.balance < fee) throw bad('Not enough balance for the entry');
    if ((await houseLamports()) - owedLamports() < prize) throw bad('The house can’t cover the prize right now. Try again later.');
    u.balance -= fee; u.wagered += fee;
    const paid = missionPlay(u, fee);
    if (!u.special || u.special.day !== day) u.special = { day, tries: 0, wins: 0 };
    u.special.tries++;
    const run = {
      id: crypto.randomUUID(), address: u.address, kind: 'special', recipe: R.id, day, di: R.base[0], bet: fee, prize,
      serverSeed: crypto.randomBytes(32).toString('hex'), clientSeed, nonce: u.nonce++,
      level: 1, total: 1, status: 'playing', levels: [], createdAt: Date.now(), levelStartedAt: Date.now(), updatedAt: Date.now()
    };
    db.runs[run.id] = run; save();
    return {
      runId: run.id, serverSeedHash: sha256Hex(run.serverSeed), nonce: run.nonce, seed: levelSeed(run, 'special'),
      recipe: R.id, feeLamports: fee, prizeLamports: prize, missions: { paid, view: missionView(u) }, special: specialView(u), ...publicMe(u)
    };
  });
}));
app.post('/api/special/finish', wrap(async (req) => {
  const u = auth(req);
  const { runId, taps } = req.body || {};
  return withLock(u.address, async () => {
    const run = db.runs[runId];
    if (!run || run.address !== u.address || run.kind !== 'special') throw new HttpError(404, 'Run not found');
    if (run.status !== 'playing') throw bad('This attempt is already over');
    if (!E.validTaps(taps)) throw bad('Invalid tap data');
    const def = SP.generate(levelSeed(run, 'special'), run.recipe);
    const r = E.replay(def, taps);
    const gameMs = r.ticks * E.DT * 1000, elapsed = Date.now() - run.levelStartedAt;
    if (elapsed < gameMs * CFG.minRealtime - 250) {
      run.flag = 'too fast'; settle(u, run, 'void');
      throw bad('Level submitted faster than real time. The attempt was voided.');
    }
    const won = r.result === 'clear';
    u.hoops += r.outcomes.length; u.swishes += r.outcomes.filter((o) => o === 'S').length;
    run.levels.push({ level: 1, taps: taps.length, outcomes: r.outcomes.join(''), result: r.result, ticks: r.ticks });
    run.total = won ? run.prize / run.bet : 0;
    const status = won ? 'won' : 'lost';
    run.status = status; run.endedAt = Date.now();
    const payout = won ? run.prize : 0;
    run.payout = payout; u.balance += payout; u.returned += payout; u.runs++;
    if (won && u.special && u.special.day === run.day) u.special.wins++;
    if (!u.flagged && u.runs >= CFG.sharpMinRuns && u.wagered > 0 && u.returned / u.wagered > CFG.sharpRtp) u.flagged = { reason: 'high return', at: Date.now() };
    if (!u.flagged && u.hoops >= 120 && u.swishes / u.hoops > 0.97) u.flagged = { reason: 'superhuman swish rate', at: Date.now() };
    save();
    return { status, outcomes: r.outcomes, result: r.result, payoutLamports: payout, serverSeed: run.serverSeed, special: specialView(u), ...publicMe(u) };
  });
}));

// provably fair: anyone can check a finished run
app.get('/api/run/:id', wrap(async (req) => {
  const run = db.runs[req.params.id];
  if (!run) throw new HttpError(404, 'Run not found');
  const done = !(run.status === 'playing' || run.status === 'checkpoint');
  return {
    id: run.id, kind: run.kind || 'run', recipe: run.recipe, difficulty: run.di, betLamports: run.bet, status: run.status, total: run.total, payoutLamports: run.payout || 0,
    serverSeedHash: sha256Hex(run.serverSeed), serverSeed: done ? run.serverSeed : undefined, clientSeed: run.clientSeed, nonce: run.nonce, levels: run.levels
  };
}));

// abandoned runs: a waiting checkpoint is cashed out for the player; an abandoned level is lost
setInterval(() => {
  const now = Date.now();
  for (const run of Object.values(db.runs)) {
    if (run.status === 'checkpoint' && now - run.updatedAt > CFG.checkpointTimeoutMs) withLock(run.address, async () => { if (run.status === 'checkpoint') settle(user(run.address), run, 'cashout'); });
    if (run.status === 'playing' && now - run.levelStartedAt > CFG.playingTimeoutMs) withLock(run.address, async () => { if (run.status === 'playing') settle(user(run.address), run, 'abandoned'); });
  }
}, 15_000).unref();

// the game itself (built with: SERVER_URL=/ node build.cjs)
const page = path.join(__dirname, '..', 'dist', 'index.server.html');
app.get('/', (req, res) => (fs.existsSync(page) ? res.sendFile(page) : res.status(404).send('Build the game first: SERVER_URL=/ node build.cjs')));

if (process.env.NO_LISTEN !== '1') {
  app.listen(CFG.port, () => {
    console.log(`SOL DUNK server on :${CFG.port} · ${CFG.mock ? 'MOCK chain' : CFG.network + ' via ' + CFG.rpc}`);
    console.log(`house wallet ${house.publicKey.toBase58()}`);
  });
}
export { app, CFG };
