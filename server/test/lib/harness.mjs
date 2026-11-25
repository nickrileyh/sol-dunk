// Shared test plumbing: one throwaway Postgres per test process (a fresh database per server), servers in child
// processes, and an API client that signs in with a fresh ed25519 wallet.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { startDevPostgres, freePort } from '../../lib/devpg.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER = path.join(here, '..', '..', 'server.mjs');

let pg = null, dbN = 0;
const procs = new Set();
export async function testPostgres() {
  if (!pg) pg = await startDevPostgres(fs.mkdtempSync(path.join(os.tmpdir(), 'soldunk-pg-')) + '/data', { persistent: false });
  return pg;
}
export async function stopAll() {
  for (const p of procs) p.kill('SIGKILL');
  procs.clear();
  if (pg) { await pg.stop().catch(() => {}); pg = null; }
}
process.on('exit', () => { for (const p of procs) try { p.kill('SIGKILL'); } catch { /* gone */ } });

// a server in mock mode unless env says otherwise; returns { port, url, proc, dbUrl, kill() }
export async function bootServer(env = {}, { quiet = true } = {}) {
  const port = await freePort();
  const p = await testPostgres();
  const dbUrl = await p.createDb('t' + process.pid + '_' + (++dbN));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soldunk-data-'));
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MOCK_CHAIN: '1', PORT: String(port), DATABASE_URL: dbUrl, DATA_DIR: dataDir, MIN_REALTIME: '0', RATE_LIMIT: '0', LOG_LEVEL: quiet ? 'error' : 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  procs.add(proc);
  let out = '';
  proc.stdout.on('data', (d) => { out += d; if (!quiet) process.stdout.write(d); });
  proc.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    if (proc.exitCode !== null) throw new Error('server exited: ' + out.slice(-2000));
    try { await fetch(url + '/healthz'); return { port, url, proc, dbUrl, dataDir, output: () => out, kill: () => { proc.kill('SIGKILL'); procs.delete(proc); } }; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start: ' + out.slice(-2000));
}

export function apiClient(base) {
  let token = null;
  const api = async (p, body, headers = {}) => {
    const res = await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ...j };
  };
  return {
    api,
    kp: null,
    async signIn(kp = nacl.sign.keyPair()) {
      this.kp = kp;
      const address = bs58.encode(kp.publicKey);
      const { message, status, error } = await api('/api/auth/nonce', { address });
      if (!message) return { address, r: { status, error } };
      const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
      const r = await api('/api/auth/verify', { address, signature: bs58.encode(sig) });
      token = r.token;
      return { address, r, message };
    },
    setToken(t) { token = t; }, get token() { return token; }
  };
}

export function admin(base, adminToken) {
  return async (p, body) => {
    const res = await fetch(base + '/api/admin' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + adminToken }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ...j };
  };
}

let failures = 0;
export const check = (cond, msg) => { if (!cond) { failures++; console.log('  FAIL', msg); } else if (process.env.VERBOSE) console.log('  ok  ', msg); };
export const failed = () => failures;
