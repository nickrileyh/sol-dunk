#!/usr/bin/env node
// A live end-to-end check against a running server, the way a player would use it: sign in with a wallet, deposit
// real (devnet) SOL, play a run in real time, cash out, withdraw everything, and check the wallet's balance on chain.
//
//   SERVER_URL=http://127.0.0.1:8787 PLAYER_KEY=player.json node scripts/e2e.mjs [deposit SOL, default 0.05]
//
// PLAYER_KEY is a keypair file (the Solana CLI's JSON format; scripts/keygen.mjs makes one). On devnet the script
// asks the faucet for SOL if the wallet is low; if the faucet refuses, use https://faucet.solana.com. RPC_URL
// defaults to the network's public endpoint (the server's /api/config says which network).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Connection, Keypair, Message, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

const require = createRequire(import.meta.url);
const E = require('../../src/engine.cjs');
const B = require('../../src/bot.cjs');
const base = (process.env.SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const depositSol = Number(process.argv[2] || 0.05);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...x) => console.log('·', ...x);
let token = null;
async function api(p, body) {
  const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p}: ${res.status} ${j.error || ''}`);
  return j;
}

const cfg = await api('/api/config');
if (cfg.mock) { console.error('This server runs on the mock chain: start it with a real NETWORK (devnet).'); process.exit(2); }
const rpcUrl = process.env.RPC_URL || (cfg.network === 'localnet' ? 'http://127.0.0.1:8899' : `https://api.${cfg.network}.solana.com`);
const conn = new Connection(rpcUrl, 'confirmed');
if (!process.env.PLAYER_KEY) { console.error('Set PLAYER_KEY to a keypair file (node scripts/keygen.mjs player.json)'); process.exit(2); }
const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.PLAYER_KEY, 'utf8'))));
const me = kp.publicKey.toBase58();
say(`server ${base} on ${cfg.network}, house ${cfg.house}; player ${me}`);

let onChain = await conn.getBalance(kp.publicKey);
const need = Math.round((depositSol + 0.01) * LAMPORTS_PER_SOL);
if (onChain < need && cfg.network !== 'mainnet-beta') {
  say('asking the faucet for 1 SOL');
  try { const s = await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL); await conn.confirmTransaction(s, 'confirmed'); }
  catch (e) { console.error('The faucet said no (' + e.message.slice(0, 80) + '). Fund ' + me + ' at https://faucet.solana.com and run again.'); process.exit(1); }
  onChain = await conn.getBalance(kp.publicKey);
}
if (onChain < need) { console.error(`The wallet has ${onChain / 1e9} SOL; it needs ${need / 1e9}.`); process.exit(1); }
const start = onChain;

// sign in
const { message } = await api('/api/auth/nonce', { address: me });
const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
token = (await api('/api/auth/verify', { address: me, signature: bs58.encode(sig) })).token;
say('signed in; balance', (await api('/api/me')).balance / 1e9, 'SOL');

// deposit: sign the server's message, send it, report it
const prep = await api('/api/deposit/prepare', { lamports: Math.round(depositSol * LAMPORTS_PER_SOL) });
const tx = Transaction.populate(Message.from(bs58.decode(prep.message)));
tx.sign(kp);
const depSig = await conn.sendRawTransaction(tx.serialize());
say('deposit sent', depSig);
let dep = await api('/api/deposit/confirm', { signature: depSig });
for (let i = 0; i < 20 && dep.status === 'pending'; i++) { await sleep(3000); dep = await api('/api/deposit/confirm', { signature: depSig }); }
if (dep.status !== 'credited') throw new Error('deposit not credited: ' + JSON.stringify(dep));
say(dep.message, '; balance', dep.balance / 1e9, 'SOL');

// one run on Easy at the smallest bet, played in real time (the server refuses levels finished faster than the game)
const di = 0, bet = Math.max(cfg.minBet, 1_000_000);
const run = await api('/api/run/start', { difficulty: di, lamports: bet, clientSeed: 'e2e' + Date.now() });
let L = 1, seed = run.levelSeed, end = null;
while (!end) {
  const t0 = Date.now(), def = E.generateLevel(seed, di, L), st = E.createState(def), bot = B.createBot('good', E.makeRng(seed)), taps = [0];
  let tap = true;
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) taps.push(st.tick); }
  await sleep(Math.max(0, st.tick * E.DT * 1000 - (Date.now() - t0)) + 200);
  const r = await api('/api/run/level', { runId: run.runId, level: L, taps });
  say(`level ${L}: ${r.status} ${r.outcomes.join('')} total ${r.total.toFixed(3)}×`);
  if (r.status === 'checkpoint') end = await api('/api/run/cashout', { runId: run.runId });
  else end = r;
}
say('run over; payout', (end.payoutLamports || 0) / 1e9, 'SOL; balance', end.balance / 1e9, 'SOL');

// withdraw everything
const all = (await api('/api/me')).balance;
if (all < cfg.minWithdraw) throw new Error('balance below the minimum withdrawal');
const w = await api('/api/withdraw', { lamports: all });
say('withdrawal', w.status, w.message);
let st = w.status;
for (let i = 0; i < 40 && st !== 'sent'; i++) { await sleep(3000); st = ((await api('/api/me')).withdrawals.find((x) => x.id === w.id) || {}).status; if (st === 'review') break; }
if (st !== 'sent') throw new Error('withdrawal is ' + st + (st === 'review' ? ' (approve it with scripts/admin.mjs)' : ''));
await sleep(1500);
const after = await conn.getBalance(kp.publicKey);
// the wallet paid the deposit and its fee and got the withdrawal back
const expected = start - Math.round(depositSol * LAMPORTS_PER_SOL) + all;
const fee = expected - after;
say(`on chain: ${start / 1e9} -> ${after / 1e9} SOL (deposit ${depositSol}, withdrawn ${all / 1e9}, network fee ${fee / 1e9})`);
if (fee < 0 || fee > 100_000) throw new Error('the on-chain balance doesn\'t add up');
console.log('end-to-end check passed');
