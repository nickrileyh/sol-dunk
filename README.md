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

- **Deterministic engine** (`src/engine.cjs`, v14): fixed 120 Hz physics, integer tap ticks, seeded PRNG, no implementation-dependent math. The same taps always give the same outcome in every browser and on the server.
- **Rim contact** (v7–v8): a firm knock bounces; gentle contact just rolls. Friction scales with how hard the hit was. After a knock the forward push fades back in over 0.45 s, so a back-rim hit clanks and drops (often in) instead of the ball ploughing on. The push is steady while the ball sits on a rim, so it can't balance on the edge. Rim effects fire once per knock.
- **Fair rims** (v12): once the ball has touched a ring, while its centre is over the opening (and less than 100 units above it), the rim soaks up its forward speed (it fades at 5/s) and the forward push waits, so a ball that lands mostly inside drops in instead of rolling on over the back rim. Measured on Pro level 1 (Easy's since v14), a ball whose centre lands 8 or more units inside the end of the rim now rims out about 1% of the time (it was 11–41%); within 4 units of the end about 60% (was 95%); on or past the end it still bounces out. Rim-outs now come from drops that are visibly late.
- **Pace** (v9, v13): rings are spaced 1:1 with the ball's speed. The ball gets 4% faster each level and the rings, the first one included, spread out 4% with it, so every level leaves the same time between rims (about 1.6 s on Easy). Deeper levels get harder through tighter, moving and tilted rings and bigger height changes, not through less time to react. The client's camera pulls back 3.5% a level and keeps the ball about 16% in from the left, so most of the next ring is already on screen as you pass one.
- **Ring heights** (v11): ring centres stay between y 220 and 500 (540 before), so even a bobbing ring's lowest point is 152 units above the floor instead of 112, leaving room to recover after the drop. The owner said some rings sat too low.
- **Provably fair layouts**: before a run the server commits to `sha256(serverSeed)`. Each level's rings come from `HMAC-SHA256(serverSeed, clientSeed:nonce:level)`. The seed is revealed when the run ends, so anyone can check `GET /api/run/:id`.
- **Server replay**: the client sends its tap ticks at the end of each level. The server replays them, applies the paytable and the max-win cap, and only then pays. A level submitted faster than real time voids the run.

## The payout math

Each ring multiplies the pot: `rim` for a rim hit, `swish[n]` for the nth swish in a row (5+ caps). The swish streak carries across checkpoints. The in-game Odds & fairness page shows each level's rim, swish and 5+ streak multipliers and the **total** a run has once it clears that level, from every ring a rim hit to every ring a swish (capped at the tier's best possible win). Tables live in `src/paytable.cjs` and are generated, not hand-tuned:

```bash
npm run sim          # ~0.8M simulated levels: 6 bot skill levels × 2 modes × 8 levels (~6 min, 2 cores)
npm run calibrate    # solves the tables and writes src/paytable.cjs
npm run build
```

The bot (`src/bot.cjs`) plans each drop with a trajectory solve, then adds human-style error: tap jitter, aim error, misreading moving rings, and occasional lapses. "Average" passes about 98% of Easy level-1 rings and swishes about 65% of them.

**Calibration rule (edge mode):** the house keeps an edge at every checkpoint against average and good players. An average player who cashes out at the first checkpoint gets back at most 90% (10% house edge), and every later level keeps at least a 10% edge against them. A good player gets back at most 99% at the first checkpoint and 97% at any later one, so strong players can't profit by going deep. Rounding the tables to three decimals never pays over a cap. On Hard the good-player cap binds at the first checkpoint, so the average player gets back 82% there.

Engine v10 made the ball and rim tube 10% larger; rings widen only enough to keep the gap the ball fits through the same, so the difficulty is unchanged. Engine v11 keeps every ring at least 152 units above the floor; that barely changed difficulty (clear rates moved 0.14 points on average, 0.5 at most), and the tables were re-simulated and recalibrated for it.

Engine v12 made rims fair (see above). That makes rim hits drop in more often, so the ball is 20% faster and the rings 5% further apart (about 12% less time between rims) to keep the clear rates, and the house edge, where they were. The bot's aim error grows with ball speed, not with how long it has between rings.

Engine v13 spaces the rings 1:1 with that faster ball (the owner asked for it): the rings and the first ring are 20% further apart than in v10, as the ball is 20% faster, so there is as much time between rims as before v12 (1.6 s on Pro, 1.4 s on v12). Clearing got a little easier and swishes a little rarer, so the tables were re-simulated, and Rookie's rings are 1 unit narrower and bob a little more early on, so its first checkpoint still keeps the 10% edge.

Engine v14 has two modes instead of four tiers (the owner asked for Easy and Hard): Easy has v13's Pro rings and Hard v13's Legend rings, so nothing about the rings changed, and the tables were re-simulated and recalibrated for the two. Rookie and All-Star are gone; the demo carries a player's Pro and Legend records over to Easy and Hard. A special level's course now has a time limit that grows with it (below); a regular level keeps 45 s.

Return to player when cashing out after checkpoint 1 / 2 / 3 / 8, from the simulation (no cap):

| Mode | Average | Good | Pro | Best possible win |
|---|---|---|---|---|
| Easy | 90 / 80 / 67 / 6% | 98 / 97 / 97 / 97% | 100 / 104 / 112 / 595% | 90× |
| Hard | 82 / 60 / 40 / 1% | 99 / 97 / 97 / 97% | 107 / 123 / 156 / 3262% | 1000× (cap) |

Pros (the bot one step below perfect play) still beat the house deep into a run. `--cap-pro 0.99 --cap1-pro 1.01` keeps them behind at every checkpoint too, but because they clear the easy levels so reliably, the best possible win drops to about 4.5× on Easy and 210× on Hard (measured on engine v13's Pro and Legend, the same rings). Head-to-head play with a rake is the usual way to take an edge from everyone without that.

Full tables for all six skill levels, including pro and perfect bots, are in `sim/out/calibration_final.txt`.

`node sim/calibrate.cjs --mode flat --write` gives exactly 90% for the average player at every checkpoint instead, but then a good player's return compounds into the hundreds of percent on deeper levels.

## Challenge pots

Alongside regular play, each UTC day has a challenge pot (`src/pots.cjs`, `server/server.mjs`):

- The challenge rotates daily, for example "Swish 8 in a row" in either mode, or "Clear level 4" on Hard. They're picked so an average player makes it in roughly 4–15% of runs (a strong player in 25–50%), and no challenge comes up two days running. `node sim/pots.cjs` measures each challenge's chance per run by skill; re-run it after any physics change and copy the numbers into the challenge's `p`.
- Players pay a fixed entry (0.05 SOL by default, `POT_ENTRY_LAMPORTS`), then play ordinary runs. A run counts if it started after they entered, in the challenge's mode or a harder one; the server judges it from the outcomes it replays, never from the client.
- At midnight UTC everyone who made it splits the pot equally. The house keeps 10% of every entry whoever wins, so the pot earns from every player, however skilled. If nobody makes it, the pot rolls over to the next day.
- API: `GET /api/pot` (works signed out), `POST /api/pot/enter`, and `/api/run/level` returns `pot` progress. `npm test` covers entry, the tier rule, completing once, the split, the rake and rollover.
- The demo runs the same pot with demo SOL. It has no other players, so it simulates the other entrants (from each challenge's simulated success rate by skill) and says so, and it has a "Close this pot now" button to see a payout. `python3 tools/pot_flow.py` plays it end to end.
- The pot has its own page: its card on the **Challenges** tab (the goal, the pot and an Enter button) opens it.

## The special levels

Three special levels a day (UTC), the same three twists for everyone that day (`src/special.cjs`), with prizes of 2×, 3× and 5× the entry. Six twists take turns, each once every two days: The gauntlet (every ring moves), Tilt alley (every rim leans, left then right), Zigzag (high ring, low ring), Needle (tight rims, nothing moves), The wave (rings ride a rolling line) and Express (a quicker ball, rings spread to match). Courses are built like normal levels (same physics, ring band and climb budget) on the ring settings of a regular level from Easy level 1 to Hard level 8, 6 to 24 rings long with the last one the green checkpoint ring.

- The player pays a fixed entry (0.05 SOL, `SPECIAL_ENTRY_LAMPORTS`) and gets a fresh course from its own provably fair seed, `HMAC-SHA256(serverSeed, clientSeed:nonce:special)`, so nobody can learn a course by heart. Clearing every ring pays the prize; missing one loses the entry. The server replays the taps before it pays. A course's time limit grows with it (20 s plus 3 s a ring, at least 45 s): a slow player needs up to about 2.4 s a ring, and the old 45 s limit cut long courses short.
- **Every course is set for the player** (the owner asked for this, so the house keeps about 10% from everyone, beginners and pros alike). Each player has a level in each of the three specials, on the simulator's skill scale (novice 0, casual 1, average 2, good 3, pro 4, and a step past both ends). The course set for a level is the one a player of that skill clears with a chance of 90% ÷ the prize (about 1 in 2, 1 in 3 and 1 in 6), as close as whole rings allow, with the length near 12.
- **Levels move like a weighted staircase.** Clearing a course raises that special's level by 0.37, 0.70 or 1.37 (2×, 3×, 5×); missing lowers it by 0.3. A level only stops moving where the player clears 90% ÷ prize of their attempts, so over time everyone gets back about 90% of their entries, however good they are. It also makes missing on purpose pointless: each entry thrown away lowers the level by 0.3, and clears push it straight back up.
- **The specials open after 0.5 SOL of regular runs** (`SP.UNLOCK`, 10 entries; `SPECIAL_UNLOCK_LAMPORTS` on the server), about five runs at the default 0.1 SOL bet. The owner asked for it: by then a strong player's runs have raised their starting levels. The card shows a bar ("Bet 0.5 SOL in regular runs to unlock · 0.20 / 0.5 SOL") with Locked in place of Play, and the server refuses an entry before then.
- **Where a level starts:** 1.8 (between casual and average) for someone new, or higher if their regular runs show more (the middle of a rating from every ring they've passed and missed, against the simulator's per-ring miss rates) or their level in another special does. Never lower: anything that could lower a start could be faked. It leans high on purpose: a start that's too high costs a player a few misses while their level comes down, one that's too low hands a strong player wins while it climbs. A strong player who hides their skill in the unlock runs still wins more than 90% while their level climbs, and a weak one less while it comes down.
- `node sim/special.cjs --write` (`npm run special`, about 7 min) measures every twist at every grade with each bot, writes the curves into `src/special.cjs`, checks the course set for each skill, and plays new players through 40 attempts at one special. Return over those 40 attempts, starting at 1.8 (as if their unlock runs showed nothing) / after 5 regular runs:

| Prize | Novice | Casual | Average | Good | Pro |
|---|---|---|---|---|---|
| 2× | 69 / 71% | 83 / 83% | 90 / 89% | 99 / 92% | 106 / 94% |
| 3× | 73 / 71% | 83 / 83% | 91 / 90% | 100 / 93% | 108 / 97% |
| 5× | 71 / 73% | 83 / 84% | 92 / 92% | 102 / 94% | 117 / 104% |

  Over the first five attempts a pro gets back 109–119% after five regular runs, against 165–223% starting at 1.8. From the 16th attempt on, every skill gets back 77–101%. Good players and pros who lose their first six attempts on purpose get back 99–114% over the 40, no more than playing honestly.
- Players beyond the scale (the simulator's perfect bot) keep clearing even the hardest course. The server keeps accounts it has limited for beating the house (over 115% return after 150 runs, or a superhuman swish rate) out of the specials.
- The specials don't count toward missions or the pot, but entries count as play for mission SOL. They share one card on the **Challenges** tab, a row each with its twist, length, prize and Play; a row opens the special's page: a sketch of a course set for you, the prize, today's tries and wins, the level it's set for and the rules.
- API: `GET /api/special` (works signed out: the three specials, each with its prize and the course for the player's level, and the unlock; with a token, how much you've played toward it), `POST /api/special/start` (with `slot` 0, 1 or 2), `POST /api/special/finish`. `npm test` covers the unlock, the slots, the entry, the prize, the courses for a new player and for one with verified runs, the level rising after clears, refusals and the provably fair seed. `python3 tools/special_flow.py` plays them in the demo.

## Missions that pay SOL

Three daily missions and three weekly ones (`src/missions.cjs`), the same for everyone that UTC day or week (weeks start Monday 00:00 UTC). Every run counts, whatever the bet, and the server judges progress from the levels it replays.

- Each pays XP, as before, and SOL. A window's SOL pays once the player has played its need in that window: 2 SOL a day, 10 SOL a week by default (`MISSION_DAY_LAMPORTS`, `MISSION_WEEK_LAMPORTS`), counting run bets and special level entries. Rewards earned before then wait, and are paid the moment a bet reaches the need; anything not collected when the window ends is gone.
- Rewards: 0.001 / 0.002 / 0.003 SOL for the easy, medium and hard daily mission, 0.004 / 0.006 / 0.01 SOL weekly. They scale with the need: 0.3% of a day's need and 0.2% of a week's, at most 0.5% of everything played in a week. That's half the house's smallest edge against a good player (Hard pays a good player back 99% at checkpoint 1), so a good player who plays just enough to collect still loses about 0.5% on average, however they bet. Bigger rewards need a bigger need, or they hand good players the edge.
- API: `GET /api/missions`; `/api/run/start`, `/api/special/start`, `/api/run/level` (when a run ends) and `/api/run/cashout` return `missions` with what was done and paid. `npm test` checks the server's progress against a local replay and the ledger with rewards; `python3 tools/missions_flow.py` plays it in the demo.

## Around the game

None of this changes bets, ring layouts, physics or payouts; it lives in the client (`src/game.js`) and the player's browser (mission SOL is above; the loss limit is also kept by the server).

- **Practice for free:** a quiet link under the Play button plays a real run on the picked mode with nothing at stake: no bet, nothing recorded, no XP, missions or pot. The HUD shows the multiplier and "Practice", and the checkpoint and result cards say what the bet on the Play button would have been worth.
- **Quick tour:** a new player sees three short steps over the lobby (tap to fly, swish to win more, cash out at the green ring), ending in a practice run; How to play reopens it. The browser checks load the game with `?notour` to start past it.
- **Play limits** (Settings): a daily loss limit of 0.5, 1, 2, 5 or 10 SOL a UTC day, counting what was staked (bets, special and pot entries) minus what came back (payouts, prizes, pot shares, mission SOL). A bet or entry that would pass it is refused, in the demo and on the server (`GET`/`POST /api/limits`). Setting or lowering a limit works at once; raising it or turning it off waits 24 hours, so it can't be loosened on a bad day. A break reminder (30 minutes or an hour) shows on the result card after that much play in one sitting; a 15-minute gap starts a new sitting.
- **Plain words:** How to play is one short idea a row; rules on the special and pot pages are a few short sentences; what counts toward an unlock says "bet"; a lost run says what it was worth.

- **Navigation:** dark pages with large titles, and a tab bar docked to the bottom with three tabs. **Play** shows the live arena in a rounded window, then a key for each mode (with the most it can win, and an Odds link), the bet (round − and + that walk 0.001 to 100 SOL in 1-2-5 steps, or type any amount) with what it can win under it, and one Play button with a quiet Practice for free link under it; the balance sits at the end of the title. **Challenges** is one short page: a card for today's three specials (a row each, with its prize multiple) and one for the daily pot (its amount big), each under a marquee band with its prize and one button, the details on their pages; then the daily missions, and This week and Career as two tiles. **Profile** is the player card (with the level), then short lists: Locker, Trophies, Stats; Wallet, Settings; How to play, Odds & fairness. The **Locker** opens from Profile with a back button and shows the arena in its own window above the collection, so whatever you pick, or tap to try on before you've unlocked it, flies there at once. Pausing a run shows a card with Resume and the sound and vibration switches.
- **One home for everything:** between runs the top bar is the balance (opens the Wallet); during a run it holds pause, the multiplier and mute. Pages push in over the current tab with a back button that names it: each special, the daily pot, This week, Career, Trophies, Stats (with the recent runs), Wallet, Settings (Sound, Vibration and the play limits), How to play and Odds & fairness; tapping the tab again also goes back. Sheets rise from the bottom only for a task you finish there: editing the player card. A dot on Challenges marks specials you haven't seen or missions finished since you last looked, and one on Profile (and its Locker row) new items.
- **Look:** a clean arcade cabinet in Solana's colours, kept flat. Black pages with purple-black panels; SD Display (Saira at its widest, bundled in `src/fonts`) for titles, numbers and buttons, the system face for text. Solana purple marks what you press and what's picked, Solana green money and progress; nothing else has a colour of its own, and players can't change it. The court is black-purple, the rings purple, the checkpoint ring green, and the flame burns purple, then green at full heat. Big buttons are raised keys that sink when pressed; meters are lit segments; the challenge cards and the checkpoint card open under a marquee band; what a run earns comes on ticket-shaped chips. A tab's blocks rise in when you open it; the bet bumps when it steps; the pot counts up. Wins, level-ups, special clears and pot wins burst into flat purple, green and white confetti over the card. With reduced motion none of it moves.
- **Style rules:** a purple key starts or spends a run (Play, Play again, Resume, a special's Play, the pot's Enter); green only takes money back (Cash out, Deposit); every other button is the grey key. Labels and callouts are in sentence case, numbers are bold at most, and display amounts drop trailing zeros (0.13 SOL). A checkpoint or cash-out at 1.00× reads "your bet back", never a green +0.
- **Missions**: 3 daily missions and 3 weekly ones that also pay SOL (above), and a career of 6 chapters with 4 missions each that you play at your own pace, for XP. Each chapter ends in an item you can only get there.
- **Locker:** three kinds of item, 35 in all, each marked common, rare, epic or legendary: 18 balls, 10 wings (feather, bat, butterfly and mech shapes) and 7 trails. Items unlock with levels, trophies or career chapters. The flame, the rings and the court are the game's own, in Solana's colours, and don't change.
- **Player card:** a name, an emblem and a title (titles come from trophies, levels and the career); the emblem sits on Solana purple.
- **Smooth motion:** physics runs at 120 Hz and the ball is drawn between its last two physics positions, in a run and in the lobby's demo alike, so it moves evenly at any refresh rate. A frame never forces the browser to lay the page out: layout is read only at the start of a frame, HUD animations (the multiplier's bump, the streak meter's pump, the pot's +gain, callouts, the tab bar's pop, the XP bar's refill) run on the Web Animations API, count-ups tick at the end of the game's frame, goal notices fill in their text instead of rebuilding their HTML, and canvas text (ring labels, Best, the Checkpoint label, the LED board) is stamped from cached sprites instead of setting a canvas font. During a run the HUD capsules have a solid fill instead of a live blur. Glides into a level leave with the ball's own motion and arrive with the motion that follows, and the waiting bob eases in.
- **The fire:** burning gas that flows. A flap's fanning is carried by the gas it touches, so it flows out along the flame instead of the whole flame jumping wider; gas lives a smoothly varying time, so the tips don't flicker frame to frame; where a tongue pinches off it breaks into a separate lick with a point at both ends, never a thread; sparks, licks and smoke fade in; and going supernova the flame burns through white-hot on its way from purple to green.

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
src/special.cjs    the special levels: twists, generator, the day's three, players' levels, courses (client, server, sim)
src/game.js        browser client: rendering, audio, input, betting flow, wallet
src/index.html, src/style.css
build.cjs          inlines everything into dist/*.html
sim/               Monte Carlo runner, calibrator, quick stats; special.cjs measures the special courses,
                   pots.cjs measures the pot challenges
server/            Express API, Solana deposits/withdrawals, replay verification, tests
tools/             browser checks (Playwright + Chrome): flows.py plays every run outcome,
                   contact.py freezes rim contacts, audit.py screenshots every screen (to ./shots),
                   ui.py checks the tabs, the pages and their back button, the locker, missions,
                   the player card, the settings, the pause card, practice runs, the play limits
                   and the quick tour,
                   special_flow.py plays the special levels, missions_flow.py mission SOL, pot_flow.py the pot,
                   speed.py plays deep into a tier and reports how much of the next ring is in view,
                   clip.py records exact 60 fps frames of a run (contact sheet + mp4), e.g. to
                   review the flame; sync_check.cjs (npm run check) checks every copy is the same build
```

## Working on it

This repository is the source of truth for SOL DUNK. Start any new session from a fresh clone, and push when you're done, so every chat builds on the latest version.

- Any change to `src/engine.cjs` (physics) needs `npm run sim` then `npm run calibrate` (`node sim/calibrate.cjs patterns.json --mode edge --write`), or the paytable no longer matches the game, and `npm run special` to re-measure the special courses, and `node sim/pots.cjs` to re-measure the pot challenges.
- After a change, run `npm run build`, `npm test` and `python3 tools/flows.py` before publishing.
- `npm run check` confirms that `dist/` and the root `index.html` are the build of `src/` and that everything is pushed. Pass it a saved copy of the live demo (`npm run check -- live.html`) to check that too. CLAUDE.md lists the steps that keep the repo, GitHub Pages and the demo in sync.
