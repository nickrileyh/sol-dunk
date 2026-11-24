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
- **Pace** (v9): the ball gets 4% faster each level and the rings spread out 4% with it, so every level leaves the same time between rims (about 1.6 s on Pro). Deeper levels get harder through tighter, moving and tilted rings and bigger height changes, not through less time to react. The client's camera pulls back 3.5% a level so the next ring stays in view.
- **Ring heights** (v11): ring centres stay between y 220 and 500 (540 before), so even a bobbing ring's lowest point is 152 units above the floor instead of 112, leaving room to recover after the drop. The owner said some rings sat too low.
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

Engine v10 made the ball and rim tube 10% larger; rings widen only enough to keep the gap the ball fits through the same, so the difficulty is unchanged. Engine v11 keeps every ring at least 152 units above the floor; that barely changed difficulty (clear rates moved 0.14 points on average, 0.5 at most), and the tables were re-simulated and recalibrated for it.

Return to player when cashing out after checkpoint 1 / 2 / 3 / 8, from the simulation (no cap):

| Tier | Average | Good | Pro | Best possible win |
|---|---|---|---|---|
| Rookie | 90 / 81 / 72 / 14% | 96 / 96 / 97 / 97% | 99 / 103 / 111 / 300% | 7× |
| Pro | 90 / 78 / 65 / 5% | 98 / 97 / 97 / 97% | 101 / 107 / 119 / 752% | 90× |
| All-Star | 86 / 66 / 47 / 2% | 99 / 97 / 97 / 97% | 105 / 117 / 145 / 2761% | 250× (cap) |
| Legend | 80 / 55 / 35 / 1% | 99 / 97 / 97 / 97% | 110 / 134 / 189 / 7042% | 1000× (cap) |

Pros (the bot one step below perfect play) still beat the house deep into a run. `--cap-pro 0.99 --cap1-pro 1.01` keeps them behind at every checkpoint too, but because they clear the easy levels so reliably, the best possible win drops to about 1.7× on Rookie, 4.6× on Pro, 46× on All-Star and 600× on Legend. Head-to-head play with a rake is the usual way to take an edge from everyone without that.

Full tables for all six skill levels, including pro and perfect bots, are in `sim/out/calibration_final.txt`.

`node sim/calibrate.cjs --mode flat --write` gives exactly 90% for the average player at every checkpoint instead, but then a good player's return compounds into the hundreds of percent on deeper levels.

## Challenge pots

Alongside regular play, each UTC day has a challenge pot (`src/pots.cjs`, `server/server.mjs`):

- The challenge rotates daily, for example "Swish 10 in a row" on Pro or harder, or "Clear level 4" on All-Star or harder. They're picked so an average player makes it in roughly 4–15% of runs (a strong player in 25–50%), and no challenge comes up two days running.
- Players pay a fixed entry (0.05 SOL by default, `POT_ENTRY_LAMPORTS`), then play ordinary runs. A run counts if it started after they entered, on the challenge's tier or harder; the server judges it from the outcomes it replays, never from the client.
- At midnight UTC everyone who made it splits the pot equally. The house keeps 10% of every entry whoever wins, so the pot earns from every player, however skilled. If nobody makes it, the pot rolls over to the next day.
- API: `GET /api/pot` (works signed out), `POST /api/pot/enter`, and `/api/run/level` returns `pot` progress. `npm test` covers entry, the tier rule, completing once, the split, the rake and rollover.
- The demo runs the same pot with demo SOL. It has no other players, so it simulates the other entrants (from each challenge's simulated success rate by skill) and says so, and it has a "Close this pot now" button to see a payout. `python3 tools/pot_flow.py` plays it end to end.

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
