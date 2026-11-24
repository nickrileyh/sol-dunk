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

- **Deterministic engine** (`src/engine.cjs`, v13): fixed 120 Hz physics, integer tap ticks, seeded PRNG, no implementation-dependent math. The same taps always give the same outcome in every browser and on the server.
- **Rim contact** (v7–v8): a firm knock bounces; gentle contact just rolls. Friction scales with how hard the hit was. After a knock the forward push fades back in over 0.45 s, so a back-rim hit clanks and drops (often in) instead of the ball ploughing on. The push is steady while the ball sits on a rim, so it can't balance on the edge. Rim effects fire once per knock.
- **Fair rims** (v12): once the ball has touched a ring, while its centre is over the opening (and less than 100 units above it), the rim soaks up its forward speed (it fades at 5/s) and the forward push waits, so a ball that lands mostly inside drops in instead of rolling on over the back rim. Measured on Pro level 1, a ball whose centre lands 8 or more units inside the end of the rim now rims out about 1% of the time (it was 11–41%); within 4 units of the end about 60% (was 95%); on or past the end it still bounces out. Rim-outs now come from drops that are visibly late.
- **Pace** (v9, v13): rings are spaced 1:1 with the ball's speed. The ball gets 4% faster each level and the rings, the first one included, spread out 4% with it, so every level leaves the same time between rims (about 1.6 s on Pro). Deeper levels get harder through tighter, moving and tilted rings and bigger height changes, not through less time to react. The client's camera pulls back 3.5% a level and keeps the ball about 16% in from the left, so most of the next ring is already on screen as you pass one.
- **Ring heights** (v11): ring centres stay between y 220 and 500 (540 before), so even a bobbing ring's lowest point is 152 units above the floor instead of 112, leaving room to recover after the drop. The owner said some rings sat too low.
- **Provably fair layouts**: before a run the server commits to `sha256(serverSeed)`. Each level's rings come from `HMAC-SHA256(serverSeed, clientSeed:nonce:level)`. The seed is revealed when the run ends, so anyone can check `GET /api/run/:id`.
- **Server replay**: the client sends its tap ticks at the end of each level. The server replays them, applies the paytable and the max-win cap, and only then pays. A level submitted faster than real time voids the run.

## The payout math

Each ring multiplies the pot: `rim` for a rim hit, `swish[n]` for the nth swish in a row (5+ caps). The swish streak carries across checkpoints. The in-game Odds & fairness page shows each level's rim, swish and 5+ streak multipliers and the **total** a run has once it clears that level, from every ring a rim hit to every ring a swish (capped at the tier's best possible win). Tables live in `src/paytable.cjs` and are generated, not hand-tuned:

```bash
npm run sim          # ~1.6M simulated levels: 6 bot skill levels × 4 tiers × 8 levels (~11 min, 2 cores)
npm run calibrate    # solves the tables and writes src/paytable.cjs
npm run build
```

The bot (`src/bot.cjs`) plans each drop with a trajectory solve, then adds human-style error: tap jitter, aim error, misreading moving rings, and occasional lapses. "Average" passes about 98% of Pro level-1 rings and swishes about 65% of them.

**Calibration rule (edge mode):** the house keeps an edge at every checkpoint against average and good players. An average player who cashes out at the first checkpoint gets back at most 90% (10% house edge), and every later level keeps at least a 10% edge against them. A good player gets back at most 99% at the first checkpoint and 97% at any later one, so strong players can't profit by going deep. Rounding the tables to three decimals never pays over a cap. On All-Star and Legend the good-player cap binds at the first checkpoint, so the average player gets back 87% and 83% there.

Engine v10 made the ball and rim tube 10% larger; rings widen only enough to keep the gap the ball fits through the same, so the difficulty is unchanged. Engine v11 keeps every ring at least 152 units above the floor; that barely changed difficulty (clear rates moved 0.14 points on average, 0.5 at most), and the tables were re-simulated and recalibrated for it.

Engine v12 made rims fair (see above). That makes rim hits drop in more often, so the ball is 20% faster and the rings 5% further apart (about 12% less time between rims) to keep the clear rates, and the house edge, where they were. The bot's aim error grows with ball speed, not with how long it has between rings.

Engine v13 spaces the rings 1:1 with that faster ball (the owner asked for it): the rings and the first ring are 20% further apart than in v10, as the ball is 20% faster, so there is as much time between rims as before v12 (1.6 s on Pro, 1.4 s on v12). Clearing got a little easier and swishes a little rarer, so the tables were re-simulated, and Rookie's rings are 1 unit narrower and bob a little more early on, so its first checkpoint still keeps the 10% edge.

Return to player when cashing out after checkpoint 1 / 2 / 3 / 8, from the simulation (no cap):

| Tier | Average | Good | Pro | Best possible win |
|---|---|---|---|---|
| Rookie | 90 / 81 / 73 / 16% | 96 / 95 / 97 / 97% | 99 / 102 / 110 / 260% | 8× |
| Pro | 90 / 80 / 68 / 6% | 97 / 97 / 97 / 97% | 100 / 105 / 115 / 547% | 80× |
| All-Star | 87 / 70 / 52 / 2% | 99 / 97 / 97 / 97% | 104 / 112 / 132 / 1477% | 250× (cap) |
| Legend | 83 / 60 / 41 / 1% | 99 / 97 / 97 / 97% | 108 / 123 / 157 / 3084% | 1000× (cap) |

Pros (the bot one step below perfect play) still beat the house deep into a run. `--cap-pro 0.99 --cap1-pro 1.01` keeps them behind at every checkpoint too, but because they clear the easy levels so reliably, the best possible win drops to about 1.7× on Rookie, 4.5× on Pro, 34× on All-Star and 210× on Legend (engine v13). Head-to-head play with a rake is the usual way to take an edge from everyone without that.

Full tables for all six skill levels, including pro and perfect bots, are in `sim/out/calibration_final.txt`.

`node sim/calibrate.cjs --mode flat --write` gives exactly 90% for the average player at every checkpoint instead, but then a good player's return compounds into the hundreds of percent on deeper levels.

## Challenge pots

Alongside regular play, each UTC day has a challenge pot (`src/pots.cjs`, `server/server.mjs`):

- The challenge rotates daily, for example "Swish 8 in a row" on Pro or harder, or "Clear level 5" on All-Star or harder. They're picked so an average player makes it in roughly 4–15% of runs (a strong player in 25–50%), and no challenge comes up two days running. `node sim/pots.cjs` measures each challenge's chance per run by skill; re-run it after any physics change and copy the numbers into the challenge's `p`.
- Players pay a fixed entry (0.05 SOL by default, `POT_ENTRY_LAMPORTS`), then play ordinary runs. A run counts if it started after they entered, on the challenge's tier or harder; the server judges it from the outcomes it replays, never from the client.
- At midnight UTC everyone who made it splits the pot equally. The house keeps 10% of every entry whoever wins, so the pot earns from every player, however skilled. If nobody makes it, the pot rolls over to the next day.
- API: `GET /api/pot` (works signed out), `POST /api/pot/enter`, and `/api/run/level` returns `pot` progress. `npm test` covers entry, the tier rule, completing once, the split, the rake and rollover.
- The demo runs the same pot with demo SOL. It has no other players, so it simulates the other entrants (from each challenge's simulated success rate by skill) and says so, and it has a "Close this pot now" button to see a payout. `python3 tools/pot_flow.py` plays it end to end.
- The pot has its own page: its card on the **Challenges** tab (the goal, the pot and an Enter button) opens it.

## The special level

One special level a day (UTC), the same for everyone (`src/special.cjs`): a long level with a twist. Seven recipes take turns: The gauntlet (every ring moves), Tilt alley (every rim leans, left then right), Zigzag (high ring, low ring), Needle (tight rims, nothing moves), Marathon (18 rings), The wave (rings ride a rolling line) and Express (a quicker ball, rings spread to match). They're built like normal levels (same physics, ring band and climb budget), with 14 to 18 rings and the last one gold.

- The player pays a fixed entry (0.05 SOL, `SPECIAL_ENTRY_LAMPORTS`) and gets a fresh course from its own provably fair seed, `HMAC-SHA256(serverSeed, clientSeed:nonce:special)`, so nobody can learn a course by heart. Clearing every ring pays the prize; missing one loses the entry. The server replays the taps before it pays.
- Prizes come from the simulator: `node sim/special.cjs --write` (`npm run special`, about 5 min) plays 20,000 attempts per recipe and skill and sets each prize (to the 0.05× below) so a good player gets back at most 97% even at the top of the clear rate's 97.5% confidence interval. Re-run it whenever the physics, the bot or a recipe changes.

| Recipe | Rings | Clear rate: casual / average / good / pro | Prize | Return: average / good / pro |
|---|---|---|---|---|
| The gauntlet | 14 | 2.7 / 9.8 / 31.5 / 63.6% | 3.00× | 29 / 95 / 191% |
| Tilt alley | 16 | 1.8 / 7.3 / 29.8 / 64.9% | 3.15× | 23 / 94 / 205% |
| Zigzag | 15 | 6.8 / 17.6 / 44.7 / 73.2% | 2.10× | 37 / 94 / 154% |
| Needle | 18 | 3.3 / 11.5 / 36.3 / 71.0% | 2.60× | 30 / 94 / 185% |
| Marathon | 18 | 2.8 / 9.7 / 34.0 / 66.0% | 2.75× | 27 / 93 / 182% |
| The wave | 17 | 1.9 / 8.5 / 31.6 / 64.7% | 3.00× | 25 / 95 / 194% |
| Express | 14 | 2.6 / 8.5 / 28.7 / 60.3% | 3.30× | 28 / 95 / 199% |

- A fixed prize can't keep an edge against players who are better than "good": pros come out well ahead, as they do deep in regular runs. The server keeps accounts it has limited for beating the house (over 115% return after 150 runs, or a superhuman swish rate) out of the special level.
- The special doesn't count toward missions or the pot, but its entry counts as play for mission SOL. Its card on the **Challenges** tab (name, prize and a Play button) opens its page, with the clear rates above shown as "about 1 in N" per skill.
- API: `GET /api/special` (works signed out), `POST /api/special/start`, `POST /api/special/finish`. `npm test` covers the entry, the prize, refusals and the provably fair seed. `python3 tools/special_flow.py` plays it in the demo.

## Missions that pay SOL

Three daily missions and three weekly ones (`src/missions.cjs`), the same for everyone that UTC day or week (weeks start Monday 00:00 UTC). Every run counts, whatever the bet, and the server judges progress from the levels it replays.

- Each pays XP, as before, and SOL. A window's SOL pays once the player has played its need in that window: 2 SOL a day, 10 SOL a week by default (`MISSION_DAY_LAMPORTS`, `MISSION_WEEK_LAMPORTS`), counting run bets and special level entries. Rewards earned before then wait, and are paid the moment a bet reaches the need; anything not collected when the window ends is gone.
- Rewards: 0.001 / 0.002 / 0.003 SOL for the easy, medium and hard daily mission, 0.004 / 0.006 / 0.01 SOL weekly. They scale with the need: 0.3% of a day's need and 0.2% of a week's, at most 0.5% of everything played in a week. That's half the house's smallest edge against a good player (All-Star and Legend pay a good player back 99% at checkpoint 1), so a good player who plays just enough to collect still loses about 0.5% on average, however they bet. Bigger rewards need a bigger need, or they hand good players the edge.
- API: `GET /api/missions`; `/api/run/start`, `/api/special/start`, `/api/run/level` (when a run ends) and `/api/run/cashout` return `missions` with what was done and paid. `npm test` checks the server's progress against a local replay and the ledger with rewards; `python3 tools/missions_flow.py` plays it in the demo.

## Around the game

None of this changes bets, ring layouts, physics or payouts; it lives in the client (`src/game.js`) and the player's browser (mission SOL is above).

- **Navigation:** laid out like an iOS app: black pages with large titles, and a tab bar docked to the bottom with three tabs. **Play** shows the live arena in a rounded window, then the tier (with an Odds link), the bet (a stepper that walks 0.001 to 100 SOL in 1-2-5 steps, or type any amount) and one Play button; the balance sits at the end of the title. **Challenges** is one short page: a card for today's special and one for the daily pot (name, prize, one button; the details are on their pages), then the daily missions, with This week and Career a tap away. **Profile** is the player card (with the level), then short lists: Locker, Trophies, Stats; Wallet, Settings; How to play, Odds & fairness. The **Locker** opens from Profile with a back button and shows the arena in its own window above the collection, so whatever you pick, or tap to try on before you've unlocked it, flies there at once. Pausing a run shows a card with Resume and the sound and vibration switches.
- **One home for everything:** between runs the top bar is the balance (opens the Wallet); during a run it holds pause, the multiplier and mute. Pages push in over the current tab with a back button that names it: today's special, the daily pot, This week, Career, Trophies, Stats (with the recent runs), Wallet, Settings (Sound, Vibration), How to play and Odds & fairness; tapping the tab again also goes back. Sheets rise from the bottom only for a task you finish there: editing the player card. A dot on Challenges marks a special you haven't seen or missions finished since you last looked, and one on Profile (and its Locker row) new items.
- **Style rules:** an orange button starts or spends a run (Play, Play again, Resume, the special's Play, the pot's Enter); green only takes money back (Cash out, Deposit); every other button is the grey iOS fill. Labels and callouts are in sentence case, numbers are bold at most, and display amounts drop trailing zeros (0.13 SOL). A checkpoint or cash-out at 1.00× reads "your bet back", never a green +0.
- **Missions**: 3 daily missions and 3 weekly ones that also pay SOL (above), and a career of 6 chapters with 4 missions each that you play at your own pace, for XP. Each chapter ends in an item you can only get there.
- **Locker:** six kinds of item, 56 in all, each marked common, rare, epic or legendary: 18 balls, 10 wings (feather, bat, butterfly and mech shapes), 9 flames, 7 trails, 6 rim colours and 6 courts (Arena, Street, Rooftop, Beach, Neon, Orbit). Items unlock with levels, trophies or career chapters. A court is one backdrop for every level; rim colours change the ordinary rings only, so the checkpoint ring stays gold and a missed one grey.
- **Player card:** a name, an emblem, a colour and a title (titles come from trophies, levels and the career).

## Before real money

1. **Skill and bots.** The tables keep an edge against average and good players at every checkpoint, but elite players (the `pro` bot) still profit deep in a run, and a bot that plays perfectly hits the max win on almost every run. The server already limits bets for accounts above 115% return after 150 runs, and for superhuman swish rates. Add tap-timing anomaly checks and manual review of large wins before launch.
2. **Licensing.** Real-money skill gaming and crypto gambling are regulated, or banned, in many places. You need geo-blocking, age and KYC checks, and a license where it's required.
3. **Production hardening.** Move from the JSON file DB to Postgres. Use HTTPS, rate limits and a hot/cold wallet split, and get a security review of the deposit and withdraw paths.

## Files

```
src/engine.cjs     physics, levels, replay, payout helpers (shared by client, sim, server)
src/paytable.cjs   generated multiplier tables + average-player stats
src/bot.cjs        human-like autopilot (simulation + lobby demo)
src/pots.cjs       challenge pot rules (shared by client, server, demo)
src/missions.cjs   daily and weekly missions, their SOL and what unlocks it (shared by client and server)
src/special.cjs    the special level: recipes, generator, daily rotation, prizes (shared by client, server, sim)
src/game.js        browser client: rendering, audio, input, betting flow, wallet
src/index.html, src/style.css
build.cjs          inlines everything into dist/*.html
sim/               Monte Carlo runner, calibrator, quick stats; special.cjs prices the special level,
                   pots.cjs measures the pot challenges
server/            Express API, Solana deposits/withdrawals, replay verification, tests
tools/             browser checks (Playwright + Chrome): flows.py plays every run outcome,
                   contact.py freezes rim contacts, audit.py screenshots every screen (to ./shots),
                   ui.py checks the tabs, the pages and their back button, the locker, missions,
                   the player card, the settings and the pause card,
                   special_flow.py plays the special level, missions_flow.py mission SOL, pot_flow.py the pot,
                   speed.py plays deep into a tier and reports how much of the next ring is in view,
                   clip.py records exact 60 fps frames of a run (contact sheet + mp4), e.g. to
                   review the flame; sync_check.cjs (npm run check) checks every copy is the same build
```

## Working on it

This repository is the source of truth for SOL DUNK. Start any new session from a fresh clone, and push when you're done, so every chat builds on the latest version.

- Any change to `src/engine.cjs` (physics) needs `npm run sim` then `npm run calibrate` (`node sim/calibrate.cjs patterns.json --mode edge --write`), or the paytable no longer matches the game, and `npm run special` to re-price the special level, and `node sim/pots.cjs` to re-measure the pot challenges.
- After a change, run `npm run build`, `npm test` and `python3 tools/flows.py` before publishing.
- `npm run check` confirms that `dist/` and the root `index.html` are the build of `src/` and that everything is pushed. Pass it a saved copy of the live demo (`npm run check -- live.html`) to check that too. CLAUDE.md lists the steps that keep the repo, GitHub Pages and the demo in sync.
