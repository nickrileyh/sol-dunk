// The operator's API, under /api/admin, behind ADMIN_TOKEN (and ADMIN_IPS if set). Without ADMIN_TOKEN it doesn't
// exist. Every change is written to the audit table. scripts/admin.mjs is a command-line client for it.
import express from 'express';
import { safeEqual, createLimiter } from './http.mjs';
import { validAddress } from './chain.mjs';
import { botScore } from './botcheck.mjs';

export function mountAdmin(app, ctx) {
  const { tx, db, chain, payments, CFG, log, wrap, HttpError, bankroll, settlePots, resetPauses, publicMe } = ctx;
  const bad = (m) => new HttpError(400, m);
  const r = express.Router();
  const limit = createLimiter(CFG);
  r.use(limit('admin', 120, 60_000));
  r.use((req, res, next) => {
    if (!CFG.adminToken) return res.status(404).json({ error: 'Not found' });
    if (CFG.adminIps.length && !CFG.adminIps.includes(req.ip)) return res.status(403).json({ error: 'Forbidden' });
    const h = req.get('authorization') || '';
    if (!h.startsWith('Bearer ') || !safeEqual(h.slice(7), CFG.adminToken)) {
      log.warn('admin sign-in refused', { ip: req.ip, p: req.path });
      return res.status(401).json({ error: 'Unauthorized' });
    }
    res.locals.who = 'admin';
    next();
  });
  const actor = (req) => 'admin@' + req.ip;
  const addr = (a) => { if (!validAddress(a)) throw bad('Invalid address'); return a; };
  const resolveRefs = (t, ref, by, note) => t.q(`update reviews set status = 'resolved', resolved_at = now(), resolved_by = $2, note = $3 where ref = $1 and status = 'open'`, [String(ref), by, note || null]);

  r.get('/overview', wrap(async () => {
    const b = await bankroll({ fresh: true });
    const q = async (sql, args) => (await db.pool.query(sql, args)).rows;
    const [counts] = await q(`select
      (select count(*) from users)::int as users,
      (select count(*) from runs where status in ('playing', 'checkpoint'))::int as open_runs,
      (select count(*) from withdrawals where status = 'review')::int as w_review,
      (select count(*) from withdrawals where status = 'queued')::int as w_queued,
      (select count(*) from withdrawals where status = 'sending')::int as w_sending,
      (select count(*) from reviews where status = 'open')::int as reviews,
      (select count(*) from unmatched_deposits where status = 'open')::int as unmatched,
      (select count(*) from users where hold is not null)::int as held,
      (select count(*) from users where flagged is not null)::int as limited`);
    const s = await tx(async (t) => ({ pause: await t.setting('pause', {}), houseRake: Number(await t.setting('houseRake', 0)), missionPaid: Number(await t.setting('missionPaid', 0)), rakebackPaid: Number(await t.setting('rakebackPaid', 0)), trophyPaid: Number(await t.setting('trophyPaid', 0)) }));
    return { network: CFG.network, house: chain.address, cold: CFG.coldAddress || null, access: CFG.access, bankroll: b, counts, ...s };
  }));

  r.get('/reviews', wrap(async () => {
    const q = async (sql) => (await db.pool.query(sql)).rows;
    return {
      reviews: await q(`select * from reviews where status = 'open' order by id limit 500`),
      withdrawals: await q(`select w.*, u.balance, u.flagged, u.hold, u.kyc from withdrawals w join users u on u.address = w.address where w.status = 'review' order by w.created_at`),
      unmatched: await q(`select * from unmatched_deposits where status = 'open' order by created_at`)
    };
  }));
  r.post('/reviews/:id/resolve', wrap(async (req) => tx(async (t) => {
    const u = await t.q(`update reviews set status = 'resolved', resolved_at = now(), resolved_by = $2, note = $3 where id = $1 and status = 'open' returning id`, [Number(req.params.id), actor(req), (req.body || {}).note || null]);
    if (!u.rowCount) throw new HttpError(404, 'No open review with that id');
    await t.audit(actor(req), 'review.resolve', String(req.params.id), req.body || {});
    return { ok: true };
  })));

  // ---- withdrawals waiting for review
  r.post('/withdrawals/:id/approve', wrap(async (req) => {
    const id = req.params.id;
    await tx(async (t) => {
      const w = await t.withdrawal(id);
      if (!w) throw new HttpError(404, 'No such withdrawal');
      if (w.status !== 'review') throw bad('That withdrawal is ' + w.status + ', not waiting for review');
      await t.setWithdrawal(id, { status: 'queued', reviewed_by: actor(req), auto: false });
      await resolveRefs(t, id, actor(req), 'approved');
      await t.audit(actor(req), 'withdrawal.approve', id, { lamports: w.lamports, address: w.address, note: (req.body || {}).note });
    });
    return { ok: true, withdrawal: await payments.kick(id).catch(() => null) };
  }));
  r.post('/withdrawals/:id/reject', wrap(async (req) => tx(async (t) => {
    const id = req.params.id, note = (req.body || {}).note || null;
    const w = await t.withdrawal(id);
    if (!w) throw new HttpError(404, 'No such withdrawal');
    if (!['review', 'queued'].includes(w.status)) throw bad('Only a withdrawal waiting for review or still queued can be rejected (this one is ' + w.status + ')');
    const u = await t.user(w.address);
    await t.setWithdrawal(id, { status: 'rejected', reviewed_by: actor(req), error: note });
    await t.credit(u, w.lamports, 'withdraw_refund', id); // back to the player's balance
    await resolveRefs(t, id, actor(req), 'rejected');
    await t.audit(actor(req), 'withdrawal.reject', id, { lamports: w.lamports, address: w.address, note });
    return { ok: true, ...publicMe(u) };
  })));

  // ---- players
  r.get('/users/:address', wrap(async (req) => {
    const a = addr(req.params.address);
    const q = async (sql) => (await db.pool.query(sql, [a])).rows;
    const u = await tx((t) => t.peekUser(a));
    if (!u) throw new HttpError(404, 'No such player');
    return {
      user: { ...u, bot: botScore(u.bot) },
      ledgerCheck: (await q(`select coalesce(sum(delta), 0)::bigint as sum from ledger where address = $1`))[0].sum === u.balance,
      ledger: await q(`select id, delta, kind, ref, balance_after, created_at from ledger where address = $1 order by id desc limit 100`),
      runs: (await q(`select doc from runs where address = $1 order by created_at desc limit 20`)).map((x) => { const { serverSeed, ...d } = x.doc; return { ...d, serverSeed: ['playing', 'checkpoint'].includes(d.status) ? undefined : serverSeed }; }),
      withdrawals: await q(`select * from withdrawals where address = $1 order by created_at desc limit 50`),
      deposits: await q(`select * from deposits where address = $1 order by created_at desc limit 50`),
      reviews: await q(`select * from reviews where address = $1 order by id desc limit 50`)
    };
  }));
  const userAction = (name, fn) => r.post('/users/:address/' + name, wrap(async (req) => tx(async (t) => {
    const u = await t.user(addr(req.params.address), { create: false });
    if (!u) throw new HttpError(404, 'No such player');
    const out = await fn(t, u, req.body || {}, req);
    await t.audit(actor(req), 'user.' + name, u.address, req.body || {});
    return { ok: true, ...publicMe(u), ...(out || {}) };
  })));
  userAction('hold', async (t, u, b) => { u.hold = { reason: String(b.reason || 'manual'), at: Date.now() }; });
  userAction('release', async (t, u, b, req) => { u.hold = null; await t.q(`update reviews set status = 'resolved', resolved_at = now(), resolved_by = $2, note = 'released' where address = $1 and kind = 'hold' and status = 'open'`, [u.address, actor(req)]); });
  userAction('flag', async (t, u, b) => { u.flagged = { reason: String(b.reason || 'manual'), at: Date.now() }; });
  userAction('unflag', async (t, u) => { u.flagged = null; });
  userAction('kyc', async (t, u, b) => {
    if (!['none', 'pending', 'verified', 'rejected'].includes(b.status)) throw bad('status must be none, pending, verified or rejected');
    u.kyc = b.status;
  });
  userAction('revoke', async (t, u) => { u.tv = (u.tv || 0) + 1; }); // signs the player out everywhere
  userAction('adjust', async (t, u, b) => {
    const lamports = Number(b.lamports);
    if (!Number.isSafeInteger(lamports) || lamports === 0) throw bad('lamports must be a whole, non-zero number');
    if (!b.note || String(b.note).length < 5) throw bad('Give a note saying why');
    await t.credit(u, lamports, 'adjust', String(b.note).slice(0, 200));
    log.alert('adjust-' + u.address + Date.now(), `Manual balance adjustment of ${lamports / 1e9} SOL for ${u.address}: ${b.note}`, { everyMs: 0 });
  });

  // ---- deposits from wallets that never signed in
  r.post('/unmatched/resolve', wrap(async (req) => tx(async (t) => {
    const { signature, from, action, note } = req.body || {};
    const d = (await t.q(`select * from unmatched_deposits where signature = $1 and from_address = $2 for update`, [String(signature), String(from)])).rows[0];
    if (!d) throw new HttpError(404, 'No such unmatched deposit');
    if (d.status !== 'open') throw bad('Already ' + d.status);
    if (action === 'credit') {
      // the sender has since signed in: credit them as an ordinary deposit
      const u = await t.user(d.from_address, { create: false });
      if (!u) throw bad('That wallet hasn’t signed in yet: it needs an account before it can be credited');
      if (!(await t.insertDeposit({ signature: d.signature, address: u.address, lamports: d.lamports, slot: d.slot, source: 'admin' }))) throw bad('Already credited');
      await t.credit(u, d.lamports, 'deposit', d.signature);
    } else if (action !== 'refunded' && action !== 'ignore') throw bad('action must be credit, refunded or ignore');
    await t.q(`update unmatched_deposits set status = $3, note = $4 where signature = $1 and from_address = $2`, [d.signature, d.from_address, action === 'credit' ? 'credited' : action, note || null]);
    await resolveRefs(t, d.signature, actor(req), action);
    await t.audit(actor(req), 'unmatched.' + action, d.signature, { from: d.from_address, lamports: d.lamports, note });
    return { ok: true };
  })));

  // ---- switches and lists
  r.post('/pause', wrap(async (req) => tx(async (t) => {
    const cur = await t.setting('pause', {}), b = req.body || {}, next = { ...cur };
    for (const k of ['play', 'deposits', 'withdrawals']) if (typeof b[k] === 'boolean') next[k] = b[k];
    await t.putSetting('pause', next);
    await t.audit(actor(req), 'pause', null, next);
    t.afterCommit(() => { resetPauses(); log.alert('pause-' + JSON.stringify(next), `Pause switches set: ${JSON.stringify(next)}`, { everyMs: 0 }); });
    return { pause: next };
  })));
  r.get('/allowlist', wrap(async () => ({ access: CFG.access, addresses: (await db.pool.query(`select * from allowlist order by created_at`)).rows })));
  r.post('/allowlist', wrap(async (req) => tx(async (t) => {
    const { add = [], remove = [], note } = req.body || {};
    for (const a of add) await t.q(`insert into allowlist (address, note) values ($1, $2) on conflict do nothing`, [addr(a), note || null]);
    for (const a of remove) await t.q(`delete from allowlist where address = $1`, [addr(a)]);
    await t.audit(actor(req), 'allowlist', null, { add, remove });
    return { ok: true, count: (await t.q(`select count(*)::int as n from allowlist`)).rows[0].n };
  })));

  // ---- money checks and manual triggers
  r.get('/ledger-check', wrap(async () => {
    const rows = (await db.pool.query(`select u.address, u.balance, coalesce(l.sum, 0)::bigint as ledger from users u
      left join (select address, sum(delta) as sum from ledger group by address) l on l.address = u.address
      where u.balance <> coalesce(l.sum, 0)`)).rows;
    return { ok: rows.length === 0, mismatches: rows };
  }));
  r.post('/sweep', wrap(async (req) => { const id = await payments.sweep(); await tx((t) => t.audit(actor(req), 'sweep.manual', id, {})); return { ok: true, transfer: id }; }));
  r.post('/reconcile', wrap(async () => { await payments.reconcile(); await payments.processQueue(); await settlePots(); return { ok: true }; }));
  r.post('/watch-deposits', wrap(async () => { await payments.watchDeposits(); return { ok: true }; }));

  app.use('/api/admin', r);
}
