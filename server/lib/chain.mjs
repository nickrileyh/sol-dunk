// Solana access. RpcChain talks to a real cluster (mainnet, devnet, a local validator); MockChain is the no-network
// stand-in for development (MOCK_CHAIN=1), where /api/dev/faucet credits test SOL.
//
// House transfers are signed and their signature recorded before they are broadcast (see payments.mjs), so this
// module splits "sign" from "broadcast".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { Connection, PublicKey, Keypair, SystemProgram, Transaction, ComputeBudgetProgram } from '@solana/web3.js';

const SYSTEM = SystemProgram.programId.toBase58();
// lamports the hot wallet keeps back when deciding whether it can pay: its rent-exempt minimum (890,880) plus fees.
// A transfer that would leave the account below the rent minimum fails on chain.
export const TX_FEE_MARGIN = 1_000_000;

export function validAddress(a) {
  try { return typeof a === 'string' && a.length >= 32 && a.length <= 44 && PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch { return false; }
}

// the hot wallet: from HOUSE_SECRET (base58 or a JSON byte array) or HOUSE_KEY_FILE. Off mainnet a key is made and
// kept in DATA_DIR/house-<network>.json if neither is set; on mainnet the config check refuses to start without one.
export function loadHouseKey(CFG, log) {
  const parse = (s) => {
    s = s.trim();
    return Keypair.fromSecretKey(s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s));
  };
  if (CFG.houseSecret) return parse(CFG.houseSecret);
  if (CFG.houseKeyFile) return parse(fs.readFileSync(CFG.houseKeyFile, 'utf8'));
  if (CFG.mainnet) throw new Error('No house key on mainnet');
  const f = path.join(CFG.dataDir, `house-${CFG.network}.json`);
  if (fs.existsSync(f)) return parse(fs.readFileSync(f, 'utf8'));
  fs.mkdirSync(CFG.dataDir, { recursive: true });
  const kp = Keypair.generate();
  fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  log.info('made a new house wallet for ' + CFG.network, { address: kp.publicKey.toBase58(), file: f });
  return kp;
}


export class RpcChain {
  constructor(CFG, house, log) {
    this.CFG = CFG; this.house = house; this.log = log;
    this.address = house.publicKey.toBase58();
    this.conn = new Connection(CFG.rpc, { commitment: 'confirmed', disableRetryOnRateLimit: false });
    this.cache = null;
  }
  async balance(address, commitment = 'confirmed') { return this.conn.getBalance(new PublicKey(address), commitment); }
  // the bankroll: the hot wallet plus the cold and other reserve addresses (read-only: the server holds no key for them)
  async reserves({ fresh = false } = {}) {
    if (!fresh && this.cache && Date.now() - this.cache.at < 15_000) return this.cache;
    const addrs = this.CFG.reserveAddresses.filter((a) => a !== this.address);
    const [hot, ...others] = await Promise.all([this.balance(this.address), ...addrs.map((a) => this.balance(a))]);
    const cold = addrs.map((address, i) => ({ address, lamports: others[i] }));
    this.cache = { at: Date.now(), hot, cold, total: hot + cold.reduce((a, c) => a + c.lamports, 0) };
    return this.cache;
  }
  invalidate() { this.cache = null; }

  // the deposit the player's wallet signs and sends: a plain transfer to the hot wallet, the player paying the fee
  async depositMessage(from, lamports) {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('confirmed');
    const payer = new PublicKey(from);
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight })
      .add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: this.house.publicKey, lamports }));
    return bs58.encode(tx.serializeMessage());
  }

  // the plain system-program transfers in a transaction, decoded here rather than trusting a parsed view
  async readTransfers(signature, commitment) {
    const tx = await this.conn.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 });
    if (!tx) return { found: false };
    if (!tx.meta || tx.meta.err) return { found: true, failed: true, slot: tx.slot };
    const msg = tx.transaction.message;
    const keys = msg.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const transfers = [];
    for (const ix of msg.compiledInstructions) {
      const program = keys.get(ix.programIdIndex);
      if (!program || program.toBase58() !== SYSTEM) continue;
      const data = Buffer.from(ix.data);
      if (data.length !== 12 || data.readUInt32LE(0) !== 2) continue; // SystemInstruction::Transfer { lamports: u64 }
      const from = keys.get(ix.accountKeyIndexes[0]), to = keys.get(ix.accountKeyIndexes[1]);
      if (!from || !to) continue;
      const lamports = Number(data.readBigUInt64LE(4));
      if (!Number.isSafeInteger(lamports)) continue;
      transfers.push({ from: from.toBase58(), to: to.toBase58(), lamports });
    }
    return { found: true, failed: false, slot: tx.slot, blockTime: tx.blockTime, transfers };
  }

  latestBlockhash() { return this.conn.getLatestBlockhash('confirmed'); }
  // sign a transfer from the hot wallet; nothing is sent yet
  signTransfer(to, lamports, { blockhash, lastValidBlockHeight }) {
    const tx = new Transaction({ feePayer: this.house.publicKey, blockhash, lastValidBlockHeight });
    if (this.CFG.priorityFee > 0) {
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000 }));
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: this.CFG.priorityFee }));
    }
    tx.add(SystemProgram.transfer({ fromPubkey: this.house.publicKey, toPubkey: new PublicKey(to), lamports }));
    tx.sign(this.house);
    return { signature: bs58.encode(tx.signature), raw: tx.serialize(), lastValid: lastValidBlockHeight };
  }
  // send a signed transaction. Whatever happens here, the caller never re-signs a transfer until the chain shows the
  // old signature can no longer land (its blockhash expired): a failed send may still have reached the network.
  async broadcast(raw) {
    await this.conn.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 10 });
  }
  // [{ status: 'processed'|'confirmed'|'finalized', err } | null], searching the whole history
  async statuses(signatures) {
    const out = [];
    for (let i = 0; i < signatures.length; i += 200) {
      const r = await this.conn.getSignatureStatuses(signatures.slice(i, i + 200), { searchTransactionHistory: true });
      for (const s of r.value) out.push(s ? { status: s.confirmationStatus, err: s.err } : null);
    }
    return out;
  }
  // the same, with the slot the answering node had reached when it looked
  async statusesAt(signatures) {
    const value = [];
    let contextSlot = Infinity;
    for (let i = 0; i < signatures.length; i += 200) {
      const r = await this.conn.getSignatureStatuses(signatures.slice(i, i + 200), { searchTransactionHistory: true });
      contextSlot = Math.min(contextSlot, r.context.slot);
      for (const s of r.value) value.push(s ? { status: s.confirmationStatus, err: s.err } : null);
    }
    return { contextSlot, value };
  }
  // the finalized chain's tip: its slot and block height, from one answer
  async finalizedInfo() { const e = await this.conn.getEpochInfo('finalized'); return { slot: e.absoluteSlot, height: e.blockHeight }; }
  blockHeight(commitment = 'finalized') { return this.conn.getBlockHeight(commitment); }
  // signatures touching the hot wallet newer than `until`, oldest first
  async signaturesSince(until, commitment = 'confirmed') {
    const all = [];
    let before;
    for (let page = 0; page < 20; page++) {
      const r = await this.conn.getSignaturesForAddress(this.house.publicKey, { until: until || undefined, before, limit: 1000 }, commitment);
      all.push(...r);
      if (r.length < 1000) break;
      before = r[r.length - 1].signature;
    }
    return all.reverse();
  }
  async health() {
    await Promise.race([this.conn.getBlockHeight('confirmed'), new Promise((_, rej) => setTimeout(() => rej(new Error('rpc timeout')), 3000))]);
    return true;
  }
}

// no network: unlimited reserves, deposits off (use /api/dev/faucet), withdrawals land at once
export class MockChain {
  constructor(CFG, house) { this.CFG = CFG; this.house = house; this.address = house.publicKey.toBase58(); }
  async balance() { return this.CFG.mockReserve; }
  async reserves() { return { at: Date.now(), hot: this.CFG.mockReserve, cold: [], total: this.CFG.mockReserve }; }
  invalidate() {}
  async depositMessage() { throw Object.assign(new Error('Deposits are disabled in mock mode. Use /api/dev/faucet.'), { status: 400 }); }
  async readTransfers() { throw Object.assign(new Error('Deposits are disabled in mock mode'), { status: 400 }); }
  async latestBlockhash() { return { blockhash: 'mock', lastValidBlockHeight: 0 }; }
  signTransfer() { return { signature: 'mock' + crypto.randomBytes(30).toString('hex'), raw: null, lastValid: 0 }; }
  async broadcast() {}
  async statuses(sigs) { return sigs.map(() => ({ status: 'finalized', err: null })); }
  async statusesAt(sigs) { return { contextSlot: 0, value: await this.statuses(sigs) }; }
  async finalizedInfo() { return { slot: 0, height: 0 }; }
  async blockHeight() { return 0; }
  async signaturesSince() { return []; }
  async health() { return true; }
}
