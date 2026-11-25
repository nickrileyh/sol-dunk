// A throwaway or local Postgres for development and tests (the embedded-postgres dev dependency). Production sets
// DATABASE_URL instead; the server refuses to start on mainnet without it.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

export async function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// start (or reuse) a cluster in dir; returns { url(db), createDb(name), stop() }
export async function startDevPostgres(dir, { persistent = true, port } = {}) {
  let EmbeddedPostgres;
  try { ({ default: EmbeddedPostgres } = await import('embedded-postgres')); }
  catch { throw new Error('No DATABASE_URL, and the embedded-postgres dev dependency is not installed (run npm install in server/)'); }
  port = port || await freePort();
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try { fs.chmodSync(path.dirname(dir), 0o755); } catch { /* not ours */ } // as root, initdb runs as a postgres user that must reach it
  const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
  const ep = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent, createPostgresUser: true, onLog: () => {}, onError: () => {} });
  if (fresh) await ep.initialise();
  await ep.start();
  const base = `postgres://postgres:postgres@127.0.0.1:${port}`;
  return {
    port,
    url: (db) => `${base}/${db}`,
    async createDb(name) { try { await ep.createDatabase(name); } catch (e) { if (!/already exists/.test(String(e.message))) throw e; } return `${base}/${name}`; },
    stop: () => ep.stop()
  };
}
