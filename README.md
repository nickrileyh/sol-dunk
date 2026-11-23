# SOL DUNK

**Play it:** https://nickrileyh.github.io/sol-dunk/ (demo SOL, runs in any browser). GitHub Pages serves `index.html` from the main branch; `npm run build` keeps it up to date.

A flap-through-the-rings skill game with SOL betting. Tap to flap a winged basketball down through floating rings. Clean drops (swishes) pay more than rim hits, and swish streaks pay more each time. Every 6 rings is a checkpoint where the player cashes out or keeps going into a harder level.

- `dist/index.html`: the whole game in one file, playing with demo SOL. Open it in any browser.
- `dist/index.server.html`: the same game wired to the real-SOL server (served at `/` by `server/`).

Amounts are shown as "SOL". To show the official SOL token icon beside them, download it from Solana's brand assets, save it as `src/sol-icon.svg` (or `.png`), and run `npm run build`; the build inlines it. The icon isn't bundled because it's Solana's trademark.

## Run it

```bash
npm run build                       # both HTML builds
cd server && npm install
npm run dev                         # mock chain: no RPC, /api/dev/faucet gives test SOL
npm test                            # end-to-end: 40 bot-played runs checked against local replay
```

### Devnet (real SOL, test network)

```bash
solana-keygen new -o house.json     # house wallet; fund it: solana airdrop 5 <address> --url devnet
export HOUSE_SECRET="$(cat house.json)" TOKEN_SECRET="$(openssl rand -hex 32)"
export NETWORK=devnet RPC_URL=https://api.devnet.solana.com
cd server && npm start              # serves the game on :8787
```

Open the server URL in the Phantom or Solflare in-app browser (or desktop with the extension). The player signs a one-time message, deposits with a normal SOL transfer to the house wallet (the server verifies it on-chain), plays, and withdraws from the house wallet.

## How a run is kept honest

- **Deterministic engine** (`src/engine.cjs`, v8): fixed 120 Hz physics, integer tap ticks, seeded PRNG, no implementation-dependent math. The same taps always give the same outcome in every browser and on the server.
- **Rim contact** (v7–v8): a firm knock bounces; gentle contact just rolls. Friction scales with how hard the hit was. After a knock the forward push fades back in over 0.45 s, so a back-rim hit clanks and drops (often in) instead of the ball ploughing on. The push is steady while the ball sits on a rim, so it can't balance on the edge. Rim effects fire once per knock.
- **Provably fair layouts**: before a run the server commits to `sha256(serverSeed)`. Each level's rings come from `HMAC-SHA256(serverSeed, clientSeed:nonce:level)`. The seed is revealed when the run ends, so anyone can check `GET /api/run/:id`.
- **Server replay**: the client sends its tap ticks at the end of each level. The server replays them, applies the paytable and the max-win cap, and only then pays. A level submitted faster than real time voids the run.

## The payout math

Each ring multiplies the pot: `rim` for a rim hit, `swish[n]` for the nth swish in a row (5+ caps). The swish streak carries across checkpoints. Tables live in `src/paytable.cjs` and are generated, not hand-tuned:

```bash
npm run sim          # ~1.6M simulated levels: 6 bot skill levels × 4 tiers × 8 levels (~11 min, 2 cores)
npm run calibrate    # solves the tables and writes src/paytable.cjs
npm run build
```

The bot (`src/bot.cjs`) plans each drop with a trajectory solve, then adds human-style error: tap jitter, aim error, misreading moving rings, and occasional lapses. "Average" passes about 98% of Pro level-1 rings and swishes about 74% of them.

**Calibration rule (house mode):** an average player who cashes out at the first checkpoint gets back 90% (10% house edge). Every later level keeps at least a 10% edge against the average player and is priced so a good player can gain at most 5% on it.

Return to player when cashing out after checkpoint 1 / 2 / 3, from the simulation (no cap):

| Tier | Average | Good |
|---|---|---|
| Rookie (max 50×) | 90 / 81 / 72% | 98 / 100 / 105% |
| Pro (max 100×) | 90 / 80 / 67% | 99 / 104 / 109% |
| All-Star (max 250×) | 90 / 72 / 52% | 106 / 111 / 117% |
| Legend (max 1000×) | 90 / 64 / 42% | 117 / 123 / 129% |

Full tables for all six skill levels, including pro and perfect bots, are in `sim/out/calibration_final.txt`.

`node sim/calibrate.cjs --mode flat --write` gives exactly 90% for the average player at every checkpoint instead, but then a good player's return compounds into the hundreds of percent on deeper levels.

## Before real money

1. **Skill and bots.** In a skill game the edge only holds against players at or below the reference player. Good players profit, and a bot that plays perfectly hits the max win on almost every run. The server already limits bets for accounts above 115% return after 150 runs, and for superhuman swish rates. Add tap-timing anomaly checks and manual review of large wins before launch.
2. **Licensing.** Real-money skill gaming and crypto gambling are regulated, or banned, in many places. You need geo-blocking, age and KYC checks, and a license where it's required.
3. **Production hardening.** Move from the JSON file DB to Postgres. Use HTTPS, rate limits and a hot/cold wallet split, and get a security review of the deposit and withdraw paths.

## Files

```
src/engine.cjs     physics, levels, replay, payout helpers (shared by client, sim, server)
src/paytable.cjs   generated multiplier tables + average-player stats
src/bot.cjs        human-like autopilot (simulation + lobby demo)
src/game.js        browser client: rendering, audio, input, betting flow, wallet
src/index.html, src/style.css
build.cjs          inlines everything into dist/*.html
sim/               Monte Carlo runner, calibrator, quick stats
server/            Express API, Solana deposits/withdrawals, replay verification, tests
tools/             browser checks (Playwright + Chrome): flows.py plays every run outcome,
                   contact.py freezes rim contacts, audit.py screenshots every screen (to ./shots);
                   sync_check.cjs (npm run check) checks every copy is the same build
```

## Working on it

This repository is the source of truth for SOL DUNK. Start any new session from a fresh clone, and push when you're done, so every chat builds on the latest version.

- Any change to `src/engine.cjs` (physics) needs `npm run sim` then `node sim/calibrate.cjs patterns.json --guard1 9 --guard 1.05 --write`, or the paytable no longer matches the game.
- After a change, run `npm run build`, `npm test` and `python3 tools/flows.py` before publishing.
- `npm run check` confirms that `dist/` and the root `index.html` are the build of `src/` and that everything is pushed. Pass it a saved copy of the live demo (`npm run check -- live.html`) to check that too. CLAUDE.md lists the steps that keep the repo, GitHub Pages and the demo in sync.
