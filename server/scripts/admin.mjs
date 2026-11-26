#!/usr/bin/env node
// Command-line client for the operator API (/api/admin). Needs ADMIN_URL (the server's address) and ADMIN_TOKEN.
//
//   node scripts/admin.mjs overview                      solvency, pause switches, queues
//   node scripts/admin.mjs reviews                       everything waiting for a person
//   node scripts/admin.mjs approve <withdrawal-id> [note]
//   node scripts/admin.mjs reject <withdrawal-id> <note> refunds it to the player's balance
//   node scripts/admin.mjs user <address>                balance, ledger, runs, withdrawals, deposits, bot score
//   node scripts/admin.mjs hold|release|flag|unflag|revoke <address> [reason]
//   node scripts/admin.mjs kyc <address> none|pending|verified|rejected
//   node scripts/admin.mjs adjust <address> <lamports> <note>
//   node scripts/admin.mjs pause play|deposits|withdrawals ...    and   resume ...
//   node scripts/admin.mjs allow|disallow <address> ...  /  allowlist
//   node scripts/admin.mjs resolve-review <id> [note]
//   node scripts/admin.mjs unmatched <signature> <from-address> credit|refunded|ignore [note]
//   node scripts/admin.mjs ledger-check | sweep | reconcile | watch-deposits
const base = (process.env.ADMIN_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN;
if (!token) { console.error('Set ADMIN_TOKEN (and ADMIN_URL)'); process.exit(2); }
const [cmd, ...a] = process.argv.slice(2);

async function call(path, body) {
  const res = await fetch(base + '/api/admin' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...(process.env.ORIGIN_SECRET ? { 'x-origin-secret': process.env.ORIGIN_SECRET } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(res.status, j.error || j); process.exit(1); }
  return j;
}
const show = (x) => console.log(JSON.stringify(x, null, 2));
const sol = (l) => (Number(l) / 1e9).toFixed(4) + ' SOL';

const cmds = {
  async overview() {
    const o = await call('/overview');
    const b = o.bankroll;
    console.log(`network ${o.network}  access ${o.access}  pause ${JSON.stringify(o.pause)}`);
    console.log(`hot ${o.house}  ${sol(b.reserves.hot)}`);
    for (const c of b.reserves.cold) console.log(`cold ${c.address}  ${sol(c.lamports)}`);
    console.log(`reserves ${sol(b.reserves.total)}  owed ${sol(b.owed.total)} (balances ${sol(b.owed.balances)}, open runs at max win ${sol(b.owed.runs)}, pots ${sol(b.owed.pots)}, unsent withdrawals ${sol(b.owed.withdrawals)})`);
    console.log(`free ${sol(b.free)}  house rake ${sol(o.houseRake)}  mission SOL paid ${sol(o.missionPaid)}  rakeback claimed ${sol(o.rakebackPaid || 0)}`);
    console.log('counts', JSON.stringify(o.counts));
  },
  async reviews() {
    const r = await call('/reviews');
    for (const w of r.withdrawals) console.log(`withdrawal ${w.id}  ${sol(w.lamports)}  ${w.address}  ${w.reason || ''}`);
    for (const u of r.unmatched) console.log(`unmatched ${u.signature} from ${u.from_address}  ${sol(u.lamports)}`);
    for (const x of r.reviews) console.log(`review #${x.id} ${x.kind} ${x.address || ''} ${x.ref || ''} ${JSON.stringify(x.details)}`);
    if (!r.withdrawals.length && !r.unmatched.length && !r.reviews.length) console.log('nothing to review');
  },
  approve: async () => show(await call(`/withdrawals/${a[0]}/approve`, { note: a.slice(1).join(' ') || undefined })),
  reject: async () => show(await call(`/withdrawals/${a[0]}/reject`, { note: a.slice(1).join(' ') })),
  user: async () => show(await call(`/users/${a[0]}`)),
  hold: async () => show(await call(`/users/${a[0]}/hold`, { reason: a.slice(1).join(' ') || 'manual' })),
  release: async () => show(await call(`/users/${a[0]}/release`, {})),
  flag: async () => show(await call(`/users/${a[0]}/flag`, { reason: a.slice(1).join(' ') || 'manual' })),
  unflag: async () => show(await call(`/users/${a[0]}/unflag`, {})),
  revoke: async () => show(await call(`/users/${a[0]}/revoke`, {})),
  kyc: async () => show(await call(`/users/${a[0]}/kyc`, { status: a[1] })),
  adjust: async () => show(await call(`/users/${a[0]}/adjust`, { lamports: Number(a[1]), note: a.slice(2).join(' ') })),
  pause: async () => show(await call('/pause', Object.fromEntries(a.map((k) => [k, true])))),
  resume: async () => show(await call('/pause', Object.fromEntries(a.map((k) => [k, false])))),
  allow: async () => show(await call('/allowlist', { add: a })),
  disallow: async () => show(await call('/allowlist', { remove: a })),
  allowlist: async () => show(await call('/allowlist')),
  'resolve-review': async () => show(await call(`/reviews/${a[0]}/resolve`, { note: a.slice(1).join(' ') || undefined })),
  unmatched: async () => show(await call('/unmatched/resolve', { signature: a[0], from: a[1], action: a[2], note: a.slice(3).join(' ') || undefined })),
  'ledger-check': async () => show(await call('/ledger-check')),
  sweep: async () => show(await call('/sweep', {})),
  reconcile: async () => show(await call('/reconcile', {})),
  'watch-deposits': async () => show(await call('/watch-deposits', {}))
};
if (!cmds[cmd]) { console.error('Commands: ' + Object.keys(cmds).join(', ')); process.exit(2); }
await cmds[cmd]();
