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

- **Deterministic engine** (`src/engine.cjs`, v11): fixed 120 Hz physics, integer tap ticks, seeded PRNG, no implementation-dependent math. The same taps always give the same outcome in every browser and on the server.
- **Rim contact** (v7–v8): a firm knock bounces; gentle contact just rolls. Friction scales with how hard the hit was. After a knock the forward push fades back in over 0.45 s, so a back-rim hit clanks and drops (often in) instead of the ball ploughing on. The push is steady while the ball sits on a rim, so it can't balance on the edge. Rim effects fire once per knock.
- **Fair rims** (v11): once the ball has touched a ring, while its centre is over the opening (and less than 100 units above it), the rim soaks up its forward speed (it fades at 5/s) and the forward push waits, so a ball that lands mostly inside drops in instead of rolling on over the back rim. Measured on Pro level 1, a ball whose centre lands 8 or more units inside the end of the rim now rims out about 1% of the time (it was 11–41%); within 4 units of the end about 30% (was 95%); on or past the end it still bounces out. Rim-outs now come from drops that are visibly late.
- **Pace** (v9): the ball gets 4% faster each level and the rings spread out 4% with it, so every level leaves the same time between rims (about 1.4 s on Pro since v11). Deeper levels get harder through tighter, moving and tilted rings and bigger height changes, not through less time to react. The client's camera pulls back 3.5% a level so the next ring stays in view.
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

**Calibration rule (edge mode):** the house keeps an edge at every checkpoint against average and good players. An average player who cashes out at the first checkpoint gets back at most 90% (10% house edge), and every later level keeps at least a 10% edge against them. A good player gets back at most 99% at the first checkpoint and 97% at any later one, so strong players can't profit by going deep. Rounding the tables to three decimals never pays over a cap. On All-Star and Legend the good-player cap binds at the first checkpoint, so the average player gets back less there.

Engine v10 made the ball and rim tube 10% larger; rings widen only enough to keep the gap the ball fits through the same, so the difficulty is unchanged.

Engine v11 made rims fair (see above). That makes rim hits drop in more often, so the ball is 20% faster and the rings 5% further apart (about 12% less time between rims) to keep the clear rates, and the house edge, where they were. The bot's aim error grows with ball speed, not with how long it has between rings.

Return to player when cashing out after checkpoint 1 / 2 / 3 / 8, from the simulation (no cap):

| Tier | Average | Good | Pro | Best possible win |
|---|---|---|---|---|
| Rookie | 90 / 81 / 72 / 16% | 97 / 97 / 97 / 97% | 101 / 105 / 111 / 254% | 9× |
| Pro | 90 / 80 / 68 / 7% | 97 / 97 / 97 / 97% | 100 / 106 / 115 / 530% | 74× |
| All-Star | 90 / 75 / 59 / 3% | 99 / 97 / 97 / 97% | 103 / 110 / 126 / 1087% | 250× (cap) |
| Legend | 86 / 65 / 45 / 1% | 99 / 97 / 97 / 97% | 105 / 119 / 145 / 2576% | 1000× (cap) |

Pros (the bot one step below perfect play) still beat the house deep into a run. `--cap-pro 0.99 --cap1-pro 1.01` keeps them behind at every checkpoint too, but because they clear the easy levels so reliably, the best possible win drops to about 1.9× on Rookie, 4.9× on Pro, 19× on All-Star and 93× on Legend (engine v11). Head-to-head play with a rake is the usual way to take an edge from everyone without that.

Full tables for all six skill levels, including pro and perfect bots, are in `sim/out/calibration_final.txt`.

`node sim/calibrate.cjs --mode flat --write` gives exactly 90% for the average player at every checkpoint instead, but then a good player's return compounds into the hundreds of percent on deeper levels.

## Before real money

1. **Skill and bots.** The tables keep an edge against average and good players at every checkpoint, but elite players (the `pro` bot) still profit deep in a run, and a bot that plays perfectly hits the max win on almost every run. The server already limits bets for accounts above 115% return after 150 runs, and for superhuman swish rates. Add tap-timing anomaly checks and manual review of large wins before launch.
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
                   contact.py freezes rim contacts, audit.py screenshots every screen (to ./shots),
                   speed.py plays deep into a tier and reports how much of the next ring is in view,
                   clip.py records exact 60 fps frames of a run (contact sheet + mp4), e.g. to
                   review the flame; sync_check.cjs (npm run check) checks every copy is the same build
```

## Working on it

This repository is the source of truth for SOL DUNK. Start any new session from a fresh clone, and push when you're done, so every chat builds on the latest version.

- Any change to `src/engine.cjs` (physics) needs `npm run sim` then `npm run calibrate` (`node sim/calibrate.cjs patterns.json --mode edge --write`), or the paytable no longer matches the game.
- After a change, run `npm run build`, `npm test` and `python3 tools/flows.py` before publishing.
- `npm run check` confirms that `dist/` and the root `index.html` are the build of `src/` and that everything is pushed. Pass it a saved copy of the live demo (`npm run check -- live.html`) to check that too. CLAUDE.md lists the steps that keep the repo, GitHub Pages and the demo in sync.
