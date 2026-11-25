// A Solana JSON-RPC endpoint backed by LiteSVM: real transaction processing (signatures, fees, the system program,
// rent) in-process, with just enough RPC for the server and its tests. Blocks advance on a timer, so blockhashes
// expire like they do on a real cluster, and a control API injects the failures that matter for money:
//   drop      accept a transaction but never land it (the network lost it)
//   lose      land it but fail the HTTP answer (the server can't know it landed)
//   hold      accept it and land it only when told (lands late)
//   lag       answer status lookups like a node far behind the chain (nothing found, an old slot)
// POST /ctl { airdrop: { address, lamports } | drop: n | lose: n | hold: n | land: true | advance: blocks }
import http from 'node:http';
import bs58 from 'bs58';
import { LiteSVM } from 'litesvm';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';

export async function startSvmRpc({ blockMs = 50, finalizeAfter = 2, validBlocks = 150 } = {}) {
  const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(false).withTransactionHistory(0n);
  let height = 1;
  const hashes = new Map();                  // blockhash -> last valid block height
  const txs = new Map();                     // signature -> record
  const byAddress = new Map();               // address -> [signature...] oldest first
  const held = [];                           // accepted, not landed
  const fault = { drop: 0, lose: 0, hold: 0, lag: false };
  let currentHash = null;
  const timer = setInterval(() => { height++; }, blockMs);
  timer.unref();

  function freshHash() {
    // a new blockhash every block, so each one has its own expiry
    if (!currentHash || currentHash.height !== height) {
      svm.expireBlockhash();
      currentHash = { hash: svm.latestBlockhash(), height };
      hashes.set(currentHash.hash, height + validBlocks);
    }
    return currentHash.hash;
  }
  const status = (rec) => (height - rec.slot >= finalizeAfter ? 'finalized' : 'confirmed');

  function land(raw, vtx, sig) {
    const msg = vtx.message;
    const keys = msg.staticAccountKeys.map((k) => k.toBase58());
    const pre = keys.map((k) => Number(svm.getBalance(new PublicKey(k)) || 0n));
    const res = svm.sendTransaction(vtx);
    const failed = typeof res.err === 'function';
    const post = keys.map((k) => Number(svm.getBalance(new PublicKey(k)) || 0n));
    const rec = {
      slot: height, blockTime: Math.floor(Date.now() / 1000), raw, keys,
      err: failed ? { InstructionError: [0, String(res.err())] } : null,
      fee: pre[0] - post[0] - (failed ? 0 : 0), pre, post,
      logs: failed ? [] : res.logs(), cu: failed ? 0 : Number(res.computeUnitsConsumed())
    };
    txs.set(sig, rec);
    for (const k of keys) { if (!byAddress.has(k)) byAddress.set(k, []); byAddress.get(k).push(sig); }
    return rec;
  }

  const methods = {
    getHealth: () => 'ok',
    getVersion: () => ({ 'solana-core': '2.2.0-litesvm', 'feature-set': 0 }),
    getSlot: () => height,
    getBlockHeight: () => height,
    getEpochInfo: ([opts]) => { const h = opts && opts.commitment === 'finalized' ? Math.max(0, height - finalizeAfter) : height; return { absoluteSlot: h, blockHeight: h, epoch: 0, slotIndex: h, slotsInEpoch: 432000, transactionCount: txs.size }; },
    getBalance: ([addr]) => ({ context: { slot: height }, value: Number(svm.getBalance(new PublicKey(addr)) || 0n) }),
    getLatestBlockhash: () => { const h = freshHash(); return { context: { slot: height }, value: { blockhash: h, lastValidBlockHeight: hashes.get(h) } }; },
    getMinimumBalanceForRentExemption: ([n]) => Number(svm.minimumBalanceForRentExemption(BigInt(n || 0))),
    sendTransaction: ([b64, opts]) => {
      const raw = Buffer.from(b64, (opts && opts.encoding) || 'base64');
      const vtx = VersionedTransaction.deserialize(raw);
      const sig = bs58.encode(vtx.signatures[0]);
      const lastValid = hashes.get(vtx.message.recentBlockhash);
      if (lastValid === undefined || height > lastValid) throw { code: -32002, message: 'Transaction simulation failed: Blockhash not found' };
      if (txs.has(sig)) throw { code: -32002, message: 'Transaction simulation failed: This transaction has already been processed' };
      if (!(opts && opts.skipPreflight)) {
        const sim = svm.simulateTransaction(vtx);
        if (typeof sim.err === 'function') throw { code: -32002, message: 'Transaction simulation failed: ' + String(sim.err()), data: { logs: [] } };
      }
      if (fault.drop > 0) { fault.drop--; return sig; }
      if (fault.hold > 0) { fault.hold--; held.push({ raw, vtx, sig, lastValid }); return sig; }
      land(raw, vtx, sig);
      if (fault.lose > 0) { fault.lose--; throw { lose: true }; }
      return sig;
    },
    getSignatureStatuses: ([sigs]) => (fault.lag ? { context: { slot: 1 }, value: sigs.map(() => null) } : {
      context: { slot: height },
      value: sigs.map((s) => { const r = txs.get(s); return r ? { slot: r.slot, confirmations: null, err: r.err, status: r.err ? { Err: r.err } : { Ok: null }, confirmationStatus: status(r) } : null; })
    }),
    getTransaction: ([sig, opts]) => {
      const r = txs.get(sig);
      if (!r) return null;
      if (opts && opts.commitment === 'finalized' && status(r) !== 'finalized') return null;
      const vtx = VersionedTransaction.deserialize(r.raw), m = vtx.message;
      return {
        slot: r.slot, blockTime: r.blockTime, version: 'legacy',
        transaction: {
          signatures: vtx.signatures.map((x) => bs58.encode(x)),
          message: {
            accountKeys: r.keys, header: m.header, recentBlockhash: m.recentBlockhash,
            instructions: m.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: ix.accountKeyIndexes, data: bs58.encode(ix.data) }))
          }
        },
        meta: { err: r.err, fee: Math.max(0, r.fee), preBalances: r.pre, postBalances: r.post, innerInstructions: [], logMessages: r.logs, preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] }, computeUnitsConsumed: r.cu }
      };
    },
    getSignaturesForAddress: ([addr, opts = {}]) => {
      const list = (byAddress.get(addr) || []).slice().reverse(); // newest first
      let i = 0;
      if (opts.before) { const k = list.indexOf(opts.before); i = k < 0 ? list.length : k + 1; }
      const out = [];
      for (; i < list.length && out.length < (opts.limit || 1000); i++) {
        if (opts.until && list[i] === opts.until) break;
        const r = txs.get(list[i]);
        if (opts.commitment === 'finalized' && status(r) !== 'finalized') continue;
        out.push({ signature: list[i], slot: r.slot, err: r.err, memo: null, blockTime: r.blockTime, confirmationStatus: status(r) });
      }
      return out;
    }
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch { return send(400, { error: 'bad json' }); }
      if (req.url === '/ctl') {
        if (msg.airdrop) svm.airdrop(new PublicKey(msg.airdrop.address), BigInt(msg.airdrop.lamports));
        for (const k of ['drop', 'lose', 'hold']) if (msg[k]) fault[k] += msg[k];
        if (typeof msg.lag === 'boolean') fault.lag = msg.lag;
        if (msg.advance) height += msg.advance;
        const landed = [];
        if (msg.land) {
          // land held transactions that are still valid (an expired one can never land)
          while (held.length) { const h = held.shift(); if (height <= h.lastValid) { land(h.raw, h.vtx, h.sig); landed.push(h.sig); } }
        }
        return send(200, { ok: true, height, landed, held: held.length });
      }
      const one = (m) => {
        try {
          if (!methods[m.method]) return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found: ' + m.method } };
          return { jsonrpc: '2.0', id: m.id, result: methods[m.method](m.params || []) };
        } catch (e) {
          if (e && e.lose) return { lose: true };
          return { jsonrpc: '2.0', id: m.id, error: { code: e.code || -32603, message: e.message || String(e), data: e.data } };
        }
      };
      const out = Array.isArray(msg) ? msg.map(one) : one(msg);
      if ((Array.isArray(out) ? out : [out]).some((x) => x.lose)) { res.destroy(); return; } // the answer is lost
      send(200, out);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const ctl = async (o) => (await fetch(url + '/ctl', { method: 'POST', body: JSON.stringify(o) })).json();
  return {
    url, svm, ctl,
    balance: (a) => Number(svm.getBalance(new PublicKey(a)) || 0n),
    height: () => height,
    sendRaw: (raw) => methods.sendTransaction([Buffer.from(raw).toString('base64'), { encoding: 'base64' }]),
    blockhash: () => { const h = freshHash(); return { blockhash: h, lastValidBlockHeight: hashes.get(h) }; },
    close: () => { clearInterval(timer); server.close(); }
  };
}
