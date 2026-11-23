import { Keypair, PublicKey, SystemProgram, Transaction, Message } from '@solana/web3.js';
import bs58 from 'bs58';
const user = Keypair.generate(), house = Keypair.generate();
const blockhash = bs58.encode(Buffer.alloc(32, 7));
// deposit message the server hands to Phantom
const tx = new Transaction({ feePayer: user.publicKey, blockhash, lastValidBlockHeight: 100 })
  .add(SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: house.publicKey, lamports: 123456789 }));
const msg = bs58.encode(tx.serializeMessage());
const back = Message.from(bs58.decode(msg));
const ix = back.instructions[0];
const data = Buffer.from(bs58.decode(ix.data));
console.log('deposit message ok:', back.accountKeys[0].equals(user.publicKey), back.accountKeys[1].equals(house.publicKey),
  'instr', data.readUInt32LE(0), 'lamports', Number(data.readBigUInt64LE(4)), 'signers', back.header.numRequiredSignatures);
// the wallet signs the same message bytes: check a signature verifies against it
const signed = Transaction.populate(back, []); signed.sign(user);
console.log('user signature verifies:', signed.verifySignatures());
// withdrawal transaction from the house
const w = new Transaction({ feePayer: house.publicKey, blockhash, lastValidBlockHeight: 100 }).add(SystemProgram.transfer({ fromPubkey: house.publicKey, toPubkey: user.publicKey, lamports: 5 }));
w.sign(house); console.log('withdrawal signs:', w.verifySignatures(), w.serialize().length + ' bytes');
