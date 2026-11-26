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
npm run dev                         # mock chain: no RPC, /api/dev/faucet gives test SOL; a local Postgres starts in data/
npm test                            # game logic, money on a real Solana runtime, and the protections (about 40 s)
```

### Real SOL

`docs/LAUNCH.md` is the step-by-step: devnet, the production setup (`deploy/`: Docker, Postgres, Caddy with automatic HTTPS), a closed beta on mainnet with small limits, and opening up. `server/SECURITY.md` is the threat model. In short:

```bash
cd server
NETWORK=devnet npm start            # makes a devnet house wallet and prints its address; fund it at faucet.solana.com
node scripts/keygen.mjs player.json
SERVER_URL=http://127.0.0.1:8787 PLAYER_KEY=player.json npm run e2e   # deposit, play, cash out, withdraw, check the chain
```

Open the server's address in Phantom or Solflare (or on desktop with the extension). The player signs a one-time sign-in message, deposits with a normal SOL transfer to the house's hot wallet (the server reads it on chain, and a watcher credits it even if the page was closed), plays, and withdraws to the same wallet.

What the server does for real money (`server/lib/`):

- **Postgres** with a ledger line for every balance change, row locks, and constraints (no negative balance, one open run, a deposit credited once).
- **Withdrawals that can't pay twice:** signed and recorded before they're broadcast, and re-sent only once the chain shows the old one can never land. Large ones, held or limited accounts and anything past the daily limits wait for review.
- **Hot and cold wallets:** the server holds only the hot key; the excess is swept to a cold (multisig) address, and both count in the bankroll.
- **Max bets tied to the bankroll:** a bet's biggest possible win must fit in the free bankroll and under a set share of it; the lobby shows the live limit per mode.
- **Reviews:** big wins and bot-like tap precision hold an account's withdrawals; an operator API and CLI (`npm run admin`) list, approve and reject.
- **Hardening:** a start-up check that refuses unsafe mainnet settings, a content security policy, rate limits, country blocking, a closed-beta allowlist, pause switches, structured logs and alerts.

## How a run is kept honest

- **Deterministic engine** (`src/engine.cjs`, v16): fixed 120 Hz physics, integer tap ticks, seeded PRNG, no implementation-dependent math. The same taps always give the same outcome in every browser and on the server.
- **Rim contact** (v7–v8): a firm knock bounces; gentle contact just rolls. Friction scales with how hard the hit was. After a knock the forward push fades back in over 0.45 s, so a back-rim hit clanks and drops (often in) instead of the ball ploughing on. The push is steady while the ball sits on a rim, so it can't balance on the edge. Rim effects fire once per knock.
- **Fair rims** (v12): once the ball has touched a ring, while its centre is over the opening (and less than 100 units above it), the rim soaks up its forward speed (it fades at 5/s) and the forward push waits, so a ball that lands mostly inside drops in instead of rolling on over the back rim. Measured on Pro level 1 (Easy's since v14), a ball whose centre lands 8 or more units inside the end of the rim now rims out about 1% of the time (it was 11–41%); within 4 units of the end about 60% (was 95%); on or past the end it still bounces out. Rim-outs now come from drops that are visibly late.
- **Walls** (v16, special courses only): a level may carry walls, solid slabs standing on the floor (`level.walls`, each `{ x0, x1, y0, y1 }` with its top at `y0`). The ball is tested against the next one each tick (a circle against a rectangle), and touching it ends the attempt with the result `wall`, like the floor. Regular levels have none and play exactly as on v15: `node sim/same.cjs` prints a digest of every tap and outcome of 8,640 plays, the same on both, and a full `sim/run.cjs` on v16 gave the same counts in all 112 rows, so the paytable and the pot rates are unchanged.
- **The outer half falls off** (v15): the owner found the rims a little too fair and asked that a ball whose centre lands on the outer half of a rim fall off. The middle of the rim tube is now the line on both rims. The far rim already threw such a ball forward and out. The near rim didn't: the forward push carried the ball over the tube and into the fair-rim zone, so a centre up to 6 units outside the tube's middle still dropped in every time. Now a ball that comes down on the near rim with its centre outside the middle loses its forward speed there, the push waits, and it rolls off the front (in about half a second; it can't balance on the tube). A tap takes the ball back. Measured with no taps after the landing: centres 1 unit or more inside the middle of the near rim drop in 100% of the time, as before; 1 unit or more outside, 0% (it was 100% up to 5 units outside and 20–40% at 8). The far rim is unchanged.
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

Engine v15 makes a ball that lands on the outer half of the near rim fall off (see above). The simulator's players rarely land there, so clear rates moved by a point at most (Hard level 8: 6.7% for the average player, was 7.7%); the tables were re-simulated and recalibrated all the same, and the special courses and pot challenges re-measured.

Return to player when cashing out after checkpoint 1 / 2 / 3 / 8, from the simulation (no cap):

| Mode | Average | Good | Pro | Best possible win |
|---|---|---|---|---|
| Easy | 90 / 79 / 67 / 6% | 98 / 97 / 97 / 97% | 100 / 105 / 112 / 577% | 88× |
| Hard | 82 / 60 / 40 / 1% | 99 / 97 / 97 / 97% | 107 / 125 / 161 / 3073% | 1000× (cap) |

Pros (the bot one step below perfect play) still beat the house deep into a run. `--cap-pro 0.99 --cap1-pro 1.01` keeps them behind at every checkpoint too, but because they clear the easy levels so reliably, the best possible win drops to about 4.5× on Easy and 210× on Hard (measured on engine v13's Pro and Legend, the same rings). Head-to-head play with a rake is the usual way to take an edge from everyone without that.

Full tables for all six skill levels, including pro and perfect bots, are in `sim/out/calibration_final.txt`.

`node sim/calibrate.cjs --mode flat --write` gives exactly 90% for the average player at every checkpoint instead, but then a good player's return compounds into the hundreds of percent on deeper levels.

## Challenge pots

Alongside regular play, each UTC day has a challenge pot (`src/pots.cjs`, `server/server.mjs`):

- The challenge rotates daily through twelve, for example "Swish 8 in a row" in either mode, or "Clear level 4" on Hard. Five are of newer kinds (the owner asked for more fun and unique challenges): "Swish 4 green rings in one run" (the checkpoint ring itself), "Reach 2 checkpoints on fire" (3 or more swishes in a row as the level ends), "Hit a rim, then swish 7 in a row" (a comeback), and a fast start, "Swish 10 of your first 12 rings" (8 on Hard), which is decided in the first two levels. They're picked so an average player makes it in roughly 4–15% of runs (a strong player in 25–50%), and no challenge comes up two days running. `node sim/pots.cjs` measures each challenge's chance per run by skill; re-run it after any physics change and copy the numbers into the challenge's `p`.
- Players pay a fixed entry (0.05 SOL by default, `POT_ENTRY_LAMPORTS`), then play ordinary runs. A run counts if it started after they entered, in the challenge's mode or a harder one; the server judges it from the outcomes it replays, never from the client.
- At midnight UTC everyone who made it splits the pot equally. The house keeps 10% of every entry whoever wins, so the pot earns from every player, however skilled. If nobody makes it, the pot rolls over to the next day.
- API: `GET /api/pot` (works signed out), `POST /api/pot/enter`, and `/api/run/level` returns `pot` progress. `npm test` covers entry, the tier rule, completing once, the split, the rake and rollover.
- The demo runs the same pot with demo SOL. It has no other players, so it simulates the other entrants (from each challenge's simulated success rate by skill) and says so, and it has a "Close this pot now" button to see a payout. `python3 tools/pot_flow.py` plays it end to end.
- The pot has its own page: its card on the **Challenges** tab (the goal, the pot and an Enter button) opens it.

## The special levels

Three special levels at a time (`src/special.cjs`), with prizes of 2×, 3× and 5× the entry, from fifteen twists. Twelve change the rings and take turns opening a day, each once every four days and never two days running: The gauntlet (every ring moves), Tilt alley (every rim leans, left then right), Zigzag (high ring, low ring), Needle (tight rims, nothing moves), The wave (rings ride a rolling line), Express (a quicker ball, rings spread to match), and six more the owner asked for as more fun and unique challenges: Stairway (three steps up, then the drop), The ripple (every ring bobs in one rhythm, each a beat behind the last, so a wave runs along the course), The squeeze (each ring tighter than the last), Big and little (a wide ring, then a tight one), Elevators (every ring rides a long, slow lift) and Slow motion (a slower ball through tight rings, with the rings closer to match). A twist may only depend on a ring's place in the course, never on the course's length.

**Three have something the regular game doesn't: walls** (the owner asked for challenges with extra features, like a wall, but not too much). A wall stands on the floor between every two rings, and touching one ends the attempt, like the floor: The wall (fly over a wall between rings), Hurdles (a quicker ball and lower walls) and The fortress (walls, and every ring moves). A wall stands a little past the middle of the gap with its top above the line from one ring to the next (6 to 38 units; −6 to 24 for Hurdles), so the ball has to come up sooner than the next ring alone would ask. It is never higher than a ball can climb to after dropping through the ring before (it drops about 90 units while the player reacts, then climbs 350 units a second), nor so high that the next ring can't be dropped into from over it. Walls have their own stream of random numbers, so the rings are the ones the course would have without them, and a course of n rings has the same n − 1 walls as a longer one. The bot (`src/bot.cjs`) holds a line over the next wall's top, leaves room that it judges afresh for each wall (worse for weaker players) and only takes a drop into the ring that clears the wall even if its tap lands a little early or late: on Easy level 1 rings a novice clips about 8% of walls, an average player 3%, a pro under 1%, and perfect play none. Beams to duck under were tried and dropped: a low arc into the ring has to start from one spot, so the hops before it need planning two rings ahead: perfect play cleared 41% of 12-ring courses on Hard level 3 rings with a beam mid-gap (about 100% with walls), and under 40% on the easiest rings with one just before each ring.

**Clear one and a new one takes its place** (the owner asked for a cleared challenge to lock or make way for a new one). Each prize has five specials a day, in an order that's the same for everyone (`SP.queuesFor`): a player sees the first, a clear brings up the next, and after the fifth that prize is done until tomorrow (the row says "All 5 cleared today" and the server refuses an entry). The first of each is the day's twist from the four-day cycle, except that one prize a day, taking turns, opens with a wall course, also in turn, with the twist it replaced next in line. The rest are all the other twists, shuffled for the day and dealt round, so all fifteen come up somewhere each day and no two prizes ever show the same one. A player's level belongs to the prize, not the twist, so it carries on from one special to the next. A missed special stays up.

Courses are built like normal levels (same physics, ring band and climb budget) on a grade: the ring settings of a regular level from Easy level 1 to Hard level 8, or one of two steps past Hard level 8 (tighter rings, a quicker ball with the rings spread to match, bigger bobs and leans; no ring is ever tighter than 60 units). They are 6 to 24 rings long with the last one the green checkpoint ring.

- The player pays a fixed entry (0.05 SOL, `SPECIAL_ENTRY_LAMPORTS`) and gets a fresh course from its own provably fair seed, `HMAC-SHA256(serverSeed, clientSeed:nonce:special)`, so nobody can learn a course by heart. Clearing every ring pays the prize; missing one loses the entry. The server replays the taps before it pays. A course's time limit grows with it (20 s plus 3 s a ring, at least 45 s): a slow player needs up to about 2.4 s a ring, and the old 45 s limit cut long courses short.
- **Every course is set for the player** (the owner asked for this, so the house keeps about 10% from everyone, beginners and pros alike). Each player has a level in each of the three specials, on the simulator's skill scale (novice 0, casual 1, average 2, good 3, pro 4, and a step past both ends). The course set for a level is the one a player of that skill clears with a chance of 90% ÷ the prize (about 1 in 2, 1 in 3 and 1 in 6), as close as whole rings allow, with the length near 12.
- **Levels move like a weighted staircase.** Clearing a course raises that special's level by 0.37, 0.70 or 1.37 (2×, 3×, 5×); missing lowers it by 0.3. A level only stops moving where the player clears 90% ÷ prize of their attempts, so over time everyone gets back about 90% of their entries, however good they are. It also makes missing on purpose pointless: each entry thrown away lowers the level by 0.3, and clears push it straight back up.
- **The specials open after 0.5 SOL of regular runs** (`SP.UNLOCK`, 10 entries; `SPECIAL_UNLOCK_LAMPORTS` on the server), about five runs at the default 0.1 SOL bet. The owner asked for it: by then a strong player's runs have raised their starting levels. The card shows a bar ("Bet 0.5 SOL in regular runs to unlock · 0.20 / 0.5 SOL") with Locked in place of Play, and the server refuses an entry before then.
- **Where a level starts:** 1.8 (between casual and average) for someone new, or higher if their regular runs show more (the middle of a rating from every ring they've passed and missed, against the simulator's per-ring miss rates) or their level in another special does. Never lower: anything that could lower a start could be faked. It leans high on purpose: a start that's too high costs a player a few misses while their level comes down, one that's too low hands a strong player wins while it climbs. A strong player who hides their skill in the unlock runs still wins more than 90% while their level climbs, and a weak one less while it comes down.
- The three wall courses were measured on engine v16 with `node sim/special.cjs 2000 --only=walls,hurdles,fortress --twists=walls,hurdles,fortress --write`, which plays just those and keeps the saved curves of the other twelve (they play tap for tap as before). Played by each bot on the course set for its own level they return 75–94%; new players get back 75–92% from the 16th attempt on (a pro 90–102%), and good players and pros who lose their first six on purpose 99–115% over 40, the same as playing honestly (99–117%); the course set for levels 3 to 4.5 is expected to pay 76–90%.
- `node sim/special.cjs --write` (`npm run special`, about 20 min on two cores) measures every twist at every grade with each bot, writes the curves into `src/special.cjs`, checks the course set for each skill, and plays new players through 40 attempts at one special. Return over those 40 attempts, starting at 1.8 (as if their unlock runs showed nothing) / after 5 regular runs:

| Prize | Novice | Casual | Average | Good | Pro |
|---|---|---|---|---|---|
| 2× | 69 / 70% | 83 / 83% | 91 / 89% | 99 / 92% | 107 / 94% |
| 3× | 73 / 73% | 84 / 83% | 91 / 90% | 99 / 93% | 109 / 96% |
| 5× | 72 / 69% | 83 / 84% | 93 / 91% | 100 / 94% | 115 / 103% |

  Over the first five attempts a pro gets back 111–123% after five regular runs, against 163–212% starting at 1.8. From the 16th attempt on, every skill gets back 77–102%. Good players and pros who lose their first six attempts on purpose get back 98–113% over the 40, no more than playing honestly. Those rows play The gauntlet, Zigzag and The wave; `--twists=needle,slowmo,lifts` plays the three easiest twists instead and gives the same picture (a pro at 90–94% from the 16th attempt at 2× and 3×, 106% at 5×, inside the noise of 125 players).
- **Every twist has a course hard enough for a pro.** The simulator prints what the course set for levels 3, 4 and 4.5 is expected to pay, for every twist and prize; with twelve twists on ten grades it is 77–90% everywhere except Needle at 5× and level 4.5 (93%). Before the two grades past Hard level 8, the easier twists ran out of difficulty: a pro cleared the hardest Needle course 45% of the time, which paid 143% at 3× and 238% at 5×. At level 5, the very top of the scale, Needle (3× and 5×) and Zigzag (5×) still run out; that is past the pro bot.
- Players beyond the scale (the simulator's perfect bot) keep clearing even the hardest course. The server keeps accounts it has limited for beating the house (over 115% return after 150 runs, or a superhuman swish rate) out of the specials.
- The specials don't count toward missions or the pot, but entries count as play for mission SOL. They share one card on the **Challenges** tab, a row each with its twist, length, prize and Play; a row opens the special's page: a sketch of a course set for you, the prize, today's tries and wins, the level it's set for and the rules.
- API: `GET /api/special` (works signed out: the three specials, each with its prize and the course for the player's level, and the unlock; with a token, how much you've played toward it), `POST /api/special/start` (with `slot` 0, 1 or 2), `POST /api/special/finish`. `npm test` covers the unlock, the slots, the entry, the prize, the courses for a new player and for one with verified runs, the level rising after clears, refusals and the provably fair seed. `python3 tools/special_flow.py` plays them in the demo.

## Missions that pay SOL

Missions come in rounds of three (`src/missions.cjs`): easy, medium and hard, the same for everyone that UTC day or week (weeks start Monday 00:00 UTC). There are three rounds a day and three a week. Finishing all three of a round opens the next, with new missions and more SOL. Every run counts, whatever the bet, and the server judges progress from the levels it replays.

- **Kinds.** Swishes, points, levels cleared, streaks, a score in one run, a level reached, moving rings, perfect levels, green rings swished, catching fire, and runs played; weeks add swishing 5 in a row. No kind comes twice in a window. Later daily rounds ask for more (totals grow 1.5× and 2×) and pay 20 XP more a round. Each week also ties its days together: "Finish a daily round on 3 days" in weekly round 1 and "on 5 days" in round 2.
- **SOL.** A round's SOL pays once the player has played its need in the window, counting run bets and special level entries: 2, 5 and 10 SOL a day, 10, 25 and 50 SOL a week by default (`MISSION_DAY_LAMPORTS` and `MISSION_WEEK_LAMPORTS` set round 1; rounds 2 and 3 are 2.5× and 5×). Rewards earned before then wait, and are paid the moment a bet reaches the need; anything not collected when the window ends is gone.
- **Rewards.** A round pays its window's share (0.3% a day, 0.2% a week) of the play its need adds: 0.006, 0.009 and 0.015 SOL for the three daily rounds (0.03 SOL a day in all), 0.02, 0.03 and 0.05 SOL weekly (0.1 SOL a week). So at every moment a window has paid at most its share of what was played in it, 0.5% of play with days and weeks together. That's half the house's smallest edge against a good player (Hard pays a good player back 99% at checkpoint 1), so a good player who plays just enough to collect still loses on average, however they bet. Later rounds pay more only because they ask for more play: bigger rewards need a bigger need, or they hand good players the edge.
- **In the game.** The daily missions card and This week show the three rounds side by side (paid, open, locked), what the open round's SOL waits for, and what finishing all three opens. In a run, the mission nearest done shows under each level's banner and on the checkpoint card, and a notice says "Almost there" when one is a ring or two short. The result card always shows the next mission to go for, with a meter and what it pays, and says when a round has opened.
- API: `GET /api/missions` (the open round as `daily` / `weekly`, every opened mission under `all`, `round`, `needLamports` for the open round); `/api/run/start`, `/api/special/start`, `/api/run/level` (when a run ends) and `/api/run/cashout` return `missions` with what was done, opened and paid. `npm test` checks the server's progress against a local replay, the rounds, and that no window pays more than its share; `python3 tools/missions_flow.py` plays it in the demo; `node sim/missions.cjs` measures how many runs each round takes (about 5, 14 and 24 for an average player who cashes out after level 3).

## Levels and rakeback

XP comes from how you play (points, levels cleared, perfect levels, missions, trophies), never from what you bet. A level takes 70 XP plus 35 more for each level before it (`src/levels.cjs`; it was 50 plus 25, and saved XP moved over at the same level).

- **Rakeback.** Every bet sets a little SOL aside for the player: 20% of the house's cut of it. It builds up as they play, and each level up releases it to claim, on the result card or under the player card on Profile.
- **Why a share of bets, not of losses.** Paying back a share of losses pays for the swings: bet big once, claim on a loss, keep a win, and the player is ahead of the house. So rakeback counts the least the house keeps of each kind of bet: 1% of a run (its smallest edge against a good player), 5% of a special entry (half the 10% a settled level keeps), 10% of a pot entry (the rake). That makes it 0.2% of run bets, 1% of special entries and 2% of pot entries.
- **The house's edge.** With mission SOL, a run bet gives back 0.7% at most, under the 1% the house keeps from a good player. Levelling up only decides when rakeback can be claimed, never how much there is.
- **Server.** It sets rakeback aside at `/api/run/start`, `/api/special/start` and `/api/pot/enter`, keeps its own XP from the runs and missions it verifies (trophies and the career are the browser's), and releases rakeback when that XP levels up. `POST /api/rakeback/claim` pays what is ready, with a ledger line; every reply with the balance carries `rakeback`. Rakeback set aside counts as owed to players in the cover check.

## Around the game

None of this changes bets, ring layouts, physics or payouts; it lives in the client (`src/game.js`) and the player's browser (mission SOL is above).

- **Practice for free:** a quiet link under the Play button plays a real run on the picked mode with nothing at stake: no bet, nothing recorded, no XP, missions or pot. The HUD shows the multiplier and "Practice", and the checkpoint and result cards say what the bet on the Play button would have been worth.
- **Quick tour:** a new player sees three short steps over the lobby (tap to fly, swish to win more, cash out at the green ring), ending in a practice run; How to play reopens it. The browser checks load the game with `?notour` to start past it.
- **Plain words:** How to play is one short idea a row; rules on the special and pot pages are a few short sentences; what counts toward an unlock says "bet"; a lost run says what it was worth.

- **Navigation:** dark pages with large titles, and a tab bar docked to the bottom with three tabs. **Play** shows the live arena in a rounded window, then a key for each mode (with the most it can win, and an Odds link), the bet (round − and + that walk 0.001 to 100 SOL in 1-2-5 steps, or type any amount) with what it can win under it, and one Play button with a quiet Practice for free link under it; the balance sits at the end of the title. **Challenges** is one short page: a card for today's three specials (a row each, with its prize multiple) and one for the daily pot (its amount big), each under a marquee band with its prize and one button, the details on their pages; then the daily missions, and This week and Career as two tiles. **Profile** is the player card (with the level), then short lists: Locker, Trophies, Stats; Wallet, Settings; How to play, Odds & fairness. The **Locker** opens from Profile with a back button and shows the arena in its own window above the collection, so whatever you pick, or tap to try on before you've unlocked it, flies there at once. Pausing a run shows a card with Resume and the sound and vibration switches.
- **One home for everything:** between runs the top bar is the balance (opens the Wallet); during a run it holds pause, the multiplier and mute. Pages push in over the current tab with a back button that names it: each special, the daily pot, This week, Career, Trophies, Stats (with the recent runs), Wallet, Settings (Sound, Vibration), How to play and Odds & fairness; tapping the tab again also goes back. Sheets rise from the bottom only for a task you finish there: editing the player card. A dot on Challenges marks specials you haven't seen or missions finished since you last looked, and one on Profile (and its Locker row) new items.
- **Look:** a clean arcade cabinet in Solana's colours, with soft light on what's lit (keys, the HUD on a streak, cards over the court) and no gradient text. Black pages with purple-black panels; SD Display (Saira at its widest, bundled in `src/fonts`) for titles, numbers and buttons, the system face for text. Solana purple marks what you press and what's picked, Solana green money and progress; nothing else has a colour of its own, and players can't change it. The court is black-purple, the rings purple, the checkpoint ring green, and the flame burns purple, then green at full heat. Every panel has a hairline edge, so its shape is crisp on the black page; the display face is bold at most (only the wordmark is heavier); the two mode keys stand level, and the picked one lights purple on a purple edge. The court is a night arena: near-black above, a narrow violet beam, and a violet haze low over the far side that the courtside crowd stands out against in silhouette, over a green LED board and polished boards. Big buttons are raised keys that sink when pressed; meters are lit segments (9 px lit, 3 px gap); keys have a lit top edge and their colour's light under them, and cards over the court are lit from above and spring in over a dimmed court. the challenge cards and the checkpoint card open under a marquee band; what a run earns comes on ticket-shaped chips. A tab's blocks rise in when you open it; the bet bumps when it steps; the pot counts up. Wins, level-ups, special clears and pot wins burst into flat purple, green and white confetti over the card. With reduced motion none of it moves.
- **Style rules:** a purple key starts or spends a run (Play, Play again, Resume, a special's Play, the pot's Enter); green only takes money back (Cash out, Deposit); every other button is the grey key. Labels and callouts are in sentence case, numbers are bold at most, and display amounts drop trailing zeros (0.13 SOL). A checkpoint or cash-out at 1.00× reads "your bet back", never a green +0.
- **Desktop:** a window at least 1024 × 600 gets a desktop layout from the same build (`body.desk`, set in `resize()`). The three tabs become a sidebar under the wordmark; Play and the Locker put the arena's window on the left and what you set on the right; Challenges and Profile run in two columns; pages keep a 680 px reading column; the player card opens as a dialog. A run keeps the phone's window onto the court, centred, so nobody sees further ahead on a big screen. With a keyboard and mouse (`body.kb`) the prompts say "Press Space", the buttons show their keys, and a short list of keys sits at the foot of the sidebar: Space plays and flaps, C cashes out, Enter keeps going, Esc or P pauses, Esc goes back, M turns the sound off and on. A click flaps too. A smaller window, or a phone, gets the phone layout.
- **Missions**: daily and weekly missions in rounds of three that also pay SOL (above), and a career of 6 chapters with 4 missions each that you play at your own pace, for XP. Each chapter ends in an item you can only get there.
- **Locker:** three kinds of item, 35 in all, each marked common, rare, epic or legendary: 18 balls, 10 wings (feather, bat, butterfly and mech shapes) and 7 trails. Items unlock with levels, trophies or career chapters. The flame, the rings and the court are the game's own, in Solana's colours, and don't change.
- **Player card:** a name, an emblem and a title (titles come from trophies, levels and the career); the emblem sits on Solana purple.
- **Trophy SOL:** each of the fifteen trophies pays a little SOL (0.001 to 0.025), claimed with a button on the Trophies page once 0.2% of what you've bet covers it. Rules in `src/trophies.cjs`; the server judges trophies from the runs it verifies (`GET /api/trophies`, `POST /api/trophies/claim`).
- **Stats at a glance:** the last runs as a strip of segments (green for the ones that came out ahead), how deep each mode has gone as a meter under its best score, and a mark on each recent run.
- **Pages with character:** each trophy has its own glyph and its XP, and an earned one is lit green; a special's sample course is drawn like the game's rings; the Wallet opens on its balance; the odds table sits under a band; the arena's window is shaded at its edges.
- **Light on the pages:** a very faint violet haze at the top of every page, panels with a lit top edge, and what's yours or picked lit like a key (the player card and its emblem, the picked mode, the worn item, the tab's segment). An empty Recent runs list says what will be there.
- **Tidy pages:** the Challenges tab is three matching cards under bands (specials, the pot, the daily missions) and two tiles; the tab bar is solid with a short fade above it; Trophies opens with a count and a meter.
- **Game feel:** every ring glows with its own light and flares as the ball goes through; a swish sends ripples out and a shaft of light down through the ring; on a streak the screen's edges glow with the flame and flare on each swish, and streaks of light run back across the hall; catching fire, going supernova and clearing a level bloom; a miss lands with a flash and debris. Confetti falls behind the cards, so it never covers their text. With reduced motion the flares, streaks and springs are off.
- **Smooth motion:** physics runs at 120 Hz and the ball is drawn between its last two physics positions, in a run and in the lobby's demo alike, so it moves evenly at any refresh rate. A frame never forces the browser to lay the page out: layout is read only at the start of a frame, HUD animations (the multiplier's bump, the streak meter's pump, the pot's +gain, callouts, the tab bar's pop, the XP bar's refill) run on the Web Animations API, count-ups tick at the end of the game's frame, goal notices fill in their text instead of rebuilding their HTML, and canvas text (ring labels, Best, the Checkpoint label, the LED board) is stamped from cached sprites instead of setting a canvas font. During a run the HUD capsules have a solid fill instead of a live blur. Glides into a level leave with the ball's own motion and arrive with the motion that follows, and the waiting bob eases in.
- **The fire:** burning gas that flows. A flap's fanning is carried by the gas it touches, so it flows out along the flame instead of the whole flame jumping wider; gas lives a smoothly varying time, so the tips don't flicker frame to frame; where a tongue pinches off it breaks into a separate lick with a point at both ends, never a thread; sparks, licks and smoke fade in; and going supernova the flame burns through white-hot on its way from purple to green.

## Before real money

The technical list is done (see Real SOL above); what's left before real money:

1. **Licensing.** Real-money skill gaming and crypto gambling are regulated, or banned, in many places. A lawyer decides where you may operate; the server has the hooks (country blocking, an allowlist, identity status, deposit and withdrawal limits) but not the licence, the identity provider or the player-protection tools a licence will ask for.
2. **A live run and an outside review.** Stage 1 of `docs/LAUNCH.md` on devnet with a real wallet, then an independent security review of `server/` before opening to the public.
3. **Skill and bots.** The tables keep an edge against average and good players at every checkpoint, but elite players (the `pro` bot) still profit deep in a run. The server limits accounts above 115% return after 150 runs or with superhuman swish rates, holds withdrawals after big wins and bot-like precision, and caps every bet by the bankroll; the bot check still needs calibrating on real players.

## Files

```
src/engine.cjs     physics, levels, replay, payout helpers (shared by client, sim, server)
src/paytable.cjs   generated multiplier tables + average-player stats
src/bot.cjs        human-like autopilot (simulation + lobby demo)
src/pots.cjs       challenge pot rules (shared by client, server, demo)
src/missions.cjs   daily and weekly missions in rounds, their SOL and what unlocks it (shared by client and server)
src/trophies.cjs   the trophies, their XP and SOL, and the rule for claiming it (shared by client and server)
src/special.cjs    the special levels: twists, generator, the day's three, players' levels, courses (client, server, sim)
src/levels.cjs     the level curve and level-up rakeback (shared by client and server)
src/game.js        browser client: rendering, audio, input, betting flow, wallet
src/index.html, src/style.css
build.cjs          inlines everything into dist/*.html
sim/               Monte Carlo runner, calibrator, quick stats; special.cjs measures the special courses,
                   pots.cjs measures the pot challenges
server/            the game server: server.mjs (routes), lib/ (config, Postgres, chain, payments, bot check,
                   HTTP hardening, operator API), scripts/ (admin CLI, keygen, the live e2e check), test/
deploy/            Dockerfile, docker-compose (Postgres, the app, Caddy with HTTPS), .env.example
docs/LAUNCH.md     taking it live: devnet, production setup, closed beta, opening up, what to do when things go wrong
tools/             browser checks (Playwright + Chrome): flows.py plays every run outcome,
                   contact.py freezes rim contacts, audit.py screenshots every screen (to ./shots),
                   desktop.py checks the desktop layout and its keys at three window sizes,
                   ui.py checks the tabs, the pages and their back button, the locker, missions,
                   the player card, the settings, the pause card, practice runs and the quick tour,
                   special_flow.py plays the special levels, missions_flow.py mission SOL, pot_flow.py the pot,
                   speed.py plays deep into a tier and reports how much of the next ring is in view,
                   clip.py records exact 60 fps frames of a run (contact sheet + mp4), e.g. to
                   review the flame; server_flow.py plays the real-SOL page against the server under its
                   security policy; sync_check.cjs (npm run check) checks every copy is the same build
```

## Working on it

This repository is the source of truth for SOL DUNK. Start any new session from a fresh clone, and push when you're done, so every chat builds on the latest version.

- Any change to `src/engine.cjs` (physics) needs `npm run sim` then `npm run calibrate` (`node sim/calibrate.cjs patterns.json --mode edge --write`), or the paytable no longer matches the game, and `npm run special` to re-measure the special courses, and `node sim/pots.cjs` to re-measure the pot challenges.
- After a change, run `npm run build`, `npm test` and `python3 tools/flows.py` before publishing.
- `npm run check` confirms that `dist/` and the root `index.html` are the build of `src/` and that everything is pushed. Pass it a saved copy of the live demo (`npm run check -- live.html`) to check that too. CLAUDE.md lists the steps that keep the repo, GitHub Pages and the demo in sync.
