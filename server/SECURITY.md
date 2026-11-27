# Security notes for the SOL DUNK server

What the server protects, how, how each protection is tested, and what is still open. Read this before changing
anything under `server/lib/` or the deposit, withdrawal or run routes in `server.mjs`. An independent review has not
been done yet; it is a launch requirement (`docs/LAUNCH.md`).

## What an attacker wants, and what stops them

| Goal | What stops it | Test |
|---|---|---|
| Be paid a withdrawal twice | A transfer is signed, its signature recorded and committed, and only then broadcast. It is never signed again until the chain shows the old signature can't land: failed on a finalized block, or not found once the finalized chain is past the blockhash's last valid height, seen twice, by a node that has itself processed past that slot. Broadcast errors change nothing. | `money-flow`: answer lost, dropped, lands late, lagging node; each checks the wallet got the amount exactly once |
| Withdraw more than the balance | The balance is debited in the same transaction that creates the withdrawal, with the player's row locked; a `balance >= 0` constraint backs it. | `money-flow`: 10 parallel withdrawals |
| Send someone's money elsewhere | Withdrawals only ever go to the signed-in wallet's own address. A stolen sign-in token can play and withdraw to its owner, nothing more. | by construction |
| Be credited a deposit twice, or someone else's | Deposits are keyed by (signature, sender) and credited to the sender only. The client's report and the watcher share that key. The server reads the transfer from the transaction's own instructions at the configured commitment (`finalized` on mainnet). | `money-flow`: repeat, steal, watcher then confirm |
| Fake a run's result | The client sends only its taps. The server regenerates the level from its own seed, replays the taps on the shared engine, and pays from that. A level finished faster than the game runs voids the run. | `run-flow` (every payout checked against a local replay), `security`: void |
| Know a level before betting | The server seed is random per run and only its hash is shown until the run ends; the level seed is HMAC(serverSeed, clientSeed:nonce:level). | `run-flow`: fairness |
| Win more than the house holds | A bet is refused unless its biggest possible payout fits in the free bankroll (hot + cold balances less everything owed: balances, open runs at their biggest payout, open pots, unsent withdrawals, rakeback set aside and mission SOL waiting to be claimed) and under `RISK_FRACTION` of it. One bet at a time passes that check (an advisory lock). | `money-flow`: bankroll |
| Beat the tables with a bot | Limits on accounts with a return above 115% after 150 runs or a superhuman swish rate; a hold on withdrawals when the spread of where the ball crosses the rim is too tight to be a person (`lib/botcheck.mjs`), and after any big win. Holds and limits put the account in the review queue. | `security`: big win, bot precision |
| Farm the free SOL (missions, rakeback, trophies) | All three are priced on what was bet, never on what was lost or how fast someone levels: a mission round pays its window's share (0.3% a day, 0.2% a week) of the play its need adds, rakeback is 20% of the least the house keeps of a bet (0.2% of a run bet), and trophy SOL can be claimed only up to 0.2% of everything the account has bet (the smallest rewards first, each trophy once). Together they stay under the 1% the house keeps from a good player, so no way of betting, and no number of accounts, turns them into an edge. Progress, trophies and the level that releases rakeback come from the server's own replay; a claim is a ledger line and pays once. | `run-flow`: missions (no window pays more than its share), rakeback (set aside, released, claimed once), trophies (a claim before the bets cover it is refused; claims stay within their share of the bets; a second claim, an unknown trophy and an unearned one are refused) |
| Rig a duel | Both flights are replays of the players' taps on one course from the server's seed; the rival only gets the mark's taps once they've paid in, so the mark's course stays shut until then, and nobody can race their own mark. A mark is raced only by someone who paid in the same stake, and the winner takes 1.8× of it. Stopping past a rival who's out only counts the rings already flown. A duel's entries count as play for the free SOL only once it settles, so marks parked for a refund earn nothing. The house keeps its cut of both entries and never takes a side. | `run-flow`: duel |
| Beat the special levels | Each special's course is set by the player's own level there, which climbs after a swish and drops after a miss, so a good player plays a harder course and the prize stays under what it costs. Each stake (0.01–0.2 SOL, `SPECIAL_MAX_STAKE_LAMPORTS`) keeps its own level, so raising the stake only while a level is low doesn't pay; a new stake starts at the highest level the player has reached anywhere, and opens only after ten of it in regular-run bets. A prize is refused if it doesn't fit under `MAX_PAYOUT_LAMPORTS` and `RISK_FRACTION` of the free bankroll. | `run-flow`: specials (stakes on offer, a locked or odd stake refused with nothing taken, a miss moves only that stake's level); `node sim/stakes.cjs` (64–94% back at their skill for every pattern tried) |
| Rig the daily pot | Every attempt is a replay of the player's taps on the day's course, judged by the server; a flight sent faster than it could have been flown is void, and the same tap-precision check runs on it. Only an account's best attempt counts and an attempt pays its entry whether it scores or not, so many attempts buy many tries, not a bigger share. No attempt starts in the last four minutes of the day, so every flight is judged before the pot settles. The house keeps 10% of every entry and never takes a side; a limited account can't enter. | `run-flow`: pot (attempts, best kept, standings, the 50/30/20 split, ties, short fields, rollover, the house's cut) |
| Take over the operator API | Off unless `ADMIN_TOKEN` (32+ characters) is set; constant-time comparison; optional `ADMIN_IPS`; rate limited; every action in the `audit` table. | `security`: admin lock |
| Run script in a player's page | The page is one file with a content security policy that allows only its own scripts by hash, no framing, and connections only to its own server. | `security`: headers; `tools/server_flow.py` plays the page under the policy |
| Play from a blocked country | Run starts, pot and special entries and new deposits are refused by country (the CDN's header). `ORIGIN_SECRET` or a tunnel keeps that header from being faked. Withdrawals and balances stay open everywhere. | `security`: geo |
| Flood the server | Per-address and per-player rate limits, a 64 KB body limit, one open run per player (a unique index). | `security`: rate limit |
| Start a real-money server unsafely | On `mainnet-beta` the server refuses to start with the mock chain, dev endpoints, no database, no token or admin secrets, no house key, no cold address, no HTTPS address, a weak real-time check or no country list. | `security`: config |

## The hot wallet

The server holds one key: the hot wallet's. Whoever gets it (or the server) can take what the hot wallet holds, so:

- it stays small: everything above `HOT_MAX_LAMPORTS` is swept to `COLD_ADDRESS`, a multisig whose keys never touch
  the server, and the server can only send sweeps there;
- automatic withdrawals have a daily circuit breaker (`WITHDRAW_DAY_TOTAL_LAMPORTS`) and per-player and per-withdrawal
  review thresholds;
- the key comes from a file mounted as a secret (`HOUSE_KEY_FILE`), is never logged, and on mainnet is never
  generated by the server.

An attacker with the hot key can drain the hot wallet but not the cold wallet, and can't change what players are
owed (that is in the database). An attacker with the database password could credit themselves a balance; the
withdrawal limits and review thresholds bound what leaves before someone notices, and `ledger-check` (every balance
equals the sum of its ledger lines) shows a balance edited behind the ledger's back.

## The ledger

Every balance change goes through `Tx.credit()`, which writes a `ledger` line with the amount, the kind, a reference
and the balance after it, in the same transaction as the change. `GET /api/admin/ledger-check` compares every balance
with the sum of its lines. Routes run in one database transaction each: they lock the player's row first, so two
requests for the same player run one after the other.

## Known limits and open items

- **No independent audit yet.** The tests cover the cases above on a real Solana transaction runtime (LiteSVM, in
  process), not on a live cluster under load. Stage 1 of `docs/LAUNCH.md` runs it on devnet.
- **One RPC provider.** The resend rule trusts what the RPC says about a signature. The lagging-node guard covers a
  node that is behind; it doesn't cover a provider that lies. Use one reputable dedicated provider, not a pool.
- **The bot check is calibrated on the game's own bots**, not on people: a perfect bot scores 0.8 to 1 (the
  review threshold is 0.8), the human-like skills 0. Recalibrate from real players. A bot that adds human-like noise passes it and is left to the return-based
  limits, the review of big wins and the bet limits.
- **Elite players beat the regular tables deep into a run** (the design doc's payout section). The bet and payout
  caps bound the loss per run; the limits catch it over time.
- **Sign-in tokens live in the page's memory** and last `TOKEN_DAYS` (7); `npm run admin -- revoke <address>` ends a
  player's sessions. A token can't move money anywhere but the wallet it belongs to.
- **Rate limits are per server process.** Behind several app servers each counts its own share. The money rules
  don't depend on them.
- **Deposits through other programs** (a transfer made inside another program's instruction, or from an exchange's
  wallet) aren't credited automatically: they show up as unmatched for the operator, or not at all for inner
  transfers. The page only ever asks the wallet for a plain transfer.
- **No identity checks built in**, and of the player-protection tools only an operator-set daily deposit limit
  (`DEPOSIT_DAY_LIMIT_LAMPORTS`): the owner had the player-set daily loss limit and the break reminder removed. The hooks are there (`kyc`
  status, `KYC_WITHDRAW_LAMPORTS`, holds); a licence will say what else is needed (self-exclusion, age checks).
- **Dependencies:** `npm audit --omit=dev` reports moderate advisories in `@solana/web3.js` 1.x's JSON-RPC client
  (`jayson`: `uuid`, `stream-json`). The server uses that client only to call its own RPC provider. Moving to
  web3.js 2 (`@solana/kit`) would clear them.

- The daily pot's course is public for the whole day, so a bot can learn it and fly it perfectly. The house doesn't lose (its 10% is taken from every entry); the other players do. The tap-precision hold and limits apply, a limited account can't enter, and the operator sees every attempt (`runs` of kind `pot`). For a real launch, watch the top of the board for near-perfect flights.

- A strong player who plays badly on purpose (regular runs and specials) starts each special stake at a low level and wins there until it catches up. `node sim/stakes.cjs --net` puts that at about 1.3 SOL per prize per account with the 0.2 SOL cap (6.6 SOL at 1 SOL), so the cap stays low until accounts are verified (one person, one account). The bot checks and the review queue apply.

- Duels between two accounts of the same person move SOL from one to the other at the cost of the house's cut; the operator sees both sides in each run's record (`rival`). A bot that flies perfectly wins its duels against people: the house doesn't lose, its rivals do. The same tap-precision holds and limits apply, and a limited account can't enter.

## Reporting a problem

Pause first (`npm run admin -- pause play deposits withdrawals`), then look. Balances are safe while paused.
