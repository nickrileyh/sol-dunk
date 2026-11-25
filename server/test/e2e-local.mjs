// Runs scripts/e2e.mjs (the live devnet check) against a local chain: the LiteSVM RPC and a real-chain server with
// the default real-time check on. Slow on purpose (the run is played in real time): npm run test:e2e
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { bootServer, stopAll } from './lib/harness.mjs';
import { startSvmRpc } from './lib/svm-rpc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const rpc = await startSvmRpc();
const house = Keypair.generate(), player = Keypair.generate();
await rpc.ctl({ airdrop: { address: house.publicKey.toBase58(), lamports: 5e9 } });
await rpc.ctl({ airdrop: { address: player.publicKey.toBase58(), lamports: 2e9 } });
const srv = await bootServer({ MOCK_CHAIN: '0', NETWORK: 'localnet', RPC_URL: rpc.url, HOUSE_SECRET: bs58.encode(house.secretKey), MIN_REALTIME: '0.9', RISK_FRACTION: '1', WITHDRAW_WAIT_MS: '3000' });
const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'soldunk-e2e-')), 'player.json');
fs.writeFileSync(keyFile, JSON.stringify(Array.from(player.secretKey)));
const p = spawn(process.execPath, [path.join(here, '..', 'scripts', 'e2e.mjs'), '0.05'], { env: { ...process.env, SERVER_URL: srv.url, RPC_URL: rpc.url, PLAYER_KEY: keyFile }, stdio: 'inherit' });
const code = await new Promise((r) => p.on('exit', r));
rpc.close();
await stopAll();
process.exitCode = code;
