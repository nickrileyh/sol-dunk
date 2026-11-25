// Money moving on chain: withdrawals and sweeps out of the hot wallet, deposits in.
//
// Sending (withdrawals and sweeps share it):
//   queued   -> sign with a fresh blockhash, record the signature and the blockhash's last valid height, commit,
//               and only then broadcast           -> sending
//   sending  -> the chain shows it confirmed        -> sent
//            -> it failed on chain (finalized)      -> queued (a failed transaction can never land later)
//            -> not found once the finalized chain is past its last valid height, seen twice, by a node that has
//               itself processed past that point (a lagging node can't make a landed transfer look lost) -> queued
// A transfer is never signed again while an older signature for it could still land, so a crash, a timeout or a lost
// RPC answer can delay a withdrawal but never pay it twice. Broadcast errors don't change the state: the reconciler
// decides from what the chain shows.
//
// Deposits: the player's wallet sends a plain transfer to the hot wallet. The client reports the signature
// (/api/deposit/confirm) and a watcher also scans the hot wallet's history, so a deposit is credited even if the
// player closed the page. A deposit is keyed by (signature, sender), so it is credited once whichever path sees it.
import crypto from 'node:crypto';
import { TX_FEE_MARGIN } from './chain.mjs';

const TABLES = new Set(['withdrawals', 'transfers']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOW = 'Waiting for the hot wallet to be topped up';

export function createPayments({ db, chain, CFG, log, isPaused }) {
  const house = chain.address;
  // transfers from these are the house's own money, not deposits (cold-to-hot top-ups)
  const notDeposits = new Set([house, CFG.coldAddress, ...CFG.reserveAddresses].filter(Boolean));
  const inFlight = new Set();
  const misses = new Map(); // signature -> { n, at }: looks that found an expired transfer gone
  const landed = (s) => !!s && !s.err && (s.status === 'finalized' || (s.status === 'confirmed' && CFG.withdrawCommitment !== 'finalized'));

  const set = (t, table, id, f) => (table === 'withdrawals' ? t.setWithdrawal(id, f) : t.setTransfer(id, f));
  const pendingOut = async () => {
    const r = await db.pool.query(`select
      (select coalesce(sum(lamports), 0) from withdrawals where status in ('queued', 'sending'))::bigint as w,
      (select coalesce(sum(lamports), 0) from transfers where status in ('queued', 'sending'))::bigint as t,
      (select coalesce(sum(lamports), 0) from withdrawals where status = 'sending')::bigint as ws,
      (select coalesce(sum(lamports), 0) from transfers where status = 'sending')::bigint as ts`);
    return r.rows[0];
  };

  // ---- sign, record, broadcast one queued transfer
  async function send(table, id) {
    if (!TABLES.has(table) || inFlight.has(table + id)) return null;
    inFlight.add(table + id);
    try {
      const [hot, out, bh] = await Promise.all([chain.balance(house), pendingOut(), chain.latestBlockhash()]);
      const available = hot - out.ws - out.ts; // count what's already on its way out as gone
      const job = await db.tx(async (t) => {
        const w = (await t.q(`select * from ${table} where id = $1 for update`, [id])).rows[0];
        if (!w || w.status !== 'queued') return null;
        if (table === 'withdrawals' && await isPaused('withdrawals')) return null;
        if (available < w.lamports + TX_FEE_MARGIN) {
          if (w.error !== LOW) await set(t, table, id, { error: LOW });
          t.afterCommit(() => log.alert('hot-low', `The hot wallet (${(hot / 1e9).toFixed(3)} SOL) can't pay a queued ${table === 'withdrawals' ? 'withdrawal' : 'transfer'} of ${(w.lamports / 1e9).toFixed(3)} SOL. Top it up from the cold wallet.`, { everyMs: 15 * 60 * 1000 }));
          return null;
        }
        const s = chain.signTransfer(table === 'withdrawals' ? w.address : w.to_address, w.lamports, bh);
        await set(t, table, id, { status: 'sending', signature: s.signature, last_valid: s.lastValid, attempts: w.attempts + 1, error: null });
        return s;
      });
      if (!job) return null;
      try { await chain.broadcast(job.raw); }
      catch (e) {
        log.warn(`${table}: broadcast failed, waiting for the chain to settle it`, { id, signature: job.signature, err: e });
        await db.tx((t) => t.q(`update ${table} set error = $3, updated_at = now() where id = $1 and signature = $2`, [id, job.signature, String(e.message || e).slice(0, 300)]));
      }
      chain.invalidate();
      return job.signature;
    } finally { inFlight.delete(table + id); }
  }

  const markSent = (table, r) => db.tx((t) => t.q(`update ${table} set status = 'sent', sent_at = now(), updated_at = now(), error = null where id = $1 and status = 'sending' and signature = $2`, [r.id, r.signature]));
  const requeue = (table, r, why) => db.tx(async (t) => {
    const u = await t.q(`update ${table} set status = 'queued', signature = null, last_valid = null, error = $3,
      history = history || jsonb_build_array(jsonb_build_object('signature', signature::text, 'error', $3::text, 'at', now())), updated_at = now()
      where id = $1 and status = 'sending' and signature = $2 returning attempts, lamports`, [r.id, r.signature, why]);
    if (u.rowCount && u.rows[0].attempts >= 3) t.afterCommit(() => log.alert('send-retries-' + r.id, `A ${table === 'withdrawals' ? 'withdrawal' : 'sweep'} of ${(u.rows[0].lamports / 1e9).toFixed(3)} SOL has failed ${u.rows[0].attempts} times (${why}). Check the RPC and the hot wallet.`));
    log.warn(`${table}: re-queued`, { id: r.id, signature: r.signature, why });
  });

  // ---- settle 'sending' transfers from what the chain shows
  async function reconcile() {
    for (const table of TABLES) {
      const rows = (await db.pool.query(`select id, signature, last_valid from ${table} where status = 'sending' order by updated_at limit 500`)).rows;
      if (!rows.length) continue;
      const { contextSlot, value: st } = await chain.statusesAt(rows.map((r) => r.signature));
      let fin = null;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], s = st[i];
        if (landed(s)) { misses.delete(r.signature); await markSent(table, r); continue; }
        if (s && s.err) { if (s.status === 'finalized') { misses.delete(r.signature); await requeue(table, r, 'Failed on chain: ' + JSON.stringify(s.err)); } continue; }
        if (s) { misses.delete(r.signature); continue; } // on chain, not settled yet: wait
        // Nothing on chain. Give it up only once it can never land: the finalized chain is past the blockhash's last
        // valid height, the node that answered had itself processed past that slot, and two looks agree.
        if (r.last_valid == null) continue;
        if (fin === null) fin = await chain.finalizedInfo();
        if (!(fin.height > r.last_valid + 20 && contextSlot >= fin.slot)) continue;
        const m = misses.get(r.signature) || { n: 0, at: 0 };
        if (Date.now() - m.at < CFG.resendGapMs) continue;
        m.n++; m.at = Date.now(); misses.set(r.signature, m);
        if (m.n >= 2) { misses.delete(r.signature); await requeue(table, r, 'Expired before it landed'); }
      }
    }
  }

  async function processQueue() {
    for (const table of TABLES) {
      if (table === 'withdrawals' && await isPaused('withdrawals')) continue;
      const ids = (await db.pool.query(`select id from ${table} where status = 'queued' order by created_at limit 20`)).rows.map((r) => r.id);
      for (const id of ids) await send(table, id);
    }
  }

  // a new withdrawal: send it now and wait a little for it to confirm (the loops finish it otherwise)
  async function kick(id) {
    const sig = await send('withdrawals', id);
    if (sig) {
      const end = Date.now() + CFG.withdrawWaitMs;
      while (Date.now() < end) {
        const s = (await chain.statuses([sig]))[0];
        if (landed(s)) { await markSent('withdrawals', { id, signature: sig }); break; }
        await sleep(CFG.mock ? 0 : 1000);
      }
    }
    return (await db.pool.query(`select id, status, signature, lamports, error from withdrawals where id = $1`, [id])).rows[0];
  }

  // ---- deposits
  // credit the transfers in a transaction that went to the hot wallet, one credit per sender. onlyFrom: the player
  // who reported it (other senders in the same transaction are left to the watcher).
  async function creditTransfers(signature, transfers, slot, source, onlyFrom) {
    const bySender = new Map();
    for (const x of transfers) if (x.to === house && !notDeposits.has(x.from)) bySender.set(x.from, (bySender.get(x.from) || 0) + x.lamports);
    const out = [];
    for (const [from, lamports] of bySender) {
      if (onlyFrom && from !== onlyFrom) continue;
      out.push(await db.tx(async (t) => {
        const u = await t.user(from, { create: false });
        if (!u) {
          // money from a wallet that never signed in: kept aside for the operator to credit or send back
          if (await t.insertUnmatched({ signature, from, lamports, slot })) {
            await t.addReview('unmatched_deposit', from, signature, { lamports });
            t.afterCommit(() => log.alert('unmatched-' + signature, `${(lamports / 1e9).toFixed(4)} SOL arrived from ${from}, a wallet that has never signed in (${signature}). Credit it or send it back.`));
          }
          return { from, lamports, credited: false, unmatched: true };
        }
        if (!(await t.insertDeposit({ signature, address: from, lamports, slot, source }))) return { from, lamports, credited: false, duplicate: true };
        await t.credit(u, lamports, 'deposit', signature);
        // if it was set aside before this wallet signed in, it's settled now
        const um = await t.q(`update unmatched_deposits set status = 'credited', note = 'credited once the wallet signed in' where signature = $1 and from_address = $2 and status = 'open'`, [signature, from]);
        if (um.rowCount) await t.q(`update reviews set status = 'resolved', resolved_at = now(), resolved_by = 'system', note = 'credited' where kind = 'unmatched_deposit' and ref = $1 and address = $2 and status = 'open'`, [signature, from]);
        return { from, lamports, credited: true, balance: u.balance };
      }));
    }
    if (out.some((x) => x.credited)) chain.invalidate();
    return out;
  }

  async function watchDeposits() {
    const cursor = await db.tx((t) => t.setting('depositCursor', null));
    const sigs = await chain.signaturesSince(cursor, 'confirmed');
    for (const s of sigs) {
      if (!s.err) {
        const tr = await chain.readTransfers(s.signature, CFG.depositCommitment);
        if (!tr.found) break; // not at the deposit commitment yet: look again next time
        if (!tr.failed) {
          const r = await creditTransfers(s.signature, tr.transfers, tr.slot, 'watcher');
          for (const x of r) if (x.credited) log.info('deposit credited by the watcher', { signature: s.signature, from: x.from, lamports: x.lamports });
        }
      }
      await db.tx((t) => t.putSetting('depositCursor', s.signature));
    }
  }

  // ---- sweeps: keep the hot wallet small; everything above HOT_MAX goes to the cold address
  async function sweep() {
    if (!CFG.coldAddress || CFG.mock) return null;
    const [hot, out] = await Promise.all([chain.balance(house), pendingOut()]);
    if (hot <= CFG.hotMax) return null;
    const keep = Math.max(CFG.hotTarget, out.w + out.t + CFG.hotMin);
    const lamports = hot - keep - TX_FEE_MARGIN;
    if (lamports < 10_000_000) return null;
    const id = await db.tx(async (t) => {
      await t.q('select pg_advisory_xact_lock(7311002)'); // one sweep at a time across servers
      if ((await t.q(`select 1 from transfers where status in ('queued', 'sending') limit 1`)).rowCount) return null;
      const id = crypto.randomUUID();
      await t.insertTransfer({ id, kind: 'sweep', to: CFG.coldAddress, lamports, status: 'queued' });
      await t.audit('system', 'sweep', CFG.coldAddress, { lamports, hot });
      return id;
    });
    if (!id) return null;
    log.info('sweeping to the cold wallet', { lamports, to: CFG.coldAddress });
    await send('transfers', id);
    return id;
  }

  // ---- operator alerts
  async function watchHealth() {
    if (CFG.mock) return;
    const hot = await chain.balance(house);
    if (hot < CFG.hotMin) log.alert('hot-min', `The hot wallet is down to ${(hot / 1e9).toFixed(3)} SOL (alert level ${(CFG.hotMin / 1e9).toFixed(3)}). Top it up from the cold wallet.`, { everyMs: 60 * 60 * 1000 });
    const stuck = (await db.pool.query(`select count(*)::int as n from withdrawals where status in ('queued', 'sending') and created_at < now() - interval '10 minutes'`)).rows[0].n;
    if (stuck) log.alert('withdrawals-stuck', `${stuck} withdrawal(s) have waited more than 10 minutes to send.`);
    const review = (await db.pool.query(`select count(*)::int as n from withdrawals where status = 'review'`)).rows[0].n;
    if (review) log.alert('withdrawals-review', `${review} withdrawal(s) are waiting for review.`, { everyMs: 4 * 60 * 60 * 1000 });
  }

  // ---- the loops
  const timers = [];
  function every(ms, name, fn, soon = true) {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await fn(); } catch (e) { log.error(name + ' failed', { err: e }); } finally { busy = false; }
    };
    const h = setInterval(tick, ms); h.unref(); timers.push(h);
    if (soon) setTimeout(tick, 200).unref(); // right after a restart: pick up what was in flight
  }
  function start() {
    every(CFG.mock ? 1000 : 5000, 'withdrawal queue', processQueue);
    every(CFG.mock ? 1000 : 10_000, 'reconcile', reconcile);
    if (!CFG.mock && CFG.watchDeposits) every(20_000, 'deposit watcher', watchDeposits);
    if (!CFG.mock) every(60_000, 'sweep', sweep, false);
    if (!CFG.mock) every(60_000, 'health', watchHealth);
  }
  const stop = () => timers.splice(0).forEach(clearInterval);
  return { send, kick, reconcile, processQueue, creditTransfers, watchDeposits, sweep, watchHealth, start, stop, notDeposits };
}
