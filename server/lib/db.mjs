// Postgres storage. Every request runs in one transaction: it locks the rows it changes (the player's row first), works
// on plain objects, and writes them back at commit. Balances can't go negative (a CHECK constraint), a player can have
// only one open run (a unique index), a deposit's signature is credited once (a primary key), and every balance change
// is written to the ledger with the balance after it.
import pg from 'pg';

pg.types.setTypeParser(20, (v) => { // int8 as a JS number; refuse anything a double can't hold exactly
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error('int8 out of the safe range: ' + v);
  return n;
});

export const OPEN = ['playing', 'checkpoint'];

const MIGRATIONS = [
  // 1: everything the server keeps
  `
  create table users (
    address text primary key,
    balance bigint not null default 0 check (balance >= 0),
    doc jsonb not null default '{}',
    flagged jsonb,
    hold jsonb,
    kyc text not null default 'none',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table runs (
    id uuid primary key,
    address text not null references users(address),
    kind text not null default 'run',
    status text not null,
    bet bigint not null,
    exposure bigint not null default 0,
    doc jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index runs_one_open on runs(address) where status in ('playing', 'checkpoint');
  create index runs_open on runs(status) where status in ('playing', 'checkpoint');
  create index runs_by_address on runs(address, created_at desc);
  create table pots (day text primary key, settled boolean not null default false, doc jsonb not null);
  create table pot_entries (
    day text not null references pots(day),
    address text not null references users(address),
    doc jsonb not null,
    primary key (day, address)
  );
  create table deposits (
    signature text not null,
    address text not null references users(address),
    lamports bigint not null check (lamports > 0),
    slot bigint,
    source text not null,
    created_at timestamptz not null default now(),
    primary key (signature, address)
  );
  create index deposits_by_address on deposits(address, created_at desc);
  create table unmatched_deposits (
    signature text not null,
    from_address text not null,
    lamports bigint not null,
    slot bigint,
    status text not null default 'open',
    note text,
    created_at timestamptz not null default now(),
    primary key (signature, from_address)
  );
  create table withdrawals (
    id uuid primary key,
    address text not null references users(address),
    lamports bigint not null check (lamports > 0),
    status text not null,
    auto boolean not null default true,
    reason text,
    signature text unique,
    last_valid bigint,
    attempts int not null default 0,
    error text,
    history jsonb not null default '[]',
    reviewed_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz
  );
  create index withdrawals_by_status on withdrawals(status);
  create index withdrawals_by_address on withdrawals(address, created_at desc);
  create table transfers (
    id uuid primary key,
    kind text not null,
    to_address text not null,
    lamports bigint not null check (lamports > 0),
    status text not null,
    signature text unique,
    last_valid bigint,
    attempts int not null default 0,
    error text,
    history jsonb not null default '[]',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz
  );
  create table ledger (
    id bigserial primary key,
    address text not null,
    delta bigint not null,
    kind text not null,
    ref text,
    balance_after bigint not null,
    created_at timestamptz not null default now()
  );
  create index ledger_by_address on ledger(address, id desc);
  create table settings (key text primary key, value jsonb not null);
  create table nonces (address text primary key, message text not null, exp bigint not null);
  create table allowlist (address text primary key, note text, created_at timestamptz not null default now());
  create table reviews (
    id bigserial primary key,
    kind text not null,
    address text,
    ref text,
    details jsonb,
    status text not null default 'open',
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by text,
    note text
  );
  create index reviews_open on reviews(status) where status = 'open';
  create table audit (id bigserial primary key, actor text, action text not null, target text, details jsonb, created_at timestamptz not null default now());
  `
];

const RETRY = new Set(['40001', '40P01']); // serialization failure, deadlock: safe to run the whole transaction again
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (v) => JSON.stringify(v === undefined ? null : v);

function userFrom(row) {
  return { ...row.doc, address: row.address, balance: row.balance, flagged: row.flagged, hold: row.hold, kyc: row.kyc, createdAt: row.created_at.getTime() };
}
function userDoc(u) {
  const { address, balance, flagged, hold, kyc, createdAt, ...doc } = u; // eslint-disable-line no-unused-vars
  return doc;
}

export class Tx {
  constructor(c) { this.c = c; this.users = new Map(); this.runs = new Map(); this.after = []; }
  q(sql, args) { return this.c.query(sql, args); }
  // run fn after the transaction commits (alerts, kicking off a withdrawal)
  afterCommit(fn) { this.after.push(fn); }

  // ---- players
  // lock: the row is locked until commit and written back then. Without lock the object is read-only.
  async user(address, { lock = true, create = true } = {}) {
    if (this.users.has(address)) return this.users.get(address);
    const sel = `select * from users where address = $1${lock ? ' for update' : ''}`;
    let r = await this.q(sel, [address]);
    if (!r.rows.length && create) {
      await this.q(`insert into users (address, doc) values ($1, $2::jsonb) on conflict do nothing`,
        [address, j({ nonce: 0, wagered: 0, returned: 0, runs: 0, hoops: 0, swishes: 0 })]);
      r = await this.q(sel, [address]);
    }
    if (!r.rows.length) return null;
    const u = userFrom(r.rows[0]);
    if (lock) this.users.set(address, u);
    return u;
  }
  peekUser(address) { return this.user(address, { lock: false, create: false }); }
  // every balance change: the new balance can't be negative, and the ledger gets a line
  async credit(u, delta, kind, ref) {
    if (this.users.get(u.address) !== u) throw new Error('credit on a player row that is not locked');
    if (!Number.isSafeInteger(delta)) throw new Error('credit: bad amount ' + delta);
    if (delta === 0) return;
    const after = u.balance + delta;
    if (after < 0) throw Object.assign(new Error('Not enough balance'), { status: 400 });
    u.balance = after;
    await this.q(`insert into ledger (address, delta, kind, ref, balance_after) values ($1, $2, $3, $4, $5)`, [u.address, delta, kind, ref == null ? null : String(ref), after]);
  }

  // ---- runs (changed only while their player's row is locked)
  async run(id, { lock = true } = {}) {
    if (this.runs.has(id)) return this.runs.get(id);
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const r = await this.q(`select doc from runs where id = $1${lock ? ' for update' : ''}`, [id]);
    if (!r.rows.length) return null;
    const run = r.rows[0].doc;
    if (lock) this.runs.set(id, run);
    return run;
  }
  async openRun(address) {
    const r = await this.q(`select doc from runs where address = $1 and status in ('playing', 'checkpoint') for update`, [address]);
    if (!r.rows.length) return null;
    const run = r.rows[0].doc;
    if (this.runs.has(run.id)) return this.runs.get(run.id);
    this.runs.set(run.id, run);
    return run;
  }
  async insertRun(run) {
    await this.q(`insert into runs (id, address, kind, status, bet, exposure, doc) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [run.id, run.address, run.kind || 'run', run.status, run.bet, run.exposure || 0, j(run)]);
    this.runs.set(run.id, run);
  }
  async runBets(address) {
    const r = await this.q(`select coalesce(sum(bet), 0)::bigint as s from runs where address = $1 and kind = 'run'`, [address]);
    return r.rows[0].s;
  }
  async recentRuns(address, limit = 20) {
    const r = await this.q(`select doc from runs where address = $1 order by created_at desc limit $2`, [address, limit]);
    return r.rows.map((x) => x.doc);
  }

  // ---- challenge pots
  async pot(day, { lock = false, create = null } = {}) {
    const sel = `select doc, settled from pots where day = $1${lock ? ' for update' : ''}`;
    let r = await this.q(sel, [day]);
    if (!r.rows.length && create) {
      await this.q(`insert into pots (day, doc) values ($1, $2::jsonb) on conflict do nothing`, [day, j(create)]);
      r = await this.q(sel, [day]);
    }
    if (!r.rows.length) return null;
    return { ...r.rows[0].doc, settled: r.rows[0].settled };
  }
  putPot(p) { return this.q(`update pots set doc = $2::jsonb, settled = $3 where day = $1`, [p.day, j(p), !!p.settled]); }
  // add to a pot's money without reading it first (row-locked by the update itself)
  addToPot(day, field, lamports) {
    return this.q(`update pots set doc = jsonb_set(doc, $2::text[], to_jsonb(coalesce((doc->>$3)::bigint, 0) + $4)) where day = $1`, [day, [field], field, lamports]);
  }
  async potEntry(day, address) {
    const r = await this.q(`select doc from pot_entries where day = $1 and address = $2`, [day, address]);
    return r.rows.length ? r.rows[0].doc : null;
  }
  putPotEntry(day, address, e) {
    return this.q(`insert into pot_entries (day, address, doc) values ($1, $2, $3::jsonb) on conflict (day, address) do update set doc = excluded.doc`, [day, address, j(e)]);
  }
  async potEntries(day) {
    const r = await this.q(`select address, doc from pot_entries where day = $1`, [day]);
    return r.rows.map((x) => ({ address: x.address, ...x.doc }));
  }
  async potCounts(day) {
    const r = await this.q(`select count(*)::int as n, count(*) filter (where (doc->>'done')::boolean)::int as done from pot_entries where day = $1`, [day]);
    return { entrants: r.rows[0].n, completed: r.rows[0].done };
  }
  async unsettledPots() {
    const r = await this.q(`select doc from pots where not settled order by day`);
    return r.rows.map((x) => ({ ...x.doc, settled: false }));
  }
  async lastSettledPot() {
    const r = await this.q(`select doc from pots where settled order by day desc limit 1`);
    return r.rows.length ? { ...r.rows[0].doc, settled: true } : null;
  }

  // ---- deposits
  async insertDeposit(d) {
    const r = await this.q(`insert into deposits (signature, address, lamports, slot, source) values ($1, $2, $3, $4, $5) on conflict do nothing returning signature`,
      [d.signature, d.address, d.lamports, d.slot || null, d.source]);
    return r.rowCount === 1;
  }
  async depositSeen(signature, address) {
    const r = await this.q(`select 1 from deposits where signature = $1 and address = $2 union all select 1 from unmatched_deposits where signature = $1 and from_address = $2`, [signature, address]);
    return r.rowCount > 0;
  }
  async depositedSince(address, since) {
    const r = await this.q(`select coalesce(sum(lamports), 0)::bigint as s from deposits where address = $1 and created_at >= $2`, [address, new Date(since)]);
    return r.rows[0].s;
  }
  async insertUnmatched(d) {
    const r = await this.q(`insert into unmatched_deposits (signature, from_address, lamports, slot) values ($1, $2, $3, $4) on conflict do nothing`, [d.signature, d.from, d.lamports, d.slot || null]);
    return r.rowCount === 1;
  }

  // ---- withdrawals
  async insertWithdrawal(w) {
    await this.q(`insert into withdrawals (id, address, lamports, status, auto, reason) values ($1, $2, $3, $4, $5, $6)`, [w.id, w.address, w.lamports, w.status, w.auto, w.reason || null]);
  }
  async withdrawal(id, { lock = true } = {}) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const r = await this.q(`select * from withdrawals where id = $1${lock ? ' for update' : ''}`, [id]);
    return r.rows[0] || null;
  }
  setWithdrawal(id, f) {
    const keys = Object.keys(f), sets = keys.map((k, i) => `${k} = $${i + 2}`);
    return this.q(`update withdrawals set ${sets.join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => f[k])]);
  }
  async withdrawalsWithStatus(statuses, { lock = false, limit = 100 } = {}) {
    const r = await this.q(`select * from withdrawals where status = any($1) order by created_at limit $2${lock ? ' for update skip locked' : ''}`, [statuses, limit]);
    return r.rows;
  }
  // automatic withdrawals (not ones a reviewer let through) since a time, for one player or everyone
  async autoWithdrawnSince(address, since) {
    const r = address
      ? await this.q(`select coalesce(sum(lamports), 0)::bigint as s from withdrawals where address = $1 and auto and status in ('queued', 'sending', 'sent') and created_at >= $2`, [address, new Date(since)])
      : await this.q(`select coalesce(sum(lamports), 0)::bigint as s from withdrawals where auto and status in ('queued', 'sending', 'sent') and created_at >= $1`, [new Date(since)]);
    return r.rows[0].s;
  }
  async withdrawnTotal(address) {
    const r = await this.q(`select coalesce(sum(lamports), 0)::bigint as s from withdrawals where address = $1 and status in ('review', 'queued', 'sending', 'sent')`, [address]);
    return r.rows[0].s;
  }
  async recentWithdrawals(address, limit = 10) {
    const r = await this.q(`select id, lamports, status, signature, reason, created_at from withdrawals where address = $1 order by created_at desc limit $2`, [address, limit]);
    return r.rows;
  }

  // ---- house transfers (sweeps to the cold wallet)
  async insertTransfer(t) { await this.q(`insert into transfers (id, kind, to_address, lamports, status) values ($1, $2, $3, $4, $5)`, [t.id, t.kind, t.to, t.lamports, t.status]); }
  async transfersWithStatus(statuses) { return (await this.q(`select * from transfers where status = any($1) order by created_at for update skip locked`, [statuses])).rows; }
  setTransfer(id, f) {
    const keys = Object.keys(f), sets = keys.map((k, i) => `${k} = $${i + 2}`);
    return this.q(`update transfers set ${sets.join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((k) => f[k])]);
  }

  // ---- the house's obligations: every balance, every open run at its biggest possible payout, open pots, and
  // withdrawals not yet sent (already taken off balances, but the SOL is still in the house wallet)
  async owed() {
    const r = await this.q(`select
      (select coalesce(sum(balance), 0) from users)::bigint as balances,
      (select coalesce(sum(exposure), 0) from runs where status in ('playing', 'checkpoint'))::bigint as runs,
      (select coalesce(sum(coalesce((doc->>'carryIn')::bigint, 0) + coalesce((doc->>'paidIn')::bigint, 0)), 0) from pots where not settled)::bigint as pots,
      (select coalesce(sum(lamports), 0) from withdrawals where status in ('review', 'queued', 'sending'))::bigint as withdrawals,
      (select coalesce(ceil(sum(coalesce((doc->'rb'->>'acc')::numeric, 0) + coalesce((doc->'rb'->>'ready')::numeric, 0))), 0) from users)::bigint as rakeback`);
    const o = r.rows[0];
    return { ...o, total: o.balances + o.runs + o.pots + o.withdrawals + o.rakeback }; // rakeback: set aside for players, claimed or not
  }
  // one transaction at a time past this point (run starts: the cover check must see every other start)
  bankrollLock() { return this.q(`select pg_advisory_xact_lock(7311001)`); }

  // ---- settings (small shared values)
  async setting(key, def = null) {
    const r = await this.q(`select value from settings where key = $1`, [key]);
    return r.rows.length ? r.rows[0].value : def;
  }
  putSetting(key, value) { return this.q(`insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, j(value)]); }
  incSetting(key, delta) {
    return this.q(`insert into settings (key, value) values ($1, to_jsonb($2::bigint)) on conflict (key) do update set value = to_jsonb(coalesce((settings.value)::text::bigint, 0) + $2::bigint)`, [key, delta]);
  }

  // ---- sign-in nonces
  putNonce(address, message, exp) {
    return this.q(`insert into nonces (address, message, exp) values ($1, $2, $3) on conflict (address) do update set message = excluded.message, exp = excluded.exp`, [address, message, exp]);
  }
  async takeNonce(address) {
    const r = await this.q(`delete from nonces where address = $1 returning message, exp`, [address]);
    return r.rows[0] || null;
  }

  // ---- closed beta
  async allowed(address) { return (await this.q(`select 1 from allowlist where address = $1`, [address])).rowCount > 0; }

  // ---- reviews and the audit trail
  async addReview(kind, address, ref, details) {
    const r = await this.q(`insert into reviews (kind, address, ref, details) values ($1, $2, $3, $4::jsonb) returning id`, [kind, address || null, ref == null ? null : String(ref), j(details || {})]);
    return r.rows[0].id;
  }
  audit(actor, action, target, details) {
    return this.q(`insert into audit (actor, action, target, details) values ($1, $2, $3, $4::jsonb)`, [actor, action, target || null, j(details || {})]);
  }

  // write back every locked player and run
  async flush() {
    for (const u of this.users.values()) {
      await this.q(`update users set balance = $2, doc = $3::jsonb, flagged = $4::jsonb, hold = $5::jsonb, kyc = $6, updated_at = now() where address = $1`,
        [u.address, u.balance, j(userDoc(u)), j(u.flagged || null), j(u.hold || null), u.kyc || 'none']);
    }
    for (const run of this.runs.values()) {
      await this.q(`update runs set status = $2, exposure = $3, doc = $4::jsonb, updated_at = now() where id = $1`,
        [run.id, run.status, OPEN.includes(run.status) ? run.exposure || 0 : 0, j(run)]);
    }
  }
}

export async function openDb(url, log) {
  const pool = new pg.Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30_000 });
  pool.on('error', (e) => log.error('postgres pool error', { err: e }));
  // migrations, one server at a time
  const c = await pool.connect();
  try {
    await c.query('select pg_advisory_lock(7311000)');
    await c.query('create table if not exists schema_migrations (v int primary key, at timestamptz not null default now())');
    const done = new Set((await c.query('select v from schema_migrations')).rows.map((r) => r.v));
    for (let i = 0; i < MIGRATIONS.length; i++) {
      if (done.has(i + 1)) continue;
      await c.query('begin');
      try { await c.query(MIGRATIONS[i]); await c.query('insert into schema_migrations (v) values ($1)', [i + 1]); await c.query('commit'); }
      catch (e) { await c.query('rollback'); throw e; }
      log.info('migrated', { v: i + 1 });
    }
  } finally {
    await c.query('select pg_advisory_unlock(7311000)').catch(() => {});
    c.release();
  }

  // run fn in a transaction, retrying on a deadlock or serialization failure
  async function tx(fn) {
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      const t = new Tx(client);
      try {
        await client.query('begin');
        const out = await fn(t);
        await t.flush();
        await client.query('commit');
        client.release();
        for (const f of t.after) { try { f(); } catch (e) { log.error('after-commit hook failed', { err: e }); } }
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => {});
        client.release();
        if (RETRY.has(e.code) && attempt < 5) { await sleep(10 + Math.random() * 40 * (attempt + 1)); continue; }
        throw e;
      }
    }
  }
  return { pool, tx, close: () => pool.end() };
}
