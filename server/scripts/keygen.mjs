#!/usr/bin/env node
// Make the hot wallet's key: node scripts/keygen.mjs <file>
// Writes the secret key as a JSON byte array (the Solana CLI's format) with owner-only permissions and prints the
// public address. Point HOUSE_KEY_FILE at the file (mount it as a secret in production). The key never leaves this
// machine; keep a backup somewhere offline. The cold wallet should be a multisig whose keys never touch the server.
import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/keygen.mjs <file>'); process.exit(2); }
if (fs.existsSync(file)) { console.error(`${file} already exists: refusing to overwrite a key`); process.exit(1); }
const kp = Keypair.generate();
fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
console.log(`hot wallet ${kp.publicKey.toBase58()}\nkey file  ${file} (mode 600)`);
