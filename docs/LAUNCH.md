# Taking SOL DUNK live with real SOL

The technical steps, in order. Each stage has an exit check; don't move on until it passes. The legal side (a licence,
which countries to block, identity checks) is separate and comes first for mainnet: this document assumes a gaming
lawyer has told you where you may operate. Settings are in `deploy/.env.example`; the threat model is in
`server/SECURITY.md`.

## What runs where

- **The app** (`server/server.mjs`): serves the game page and the API. It holds the **hot wallet's key** and nothing else of value.
- **Postgres**: every balance, run, deposit, withdrawal and a ledger line for each balance change.
- **The hot wallet**: a small float that receives deposits and pays withdrawals automatically.
- **The cold wallet**: a multisig vault (for example Squads) that holds most of the bankroll. The server knows only
  its address: it sweeps the hot wallet's excess there and counts its balance in the bankroll. Moving money back to
  the hot wallet takes the multisig's signers, by hand.

## Stage 0: on your own machine (no SOL at all)

```
cd server && npm install
npm test                 # game logic, money on a real Solana runtime, the protections (about 40 s)
npm run dev              # mock chain; open http://localhost:8787, "Connect wallet" needs Phantom or Solflare
```

`npm test` starts its own throwaway Postgres and a local Solana runtime (LiteSVM), so it needs nothing installed.
`python3 tools/server_flow.py` (from the repo root) plays the real-SOL page in a browser against the server.

Exit check: both pass.

## Stage 1: devnet (test SOL, the real network)

1. Make a hot wallet and start the server on devnet:
   ```
   cd server
   node scripts/keygen.mjs data/house-devnet.json     # or let the server make one on first start
   NETWORK=devnet npm start                           # prints the house address
   ```
2. Fund the house address with devnet SOL at https://faucet.solana.com (the bankroll: a few SOL).
3. Run the scripted check. It signs in, deposits, plays a run in real time, cashes out, withdraws everything and
   checks the wallet's balance on chain:
   ```
   node scripts/keygen.mjs player.json
   SERVER_URL=http://127.0.0.1:8787 PLAYER_KEY=player.json npm run e2e
   ```
4. Do the same by hand with a real wallet: set Phantom to devnet (Settings → Developer settings), open the page,
   connect, deposit 0.1 SOL, play, withdraw. Then test the paths the script can't: close the tab right after
   approving a deposit (the watcher should credit it within a minute), and send SOL to the house address from a
   wallet that never signed in (it should appear in `npm run admin -- reviews` as unmatched).
5. Deploy it the way production will run (next stage) but with `NETWORK=devnet`, and repeat steps 3 and 4 against
   the public address.

Exit check: the script passes against the deployed server, a Phantom deposit and withdrawal work, and
`npm run admin -- ledger-check` says `ok: true`.

## Stage 2: the production setup

On a server with Docker (2 CPUs and 4 GB are plenty), with the domain's DNS pointing at it:

```
cd deploy
cp .env.example .env                                   # fill it in
mkdir -p secrets && node ../server/scripts/keygen.mjs secrets/house.json
docker compose up -d --build
docker compose logs -f app                             # config warnings and errors show here
```

Before real money:

- **Cold wallet.** Create a Squads multisig (2 of 3 signers on hardware wallets) and put its vault address in
  `COLD_ADDRESS`. Send the bankroll there, then top the hot wallet up to `HOT_TARGET_LAMPORTS` from it.
- **Back up the hot key** (`deploy/secrets/house.json`) offline. If the server's disk is lost, so is whatever the hot
  wallet holds; that's why it stays small.
- **Database.** Use a managed Postgres with point-in-time recovery (set `DATABASE_URL`, remove the `db` service), or
  at least a nightly `pg_dump` shipped off the server. The database is the record of what every player is owed.
- **Cloudflare in front** (free plan is enough): it supplies the visitor's country for `BLOCKED_COUNTRIES` and
  absorbs floods. Set `TRUST_PROXY=2`, and either use a Cloudflare Tunnel (no open ports) or set `ORIGIN_SECRET` and
  add a Transform Rule that sends it as the `x-origin-secret` header, so the country header can't be faked by going
  around Cloudflare.
- **Alerts.** Put a Slack or Discord webhook in `ALERT_WEBHOOK_URL` and check one arrives
  (`npm run admin -- pause play` then `resume play` each send one).
- **A dedicated RPC provider** in `RPC_URL`. Use one provider rather than a pool of several: the server decides a
  withdrawal never landed from what the RPC says.
- **The operator's tools** work from your own machine:
  ```
  export ADMIN_URL=https://play.example.com ADMIN_TOKEN=...
  npm run admin -- overview        # reserves, what's owed, the free bankroll, queues
  npm run admin -- reviews         # withdrawals, holds, voided runs and unmatched deposits waiting for you
  ```

Exit check: `docker compose ps` shows all three healthy, the page loads over HTTPS, `overview` shows the hot and cold
balances, and the app's log has no `config:` warnings you haven't decided to accept.

## Stage 3: closed beta on mainnet (small limits, invited wallets)

Set `NETWORK=mainnet-beta` and the closed-beta values from `.env.example`:

| Setting | Closed beta | Why |
|---|---|---|
| `ACCESS` | `allowlist` | only wallets you add can sign in (`npm run admin -- allow <address>`) |
| `MAX_BET_LAMPORTS` | 0.05 SOL | |
| `MAX_PAYOUT_LAMPORTS` | 5 SOL | Hard's top win is 1000×, so its max bet is the payout cap ÷ 1000 = 0.005 SOL |
| `RISK_FRACTION` | 0.05 | no bet's top win may exceed 5% of the free bankroll |
| `WITHDRAW_REVIEW_LAMPORTS` | 2 SOL | you approve anything bigger |
| `WITHDRAW_DAY_TOTAL_LAMPORTS` | 20 SOL | the circuit breaker: past it, withdrawals wait for you |
| `BIG_WIN_LAMPORTS` | 2 SOL | a payout this big holds that player's withdrawals until you've looked |
| `SPECIAL_DAY_TRIES` | 20 | limits how fast a strong newcomer can farm the special levels |
| `DUEL_ENTRY_LAMPORTS` | 50000000 (0.05 SOL) | each player's entry into a duel; the winner takes 90% of both |

**How max bets follow the bankroll.** Free bankroll = hot + cold balances − everything owed (player balances, open
runs at their biggest possible payout, open pots, unsent withdrawals). A mode's max bet is
`min(MAX_BET, min(MAX_PAYOUT, RISK_FRACTION × free) ÷ the mode's top multiplier)`. With 100 SOL free and the values
above: Easy (100× cap) takes 0.05 SOL, Hard (1000×) takes 0.005 SOL. The lobby shows the live limit, and it falls by
itself if the bankroll does.

Daily routine during the beta:

1. `npm run admin -- overview`: free bankroll positive, nothing stuck in `w_queued` or `w_sending`.
2. `npm run admin -- reviews`: approve or reject held withdrawals; look at each hold (`npm run admin -- user <address>`
   shows the runs, the ledger and the tap-precision score), then `release` it or keep it.
3. `npm run admin -- ledger-check`: every balance equals the sum of its ledger lines.
4. Compare the house's take with the model. The tables give an average player 90% back at the first checkpoint and
   less after it, and a good player 97-99%. If, after a few hundred runs, players as a whole are getting back more
   than about 97% of what they bet, something is being beaten: pause and look.

Exit check (two weeks or 2,000 runs, whichever is later): no ledger mismatch, no stuck or doubled withdrawal, the
players' return under the level above, and every review understood.

## Stage 4: opening up

Raise one thing at a time, a week apart, watching the same numbers: `ACCESS=open`, then `MAX_BET_LAMPORTS`, then
`MAX_PAYOUT_LAMPORTS` (with a bankroll to match: keep the biggest single payout under 5% of it), then the review
thresholds. Before `ACCESS=open`, have the security review below done and the licence's requirements (identity
checks via `KYC_WITHDRAW_LAMPORTS` and `npm run admin -- kyc`, deposit limits, self-exclusion) in place.

## When something goes wrong

| What you see | What to do |
|---|---|
| Anything you don't understand involving money | `npm run admin -- pause play deposits withdrawals`. Balances are safe while paused; queued withdrawals wait. |
| "The hot wallet can't pay a queued withdrawal" | Send SOL from the cold multisig to the hot address. The queue sends by itself within seconds. |
| A withdrawal stuck in `sending` | It's waiting for the chain to settle it; it re-sends by itself only once the old transaction can no longer land. If it's stuck for more than 10 minutes, check the RPC provider's status. Never pay it by hand while it's `sending`. |
| The hot wallet's key may be exposed | Pause withdrawals, move the hot balance to the cold address by hand, make a new key (`keygen`), restart with it, fund it, resume. Players' balances are in the database, not in the key. |
| "arrived from a wallet that has never signed in" | Someone sent SOL straight to the house address. If they sign in with that wallet and report the deposit it's credited automatically; otherwise `npm run admin -- unmatched <signature> <from> credit` after they sign in, or send it back by hand and mark it `refunded`. |
| An account is beating the house | It's already limited (small bets, no specials) and its withdrawals wait for review. `npm run admin -- user <address>` shows why; `unflag` if it's a fair player on a lucky streak. |
| The server won't start | It prints each setting it needs. On mainnet it refuses to run with anything unsafe (the mock chain, no database, no cold address, no admin token). |
| The database is lost | Restore the latest backup, then `npm run admin -- watch-deposits` re-credits deposits made since (deposits are keyed by their on-chain signature, so none is credited twice). Withdrawals sent after the backup would be owed again: this is why point-in-time recovery matters. |

## Before opening to the public

- An independent security review of `server/` (the money paths in `lib/payments.mjs` and the withdrawal and deposit
  routes first). `server/SECURITY.md` lists what was designed against and what is still open.
- A load test: 200 players in parallel against the devnet deployment.
- A restore drill: restore the database backup to a fresh server and check `ledger-check` and `overview`.
- Real players' tap-precision numbers: recalibrate the bot check's bounds (`lib/botcheck.mjs`) from them.
