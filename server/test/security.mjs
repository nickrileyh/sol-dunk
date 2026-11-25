// The protections around the money: config checks that refuse an unsafe mainnet start, rate limits, country blocking,
// the closed-beta allowlist, the admin API's lock, the origin secret, the page's content security policy, holds on big
// wins and on bot-like precision, voided runs going to review.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { bootServer, apiClient, admin as adminClient, stopAll, check, failed, SERVER } from './lib/harness.mjs';
import { loadConfig } from '../lib/config.mjs';

const require = createRequire(import.meta.url);
const E = require('../../src/engine.cjs');
const B = require('../../src/bot.cjs');
const SOL = 1e9;
const ADMIN = 'security-test-admin-token-' + 'y'.repeat(32);

// play one level with a bot, returning its taps
function taps(seed, di, L, skill, salt) {
  const st = E.createState(E.generateLevel(seed, di, L)), bot = B.createBot(skill, E.makeRng(salt)), out = [0];
  let tap = true;
  while (!st.done) { E.step(st, tap); tap = B.decide(bot, st); if (tap && !st.done) out.push(st.tick); }
  return out;
}
// play a whole run, continuing at every checkpoint; returns the final response
async function playRun(c, di, bet, skill, salt) {
  const s = await c.api('/api/run/start', { difficulty: di, lamports: bet, clientSeed: 'sec' + salt });
  if (s.status !== 200) return s;
  let L = 1, seed = s.levelSeed;
  for (;;) {
    const r = await c.api('/api/run/level', { runId: s.runId, level: L, taps: taps(seed, di, L, skill, salt + ':' + L) });
    if (r.status !== 'checkpoint') return r;
    const n = await c.api('/api/run/continue', { runId: s.runId }); L = n.level; seed = n.levelSeed;
  }
}
function runConfig(env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: 'running', out }); }, 8000);
    p.on('exit', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}

(async () => {
  // ---- mainnet refuses to start without the settings real money needs
  const bare = await runConfig({ NETWORK: 'mainnet-beta' });
  const need = ['DATABASE_URL', 'TOKEN_SECRET', 'ADMIN_TOKEN', 'HOUSE_SECRET', 'COLD_ADDRESS', 'PUBLIC_URL', 'BLOCKED_COUNTRIES', 'RPC_URL'];
  check(bare.code === 1 && need.every((k) => bare.out.includes(k)), 'mainnet without settings refuses to start, naming each missing one: ' + need.filter((k) => !bare.out.includes(k)));
  const mock = await runConfig({ NETWORK: 'mainnet-beta', MOCK_CHAIN: '1' });
  check(mock.code === 1 && /MOCK_CHAIN can't be used on mainnet/.test(mock.out), 'mainnet refuses the mock chain');
  const weak = await runConfig({ NETWORK: 'devnet', ADMIN_TOKEN: 'short' });
  check(weak.code === 1 && /ADMIN_TOKEN must be at least 32/.test(weak.out), 'a short admin token is refused');

  const full = loadConfig({
    NETWORK: 'mainnet-beta', DATABASE_URL: 'postgres://x', TOKEN_SECRET: 't'.repeat(64), ADMIN_TOKEN: 'a'.repeat(64), HOUSE_KEY_FILE: '/run/secrets/house_key',
    COLD_ADDRESS: 'So11111111111111111111111111111111111111112', PUBLIC_URL: 'https://play.example.com', BLOCKED_COUNTRIES: 'US,GB', RPC_URL: 'https://rpc.example.com',
    TRUST_PROXY: '2', ALERT_WEBHOOK_URL: 'https://hooks.example.com/x', ORIGIN_SECRET: 'o'.repeat(32), WITHDRAW_DAY_TOTAL_LAMPORTS: '20000000000'
  });
  check(full.errors.length === 0 && full.warnings.length === 0, 'a complete mainnet configuration passes: ' + JSON.stringify([full.errors, full.warnings]));
  check(full.CFG.depositCommitment === 'finalized' && full.CFG.withdrawCommitment === 'finalized' && full.CFG.devEndpoints === false && full.CFG.domain === 'play.example.com', 'mainnet waits for finality and has no dev endpoints');

  // ---- rate limits, country blocking, the page's security headers
  const s1 = await bootServer({ RATE_LIMIT: '1', BLOCKED_COUNTRIES: 'US,KP', ADMIN_TOKEN: ADMIN, MIN_REALTIME: '0.9' });
  const c1 = apiClient(s1.url);
  const { address } = await c1.signIn();
  await c1.api('/api/dev/faucet', { lamports: 2 * SOL });
  const codes = [];
  for (let i = 0; i < 35; i++) codes.push((await c1.api('/api/auth/nonce', { address })).status);
  check(codes.slice(0, 28).every((x) => x === 200) && codes.includes(429), 'sign-in is rate limited per IP: ' + codes.slice(-6));
  const us = await c1.api('/api/run/start', { difficulty: 0, lamports: 0.01 * SOL, clientSeed: 'geo1' }, { 'cf-ipcountry': 'US' });
  check(us.status === 451, 'a run from a blocked country is refused (451)');
  const fr = await c1.api('/api/run/start', { difficulty: 0, lamports: 0.01 * SOL, clientSeed: 'geo2' }, { 'cf-ipcountry': 'FR' });
  check(fr.status === 200, 'a run from an allowed country is fine');
  // abandon it quickly: a level submitted instantly is voided, and the void goes to review
  const v = await c1.api('/api/run/level', { runId: fr.runId, level: 1, taps: taps(fr.levelSeed, 0, 1, 'perfect', 'v') });
  check(v.status === 400 && /real time/.test(v.error), 'an instant level is voided');
  const A1 = adminClient(s1.url, ADMIN);
  check((await A1('/reviews')).reviews.some((r) => r.kind === 'void' && r.address === address), 'a voided run is in the review queue');
  const wus = await c1.api('/api/withdraw', { lamports: 0.1 * SOL }, { 'cf-ipcountry': 'US' });
  check(wus.status !== 451 && wus.status === 'sent', 'withdrawals stay open from a blocked country (nobody is cut off from their money): ' + wus.status);
  const page = await fetch(s1.url + '/');
  const csp = page.headers.get('content-security-policy') || '';
  check(page.status === 200 && /script-src 'self'( 'sha256-[A-Za-z0-9+/=]+')+/.test(csp) && /frame-ancestors 'none'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), 'the page has a hash-based script policy and can\'t be framed');
  check(page.headers.get('x-frame-options') === 'DENY' && page.headers.get('x-content-type-options') === 'nosniff', 'security headers set');
  check((await fetch(s1.url + '/', { headers: { 'cf-ipcountry': 'KP' } })).status === 451, 'the page is refused from a blocked country');
  const junk = await fetch(s1.url + '/api/withdraw', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  check(junk.status === 400, 'malformed JSON is a 400');
  // admin lock
  check((await adminClient(s1.url, 'wrong-' + ADMIN)('/overview')).status === 401, 'admin API refuses a wrong token');
  check((await (await fetch(s1.url + '/api/admin/overview')).status) === 401, 'admin API refuses no token');
  check((await A1('/overview')).network === 'devnet', 'admin API works with the token');
  s1.kill();
  const s0 = await bootServer({});
  check((await adminClient(s0.url, ADMIN)('/overview')).status === 404, 'without ADMIN_TOKEN there is no admin API');
  s0.kill();

  // ---- closed beta: only listed wallets sign in; the operator adds and removes them
  const inKp = nacl.sign.keyPair(), outKp = nacl.sign.keyPair();
  const s2 = await bootServer({ ACCESS: 'allowlist', ALLOWLIST: '', ADMIN_TOKEN: ADMIN });
  const A2 = adminClient(s2.url, ADMIN);
  await A2('/allowlist', { add: [bs58.encode(inKp.publicKey)] });
  const ci = apiClient(s2.url), co = apiClient(s2.url);
  const ri = await ci.signIn(inKp), ro = await co.signIn(outKp);
  check(ri.r.token && !ro.r.token && ro.r.status === 403, 'closed beta: a listed wallet signs in, another is refused');
  await A2('/allowlist', { remove: [bs58.encode(inKp.publicKey)] });
  check((await ci.api('/api/me')).status === 403, 'closed beta: removing a wallet locks it out');
  s2.kill();

  // ---- the origin secret: only the proxy (which adds it) may reach the server
  const s3 = await bootServer({ ORIGIN_SECRET: 'origin-secret-value' });
  check((await fetch(s3.url + '/api/config')).status === 403, 'origin secret: a request without it is refused');
  check((await fetch(s3.url + '/api/config', { headers: { 'x-origin-secret': 'origin-secret-value' } })).status === 200, 'origin secret: with it, fine');
  check((await fetch(s3.url + '/healthz')).status === 200, 'origin secret: the health check stays open');
  s3.kill();

  // ---- a big win holds withdrawals for review
  const s4 = await bootServer({ BIG_WIN_LAMPORTS: String(0.02 * SOL), ADMIN_TOKEN: ADMIN, BOT_SCORE_REVIEW: '2' });
  const c4 = apiClient(s4.url); const me4 = await c4.signIn(); await c4.api('/api/dev/faucet', { lamports: 1 * SOL });
  let won = null;
  for (let i = 0; i < 6 && !won; i++) { const r = await playRun(c4, 0, 0.01 * SOL, 'perfect', 'bw' + i); if (r.payoutLamports >= 0.02 * SOL) won = r; }
  check(won && won.hold === true, 'a big win puts a hold on the account: ' + JSON.stringify(won && [won.status, won.payoutLamports, won.hold]));
  const wb = await c4.api('/api/withdraw', { lamports: 0.05 * SOL });
  check(wb.status === 'review', 'with a hold, a withdrawal waits for review: ' + wb.status);
  const A4 = adminClient(s4.url, ADMIN);
  await A4(`/users/${me4.address}/release`, {});
  const wb2 = await c4.api('/api/withdraw', { lamports: 0.05 * SOL });
  check(wb2.status === 'sent', 'released: withdrawals go out again: ' + wb2.status);
  s4.kill();

  // ---- bot-like precision holds withdrawals; a strong human-like player doesn't
  const s5 = await bootServer({ ADMIN_TOKEN: ADMIN, BIG_WIN_LAMPORTS: String(1000 * SOL), BIG_WIN_X: '100000' });
  const bot = apiClient(s5.url), human = apiClient(s5.url);
  await bot.signIn(); await human.signIn();
  await bot.api('/api/dev/faucet', { lamports: 5 * SOL }); await human.api('/api/dev/faucet', { lamports: 5 * SOL });
  let botHeld = null;
  for (let i = 0; i < 6 && !botHeld; i++) { const r = await playRun(bot, 0, 0.001 * SOL, 'perfect', 'pb' + i); if (r.hold) botHeld = r; }
  const A5 = adminClient(s5.url, ADMIN);
  const holds = (await A5('/reviews')).reviews.filter((r) => r.kind === 'hold' && r.details.reason === 'tap precision');
  check(botHeld && holds.length === 1 && holds[0].details.score >= 0.8, 'a perfect bot is held for review after ~80 rings: ' + JSON.stringify(holds[0] && holds[0].details));
  let humanHeld = false, rings = 0;
  for (let i = 0; i < 12; i++) { const r = await playRun(human, 0, 0.001 * SOL, 'pro', 'ph' + i); if (r.hold) humanHeld = true; rings += (r.outcomes || []).length; }
  const hu = await A5(`/users/${(await human.api('/api/me')).address}`);
  check(!humanHeld && hu.user.bot.n >= 80 && hu.user.bot.score < 0.5, 'a strong human-like player is not held: ' + JSON.stringify(hu.user.bot));
  s5.kill();

  await stopAll();
  console.log(failed() ? `${failed()} check(s) failed` : 'security: all checks passed');
  process.exitCode = failed() ? 1 : 0;
})().catch(async (e) => { console.error(e); await stopAll(); process.exitCode = 1; });
