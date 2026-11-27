// Server configuration from the environment, with the checks that keep a real-money server from starting unsafely.
//
// Every setting is listed in deploy/.env.example. Amounts are in lamports (1 SOL = 1,000,000,000 lamports).
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const POTS = require('../../src/pots.cjs');
const MS = require('../../src/missions.cjs');
const SP = require('../../src/special.cjs');
const DU = require('../../src/duel.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));

export const LAMPORTS = 1_000_000_000;
const NETWORKS = ['mainnet-beta', 'devnet', 'testnet', 'localnet'];

export function loadConfig(env = process.env) {
  const num = (k, d) => {
    const v = env[k];
    if (v === undefined || v === '') return d;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${k} must be a number (got "${v}")`);
    return n;
  };
  const list = (k) => String(env[k] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const mock = env.MOCK_CHAIN === '1';
  const network = env.NETWORK || 'devnet';
  const mainnet = network === 'mainnet-beta';
  const sol = (x) => Math.round(x * LAMPORTS);
  const specialEntry = num('SPECIAL_ENTRY_LAMPORTS', sol(SP.ENTRY));
  // the stakes a player can pick: the rules' list up to the cap (the default stake always among them)
  const stakes = (all, top, dflt) => [...new Set([...all.map(sol).filter((x) => x <= top), dflt])].sort((a, b) => a - b);
  const specialMaxStake = num('SPECIAL_MAX_STAKE_LAMPORTS', sol(SP.MAX_STAKE));
  const duelEntry = num('DUEL_ENTRY_LAMPORTS', sol(DU.ENTRY));
  const duelMaxStake = num('DUEL_MAX_STAKE_LAMPORTS', sol(DU.MAX_STAKE));
  const publicUrl = (env.PUBLIC_URL || '').replace(/\/$/, '');

  const CFG = {
    port: num('PORT', 8787),
    network, mainnet, mock,
    rpc: env.RPC_URL || (network === 'localnet' ? 'http://127.0.0.1:8899' : `https://api.${network}.solana.com`),
    databaseUrl: env.DATABASE_URL || '',
    dataDir: env.DATA_DIR || path.join(here, '..', 'data'),
    publicUrl,
    domain: publicUrl ? new URL(publicUrl).host : (env.SIGNIN_DOMAIN || 'localhost'),
    trustProxy: env.TRUST_PROXY === undefined || env.TRUST_PROXY === '' ? 0 : (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY === 'true'),
    tokenSecret: env.TOKEN_SECRET || '',
    tokenDays: num('TOKEN_DAYS', 7),
    adminToken: env.ADMIN_TOKEN || '',
    adminIps: list('ADMIN_IPS'),
    originSecret: env.ORIGIN_SECRET || '',

    // wallets: the hot wallet signs withdrawals; the cold (ideally multisig) address only ever receives sweeps
    houseSecret: env.HOUSE_SECRET || '',
    houseKeyFile: env.HOUSE_KEY_FILE || '',
    coldAddress: env.COLD_ADDRESS || '',
    reserveAddresses: list('RESERVE_ADDRESSES'),   // other house addresses counted in the bankroll (defaults to the cold one)
    hotMin: num('HOT_MIN_LAMPORTS', sol(2)),         // alert below this
    hotTarget: num('HOT_TARGET_LAMPORTS', sol(5)),   // a sweep leaves this much
    hotMax: num('HOT_MAX_LAMPORTS', sol(10)),        // sweep the excess above this to the cold address
    priorityFee: num('PRIORITY_FEE_MICROLAMPORTS', mainnet ? 20_000 : 0), // compute-unit price for house transactions

    // bets and the bankroll
    minBet: num('MIN_BET_LAMPORTS', 1_000_000),
    maxBet: num('MAX_BET_LAMPORTS', 1_000_000_000),
    maxPayout: num('MAX_PAYOUT_LAMPORTS', 50_000_000_000),
    riskFraction: num('RISK_FRACTION', 0.05),        // one bet's biggest possible win may use at most this share of the free bankroll
    mockReserve: num('MOCK_RESERVE_LAMPORTS', 1_000_000 * LAMPORTS),

    // deposits
    minDeposit: num('MIN_DEPOSIT_LAMPORTS', 10_000_000),
    depositCommitment: env.DEPOSIT_COMMITMENT || (mainnet ? 'finalized' : 'confirmed'),
    depositDayLimit: num('DEPOSIT_DAY_LIMIT_LAMPORTS', 0),     // per player per UTC day, 0 = none
    depositWaitMs: num('DEPOSIT_WAIT_MS', 45_000),
    watchDeposits: env.WATCH_DEPOSITS !== '0',

    // withdrawals
    minWithdraw: num('MIN_WITHDRAW_LAMPORTS', 10_000_000),
    withdrawReview: num('WITHDRAW_REVIEW_LAMPORTS', 20_000_000_000), // one withdrawal this big waits for review
    withdrawDayUser: num('WITHDRAW_DAY_USER_LAMPORTS', 0),     // a player's automatic withdrawals per UTC day; more waits for review (0 = none)
    withdrawDayTotal: num('WITHDRAW_DAY_TOTAL_LAMPORTS', 0),   // everyone's automatic withdrawals per UTC day: a circuit breaker (0 = none)
    withdrawWaitMs: num('WITHDRAW_WAIT_MS', 15_000),
    withdrawCommitment: env.WITHDRAW_COMMITMENT || (mainnet ? 'finalized' : 'confirmed'), // when a withdrawal counts as sent
    resendGapMs: num('RESEND_GAP_MS', 8000),                   // two looks this far apart must both find an expired transfer gone before it is signed again
    kycWithdraw: num('KYC_WITHDRAW_LAMPORTS', 0),              // lifetime withdrawals above this need a verified identity (0 = off)

    // abuse
    minRealtime: num('MIN_REALTIME', 0.9),
    sharpRtp: num('SHARP_RTP', 1.15),
    sharpMinRuns: num('SHARP_MIN_RUNS', 150),
    bigWin: num('BIG_WIN_LAMPORTS', 5 * LAMPORTS),             // a payout this big holds withdrawals until reviewed
    bigWinX: num('BIG_WIN_X', 200),                            // ... or a run that reaches this multiplier
    bigWinXMin: num('BIG_WIN_X_MIN_LAMPORTS', sol(0.5)),       // ... when it pays at least this
    botReview: num('BOT_SCORE_REVIEW', 0.8),                   // tap-timing score (0-1) that holds withdrawals for review

    // access
    access: env.ACCESS || 'open',                              // open | allowlist (closed beta)
    allowlist: list('ALLOWLIST'),
    blockedCountries: list('BLOCKED_COUNTRIES').map((c) => c.toUpperCase()),
    geoHeader: (env.GEO_HEADER || 'cf-ipcountry').toLowerCase(),
    geoRequired: env.GEO_REQUIRED === '1',
    rateLimit: env.RATE_LIMIT !== '0',
    csp: env.CSP || 'on',                                      // on | report-only | off

    // monitoring
    alertWebhook: env.ALERT_WEBHOOK_URL || '',
    sentryDsn: env.SENTRY_DSN || '',
    logLevel: env.LOG_LEVEL || 'info',

    // game
    potEntry: num('POT_ENTRY_LAMPORTS', sol(POTS.ENTRY)),
    potTheme: mock ? env.POT_THEME || '' : '',             // tests only: force the pot's theme
    specialEntry,                                         // the stake a special starts at (and the only one before stakes)
    specialStakes: stakes(SP.STAKES, specialMaxStake, specialEntry), // each keeps its own level per prize (src/special.cjs)
    specialUnlock: num('SPECIAL_UNLOCK_LAMPORTS', Math.round(SP.UNLOCK * specialEntry)),
    specialRecipe: mock ? env.SPECIAL_RECIPE || '' : '',   // tests only: force every slot's twist
    duelEntry,                                            // the stake a duel starts at
    duelStakes: stakes(DU.STAKES, duelMaxStake, duelEntry), // both players stake the same: a mark is raced at its stake
    duelWaitMs: num('DUEL_WAIT_MS', DU.WAIT_MS),           // a mark nobody takes on is refunded after this long
    specialDayTries: num('SPECIAL_DAY_TRIES', 0),          // attempts at each special per player per day (0 = no limit)
    missionNeed: { day: num('MISSION_DAY_LAMPORTS', sol(MS.NEED.day)), week: num('MISSION_WEEK_LAMPORTS', sol(MS.NEED.week)) },
    checkpointTimeoutMs: num('CHECKPOINT_TIMEOUT_MS', 10 * 60 * 1000),
    playingTimeoutMs: num('PLAYING_TIMEOUT_MS', 3 * 60 * 1000),
    devEndpoints: mock || env.DEV_ENDPOINTS === '1'
  };

  // ---- checks
  const errors = [], warnings = [];
  if (!NETWORKS.includes(network)) errors.push(`NETWORK must be one of ${NETWORKS.join(', ')}`);
  if (!['open', 'allowlist'].includes(CFG.access)) errors.push('ACCESS must be open or allowlist');
  if (!['on', 'report-only', 'off'].includes(CFG.csp)) errors.push('CSP must be on, report-only or off');
  if (!['confirmed', 'finalized'].includes(CFG.depositCommitment)) errors.push('DEPOSIT_COMMITMENT must be confirmed or finalized');
  if (!['confirmed', 'finalized'].includes(CFG.withdrawCommitment)) errors.push('WITHDRAW_COMMITMENT must be confirmed or finalized');
  if (!(CFG.riskFraction > 0 && CFG.riskFraction <= 1)) errors.push('RISK_FRACTION must be between 0 and 1');
  if (!(CFG.minBet > 0 && CFG.minBet <= CFG.maxBet)) errors.push('MIN_BET_LAMPORTS must be above 0 and at most MAX_BET_LAMPORTS');
  if (!(CFG.hotMin <= CFG.hotTarget && CFG.hotTarget <= CFG.hotMax)) errors.push('Need HOT_MIN_LAMPORTS <= HOT_TARGET_LAMPORTS <= HOT_MAX_LAMPORTS');
  if (CFG.minWithdraw < 1_000_000) errors.push('MIN_WITHDRAW_LAMPORTS must be at least 0.001 SOL (a smaller transfer to an empty wallet fails rent checks)');
  if (CFG.adminToken && CFG.adminToken.length < 32) errors.push('ADMIN_TOKEN must be at least 32 characters');
  if (CFG.tokenSecret && CFG.tokenSecret.length < 32) errors.push('TOKEN_SECRET must be at least 32 characters');
  if (mainnet) {
    // a real-money server: refuse anything that would be unsafe with real SOL
    if (mock) errors.push('MOCK_CHAIN can\'t be used on mainnet');
    if (env.DEV_ENDPOINTS === '1') errors.push('DEV_ENDPOINTS can\'t be used on mainnet');
    if (!CFG.databaseUrl) errors.push('DATABASE_URL is required on mainnet');
    if (!CFG.tokenSecret) errors.push('TOKEN_SECRET is required on mainnet (at least 32 random characters)');
    if (!CFG.adminToken) errors.push('ADMIN_TOKEN is required on mainnet (at least 32 random characters)');
    if (!CFG.houseSecret && !CFG.houseKeyFile) errors.push('HOUSE_SECRET or HOUSE_KEY_FILE is required on mainnet (the server never makes a mainnet key itself)');
    if (!CFG.coldAddress) errors.push('COLD_ADDRESS is required on mainnet (sweeps from the hot wallet go there; use a multisig vault)');
    if (!/^https:\/\//.test(publicUrl)) errors.push('PUBLIC_URL must be the https:// address players use');
    if (CFG.minRealtime < 0.8) errors.push('MIN_REALTIME can\'t be below 0.8 on mainnet');
    if (env.BLOCKED_COUNTRIES === undefined) errors.push('Set BLOCKED_COUNTRIES on mainnet: the country codes to refuse (or "none" to block none, after legal advice)');
    if (!env.RPC_URL) errors.push('RPC_URL is required on mainnet (a dedicated RPC provider; the public endpoint is rate-limited)');
    if (CFG.depositCommitment !== 'finalized') warnings.push('DEPOSIT_COMMITMENT=confirmed credits deposits before they are final');
    if (!CFG.trustProxy) warnings.push('TRUST_PROXY is not set: behind a proxy every player shares one address, so the rate limits count them together (set it to the number of proxies in front, 1 for the bundled Caddy)');
    if (!CFG.alertWebhook) warnings.push('ALERT_WEBHOOK_URL is not set: nobody will hear about held withdrawals, a low hot wallet or big wins');
    if (!CFG.originSecret) warnings.push('ORIGIN_SECRET is not set: make sure only your proxy can reach the server, or the country header can be faked');
    if (!CFG.withdrawDayTotal) warnings.push('WITHDRAW_DAY_TOTAL_LAMPORTS is not set: there is no daily circuit breaker on automatic withdrawals');
  }
  if (CFG.blockedCountries.length === 1 && CFG.blockedCountries[0] === 'NONE') CFG.blockedCountries = [];
  if (!CFG.reserveAddresses.length && CFG.coldAddress) CFG.reserveAddresses = [CFG.coldAddress];
  return { CFG: Object.freeze(CFG), errors, warnings };
}
